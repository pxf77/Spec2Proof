import { isDeepStrictEqual } from "node:util";
import type {
  AcceptanceCriterion,
  AcceptanceRun,
  ExecutionPlan,
  PrepareRunInput,
} from "../domain/model.js";
import { summarizeRun } from "../domain/verdict.js";
import type {
  Clock,
  IdGenerator,
  PlanGenerator,
  RunExecutor,
  RunPublisher,
  RunStore,
} from "./ports.js";

export interface RunServiceDependencies {
  planGenerator: PlanGenerator;
  executor: RunExecutor;
  store: RunStore;
  publisher: RunPublisher;
  clock: Clock;
  ids: IdGenerator;
}

export class RunService {
  public constructor(private readonly dependencies: RunServiceDependencies) {}

  public async prepareRun(input: PrepareRunInput): Promise<AcceptanceRun> {
    validateCriteria(input.criteria);
    validateTarget(input.targetBaseUrl);

    const runId = this.dependencies.ids.next("run");
    const plan = await this.dependencies.planGenerator.generate({ ...input, runId });
    validatePlan(plan, input, runId);

    const run: AcceptanceRun = {
      runId,
      installationId: input.installationId,
      repository: input.repository,
      pullRequestNumber: input.pullRequestNumber,
      headSha: input.headSha,
      targetEnvironment: input.targetEnvironment,
      targetBaseUrl: input.targetBaseUrl,
      pullRequestContext: input.pullRequestContext
        ? structuredClone(input.pullRequestContext)
        : undefined,
      lifecycle: "AWAITING_APPROVAL",
      coverageComplete: false,
      criteria: structuredClone(input.criteria),
      plan: structuredClone(plan),
      results: [],
      createdAt: this.dependencies.clock.now().toISOString(),
    };

    await this.dependencies.store.save(run);
    await this.dependencies.publisher.planReady(run);
    return run;
  }

  public async approveRun(
    runId: string,
    actor: string,
    currentHeadSha: string,
  ): Promise<AcceptanceRun> {
    const run = await this.requireRun(runId);

    if (run.lifecycle !== "AWAITING_APPROVAL") {
      throw new Error(`Run ${runId} is not awaiting approval`);
    }
    if (run.headSha !== currentHeadSha) {
      throw new Error(
        `Run ${runId} targets stale head ${run.headSha}; current head is ${currentHeadSha}`,
      );
    }

    const now = this.dependencies.clock.now().toISOString();
    const approved: AcceptanceRun = {
      ...run,
      lifecycle: "RUNNING",
      approvedBy: actor,
      approvedAt: now,
      startedAt: now,
    };

    await this.dependencies.store.save(approved);
    await this.dependencies.publisher.runStarted(approved);
    return approved;
  }

  public async executeRun(runId: string, signal?: AbortSignal): Promise<AcceptanceRun> {
    const run = await this.requireRun(runId);
    if (run.lifecycle !== "RUNNING") {
      throw new Error(`Run ${runId} is not running`);
    }

    let results;
    try {
      results = await this.dependencies.executor.execute(run, signal);
    } catch (error) {
      const completedAt = this.dependencies.clock.now().toISOString();
      const message = error instanceof Error ? error.message : "Unknown executor error";
      results = run.criteria.map((criterion) => ({
        criterionId: criterion.id,
        status: "BLOCKED" as const,
        expected: criterion.expectedOutcomes,
        actual: null,
        evidenceIds: [],
        startedAt: run.startedAt ?? completedAt,
        completedAt,
        failureCategory: "SYSTEM" as const,
        explanation: message,
      }));
    }

    const current = await this.requireRun(runId);
    if (current.lifecycle === "COMPLETED" && current.verdict === "CANCELLED") {
      return current;
    }

    const summary = summarizeRun(run.criteria, results);
    const completed: AcceptanceRun = {
      ...run,
      lifecycle: "COMPLETED",
      verdict: summary.verdict,
      coverageComplete: summary.coverageComplete,
      results: structuredClone(results),
      completedAt: this.dependencies.clock.now().toISOString(),
    };

    await this.dependencies.store.save(completed);
    await this.dependencies.publisher.runCompleted(completed);
    return completed;
  }

  public async cancelRun(runId: string, reason: string): Promise<AcceptanceRun> {
    const run = await this.requireRun(runId);
    if (run.lifecycle === "COMPLETED") {
      return run;
    }

    const cancelled: AcceptanceRun = {
      ...run,
      lifecycle: "COMPLETED",
      verdict: "CANCELLED",
      coverageComplete: false,
      cancellationReason: reason,
      completedAt: this.dependencies.clock.now().toISOString(),
    };

    // Persist the terminal state before aborting the executor so a concurrently
    // unwinding execution cannot overwrite cancellation with INCONCLUSIVE.
    await this.dependencies.store.save(cancelled);
    try {
      await this.dependencies.executor.cancel?.(runId);
    } catch {
      // Cancellation is best effort after the terminal state is durable.
    }
    await this.dependencies.publisher.runCompleted(cancelled);
    return cancelled;
  }

  public async getRun(runId: string): Promise<AcceptanceRun | undefined> {
    return this.dependencies.store.get(runId);
  }

  public async findLatestRun(
    repository: string,
    pullRequestNumber: number,
  ): Promise<AcceptanceRun | undefined> {
    return this.dependencies.store.findLatest(repository, pullRequestNumber);
  }

  private async requireRun(runId: string): Promise<AcceptanceRun> {
    const run = await this.dependencies.store.get(runId);
    if (!run) {
      throw new Error(`Run not found: ${runId}`);
    }
    return run;
  }
}

