# MCP Configuration Example

This project is intended to be configured in TRAE Work as an MCP server.

TRAE receives the user's project-level instruction first. TRAE then analyzes the project, completes simple work directly, and delegates difficult subtasks to Codex through this bridge.

## Codex leads / TRAE executes (Linux or WSL)

Build the bridge, then run `node scripts/install-local.cjs` to install the launcher, MCP entry, and Codex skill. You can pass explicit Codex home directories; see `docs/codex-trae-local.md`.

Example launcher settings follow. `/home/user` is a fictional home directory; replace it and the workspace with your actual absolute paths.

```text
EXECUTOR_AGENT=TRAE
ORCHESTRATOR_AGENT=Codex
EXECUTOR_COMMAND=/home/user/.local/bin/traex
EXECUTOR_ARGS=--ask-for-approval never exec --cd {projectRoot} --sandbox {sandbox} --color never --output-last-message {resultFile} -
SANDBOX_ROOT=/home/user/workspace
BRIDGE_STATE_DIR=/home/user/.local/state/agent-collaboration-orchestrator/tasks
```

Codex configuration:

```toml
[mcp_servers.trae-task-bridge]
command = "/home/user/.local/bin/trae-task-bridge"
startup_timeout_sec = 30
tool_timeout_sec = 120
default_tools_approval_mode = "writes"

[mcp_servers.trae-task-bridge.tools.submit_task]
approval_mode = "approve"

[mcp_servers.trae-task-bridge.tools.request_revision]
approval_mode = "approve"

[mcp_servers.trae-task-bridge.tools.cancel_task]
approval_mode = "approve"

[mcp_servers.trae-task-bridge.tools.resolve_permission_request]
approval_mode = "prompt"
```

Read tools are marked read-only. Normal delegation and cancellation are enabled for the authorized local collaboration workflow; sandbox escalation stays explicit. Reopen the Codex chat after installation. The original direction follows below.

## Basic Configuration

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

## Environment Variables

| Variable | Required | Description |
| --- | --- | --- |
| `SANDBOX_ROOT` | Recommended | Root directory Codex is allowed to work in. Prefer the shared `codex_trae_workspace`. |
| `CODEX_EXECUTOR_COMMAND` | Required for auto execution | Command used to start Codex or your Codex relay script. On Windows, prefer `.cmd` or `.exe` over `.ps1`. |
| `CODEX_EXECUTOR_ARGS` | Optional | Argument template for the command. By default the bridge sends the prompt through stdin. |
| `EXECUTOR_MODEL` | Optional | Default model label written into the delegated prompt. |
| `EXECUTOR_TIMEOUT_MS` | Optional | Timeout for a delegated Codex task. Defaults to 30 minutes. |

## Argument Placeholders

| Placeholder | Description |
| --- | --- |
| `{taskId}` | Bridge task ID |
| `{projectRoot}` | Project directory |
| `{promptFile}` | Generated Codex prompt file |
| `{sandbox}` | Requested sandbox mode |
| `{model}` | Requested model |
| `{title}` | Task title |

## PowerShell Relay Example

If Codex must be started through a relay script:

```json
{
  "CODEX_EXECUTOR_COMMAND": "powershell",
  "CODEX_EXECUTOR_ARGS": "-File E:/scripts/run-codex-task.ps1 -Workspace {projectRoot} -PromptFile {promptFile} -Sandbox {sandbox}"
}
```

## Manual Mode

If `CODEX_EXECUTOR_COMMAND` is not set, `submit_task` still writes:

```text
<projectRoot>/.agent-bridge/tasks/<taskId>/prompt.md
```

The task remains `pending`. Copy that prompt into Codex manually, then let TRAE inspect the result.

## Permission Approval

TRAE cannot directly approve Codex CLI permission prompts from desktop or mobile. The MCP bridge starts Codex as a child process and can read logs/status, but it cannot click Codex's interactive approval UI.

Recommended non-interactive mode:

```json
{
  "CODEX_EXECUTOR_ARGS": "exec --cd {projectRoot} --sandbox workspace-write --ask-for-approval never -"
}
```

If Codex needs a command outside that policy, the task should fail and TRAE should inspect `get_task_log`, then submit a narrower `request_revision` or ask the user to handle the step manually on desktop.

Only use broader permissions, such as `--sandbox danger-full-access --ask-for-approval never`, when the whole workspace is externally sandboxed and trusted.

## TRAE Usage Pattern

Recommended instruction for TRAE:

```text
First analyze the project and split the work. Complete simple tasks directly.
For difficult implementation tasks, use the codex-task-bridge MCP tool submit_task.
The delegated prompt must include project context, scope, constraints, acceptance criteria, and verification commands.
After Codex finishes, inspect logs and results, review the diff, and request a revision if needed.
```

## Shared Workspace Pattern

Recommended layout:

```text
codex_trae_workspace/
  agent-collaboration-orchestrator/
  project-a/
  project-b/
```

Set `SANDBOX_ROOT` to `codex_trae_workspace`, then set each delegated task's `projectRoot` to the specific project folder.

## TRAE Skill

This repository includes a TRAE-oriented skill:

```text
skills/trae-codex-workspace/SKILL.md
```

Install or copy `skills/trae-codex-workspace` into the skills directory supported by TRAE. The skill tells TRAE how to:

- start projects from desktop or mobile
- split simple and difficult work
- delegate difficult work to Codex through MCP
- check progress
- request revisions
- cancel tasks
- view artifacts
