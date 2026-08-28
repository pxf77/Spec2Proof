import assert from "node:assert/strict";
import test from "node:test";
import { RunService } from "../src/application/run-service.js";
import { InMemoryRunStore } from "../src/adapters/memory.js";
import { DeterministicPlanGenerator, ScriptedRunExecutor } from "../src/adapters/local.js";


test("does not persist pull request patches in the run item", async () => {
  const service = new RunService({
    planGenerator: new DeterministicPlanGenerator(),
    executor: new ScriptedRunExecutor(),
    store: new InMemoryRunStore(),
    publisher: {
      planReady: async () => undefined,
      runStarted: async () => undefined,
      runCompleted: async () => undefined,
    },
    clock: { now: () => new Date("2026-08-26T00:00:00.000Z") },
    ids: { next: () => "run-001" },
  });

  const prepared = await service.prepareRun({
    repository: "pxf77/Spec2Proof",
    pullRequestNumber: 1,
    headSha: "abcdef1234567890",
    targetEnvironment: "staging",
    pullRequestContext: {
      title: "Demo",
      author: "pxf77",
      baseRef: "main",
      headRef: "feature",
      htmlUrl: "https://github.com/pxf77/Spec2Proof/pull/1",
      changedFilesTruncated: false,
      changedFiles: [
        {
          path: "src/demo.ts",
          status: "modified",
          additions: 10,
          deletions: 2,
          patch: "x".repeat(20_000),
          patchTruncated: true,
        },
      ],
    },
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
  });

  assert.equal(prepared.pullRequestContext?.changedFiles[0]?.patch, undefined);
  assert.equal(prepared.pullRequestContext?.changedFiles[0]?.patchTruncated, true);
});
