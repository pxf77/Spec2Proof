import assert from "node:assert/strict";
import test from "node:test";
import type { AcceptanceRun } from "../src/domain/model.js";
import { AgentCoreRunExecutor } from "../src/aws/agentcore-run-executor.js";

const run: AcceptanceRun = {
  runId: "run-00000000-0000-4000-8000-000000000001",
  repository: "pxf77/Spec2Proof",
  pullRequestNumber: 1,
  headSha: "abcdef1234567890",
  targetEnvironment: "staging",
  lifecycle: "RUNNING",
  coverageComplete: false,
  criteria: [
    {
      id: "AC-001",
      sourceRef: "PR#1",
      description: "Dashboard is visible",
      preconditions: [],
      expectedOutcomes: [{ type: "text", value: "Dashboard" }],
      automationClass: "AUTO",
    },
  ],
  plan: {
    runId: "run-00000000-0000-4000-8000-000000000001",
    repository: "pxf77/Spec2Proof",
    pullRequestNumber: 1,
    headSha: "abcdef1234567890",
    targetEnvironment: "staging",
    criteria: [],
    estimatedToolCalls: 1,
    estimatedDurationSeconds: 1,
    risks: [],
  },
  results: [],
  createdAt: "2026-08-26T00:00:00.000Z",
  startedAt: "2026-08-26T00:00:00.000Z",
};

test("parses a successful AgentCore Runtime response", async () => {
  const result = {
    runId: run.runId,
    runtimeSessionId: run.runId,
    results: [
      {
        criterionId: "AC-001",
        status: "PASS",
        expected: [{ type: "text", value: "Dashboard" }],
        actual: "Dashboard",
        evidenceIds: ["s3://bucket/evidence.json"],
        startedAt: "2026-08-26T00:00:00.000Z",
        completedAt: "2026-08-26T00:00:01.000Z",
      },
    ],
  };
  const client = {
    send: async () => ({
      response: {
        transformToString: async () => JSON.stringify(result),
      },
    }),
  };
  const executor = new AgentCoreRunExecutor({
    agentRuntimeArn: "arn:aws:bedrock-agentcore:us-west-2:123456789012:runtime/example",
    timeoutMs: 1_000,
    client: client as never,
  });

  const results = await executor.execute(run);
  assert.equal(results[0]?.status, "PASS");
});
