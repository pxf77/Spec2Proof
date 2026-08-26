import type { RunPublisher } from "../application/ports.js";
import type { AcceptanceRun, CriterionResult, RunVerdict } from "../domain/model.js";
import type {
  GitHubCheckRunRecord,
  GitHubInstallationClient,
  GitHubInstallationClientFactory,
} from "./client.js";

const CHECK_NAME = "Spec2Proof";
const MAX_GITHUB_BODY = 60_000;
const SUMMARY_MARKER = "<!-- spec2proof-summary -->";

export class GitHubRunPublisher implements RunPublisher {
  public constructor(private readonly clients: GitHubInstallationClientFactory) {}

  public async planReady(run: AcceptanceRun): Promise<void> {
    const client = this.clientForRun(run);
    const body = renderPlanComment(run);
    await this.upsertCheck(client, run, {
      status: "queued",
      output: {
        title: "Spec2Proof plan awaiting approval",
        summary: truncate(body, MAX_GITHUB_BODY),
      },
    });
    await this.upsertComment(client, run, body);
  }

  public async runStarted(run: AcceptanceRun): Promise<void> {
    const client = this.clientForRun(run);
    const body = renderRunningComment(run);
    await this.upsertCheck(client, run, {
      status: "in_progress",
      started_at: run.startedAt ?? new Date().toISOString(),
      output: {
        title: "Spec2Proof acceptance execution is running",
        summary: truncate(body, MAX_GITHUB_BODY),
      },
    });
    await this.upsertComment(client, run, body);
  }

  public async runCompleted(run: AcceptanceRun): Promise<void> {
    const client = this.clientForRun(run);
    const body = renderCompletedComment(run);
    await this.upsertCheck(client, run, {
      status: "completed",
      conclusion: mapConclusion(run.verdict),
      completed_at: run.completedAt ?? new Date().toISOString(),
      output: {
        title: `Spec2Proof result: ${run.verdict ?? "INCONCLUSIVE"}`,
        summary: truncate(body, MAX_GITHUB_BODY),
      },
    });
    await this.upsertComment(client, run, body);
  }

  private clientForRun(run: AcceptanceRun): GitHubInstallationClient {
    if (!run.installationId) {
      throw new Error(`Run ${run.runId} is not bound to a GitHub App installation`);
    }
    return this.clients.forInstallation(run.installationId);
  }

  private async upsertCheck(
    client: GitHubInstallationClient,
    run: AcceptanceRun,
    update: Record<string, unknown>,
  ): Promise<void> {
    const checks = await client.listCheckRuns(run.repository, run.headSha);
    const existing = checks.find((check) => check.external_id === run.runId);
    if (existing) {
      await client.updateCheckRun(run.repository, existing.id, update);
      return;
    }

    await client.createCheckRun(run.repository, {
      name: CHECK_NAME,
      head_sha: run.headSha,
      external_id: run.runId,
      details_url: pullRequestUrl(run),
      ...update,
    });
  }

  private async upsertComment(
    client: GitHubInstallationClient,
    run: AcceptanceRun,
    body: string,
  ): Promise<void> {
    await upsertSpec2ProofSummary(
      client,
      run.repository,
      run.pullRequestNumber,
      body,
    );
  }
}

export async function upsertSpec2ProofSummary(
  client: GitHubInstallationClient,
  repository: string,
  pullRequestNumber: number,
  body: string,
): Promise<void> {
  const rendered = truncate(`${SUMMARY_MARKER}\n${body}`, MAX_GITHUB_BODY);
  const comments = await client.listIssueComments(repository, pullRequestNumber);
  const existing = comments.find((comment) => comment.body?.includes(SUMMARY_MARKER));
  if (existing) {
    await client.updateIssueComment(repository, existing.id, rendered);
    return;
  }
  await client.createIssueComment(repository, pullRequestNumber, rendered);
}

export function renderPlanComment(run: AcceptanceRun): string {
  const rows = run.plan.criteria.map((criterion) => {
    const steps = criterion.setupSteps.length + criterion.executionSteps.length;
    return `| ${escapeCell(criterion.criterionId)} | ${steps} | ${criterion.assertions.length} | ${criterion.riskLevel} |`;
  });
  const risks =
    run.plan.risks.length === 0
      ? "- No additional risks declared by the plan."
      : run.plan.risks
          .map((risk) => `- **${risk.level}** — ${escapeInline(risk.description)}`)
          .join("\n");

  return [
    "## Spec2Proof Execution Plan",
    "",
    `Run: \`${escapeInline(run.runId)}\``,
    `Commit: \`${shortSha(run.headSha)}\``,
    `Target: \`${escapeInline(run.targetEnvironment)}\``,
    ...(run.targetBaseUrl
      ? [`Base URL: \`${escapeInline(run.targetBaseUrl)}\``]
      : []),
    `Estimated duration: ${run.plan.estimatedDurationSeconds}s`,
    `Estimated tool calls: ${run.plan.estimatedToolCalls}`,
    "",
    "| Criterion | Steps | Assertions | Risk |",
    "|---|---:|---:|---|",
    ...rows,
    "",
    "### Declared risks",
    "",
    risks,
    "",
    "Approve this exact plan and commit:",
    "",
    "`/spec2proof approve`",
    "",
    "Reject it with a reason:",
    "",
    "`/spec2proof reject <reason>`",
  ].join("\n");
}

