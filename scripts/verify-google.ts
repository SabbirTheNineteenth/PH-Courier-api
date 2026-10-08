import "dotenv/config";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { z } from "zod";

const settings = z
  .object({
    GOOGLE_CLIENT_ID: z.string().regex(/^[\w.-]+\.apps\.googleusercontent\.com$/),
    LIVE_API_URL: z.url(),
  })
  .parse(process.env);
const base = settings.LIVE_API_URL.replace(/\/$/, "");
if (!base.startsWith("https://")) throw new Error("Use the deployed HTTPS API");
const origin = "http://localhost:3000";
const bodySchema = z.object({ idToken: z.string().min(20).max(10000) }).strict();
const page = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Google login verification</title>
<body><main><h1>Verify Google login</h1><p>Sign in to verify the deployed courier API. Tokens are used for this check and are never displayed or saved.</p><div id="google-button"></div><p id="status" role="status">Loading Google sign-in...</p></main>
<script>function startGoogle(){google.accounts.id.initialize({client_id:${JSON.stringify(settings.GOOGLE_CLIENT_ID)},ux_mode:'popup',auto_select:false,callback:async function(response){const status=document.getElementById('status');status.textContent='Verifying with the backend...';try{const result=await fetch('/verify',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({idToken:response.credential})});const json=await result.json();status.textContent=json.message;}catch{status.textContent='Verification request failed. Keep this local tool running and try again.';}}});google.accounts.id.renderButton(document.getElementById('google-button'),{theme:'outline',size:'large'});document.getElementById('status').textContent='Choose your Google account to continue.';}</script>
<script src="https://accounts.google.com/gsi/client" async defer onload="startGoogle()"></script></body></html>`;

async function api(path: string, body?: unknown, token?: string) {
  const response = await fetch(`${base}/api/v1${path}`, {
    method: body ? "POST" : "GET",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(30000),
  });
  const json = await response.json();
  if (!response.ok) throw new Error(json.message || `Backend HTTP ${response.status}`);
  return json.data;
}
let busy = false;
const server = createServer(async (request, response) => {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Cross-Origin-Opener-Policy", "same-origin-allow-popups");
  if (request.method === "GET" && request.url === "/") {
    response.setHeader("Content-Type", "text/html; charset=utf-8");
    response.end(page);
    return;
  }
  response.setHeader("Content-Type", "application/json");
  if (request.method !== "POST" || request.url !== "/verify") {
    response.writeHead(404).end(JSON.stringify({ message: "Not found" }));
    return;
  }
  if (request.headers.origin !== origin || busy) {
    response
      .writeHead(403)
      .end(JSON.stringify({ message: "Open the local verification page and try again." }));
    return;
  }
  busy = true;
  const sessions: Array<{ refreshToken: string }> = [];
  try {
    let raw = "";
    for await (const chunk of request) {
      raw += chunk.toString();
      if (Buffer.byteLength(raw) > 12000) throw new Error("Request too large");
    }
    const input = bodySchema.parse(JSON.parse(raw));
    const first = await api("/auth/google", input);
    sessions.push(first);
    const profile = await api("/users/me", undefined, first.accessToken);
    if (profile.id !== first.user.id) throw new Error("Authenticated profile mismatch");
    const second = await api("/auth/google", input);
    sessions.push(second);
    if (second.user.id !== first.user.id)
      throw new Error("Google sign-in created a duplicate account");
    for (const session of sessions)
      await api("/auth/logout", { refreshToken: session.refreshToken });
    sessions.length = 0;
    await mkdir(".local", { recursive: true });
    await writeFile(
      ".local/google-acceptance.json",
      `${JSON.stringify(
        {
          verifiedAt: new Date().toISOString(),
          base,
          userId: first.user.id,
          role: first.user.role,
          validGoogleLogin: true,
          bearerProfileVerified: true,
          stableUserVerified: true,
          refreshTokensRevoked: true,
        },
        null,
        2,
      )}\n`,
    );
    response.end(
      JSON.stringify({
        message:
          "Google login passed. Profile access and repeat sign-in passed; verification sessions were logged out.",
      }),
    );
    console.log(
      "PASS actual Google login, authenticated profile and stable repeat identity; tokens revoked",
    );
  } catch (error) {
    for (const session of sessions) {
      await api("/auth/logout", { refreshToken: session.refreshToken }).catch(() => undefined);
    }
    const message =
      error instanceof z.ZodError
        ? "Invalid verification request"
        : error instanceof Error
          ? error.message
          : "Verification failed";
    response.writeHead(400).end(JSON.stringify({ message }));
  } finally {
    busy = false;
  }
});
server.listen(3000, "127.0.0.1", () => {
  console.log(`Google verification tool: ${origin}`);
  console.log(`Google OAuth authorized JavaScript origin must include ${origin}`);
});
