import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';
import {
  Artifact,
  ExecutorConfig,
  ResultReport,
  SandboxMode,
  SubmitTaskInput,
  Task,
  TaskLog,
} from './types';

export interface ExecutorRunResult {
  command: string;
  args: string[];
  cwd: string;
  promptFile: string;
  process: ChildProcessWithoutNullStreams;
}

type FileSnapshot = Map<string, { size: number; mtimeMs: number }>;

export type TaskEventSink = {
  log(taskId: string, level: TaskLog['level'], message: string): void;
  complete(taskId: string, report: ResultReport): void;
  fail(taskId: string, error: string): void;
  artifact(taskId: string, artifact: Artifact): void;
  attachExecutor(taskId: string, executor: Task['executor']): void;
};

export class CodexExecutor {
  private readonly config: ExecutorConfig;
  private readonly running = new Map<string, ChildProcessWithoutNullStreams>();

  constructor(config: ExecutorConfig) {
    this.config = config;
  }

  static fromEnv(env: NodeJS.ProcessEnv = process.env): CodexExecutor {
    const command = env.CODEX_EXECUTOR_COMMAND || env.EXECUTOR_COMMAND || env.CODEX_COMMAND;
    const argsTemplate =
      env.CODEX_EXECUTOR_ARGS ||
      env.EXECUTOR_ARGS ||
      'exec --cd {projectRoot} --sandbox {sandbox} --ask-for-approval never -';
    const timeoutMs = Number(env.EXECUTOR_TIMEOUT_MS || env.CODEX_EXECUTOR_TIMEOUT_MS || 30 * 60 * 1000);

    return new CodexExecutor({
      command,
      argsTemplate,
      defaultModel: env.EXECUTOR_MODEL || env.CODEX_MODEL,
      enabled: Boolean(command),
      timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 30 * 60 * 1000,
    });
  }

  getConfig(): ExecutorConfig {
    return { ...this.config };
  }

