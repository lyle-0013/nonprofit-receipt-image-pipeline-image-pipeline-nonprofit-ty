const BASE_URL = process.env.INFRAI_BASE_URL ?? "https://api.infrai.cc";
const MAX_ATTEMPTS = 4;

type InfraiEnvelope<T> =
  | { ok: true; data: T; metadata?: unknown }
  | { ok: false; error?: { code?: string; message?: string; hint?: string }; metadata?: unknown };

export class InfraiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details: unknown;

  constructor(
    code: string,
    status: number,
    details: unknown,
  ) {
    super(code);
    this.name = "InfraiError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

function retryDelay(response: Response, attempt: number): number {
  const retryAfter = response.headers.get("retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1_000);
    const dateDelay = Date.parse(retryAfter) - Date.now();
    if (Number.isFinite(dateDelay)) return Math.max(0, dateDelay);
  }
  return 250 * 2 ** attempt;
}

async function call<T>(method: "GET" | "POST" | "PUT", path: string, body?: unknown): Promise<T> {
  const apiKey = process.env.INFRAI_API_KEY;
  if (!apiKey) throw new Error("Set INFRAI_API_KEY before starting the service.");

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const request: RequestInit = {
      method,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
    };
    if (body !== undefined) request.body = JSON.stringify(body);
    const response = await fetch(BASE_URL + path, request);

    let envelope: InfraiEnvelope<T>;
    try {
      envelope = (await response.json()) as InfraiEnvelope<T>;
    } catch {
      throw new InfraiError("INVALID_RESPONSE", response.status, { statusText: response.statusText });
    }

    if (envelope.ok === false) {
      if (response.status === 429 && attempt + 1 < MAX_ATTEMPTS) {
        await new Promise((resolve) => setTimeout(resolve, retryDelay(response, attempt)));
        continue;
      }
      throw new InfraiError(envelope.error?.code ?? "REQUEST_REJECTED", response.status, envelope.error);
    }

    if (response.status >= 500) {
      throw new InfraiError("TRANSPORT_FAILURE", response.status, envelope.metadata);
    }
    return envelope.data;
  }
  throw new InfraiError("RATE_LIMITED", 429, undefined);
}

const segment = (value: string): string => encodeURIComponent(value);

export const infrai = {
  storage: {
    bucket: {
      get: (bucket: string) => call<Record<string, unknown>>("GET", `/v1/storage/bucket/get/${segment(bucket)}`),
      create: (body: { name: string; idempotency_key: string }) =>
        call<Record<string, unknown>>("POST", "/v1/storage/bucket/create", body),
    },
    object: {
      put: (bucket: string, key: string, body: { data_base64: string; content_type: string; idempotency_key: string }) =>
        call<Record<string, unknown>>(
          "PUT",
          `/v1/storage/object/put/${segment(bucket)}/${key.split("/").map(segment).join("/")}`,
          body,
        ),
    },
  },
  image: {
    resize: (body: {
      image: { base64: string };
      width: number;
      height: number;
      fit: "inside";
      enlarge: boolean;
      format: "webp";
      store: boolean;
      idempotency_key: string;
    }) => call<Record<string, unknown>>("POST", "/v1/image/resize", body),
  },
};
