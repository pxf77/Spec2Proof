import { readFileSync } from "node:fs";
import { parseDocument } from "yaml";

const cloudFormationTags = ["!Ref", "!Sub", "!GetAtt"].map((tag) => ({
  tag,
  resolve: (value) => value,
}));

function readYaml(file, options = {}) {
  const document = parseDocument(readFileSync(file, "utf8"), options);
  if (document.errors.length > 0) {
    throw new Error(`${file}: ${document.errors.map((error) => error.message).join("; ")}`);
  }
  const value = document.toJS();
  if (!value || typeof value !== "object") {
    throw new Error(`${file} does not contain a YAML object`);
  }
  return value;
}

function readTemplate(file) {
  const value = readYaml(file, { customTags: cloudFormationTags });
  if (!value.Resources) {
    throw new Error(`${file} does not define Resources`);
  }
  return value;
}

readTemplate("deploy/aws/foundation.yaml");
const application = readTemplate("deploy/aws/template.yaml");
const required = [
  "HttpApi",
  "GitHubAppCredentialsSecret",
  "RunsTable",
  "DeliveriesTable",
  "WebhookQueue",
  "ExecutionQueue",
  "WebhookFunction",
  "GitHubAppSetupFunction",
  "GitHubWorkerFunction",
  "RunExecutionWorkerFunction",
];
for (const logicalId of required) {
  if (!application.Resources[logicalId]) {
    throw new Error(`deploy/aws/template.yaml is missing ${logicalId}`);
  }
}

const commandEnvironment =
  application.Resources.GitHubWorkerFunction.Properties.Environment.Variables;
if (!commandEnvironment.SPEC2PROOF_EXECUTION_QUEUE_URL) {
  throw new Error("GitHubWorkerFunction does not schedule the execution queue");
}
if (commandEnvironment.SPEC2PROOF_AGENT_RUNTIME_ARN) {
  throw new Error("GitHubWorkerFunction must not block on AgentCore execution");
}

const deploymentWorkflow = readYaml(".github/workflows/deploy-aws.yml");
if (!deploymentWorkflow.on?.workflow_dispatch) {
  throw new Error("AWS deployment workflow must be manual-only");
}
if (Object.keys(deploymentWorkflow.on).some((event) => event !== "workflow_dispatch")) {
  throw new Error("AWS deployment workflow must not run on push or pull_request");
}
if (deploymentWorkflow.permissions?.["id-token"] !== "write") {
  throw new Error("AWS deployment workflow requires id-token: write for OIDC");
}
if (deploymentWorkflow.permissions?.contents !== "read") {
  throw new Error("AWS deployment workflow must keep contents permission read-only");
}

const deployJob = deploymentWorkflow.jobs?.deploy;
if (!deployJob || typeof deployJob !== "object") {
  throw new Error("AWS deployment workflow does not define the deploy job");
}
if (deployJob.env?.SPEC2PROOF_SETUP_TOKEN !== undefined) {
  throw new Error("Setup token must not be exposed at job scope");
}

const steps = Array.isArray(deployJob.steps) ? deployJob.steps : [];
const dependencyIndex = steps.findIndex((step) =>
  String(step?.name).includes("before AWS authentication"),
);
const credentialsIndex = steps.findIndex((step) =>
  String(step?.name).includes("Configure temporary AWS credentials"),
);
if (dependencyIndex < 0 || credentialsIndex < 0 || dependencyIndex >= credentialsIndex) {
  throw new Error(
    "Repository and CLI dependencies must be installed before AWS credentials are issued",
  );
}

const serializedWorkflow = JSON.stringify(deploymentWorkflow);
const actionReferences = [...serializedWorkflow.matchAll(/"uses":"([^"]+)"/gu)].map(
  (match) => match[1],
);
if (actionReferences.length === 0) {
  throw new Error("AWS deployment workflow contains no action references");
}
for (const reference of actionReferences) {
  if (!/@[a-f0-9]{40}$/u.test(reference)) {
    throw new Error(`Deployment action is not pinned to a commit SHA: ${reference}`);
  }
}
if (!serializedWorkflow.includes("vars.AWS_DEPLOY_ROLE_ARN")) {
  throw new Error("AWS deployment workflow does not use the OIDC deployment role variable");
}
if (!serializedWorkflow.includes("secrets.SPEC2PROOF_SETUP_TOKEN")) {
  throw new Error("AWS deployment workflow does not use the protected setup token");
}
if (/AWS_ACCESS_KEY_ID|AWS_SECRET_ACCESS_KEY/u.test(serializedWorkflow)) {
  throw new Error("AWS deployment workflow must not use long-lived AWS access keys");
}

const setupSecretReferences = serializedWorkflow.match(
  /secrets\.SPEC2PROOF_SETUP_TOKEN/gu,
);
if (setupSecretReferences?.length !== 2) {
  throw new Error(
    "Setup token must be scoped only to validation and control-plane deployment",
  );
}

console.log(
  "Deployment templates and the manual OIDC workflow passed structural and secret-scope validation.",
);
