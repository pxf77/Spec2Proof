import type {
  AcceptanceRun,
  CriterionPlan,
  CriterionResult,
  ExecutionPlan,
  PrepareRunInput,
} from "../domain/model.js";
import type { PlanGenerator, RunExecutor } from "../application/ports.js";

export class DeterministicPlanGenerator implements PlanGenerator {
  public async generate(
    input: PrepareRunInput & { runId: string },
  ): Promise<ExecutionPlan> {
    const criteria: CriterionPlan[] = input.criteria.map((criterion) => ({
      criterionId: criterion.id,
      setupSteps: criterion.preconditions.map((precondition, index) => ({
        id: `${criterion.id}-SETUP-${index + 1}`,
        criterionId: criterion.id,
        description: precondition,
        action: "satisfy_precondition",
        riskLevel: "LOW",
      })),
      executionSteps: [
        {
          id: `${criterion.id}-STEP-1`,
          criterionId: criterion.id,
          description: criterion.description,
          action: "execute_acceptance_path",
          riskLevel: criterion.automationClass === "AUTO" ? "LOW" : "MEDIUM",
        },
      ],
      assertions:
        criterion.automationClass === "AUTO"
          ? criterion.expectedOutcomes.map((outcome, index) => ({
              id: `${criterion.id}-ASSERT-${index + 1}`,
              criterionId: criterion.id,
              kind: outcome.type,
              expected: outcome,
            }))
          : [],
      requiredEvidence: ["assertion", "screenshot"],
      riskLevel: criterion.automationClass === "AUTO" ? "LOW" : "MEDIUM",
    }));

    return {
      runId: input.runId,
      repository: input.repository,
      pullRequestNumber: input.pullRequestNumber,
      headSha: input.headSha,
      targetEnvironment: input.targetEnvironment,
      criteria,
      estimatedToolCalls: Math.max(1, criteria.length * 4),
      estimatedDurationSeconds: Math.max(30, criteria.length * 45),
      risks: [],
    };
  }
}

export class ScriptedRunExecutor implements RunExecutor {
  public constructor(
    private readonly statuses: Readonly<Record<string, CriterionResult["status"]>> = {},
  ) {}

  public async execute(run: AcceptanceRun): Promise<CriterionResult[]> {
    const now = new Date().toISOString();
    return run.criteria.map((criterion) => {
      const status =
        this.statuses[criterion.id] ??
        (criterion.automationClass === "AUTO" ? "PASS" : "NEEDS_HUMAN");
      return {
        criterionId: criterion.id,
        status,
        expected: criterion.expectedOutcomes,
        actual: status === "PASS" ? criterion.expectedOutcomes : null,
        evidenceIds: status === "BLOCKED" ? [] : [`local://${run.runId}/${criterion.id}`],
        startedAt: now,
        completedAt: now,
        failureCategory: status === "FAIL" ? "PRODUCT" : undefined,
        explanation:
          status === "NEEDS_HUMAN" ? "Criterion requires human judgment" : undefined,
      };
    });
  }
}
