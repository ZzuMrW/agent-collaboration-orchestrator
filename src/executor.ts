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

export class AgentExecutor {
  private readonly config: ExecutorConfig;
  private readonly running = new Map<string, ChildProcessWithoutNullStreams>();

  constructor(config: ExecutorConfig) {
    this.config = config;
  }

  static fromEnv(env: NodeJS.ProcessEnv = process.env): AgentExecutor {
    const command = env.EXECUTOR_COMMAND || env.CODEX_EXECUTOR_COMMAND || env.CODEX_COMMAND;
    const argsTemplate =
      env.EXECUTOR_ARGS ||
      env.CODEX_EXECUTOR_ARGS ||
      '--ask-for-approval never exec --cd {projectRoot} --sandbox {sandbox} -';
    const timeoutMs = Number(env.EXECUTOR_TIMEOUT_MS || env.CODEX_EXECUTOR_TIMEOUT_MS || 30 * 60 * 1000);

    return new AgentExecutor({
      agent: env.EXECUTOR_AGENT || 'Codex',
      orchestrator: env.ORCHESTRATOR_AGENT || 'TRAE Work',
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
      sink.log(task.id, 'warn', 'No executor command configured. Task is queued for manual execution.');
      sink.attachExecutor(task.id, {
        command: '',
        args: [],
        promptFile,
        cwd: projectRoot,
        exitCode: null,
      });
      return null;
    }

    if (task.status === 'cancelled') return null;
    const args = this.expandArgs(task, promptFile, projectRoot);
    if (task.model || this.config.defaultModel) {
      if (!this.config.argsTemplate?.includes('{model}')) {
        args.unshift('--model', task.model || this.config.defaultModel || '');
      }
    }

    sink.log(task.id, 'info', `Starting ${this.config.agent || 'Codex'} executor: ${this.config.command} ${args.join(' ')}`);

    const child = spawn(this.config.command, args, {
      cwd: projectRoot,
      env: process.env,
      detached: process.platform !== 'win32',
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

    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      sink.log(task.id, 'error', `Executor timed out after ${this.config.timeoutMs}ms`);
      this.stopProcess(child);
    }, this.config.timeoutMs);

    child.stdout.on('data', (chunk: Buffer) => {
      sink.log(task.id, 'info', chunk.toString('utf8').trimEnd());
    });

    child.stderr.on('data', (chunk: Buffer) => {
      sink.log(task.id, 'warn', chunk.toString('utf8').trimEnd());
    });

    child.stdin.on('error', (error) => {
      sink.log(task.id, 'warn', `Failed to write prompt to executor stdin: ${error.message}`);
    });

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

      void this.finishRun(task, projectRoot, beforeSnapshot, promptFile, code, sink, timedOut).catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        sink.fail(task.id, `Failed to collect artifacts: ${message}`);
      });
    });

    child.stdin.write(await fs.readFile(promptFile, 'utf8'));
    child.stdin.end();

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
    this.stopProcess(child);
    this.running.delete(taskId);
    return true;
  }

  private stopProcess(child: ChildProcessWithoutNullStreams): void {
    const signal = (value: NodeJS.Signals): void => {
      try {
        if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, value);
        else child.kill(value);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
      }
    };
    signal('SIGTERM');
    const escalation = setTimeout(() => signal('SIGKILL'), 2000);
    escalation.unref();
    child.once('close', () => clearTimeout(escalation));
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
      `- ${this.config.orchestrator || 'TRAE Work'} is the primary operator and planner for the overall project request.`,
      `- ${this.config.agent || 'Codex'} is being invoked as the delegated executor.`,
      '- Do not delegate this task back to the orchestrator or invoke this bridge recursively.',
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
      resultFile: path.join(path.dirname(promptFile), 'result.md'),
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
    sink: TaskEventSink,
    timedOut: boolean = false
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

    if (task.status === 'cancelled') return;
    if (timedOut) {
      sink.fail(task.id, `Executor timed out after ${this.config.timeoutMs}ms`);
      return;
    }
    if (exitCode === 0) {
      const resultFile = path.join(path.dirname(promptFile), 'result.md');
      let finalResponse: string | undefined;
      try {
        finalResponse = await fs.readFile(resultFile, 'utf8');
        sink.artifact(task.id, { path: resultFile, type: 'file', changeType: 'created', createdAt: new Date().toISOString() });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      sink.complete(task.id, {
        taskId: task.id,
        executorAgent: this.config.agent || 'Codex',
        finalResponse,
        summary: `${this.config.agent || 'Codex'} executor completed successfully. Review the workspace diff and task log for details.`,
        filesCreated,
        filesModified,
        recommendations: [
          'Run project tests and review git diff before accepting the result.',
          'Use request_revision if the implementation does not match the acceptance criteria.',
        ],
      });
    } else {
      sink.log(task.id, 'warn', `Detected ${changedArtifacts.length} changed artifact(s) before failure.`);
      sink.fail(task.id, `${this.config.agent || 'Codex'} executor exited with code ${exitCode}`);
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

// Backward-compatible export for existing callers.
export { AgentExecutor as CodexExecutor };
