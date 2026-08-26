import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { loadAwsWebhookEnvironment } from "../config/env.js";
import { DynamoDbDeliveryTracker } from "../aws/dynamo-delivery-tracker.js";
import { SecretsManagerGitHubAppCredentials } from "../aws/github-app-secret.js";
import { SqsWebhookQueue } from "../aws/sqs-webhook-queue.js";
import { GitHubWebhookIngress } from "../webhook/ingress.js";

const environment = loadAwsWebhookEnvironment();
const ingress = new GitHubWebhookIngress({
  secretProvider: new SecretsManagerGitHubAppCredentials(
    environment.GITHUB_APP_SECRET_ARN,
  ),
  deliveries: new DynamoDbDeliveryTracker(environment.SPEC2PROOF_DELIVERY_TABLE),
  queue: new SqsWebhookQueue(environment.SPEC2PROOF_WEBHOOK_QUEUE_URL),
});

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const body = event.body
    ? Buffer.from(event.body, event.isBase64Encoded ? "base64" : "utf8")
    : Buffer.alloc(0);
  const result = await ingress.handle({
    method: event.requestContext.http.method,
    path: event.rawPath,
    headers: event.headers,
    body,
  });

  return {
    statusCode: result.statusCode,
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify(result.body),
  };
};
