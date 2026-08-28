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

const workflow = readYaml(".github/workflows/deploy-aws.yml");
if (!workflow.on?.workflow_dispatch) {
  throw new Error("AWS deployment workflow must be manual-only");
}
if (Object.keys(workflow.on).some((event) => event !== "workflow_dispatch")) {
  throw new Error("AWS deployment workflow must not run on push or pull_request");
}
if (workflow.permissions && Object.keys(workflow.permissions).length > 0) {
  throw new Error("AWS deployment workflow must not grant permissions globally");
}

const prepare = workflow.jobs?.prepare;
const deploy = workflow.jobs?.deploy;
if (!prepare || !deploy) {
  throw new Error("AWS deployment workflow requires prepare and deploy jobs");
}
if (prepare.permissions?.contents !== "read") {
  throw new Error("Prepare job requires contents: read");
}
if (prepare.permissions?.["id-token"] !== undefined) {
  throw new Error("Prepare job must not receive OIDC token permission");
}
if (deploy.permissions?.contents !== "read") {
  throw new Error("Deploy job requires contents: read");
}
if (deploy.permissions?.actions !== "read") {
  throw new Error("Deploy job requires actions: read for artifact download");
}
if (deploy.permissions?.["id-token"] !== "write") {
  throw new Error("Deploy job requires id-token: write for AWS OIDC");
}
const needs = Array.isArray(deploy.needs) ? deploy.needs : [deploy.needs];
if (!needs.includes("prepare")) {
  throw new Error("Deploy job must consume the verified prepare job artifact");
}
if (deploy.env?.SPEC2PROOF_SETUP_TOKEN !== undefined) {
  throw new Error("Setup token must not be exposed at job scope");
}

const prepareSteps = Array.isArray(prepare.steps) ? prepare.steps : [];
const deploySteps = Array.isArray(deploy.steps) ? deploy.steps : [];
const prepareText = JSON.stringify(prepare);
const deployText = JSON.stringify(deploy);
const workflowText = JSON.stringify(workflow);

if (prepareText.includes("secrets.SPEC2PROOF_SETUP_TOKEN")) {
  throw new Error("Prepare job must not receive the GitHub App setup token");
}
if (!prepareText.includes("actions/upload-artifact@")) {
  throw new Error("Prepare job must publish a verified deployment artifact");
}
if (!deployText.includes("actions/download-artifact@")) {
  throw new Error("Deploy job must download the verified deployment artifact");
}
if (deployText.includes("actions/checkout@")) {
  throw new Error("Deploy job must not checkout mutable repository content");
}
if (!prepareText.includes("sam build --template-file deploy/aws/template.yaml")) {
  throw new Error("SAM application must be built before OIDC permission is available");
}
if (!prepareText.includes("--prefix .deployment-tools")) {
  throw new Error("AgentCore CLI must be installed in the unprivileged prepare job");
}
if (!prepareText.includes("--exclude='./node_modules'")) {
  throw new Error("Privileged deployment bundle must exclude project node_modules");
}
if (!deployText.includes(".deployment-tools/node_modules/.bin")) {
  throw new Error("Deploy job must use the verified local AgentCore CLI");
}
if (!deployText.includes("SPEC2PROOF_SKIP_REPOSITORY_CHECK")) {
  throw new Error("Deploy job must not rerun repository dependencies with AWS credentials");
}

const deployRuns = deploySteps
  .map((step) => (typeof step?.run === "string" ? step.run : ""))
  .join("\n");
if (/(^|\s)(npm\s+(install|ci|exec)|npx)(\s|$)/u.test(deployRuns)) {
  throw new Error("Deploy job must not install or execute registry packages after OIDC");
}

const actionReferences = [...workflowText.matchAll(/"uses":"([^"]+)"/gu)].map(
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
if (!workflowText.includes("vars.AWS_DEPLOY_ROLE_ARN")) {
  throw new Error("AWS deployment workflow does not use the OIDC deployment role variable");
}
if (!workflowText.includes("secrets.SPEC2PROOF_SETUP_TOKEN")) {
  throw new Error("AWS deployment workflow does not use the protected setup token");
}
if (/AWS_ACCESS_KEY_ID|AWS_SECRET_ACCESS_KEY/u.test(workflowText)) {
  throw new Error("AWS deployment workflow must not use long-lived AWS access keys");
}
const setupTokenReferences = workflowText.match(/secrets\.SPEC2PROOF_SETUP_TOKEN/gu);
if (setupTokenReferences?.length !== 2) {
  throw new Error(
    "Setup token must be scoped only to validation and control-plane deployment",
  );
}

console.log(
  "Deployment templates and the two-job OIDC workflow passed structural and credential-boundary validation.",
);
