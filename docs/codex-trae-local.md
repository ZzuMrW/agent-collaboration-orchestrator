# Codex 主导 / TRAE 执行：使用指南

本文使用通用路径和项目示例，不包含实际用户名、机器目录、任务 ID 或安装时间。`<project-root>`、`<bridge-root>`、`<username>` 表示需要替换的值；`$HOME` 表示当前 Linux 用户的主目录。

## 安装位置

运行安装器后，默认生成以下内容：

- 启动器：`$HOME/.local/bin/trae-task-bridge`，调用已安装的 Node.js 和 TRAE CLI。
- MCP：目标 Codex 配置目录的 `config.toml` 中的 `trae-task-bridge` 小节。
- Skill：目标 Codex 配置目录的 `skills/codex-trae-workspace/SKILL.md`。
- 状态：`$HOME/.local/state/agent-collaboration-orchestrator/tasks/<task-id>.json`。
- 项目任务文件：`<project-root>/.agent-bridge/tasks/<task-id>/prompt.md` 和 `result.md`。

Codex 配置目录默认取 `$CODEX_HOME`，未设置时为 `$HOME/.codex`，也可以显式传入。安装器会在修改配置前生成备份；具体文件名以安装输出或配置目录中的备份文件为准。这套启动器适用于 Linux / WSL 执行环境。

## 在 Codex 中使用

在目标项目中新建聊天；如 MCP 或 skill 没有出现，重启 Codex。复制以下指令，并按项目实际文件调整审查范围：

```text
使用 $codex-trae-workspace。
你负责分析、拆任务和验收，TRAE 负责执行。
以当前工作区为项目根目录。
先调用 trae-task-bridge 的 diagnose_environment 并检查当前 Git 状态。
请让 TRAE 只读审查指定模块和对应测试，
列出已有覆盖和缺失的边界用例，给出测试补全方案，暂不修改代码。
完成后读取最终报告，由你复核结论。
```

这条任务是只读审查。需要实现时，在同一聊天明确提出目标行为和修改范围，Codex 再提交 `workspace-write` 任务。

MCP 查询工具声明为只读；默认安装允许常规提交、修订和取消，权限升级请求仍需确认。安装方式和审批配置参考 [OpenAI MCP 文档](https://developers.openai.com/codex/mcp/)。

任务进度通过 `get_task_status` / `get_task_log` 查看；`get_result_report.finalResponse` 是 TRAE 的最终回复。`request_revision` 创建修订任务，`cancel_task` 终止当前进程组。沙箱权限不足时查看日志和权限请求，不自动扩大权限。

## 验证示例

历史验证通过 stdio MCP 提交真实 TRAE 任务，执行者新增了使用示例文档，并运行示例项目的单元测试：112 通过、0 失败、1 跳过。桥接器返回退出码 0、最终回复、prompt 文件、结果文件和新增文档清单。

随后由 Codex CLI 加载 `$codex-trae-workspace`，直接调用 MCP `request_revision` 指派 TRAE 修订文档，并读取报告、产物和实际文档进行验收。环境诊断、任务报告读取及修订验收均通过。具体任务标识和环境路径不在本文公开。

桥接仓库的 `npm test`（含 TypeScript 构建）历史验证了 12 个用例，全部通过，涵盖角色和报告、产物和修订、权限失败、取消、超时、缺失执行命令、路径边界及状态恢复。上述数字是历史验证结果，不代表每次运行的实时状态。

## 配置及维护

确保 Node.js、npm 和 Codex CLI 已在 `PATH` 中，在桥接仓库根目录执行：

```bash
npm test
node scripts/install-local.cjs
codex mcp get trae-task-bridge
```

如需同时安装到 Linux 与 Windows 桌面端共享配置目录，可显式传入目录。下面的 Windows 用户名是占位符，执行前替换为实际值：

```bash
node scripts/install-local.cjs "$HOME/.codex" "/mnt/c/Users/<username>/.codex"
```

TRAE 使用自己的已登录账户和默认模型；Codex 的模型设置不会自动传给 TRAE。任务可指定 `model`，它会作为执行器的 `--model` 参数传入；也可用 `EXECUTOR_MODEL` 设置默认模型。

持久化状态支持多个 bridge 进程分别保存任务并读取已有记录；运行中的任务需要回到创建任务的聊天取消。若原 bridge 已退出，任务标为中断失败，重试前应检查部分改动。不要让多个任务同时写同一批文件。文件范围约束写入 prompt，由执行者遵循；`SANDBOX_ROOT` 校验项目目录，不是额外的操作系统隔离。

`.agent-bridge` 是运行记录，可以在目标项目的 `.git/info/exclude` 中本地忽略，避免误提交。卸载时只删除相关配置目录中的 `[mcp_servers.trae-task-bridge]` 及其 `tools` 小节、对应 skill 目录和启动器；不必恢复整份旧配置，以免覆盖后续其他配置变更。状态和任务文件可按需要保留。

## 兼容原有协作方向

未指定角色时，默认仍为 TRAE Work 主导、Codex 执行。旧的 `CODEX_EXECUTOR_COMMAND`、`CODEX_EXECUTOR_ARGS` 及 `CodexExecutor` 导出继续有效。配置 `EXECUTOR_AGENT=TRAE` 和 `ORCHESTRATOR_AGENT=Codex` 才切换角色；同时设置通用和旧环境变量时，`EXECUTOR_COMMAND` / `EXECUTOR_ARGS` 优先。

测试覆盖了两种方向的实际子进程执行，含旧环境变量下的角色提示词和报告验证。
