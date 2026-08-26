import { parse as parseYaml } from "yaml";
import { z } from "zod";
import type { PullRequestReader, ReviewerAuthorizer } from "../application/ports.js";
import type {
  AcceptanceCriterion,
  AutomationClass,
  ExpectedOutcome,
  PrepareRunInput,
} from "../domain/model.js";
import { expectedOutcomeSchema } from "../agent/schemas.js";
import type { GitHubInstallationClientFactory } from "./client.js";

const YAML_FENCE = /```(?<language>yaml|yml|spec2proof)\s*\r?\n(?<body>[\s\S]*?)```/giu;

const sourceOutcomeSchema = z.preprocess(normalizeOutcome, expectedOutcomeSchema);

const sourceCriterionSchema = z.preprocess(
  normalizeCriterion,
  z.object({
    id: z.string().regex(/^AC-[A-Z0-9][A-Z0-9-]*$/u),
    description: z.string().min(1),
    preconditions: z.array(z.string()).default([]),
    expectedOutcomes: z.array(sourceOutcomeSchema).min(1),
    automationClass: z.enum(["AUTO", "HUMAN", "UNSUPPORTED"]).optional(),
  }),
);

const sourceSpecSchema = z.object({
  target: z
    .object({
      environment: z.string().min(1),
      base_url: z.string().url(),
    })
    .transform((value) => ({
      environment: value.environment,
      baseUrl: value.base_url,
    })),
  criteria: z.array(sourceCriterionSchema).min(1).max(50),
});

export interface ParsedPullRequestSpec {
  targetEnvironment: string;
  targetBaseUrl: string;
  criteria: AcceptanceCriterion[];
}

export function parseSpec2ProofPullRequestBody(
  body: string,
  pullRequestNumber: number,
): ParsedPullRequestSpec {
  let sawSpecBlock = false;
  for (const match of body.matchAll(YAML_FENCE)) {
    const language = match.groups?.language?.toLowerCase();
    const source = match.groups?.body;
    if (!source) {
      continue;
    }
    if (language !== "spec2proof" && !/^\s*spec2proof\s*:/mu.test(source)) {
      continue;
    }
    sawSpecBlock = true;

    const parsed = parseYaml(source) as unknown;
    const container = asRecord(parsed);
    const rawSpec = language === "spec2proof" ? parsed : container.spec2proof;
    const spec = sourceSpecSchema.parse(rawSpec) as {
      target: { environment: string; baseUrl: string };
      criteria: ParsedSourceCriterion[];
    };
    const criteria = spec.criteria.map((criterion) =>
      normalizeParsedCriterion(criterion, pullRequestNumber),
    );
    ensureUniqueCriterionIds(criteria);
    return {
      targetEnvironment: spec.target.environment,
      targetBaseUrl: spec.target.baseUrl,
      criteria,
    };
  }

  if (sawSpecBlock) {
    throw new Error("The Spec2Proof YAML block could not be parsed");
  }
  throw new Error(
    "PR description must contain a fenced YAML block with a spec2proof target and criteria",
  );
}

export class GitHubPullRequestReader implements PullRequestReader {
  public constructor(
    private readonly clients: GitHubInstallationClientFactory,
    private readonly maxChangedFiles = 100,
    private readonly maxPatchCharsPerFile = 4_000,
  ) {}

  public async read(input: {
    installationId: number;
    repository: string;
    pullRequestNumber: number;
  }): Promise<PrepareRunInput> {
    const client = this.clients.forInstallation(input.installationId);
    const [pullRequest, files] = await Promise.all([
      client.getPullRequest(input.repository, input.pullRequestNumber),
      client.listPullRequestFiles(input.repository, input.pullRequestNumber),
    ]);
    const spec = parseSpec2ProofPullRequestBody(
      pullRequest.body ?? "",
      input.pullRequestNumber,
    );

    return {
      installationId: input.installationId,
      repository: input.repository,
      pullRequestNumber: input.pullRequestNumber,
      headSha: pullRequest.head.sha,
      targetEnvironment: spec.targetEnvironment,
      targetBaseUrl: spec.targetBaseUrl,
      pullRequestContext: {
        title: pullRequest.title,
        author: pullRequest.user.login,
        baseRef: pullRequest.base.ref,
        headRef: pullRequest.head.ref,
        htmlUrl: pullRequest.html_url,
        changedFiles: files.slice(0, this.maxChangedFiles).map((file) => ({
          path: file.filename,
          status: file.status,
          additions: file.additions,
          deletions: file.deletions,
          ...boundedPatch(file.patch, this.maxPatchCharsPerFile),
        })),
        changedFilesTruncated: files.length > this.maxChangedFiles,
      },
      criteria: spec.criteria,
    };
  }

