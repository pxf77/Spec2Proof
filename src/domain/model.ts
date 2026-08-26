export type RunLifecycle = "AWAITING_APPROVAL" | "RUNNING" | "COMPLETED";

export type RunVerdict =
  | "PASS"
  | "FAIL"
  | "NEEDS_HUMAN"
  | "INCONCLUSIVE"
  | "CANCELLED";

export type CriterionStatus = "PASS" | "FAIL" | "NEEDS_HUMAN" | "BLOCKED";

export type FailureCategory =
  | "PRODUCT"
  | "ENVIRONMENT"
  | "TOOL"
  | "POLICY"
  | "AGENT"
  | "SYSTEM";

export type AutomationClass = "AUTO" | "HUMAN" | "UNSUPPORTED";

export type RiskLevel = "LOW" | "MEDIUM" | "HIGH";

export type ExpectedOutcome =
  | { type: "url"; matches: string; mode?: "exact" | "prefix" | "regex" }
  | {
      type: "text";
      value: string;
      mode?: "exact" | "contains" | "regex";
      selector?: string;
    }
  | {
      type: "element";
      selectorHint: string;
      state: "visible" | "hidden" | "enabled" | "disabled" | "checked";
    }
  | { type: "http_status"; status: number }
  | { type: "json_path"; path: string; equals: unknown }
  | { type: "human"; reason: string };

export interface AcceptanceCriterion {
  id: string;
  sourceRef: string;
  description: string;
  preconditions: string[];
  expectedOutcomes: ExpectedOutcome[];
  automationClass: AutomationClass;
}

export interface PlannedStep {
  id: string;
  criterionId: string;
  description: string;
  action: string;
  riskLevel: RiskLevel;
}

export interface PlannedAssertion {
  id: string;
  criterionId: string;
  kind: ExpectedOutcome["type"];
  expected: unknown;
}

export interface CriterionPlan {
  criterionId: string;
  setupSteps: PlannedStep[];
  executionSteps: PlannedStep[];
  assertions: PlannedAssertion[];
  requiredEvidence: Array<"assertion" | "screenshot" | "network">;
  riskLevel: RiskLevel;
}

export interface ExecutionPlan {
  runId: string;
  repository: string;
  pullRequestNumber: number;
  headSha: string;
  targetEnvironment: string;
  criteria: CriterionPlan[];
  estimatedToolCalls: number;
  estimatedDurationSeconds: number;
  risks: Array<{ level: RiskLevel; description: string }>;
}

export interface CriterionResult {
  criterionId: string;
  status: CriterionStatus;
  expected: unknown;
  actual: unknown;
  evidenceIds: string[];
  startedAt: string;
  completedAt: string;
  failureCategory?: FailureCategory;
  explanation?: string;
}

export interface PullRequestFileSummary {
  path: string;
  status: string;
  additions: number;
  deletions: number;
  patch?: string;
  patchTruncated?: boolean;
}

export interface PullRequestContext {
  title: string;
  author: string;
  baseRef: string;
  headRef: string;
  htmlUrl: string;
  changedFiles: PullRequestFileSummary[];
  changedFilesTruncated: boolean;
}

export interface AcceptanceRun {
  runId: string;
  installationId?: number;
  repository: string;
  pullRequestNumber: number;
  headSha: string;
  targetEnvironment: string;
  targetBaseUrl?: string;
  pullRequestContext?: PullRequestContext;
  lifecycle: RunLifecycle;
  verdict?: RunVerdict;
  coverageComplete: boolean;
  criteria: AcceptanceCriterion[];
  plan: ExecutionPlan;
  results: CriterionResult[];
  approvedBy?: string;
  approvedAt?: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  cancellationReason?: string;
}

export interface PrepareRunInput {
  installationId?: number;
  repository: string;
  pullRequestNumber: number;
  headSha: string;
  targetEnvironment: string;
  targetBaseUrl?: string;
  pullRequestContext?: PullRequestContext;
  criteria: AcceptanceCriterion[];
}
