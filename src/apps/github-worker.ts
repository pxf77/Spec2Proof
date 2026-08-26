import type { SQSBatchResponse, SQSEvent } from "aws-lambda";
import { Agent, BedrockModel } from "@strands-agents/sdk";
import { RunService } from "../application/run-service.js";
import { AgentCoreRunExecutor } from "../aws/agentcore-run-executor.js";
import { DynamoDbRunStore } from "../aws/dynamo-run-store.js";
import { SecretsManagerGitHubAppCredentials } from "../aws/github-app-secret.js";
import { RandomIdGenerator, SystemClock } from "../adapters/memory.js";
import { StrandsPlanGenerator } from "../agent/strands-plan-generator.js";
import { PLANNING_SYSTEM_PROMPT } from "../agent/system-prompt.js";
import { loadAwsWorkerEnvironment } from "../config/env.js";
import {
  GitHubAppTokenProvider,
  GitHubClientFactory,
} from "../github/client.js";
import { GitHubWebhookDispatcher } from "../github/dispatcher.js";
import {
  GitHubPullRequestReader,
  GitHubReviewerAuthorizer,
} from "../github/pull-request.js";
import { GitHubRunPublisher } from "../github/publisher.js";
import { createLogger } from "../observability/logger.js";
import { githubWebhookMessageSchema } from "../webhook/message.js";

const environment = loadAwsWorkerEnvironment();
const logger = createLogger(environment.LOG_LEVEL);
const credentials = new SecretsManagerGitHubAppCredentials(
  environment.GITHUB_APP_SECRET_ARN,
);
let dispatcherPromise: Promise<GitHubWebhookDispatcher> | undefined;

export async function handler(event: SQSEvent): Promise<SQSBatchResponse> {
  const dispatcher = await (dispatcherPromise ??= createDispatcher());
  const batchItemFailures: SQSBatchResponse["batchItemFailures"] = [];

  for (const record of event.Records) {
    try {
      const message = githubWebhookMessageSchema.parse(JSON.parse(record.body));
      await dispatcher.dispatch(message.eventName, message.payload, message.deliveryId);
    } catch (error) {
      logger.error("github.worker.record_failed", {
        messageId: record.messageId,
        error: error instanceof Error ? error.message : "unknown_error",
      });
      batchItemFailures.push({ itemIdentifier: record.messageId });
    }
  }

  return { batchItemFailures };
}

async function createDispatcher(): Promise<GitHubWebhookDispatcher> {
  const github = await credentials.getCredentials();
  const tokenProvider = new GitHubAppTokenProvider({
    appId: github.appId,
    privateKey: github.privateKey,
    apiBaseUrl: environment.GITHUB_API_URL,
  });
  const clients = new GitHubClientFactory(tokenProvider, environment.GITHUB_API_URL);
  const publisher = new GitHubRunPublisher(clients);
  const model = new BedrockModel({
    modelId: environment.SPEC2PROOF_MODEL_ID,
    region: environment.AWS_REGION,
    temperature: 0,
  });
  const service = new RunService({
    planGenerator: new StrandsPlanGenerator(
      new Agent({
        model,
        systemPrompt: PLANNING_SYSTEM_PROMPT,
        printer: false,
      }),
    ),
    executor: new AgentCoreRunExecutor({
      agentRuntimeArn: environment.SPEC2PROOF_AGENT_RUNTIME_ARN,
      qualifier: environment.SPEC2PROOF_AGENT_RUNTIME_QUALIFIER,
      timeoutMs: environment.SPEC2PROOF_AGENT_RUNTIME_TIMEOUT_SECONDS * 1_000,
    }),
    store: new DynamoDbRunStore(
      environment.SPEC2PROOF_RUNS_TABLE,
      environment.SPEC2PROOF_RUNS_PR_INDEX,
    ),
    publisher,
    clock: new SystemClock(),
    ids: new RandomIdGenerator(),
  });

  return new GitHubWebhookDispatcher({
    runService: service,
    pullRequests: new GitHubPullRequestReader(
      clients,
      environment.SPEC2PROOF_MAX_CHANGED_FILES,
      environment.SPEC2PROOF_MAX_PATCH_CHARS_PER_FILE,
    ),
    authorizer: new GitHubReviewerAuthorizer(clients),
    clients,
    logger,
  });
}
