import type { RunExecutor } from "../application/ports.js";
import type { AcceptanceRun, CriterionResult } from "../domain/model.js";
import { runtimeExecutionResponseSchema } from "../agent/schemas.js";

export interface AgentRuntimeRunExecutorOptions {
  endpoint: string;
  timeoutMs: number;
  fetch?: typeof globalThis.fetch;
}

export class AgentRuntimeRunExecutor implements RunExecutor {
  private readonly fetch: typeof globalThis.fetch;
  private readonly controllers = new Map<string, AbortController>();

  public constructor(private readonly options: AgentRuntimeRunExecutorOptions) {
    this.fetch = options.fetch ?? globalThis.fetch;
  }

  public async execute(
    run: AcceptanceRun,
    externalSignal?: AbortSignal,
  ): Promise<CriterionResult[]> {
    const controller = new AbortController();
    this.controllers.set(run.runId, controller);

    const onExternalAbort = (): void => controller.abort(externalSignal?.reason);
    externalSignal?.addEventListener("abort", onExternalAbort, { once: true });
    const timeout = setTimeout(
      () => controller.abort(new Error("Agent runtime request timed out")),
      this.options.timeoutMs,
    );

    try {
      const response = await this.fetch(this.options.endpoint, {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          "x-amzn-bedrock-agentcore-runtime-session-id": run.runId,
        },
        body: JSON.stringify({ run }),
        signal: controller.signal,
      });

      const text = await response.text();
      if (!response.ok) {
        throw new Error(
          `Agent runtime returned HTTP ${response.status}${formatResponseDetail(text)}`,
        );
      }

      const firstPass = text.length > 0 ? (JSON.parse(text) as unknown) : undefined;
      const payload = typeof firstPass === "string" ? JSON.parse(firstPass) : firstPass;
      const parsed = runtimeExecutionResponseSchema.parse(payload);
      if (parsed.runId !== run.runId) {
        throw new Error(
          `Agent runtime runId mismatch: expected ${run.runId}, got ${parsed.runId}`,
        );
      }
      return parsed.results as CriterionResult[];
    } finally {
      clearTimeout(timeout);
      externalSignal?.removeEventListener("abort", onExternalAbort);
      this.controllers.delete(run.runId);
    }
  }

  public async cancel(runId: string): Promise<void> {
    this.controllers.get(runId)?.abort(new Error(`Run cancelled: ${runId}`));
  }
}

function formatResponseDetail(value: string): string {
  const compact = value.replace(/\s+/gu, " ").trim().slice(0, 300);
  return compact.length > 0 ? `: ${compact}` : "";
}
