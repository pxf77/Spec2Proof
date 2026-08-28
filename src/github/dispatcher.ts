import { z } from "zod";
import { RunService } from "../application/run-service.js";
import type {
  PullRequestReader,
  ReviewerAuthorizer,
  RunExecutionScheduler,
} from "../application/ports.js";
import type { Logger } from "../observability/logger.js";
import { parseSpec2ProofCommand, type Spec2ProofCommand } from "./webhook.js";
import type {
  GitHubInstallationClient,
  GitHubInstallationClientFactory,
} from "./client.js";
import {
  renderCommandFailure,
  renderStatusComment,
  upsertSpec2ProofSummary,
} from "./publisher.js";

const issueCommentEventSchema = z.object({
  action: z.string(),
  installation: z.object({ id: z.number().int().positive() }),
  repository: z.object({ full_name: z.string().min(3) }),
  issue: z.object({
    number: z.number().int().positive(),
    pull_request: z.unknown().optional(),
  }),
  comment: z.object({
    body: z.string(),
    user: z.object({
      login: z.string().min(1),
      type: z.string().optional(),
    }),
  }),
});

const pullRequestEventSchema = z.object({
  action: z.string(),
  installation: z.object({ id: z.number().int().positive() }),
  repository: z.object({ full_name: z.string().min(3) }),
  pull_request: z.object({
    number: z.number().int().positive(),
    head: z.object({ sha: z.string().min(7) }),
  }),
});

export interface GitHubWebhookDispatcherDependencies {
  runService: RunService;
  executionScheduler: RunExecutionScheduler;
  pullRequests: PullRequestReader;
  authorizer: ReviewerAuthorizer;
  clients: GitHubInstallationClientFactory;
  logger: Logger;
}

export class GitHubWebhookDispatcher {
  public constructor(private readonly dependencies: GitHubWebhookDispatcherDependencies) {}

  public async dispatch(
    eventName: string,
    payload: unknown,
    deliveryId: string,
  ): Promise<void> {
    if (eventName === "issue_comment") {
      await this.dispatchIssueComment(payload, deliveryId);
      return;
    }
    if (eventName === "pull_request") {
      await this.dispatchPullRequest(payload, deliveryId);
    }
  }

  private async dispatchIssueComment(payload: unknown, deliveryId: string): Promise<void> {
    const event = issueCommentEventSchema.parse(payload);
    if (
      event.action !== "created" ||
      event.issue.pull_request === undefined ||
      isBot(event.comment.user.login, event.comment.user.type)
    ) {
      return;
    }

    const command = parseSpec2ProofCommand(event.comment.body);
    if (!command) {
      return;
    }

    const context = {
      installationId: event.installation.id,
      repository: event.repository.full_name,
      pullRequestNumber: event.issue.number,
      actor: event.comment.user.login,
    };
    const client = this.dependencies.clients.forInstallation(context.installationId);

    this.dependencies.logger.info("github.command.received", {
      deliveryId,
      command: command.name,
      repository: context.repository,
      pullRequestNumber: context.pullRequestNumber,
      actor: context.actor,
    });

    try {
      switch (command.name) {
        case "run":
          await this.handleRun(context);
          break;
        case "approve":
          await this.handleApprove(context);
          break;
        case "reject":
          await this.handleReject(context, command);
          break;
        case "cancel":
          await this.handleCancel(context);
          break;
        case "rerun-failed":
          await this.handleRerunFailed(context, client);
          break;
        case "status":
          await this.handleStatus(context, client);
          break;
      }
    } catch (error) {
      this.dependencies.logger.error("github.command.failed", {
        deliveryId,
        command: command.name,
        repository: context.repository,
        pullRequestNumber: context.pullRequestNumber,
        error: error instanceof Error ? error.message : "unknown_error",
      });
      try {
        await client.createIssueComment(
          context.repository,
          context.pullRequestNumber,
          renderCommandFailure(`/spec2proof ${command.name}`, error),
        );
      } catch (feedbackError) {
        this.dependencies.logger.error("github.command.feedback_failed", {
          deliveryId,
          error: feedbackError instanceof Error ? feedbackError.message : "unknown_error",
        });
      }
    }
  }

  private async dispatchPullRequest(payload: unknown, deliveryId: string): Promise<void> {
    const event = pullRequestEventSchema.parse(payload);
    if (event.action !== "synchronize") {
      return;
    }

    const latest = await this.dependencies.runService.findLatestRun(
      event.repository.full_name,
      event.pull_request.number,
    );
    if (
      !latest ||
      latest.lifecycle === "COMPLETED" ||
      latest.headSha === event.pull_request.head.sha
    ) {
      return;
    }

    this.dependencies.logger.info("github.run.invalidated", {
      deliveryId,
      runId: latest.runId,
      previousHeadSha: latest.headSha,
      currentHeadSha: event.pull_request.head.sha,
    });
    await this.dependencies.runService.cancelRun(
      latest.runId,
      `Superseded by pull request head ${event.pull_request.head.sha}`,
    );
  }

