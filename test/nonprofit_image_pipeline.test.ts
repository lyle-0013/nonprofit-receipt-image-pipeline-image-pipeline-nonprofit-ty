import assert from "node:assert/strict";
import test from "node:test";
import { ingestReceipt, type ReceiptServices } from "../src/nonprofit_image_pipeline.ts";

test("stores a receipt at its campaign key and emits reminder and reporting state", async () => {
  const calls: string[] = [];
  const services: ReceiptServices = {
    async ensureBucket() { calls.push("bucket"); },
    async putOriginal(_input, key) { calls.push(`put:${key}`); },
    async resizeAndStore(_input, decision) {
      calls.push(`resize:${decision.resize.width}:${decision.resize.enlarge}`);
      return { url: "https://cdn.example.test/receipt-preview.webp" };
    },
  };

  const result = await ingestReceipt({
    receiptId: "receipt_204",
    donorId: "donor_17",
    campaignId: "winter-shelter",
    amountCents: 12500,
    volunteerReminderAt: "2026-10-05T09:00:00+08:00",
    filename: "signed-receipt.png",
    contentType: "image/png",
    imageBase64: "c2FtcGxl",
  }, services);

  assert.deepEqual(calls, [
    "bucket",
    "put:receipts/winter-shelter/receipt_204.png",
    "resize:1600:false",
  ]);
  assert.equal(result.receipt.state, "stored");
  assert.deepEqual(result.volunteerReminder, {
    receiptId: "receipt_204",
    dueAt: "2026-10-05T09:00:00+08:00",
    state: "scheduled",
  });
  assert.deepEqual(result.campaignReport, {
    campaignId: "winter-shelter",
    receiptCount: 1,
    donatedCents: 12500,
  });
});