function validateTarget(targetBaseUrl: string | undefined): void {
  if (!targetBaseUrl) {
    return;
  }
  const target = new URL(targetBaseUrl);
  if (target.protocol !== "https:" && target.protocol !== "http:") {
    throw new Error(`Unsupported target protocol: ${target.protocol}`);
  }
}

function validateCriteria(criteria: readonly AcceptanceCriterion[]): void {
  if (criteria.length === 0) {
    throw new Error("At least one acceptance criterion is required");
  }

  const ids = new Set<string>();
  for (const criterion of criteria) {
    if (!/^AC-[A-Z0-9][A-Z0-9-]*$/u.test(criterion.id)) {
      throw new Error(`Invalid criterion ID: ${criterion.id}`);
    }
    if (ids.has(criterion.id)) {
      throw new Error(`Duplicate criterion ID: ${criterion.id}`);
    }
    if (criterion.description.trim().length === 0) {
      throw new Error(`Criterion ${criterion.id} has no description`);
    }
    if (criterion.expectedOutcomes.length === 0) {
      throw new Error(`Criterion ${criterion.id} has no expected outcome`);
    }
    if (
      criterion.automationClass === "AUTO" &&
      criterion.expectedOutcomes.some((outcome) => outcome.type === "human")
    ) {
      throw new Error(`Automatable criterion ${criterion.id} contains a human outcome`);
    }
    ids.add(criterion.id);
  }
}

function validatePlan(
  plan: ExecutionPlan,
  input: PrepareRunInput,
  runId: string,
): void {
  if (plan.runId !== runId) {
    throw new Error(`Plan runId mismatch: expected ${runId}, got ${plan.runId}`);
  }
  if (plan.repository !== input.repository) {
    throw new Error(
      `Plan repository mismatch: expected ${input.repository}, got ${plan.repository}`,
    );
  }
  if (plan.pullRequestNumber !== input.pullRequestNumber) {
    throw new Error(
      `Plan PR mismatch: expected ${input.pullRequestNumber}, got ${plan.pullRequestNumber}`,
    );
  }
  if (plan.headSha !== input.headSha) {
    throw new Error(
      `Plan head SHA mismatch: expected ${input.headSha}, got ${plan.headSha}`,
    );
  }
  if (plan.targetEnvironment !== input.targetEnvironment) {
    throw new Error(
      `Plan target mismatch: expected ${input.targetEnvironment}, got ${plan.targetEnvironment}`,
    );
  }

  const criterionById = new Map(input.criteria.map((criterion) => [criterion.id, criterion]));
  const plannedIds = new Set<string>();
  const stepIds = new Set<string>();
  const assertionIds = new Set<string>();

  for (const criterionPlan of plan.criteria) {
    if (!criterionById.has(criterionPlan.criterionId)) {
      throw new Error(`Plan references unknown criterion: ${criterionPlan.criterionId}`);
    }
    if (plannedIds.has(criterionPlan.criterionId)) {
      throw new Error(`Plan repeats criterion: ${criterionPlan.criterionId}`);
    }

    const criterion = criterionById.get(criterionPlan.criterionId);
    for (const step of [...criterionPlan.setupSteps, ...criterionPlan.executionSteps]) {
      if (step.criterionId !== criterionPlan.criterionId) {
        throw new Error(
          `Step ${step.id} belongs to ${step.criterionId}, expected ${criterionPlan.criterionId}`,
        );
      }
      if (stepIds.has(step.id)) {
        throw new Error(`Plan repeats step ID: ${step.id}`);
      }
      stepIds.add(step.id);
    }

    for (const assertion of criterionPlan.assertions) {
      if (assertion.criterionId !== criterionPlan.criterionId) {
        throw new Error(
          `Assertion ${assertion.id} belongs to ${assertion.criterionId}, expected ${criterionPlan.criterionId}`,
        );
      }
      if (assertionIds.has(assertion.id)) {
        throw new Error(`Plan repeats assertion ID: ${assertion.id}`);
      }
      if (criterion?.automationClass === "AUTO" && assertion.kind === "human") {
        throw new Error(
          `Automatable criterion ${criterionPlan.criterionId} cannot use a human assertion`,
        );
      }
      assertionIds.add(assertion.id);
    }

    if (criterion?.automationClass === "AUTO") {
      const sourceOutcomes = criterion.expectedOutcomes.filter(
        (outcome) => outcome.type !== "human",
      );
      if (criterionPlan.assertions.length === 0) {
        throw new Error(
          `Automatable criterion ${criterionPlan.criterionId} has no deterministic assertion`,
        );
      }
      if (criterionPlan.assertions.length !== sourceOutcomes.length) {
        throw new Error(
          `Plan assertions do not exactly cover source outcomes for ${criterionPlan.criterionId}`,
        );
      }
      const unmatchedAssertions = [...criterionPlan.assertions];
      for (const outcome of sourceOutcomes) {
        const matchIndex = unmatchedAssertions.findIndex(
          (assertion) =>
            assertion.kind === outcome.type &&
            isDeepStrictEqual(assertion.expected, outcome),
        );
        if (matchIndex < 0) {
          throw new Error(
            `Plan does not preserve an expected outcome for ${criterionPlan.criterionId}`,
          );
        }
        unmatchedAssertions.splice(matchIndex, 1);
      }
      if (!criterionPlan.requiredEvidence.includes("assertion")) {
        throw new Error(
          `Automatable criterion ${criterionPlan.criterionId} does not require assertion evidence`,
        );
      }
    }
    plannedIds.add(criterionPlan.criterionId);
  }

  for (const criterion of input.criteria) {
    if (!plannedIds.has(criterion.id)) {
      throw new Error(`Plan does not cover criterion: ${criterion.id}`);
    }
  }
}
