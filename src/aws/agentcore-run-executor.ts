import { randomUUID } from "node:crypto";
import {
  BedrockAgentCoreClient,
  InvokeAgentRuntimeCommand,
} from "@aws-sdk/client-bedrock-agentcore";
import type { RunExecutor } from "../application/ports.js";
import type { AcceptanceRun, CriterionResult } from "../domain/model.js";
import { runtimeExecutionResponseSchema } from "../agent/schemas.js";

export interface AgentCoreRunExecutorOptions {
  agentRuntimeArn: string;
  qualifier?: string;
  timeoutMs: number;
  client?: BedrockAgentCoreClient;
}

export class AgentCoreRunExecutor implements RunExecutor {
  private readonly client: BedrockAgentCoreClient;
  private readonly controllers = new Map<string, AbortController>();

  public constructor(private readonly options: AgentCoreRunExecutorOptions) {
    this.client = options.client ?? new BedrockAgentCoreClient({});
  }

  public async execute(
    run: AcceptanceRun,
    externalSignal?: AbortSignal,
  ): Promise<CriterionResult[]> {
    const controller = new AbortController();
    this.controllers.set(run.runId, controller);
    const forwardAbort = (): void => controller.abort(externalSignal?.reason);
    externalSignal?.addEventListener("abort", forwardAbort, { once: true });
    const timeout = setTimeout(
      () => controller.abort(new Error("AgentCore Runtime invocation timed out")),
      this.options.timeoutMs,
    );

    try {
      const response = await this.client.send(
        new InvokeAgentRuntimeCommand({
          agentRuntimeArn: this.options.agentRuntimeArn,
          runtimeSessionId: runtimeSessionId(run.runId),
          payload: JSON.stringify({ run }),
          contentType: "application/json",
          accept: "application/json",
          qualifier: this.options.qualifier ?? "DEFAULT",
        }),
        { abortSignal: controller.signal },
      );
      const text = await response.response?.transformToString();
      if (!text) {
        throw new Error("AgentCore Runtime returned an empty response");
      }

      const firstPass = JSON.parse(text) as unknown;
      const payload = typeof firstPass === "string" ? JSON.parse(firstPass) : firstPass;
      const parsed = runtimeExecutionResponseSchema.parse(payload);
      if (parsed.runId !== run.runId) {
        throw new Error(
          `AgentCore Runtime runId mismatch: expected ${run.runId}, got ${parsed.runId}`,
        );
      }
      return parsed.results as CriterionResult[];
    } finally {
      clearTimeout(timeout);
      externalSignal?.removeEventListener("abort", forwardAbort);
      this.controllers.delete(run.runId);
    }
  }

  public async cancel(runId: string): Promise<void> {
    this.controllers.get(runId)?.abort(new Error(`Run cancelled: ${runId}`));
  }
}

function runtimeSessionId(runId: string): string {
  const sanitized = runId.replace(/[^a-zA-Z0-9-]/gu, "-").slice(0, 200);
  return sanitized.length >= 33 ? sanitized : `${sanitized}-${randomUUID()}`;
}
