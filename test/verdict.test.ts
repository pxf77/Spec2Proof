import assert from "node:assert/strict";
import test from "node:test";
import type { AcceptanceCriterion, CriterionResult } from "../src/domain/model.js";
import { summarizeRun } from "../src/domain/verdict.js";

const criteria: AcceptanceCriterion[] = [
  {
    id: "AC-001",
    sourceRef: "PR#1",
    description: "First criterion",
    preconditions: [],
    expectedOutcomes: [{ type: "text", value: "ok" }],
    automationClass: "AUTO",
  },
  {
    id: "AC-002",
    sourceRef: "PR#1",
    description: "Second criterion",
    preconditions: [],
    expectedOutcomes: [{ type: "text", value: "ok" }],
    automationClass: "AUTO",
  },
];

function result(
  criterionId: string,
  status: CriterionResult["status"],
): CriterionResult {
  return {
    criterionId,
    status,
    expected: "ok",
    actual: status === "PASS" ? "ok" : "not-ok",
    evidenceIds: status === "BLOCKED" ? [] : ["evidence-1"],
    startedAt: "2026-08-26T00:00:00.000Z",
    completedAt: "2026-08-26T00:00:01.000Z",
  };
}

test("PASS requires every criterion to pass", () => {
  assert.deepEqual(summarizeRun(criteria, [result("AC-001", "PASS"), result("AC-002", "PASS")]), {
    verdict: "PASS",
    coverageComplete: true,
  });
});

test("FAIL has precedence while blocked coverage remains incomplete", () => {
  assert.deepEqual(summarizeRun(criteria, [result("AC-001", "FAIL"), result("AC-002", "BLOCKED")]), {
    verdict: "FAIL",
    coverageComplete: false,
  });
});

test("missing results are inconclusive", () => {
  assert.deepEqual(summarizeRun(criteria, [result("AC-001", "PASS")]), {
    verdict: "INCONCLUSIVE",
    coverageComplete: false,
  });
});

test("PASS without evidence is inconclusive", () => {
  const unprovenPass = { ...result("AC-001", "PASS"), evidenceIds: [] };
  assert.deepEqual(summarizeRun([criteria[0]!], [unprovenPass]), {
    verdict: "INCONCLUSIVE",
    coverageComplete: false,
  });
});

test("an evidenced failure still fails while unproven coverage remains incomplete", () => {
  const unprovenPass = { ...result("AC-002", "PASS"), evidenceIds: [] };
  assert.deepEqual(summarizeRun(criteria, [result("AC-001", "FAIL"), unprovenPass]), {
    verdict: "FAIL",
    coverageComplete: false,
  });
});

