import { randomUUID } from "node:crypto";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { EvidenceRecord, EvidenceStore } from "../application/ports.js";

export class S3EvidenceStore implements EvidenceStore {
  public constructor(
    private readonly bucket: string,
    private readonly prefix = "spec2proof",
    private readonly client = new S3Client({}),
  ) {}

  public async save(input: {
    runId: string;
    criterionId: string;
    kind: string;
    contentType: string;
    content: string | Uint8Array;
  }): Promise<EvidenceRecord> {
    const key = [
      cleanSegment(this.prefix),
      cleanSegment(input.runId),
      cleanSegment(input.criterionId),
      `${Date.now()}-${randomUUID()}-${cleanSegment(input.kind)}${extension(input.contentType)}`,
    ]
      .filter(Boolean)
      .join("/");

    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: input.content,
        ContentType: input.contentType,
        ServerSideEncryption: "AES256",
      }),
    );

    const location = `s3://${this.bucket}/${key}`;
    return { id: location, location, contentType: input.contentType };
  }
}

function cleanSegment(value: string): string {
  return value
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 160);
}

function extension(contentType: string): string {
  if (contentType === "image/png") {
    return ".png";
  }
  if (contentType === "application/json") {
    return ".json";
  }
  return ".txt";
}
