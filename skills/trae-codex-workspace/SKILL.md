---
name: trae-codex-workspace
description: Run a TRAE-led collaborative coding workflow where TRAE desktop or mobile starts project work, tracks progress, adjusts or cancels tasks, views artifacts, and delegates difficult implementation subtasks to Codex through the agent-collaboration-orchestrator MCP bridge. Use when the user mentions TRAE, Codex collaboration, mobile/desktop project control, codex_trae_workspace, MCP task delegation, project creation, progress tracking, revisions, cancellation, or artifact review.
---

# TRAE Codex Workspace

Use this skill inside TRAE. TRAE is the primary operator. Codex is the delegated executor for difficult coding subtasks through the MCP bridge.

## Workspace Rule

Recommend creating one shared workspace before starting collaboration:

```text
codex_trae_workspace/
  project-a/
  project-b/
  agent-collaboration-orchestrator/
```

Keep collaborative development projects inside `codex_trae_workspace`. When calling MCP tools, set `projectRoot` to the specific project directory, not the workspace root, unless creating a brand-new project.

## Cross-Device Rule

TRAE desktop and mobile can both operate this workflow:

- Mobile can start a project or submit a task.
- Mobile can view a compact dashboard with `get_mobile_dashboard`.
- Mobile can check progress with `get_task_status`.
- Mobile can inspect logs with `get_task_log`.
- Mobile can adjust direction with `request_revision`.
- Mobile can stop work with `cancel_task`.
- Mobile can review generated files with `list_artifacts`.
- Mobile can review bridge-generated permission requests with `list_permission_requests` and approve/reject them with `resolve_permission_request`.
- Desktop is preferred for detailed diff review, local testing, and resolving conflicts.

Always keep task titles clear so mobile task lists are readable.

## Core Workflow

1. Read the user request and identify the project directory in `codex_trae_workspace`.
2. If the project does not exist, create or ask to create a new project folder under `codex_trae_workspace`.
3. TRAE performs the first rough pass:
   - scan project structure
   - identify stack and conventions
   - produce implementation plan
   - split simple work and difficult work
4. TRAE completes simple work directly.
5. TRAE delegates difficult work with `submit_task`.
6. Track progress with `get_mobile_dashboard` or `get_task_status`.
7. Inspect executor details with `get_task_log`.
8. View prompt/report/generated artifacts with `list_artifacts` and `get_result_report`.
9. Adjust work with `request_revision` when requirements change or Codex output is incomplete.
10. Stop work with `cancel_task` when the user cancels or the delegated scope is wrong.
11. If Codex failed due to permission or sandbox restrictions, use `list_permission_requests` and ask the user whether to approve a retry.

## MCP Tool Usage

### Create Or Delegate Work: submit_task

Use for:

- project creation that requires non-trivial scaffolding
- complex implementation
- cross-file refactor
- difficult debugging
- tests or integration work that benefits from Codex

Prompt requirements:

- project context from TRAE's initial scan
- exact delegated goal
- `projectRoot`
- preferred files/directories
- forbidden files/directories
- constraints
- acceptance criteria
- verification commands
- final report requirements

Example:

```json
{
  "title": "Implement auth service core",
  "projectRoot": "E:/codex_trae_workspace/my-app",
  "sandbox": "workspace-write",
  "prompt": "TRAE has scanned the project. It is a Node.js API using Fastify and Prisma. Please implement the difficult part: auth service token refresh and tests. Scope: src/services/auth.ts and tests/auth.test.ts. Do not modify prisma/schema.prisma or package.json. Run npm test -- auth and report the result.",
  "constraints": {
    "preferredFiles": ["src/services/auth.ts", "tests/auth.test.ts"],
    "doNotChange": ["prisma/schema.prisma", "package.json"]
  },
  "acceptanceCriteria": {
    "checks": [
      "refresh token flow works",
      "invalid tokens are rejected",
      "related tests pass"
    ]
  }
}
```

### Check Progress: get_task_status

Use when the user asks:

- "进度怎么样"
- "现在做到哪了"
- "手机上帮我看一下状态"
- "这个任务还在跑吗"

Report status, last update time, and whether action is needed.

### Mobile Dashboard: get_mobile_dashboard

Use first when the user is on mobile or asks:

- "手机上看一下总进度"
- "现在有哪些任务"
- "有没有待审批"
- "看一下 Codex 当前在做什么"

Report:

- running/pending/completed/failed counts
- recent task titles and statuses
- latest log summary
- artifact count
- pending permission requests

Mobile response shape:

