import type { SQSBatchResponse, SQSEvent } from "aws-lambda";
import { RunService } from "../application/run-service.js";
import { AgentCoreRunExecutor } from "../aws/agentcore-run-executor.js";
import { DynamoDbRunStore } from "../aws/dynamo-run-store.js";
import { SecretsManagerGitHubAppCredentials } from "../aws/github-app-secret.js";
import { RandomIdGenerator, SystemClock } from "../adapters/memory.js";
import { loadAwsExecutionWorkerEnvironment } from "../config/env.js";
import {
  GitHubAppTokenProvider,
  GitHubClientFactory,
} from "../github/client.js";
import { GitHubRunPublisher } from "../github/publisher.js";
import { createLogger } from "../observability/logger.js";
import { runExecutionMessageSchema } from "../execution/message.js";

const environment = loadAwsExecutionWorkerEnvironment();
const logger = createLogger(environment.LOG_LEVEL);
const credentials = new SecretsManagerGitHubAppCredentials(
  environment.GITHUB_APP_SECRET_ARN,
);
let servicePromise: Promise<RunService> | undefined;

export async function handler(event: SQSEvent): Promise<SQSBatchResponse> {
  const service = await (servicePromise ??= createService());
  const batchItemFailures: SQSBatchResponse["batchItemFailures"] = [];

  for (const record of event.Records) {
    try {
      const message = runExecutionMessageSchema.parse(JSON.parse(record.body));
      await service.executeRun(message.runId);
    } catch (error) {
      logger.error("run.execution_worker.record_failed", {
        messageId: record.messageId,
        error: error instanceof Error ? error.message : "unknown_error",
      });
      batchItemFailures.push({ itemIdentifier: record.messageId });
    }
  }

  return { batchItemFailures };
}

async function createService(): Promise<RunService> {
  const github = await credentials.getCredentials();
  const tokenProvider = new GitHubAppTokenProvider({
    appId: github.appId,
    privateKey: github.privateKey,
    apiBaseUrl: environment.GITHUB_API_URL,
  });
  const clients = new GitHubClientFactory(tokenProvider, environment.GITHUB_API_URL);

  return new RunService({
    planGenerator: {
      generate: async () => {
        throw new Error("Planning is not available in the execution worker");
      },
    },
    executor: new AgentCoreRunExecutor({
      agentRuntimeArn: environment.SPEC2PROOF_AGENT_RUNTIME_ARN,
      qualifier: environment.SPEC2PROOF_AGENT_RUNTIME_QUALIFIER,
      timeoutMs: environment.SPEC2PROOF_AGENT_RUNTIME_TIMEOUT_SECONDS * 1_000,
    }),
    store: new DynamoDbRunStore(environment.SPEC2PROOF_RUNS_TABLE),
    publisher: new GitHubRunPublisher(clients),
    clock: new SystemClock(),
    ids: new RandomIdGenerator(),
  });
}