export function renderRunningComment(run: AcceptanceRun): string {
  return [
    "## Spec2Proof Running",
    "",
    `Commit: \`${shortSha(run.headSha)}\``,
    `Run: \`${escapeInline(run.runId)}\``,
    `Approved by: @${escapeInline(run.approvedBy ?? "unknown")}`,
    `Started: ${escapeInline(run.startedAt ?? "unknown")}`,
    "",
    "The approved plan is executing against the configured non-production target.",
    "",
    "Cancel:",
    "",
    "`/spec2proof cancel`",
  ].join("\n");
}

export function renderCompletedComment(run: AcceptanceRun): string {
  const ordered = [...run.results].sort(
    (left, right) => resultPriority(left) - resultPriority(right),
  );
  const counts = countResults(run.results);
  const sections = ordered.map(renderCriterionResult);

  return [
    `## Spec2Proof Result: ${run.verdict ?? "INCONCLUSIVE"}`,
    "",
    `Commit: \`${shortSha(run.headSha)}\``,
    `Coverage complete: ${run.coverageComplete ? "yes" : "no"}`,
    `Passed: ${counts.PASS} · Failed: ${counts.FAIL} · Needs human: ${counts.NEEDS_HUMAN} · Blocked: ${counts.BLOCKED}`,
    "",
    ...(run.cancellationReason
      ? ["### Cancellation", "", escapeInline(run.cancellationReason), ""]
      : []),
    ...sections,
    "",
    "### Next action",
    "",
    nextAction(run.verdict),
  ].join("\n");
}

export function renderStatusComment(run: AcceptanceRun | undefined): string {
  if (!run) {
    return "## Spec2Proof Status\n\nNo run exists for this pull request.";
  }
  if (run.lifecycle === "AWAITING_APPROVAL") {
    return renderPlanComment(run);
  }
  if (run.lifecycle === "RUNNING") {
    return renderRunningComment(run);
  }
  return renderCompletedComment(run);
}

export function renderCommandFailure(command: string, error: unknown): string {
  const message = error instanceof Error ? error.message : "Unknown command failure";
  return [
    "## Spec2Proof Command Failed",
    "",
    `Command: \`${escapeInline(command)}\``,
    "",
    truncate(escapeInline(message), 2_000),
    "",
    "No acceptance result was marked as PASS.",
  ].join("\n");
}

function renderCriterionResult(result: CriterionResult): string {
  return [
    `### ${result.status}: ${escapeInline(result.criterionId)}`,
    "",
    `Expected: \`${escapeInline(stringifyValue(result.expected))}\``,
    `Actual: \`${escapeInline(stringifyValue(result.actual))}\``,
    ...(result.failureCategory
      ? [`Failure category: \`${result.failureCategory}\``]
      : []),
    ...(result.explanation ? [`Explanation: ${escapeInline(result.explanation)}`] : []),
    `Evidence: ${
      result.evidenceIds.length > 0
        ? result.evidenceIds.map((id) => `\`${escapeInline(id)}\``).join(", ")
        : "none"
    }`,
    "",
  ].join("\n");
}

function countResults(results: CriterionResult[]): Record<CriterionResult["status"], number> {
  const counts: Record<CriterionResult["status"], number> = {
    PASS: 0,
    FAIL: 0,
    NEEDS_HUMAN: 0,
    BLOCKED: 0,
  };
  for (const result of results) {
    counts[result.status] += 1;
  }
  return counts;
}

function resultPriority(result: CriterionResult): number {
  switch (result.status) {
    case "FAIL":
      return 0;
    case "BLOCKED":
      return 1;
    case "NEEDS_HUMAN":
      return 2;
    case "PASS":
      return 3;
  }
}

function mapConclusion(
  verdict: RunVerdict | undefined,
): "success" | "failure" | "action_required" | "neutral" | "cancelled" {
  switch (verdict) {
    case "PASS":
      return "success";
    case "FAIL":
      return "failure";
    case "NEEDS_HUMAN":
      return "action_required";
    case "CANCELLED":
      return "cancelled";
    case "INCONCLUSIVE":
    default:
      return "neutral";
  }
}

function nextAction(verdict: RunVerdict | undefined): string {
  switch (verdict) {
    case "PASS":
      return "Review the evidence and make the human merge decision.";
    case "FAIL":
      return "Fix the failed acceptance criteria, push a new commit, then run `/spec2proof run`.";
    case "NEEDS_HUMAN":
      return "Complete the listed human checks before making the merge decision.";
    case "CANCELLED":
      return "Start a new plan with `/spec2proof run` when the PR is ready.";
    case "INCONCLUSIVE":
    default:
      return "Resolve the blocked environment or tool issue, then start a new run.";
  }
}

function pullRequestUrl(run: AcceptanceRun): string {
  return `https://github.com/${run.repository}/pull/${run.pullRequestNumber}`;
}

function shortSha(value: string): string {
  return value.slice(0, 12);
}

function escapeCell(value: string): string {
  return value.replace(/\|/gu, "\\|").replace(/\r?\n/gu, " ");
}

function escapeInline(value: string): string {
  return value.replace(/`/gu, "\\`").replace(/\r?\n/gu, " ");
}

function stringifyValue(value: unknown): string {
  const encoded = JSON.stringify(value);
  return encoded === undefined ? String(value) : encoded;
}

function truncate(value: string, limit: number): string {
  return value.length <= limit ? value : `${value.slice(0, limit - 24)}\n\n[output truncated]`;
}

export type { GitHubCheckRunRecord };
