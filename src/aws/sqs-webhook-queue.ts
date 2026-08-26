import { createHash } from "node:crypto";
import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import type { WebhookQueue } from "../webhook/ingress.js";
import {
  webhookDispatchGroup,
  type GitHubWebhookMessage,
} from "../webhook/message.js";

export class SqsWebhookQueue implements WebhookQueue {
  public constructor(
    private readonly queueUrl: string,
    private readonly client = new SQSClient({}),
  ) {}

  public async enqueue(message: GitHubWebhookMessage): Promise<void> {
    await this.client.send(
      new SendMessageCommand({
        QueueUrl: this.queueUrl,
        MessageBody: JSON.stringify(message),
        MessageGroupId: webhookDispatchGroup(message),
        MessageDeduplicationId: createHash("sha256")
          .update(message.deliveryId)
          .digest("hex"),
      }),
    );
  }
}
