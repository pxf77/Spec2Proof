import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { pathToFileURL } from "node:url";
import { Agent, BedrockModel } from "@strands-agents/sdk";
import { RunService } from "../application/run-service.js";
import { AgentRuntimeRunExecutor } from "../adapters/agent-runtime-client.js";
import {
  InMemoryRunStore,
  RandomIdGenerator,
  SystemClock,
} from "../adapters/memory.js";
import { DirectRunExecutionScheduler } from "../adapters/run-execution-scheduler.js";
import { StrandsPlanGenerator } from "../agent/strands-plan-generator.js";
import { PLANNING_SYSTEM_PROMPT } from "../agent/system-prompt.js";
import { loadWebhookEnvironment } from "../config/env.js";
import {
  GitHubAppTokenProvider,
  GitHubClientFactory,
} from "../github/client.js";
import { GitHubWebhookDispatcher } from "../github/dispatcher.js";
import {
  GitHubPullRequestReader,
  GitHubReviewerAuthorizer,
} from "../github/pull-request.js";
import { GitHubRunPublisher } from "../github/publisher.js";
import { parseSpec2ProofCommand, verifyGitHubWebhookSignature } from "../github/webhook.js";
import { createLogger } from "../observability/logger.js";

const MAX_WEBHOOK_BYTES = 1_048_576;

export function startWebhookServer(): void {
  const environment = loadWebhookEnvironment();
  const logger = createLogger(environment.LOG_LEVEL);
  const tokenProvider = new GitHubAppTokenProvider({
    appId: environment.GITHUB_APP_ID,
    privateKey: environment.GITHUB_PRIVATE_KEY,
    apiBaseUrl: environment.GITHUB_API_URL,
  });
  const clients = new GitHubClientFactory(
    tokenProvider,
    environment.GITHUB_API_URL,
  );
  const publisher = new GitHubRunPublisher(clients);
  const planningModel = new BedrockModel({
    modelId: environment.SPEC2PROOF_MODEL_ID,
    region: environment.AWS_REGION,
    temperature: 0,
  });
  const planGenerator = new StrandsPlanGenerator(
    new Agent({
      model: planningModel,
      systemPrompt: PLANNING_SYSTEM_PROMPT,
      printer: false,
    }),
  );
  const runService = new RunService({
    planGenerator,
    executor: new AgentRuntimeRunExecutor({
      endpoint: environment.SPEC2PROOF_AGENT_RUNTIME_URL,
      timeoutMs: environment.SPEC2PROOF_AGENT_RUNTIME_TIMEOUT_SECONDS * 1_000,
    }),
    store: new InMemoryRunStore(),
    publisher,
    clock: new SystemClock(),
    ids: new RandomIdGenerator(),
  });
  const dispatcher = new GitHubWebhookDispatcher({
    runService,
    executionScheduler: new DirectRunExecutionScheduler(runService),
    pullRequests: new GitHubPullRequestReader(
      clients,
      environment.SPEC2PROOF_MAX_CHANGED_FILES,
      environment.SPEC2PROOF_MAX_PATCH_CHARS_PER_FILE,
    ),
    authorizer: new GitHubReviewerAuthorizer(clients),
    clients,
    logger,
  });
  const deliveries = new InMemoryDeliveryTracker();

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

      const event = headerValue(request, "x-github-event");
      const deliveryId = headerValue(request, "x-github-delivery");
      if (!event || !deliveryId) {
        respondJson(response, 400, { error: "missing_github_headers" });
        return;
      }

      const body = parseJsonPayload(payload);
      const commentBody = extractCommentBody(body);
      const command = commentBody ? parseSpec2ProofCommand(commentBody) : undefined;
      const firstDelivery = deliveries.claim(deliveryId);

      logger.info("github.webhook.accepted", {
        event,
        deliveryId,
        command: command?.name,
        duplicate: !firstDelivery,
      });
      respondJson(response, 202, {
        accepted: true,
        event,
        deliveryId,
        command,
        duplicate: !firstDelivery,
      });

      if (firstDelivery) {
        setImmediate(() => {
          void dispatcher.dispatch(event, body, deliveryId).catch((error: unknown) => {
            logger.error("github.webhook.dispatch_failed", {
              event,
              deliveryId,
              error: error instanceof Error ? error.message : "unknown_error",
            });
          });
        });
      }
    } catch (error) {
      logger.error("github.webhook.failed", {
        error: error instanceof Error ? error.message : "unknown_error",
      });
      const status = error instanceof PayloadTooLargeError ? 413 : 400;
      respondJson(response, status, {
        error: status === 413 ? "payload_too_large" : "invalid_payload",
      });
    }
  });

  server.listen(environment.WEBHOOK_PORT, "0.0.0.0", () => {
    logger.info("webhook.listening", { port: environment.WEBHOOK_PORT });
  });
}

export class InMemoryDeliveryTracker {
  private readonly deliveries = new Map<string, number>();

  public constructor(
    private readonly ttlMs = 24 * 60 * 60 * 1_000,
    private readonly now: () => number = Date.now,
  ) {}

  public claim(deliveryId: string): boolean {
    this.prune();
    if (this.deliveries.has(deliveryId)) {
      return false;
    }
    this.deliveries.set(deliveryId, this.now());
    return true;
  }

  private prune(): void {
    const threshold = this.now() - this.ttlMs;
    for (const [deliveryId, timestamp] of this.deliveries) {
      if (timestamp < threshold) {
        this.deliveries.delete(deliveryId);
      }
    }
  }
}

async function readBody(request: IncomingMessage, limit: number): Promise<Uint8Array> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > limit) {
      throw new PayloadTooLargeError();
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

function headerValue(request: IncomingMessage, name: string): string | undefined {
  const value = request.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

function parseJsonPayload(payload: Uint8Array): Record<string, unknown> {
  const parsed = JSON.parse(Buffer.from(payload).toString("utf8")) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Webhook payload must be a JSON object");
  }
  return parsed as Record<string, unknown>;
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
  if (response.headersSent) {
    return;
  }
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

class PayloadTooLargeError extends Error {}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startWebhookServer();
}
