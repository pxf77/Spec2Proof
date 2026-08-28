import { createHash } from "node:crypto";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  TransactWriteCommand,
} from "@aws-sdk/lib-dynamodb";
import type { RunStore } from "../application/ports.js";
import type {
  AcceptanceRun,
  RunLifecycle,
} from "../domain/model.js";

interface RunItem {
  runId: string;
  itemType: "RUN";
  run: AcceptanceRun;
}

interface LatestRunPointer {
  runId: string;
  itemType: "LATEST";
  latestRunId: string;
}

export class DynamoDbRunStore implements RunStore {
  public constructor(
    private readonly tableName: string,
    private readonly client = DynamoDBDocumentClient.from(new DynamoDBClient({})),
  ) {}

  public async get(runId: string): Promise<AcceptanceRun | undefined> {
    const response = await this.client.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { runId },
        ConsistentRead: true,
      }),
    );
    return toRun(response.Item);
  }

  public async findLatest(
    repository: string,
    pullRequestNumber: number,
  ): Promise<AcceptanceRun | undefined> {
    const pointerResponse = await this.client.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { runId: latestPointerKey(repository, pullRequestNumber) },
        ConsistentRead: true,
      }),
    );
    const latestRunId = pointerResponse.Item?.latestRunId;
    return typeof latestRunId === "string" ? this.get(latestRunId) : undefined;
  }

  public async save(run: AcceptanceRun): Promise<void> {
    const runItem = toRunItem(run);
    const pointer: LatestRunPointer = {
      runId: latestPointerKey(run.repository, run.pullRequestNumber),
      itemType: "LATEST",
      latestRunId: run.runId,
    };

    await this.client.send(
      new TransactWriteCommand({
        TransactItems: [
          { Put: { TableName: this.tableName, Item: runItem } },
          { Put: { TableName: this.tableName, Item: pointer } },
        ],
      }),
    );
  }

  public async saveIfLifecycle(
    run: AcceptanceRun,
    expected: RunLifecycle,
  ): Promise<boolean> {
    try {
      await this.client.send(
        new PutCommand({
          TableName: this.tableName,
          Item: toRunItem(run),
          ConditionExpression: "#run.#lifecycle = :expected",
          ExpressionAttributeNames: {
            "#run": "run",
            "#lifecycle": "lifecycle",
          },
          ExpressionAttributeValues: { ":expected": expected },
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
}

function toRunItem(run: AcceptanceRun): RunItem {
  return {
    runId: run.runId,
    itemType: "RUN",
    run: structuredClone(run),
  };
}

function toRun(item: Record<string, unknown> | undefined): AcceptanceRun | undefined {
  if (item?.itemType !== "RUN") {
    return undefined;
  }
  const run = item.run;
  if (!run || typeof run !== "object" || Array.isArray(run)) {
    return undefined;
  }
  return structuredClone(run as AcceptanceRun);
}

function latestPointerKey(repository: string, pullRequestNumber: number): string {
  const digest = createHash("sha256")
    .update(`${repository.toLowerCase()}#${pullRequestNumber}`)
    .digest("hex");
  return `latest-${digest}`;
}

function isConditionalCheckFailure(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "ConditionalCheckFailedException" ||
      error.message.includes("ConditionalCheckFailedException"))
  );
}
