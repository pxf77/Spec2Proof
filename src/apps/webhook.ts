import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { pathToFileURL } from "node:url";
import { loadWebhookEnvironment } from "../config/env.js";
import { parseSpec2ProofCommand, verifyGitHubWebhookSignature } from "../github/webhook.js";
import { createLogger } from "../observability/logger.js";

const MAX_WEBHOOK_BYTES = 1_048_576;

export function startWebhookServer(): void {
  const environment = loadWebhookEnvironment();
  const logger = createLogger(environment.LOG_LEVEL);

  const server = createServer(async (request, response) => {
    try {
      if (request.method === "GET" && request.url === "/healthz") {
        respondJson(response, 200, { status: "ok" });
        return;
      }

      if (request.method !== "POST" || request.url !== "/webhooks/github") {
        respondJson(response, 404, { error: "not_found" });
        return;
      }

      const payload = await readBody(request, MAX_WEBHOOK_BYTES);
      const signature = headerValue(request, "x-hub-signature-256");
      if (!verifyGitHubWebhookSignature(payload, signature, environment.GITHUB_WEBHOOK_SECRET)) {
        respondJson(response, 401, { error: "invalid_signature" });
        return;
      }

      const event = headerValue(request, "x-github-event") ?? "unknown";
      const deliveryId = headerValue(request, "x-github-delivery") ?? "unknown";
      const body = JSON.parse(Buffer.from(payload).toString("utf8")) as Record<string, unknown>;
      const commentBody = extractCommentBody(body);
      const command = commentBody ? parseSpec2ProofCommand(commentBody) : undefined;

      logger.info("github.webhook.accepted", {
        event,
        deliveryId,
        command: command?.name,
      });

      // The initial scaffold deliberately stops at the authenticated ingress boundary.
      // A GitHub installation-token adapter and queue dispatcher are the next integration slice.
      respondJson(response, 202, { accepted: true, event, deliveryId, command });
    } catch (error) {
      logger.error("github.webhook.failed", {
        error: error instanceof Error ? error.message : "unknown_error",
      });
      respondJson(response, 500, { error: "internal_error" });
    }
  });

  server.listen(environment.WEBHOOK_PORT, "0.0.0.0", () => {
    logger.info("webhook.listening", { port: environment.WEBHOOK_PORT });
  });
}

async function readBody(request: IncomingMessage, limit: number): Promise<Uint8Array> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > limit) {
      throw new Error("Webhook payload exceeds size limit");
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

function headerValue(request: IncomingMessage, name: string): string | undefined {
  const value = request.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

function extractCommentBody(payload: Record<string, unknown>): string | undefined {
  const comment = payload.comment;
  if (!comment || typeof comment !== "object") {
    return undefined;
  }
  const body = (comment as Record<string, unknown>).body;
  return typeof body === "string" ? body : undefined;
}

function respondJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startWebhookServer();
}
