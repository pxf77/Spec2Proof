import assert from "node:assert/strict";
import test from "node:test";
import { RunService } from "../src/application/run-service.js";
import { InMemoryRunStore } from "../src/adapters/memory.js";
import { DeterministicPlanGenerator, ScriptedRunExecutor } from "../src/adapters/local.js";
import type { AcceptanceRun, ExecutionPlan, PrepareRunInput } from "../src/domain/model.js";
import type { PlanGenerator } from "../src/application/ports.js";

class FixedClock {
  public now(): Date {
    return new Date("2026-08-26T00:00:00.000Z");
  }
}

class FixedIds {
  public next(): string {
    return "run-001";
  }
}

class RecordingPublisher {
  public readonly events: string[] = [];
  public async planReady(_run: AcceptanceRun): Promise<void> {
    this.events.push("plan.ready");
  }
  public async runStarted(_run: AcceptanceRun): Promise<void> {
    this.events.push("run.started");
  }
  public async runCompleted(_run: AcceptanceRun): Promise<void> {
    this.events.push("run.completed");
  }
}

function createService(
  planGenerator: PlanGenerator = new DeterministicPlanGenerator(),
): { service: RunService; publisher: RecordingPublisher } {
  const publisher = new RecordingPublisher();
  return {
    publisher,
    service: new RunService({
      planGenerator,
      executor: new ScriptedRunExecutor(),
      store: new InMemoryRunStore(),
      publisher,
      clock: new FixedClock(),
      ids: new FixedIds(),
    }),
  };
}

test("runs through the two lifecycle boundaries", async () => {
  const { service, publisher } = createService();
  const prepared = await service.prepareRun({
    repository: "pxf77/Spec2Proof",
    pullRequestNumber: 1,
    headSha: "abcdef1234567890",
    targetEnvironment: "staging",
    criteria: [
      {
        id: "AC-001",
        sourceRef: "PR#1",
        description: "Dashboard is shown",
        preconditions: [],
        expectedOutcomes: [{ type: "text", value: "Dashboard" }],
        automationClass: "AUTO",
      },
    ],
  });
  assert.equal(prepared.lifecycle, "AWAITING_APPROVAL");

  const approved = await service.approveRun(prepared.runId, "reviewer", prepared.headSha);
  assert.equal(approved.lifecycle, "RUNNING");

  const completed = await service.executeRun(prepared.runId);
  assert.equal(completed.lifecycle, "COMPLETED");
  assert.equal(completed.verdict, "PASS");
  assert.deepEqual(publisher.events, ["plan.ready", "run.started", "run.completed"]);
});

test("rejects approval for a stale head SHA", async () => {
  const { service } = createService();
  const prepared = await service.prepareRun({
    repository: "pxf77/Spec2Proof",
    pullRequestNumber: 1,
    headSha: "abcdef1234567890",
    targetEnvironment: "staging",
    criteria: [
      {
        id: "AC-001",
        sourceRef: "PR#1",
        description: "Dashboard is shown",
        preconditions: [],
        expectedOutcomes: [{ type: "text", value: "Dashboard" }],
        automationClass: "AUTO",
      },
    ],
  });

  await assert.rejects(
    service.approveRun(prepared.runId, "reviewer", "different-sha"),
    /stale head/u,
  );
});

class WeakeningPlanGenerator implements PlanGenerator {
  public async generate(
    input: PrepareRunInput & { runId: string },
  ): Promise<ExecutionPlan> {
    const plan = await new DeterministicPlanGenerator().generate(input);
    const assertion = plan.criteria[0]?.assertions[0];
    if (assertion) {
      assertion.expected = { type: "text", value: "Dash", mode: "contains" };
    }
    return plan;
  }
}

test("rejects a generated plan that weakens an expected outcome", async () => {
  const { service } = createService(new WeakeningPlanGenerator());

  await assert.rejects(
    service.prepareRun({
      repository: "pxf77/Spec2Proof",
      pullRequestNumber: 1,
      headSha: "abcdef1234567890",
      targetEnvironment: "staging",
      criteria: [
        {
          id: "AC-001",
          sourceRef: "PR#1",
          description: "Dashboard is shown",
          preconditions: [],
          expectedOutcomes: [
            { type: "text", value: "Dashboard", mode: "contains" },
          ],
          automationClass: "AUTO",
        },
      ],
    }),
    /does not preserve an expected outcome/u,
  );
});

