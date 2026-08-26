import { isDeepStrictEqual } from "node:util";
import type {
  AcceptanceRun,
  CriterionResult,
  CriterionStatus,
  FailureCategory,
  PlannedAssertion,
} from "../domain/model.js";

export interface AssertionObservation {
  assertionId: string;
  criterionId: string;
  kind: PlannedAssertion["kind"];
  passed: boolean;
  expected: unknown;
  actual: unknown;
  evidenceId: string;
}

type EvidenceType = AcceptanceRun["plan"]["criteria"][number]["requiredEvidence"][number];

export interface BuildCriterionResultInput {
  criterionId: string;
  status: CriterionStatus;
  failureCategory?: FailureCategory;
  explanation?: string;
  completedAt?: string;
}

/**
 * Invocation-local enforcement for an already approved execution plan.
 *
 * This is deliberately not a workflow engine or durable state machine. It only
 * prevents tools from escaping the approved criterion/step/assertion boundary
 * and derives PASS/FAIL records from evidence issued by deterministic tools.
 */
export class ApprovedExecutionLedger {
  private readonly criterionIds: Set<string>;
  private readonly planByCriterion = new Map<
    string,
    AcceptanceRun["plan"]["criteria"][number]
  >();
  private readonly stepIdsByCriterion = new Map<string, Set<string>>();
  private readonly assertionsById = new Map<string, PlannedAssertion>();
  private readonly observationsByAssertion = new Map<string, AssertionObservation>();
  private readonly evidenceIdsByCriterion = new Map<string, Set<string>>();
  private readonly evidenceTypesByCriterion = new Map<string, Set<EvidenceType>>();
  private readonly sessionCriterion = new Map<string, string>();

  public constructor(private readonly run: AcceptanceRun) {
    if (run.lifecycle !== "RUNNING") {
      throw new Error(`Execution ledger requires a RUNNING run, got ${run.lifecycle}`);
    }
    if (run.plan.runId !== run.runId || run.plan.headSha !== run.headSha) {
      throw new Error("Approved plan does not match the execution run");
    }

    this.criterionIds = new Set(run.criteria.map((criterion) => criterion.id));
    for (const criterionPlan of run.plan.criteria) {
      if (!this.criterionIds.has(criterionPlan.criterionId)) {
        throw new Error(`Plan references unknown criterion: ${criterionPlan.criterionId}`);
      }
      if (this.planByCriterion.has(criterionPlan.criterionId)) {
        throw new Error(`Plan repeats criterion: ${criterionPlan.criterionId}`);
      }
      this.planByCriterion.set(criterionPlan.criterionId, criterionPlan);

      const stepIds = new Set<string>();
      for (const step of [...criterionPlan.setupSteps, ...criterionPlan.executionSteps]) {
        if (step.criterionId !== criterionPlan.criterionId) {
          throw new Error(
            `Step ${step.id} belongs to ${step.criterionId}, expected ${criterionPlan.criterionId}`,
          );
        }
        if (stepIds.has(step.id)) {
          throw new Error(`Plan repeats step: ${step.id}`);
        }
        stepIds.add(step.id);
      }
      this.stepIdsByCriterion.set(criterionPlan.criterionId, stepIds);

      for (const assertion of criterionPlan.assertions) {
        if (assertion.criterionId !== criterionPlan.criterionId) {
          throw new Error(
            `Assertion ${assertion.id} belongs to ${assertion.criterionId}, expected ${criterionPlan.criterionId}`,
          );
        }
        if (this.assertionsById.has(assertion.id)) {
          throw new Error(`Plan repeats assertion: ${assertion.id}`);
        }
        this.assertionsById.set(assertion.id, assertion);
      }
    }
  }

  public requireStep(criterionId: string, stepId: string): void {
    this.requireCriterion(criterionId);
    if (!this.stepIdsByCriterion.get(criterionId)?.has(stepId)) {
      throw new Error(`Step ${stepId} is not approved for criterion ${criterionId}`);
    }
  }

  public bindSession(criterionId: string, stepId: string, sessionId: string): void {
    this.requireStep(criterionId, stepId);
    if (this.sessionCriterion.has(sessionId)) {
      throw new Error(`Browser session is already bound: ${sessionId}`);
    }
    this.sessionCriterion.set(sessionId, criterionId);
  }

  public requireSession(criterionId: string, stepId: string, sessionId: string): void {
    this.requireStep(criterionId, stepId);
    this.requireSessionForCriterion(criterionId, sessionId);
  }

  public requireSessionForCriterion(criterionId: string, sessionId: string): void {
    this.requireCriterion(criterionId);
    const boundCriterion = this.sessionCriterion.get(sessionId);
    if (!boundCriterion) {
      throw new Error(`Browser session is not registered: ${sessionId}`);
    }
    if (boundCriterion !== criterionId) {
      throw new Error(
        `Browser session ${sessionId} belongs to ${boundCriterion}, not ${criterionId}`,
      );
    }
  }

  public requireAssertion(
    criterionId: string,
    assertionId: string,
    expectedKind: PlannedAssertion["kind"],
  ): PlannedAssertion {
    this.requireCriterion(criterionId);
    const assertion = this.assertionsById.get(assertionId);
    if (!assertion || assertion.criterionId !== criterionId) {
      throw new Error(`Assertion ${assertionId} is not approved for criterion ${criterionId}`);
    }
    if (assertion.kind !== expectedKind) {
      throw new Error(
        `Assertion ${assertionId} has kind ${assertion.kind}, not ${expectedKind}`,
      );
    }
    return assertion;
  }

