import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { EvidenceRecord, EvidenceStore } from "../application/ports.js";

export class LocalFileEvidenceStore implements EvidenceStore {
  public constructor(private readonly rootDirectory: string) {}

  public async save(input: {
    runId: string;
    criterionId: string;
    kind: string;
    contentType: string;
    content: string | Uint8Array;
  }): Promise<EvidenceRecord> {
    const evidenceId = `evidence-${randomUUID()}`;
    const extension = extensionFor(input.contentType);
    const directory = path.join(
      this.rootDirectory,
      safeSegment(input.runId),
      safeSegment(input.criterionId),
    );
    await mkdir(directory, { recursive: true });
    const location = path.join(directory, `${safeSegment(input.kind)}-${evidenceId}.${extension}`);
    await writeFile(location, input.content);
    return { id: evidenceId, location, contentType: input.contentType };
  }
}

function safeSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]/gu, "_");
}

function extensionFor(contentType: string): string {
  switch (contentType) {
    case "image/png":
      return "png";
    case "application/json":
      return "json";
    default:
      return "txt";
  }
}
