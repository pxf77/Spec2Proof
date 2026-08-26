import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
} from "@aws-sdk/lib-dynamodb";
import type { RunStore } from "../application/ports.js";
import type { AcceptanceRun } from "../domain/model.js";

interface RunItem {
  runId: string;
  prKey: string;
  createdAt: string;
  run: AcceptanceRun;
}

export class DynamoDbRunStore implements RunStore {
  public constructor(
    private readonly tableName: string,
    private readonly prIndexName: string,
    private readonly client = DynamoDBDocumentClient.from(new DynamoDBClient({})),
  ) {}

  public async get(runId: string): Promise<AcceptanceRun | undefined> {
    const response = await this.client.send(
      new GetCommand({ TableName: this.tableName, Key: { runId } }),
    );
    return toRun(response.Item);
  }

  public async findLatest(
    repository: string,
    pullRequestNumber: number,
  ): Promise<AcceptanceRun | undefined> {
    const response = await this.client.send(
      new QueryCommand({
        TableName: this.tableName,
        IndexName: this.prIndexName,
        KeyConditionExpression: "prKey = :prKey",
        ExpressionAttributeValues: {
          ":prKey": prKey(repository, pullRequestNumber),
        },
        ScanIndexForward: false,
        Limit: 1,
      }),
    );
    return toRun(response.Items?.[0]);
  }

  public async save(run: AcceptanceRun): Promise<void> {
    const item: RunItem = {
      runId: run.runId,
      prKey: prKey(run.repository, run.pullRequestNumber),
      createdAt: run.createdAt,
      run: structuredClone(run),
    };
    await this.client.send(new PutCommand({ TableName: this.tableName, Item: item }));
  }
}

function prKey(repository: string, pullRequestNumber: number): string {
  return `${repository.toLowerCase()}#${pullRequestNumber}`;
}

function toRun(item: Record<string, unknown> | undefined): AcceptanceRun | undefined {
  const run = item?.run;
  if (!run || typeof run !== "object" || Array.isArray(run)) {
    return undefined;
  }
  return structuredClone(run as AcceptanceRun);
}