  public recordEvidence(
    criterionId: string,
    evidenceId: string,
    evidenceType: EvidenceType,
  ): void {
    this.requireCriterion(criterionId);
    if (evidenceId.trim().length === 0) {
      throw new Error("Evidence ID must not be empty");
    }
    const evidenceIds = this.evidenceIdsByCriterion.get(criterionId) ?? new Set<string>();
    evidenceIds.add(evidenceId);
    this.evidenceIdsByCriterion.set(criterionId, evidenceIds);

    const evidenceTypes =
      this.evidenceTypesByCriterion.get(criterionId) ?? new Set<EvidenceType>();
    evidenceTypes.add(evidenceType);
    this.evidenceTypesByCriterion.set(criterionId, evidenceTypes);
  }

  public recordAssertion(observation: AssertionObservation): void {
    const assertion = this.requireAssertion(
      observation.criterionId,
      observation.assertionId,
      observation.kind,
    );
    if (!isDeepStrictEqual(observation.expected, assertion.expected)) {
      throw new Error(
        `Assertion ${observation.assertionId} does not preserve its approved expected value`,
      );
    }
    if (this.observationsByAssertion.has(observation.assertionId)) {
      throw new Error(`Assertion already executed: ${observation.assertionId}`);
    }
    this.recordEvidence(observation.criterionId, observation.evidenceId, "assertion");
    this.observationsByAssertion.set(
      observation.assertionId,
      structuredClone(observation),
    );
  }

  public buildCriterionResult(input: BuildCriterionResultInput): CriterionResult {
    const criterionPlan = this.requireCriterion(input.criterionId);
    const plannedAssertions = criterionPlan.assertions;
    const observations = plannedAssertions
      .map((assertion) => this.observationsByAssertion.get(assertion.id))
      .filter((value): value is AssertionObservation => value !== undefined);

    const hasFailedAssertion = observations.some((observation) => !observation.passed);

    if (hasFailedAssertion && input.status !== "FAIL") {
      throw new Error(
        `Criterion ${input.criterionId} has a failed assertion and must be reported as FAIL`,
      );
    }

    if (input.status === "PASS") {
      const missingAssertions = plannedAssertions.filter(
        (assertion) => !this.observationsByAssertion.has(assertion.id),
      );
      if (plannedAssertions.length === 0 || missingAssertions.length > 0) {
        throw new Error(
          `Criterion ${input.criterionId} cannot PASS before every approved assertion executes`,
        );
      }

      const evidenceTypes =
        this.evidenceTypesByCriterion.get(input.criterionId) ?? new Set<EvidenceType>();
      const missingEvidenceTypes = criterionPlan.requiredEvidence.filter(
        (evidenceType) => !evidenceTypes.has(evidenceType),
      );
      if (missingEvidenceTypes.length > 0) {
        throw new Error(
          `Criterion ${input.criterionId} cannot PASS without required evidence: ${missingEvidenceTypes.join(", ")}`,
        );
      }
    }

    if (input.status === "FAIL" && !hasFailedAssertion) {
      throw new Error(
        `Criterion ${input.criterionId} cannot FAIL without a failed deterministic assertion`,
      );
    }

    if (
      input.status === "FAIL" &&
      input.failureCategory !== undefined &&
      input.failureCategory !== "PRODUCT"
    ) {
      throw new Error("FAIL results must use the PRODUCT failure category");
    }

    if (input.status === "BLOCKED" && input.failureCategory === "PRODUCT") {
      throw new Error("BLOCKED results cannot use the PRODUCT failure category");
    }

    if (
      (input.status === "PASS" || input.status === "NEEDS_HUMAN") &&
      input.failureCategory !== undefined
    ) {
      throw new Error(`${input.status} results cannot include a failure category`);
    }

    const completedAt = input.completedAt ?? new Date().toISOString();
    const evidenceIds = [
      ...(this.evidenceIdsByCriterion.get(input.criterionId) ?? new Set<string>()),
    ];

    return {
      criterionId: input.criterionId,
      status: input.status,
      expected: plannedAssertions.map((assertion) => ({
        assertionId: assertion.id,
        kind: assertion.kind,
        expected: assertion.expected,
      })),
      actual:
        observations.length === 0
          ? null
          : observations.map((observation) => ({
              assertionId: observation.assertionId,
              kind: observation.kind,
              passed: observation.passed,
              actual: observation.actual,
            })),
      evidenceIds,
      startedAt: this.run.startedAt ?? this.run.approvedAt ?? this.run.createdAt,
      completedAt,
      failureCategory:
        input.failureCategory ??
        (input.status === "FAIL"
          ? "PRODUCT"
          : input.status === "BLOCKED"
            ? "AGENT"
            : undefined),
      explanation: input.explanation,
    };
  }

  private requireCriterion(
    criterionId: string,
  ): AcceptanceRun["plan"]["criteria"][number] {
    if (!this.criterionIds.has(criterionId)) {
      throw new Error(`Unknown criterion: ${criterionId}`);
    }
    const criterionPlan = this.planByCriterion.get(criterionId);
    if (!criterionPlan) {
      throw new Error(`Criterion is missing from the approved plan: ${criterionId}`);
    }
    return criterionPlan;
  }
}
