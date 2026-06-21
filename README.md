# Agent Collaboration Orchestrator

面向 **TRAE Work + Codex** 的多智能体协同开发桥接器。

这个项目提供一个 MCP bridge 和一个 TRAE skill，让你可以在 TRAE Work 桌面端或移动端发起项目任务，由 TRAE 先做项目粗分析、方案规划和简单修改，再把困难实现、复杂重构、测试补全等子任务交给 Codex 执行。TRAE 可以继续查看 Codex 任务状态、日志、产物、权限请求，并在需要时调整、终止或批准重试。

## Features

- **TRAE 主导流程**：TRAE 作为项目第一入口，Codex 作为困难任务执行器。
- **MCP 工具集**：提交任务、查看状态、读取日志、获取报告、查看产物、请求修订、取消任务。
- **移动端友好**：提供 `get_mobile_dashboard`，便于 TRAE 移动端查看当前任务、产物数量和待处理权限请求。
- **产物扫描**：Codex 执行结束后自动扫描项目新增/修改文件，并通过 `list_artifacts` 暴露给 TRAE。
- **权限重试机制**：Codex 因沙箱/权限失败后，bridge 可生成权限请求；TRAE 批准后创建更高权限的重试任务。
- **共享工作空间**：推荐统一使用 `codex_trae_workspace`，让桌面端、移动端、MCP bridge 和 Codex 看到一致路径。
- **可手动接管**：未配置 Codex 自动执行命令时，bridge 仍会生成 prompt 文件，可手动交给 Codex。

## 快速开始

下面流程用于在你的电脑上做一次最小可用测试：让 TRAE 通过 MCP 调用 Codex，在测试项目里创建一个文件，然后用移动端友好的工具查看状态和产物。

### 1. 创建协同工作空间

```powershell
New-Item -ItemType Directory -Force E:\codex_trae_workspace
```

确保本项目位于：

```text
E:\codex_trae_workspace\agent-collaboration-orchestrator
```

### 2. 安装并构建 bridge

```powershell
cd E:\codex_trae_workspace\agent-collaboration-orchestrator
& 'C:\Program Files\nodejs\npm.cmd' install
& 'C:\Program Files\nodejs\npm.cmd' run build
```

### 3. 确认 Codex 命令可用

Windows 下建议使用 `.cmd` 或 `.exe` 路径，不要直接使用可能被 PowerShell 拦截的 `.ps1`。

```powershell
where.exe codex
& 'C:\path\to\codex.cmd' --help
& 'C:\path\to\codex.cmd' exec --help
```

请把后续配置中的 `CODEX_EXECUTOR_COMMAND` 改成你自己的 `.cmd` 或 `.exe` 路径。

### 4. 创建测试项目

```powershell
New-Item -ItemType Directory -Force E:\codex_trae_workspace\mcp-test-project
Set-Content -Encoding UTF8 E:\codex_trae_workspace\mcp-test-project\README.md "# MCP test project"
```

### 5. 在 TRAE 中配置 MCP

将下面配置加入 TRAE 的 MCP/工具配置中。路径按你的电脑实际情况调整。

```json
{
  "mcpServers": {
    "codex-task-bridge": {
      "command": "node",
      "args": [
        "E:/codex_trae_workspace/agent-collaboration-orchestrator/dist/cli.js"
      ],
      "env": {
        "SANDBOX_ROOT": "E:/codex_trae_workspace",
        "CODEX_EXECUTOR_COMMAND": "C:/path/to/codex.cmd",
        "CODEX_EXECUTOR_ARGS": "exec --cd {projectRoot} --sandbox {sandbox} --ask-for-approval never -",
        "EXECUTOR_TIMEOUT_MS": "1800000"
      }
    }
  }
}
```

### 6. 安装 TRAE skill

复制以下目录到 TRAE 支持的 skills 目录，并在 TRAE 中启用该 skill：

```text
E:\codex_trae_workspace\agent-collaboration-orchestrator\skills\trae-codex-workspace
```

### 7. 在 TRAE 中发起最小测试

在 TRAE 中输入：

