# Spec2Proof GitHub App 集成架构

## 1. 本阶段目标

本阶段把初始架构从“已认证 Webhook 入口”推进到真实 PR 闭环：

```text
GitHub App Installation
→ Installation Token
→ 读取 PR 与变更文件摘要
→ 解析显式验收标准
→ 生成计划
→ PR 评论与 Check Run
→ Reviewer 批准
→ Agent Runtime 执行
→ 结果回写
```

不增加多 Agent 图、持久化状态机或额外审批 Gate。

## 2. GitHub App 身份

`GitHubAppTokenProvider` 使用 App ID 与 RSA 私钥签发最长 9 分钟的 GitHub App JWT，再调用：

```text
POST /app/installations/{installation_id}/access_tokens
```

Installation Token 按 Installation ID 缓存，并在过期前 60 秒主动刷新。业务层与 Agent 均不接触 App 私钥或 Installation Token。

最低仓库权限：

| 权限 | 级别 |
|---|---|
| Metadata | Read |
| Pull requests | Read |
| Issues | Write |
| Checks | Write |

Webhook 订阅：

- `issue_comment`
- `pull_request`

## 3. PR 上下文

`GitHubPullRequestReader` 读取：

- PR 标题与作者；
- Head SHA、Head Ref、Base Ref；
- PR 地址；
- 变更文件路径、状态、增删行数与受限长度 Patch；
- PR 描述中的结构化 Spec2Proof YAML。

Diff 只作为计划上下文，不作为隐式需求来源。正式验收项只能来自 `spec2proof.criteria`。

变更文件数量受 `SPEC2PROOF_MAX_CHANGED_FILES` 限制；单文件 Patch 受 `SPEC2PROOF_MAX_PATCH_CHARS_PER_FILE` 限制。发生截断时写入显式标记，不静默声称上下文完整。

## 4. 验收标准解析

PR 必须包含：

```yaml
spec2proof:
  target:
    environment: staging
    base_url: https://staging.example.com
  criteria:
    - id: AC-001
      description: Observable behavior
      expected:
        - type: text
          value: Expected text
```

解析器支持 `url`、`text`、`element`、`http_status`、`json_path` 与 `human`。解析失败、ID 重复、预期结果缺失，或同一 Criterion 混合人工和确定性结果时，命令失败并在 PR 中说明；不会启动浏览器，也不会产生 PASS。

## 5. 命令调度

Webhook 服务完成签名验证后立即返回 `202`，再在进程内异步调度命令，避免 GitHub 因模型或执行耗时重试请求。

```text
/spec2proof run
  → 读取当前 PR
  → 生成计划
  → queued Check + 计划评论

/spec2proof approve
  → 校验 Reviewer 权限
  → 再读当前 Head SHA
  → 启动执行
  → in_progress Check
  → completed Check
```

`approve`、`reject`、`cancel`、`rerun-failed` 需要 `write`、`maintain` 或 `admin` 权限。

PR 出现 `synchronize` 事件且 Head SHA 变化时，尚未结束的旧运行会被取消。旧 SHA 的批准不能用于新 SHA。

## 6. Check Run 与评论幂等

每个 Run 使用：

```text
Check Run external_id = runId
PR comment marker = <!-- spec2proof-summary -->
```

发布器每次先查询现有资源：

- 找到同一 `external_id` 时更新 Check Run；
- 找到 PR 中稳定的 summary marker 时更新评论；
- 未找到时创建。

因此 `planReady → runStarted → runCompleted` 对当前 Run 只维护一个 Check Run，同时整个 PR 只维护一条可更新的汇总评论。

## 7. Agent Runtime 边界

Webhook 进程通过 `AgentRuntimeRunExecutor` 调用 AgentCore-compatible `/invocations`：

```text
POST /invocations
x-amzn-bedrock-agentcore-runtime-session-id: {runId}
```

请求与响应均进行结构校验，响应 `runId` 必须与请求一致。HTTP 错误、超时、响应结构错误均由 RunService 转为 `BLOCKED / INCONCLUSIVE`，不会误报为产品 FAIL 或 PASS。

## 8. 当前有意保留的限制

当前仍使用：

- 进程内 `InMemoryRunStore`；
- 进程内 Webhook Delivery 去重；
- 本地或直接 HTTP Agent Runtime 地址；
- 本地文件证据存储；
- Playwright 本地 Browser Adapter。

因此服务重启后不会恢复等待批准的运行。下一基础设施阶段应只替换端口实现：

```text
RunStore          → DynamoDB
Delivery tracker  → DynamoDB TTL / SQS dedupe
EvidenceStore     → S3
BrowserPort       → AgentCore Browser
RunExecutor       → Managed AgentCore Runtime invocation
```

领域模型、RunService、计划守卫与 GitHub 发布契约无需随之重构。
