import assert from "node:assert/strict";
import test from "node:test";
import { AgentRuntimeRunExecutor } from "../src/adapters/agent-runtime-client.js";
import type { AcceptanceRun } from "../src/domain/model.js";

test("invokes the AgentCore-compatible runtime and validates the run binding", async () => {
  const run = sampleRunningRun();
  const fetchStub = (async (input: string | URL | Request, init?: RequestInit) => {
    assert.equal(String(input), "http://runtime.test/invocations");
    assert.equal(
      new Headers(init?.headers).get("x-amzn-bedrock-agentcore-runtime-session-id"),
      run.runId,
    );
    const request = JSON.parse(String(init?.body)) as { run: AcceptanceRun };
    assert.equal(request.run.headSha, run.headSha);

    return new Response(
      JSON.stringify({
        runId: run.runId,
        runtimeSessionId: run.runId,
        results: [
          {
            criterionId: "AC-001",
            status: "PASS",
            expected: { type: "text", value: "Dashboard" },
            actual: "Dashboard",
            evidenceIds: ["evidence-1"],
            startedAt: "2026-08-26T12:01:00.000Z",
            completedAt: "2026-08-26T12:02:00.000Z",
          },
        ],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as typeof globalThis.fetch;

  const executor = new AgentRuntimeRunExecutor({
    endpoint: "http://runtime.test/invocations",
    timeoutMs: 5_000,
    fetch: fetchStub,
  });
  const results = await executor.execute(run);

  assert.equal(results.length, 1);
  assert.equal(results[0]?.status, "PASS");
});

function sampleRunningRun(): AcceptanceRun {
  return {
    runId: "run-001",
    installationId: 42,
    repository: "pxf77/Spec2Proof",
    pullRequestNumber: 7,
    headSha: "abcdef1234567890",
    targetEnvironment: "staging",
    lifecycle: "RUNNING",
    coverageComplete: false,
    criteria: [
      {
        id: "AC-001",
        sourceRef: "PR#7:spec2proof/AC-001",
        description: "Dashboard is visible",
        preconditions: [],
        expectedOutcomes: [{ type: "text", value: "Dashboard" }],
        automationClass: "AUTO",
      },
    ],
    plan: {
      runId: "run-001",
      repository: "pxf77/Spec2Proof",
      pullRequestNumber: 7,
      headSha: "abcdef1234567890",
      targetEnvironment: "staging",
      criteria: [
        {
          criterionId: "AC-001",
          setupSteps: [],
          executionSteps: [],
          assertions: [
            {
              id: "AC-001-ASSERT-1",
              criterionId: "AC-001",
              kind: "text",
              expected: { type: "text", value: "Dashboard" },
            },
          ],
          requiredEvidence: ["assertion"],
          riskLevel: "LOW",
        },
      ],
      estimatedToolCalls: 1,
      estimatedDurationSeconds: 30,
      risks: [],
    },
    results: [],
    approvedBy: "reviewer",
    approvedAt: "2026-08-26T12:00:30.000Z",
    createdAt: "2026-08-26T12:00:00.000Z",
    startedAt: "2026-08-26T12:00:30.000Z",
  };
}