```text
使用 trae-codex-workspace skill。
在 E:/codex_trae_workspace/mcp-test-project 中测试 Codex 协作。
请先调用 diagnose_environment 检查环境。
然后通过 submit_task 交给 Codex 一个最小任务：在项目根目录创建 hello-from-codex.txt，内容为 hello from codex。
完成后用 get_mobile_dashboard 查看状态，用 list_artifacts 查看产物。
```

### 8. 预期结果

正常情况下，你应该看到：

- `diagnose_environment` 显示 Node 正常，`sandboxRoot` 是 `E:/codex_trae_workspace`
- `submit_task` 返回一个 `taskId`
- `get_mobile_dashboard` 能看到任务状态
- `list_artifacts` 至少包含：
  - `.agent-bridge/tasks/<taskId>/prompt.md`
  - `hello-from-codex.txt`

如果任务失败，让 TRAE 继续调用：

```text
get_task_log
list_permission_requests
```

根据日志判断是 Codex 命令路径、API/中转站、权限沙箱，还是 TRAE MCP 配置问题。

## Architecture

```text
User
  |
  v
TRAE Work Desktop / Mobile
  |  1. 粗读项目、制定方案、拆分任务
  |  2. 简单任务由 TRAE 直接完成
  |
  v
agent-collaboration-orchestrator MCP bridge
  |  submit_task / get_mobile_dashboard / list_artifacts / ...
  |
  v
Codex executor
  |  3. 执行困难实现或复杂修改
  |  4. 输出日志、报告、产物
  |
  v
TRAE 验收、修订、终止或批准重试
```

## Recommended Workspace

建议先创建一个协同工作空间，并把 bridge 和所有协同开发项目都放进去：

```text
codex_trae_workspace/
  agent-collaboration-orchestrator/
  my-app/
  another-project/
```

推荐配置：

- `SANDBOX_ROOT` 指向整个 `codex_trae_workspace`
- 每次提交任务时，`projectRoot` 指向具体项目目录，例如 `E:/codex_trae_workspace/my-app`

这样可以限制 Codex 的可写范围，并让 TRAE 桌面端/移动端看到一致的任务和产物路径。

## Installation

```bash
git clone https://github.com/muanlin/agent-collaboration-orchestrator.git
cd agent-collaboration-orchestrator
npm install
npm run build
```

要求：

- Node.js >= 18
- TRAE Work
- Codex CLI、本地 Codex、中转站脚本，或任何可通过命令行启动的 Codex 执行入口

## MCP Configuration

把本项目作为 MCP server 配置到 TRAE Work。路径请替换为你自己的本机路径。

```json
{
  "mcpServers": {
    "codex-task-bridge": {
      "command": "node",
      "args": [
        "E:/codex_trae_workspace/agent-collaboration-orchestrator/dist/cli.js"
      ],
      "env": {
        "SANDBOX_ROOT": "E:/codex_trae_workspace",
        "CODEX_EXECUTOR_COMMAND": "C:/path/to/codex.cmd",
        "CODEX_EXECUTOR_ARGS": "exec --cd {projectRoot} --sandbox {sandbox} --ask-for-approval never -",
        "EXECUTOR_TIMEOUT_MS": "1800000"
      }
    }
  }
}
```

Windows 用户建议把 `CODEX_EXECUTOR_COMMAND` 指向 `.cmd` 或 `.exe`，避免 PowerShell 执行策略拦截 `.ps1`。

## Environment Variables

| Variable | Required | Description |
| --- | --- | --- |
| `SANDBOX_ROOT` | Recommended | Codex 允许访问的协同工作空间根目录。 |
| `CODEX_EXECUTOR_COMMAND` | Required for auto execution | Codex 执行入口，例如 `codex.cmd`、`codex.exe`、`node`、`powershell` 或自定义中转脚本。 |
| `CODEX_EXECUTOR_ARGS` | Optional | Codex 启动参数模板。默认通过 stdin 传入 prompt。 |
| `EXECUTOR_MODEL` | Optional | 默认模型名称，会写入任务 prompt 供执行器参考。 |
| `EXECUTOR_TIMEOUT_MS` | Optional | Codex 子任务超时时间，默认 30 分钟。 |

