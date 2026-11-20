import { z } from "zod";
import { InfraiError, infrai } from "./infrai.ts";

const receiptUploadSchema = z.object({
  receiptId: z.string().min(1).max(80).regex(/^[a-zA-Z0-9_-]+$/),
  donorId: z.string().min(1).max(80),
  campaignId: z.string().min(1).max(80),
  amountCents: z.number().int().positive(),
  volunteerReminderAt: z.string().datetime({ offset: true }),
  filename: z.string().min(1).max(160),
  contentType: z.enum(["image/jpeg", "image/png", "image/webp"]),
  imageBase64: z.string().min(1),
});

export type ReceiptUpload = z.infer<typeof receiptUploadSchema>;

export type ReceiptDecision = {
  originalKey: string;
  reminder: { receiptId: string; dueAt: string; state: "scheduled" };
  campaignDelta: { campaignId: string; receiptCount: 1; donatedCents: number };
  resize: { width: 1600; height: 1600; fit: "inside"; enlarge: false; format: "webp" };
};

export function decideReceiptWorkflow(input: ReceiptUpload): ReceiptDecision {
  const extension = input.contentType === "image/png" ? "png" : input.contentType === "image/webp" ? "webp" : "jpg";
  return {
    originalKey: `receipts/${input.campaignId}/${input.receiptId}.${extension}`,
    reminder: { receiptId: input.receiptId, dueAt: input.volunteerReminderAt, state: "scheduled" },
    campaignDelta: { campaignId: input.campaignId, receiptCount: 1, donatedCents: input.amountCents },
    resize: { width: 1600, height: 1600, fit: "inside", enlarge: false, format: "webp" },
  };
}

export function parseReceiptUpload(value: unknown): ReceiptUpload {
  return receiptUploadSchema.parse(value);
}

export type ReceiptServices = {
  ensureBucket(): Promise<void>;
  putOriginal(input: ReceiptUpload, key: string): Promise<void>;
  resizeAndStore(input: ReceiptUpload, decision: ReceiptDecision): Promise<Record<string, unknown>>;
};

const RECEIPT_BUCKET = process.env.INFRAI_RECEIPT_BUCKET ?? "nonprofit-donor-receipts";

export const liveReceiptServices: ReceiptServices = {
  async ensureBucket() {
    try {
      await infrai.storage.bucket.get(RECEIPT_BUCKET);
    } catch (error) {
      if (!(error instanceof InfraiError) || error.status !== 404) throw error;
      await infrai.storage.bucket.create({
        name: RECEIPT_BUCKET,
        idempotency_key: `bucket:${RECEIPT_BUCKET}`,
      });
    }
  },
  async putOriginal(input, key) {
    await infrai.storage.object.put(RECEIPT_BUCKET, key, {
      data_base64: input.imageBase64,
      content_type: input.contentType,
      idempotency_key: `receipt:${input.receiptId}:original`,
    });
  },
  async resizeAndStore(input, decision) {
    return infrai.image.resize({
      image: { base64: `data:${input.contentType};base64,${input.imageBase64}` },
      ...decision.resize,
      store: true,
      idempotency_key: `receipt:${input.receiptId}:preview`,
    });
  },
};

export async function ingestReceipt(value: unknown, services: ReceiptServices = liveReceiptServices) {
  const input = parseReceiptUpload(value);
  const decision = decideReceiptWorkflow(input);
  await services.ensureBucket();
  await services.putOriginal(input, decision.originalKey);
  const preview = await services.resizeAndStore(input, decision);
  return {
    receipt: { id: input.receiptId, donorId: input.donorId, originalKey: decision.originalKey, state: "stored" as const },
    preview,
    volunteerReminder: decision.reminder,
    campaignReport: decision.campaignDelta,
  };
}
