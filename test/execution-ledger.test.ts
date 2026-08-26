import assert from "node:assert/strict";
import test from "node:test";
import { ApprovedExecutionLedger } from "../src/agent/execution-ledger.js";
import type { AcceptanceRun } from "../src/domain/model.js";

function createRun(): AcceptanceRun {
  return {
    runId: "run-001",
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
        description: "Dashboard is shown",
        preconditions: [],
        expectedOutcomes: [{ type: "text", value: "Dashboard", mode: "contains" }],
        automationClass: "AUTO",
      },
    ],
    plan: {
      runId: "run-001",
      repository: "pxf77/Spec2Proof",
      pullRequestNumber: 1,
      headSha: "abcdef1234567890",
      targetEnvironment: "staging",
      criteria: [
        {
          criterionId: "AC-001",
          setupSteps: [],
          executionSteps: [
            {
              id: "AC-001-STEP-1",
              criterionId: "AC-001",
              description: "Open dashboard",
              action: "navigate",
              riskLevel: "LOW",
            },
          ],
          assertions: [
            {
              id: "AC-001-ASSERT-1",
              criterionId: "AC-001",
              kind: "text",
              expected: { type: "text", value: "Dashboard", mode: "contains" },
            },
          ],
          requiredEvidence: ["assertion"],
          riskLevel: "LOW",
        },
      ],
      estimatedToolCalls: 4,
      estimatedDurationSeconds: 30,
      risks: [],
    },
    results: [],
    approvedBy: "reviewer",
    approvedAt: "2026-08-26T00:00:00.000Z",
    createdAt: "2026-08-25T23:59:00.000Z",
    startedAt: "2026-08-26T00:00:00.000Z",
  };
}

test("enforces approved step and browser-session attribution", () => {
  const ledger = new ApprovedExecutionLedger(createRun());
  ledger.bindSession("AC-001", "AC-001-STEP-1", "browser-1");
  assert.doesNotThrow(() =>
    ledger.requireSession("AC-001", "AC-001-STEP-1", "browser-1"),
  );
  assert.throws(
    () => ledger.requireStep("AC-001", "invented-step"),
    /not approved/u,
  );
});

test("derives PASS from every approved evidenced assertion", () => {
  const ledger = new ApprovedExecutionLedger(createRun());
  ledger.recordAssertion({
    assertionId: "AC-001-ASSERT-1",
    criterionId: "AC-001",
    kind: "text",
    passed: true,
    expected: { type: "text", value: "Dashboard", mode: "contains" },
    actual: "Dashboard overview",
    evidenceId: "evidence-1",
  });

  const result = ledger.buildCriterionResult({
    criterionId: "AC-001",
    status: "PASS",
    completedAt: "2026-08-26T00:00:01.000Z",
  });

  assert.equal(result.status, "PASS");
  assert.deepEqual(result.evidenceIds, ["evidence-1"]);
});

test("refuses PASS before deterministic assertions complete", () => {
  const ledger = new ApprovedExecutionLedger(createRun());
  assert.throws(
    () => ledger.buildCriterionResult({ criterionId: "AC-001", status: "PASS" }),
    /before every approved assertion executes/u,
  );
});

test("requires every evidence type approved by the plan before PASS", () => {
  const run = createRun();
  run.plan.criteria[0]!.requiredEvidence = ["assertion", "screenshot"];
  const ledger = new ApprovedExecutionLedger(run);
  ledger.recordAssertion({
    assertionId: "AC-001-ASSERT-1",
    criterionId: "AC-001",
    kind: "text",
    passed: true,
    expected: { type: "text", value: "Dashboard", mode: "contains" },
    actual: "Dashboard overview",
    evidenceId: "assertion-evidence",
  });

  assert.throws(
    () => ledger.buildCriterionResult({ criterionId: "AC-001", status: "PASS" }),
    /required evidence: screenshot/u,
  );

  ledger.recordEvidence("AC-001", "screenshot-evidence", "screenshot");
  const result = ledger.buildCriterionResult({ criterionId: "AC-001", status: "PASS" });
  assert.deepEqual(result.evidenceIds, ["assertion-evidence", "screenshot-evidence"]);
});

test("rejects assertion evidence that weakens the approved expected value", () => {
  const ledger = new ApprovedExecutionLedger(createRun());
  assert.throws(
    () =>
      ledger.recordAssertion({
        assertionId: "AC-001-ASSERT-1",
        criterionId: "AC-001",
        kind: "text",
        passed: true,
        expected: "Dashboard",
        actual: "Dashboard overview",
        evidenceId: "evidence-weak",
      }),
    /does not preserve its approved expected value/u,
  );
});

test("a failed assertion can only produce an evidenced FAIL", () => {
  const ledger = new ApprovedExecutionLedger(createRun());
  ledger.recordAssertion({
    assertionId: "AC-001-ASSERT-1",
    criterionId: "AC-001",
    kind: "text",
    passed: false,
    expected: { type: "text", value: "Dashboard", mode: "contains" },
    actual: "Internal Server Error",
    evidenceId: "evidence-2",
  });

  assert.throws(
    () => ledger.buildCriterionResult({ criterionId: "AC-001", status: "PASS" }),
    /must be reported as FAIL/u,
  );
  assert.throws(
    () =>
      ledger.buildCriterionResult({
        criterionId: "AC-001",
        status: "NEEDS_HUMAN",
        explanation: "Hide the deterministic failure",
      }),
    /must be reported as FAIL/u,
  );
  assert.throws(
    () =>
      ledger.buildCriterionResult({
        criterionId: "AC-001",
        status: "BLOCKED",
        failureCategory: "TOOL",
      }),
    /must be reported as FAIL/u,
  );
  const failed = ledger.buildCriterionResult({
    criterionId: "AC-001",
    status: "FAIL",
  });
  assert.equal(failed.failureCategory, "PRODUCT");
  assert.deepEqual(failed.evidenceIds, ["evidence-2"]);
});
