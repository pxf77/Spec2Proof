import type {
  AcceptanceCriterion,
  CriterionResult,
  RunVerdict,
} from "./model.js";

export interface RunSummary {
  verdict: RunVerdict;
  coverageComplete: boolean;
}

export function summarizeRun(
  criteria: readonly AcceptanceCriterion[],
  results: readonly CriterionResult[],
  cancelled = false,
): RunSummary {
  if (cancelled) {
    return { verdict: "CANCELLED", coverageComplete: false };
  }

  if (criteria.length === 0) {
    return { verdict: "INCONCLUSIVE", coverageComplete: false };
  }

  const criterionIds = new Set(criteria.map((criterion) => criterion.id));
  const resultByCriterion = new Map<string, CriterionResult>();

  for (const result of results) {
    if (!criterionIds.has(result.criterionId)) {
      throw new Error(`Result references unknown criterion: ${result.criterionId}`);
    }
    if (resultByCriterion.has(result.criterionId)) {
      throw new Error(`Duplicate result for criterion: ${result.criterionId}`);
    }
    resultByCriterion.set(result.criterionId, result);
  }

  const orderedResults = criteria.map((criterion) => resultByCriterion.get(criterion.id));
  const hasMissing = orderedResults.some((result) => result === undefined);
  const hasBlocked = orderedResults.some((result) => result?.status === "BLOCKED");
  const hasUnprovenResult = orderedResults.some(
    (result) =>
      result !== undefined &&
      (result.status === "PASS" || result.status === "FAIL") &&
      result.evidenceIds.length === 0,
  );
  const hasProvenFailure = orderedResults.some(
    (result) => result?.status === "FAIL" && result.evidenceIds.length > 0,
  );
  const coverageComplete = !hasMissing && !hasBlocked && !hasUnprovenResult;

  if (hasProvenFailure) {
    return { verdict: "FAIL", coverageComplete };
  }

  if (hasMissing || hasBlocked || hasUnprovenResult) {
    return { verdict: "INCONCLUSIVE", coverageComplete: false };
  }

  if (orderedResults.some((result) => result?.status === "NEEDS_HUMAN")) {
    return { verdict: "NEEDS_HUMAN", coverageComplete: true };
  }

  if (orderedResults.every((result) => result?.status === "PASS")) {
    return { verdict: "PASS", coverageComplete: true };
  }

  return { verdict: "INCONCLUSIVE", coverageComplete: false };
}
