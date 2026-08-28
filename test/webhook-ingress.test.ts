import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import {
  GitHubWebhookIngress,
  InMemoryDeliveryTracker,
  StaticWebhookSecretProvider,
  type WebhookQueue,
} from "../src/webhook/ingress.js";
import type { GitHubWebhookMessage } from "../src/webhook/message.js";

class RecordingQueue implements WebhookQueue {
  public readonly messages: GitHubWebhookMessage[] = [];

  public async enqueue(message: GitHubWebhookMessage): Promise<void> {
    this.messages.push(structuredClone(message));
  }
}

function signedRequest(secret: string, body: string, deliveryId = "delivery-1") {
  const payload = Buffer.from(body, "utf8");
  return {
    method: "POST",
    path: "/webhooks/github",
    body: payload,
    headers: {
      "x-hub-signature-256": `sha256=${createHmac("sha256", secret).update(payload).digest("hex")}`,
      "x-github-event": "issue_comment",
      "x-github-delivery": deliveryId,
    },
  };
}

test("accepts a signed webhook and queues it once", async () => {
  const secret = "a-long-webhook-secret";
  const queue = new RecordingQueue();
  const ingress = new GitHubWebhookIngress({
    secretProvider: new StaticWebhookSecretProvider(secret),
    deliveries: new InMemoryDeliveryTracker(),
    queue,
  });
  const request = signedRequest(secret, '{"action":"created"}');

  const first = await ingress.handle(request);
  const duplicate = await ingress.handle(request);

  assert.equal(first.statusCode, 202);
  assert.equal(first.body.duplicate, false);
  assert.equal(duplicate.statusCode, 202);
  assert.equal(duplicate.body.duplicate, true);
  assert.equal(queue.messages.length, 1);
});

test("rejects invalid signatures without queueing", async () => {
  const queue = new RecordingQueue();
  const ingress = new GitHubWebhookIngress({
    secretProvider: new StaticWebhookSecretProvider("correct-secret-value"),
    deliveries: new InMemoryDeliveryTracker(),
    queue,
  });

  const response = await ingress.handle(
    signedRequest("wrong-secret-value", '{"action":"created"}'),
  );

  assert.equal(response.statusCode, 401);
  assert.equal(queue.messages.length, 0);
});