  private async handleRun(context: CommandContext): Promise<void> {
    const input = await this.dependencies.pullRequests.read(context);
    const latest = await this.dependencies.runService.findLatestRun(
      context.repository,
      context.pullRequestNumber,
    );
    if (
      latest &&
      latest.headSha === input.headSha &&
      latest.lifecycle !== "COMPLETED"
    ) {
      await this.dependencies.runService.publishRun(latest.runId);
      return;
    }
    await this.dependencies.runService.prepareRun(input);
  }

  private async handleApprove(context: CommandContext): Promise<void> {
    await this.requireAuthorized(context);
    const latest = await this.requireLatest(context);
    const currentHeadSha = await this.dependencies.pullRequests.getHeadSha(context);
    const approved = await this.dependencies.runService.approveRun(
      latest.runId,
      context.actor,
      currentHeadSha,
    );
    await this.dependencies.executionScheduler.schedule(approved.runId);
  }

  private async handleReject(
    context: CommandContext,
    command: Extract<Spec2ProofCommand, { name: "reject" }>,
  ): Promise<void> {
    await this.requireAuthorized(context);
    const latest = await this.requireLatest(context);
    if (latest.lifecycle !== "AWAITING_APPROVAL") {
      throw new Error(`Run ${latest.runId} is not awaiting approval`);
    }
    await this.dependencies.runService.cancelRun(
      latest.runId,
      `Plan rejected by ${context.actor}: ${command.reason}`,
    );
  }

  private async handleCancel(context: CommandContext): Promise<void> {
    await this.requireAuthorized(context);
    const latest = await this.requireLatest(context);
    await this.dependencies.runService.cancelRun(
      latest.runId,
      `Cancelled by ${context.actor}`,
    );
  }

  private async handleRerunFailed(
    context: CommandContext,
    client: GitHubInstallationClient,
  ): Promise<void> {
    await this.requireAuthorized(context);
    const latest = await this.requireLatest(context);
    if (latest.lifecycle !== "COMPLETED") {
      throw new Error(`Run ${latest.runId} has not completed`);
    }

    const input = await this.dependencies.pullRequests.read(context);
    if (input.headSha !== latest.headSha) {
      throw new Error("The pull request head changed; start a full run instead");
    }

    const failedIds = new Set(
      latest.results
        .filter((result) => result.status === "FAIL" || result.status === "BLOCKED")
        .map((result) => result.criterionId),
    );
    if (failedIds.size === 0) {
      await client.createIssueComment(
        context.repository,
        context.pullRequestNumber,
        "## Spec2Proof\n\nThere are no failed or blocked criteria to rerun.",
      );
      return;
    }

    const criteria = input.criteria.filter((criterion) => failedIds.has(criterion.id));
    if (criteria.length === 0) {
      throw new Error("Failed criteria are no longer present in the pull request SPEC");
    }
    await this.dependencies.runService.prepareRun({ ...input, criteria });
  }

  private async handleStatus(
    context: CommandContext,
    client: GitHubInstallationClient,
  ): Promise<void> {
    const latest = await this.dependencies.runService.findLatestRun(
      context.repository,
      context.pullRequestNumber,
    );
    await upsertSpec2ProofSummary(
      client,
      context.repository,
      context.pullRequestNumber,
      renderStatusComment(latest),
    );
  }

  private async requireAuthorized(context: CommandContext): Promise<void> {
    const authorized = await this.dependencies.authorizer.canApprove({
      installationId: context.installationId,
      repository: context.repository,
      username: context.actor,
    });
    if (!authorized) {
      throw new Error(
        `User ${context.actor} needs write, maintain, or admin permission for this command`,
      );
    }
  }

  private async requireLatest(context: CommandContext) {
    const latest = await this.dependencies.runService.findLatestRun(
      context.repository,
      context.pullRequestNumber,
    );
    if (!latest) {
      throw new Error("No Spec2Proof run exists for this pull request");
    }
    return latest;
  }
}

interface CommandContext {
  installationId: number;
  repository: string;
  pullRequestNumber: number;
  actor: string;
}

function isBot(login: string, type: string | undefined): boolean {
  return type === "Bot" || login.endsWith("[bot]");
}
