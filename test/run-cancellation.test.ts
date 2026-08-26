import assert from "node:assert/strict";
import test from "node:test";
import { RunService } from "../src/application/run-service.js";
import type { RunExecutor, RunPublisher } from "../src/application/ports.js";
import { InMemoryRunStore } from "../src/adapters/memory.js";
import { DeterministicPlanGenerator } from "../src/adapters/local.js";
import type { AcceptanceRun, CriterionResult } from "../src/domain/model.js";

class ControlledExecutor implements RunExecutor {
  private start!: () => void;
  private fail!: (error: Error) => void;
  public readonly started = new Promise<void>((resolve) => {
    this.start = resolve;
  });
  private readonly result = new Promise<CriterionResult[]>((_resolve, reject) => {
    this.fail = reject;
  });

  public async execute(): Promise<CriterionResult[]> {
    this.start();
    return this.result;
  }

  public async cancel(): Promise<void> {
    this.fail(new Error("cancelled"));
  }
}

class RecordingPublisher implements RunPublisher {
  public readonly completed: AcceptanceRun[] = [];
  public async planReady(): Promise<void> {}
  public async runStarted(): Promise<void> {}
  public async runCompleted(run: AcceptanceRun): Promise<void> {
    this.completed.push(structuredClone(run));
  }
}

test("cancellation remains terminal while an execution request unwinds", async () => {
  const executor = new ControlledExecutor();
  const publisher = new RecordingPublisher();
  const store = new InMemoryRunStore();
  const service = new RunService({
    planGenerator: new DeterministicPlanGenerator(),
    executor,
    store,
    publisher,
    clock: { now: () => new Date("2026-08-26T12:00:00.000Z") },
    ids: { next: () => "run-001" },
  });

  const prepared = await service.prepareRun({
    repository: "pxf77/Spec2Proof",
    pullRequestNumber: 7,
    headSha: "abcdef1234567890",
    targetEnvironment: "staging",
    targetBaseUrl: "https://staging.example.com",
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
  });
  await service.approveRun(prepared.runId, "reviewer", prepared.headSha);

  const execution = service.executeRun(prepared.runId);
  await executor.started;
  const cancelled = await service.cancelRun(prepared.runId, "superseded");
  const executionResult = await execution;

  assert.equal(cancelled.verdict, "CANCELLED");
  assert.equal(executionResult.verdict, "CANCELLED");
  assert.equal((await store.get(prepared.runId))?.verdict, "CANCELLED");
  assert.equal(publisher.completed.length, 1);
});
