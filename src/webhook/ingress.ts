import { verifyGitHubWebhookSignature } from "../github/webhook.js";
import type { GitHubWebhookMessage } from "./message.js";

export const MAX_WEBHOOK_BYTES = 1_048_576;

export interface WebhookSecretProvider {
  getWebhookSecret(): Promise<string>;
}

export interface DeliveryTracker {
  claim(deliveryId: string): Promise<boolean>;
  release?(deliveryId: string): Promise<void>;
}

export interface WebhookQueue {
  enqueue(message: GitHubWebhookMessage): Promise<void>;
}

export interface WebhookIngressRequest {
  method: string;
  path: string;
  headers: Readonly<Record<string, string | undefined>>;
  body: Uint8Array;
}

export interface WebhookIngressResponse {
  statusCode: number;
  body: Record<string, unknown>;
}

export class GitHubWebhookIngress {
  public constructor(
    private readonly dependencies: {
      secretProvider: WebhookSecretProvider;
      deliveries: DeliveryTracker;
      queue: WebhookQueue;
      maxBytes?: number;
    },
  ) {}

  public async handle(request: WebhookIngressRequest): Promise<WebhookIngressResponse> {
    if (request.method === "GET" && request.path === "/healthz") {
      return { statusCode: 200, body: { status: "ok" } };
    }
    if (request.method !== "POST" || request.path !== "/webhooks/github") {
      return { statusCode: 404, body: { error: "not_found" } };
    }
    if (request.body.byteLength > (this.dependencies.maxBytes ?? MAX_WEBHOOK_BYTES)) {
      return { statusCode: 413, body: { error: "payload_too_large" } };
    }

    const signature = header(request.headers, "x-hub-signature-256");
    const webhookSecret = await this.dependencies.secretProvider.getWebhookSecret();
    if (!verifyGitHubWebhookSignature(request.body, signature, webhookSecret)) {
      return { statusCode: 401, body: { error: "invalid_signature" } };
    }

    const eventName = header(request.headers, "x-github-event");
    const deliveryId = header(request.headers, "x-github-delivery");
    if (!eventName || !deliveryId) {
      return { statusCode: 400, body: { error: "missing_github_headers" } };
    }

    let payload: Record<string, unknown>;
    try {
      payload = parseJsonObject(request.body);
    } catch {
      return { statusCode: 400, body: { error: "invalid_payload" } };
    }

    const firstDelivery = await this.dependencies.deliveries.claim(deliveryId);
    if (firstDelivery) {
      try {
        await this.dependencies.queue.enqueue({ eventName, deliveryId, payload });
      } catch (error) {
        await this.dependencies.deliveries.release?.(deliveryId);
        throw error;
      }
    }

    return {
      statusCode: 202,
      body: {
        accepted: true,
        event: eventName,
        deliveryId,
        duplicate: !firstDelivery,
      },
    };
  }
}

export class StaticWebhookSecretProvider implements WebhookSecretProvider {
  public constructor(private readonly secret: string) {}

  public async getWebhookSecret(): Promise<string> {
    return this.secret;
  }
}

export class InMemoryDeliveryTracker implements DeliveryTracker {
  private readonly deliveries = new Map<string, number>();

  public constructor(
    private readonly ttlMs = 24 * 60 * 60 * 1_000,
    private readonly now: () => number = Date.now,
  ) {}

  public async claim(deliveryId: string): Promise<boolean> {
    this.prune();
    if (this.deliveries.has(deliveryId)) {
      return false;
    }
    this.deliveries.set(deliveryId, this.now());
    return true;
  }

  public async release(deliveryId: string): Promise<void> {
    this.deliveries.delete(deliveryId);
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

export class InProcessWebhookQueue implements WebhookQueue {
  public constructor(
    private readonly dispatch: (message: GitHubWebhookMessage) => Promise<void>,
  ) {}

  public async enqueue(message: GitHubWebhookMessage): Promise<void> {
    setImmediate(() => {
      void this.dispatch(message);
    });
  }
}

function header(
  headers: Readonly<Record<string, string | undefined>>,
  name: string,
): string | undefined {
  const expected = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === expected) {
      return value;
    }
  }
  return undefined;
}

function parseJsonObject(payload: Uint8Array): Record<string, unknown> {
  const parsed = JSON.parse(Buffer.from(payload).toString("utf8")) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Webhook payload must be a JSON object");
  }
  return parsed as Record<string, unknown>;
}
