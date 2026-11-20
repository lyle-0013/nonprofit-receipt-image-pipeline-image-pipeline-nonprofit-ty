import { createServer, type ServerResponse } from "node:http";
import { ZodError } from "zod";
import { InfraiError } from "./infrai.ts";
import { ingestReceipt } from "./nonprofit_image_pipeline.ts";

const PORT = Number(process.env.PORT ?? 3000);
const MAX_BODY_BYTES = 12 * 1024 * 1024;

function send(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}

createServer(async (request, response) => {
  if (request.method !== "POST" || request.url !== "/donor-receipts") {
    send(response, 404, { error: "Route not found" });
    return;
  }

  try {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of request) {
      const buffer = Buffer.from(chunk);
      size += buffer.length;
      if (size > MAX_BODY_BYTES) {
        send(response, 413, { error: "Receipt image is too large" });
        return;
      }
      chunks.push(buffer);
    }
    const body: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    send(response, 201, await ingestReceipt(body));
  } catch (error) {
    if (error instanceof ZodError) {
      send(response, 400, { error: "Invalid receipt", issues: error.issues });
      return;
    }
    if (error instanceof InfraiError) {
      const status = error.status >= 400 && error.status < 500 ? error.status : 502;
      send(response, status, { error: error.code, details: error.details });
      return;
    }
    send(response, 500, { error: "Receipt ingestion failed" });
  }
}).listen(PORT, () => {
  console.log(`Receipt intake listening on http://localhost:${PORT}`);
});
