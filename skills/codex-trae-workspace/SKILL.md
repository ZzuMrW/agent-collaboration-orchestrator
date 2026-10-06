---
name: codex-trae-workspace
description: Let Codex plan and review development work while delegating implementation to the local TRAE CLI through the trae-task-bridge MCP server. Use for requests to have Codex lead and TRAE execute.
---

# Codex leads, TRAE executes

Codex owns analysis, task decomposition, acceptance, and the final response. TRAE implements scoped tasks through the `trae-task-bridge` MCP server.

Read the project's instructions and current Git status before delegation. Give TRAE the project context, exact scope, protected files, acceptance criteria, verification commands, and required completion report. Preserve unrelated local changes. Determine the actual project root from the current workspace; never assume a fixed machine path.

Call `diagnose_environment`, then `submit_task` with `projectRoot`, `prompt`, `title`, `sandbox: workspace-write`, `constraints`, and `acceptanceCriteria`. For analysis-only work use `read-only`. Verify the executor configuration says TRAE before submitting. Keep the bridge process alive while a task runs.

Monitor `get_task_status` and read recent logs with `get_task_log`; space status checks apart. Fetch `get_result_report` and `list_artifacts` at completion. The report's `finalResponse` contains TRAE's final answer. Review the actual diff and verification evidence: exit code zero alone does not establish acceptance. Use `request_revision` with concrete corrections when needed. Revisions are new executions, not resumed CLI conversations.

Avoid simultaneous writes to the same files by Codex and TRAE. Do not ask TRAE to invoke this bridge or delegate back to Codex. Use `cancel_task` when the user stops the delegated work. A timeout or interrupted bridge requires inspecting partial changes before retrying.

For permission failures inspect `list_permission_requests`. Approve a broader sandbox only within explicit user authorization; otherwise narrow the task or report the blocked step. Do not include credentials in prompts.

If MCP tools are missing, explain that the user should reopen the chat or restart Codex after installation. Do not silently replace a requested delegation with direct implementation. The default local launcher is `$HOME/.local/bin/trae-task-bridge`; use the installed MCP configuration to resolve its actual path. The fallback `scripts/run-task.cjs` in the bridge repository keeps an MCP client alive through completion and exercises the same tools.