```text
总览：running 1，failed 1，待审批 1
任务：
- 实现 auth service core：failed，产物 2，待审批 1
- 修复 UI 文案：completed，产物 3
待处理：permission-request-id，需要更高沙箱重试
```

### Inspect Logs: get_task_log

Use when:

- status is `running` for a long time
- status is `failed`
- user asks for details
- TRAE needs to decide whether to revise or cancel

Summarize logs. Do not dump long logs unless the user asks.

### View Results: get_result_report

Use after completion to summarize:

- behavior implemented
- verification commands
- risks
- recommendations

### View Artifacts: list_artifacts

Use when the user asks:

- "查看产物"
- "生成了什么"
- "手机上看看文件"
- "prompt 文件在哪"

Mention artifact paths. The bridge records the generated Codex prompt file immediately. After Codex exits, the bridge also scans the project and lists created or modified files, excluding common noisy folders such as `.git`, `.agent-bridge`, `node_modules`, `dist`, `build`, coverage, and cache directories.

On mobile, summarize artifacts compactly:

```text
产物：
- prompt: .agent-bridge/tasks/<taskId>/prompt.md
- created: src/services/auth.ts
- modified: tests/auth.test.ts
```

### Adjust Direction: request_revision

Use when:

- user changes requirements from mobile or desktop
- Codex output misses acceptance criteria
- TRAE finds a bug during review
- scope must be narrowed

Revision notes must include:

- what changed
- what Codex should fix
- what should remain untouched
- which verification command to rerun

### Stop Work: cancel_task

Use when:

- user explicitly stops the task
- user changes direction before completion
- delegated scope is wrong
- task is stuck and should not continue

After canceling, summarize whether any artifacts or partial files need review.

### Permission Requests: list_permission_requests

Use when:

- `get_mobile_dashboard` shows pending permissions
- the user asks "有什么权限要批准"
- Codex failed because of sandbox or permission restrictions
- the user asks to approve or reject Codex permission

Explain that this is not clicking Codex's interactive UI. It is a bridge-level approval that creates a retry task with broader sandbox settings.

### Resolve Permission: resolve_permission_request

Use when the user explicitly approves or rejects a pending permission request.

Approval example:

```json
{
  "requestId": "permission-request-id",
  "decision": "approve",
  "sandbox": "danger-full-access",
  "note": "User approved retry from TRAE mobile after reviewing the blocked command."
}
```

Rejection example:

```json
{
  "requestId": "permission-request-id",
  "decision": "reject",
  "note": "User wants TRAE to narrow the task instead."
}
```

After approval, report the new retry task ID and monitor that new task.

## Mobile-Friendly Reporting

When responding for mobile, keep updates compact:

```text
任务：实现 auth service core
状态：running
最近日志：已开始写入 prompt，Codex 执行中
产物：.agent-bridge/tasks/<taskId>/prompt.md
下一步：等待完成或发送新要求触发 revision
```

## Project Creation Pattern

For a new project request:

1. Confirm or infer the project name.
2. Use `codex_trae_workspace/<project-name>` as `projectRoot`.
3. TRAE creates simple scaffolding directly if it is low risk.
4. Delegate complex scaffolding or implementation to Codex with `submit_task`.
5. Use `list_artifacts` and workspace file review to show outputs.

## Safety Rules

- Keep all collaborative projects under `codex_trae_workspace`.
- Do not delegate vague whole-project instructions to Codex.
- Do not place secrets, account cookies, API keys, or relay credentials in prompts.
- Prefer `workspace-write`.
- Use `danger-full-access` only when the user explicitly approves.
- TRAE remains responsible for final review and user-facing progress reporting.

## Codex Permission Handling

TRAE desktop/mobile cannot directly approve an interactive Codex CLI permission prompt. The bridge runs Codex as a child process, so TRAE can inspect logs and status but cannot click Codex's approval UI.

Prefer non-interactive Codex execution:

```text
codex exec --cd {projectRoot} --sandbox workspace-write --ask-for-approval never -
```

If Codex fails because it needs more permission, the bridge may create a pending permission request. TRAE can show it on mobile and resolve it:

1. Use `get_mobile_dashboard` or `list_permission_requests` to find pending requests.
2. Explain the requested broader sandbox and reason.
3. If the user approves, call `resolve_permission_request`.
4. Monitor the retry task returned by the approval.
5. If the user rejects, call `request_revision` only if a narrower task is still useful.

Use broader permissions only in a trusted, externally sandboxed `codex_trae_workspace`.