`CODEX_EXECUTOR_ARGS` 支持这些占位符：

| Placeholder | Meaning |
| --- | --- |
| `{taskId}` | Bridge task ID |
| `{projectRoot}` | 项目目录 |
| `{promptFile}` | Bridge 生成的 prompt 文件 |
| `{sandbox}` | 沙箱模式：`read-only`、`workspace-write`、`danger-full-access` |
| `{model}` | 模型名称 |
| `{title}` | 任务标题 |

## Codex Executor Examples

### Codex CLI

```json
{
  "CODEX_EXECUTOR_COMMAND": "C:/path/to/codex.cmd",
  "CODEX_EXECUTOR_ARGS": "exec --cd {projectRoot} --sandbox {sandbox} --ask-for-approval never -"
}
```

Bridge 会把生成的 prompt 内容通过 stdin 传给 `codex exec ... -`，同时保留 prompt 文件供 TRAE 查看。

### Custom Relay Script

```json
{
  "CODEX_EXECUTOR_COMMAND": "powershell",
  "CODEX_EXECUTOR_ARGS": "-File E:/scripts/run-codex-task.ps1 -Workspace {projectRoot} -PromptFile {promptFile} -Sandbox {sandbox}"
}
```

### Manual Mode

如果不配置 `CODEX_EXECUTOR_COMMAND`，`submit_task` 仍会创建任务和 prompt 文件，但任务会停在 `pending`。

```text
<projectRoot>/.agent-bridge/tasks/<taskId>/prompt.md
```

你可以手动把该 prompt 交给 Codex 执行。

## TRAE Skill

仓库提供了一个可放到 TRAE 中运行的 skill：

```text
skills/trae-codex-workspace/SKILL.md
```

安装方式：将整个 `skills/trae-codex-workspace` 目录复制到 TRAE 支持的 skills 目录中。

这个 skill 会指导 TRAE：

- 在 `codex_trae_workspace` 中定位或创建项目
- 先粗读项目并拆分简单任务/困难任务
- 自己完成简单任务
- 通过 MCP `submit_task` 把困难任务交给 Codex
- 用 `get_mobile_dashboard` 在移动端查看任务总览
- 用 `list_artifacts` 查看 prompt 和 Codex 修改过的文件
- 用 `request_revision` 调整方向
- 用 `cancel_task` 终止任务
- 用 `list_permission_requests` / `resolve_permission_request` 处理权限重试

## MCP Tools

| Tool | Description |
| --- | --- |
| `submit_task` | TRAE 提交困难任务给 Codex。 |
| `get_task_status` | 查询单个任务状态。 |
| `get_task_log` | 查看任务执行日志。 |
| `get_result_report` | 获取任务完成报告。 |
| `request_revision` | 基于原任务创建修订任务。 |
| `cancel_task` | 取消 pending/running 任务。 |
| `list_artifacts` | 查看 prompt 文件和 Codex 执行后新增/修改的文件。 |
| `list_tasks` | 查看任务列表，适合桌面端/移动端任务视图。 |
| `get_mobile_dashboard` | 获取移动端一屏摘要：任务统计、最近任务、待处理权限请求。 |
| `list_permission_requests` | 查看因权限/沙箱失败生成的待审批请求。 |
| `resolve_permission_request` | 批准或拒绝权限请求。批准后创建重试任务。 |
| `diagnose_environment` | 检查 Node、工作区和 Codex 执行器配置。 |

## Typical Workflow

在 TRAE 中给项目任务时，可以使用类似指令：

```text
在 codex_trae_workspace/my-app 中实现登录功能。
你先粗读项目，输出方案并拆分任务。
简单页面和文案由你直接处理。
认证状态管理、复杂表单校验和测试交给 Codex。
我会在移动端查看进度、产物，必要时调整或终止任务。
```

TRAE 应提交给 Codex 的任务应包含：

- 项目背景
- 具体目标
- 修改范围
- 禁止修改的文件或行为
- 约束条件
- 验收标准
- 需要运行的验证命令

示例：

