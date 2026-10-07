ALTER TABLE "Payment" ADD COLUMN "refundAttempt" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "Payment" ADD COLUMN "refundFailure" TEXT;
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_positive_amount" CHECK ("amount" > 0);
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_positive_attempts" CHECK ("attempt" >= 1 AND "refundAttempt" >= 1);
ALTER TABLE "Zone" ADD CONSTRAINT "Zone_nonnegative_pricing" CHECK ("basePrice" > 0 AND "perKgPrice" >= 0);
ALTER TABLE "Shipment" ADD CONSTRAINT "Shipment_valid_weight" CHECK ("weightGrams" BETWEEN 1 AND 30000);
ALTER TABLE "Shipment" ADD CONSTRAINT "Shipment_positive_price" CHECK ("price" > 0);
ALTER TABLE "Shipment" ADD CONSTRAINT "Shipment_valid_attempts" CHECK ("deliveryAttempts" BETWEEN 0 AND 3 AND "version" >= 0);
