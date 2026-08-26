import assert from "node:assert/strict";
import test from "node:test";
import type { AcceptanceRun } from "../src/domain/model.js";
import type {
  GitHubCheckRunRecord,
  GitHubInstallationClient,
  GitHubInstallationClientFactory,
  GitHubIssueCommentRecord,
  GitHubPullRequestFileRecord,
  GitHubPullRequestRecord,
} from "../src/github/client.js";
import { GitHubRunPublisher } from "../src/github/publisher.js";

class FakeGitHubClient implements GitHubInstallationClient {
  public readonly checks: Array<GitHubCheckRunRecord & Record<string, unknown>> = [];
  public readonly comments: GitHubIssueCommentRecord[] = [];

  public async getPullRequest(): Promise<GitHubPullRequestRecord> {
    throw new Error("not used");
  }
  public async listPullRequestFiles(): Promise<GitHubPullRequestFileRecord[]> {
    throw new Error("not used");
  }
  public async getCollaboratorPermission(): Promise<string> {
    throw new Error("not used");
  }
  public async listIssueComments(): Promise<GitHubIssueCommentRecord[]> {
    return this.comments.map((comment) => ({ ...comment }));
  }
  public async createIssueComment(
    _repository: string,
    _issueNumber: number,
    body: string,
  ): Promise<GitHubIssueCommentRecord> {
    const comment = { id: this.comments.length + 1, body };
    this.comments.push(comment);
    return { ...comment };
  }
  public async updateIssueComment(
    _repository: string,
    commentId: number,
    body: string,
  ): Promise<GitHubIssueCommentRecord> {
    const comment = this.comments.find((candidate) => candidate.id === commentId);
    assert.ok(comment);
    comment.body = body;
    return { ...comment };
  }
  public async listCheckRuns(): Promise<GitHubCheckRunRecord[]> {
    return this.checks.map((check) => ({ ...check }));
  }
  public async createCheckRun(
    _repository: string,
    body: Record<string, unknown>,
  ): Promise<GitHubCheckRunRecord> {
    const check: GitHubCheckRunRecord & Record<string, unknown> = {
      id: this.checks.length + 1,
      name: String(body.name),
      head_sha: String(body.head_sha),
      external_id: typeof body.external_id === "string" ? body.external_id : null,
      status: String(body.status),
      conclusion: typeof body.conclusion === "string" ? body.conclusion : null,
    };
    Object.assign(check, body);
    this.checks.push(check);
    return { ...check };
  }
  public async updateCheckRun(
    _repository: string,
    checkRunId: number,
    body: Record<string, unknown>,
  ): Promise<GitHubCheckRunRecord> {
    const check = this.checks.find((candidate) => candidate.id === checkRunId);
    assert.ok(check);
    Object.assign(check, body);
    check.status = String(body.status ?? check.status);
    check.conclusion =
      typeof body.conclusion === "string" ? body.conclusion : check.conclusion;
    return { ...check };
  }
}

class FakeFactory implements GitHubInstallationClientFactory {
  public constructor(public readonly client: FakeGitHubClient) {}
  public forInstallation(): GitHubInstallationClient {
    return this.client;
  }
}

test("upserts one Check Run and one PR comment across the run lifecycle", async () => {
  const client = new FakeGitHubClient();
  const publisher = new GitHubRunPublisher(new FakeFactory(client));
  const run = sampleRun();

  await publisher.planReady(run);
  assert.equal(client.checks.length, 1);
  assert.equal(client.checks[0]?.status, "queued");
  assert.equal(client.comments.length, 1);
  assert.match(client.comments[0]?.body ?? "", /Execution Plan/u);

  const running: AcceptanceRun = {
    ...run,
    lifecycle: "RUNNING",
    approvedBy: "reviewer",
    approvedAt: "2026-08-26T12:01:00.000Z",
    startedAt: "2026-08-26T12:01:00.000Z",
  };
  await publisher.runStarted(running);
  assert.equal(client.checks.length, 1);
  assert.equal(client.checks[0]?.status, "in_progress");
  assert.equal(client.comments.length, 1);
  assert.match(client.comments[0]?.body ?? "", /Running/u);

  const completed: AcceptanceRun = {
    ...running,
    lifecycle: "COMPLETED",
    verdict: "PASS",
    coverageComplete: true,
    completedAt: "2026-08-26T12:02:00.000Z",
    results: [
      {
        criterionId: "AC-001",
        status: "PASS",
        expected: { type: "text", value: "Dashboard" },
        actual: "Dashboard",
        evidenceIds: ["evidence-1"],
        startedAt: "2026-08-26T12:01:00.000Z",
        completedAt: "2026-08-26T12:02:00.000Z",
      },
    ],
  };
  await publisher.runCompleted(completed);
  assert.equal(client.checks.length, 1);
  assert.equal(client.checks[0]?.status, "completed");
  assert.equal(client.checks[0]?.conclusion, "success");
  assert.equal(client.comments.length, 1);
  assert.match(client.comments[0]?.body ?? "", /Result: PASS/u);
});

function sampleRun(): AcceptanceRun {
  return {
    runId: "run-001",
    installationId: 42,
    repository: "pxf77/Spec2Proof",
    pullRequestNumber: 7,
    headSha: "abcdef1234567890",
    targetEnvironment: "staging",
    lifecycle: "AWAITING_APPROVAL",
    coverageComplete: false,
    criteria: [
      {
        id: "AC-001",
        sourceRef: "PR#7:spec2proof/AC-001",
        description: "Dashboard is visible",
        preconditions: [],
        expectedOutcomes: [{ type: "text", value: "Dashboard" }],
        automationClass: "AUTO",
      },
    ],
    plan: {
      runId: "run-001",
      repository: "pxf77/Spec2Proof",
      pullRequestNumber: 7,
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
              expected: { type: "text", value: "Dashboard" },
            },
          ],
          requiredEvidence: ["assertion", "screenshot"],
          riskLevel: "LOW",
        },
      ],
      estimatedToolCalls: 4,
      estimatedDurationSeconds: 45,
      risks: [],
    },
    results: [],
    createdAt: "2026-08-26T12:00:00.000Z",
  };
}
