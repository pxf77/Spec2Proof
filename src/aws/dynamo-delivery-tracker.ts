import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  PutCommand,
} from "@aws-sdk/lib-dynamodb";
import type { DeliveryTracker } from "../webhook/ingress.js";

export class DynamoDbDeliveryTracker implements DeliveryTracker {
  public constructor(
    private readonly tableName: string,
    private readonly client = DynamoDBDocumentClient.from(new DynamoDBClient({})),
    private readonly ttlSeconds = 24 * 60 * 60,
    private readonly now: () => number = Date.now,
  ) {}

  public async claim(deliveryId: string): Promise<boolean> {
    try {
      await this.client.send(
        new PutCommand({
          TableName: this.tableName,
          Item: {
            deliveryId,
            expiresAt: Math.floor(this.now() / 1_000) + this.ttlSeconds,
          },
          ConditionExpression: "attribute_not_exists(deliveryId)",
        }),
      );
      return true;
    } catch (error) {
      if (isConditionalCheckFailure(error)) {
        return false;
      }
      throw error;
    }
  }

  public async release(deliveryId: string): Promise<void> {
    await this.client.send(
      new DeleteCommand({ TableName: this.tableName, Key: { deliveryId } }),
    );
  }
}

function isConditionalCheckFailure(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "ConditionalCheckFailedException" ||
      error.message.includes("ConditionalCheckFailedException"))
  );
}
