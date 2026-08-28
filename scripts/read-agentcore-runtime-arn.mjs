import { readFileSync } from "node:fs";
import { readAgentCoreRuntimeArn } from "../dist/deployment/agentcore-state.js";

const [
  statePath = "agentcore/.cli/deployed-state.json",
  targetName = "default",
  runtimeName = "Spec2ProofRuntime",
] = process.argv.slice(2);

const state = JSON.parse(readFileSync(statePath, "utf8"));
process.stdout.write(
  `${readAgentCoreRuntimeArn(state, targetName, runtimeName)}\n`,
);
