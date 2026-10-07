import { describe, expect, it } from "vitest";
import { calculatePrice, assertTransition, transitions } from "../src/modules/shipments/shipment.rules.js";
describe("shipment business invariants", () => {
  it("uses integer paisa and rounds chargeable kilograms up", () => {
    const zone = { basePrice: 6000, perKgPrice: 2000 };
    expect(calculatePrice(1001, zone, zone, true).price).toBe(10000);
    expect(calculatePrice(1000, zone, { basePrice: 10000, perKgPrice: 2500 }, false).price).toBe(18000);
    expect(calculatePrice(1, zone, zone, true).price).toBe(8000);
  });
  it("rejects skipping pickup and re-opening terminal states", () => {
    expect(() => assertTransition("CREATED", "DELIVERED", 0)).toThrow();
    for (const state of ["DELIVERED", "RETURNED", "CANCELLED"] as const) expect(transitions[state]).toEqual([]);
  });
  it("limits delivery retries and retains the return path", () => {
    expect(() => assertTransition("FAILED_DELIVERY", "OUT_FOR_DELIVERY", 3)).toThrow();
    expect(() => assertTransition("FAILED_DELIVERY", "RETURNING", 3)).not.toThrow();
    expect(() => assertTransition("FAILED_DELIVERY", "OUT_FOR_DELIVERY", 2)).not.toThrow();
  });
});
