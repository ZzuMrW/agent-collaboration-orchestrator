---
name: trae-codex-collaboration
description: Coordinate TRAE Work as the primary project operator and Codex as the delegated executor for difficult implementation tasks through the agent-collaboration-orchestrator MCP bridge.
---

# TRAE Calls Codex Collaboration

Use this skill when TRAE Work is the first tool receiving the user's project instruction, and Codex is available through the MCP bridge for difficult subtasks.

For TRAE installation, this repository also provides a dedicated skill at:

```text
skills/trae-codex-workspace/SKILL.md
```

Use that skill inside TRAE when the workflow needs desktop/mobile progress control, project creation, cancellation, revisions, and artifact review.

## Roles

**TRAE Work is the primary operator.**

- Read the project first.
- Understand the user request.
- Produce the implementation plan and task split.
- Handle simple changes directly.
- Delegate difficult parts to Codex through MCP.
- Review Codex results and integrate the final answer.
- Support both desktop and mobile control: start tasks, check progress, revise, cancel, and view artifacts.

**Codex is the delegated executor.**

- Receive a narrow, well-specified task from TRAE.
- Implement difficult logic, complex refactors, or cross-file changes.
- Keep edits scoped to the delegated task.
- Report changed files, verification, and risks.

## Delegation Rules

TRAE should handle directly:

- small single-file edits
- simple config or documentation updates
- straightforward UI text changes
- obvious bug fixes with low blast radius

TRAE should delegate to Codex:

- complex implementation details
- cross-module refactors
- difficult debugging
- test-heavy feature work
- architecture-sensitive changes
- tasks where a second coding agent improves confidence

## Workflow

1. TRAE locates or creates the project under `codex_trae_workspace`.
2. TRAE reads the repository and summarizes the current structure.
3. TRAE writes an implementation plan and splits tasks into simple and difficult parts.
4. TRAE directly completes simple parts.
5. TRAE calls `submit_task` for difficult parts.
6. TRAE monitors Codex with `get_task_status` and `get_task_log`.
7. TRAE reviews artifacts with `list_artifacts` and reads reports with `get_result_report`.
8. If needed, TRAE calls `request_revision` with concrete correction notes.
9. If the user stops or changes direction, TRAE calls `cancel_task`.
10. TRAE gives the final user-facing answer.

## MCP Tools

### submit_task

Use this to hand a difficult task to Codex.

The prompt must include:

- project context discovered by TRAE
- exact task goal
- files or directories in scope
- files or behavior to avoid changing
- implementation constraints
- acceptance criteria
- verification commands
- expected completion report

### get_task_status

Check whether a Codex task is `pending`, `running`, `completed`, `failed`, or `cancelled`.

### get_task_log

Read Codex execution logs. Use this while waiting or when a task fails.

### get_result_report

Read the final Codex report after completion.

### request_revision

Ask Codex to revise a previous task. Notes must be specific and actionable.

### cancel_task

Cancel a task if the user changes direction or TRAE submitted the wrong scope.

### diagnose_environment

Use this when tasks remain pending, Codex does not start, or the bridge configuration looks wrong.

## Codex Task Prompt Template

```markdown
## Project Context
[TRAE's brief analysis of the repository and relevant conventions.]

## Delegated Task
[The difficult part Codex should implement.]

## Scope
- Prefer modifying: [...]
- Do not modify: [...]

## Requirements
- [...]

## Constraints
- Preserve unrelated user changes.
- Follow existing project style.
- Keep the change focused on this delegated task.

## Verification
- Run: [...]
- If a command cannot run, explain why.

## Completion Report
Please report:
- files changed
- commands/tests run
- behavior implemented
- unresolved risks
```

## Example submit_task

```json
{
  "prompt": "TRAE has analyzed the project. It is a Vite React app using Zustand for state. Please implement the difficult part: persistent undo/redo state for the canvas editor. Scope: src/store/canvas-store.ts and related tests only. Do not change routing or package manager. Run npm test -- canvas-store and report the result.",
  "title": "Implement persistent canvas undo redo",
  "sandbox": "workspace-write",
  "constraints": {
    "doNotChange": ["package.json", "src/router.tsx"],
    "preferredFiles": ["src/store/canvas-store.ts", "src/store/canvas-store.test.ts"]
  },
  "acceptanceCriteria": {
    "checks": [
      "undo and redo preserve canvas state",
      "state survives reload through existing persistence layer",
      "related tests pass"
    ]
  }
}
```

## Review Checklist For TRAE

After Codex finishes, TRAE must check:

- Did Codex stay within scope?
- Are unrelated files modified?
- Does the result satisfy the acceptance criteria?
- Did tests or type checks run?
- Are logs or reports showing failures?
- Is a revision needed?

## Important Rules

- TRAE remains responsible for the overall user request.
- Codex should receive narrow tasks, not vague project-level instructions.
- Do not delegate before TRAE has done a first pass over the project.
- Do not place secrets in delegated prompts.
- If no Codex executor command is configured, use the generated prompt file manually.
