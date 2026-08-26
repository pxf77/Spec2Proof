import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import {
  parseSpec2ProofCommand,
  verifyGitHubWebhookSignature,
} from "../src/github/webhook.js";

test("parses a run command from a multi-line comment", () => {
  assert.deepEqual(parseSpec2ProofCommand("Please verify this.\n/spec2proof run"), { name: "run" });
});

test("requires a reason when rejecting", () => {
  assert.equal(parseSpec2ProofCommand("/spec2proof reject"), undefined);
  assert.deepEqual(parseSpec2ProofCommand("/spec2proof reject unsafe target"), {
    name: "reject",
    reason: "unsafe target",
  });
});

test("verifies the GitHub webhook HMAC signature", () => {
  const payload = Buffer.from('{"action":"created"}', "utf8");
  const secret = "test-webhook-secret";
  const signature = `sha256=${createHmac("sha256", secret).update(payload).digest("hex")}`;

  assert.equal(verifyGitHubWebhookSignature(payload, signature, secret), true);
  assert.equal(verifyGitHubWebhookSignature(payload, signature, "wrong-secret"), false);
});

test("rejects malformed GitHub webhook signatures", () => {
  const payload = Buffer.from("{}", "utf8");

  assert.equal(verifyGitHubWebhookSignature(payload, undefined, "secret"), false);
  assert.equal(verifyGitHubWebhookSignature(payload, "sha256=not-hex", "secret"), false);
});