```json
{
  "title": "实现订单状态流转核心逻辑",
  "projectRoot": "E:/codex_trae_workspace/my-app",
  "sandbox": "workspace-write",
  "prompt": "TRAE 已完成初步分析：当前项目使用 Express + Prisma。请实现订单状态流转的核心服务逻辑，范围限定在 src/services/order-state.ts 和相关测试。不要修改数据库 schema。要求覆盖 paid -> shipped -> completed，以及 cancelled 的非法流转保护。完成后运行 npm test -- order-state 并报告结果。",
  "constraints": {
    "doNotChange": ["prisma/schema.prisma", "package.json"],
    "preferredFiles": ["src/services/order-state.ts", "src/services/order-state.test.ts"]
  },
  "acceptanceCriteria": {
    "checks": [
      "合法状态流转成功",
      "非法状态流转抛出明确错误",
      "相关测试通过"
    ]
  }
}
```

## Mobile Dashboard

移动端优先使用 `get_mobile_dashboard`，它会返回：

- 当前任务总数
- running / pending / completed / failed / cancelled 数量
- 最近任务摘要
- 每个任务的最近日志
- 产物数量
- 待处理权限请求

移动端展示建议：

```text
总览：running 1，failed 1，待审批 1
任务：
- 实现 auth service core：failed，产物 2，待审批 1
- 修复 UI 文案：completed，产物 3
待处理：permission-request-id，需要更高沙箱重试
```

## Artifacts

`list_artifacts` 会返回：

- bridge 生成的 prompt 文件
- Codex 执行后新增的文件
- Codex 执行后修改的文件

产物扫描会忽略常见噪声目录：

```text
.git
.agent-bridge
node_modules
dist
build
out
coverage
.next
.nuxt
.cache
.turbo
.vite
.parcel-cache
```

## Permission Model

TRAE 桌面端/移动端不能直接点击 Codex CLI 的交互式权限弹窗。Bridge 采用更适合移动端的方式：

1. Codex 以非交互模式运行，例如：

   ```text
   codex exec --cd {projectRoot} --sandbox workspace-write --ask-for-approval never -
   ```

2. 如果 Codex 因权限或沙箱限制失败，bridge 会尝试识别错误并生成权限请求。
3. TRAE 用 `list_permission_requests` 或 `get_mobile_dashboard` 查看待审批请求。
4. 用户批准后，TRAE 调用 `resolve_permission_request`。
5. Bridge 创建一个更高权限的重试任务。

批准示例：

```json
{
  "requestId": "permission-request-id",
  "decision": "approve",
  "sandbox": "danger-full-access",
  "note": "用户确认该项目位于隔离的 codex_trae_workspace 中，可以重试。"
}
```

拒绝示例：

```json
{
  "requestId": "permission-request-id",
  "decision": "reject",
  "note": "缩小任务范围后再提交。"
}
```

`danger-full-access` 只建议在你已经用 `codex_trae_workspace` 或其他方式隔离执行环境时使用。

## Development

```bash
npm install
npm run build
npm run dev
```

项目结构：

```text
src/
  cli.ts           # MCP stdio 入口
  executor.ts      # Codex 命令执行器适配层
  index.ts         # 库导出
  mcp-server.ts    # MCP 工具定义与请求处理
  task-manager.ts  # 任务、日志、产物、权限请求管理
  types.ts         # 类型定义

skills/
  trae-codex-workspace/
    SKILL.md       # 可安装到 TRAE 的 skill
```

## Security Notes

- 不要把 API Key、账号密码、中转站凭据写入任务 prompt。
- `projectRoot` 必须位于 `SANDBOX_ROOT` 内。
- 默认使用 `workspace-write`。
- 谨慎批准 `danger-full-access` 重试。
- TRAE 应负责最终验收，不要盲目接受 Codex 子任务结果。
- MCP server 通过 stdio 通信，启动日志写入 stderr，避免污染 stdout。

## Roadmap

- 任务状态持久化，避免 MCP 进程重启后丢失内存状态。
- 更精细的权限请求解析，展示被阻止的命令。
- 多 Codex profile / 多中转站配置。
- 端到端测试夹具。
- 英文 README。

## License

MIT
