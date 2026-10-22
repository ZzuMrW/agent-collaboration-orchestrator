# Agent Collaboration Orchestrator

支持 **Codex 主导、TRAE CLI 执行**，也兼容原来的 TRAE 主导、Codex 执行方向。

桥接器通过 MCP 接收任务，启动本地 CLI 子进程，在共享项目中修改代码，并返回状态、日志、文件清单和最终回复。它不会控制已有的桌面聊天窗口。

## 只读查看 TRAE 执行输出

Node.js >= 18 即可使用，不需要连接 MCP，也不会启动、暂停、取消或重启执行器。

```bash
# 仓库内直接使用
node scripts/watch-task.cjs --list
node scripts/watch-task.cjs --task <task-id> --follow
node scripts/watch-task.cjs --latest --project-root /path/to/project --follow

# install-local 安装后也可使用
trae-task-watch --latest --project-root /path/to/project --follow
```

新开一个终端运行，Ctrl+C 只退出查看。`--latest --follow` 会切换到同一项目新下发的任务；需要固定任务时使用 `--task`。任务结束后查看窗口保持打开，等待后续输出或新任务。

默认读取 `BRIDGE_STATE_DIR`，未设置时读取 `~/.local/state/agent-collaboration-orchestrator/tasks`；可用 `--state-dir PATH` 指定桥接器实际使用的目录。`--tail 20` 控制首次显示的日志条数，`--poll-ms 1000` 控制轮询间隔。时间沿用桥接日志的 ISO/UTC 格式。状态尚未落盘时 `--follow` 会等待，临时不完整的快照会重试；查看器不会修改状态文件或将旧的 running 记录标成 failed。

安装进 skill 的 `scripts/watch-task.cjs` 可脱离仓库直接运行。查看的是桥接器已捕获的命令和输出，不包含独立的 TRAE 桌面 UI，也不会补出执行器尚未输出的内容。查看器只读文件，仍有少量轮询读开销；需要降低频率时可增加 `--poll-ms`。

## Codex 主导、TRAE 执行：Linux / WSL 安装

要求 Node.js >= 18、已登录且支持 `exec` 的 TRAE CLI。Linux / WSL 下执行：

```bash
npm ci --allow-remote=all
npm test
node scripts/install-local.cjs
```

安装器默认使用 `$CODEX_HOME`（未设置时为 `~/.codex`），支持显式传入一个或多个 Codex 配置目录，例如（将 `<username>` 替换为自己的 Windows 用户目录名）：

```bash
node scripts/install-local.cjs "$HOME/.codex" "/mnt/c/Users/<username>/.codex"
```

安装内容：`~/.local/bin/trae-task-bridge` 启动脚本、`trae-task-bridge` MCP 配置和 `codex-trae-workspace` skill。添加配置前会备份，保留其他配置；存在不同的同名 skill 或 MCP 配置时停止，避免覆盖。默认 TRAE 路径为 `~/.local/bin/traex`；可用 `TRAE_EXECUTOR_COMMAND` 覆盖，`SANDBOX_ROOT` 可指定允许提交项目的根目录。Windows 桌面端必须使用 WSL 执行环境才能运行这个 Linux 启动脚本。

重新打开 Codex 聊天（如未出现工具则重启 Codex），在目标项目中输入：

```text
使用 $codex-trae-workspace。
由你负责分析、规划和验收，TRAE 负责实现。
先查看项目当前状态，把任务限制在明确的文件范围内，
通过 trae-task-bridge 提交任务，完成后审查 diff 和测试结果。
```

通用操作示例、验证结果和卸载方式见 [本地使用指南](docs/codex-trae-local.md)。原方向的安装流程保留在下文。

## Features

- **双向角色配置**：Codex 主导 / TRAE 执行，或 TRAE 主导 / Codex 执行。
- **MCP 工具集**：提交任务、查看状态、读取日志、获取报告、查看产物、请求修订、取消任务。
- **移动端友好**：提供 `get_mobile_dashboard`，便于 TRAE 移动端查看当前任务、产物数量和待处理权限请求。
- **产物扫描**：Codex 执行结束后自动扫描项目新增/修改文件，并通过 `list_artifacts` 暴露给 TRAE。
- **权限重试机制**：Codex 因沙箱/权限失败后，bridge 可生成权限请求；TRAE 批准后创建更高权限的重试任务。
- **共享工作空间**：推荐统一使用 `codex_trae_workspace`，让桌面端、移动端、MCP bridge 和 Codex 看到一致路径。
- **可手动接管**：未配置执行命令时，bridge 仍会生成 prompt 文件。

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
        "CODEX_EXECUTOR_ARGS": "--ask-for-approval never exec --cd {projectRoot} --sandbox {sandbox} -",
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

这样可校验提交项目的路径，并让各客户端看到一致的任务和产物路径。实际命令权限由执行器的沙箱控制。

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
        "CODEX_EXECUTOR_ARGS": "--ask-for-approval never exec --cd {projectRoot} --sandbox {sandbox} -",
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
| `EXECUTOR_AGENT` / `ORCHESTRATOR_AGENT` | Optional | 执行者 / 主导者名称；默认 Codex / TRAE Work。 |
| `EXECUTOR_COMMAND` / `EXECUTOR_ARGS` | Recommended | 通用执行命令和参数，优先于旧的 CODEX_EXECUTOR_*。 |
| `BRIDGE_STATE_DIR` | Optional | 每个任务单独保存状态、日志、报告的目录；不设置时仅保存在内存中。 |
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
| `{resultFile}` | 最终回复文件路径，配合 CLI --output-last-message 使用 |
| `{sandbox}` | 沙箱模式：`read-only`、`workspace-write`、`danger-full-access` |
| `{model}` | 模型名称 |
| `{title}` | 任务标题 |

## Codex Executor Examples

### Codex CLI

```json
{
  "CODEX_EXECUTOR_COMMAND": "C:/path/to/codex.cmd",
  "CODEX_EXECUTOR_ARGS": "--ask-for-approval never exec --cd {projectRoot} --sandbox {sandbox} -"
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

- 更完整的跨进程任务控制；当前可读取其他 bridge 进程的持久化状态，取消运行中的任务需在原聊天进行。
- 更精细的权限请求解析，展示被阻止的命令。
- 多 Codex profile / 多中转站配置。
- 端到端测试夹具。
- 英文 README。

## License

MIT
