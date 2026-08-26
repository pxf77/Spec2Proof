import { pathToFileURL } from "node:url";
import { BedrockModel } from "@strands-agents/sdk";
import { BedrockAgentCoreApp } from "bedrock-agentcore/runtime";
import { z } from "zod";
import { loadRuntimeEnvironment } from "../config/env.js";
import { runtimeExecutionRequestSchema } from "../agent/schemas.js";
import { StrandsRunExecutor } from "../agent/strands-run-executor.js";
import { PlaywrightBrowserAdapter } from "../adapters/playwright-browser.js";
import { LocalFileEvidenceStore } from "../adapters/local-evidence-store.js";
import { UrlPolicy } from "../security/url-policy.js";

export function startAgentRuntime(): void {
  const environment = loadRuntimeEnvironment();
  const browser = new PlaywrightBrowserAdapter(
    new UrlPolicy({
      allowedHosts: environment.SPEC2PROOF_ALLOWED_HOSTS,
      allowHttp: environment.SPEC2PROOF_ALLOW_HTTP,
      allowPrivateHosts: environment.SPEC2PROOF_ALLOW_PRIVATE_HOSTS,
    }),
    environment.SPEC2PROOF_BROWSER_HEADLESS,
  );
  const evidence = new LocalFileEvidenceStore(environment.SPEC2PROOF_ARTIFACTS_DIR);
  const model = new BedrockModel({
    modelId: environment.SPEC2PROOF_MODEL_ID,
    region: environment.AWS_REGION,
    temperature: 0,
  });
  const executor = new StrandsRunExecutor({
    browser,
    evidence,
    model,
    maxTurns: environment.SPEC2PROOF_MAX_AGENT_TURNS,
  });

  const app = new BedrockAgentCoreApp({
    invocationHandler: {
      requestSchema: runtimeExecutionRequestSchema,
      process: async (
        request: z.infer<typeof runtimeExecutionRequestSchema>,
        context: { sessionId: string },
      ) => {
        const results = await executor.execute(request.run);
        return {
          runId: request.run.runId,
          runtimeSessionId: context.sessionId,
          results,
        };
      },
    },
  });

  app.run({ port: environment.AGENT_RUNTIME_PORT, host: "0.0.0.0" });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startAgentRuntime();
}
