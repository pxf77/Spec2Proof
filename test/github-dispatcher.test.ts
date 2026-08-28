import assert from "node:assert/strict";
import test from "node:test";
import { RunService } from "../src/application/run-service.js";
import type {
  PullRequestReader,
  ReviewerAuthorizer,
} from "../src/application/ports.js";
import { DirectRunExecutionScheduler } from "../src/adapters/run-execution-scheduler.js";
import { InMemoryRunStore } from "../src/adapters/memory.js";
import { DeterministicPlanGenerator, ScriptedRunExecutor } from "../src/adapters/local.js";
import type { PrepareRunInput } from "../src/domain/model.js";
import type {
  GitHubCheckRunRecord,
  GitHubInstallationClient,
  GitHubInstallationClientFactory,
  GitHubIssueCommentRecord,
  GitHubPullRequestFileRecord,
  GitHubPullRequestRecord,
} from "../src/github/client.js";
import { GitHubWebhookDispatcher } from "../src/github/dispatcher.js";
import type { Logger } from "../src/observability/logger.js";

class FixedClock {
  public now(): Date {
    return new Date("2026-08-26T12:00:00.000Z");
  }
}

class FixedIds {
  public next(): string {
    return "run-001";
  }
}

class RecordingPublisher {
  public readonly events: string[] = [];
  public async planReady(): Promise<void> {
    this.events.push("plan.ready");
  }
  public async runStarted(): Promise<void> {
    this.events.push("run.started");
  }
  public async runCompleted(): Promise<void> {
    this.events.push("run.completed");
  }
}

class FakePullRequestReader implements PullRequestReader {
  public async read(input: {
    installationId: number;
    repository: string;
    pullRequestNumber: number;
  }): Promise<PrepareRunInput> {
    return {
      ...input,
      headSha: "abcdef1234567890",
      targetEnvironment: "staging",
      targetBaseUrl: "https://staging.example.com",
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
    };
  }

  public async getHeadSha(): Promise<string> {
    return "abcdef1234567890";
  }
}

class AllowReviewer implements ReviewerAuthorizer {
  public async canApprove(): Promise<boolean> {
    return true;
  }
}

class FakeClient implements GitHubInstallationClient {
  public readonly comments: string[] = [];
  public async getPullRequest(): Promise<GitHubPullRequestRecord> {
    throw new Error("not used");
  }
  public async listPullRequestFiles(): Promise<GitHubPullRequestFileRecord[]> {
    return [];
  }
  public async getCollaboratorPermission(): Promise<string> {
    return "write";
  }
  public async listIssueComments(): Promise<GitHubIssueCommentRecord[]> {
    return [];
  }
  public async createIssueComment(
    _repository: string,
    _issueNumber: number,
    body: string,
  ): Promise<GitHubIssueCommentRecord> {
    this.comments.push(body);
    return { id: this.comments.length, body };
  }
  public async updateIssueComment(): Promise<GitHubIssueCommentRecord> {
    throw new Error("not used");
  }
  public async listCheckRuns(): Promise<GitHubCheckRunRecord[]> {
    return [];
  }
  public async createCheckRun(): Promise<GitHubCheckRunRecord> {
    throw new Error("not used");
  }
  public async updateCheckRun(): Promise<GitHubCheckRunRecord> {
    throw new Error("not used");
  }
}

class FakeFactory implements GitHubInstallationClientFactory {
  public readonly client = new FakeClient();
  public forInstallation(): GitHubInstallationClient {
    return this.client;
  }
}

const logger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

test("dispatches run and approve commands through the real run lifecycle", async () => {
  const store = new InMemoryRunStore();
  const publisher = new RecordingPublisher();
  const runService = new RunService({
    planGenerator: new DeterministicPlanGenerator(),
    executor: new ScriptedRunExecutor(),
    store,
    publisher,
    clock: new FixedClock(),
    ids: new FixedIds(),
  });
  const dispatcher = new GitHubWebhookDispatcher({
    runService,
    executionScheduler: new DirectRunExecutionScheduler(runService),
    pullRequests: new FakePullRequestReader(),
    authorizer: new AllowReviewer(),
    clients: new FakeFactory(),
    logger,
  });

  await dispatcher.dispatch(
    "issue_comment",
    issueCommentPayload("/spec2proof run"),
    "delivery-run",
  );
  const prepared = await runService.findLatestRun("pxf77/Spec2Proof", 7);
  assert.equal(prepared?.lifecycle, "AWAITING_APPROVAL");

  await dispatcher.dispatch(
    "issue_comment",
    issueCommentPayload("/spec2proof approve"),
    "delivery-approve",
  );
  const completed = await runService.findLatestRun("pxf77/Spec2Proof", 7);
  assert.equal(completed?.lifecycle, "COMPLETED");
  assert.equal(completed?.verdict, "PASS");
  assert.deepEqual(publisher.events, ["plan.ready", "run.started", "run.completed"]);
});

function issueCommentPayload(body: string): unknown {
  return {
    action: "created",
    installation: { id: 42 },
    repository: { full_name: "pxf77/Spec2Proof" },
    issue: { number: 7, pull_request: { url: "https://api.github.test/pulls/7" } },
    comment: {
      body,
      user: { login: "reviewer", type: "User" },
    },
  };
}