  async run(task: Task, input: SubmitTaskInput, sink: TaskEventSink): Promise<ExecutorRunResult | null> {
    const projectRoot = path.resolve(task.projectRoot || process.cwd());
    const beforeSnapshot = await this.snapshotProject(projectRoot);
    const promptFile = await this.writePromptFile(task, input, projectRoot);
    sink.artifact(task.id, {
      path: promptFile,
      type: 'file',
      changeType: 'created',
      createdAt: new Date().toISOString(),
    });

    if (!this.config.enabled || !this.config.command) {
      sink.log(task.id, 'warn', 'No Codex executor command configured. Task is queued for manual execution.');
      sink.attachExecutor(task.id, {
        command: '',
        args: [],
        promptFile,
        cwd: projectRoot,
        exitCode: null,
      });
      return null;
    }

    const args = this.expandArgs(task, promptFile, projectRoot);

    sink.log(task.id, 'info', `Starting Codex executor: ${this.config.command} ${args.join(' ')}`);

    const child = spawn(this.config.command, args, {
      cwd: projectRoot,
      env: process.env,
      shell: this.shouldUseShell(this.config.command),
    });

    this.running.set(task.id, child);
    sink.attachExecutor(task.id, {
      command: this.config.command,
      args,
      promptFile,
      cwd: projectRoot,
      exitCode: null,
    });

    const timeout = setTimeout(() => {
      sink.log(task.id, 'error', `Executor timed out after ${this.config.timeoutMs}ms`);
      child.kill();
    }, this.config.timeoutMs);

    child.stdout.on('data', (chunk: Buffer) => {
      sink.log(task.id, 'info', chunk.toString('utf8').trimEnd());
    });

    child.stderr.on('data', (chunk: Buffer) => {
      sink.log(task.id, 'warn', chunk.toString('utf8').trimEnd());
    });

    child.stdin.on('error', (error) => {
      sink.log(task.id, 'warn', `Failed to write prompt to Codex stdin: ${error.message}`);
    });

    child.stdin.write(await fs.readFile(promptFile, 'utf8'));
    child.stdin.end();

    child.on('error', (error) => {
      clearTimeout(timeout);
      this.running.delete(task.id);
      sink.fail(task.id, error.message);
    });

    child.on('close', (code) => {
      clearTimeout(timeout);
      this.running.delete(task.id);
      sink.attachExecutor(task.id, {
        command: this.config.command || '',
        args,
        promptFile,
        cwd: projectRoot,
        exitCode: code,
      });

      void this.finishRun(task, projectRoot, beforeSnapshot, promptFile, code, sink).catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        sink.fail(task.id, `Failed to collect artifacts: ${message}`);
      });
    });

    return {
      command: this.config.command,
      args,
      cwd: projectRoot,
      promptFile,
      process: child,
    };
  }

  cancel(taskId: string): boolean {
    const child = this.running.get(taskId);
    if (!child) return false;
    child.kill();
    this.running.delete(taskId);
    return true;
  }

  private async writePromptFile(task: Task, input: SubmitTaskInput, projectRoot: string): Promise<string> {
    const taskDir = path.join(projectRoot, '.agent-bridge', 'tasks', task.id);
    await fs.mkdir(taskDir, { recursive: true });
    const promptFile = path.join(taskDir, 'prompt.md');
    await fs.writeFile(promptFile, this.renderPrompt(task, input), 'utf8');
    return promptFile;
  }

  private renderPrompt(task: Task, input: SubmitTaskInput): string {
    const metadata = [
      `# ${task.title || 'Executor Task'}`,
      '',
      `- Task ID: ${task.id}`,
      `- Sandbox: ${task.sandbox || 'workspace-write'}`,
      `- Model: ${task.model || this.config.defaultModel || 'default'}`,
      `- Project Root: ${task.projectRoot || process.cwd()}`,
      '',
    ].join('\n');

    const sections = [
      metadata,
      '## Task',
      task.prompt,
      '',
      '## Constraints',
      JSON.stringify(input.constraints || {}, null, 2),
      '',
      '## Acceptance Criteria',
      JSON.stringify(input.acceptanceCriteria || {}, null, 2),
      '',
      '## Collaboration Contract',
      this.contract(task.sandbox || 'workspace-write'),
      '',
    ];

    return sections.join('\n');
  }

  private contract(sandbox: SandboxMode): string {
    return [
      '- TRAE Work is the primary operator and planner for the overall project request.',
      '- Codex is being invoked as an executor for the difficult or implementation-heavy part of the work.',
      '- Keep changes focused on the requested task.',
      '- Do not overwrite unrelated user changes.',
      `- Requested sandbox mode: ${sandbox}.`,
      '- Report changed files, tests run, and remaining risks before finishing.',
    ].join('\n');
  }

  private expandArgs(task: Task, promptFile: string, projectRoot: string): string[] {
    const raw = this.config.argsTemplate || '';
    const replacements: Record<string, string> = {
      taskId: task.id,
      promptFile,
      projectRoot,
      sandbox: task.sandbox || 'workspace-write',
      model: task.model || this.config.defaultModel || '',
      title: task.title || '',
    };

    return this.splitArgs(raw).map((arg) =>
      arg.replace(/\{(\w+)\}/g, (_, key: string) => replacements[key] ?? '')
    );
  }

  private splitArgs(input: string): string[] {
    const args: string[] = [];
    const pattern = /"([^"]*)"|'([^']*)'|[^\s]+/g;
    let match: RegExpExecArray | null;

    while ((match = pattern.exec(input)) !== null) {
      args.push(match[1] ?? match[2] ?? match[0]);
    }

    return args;
  }

  private async finishRun(
    task: Task,
    projectRoot: string,
    beforeSnapshot: FileSnapshot,
    promptFile: string,
    exitCode: number | null,
    sink: TaskEventSink
  ): Promise<void> {
    const changedArtifacts = await this.collectChangedArtifacts(projectRoot, beforeSnapshot, promptFile);
    for (const artifact of changedArtifacts) {
      sink.artifact(task.id, artifact);
    }

    const filesCreated = changedArtifacts
      .filter((artifact) => artifact.changeType === 'created')
      .map((artifact) => artifact.path);
    const filesModified = changedArtifacts
      .filter((artifact) => artifact.changeType === 'modified')
      .map((artifact) => artifact.path);

    if (exitCode === 0) {
      sink.complete(task.id, {
        taskId: task.id,
        summary: 'Codex executor completed successfully. Review the workspace diff and task log for details.',
        filesCreated,
        filesModified,
        recommendations: [
          'Run project tests and review git diff before accepting the result.',
          'Use request_revision if the implementation does not match the acceptance criteria.',
        ],
      });
    } else {
      sink.log(task.id, 'warn', `Detected ${changedArtifacts.length} changed artifact(s) before failure.`);
      sink.fail(task.id, `Codex executor exited with code ${exitCode}`);
    }
  }

  private async collectChangedArtifacts(
    projectRoot: string,
    beforeSnapshot: FileSnapshot,
    promptFile: string
  ): Promise<Artifact[]> {
    const afterSnapshot = await this.snapshotProject(projectRoot);
    const promptPath = path.resolve(promptFile);
    const artifacts: Artifact[] = [];

    for (const [filePath, after] of afterSnapshot.entries()) {
      const resolved = path.resolve(filePath);
      if (resolved === promptPath) continue;

      const before = beforeSnapshot.get(filePath);
      if (!before) {
        artifacts.push({
          path: filePath,
          type: 'file',
          changeType: 'created',
          size: after.size,
          createdAt: new Date().toISOString(),
        });
        continue;
      }

      if (before.size !== after.size || before.mtimeMs !== after.mtimeMs) {
        artifacts.push({
          path: filePath,
          type: 'file',
          changeType: 'modified',
          size: after.size,
          createdAt: new Date().toISOString(),
        });
      }
    }

    return artifacts;
  }

  private async snapshotProject(projectRoot: string): Promise<FileSnapshot> {
    const snapshot: FileSnapshot = new Map();
    await this.walkProject(projectRoot, snapshot);
    return snapshot;
  }

  private async walkProject(dir: string, snapshot: FileSnapshot): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      if (this.shouldIgnore(entry.name)) continue;

      const entryPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await this.walkProject(entryPath, snapshot);
        continue;
      }

      if (!entry.isFile()) continue;

      const stats = await fs.stat(entryPath);
      snapshot.set(entryPath, {
        size: stats.size,
        mtimeMs: stats.mtimeMs,
      });
    }
  }

  private shouldIgnore(name: string): boolean {
    return new Set([
      '.git',
      '.hg',
      '.svn',
      '.agent-bridge',
      'node_modules',
      'dist',
      'build',
      'out',
      'coverage',
      '.next',
      '.nuxt',
      '.cache',
      '.turbo',
      '.vite',
      '.parcel-cache',
    ]).has(name);
  }

  private shouldUseShell(command: string): boolean {
    if (process.platform !== 'win32') return false;
    const lower = command.toLowerCase();
    return lower.endsWith('.cmd') || lower.endsWith('.bat');
  }
}
