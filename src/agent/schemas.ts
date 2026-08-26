import { z } from "zod";

export const expectedOutcomeSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("url"),
    matches: z.string().min(1),
    mode: z.enum(["exact", "prefix", "regex"]).optional(),
  }),
  z.object({
    type: z.literal("text"),
    value: z.string(),
    mode: z.enum(["exact", "contains", "regex"]).optional(),
    selector: z.string().optional(),
  }),
  z.object({
    type: z.literal("element"),
    selectorHint: z.string().min(1),
    state: z.enum(["visible", "hidden", "enabled", "disabled", "checked"]),
  }),
  z.object({ type: z.literal("http_status"), status: z.number().int().min(100).max(599) }),
  z.object({ type: z.literal("json_path"), path: z.string().min(1), equals: z.unknown() }),
  z.object({ type: z.literal("human"), reason: z.string().min(1) }),
]);

export const acceptanceCriterionSchema = z.object({
  id: z.string().regex(/^AC-[A-Z0-9][A-Z0-9-]*$/u),
  sourceRef: z.string().min(1),
  description: z.string().min(1),
  preconditions: z.array(z.string()),
  expectedOutcomes: z.array(expectedOutcomeSchema).min(1),
  automationClass: z.enum(["AUTO", "HUMAN", "UNSUPPORTED"]),
});

export const plannedStepSchema = z.object({
  id: z.string().min(1),
  criterionId: z.string().min(1),
  description: z.string().min(1),
  action: z.string().min(1),
  riskLevel: z.enum(["LOW", "MEDIUM", "HIGH"]),
});

export const plannedAssertionSchema = z.object({
  id: z.string().min(1),
  criterionId: z.string().min(1),
  kind: z.enum(["url", "text", "element", "http_status", "json_path", "human"]),
  expected: z.unknown(),
});

export const criterionPlanSchema = z.object({
  criterionId: z.string().min(1),
  setupSteps: z.array(plannedStepSchema),
  executionSteps: z.array(plannedStepSchema),
  assertions: z.array(plannedAssertionSchema),
  requiredEvidence: z.array(z.enum(["assertion", "screenshot", "network"])),
  riskLevel: z.enum(["LOW", "MEDIUM", "HIGH"]),
});

export const executionPlanSchema = z.object({
  runId: z.string().min(1),
  repository: z.string().min(1),
  pullRequestNumber: z.number().int().positive(),
  headSha: z.string().min(7),
  targetEnvironment: z.string().min(1),
  criteria: z.array(criterionPlanSchema).min(1),
  estimatedToolCalls: z.number().int().nonnegative(),
  estimatedDurationSeconds: z.number().int().nonnegative(),
  risks: z.array(
    z.object({
      level: z.enum(["LOW", "MEDIUM", "HIGH"]),
      description: z.string().min(1),
    }),
  ),
});

export const criterionResultSchema = z.object({
  criterionId: z.string().min(1),
  status: z.enum(["PASS", "FAIL", "NEEDS_HUMAN", "BLOCKED"]),
  expected: z.unknown(),
  actual: z.unknown(),
  evidenceIds: z.array(z.string()),
  startedAt: z.string(),
  completedAt: z.string(),
  failureCategory: z
    .enum(["PRODUCT", "ENVIRONMENT", "TOOL", "POLICY", "AGENT", "SYSTEM"])
    .optional(),
  explanation: z.string().optional(),
});

export const runtimeExecutionRequestSchema = z.object({
  run: z.object({
    runId: z.string().min(1),
    repository: z.string().min(1),
    pullRequestNumber: z.number().int().positive(),
    headSha: z.string().min(7),
    targetEnvironment: z.string().min(1),
    lifecycle: z.literal("RUNNING"),
    coverageComplete: z.boolean(),
    criteria: z.array(acceptanceCriterionSchema).min(1),
    plan: executionPlanSchema,
    results: z.array(criterionResultSchema),
    approvedBy: z.string().optional(),
    approvedAt: z.string().optional(),
    createdAt: z.string(),
    startedAt: z.string().optional(),
  }),
});
