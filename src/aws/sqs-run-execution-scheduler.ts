import { createHash } from "node:crypto";
import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import type { RunExecutionScheduler } from "../application/ports.js";

export class SqsRunExecutionScheduler implements RunExecutionScheduler {
  public constructor(
    private readonly queueUrl: string,
    private readonly client = new SQSClient({}),
  ) {}

  public async schedule(runId: string): Promise<void> {
    const digest = createHash("sha256").update(runId).digest("hex");
    await this.client.send(
      new SendMessageCommand({
        QueueUrl: this.queueUrl,
        MessageBody: JSON.stringify({ runId }),
        MessageGroupId: digest,
        MessageDeduplicationId: digest,
      }),
    );
  }
}
