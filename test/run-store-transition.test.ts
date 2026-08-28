import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryRunStore } from "../src/adapters/memory.js";
import type { AcceptanceRun } from "../src/domain/model.js";

const running: AcceptanceRun = {
  runId: "run-001",
  repository: "pxf77/Spec2Proof",
  pullRequestNumber: 1,
  headSha: "abcdef1234567890",
  targetEnvironment: "staging",
  lifecycle: "RUNNING",
  coverageComplete: false,
  criteria: [],
  plan: {
    runId: "run-001",
    repository: "pxf77/Spec2Proof",
    pullRequestNumber: 1,
    headSha: "abcdef1234567890",
    targetEnvironment: "staging",
    criteria: [],
    estimatedToolCalls: 0,
    estimatedDurationSeconds: 0,
    risks: [],
  },
  results: [],
  createdAt: "2026-08-26T00:00:00.000Z",
  startedAt: "2026-08-26T00:00:01.000Z",
};

test("rejects a stale lifecycle write after cancellation wins", async () => {
  const store = new InMemoryRunStore();
  await store.save(running);

  const cancelled: AcceptanceRun = {
    ...running,
    lifecycle: "COMPLETED",
    verdict: "CANCELLED",
    completedAt: "2026-08-26T00:00:02.000Z",
  };
  assert.equal(await store.saveIfLifecycle(cancelled, "RUNNING"), true);

  const staleCompletion: AcceptanceRun = {
    ...running,
    lifecycle: "COMPLETED",
    verdict: "PASS",
    coverageComplete: true,
    completedAt: "2026-08-26T00:00:03.000Z",
  };
  assert.equal(await store.saveIfLifecycle(staleCompletion, "RUNNING"), false);
  assert.equal((await store.get(running.runId))?.verdict, "CANCELLED");
});
