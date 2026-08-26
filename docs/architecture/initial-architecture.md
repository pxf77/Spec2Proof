# Spec2Proof 初始项目架构

## 1. 架构目标

首版架构只建立完成 PR 验收闭环所需的最小边界：

```text
GitHub Webhook
→ 验收标准与计划
→ 人工批准
→ 单 Strands Agent 执行
→ 确定性工具断言
→ 证据
→ 运行结论
```

本阶段不建立通用测试平台，不引入多 Agent 图、复杂状态机、事件溯源、Lease、CAS 或多层 Gate。

## 2. 关键决策

### 2.1 单包、多入口

当前只有一个 `package.json`。Webhook 服务与 AgentCore Runtime 通过两个入口部署：

- `src/apps/webhook.ts`：GitHub Webhook 鉴权与事件入口；
- `src/apps/agent-runtime.ts`：AgentCore Runtime 协议入口；
- `src/apps/local-demo.ts`：无 AWS、无 GitHub 的确定性本地闭环。

在出现独立发布周期、权限边界或扩缩容需求前，不拆分 monorepo package。

### 2.2 一个 Agent 角色，两次调用

计划生成与执行之间存在强制人工批准点，因此代码中有 Planning 和 Execution 两次 Strands 调用。它们属于同一个 Spec2Proof Agent 角色，不是多 Agent 协作：

```text
Planning invocation
→ human approval
→ Execution invocation
```

### 2.3 模型决策，工具定案

模型可以理解标准、选择步骤和适应页面，但不能直接决定 PASS。`assert_url`、`assert_text` 等工具从已批准计划读取预期值，执行确定性比较，并先把实际结果写入证据存储。

`ApprovedExecutionLedger` 是每次调用独立的轻量守卫，只负责：

- 校验 `criterionId`、`stepId`、`assertionId` 是否属于已批准计划；
- 绑定浏览器会话与验收项；
- 接收证据存储实际签发的 Evidence ID，并核验计划要求的证据类型；
- 阻止模型伪造 Expected、Evidence ID、弱化断言或绕过失败断言；
- 从已记录断言派生最终 Criterion Result。

可信结果链路为：

```text
Approved Plan
→ Deterministic Assertion
→ Evidence Store
→ Execution Ledger
→ Criterion Result
→ Run Verdict
```

该 Ledger 只存在于单次执行调用中，不是持久化状态机。

### 2.4 顺序工具执行

浏览器步骤具有明确先后关系，因此执行 Agent 使用 Strands 的 sequential tool executor。该配置只保证单次模型回合中的工具调用顺序，不引入工作流节点或多 Agent 编排。

### 2.5 三阶段生命周期

只保留需求 SPEC 定义的三种运行阶段：

```text
AWAITING_APPROVAL → RUNNING → COMPLETED
```

`PASS / FAIL / NEEDS_HUMAN / INCONCLUSIVE / CANCELLED` 是结论，不是额外流程状态。

## 3. 目录结构

```text
src/
├── apps/                  # 可部署入口
├── domain/                # 纯类型与结论规则
├── application/           # 用例编排与端口
├── agent/                 # Strands Prompt、Schema、计划守卫、工具和适配器
├── adapters/              # 内存、本地文件、Playwright 实现
├── github/                # Webhook 签名和命令解析
├── security/              # URL Allowlist 与 SSRF 基础策略
├── config/                # 环境变量校验
└── observability/         # 结构化、脱敏日志
```

依赖方向：

```text
apps/adapters/agent → application → domain
```

`domain` 不依赖 GitHub、AWS、Playwright 或 Strands。

## 4. 当前已经搭建的能力

- 需求标准、计划、结果和运行模型；
- 结论优先级及覆盖完整度计算；
- 计划生成、批准、执行、取消的应用服务；
- Head SHA 过期批准保护；
- Strands 结构化计划生成器；
- 单 Strands 执行 Agent，并采用顺序工具执行；
- 已批准计划 ID 守卫和断言证据账本；
- 预期结果不可弱化校验；
- 浏览器、断言、截图和结果记录工具集合；
- Playwright 本地浏览器适配器；
- URL Host Allowlist、协议、IPv4/IPv6 私网限制、Service Worker 禁用和浏览器请求级拦截；
- 本地文件证据存储；
- AgentCore Runtime TypeScript 入口；
- GitHub Webhook HMAC-SHA256 校验；
- `/spec2proof` 命令解析；
- 本地确定性 Demo；
- 核心单元测试和 GitHub Actions CI。

## 5. 明确尚未实现的生产集成

以下边界已经预留，但本次不伪装为已完成：

1. GitHub App Installation Token 获取；
2. PR、Issue、Diff 和仓库配置读取；
3. GitHub Check Run 与单条汇总评论发布；
4. Webhook 事件入队与 RunService 分发；
5. DynamoDB Run/Checkpoint 存储；
6. S3 Evidence 存储与短期签名 URL；
7. AgentCore Browser 云端适配器；
8. Secret Profile 注入；
9. 步骤级 checkpoint 与失败项续跑；
10. OpenTelemetry Exporter 与 CloudWatch Dashboard。

这些应按端到端切片逐项实现，不能先建立空洞平台层。

## 6. 下一实施切片

建议下一轮只实现一个真实 GitHub 闭环：

```text
issue_comment webhook
→ 读取 PR 描述中的 Acceptance Criteria
→ Strands 生成计划
→ 发布一条计划评论
→ /spec2proof approve
→ 将执行任务发送到 Agent Runtime
→ 发布 GitHub Check 结果
```

浏览器目标先使用公开 DemoShop，证据先保存在本地或 S3 二选一，不同时扩展多个业务系统。
