import assert from "node:assert/strict";
import test from "node:test";
import { agentRuntimeEnvSchema, webhookEnvSchema } from "../src/config/env.js";

const requiredRuntimeEnv = {
  SPEC2PROOF_ALLOWED_HOSTS: "staging.example.com, API-STAGING.EXAMPLE.COM ",
};

test("agent runtime environment applies boolean defaults", () => {
  const env = agentRuntimeEnvSchema.parse(requiredRuntimeEnv);

  assert.equal(env.SPEC2PROOF_ALLOW_HTTP, false);
  assert.equal(env.SPEC2PROOF_ALLOW_PRIVATE_HOSTS, false);
  assert.equal(env.SPEC2PROOF_BROWSER_HEADLESS, true);
  assert.deepEqual(env.SPEC2PROOF_ALLOWED_HOSTS, [
    "staging.example.com",
    "api-staging.example.com",
  ]);
});

test("agent runtime environment parses explicit boolean strings", () => {
  const env = agentRuntimeEnvSchema.parse({
    ...requiredRuntimeEnv,
    SPEC2PROOF_ALLOW_HTTP: "true",
    SPEC2PROOF_ALLOW_PRIVATE_HOSTS: "true",
    SPEC2PROOF_BROWSER_HEADLESS: "false",
  });

  assert.equal(env.SPEC2PROOF_ALLOW_HTTP, true);
  assert.equal(env.SPEC2PROOF_ALLOW_PRIVATE_HOSTS, true);
  assert.equal(env.SPEC2PROOF_BROWSER_HEADLESS, false);
});

test("webhook environment normalizes escaped PEM newlines and URLs", () => {
  const env = webhookEnvSchema.parse({
    GITHUB_WEBHOOK_SECRET: "0123456789abcdef",
    GITHUB_APP_ID: "1234",
    GITHUB_PRIVATE_KEY: "-----BEGIN PRIVATE KEY-----\\n01234567890123456789012345678901\\n-----END PRIVATE KEY-----",
    GITHUB_API_URL: "https://api.github.com/",
  });

  assert.equal(env.GITHUB_APP_ID, 1234);
  assert.match(env.GITHUB_PRIVATE_KEY, /\n/u);
  assert.equal(env.GITHUB_API_URL, "https://api.github.com");
  assert.equal(env.SPEC2PROOF_AGENT_RUNTIME_URL, "http://127.0.0.1:8080/invocations");
});