  public async getHeadSha(input: {
    installationId: number;
    repository: string;
    pullRequestNumber: number;
  }): Promise<string> {
    const client = this.clients.forInstallation(input.installationId);
    const pullRequest = await client.getPullRequest(
      input.repository,
      input.pullRequestNumber,
    );
    return pullRequest.head.sha;
  }
}

export class GitHubReviewerAuthorizer implements ReviewerAuthorizer {
  public constructor(private readonly clients: GitHubInstallationClientFactory) {}

  public async canApprove(input: {
    installationId: number;
    repository: string;
    username: string;
  }): Promise<boolean> {
    const client = this.clients.forInstallation(input.installationId);
    const permission = await client.getCollaboratorPermission(
      input.repository,
      input.username,
    );
    return permission === "admin" || permission === "maintain" || permission === "write";
  }
}

function normalizeOutcome(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }
  const outcome = { ...(value as Record<string, unknown>) };
  if (outcome.type === "element") {
    outcome.selectorHint = outcome.selectorHint ?? outcome.selector_hint;
    if (outcome.state === undefined && typeof outcome.visible === "boolean") {
      outcome.state = outcome.visible ? "visible" : "hidden";
    }
  }
  return outcome;
}

function normalizeCriterion(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }
  const criterion = value as Record<string, unknown>;
  return {
    ...criterion,
    expectedOutcomes: criterion.expectedOutcomes ?? criterion.expected,
    automationClass: criterion.automationClass ?? criterion.automation_class,
  };
}

interface ParsedSourceCriterion {
  id: string;
  description: string;
  preconditions: string[];
  expectedOutcomes: ExpectedOutcome[];
  automationClass?: AutomationClass;
}

function normalizeParsedCriterion(
  source: ParsedSourceCriterion,
  pullRequestNumber: number,
): AcceptanceCriterion {
  const outcomes = source.expectedOutcomes as ExpectedOutcome[];
  const automationClass = resolveAutomationClass(source.automationClass, outcomes, source.id);
  return {
    id: source.id,
    sourceRef: `PR#${pullRequestNumber}:spec2proof/${source.id}`,
    description: source.description,
    preconditions: source.preconditions,
    expectedOutcomes: outcomes,
    automationClass,
  };
}

function resolveAutomationClass(
  declared: AutomationClass | undefined,
  outcomes: ExpectedOutcome[],
  criterionId: string,
): AutomationClass {
  const humanCount = outcomes.filter((outcome) => outcome.type === "human").length;
  if (humanCount > 0 && humanCount !== outcomes.length) {
    throw new Error(
      `Criterion ${criterionId} mixes human and deterministic outcomes; split it into separate criteria`,
    );
  }
  const inferred: AutomationClass = humanCount === outcomes.length ? "HUMAN" : "AUTO";
  const resolved = declared ?? inferred;
  if (resolved === "AUTO" && humanCount > 0) {
    throw new Error(`Criterion ${criterionId} is AUTO but contains a human outcome`);
  }
  return resolved;
}

function ensureUniqueCriterionIds(criteria: AcceptanceCriterion[]): void {
  const ids = new Set<string>();
  for (const criterion of criteria) {
    if (ids.has(criterion.id)) {
      throw new Error(`Duplicate criterion ID: ${criterion.id}`);
    }
    ids.add(criterion.id);
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Spec2Proof YAML root must be an object");
  }
  return value as Record<string, unknown>;
}

function boundedPatch(
  patch: string | undefined,
  limit: number,
): { patch?: string; patchTruncated?: boolean } {
  if (!patch) {
    return {};
  }
  if (patch.length <= limit) {
    return { patch };
  }
  return {
    patch: `${patch.slice(0, limit)}\n[patch truncated]`,
    patchTruncated: true,
  };
}
