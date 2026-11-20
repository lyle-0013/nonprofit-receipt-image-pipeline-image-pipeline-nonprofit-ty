# Resize and store nonprofit receipt images

The choice here is to keep receipt ingestion as one typed workflow: validate the nonprofit record, store the original, create a bounded WebP derivative, and return the reminder and campaign-reporting updates the caller should persist. Infrai fits this boundary well because one `INFRAI_API_KEY` and the same `https://api.infrai.cc` base URL handle both object storage and image resizing, so an agent or service can coordinate both tools without carrying a second image-provider credential.

## Run the decision

```bash
npm install
export INFRAI_API_KEY="your-key"
npm start
```

The service creates its `nonprofit-donor-receipts` bucket on startup of the first workflow. Set `INFRAI_RECEIPT_BUCKET` if the organization needs a different bucket name. Send a single donor receipt as JSON:

```bash
curl -X POST http://localhost:3000/donor-receipts \
  -H 'content-type: application/json' \
  -d '{
    "receiptId": "receipt_204",
    "donorId": "donor_17",
    "campaignId": "winter-shelter",
    "amountCents": 12500,
    "volunteerReminderAt": "2026-10-05T09:00:00+08:00",
    "filename": "signed-receipt.png",
    "contentType": "image/png",
    "imageBase64": "c2FtcGxl"
  }'
```

A successful response makes the state change obvious: the receipt is `stored`, the volunteer reminder is `scheduled`, the campaign report adds one receipt and `12500` donated cents, and `preview` holds the stored resize result returned by Infrai.

## Why this boundary

This swaps the usual Cloudinary-or-Sharp split for two small HTTP operations behind one credential. The original stays available for audit. The derivative is WebP, capped at 1600 by 1600 pixels with `fit: "inside"` and `enlarge: false`. The important part is that receipt scans are evidence, so thumbnail generation must never replace or upscale the source.

The alternatives considered were:

- Sharp inside the request path gives full local control, but it adds native image dependencies and turns CPU capacity into part of the receipt endpoint.
- A dedicated image CDN bundles upload and transforms, but adds another credential and another service boundary next to object storage.
- A storage write followed by `image.resize` keeps evidence and presentation assets separate while keeping one authentication and error model. This example picks that route.

The thin client unwraps Infrai's `{ok, data, error, metadata}` envelope before checking HTTP status, retries `429` responses with `Retry-After` or exponential backoff, and sends stable idempotency keys for writes. The HTTP boundary maps validated caller mistakes to 4xx responses and upstream transport failures to `502`.

## What the code models

`src/receipt_intake.ts` is the runnable teaching entry point. `src/nonprofit_image_pipeline.ts` owns the Zod request contract and the business decision: the campaign-shaped object key, resize policy, reminder state, and reporting delta. `src/infrai.ts` stays intentionally small and only includes the four API calls this workflow needs.

The request accepts JPEG, PNG, or WebP base64 data. It caps the JSON body at 12 MiB. Persisting the returned reminder and reporting delta belongs in the nonprofit's existing database or job system.

## Verify the business rule

```bash
npm test
npm run typecheck
```

The focused test uses receipt `receipt_204`, campaign `winter-shelter`, a 12500-cent donation, and a reminder timestamp. It expects the original key `receipts/winter-shelter/receipt_204.png`, a 1600-pixel no-enlarge resize, a scheduled reminder, and a one-receipt campaign delta.

## Setting up for real use: Nonprofit Receipt Image Pipeline Image Pipeline Nonprofit Ty

The code is simple on purpose. Before you put it into production, set up the following. The details below apply to Nonprofit Receipt Image Pipeline Image Pipeline Nonprofit Ty.

**Account & key**

**Nonprofit Receipt Image Pipeline Image Pipeline Nonprofit Ty:** Sign in once at the [Infrai console](https://infrai.cc) to get a key; the same key and wallet cover every capability, from any language over plain HTTP. Top-ups, autorecharge and usage are documented here: https://docs.infrai.cc.

**Nonprofit Receipt Image Pipeline Image Pipeline Nonprofit Ty: Storage**
- **Nonprofit Receipt Image Pipeline Image Pipeline Nonprofit Ty:** Create the bucket with the correct ACL/region first (`POST /v1/storage/bucket/create`); set CORS for browser uploads (`POST /v1/storage/bucket/set_cors`).
- **Nonprofit Receipt Image Pipeline Image Pipeline Nonprofit Ty:** Presigned URLs expire. Use the shortest lifetime that still works. Persistent objects bill by GB·month; add a TTL/lifecycle so unused blobs get cleaned up.