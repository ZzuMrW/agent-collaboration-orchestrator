import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import { CodexExecutor, TaskEventSink } from './executor';
import {
  Task,
  TaskStatus,
  TaskLog,
  Artifact,
  ResultReport,
  EnvironmentDiagnosis,
  SubmitTaskInput,
  RequestRevisionInput,
  ListTasksInput,
  GetMobileDashboardInput,
  ListPermissionRequestsInput,
  ResolvePermissionRequestInput,
  PermissionRequest,
  TaskSummary,
  MobileDashboard,
  SandboxMode,
} from './types';

/**
 * Task Manager - Manages task lifecycle and storage
 */
export class TaskManager {
  private tasks: Map<string, Task> = new Map();
  private taskLogs: Map<string, TaskLog[]> = new Map();
  private taskArtifacts: Map<string, Artifact[]> = new Map();
  private taskReports: Map<string, ResultReport> = new Map();
  private permissionRequests: Map<string, PermissionRequest> = new Map();
  private sandboxRoot: string;
  private executor: CodexExecutor;

  constructor(sandboxRoot: string = process.cwd(), executor: CodexExecutor = CodexExecutor.fromEnv()) {
    this.sandboxRoot = path.resolve(sandboxRoot);
    this.executor = executor;
  }

  /**
   * Submit a new task
   */
  submitTask(input: SubmitTaskInput): Task {
    const taskId = uuidv4();
    const now = new Date().toISOString();
    const projectRoot = this.resolveProjectRoot(input.projectRoot);

    const task: Task = {
      id: taskId,
      title: input.title,
      prompt: input.prompt,
      model: input.model,
      sandbox: input.sandbox || 'workspace-write',
      autoStart: input.autoStart ?? true,
      constraints: input.constraints,
      acceptanceCriteria: input.acceptanceCriteria,
      projectRoot,
      status: input.autoStart !== false ? 'running' : 'pending',
      createdAt: now,
      updatedAt: now,
      startedAt: input.autoStart !== false ? now : undefined,
    };

    this.tasks.set(taskId, task);
    this.taskLogs.set(taskId, []);
    this.taskArtifacts.set(taskId, []);

    this.addLog(taskId, 'info', `Task created: ${input.title || 'Untitled'}`);
    this.addLog(taskId, 'info', `Sandbox mode: ${task.sandbox}`);
    this.addLog(taskId, 'info', `Project root: ${task.projectRoot}`);

    if (input.autoStart !== false) {
      void this.startExecutor(task, input);
    } else {
      this.addLog(taskId, 'info', 'Task is pending because autoStart=false');
    }

    return task;
  }

  /**
   * Get task status
   */
  getTaskStatus(taskId: string): Task | null {
    return this.tasks.get(taskId) || null;
  }

  /**
   * Get task logs
   */
  getTaskLogs(taskId: string, maxChars?: number): TaskLog[] {
    const logs = this.taskLogs.get(taskId) || [];

    if (maxChars) {
      let totalChars = 0;
      const truncatedLogs: TaskLog[] = [];

      for (const log of logs) {
        const logStr = JSON.stringify(log);
        if (totalChars + logStr.length > maxChars) break;
        totalChars += logStr.length;
        truncatedLogs.push(log);
      }

      return truncatedLogs;
    }

    return logs;
  }

  /**
   * Get result report
   */
  getResultReport(taskId: string): ResultReport | null {
    return this.taskReports.get(taskId) || null;
  }

  /**
   * Request revision for a task
   */
  requestRevision(input: RequestRevisionInput): Task | null {
    const parentTask = this.tasks.get(input.taskId);
    if (!parentTask) return null;

    const newTaskId = uuidv4();
    const now = new Date().toISOString();

    const newTask: Task = {
      id: newTaskId,
      title: `Revision: ${parentTask.title || 'Untitled'}`,
      prompt: `Revision requested.\n\nOriginal task:\n${parentTask.prompt}\n\nRevision notes:\n${input.revisionNotes}`,
      model: input.model || parentTask.model,
      sandbox: input.sandbox || parentTask.sandbox,
      autoStart: input.autoStart ?? true,
      constraints: parentTask.constraints,
      acceptanceCriteria: parentTask.acceptanceCriteria,
      projectRoot: parentTask.projectRoot || this.sandboxRoot,
      status: input.autoStart !== false ? 'running' : 'pending',
      createdAt: now,
      updatedAt: now,
      startedAt: input.autoStart !== false ? now : undefined,
      parentTaskId: input.taskId,
    };

    this.tasks.set(newTaskId, newTask);
    this.taskLogs.set(newTaskId, []);
    this.taskArtifacts.set(newTaskId, []);

    this.addLog(newTaskId, 'info', `Revision task created from parent: ${input.taskId}`);

    if (input.autoStart !== false) {
      void this.startExecutor(newTask, {
        prompt: newTask.prompt,
        title: newTask.title,
        model: newTask.model,
        sandbox: newTask.sandbox,
        autoStart: newTask.autoStart,
        constraints: newTask.constraints,
        acceptanceCriteria: newTask.acceptanceCriteria,
        projectRoot: newTask.projectRoot,
      });
    }

    return newTask;
  }

  /**
   * Cancel a task
   */
  cancelTask(taskId: string): Task | null {
    const task = this.tasks.get(taskId);
    if (!task) return null;

    if (task.status !== 'running' && task.status !== 'pending') {
      return null;
    }

    const now = new Date().toISOString();
    task.status = 'cancelled';
    task.updatedAt = now;
    task.completedAt = now;

    this.executor.cancel(taskId);
    this.addLog(taskId, 'info', 'Task cancelled by user');

    return task;
  }

  /**
   * List artifacts for a task
   */
  listArtifacts(taskId: string): Artifact[] {
    return this.taskArtifacts.get(taskId) || [];
  }

  listTasks(input: ListTasksInput = {}): TaskSummary[] {
    const limit = input.limit && input.limit > 0 ? input.limit : 50;
    return Array.from(this.tasks.values())
      .filter((task) => !input.status || task.status === input.status)
      .filter((task) => !input.projectRoot || path.resolve(task.projectRoot || '') === path.resolve(input.projectRoot))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, limit)
      .map((task) => this.toTaskSummary(task));
  }

  getMobileDashboard(input: GetMobileDashboardInput = {}): MobileDashboard {
    const filteredTasks = this.listTasks({ projectRoot: input.projectRoot, limit: input.limit || 20 });
    const allTasks = Array.from(this.tasks.values())
      .filter((task) => !input.projectRoot || path.resolve(task.projectRoot || '') === path.resolve(input.projectRoot));
    const pendingPermissions = this.listPermissionRequests({ status: 'pending' })
      .filter((request) => {
        if (!input.projectRoot) return true;
        const task = this.tasks.get(request.taskId);
        return Boolean(task && path.resolve(task.projectRoot || '') === path.resolve(input.projectRoot));
      });

    return {
      generatedAt: new Date().toISOString(),
      totals: {
        all: allTasks.length,
        running: allTasks.filter((task) => task.status === 'running').length,
        pending: allTasks.filter((task) => task.status === 'pending').length,
        completed: allTasks.filter((task) => task.status === 'completed').length,
        failed: allTasks.filter((task) => task.status === 'failed').length,
        cancelled: allTasks.filter((task) => task.status === 'cancelled').length,
        pendingPermissions: pendingPermissions.length,
      },
      tasks: filteredTasks,
      permissionRequests: pendingPermissions,
    };
  }

  listPermissionRequests(input: ListPermissionRequestsInput = {}): PermissionRequest[] {
    return Array.from(this.permissionRequests.values())
      .filter((request) => !input.status || request.status === input.status)
      .filter((request) => !input.taskId || request.taskId === input.taskId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  resolvePermissionRequest(input: ResolvePermissionRequestInput): PermissionRequest | null {
    const request = this.permissionRequests.get(input.requestId);
    if (!request || request.status !== 'pending') return null;

    const now = new Date().toISOString();
    request.resolvedAt = now;
    request.resolutionNote = input.note;

    if (input.decision === 'reject') {
      request.status = 'rejected';
      this.addLog(request.taskId, 'warn', `Permission request rejected: ${input.note || 'No note provided'}`);
      return request;
    }

    const parentTask = this.tasks.get(request.taskId);
    if (!parentTask) return null;

    request.status = 'approved';
    const retrySandbox = input.sandbox || request.requestedSandbox;
    const retryTask = this.retryTaskWithPermission(parentTask, retrySandbox, input.autoStart);
    request.retryTaskId = retryTask.id;
    this.addLog(request.taskId, 'info', `Permission request approved; retry task created: ${retryTask.id}`);
    return request;
  }

  /**
   * Diagnose environment
   */
  diagnoseEnvironment(): EnvironmentDiagnosis {
    const checks = [];

    // Check Node.js version
    const nodeVersion = process.version;
    const majorVersion = parseInt(nodeVersion.slice(1).split('.')[0], 10);
    checks.push({
      name: 'Node.js version',
      status: majorVersion >= 18 ? 'pass' as const : 'fail' as const,
      message: `Node.js ${nodeVersion} ${majorVersion >= 18 ? '(supported)' : '(requires 18+)'}`
    });

    // Check sandbox root
    checks.push({
      name: 'Sandbox root',
      status: 'pass' as const,
      message: this.sandboxRoot
    });

    const executorConfig = this.executor.getConfig();
    checks.push({
      name: 'Codex executor command',
      status: executorConfig.enabled ? 'pass' as const : 'warn' as const,
      message: executorConfig.enabled
        ? `${executorConfig.command} ${executorConfig.argsTemplate || ''}`.trim()
        : 'Not configured. Set CODEX_EXECUTOR_COMMAND to enable automatic execution.'
    });

    // Check platform
    checks.push({
      name: 'Platform',
      status: 'pass' as const,
      message: process.platform
    });

    // Determine overall status
    const hasFail = checks.some(c => c.status === 'fail');
    const hasWarn = checks.some(c => c.status === 'warn');

    return {
      status: hasFail ? 'error' : hasWarn ? 'degraded' : 'healthy',
      checks,
      environment: {
        nodeVersion,
        platform: process.platform,
        sandboxRoot: this.sandboxRoot,
      }
    };
  }

  /**
   * Update task status (internal method for executor)
   */
  updateTaskStatus(taskId: string, status: TaskStatus, error?: string): void {
    const task = this.tasks.get(taskId);
    if (!task) return;

    const now = new Date().toISOString();
    task.status = status;
    task.updatedAt = now;

    if (status === 'completed' || status === 'failed') {
      task.completedAt = now;
    }

    if (error) {
      task.error = error;
    }

    this.addLog(taskId, status === 'completed' ? 'info' : 'error',
      status === 'completed' ? 'Task completed successfully' : `Task failed: ${error}`);
  }

  /**
   * Add artifact to task (internal method for executor)
   */
  addArtifact(taskId: string, artifact: Artifact): void {
    const artifacts = this.taskArtifacts.get(taskId);
    if (artifacts) {
      const existingIndex = artifacts.findIndex((item) => item.path === artifact.path);
      if (existingIndex >= 0) {
        artifacts[existingIndex] = artifact;
        return;
      }
      artifacts.push(artifact);
    }
  }

  /**
   * Set result report (internal method for executor)
   */
  setResultReport(taskId: string, report: ResultReport): void {
    this.taskReports.set(taskId, report);
  }

  attachExecutor(taskId: string, executor: Task['executor']): void {
    const task = this.tasks.get(taskId);
    if (!task) return;
    task.executor = executor;
    task.updatedAt = new Date().toISOString();
  }

  /**
   * Add log entry
   */
  private addLog(taskId: string, level: TaskLog['level'], message: string): void {
    const logs = this.taskLogs.get(taskId);
    if (logs) {
      logs.push({
        taskId,
        timestamp: new Date().toISOString(),
        level,
        message,
      });
    }
  }

  private async startExecutor(task: Task, input: SubmitTaskInput): Promise<void> {
    const sink: TaskEventSink = {
      log: (taskId, level, message) => this.addLog(taskId, level, message),
      complete: (taskId, report) => {
        this.setResultReport(taskId, report);
        this.updateTaskStatus(taskId, 'completed');
      },
      fail: (taskId, error) => {
        this.updateTaskStatus(taskId, 'failed', error);
        this.createPermissionRequestIfNeeded(taskId, error);
      },
      artifact: (taskId, artifact) => this.addArtifact(taskId, artifact),
      attachExecutor: (taskId, executor) => this.attachExecutor(taskId, executor),
    };

    try {
      const result = await this.executor.run(task, input, sink);
      if (!result) {
        this.updateTaskStatus(task.id, 'pending');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.updateTaskStatus(task.id, 'failed', message);
    }
  }

  private resolveProjectRoot(projectRoot?: string): string {
    if (!projectRoot) return this.sandboxRoot;
    const resolved = path.resolve(projectRoot);
    const relative = path.relative(this.sandboxRoot, resolved);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error(`projectRoot must be inside SANDBOX_ROOT: ${this.sandboxRoot}`);
    }
    return resolved;
  }

  private toTaskSummary(task: Task): TaskSummary {
    const logs = this.taskLogs.get(task.id) || [];
    return {
      taskId: task.id,
      title: task.title,
      status: task.status,
      projectRoot: task.projectRoot,
      sandbox: task.sandbox,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
      completedAt: task.completedAt,
      artifactCount: (this.taskArtifacts.get(task.id) || []).length,
      pendingPermissionCount: this.listPermissionRequests({ taskId: task.id, status: 'pending' }).length,
      lastLog: logs[logs.length - 1],
      error: task.error,
    };
  }

  private retryTaskWithPermission(parentTask: Task, sandbox: SandboxMode, autoStart: boolean = true): Task {
    const retryInput: SubmitTaskInput = {
      prompt: [
        'Retry after TRAE approved a broader permission request.',
        '',
        'Original task:',
        parentTask.prompt,
        '',
        'Important: keep the implementation scoped to the original task and report any command that required elevated access.',
      ].join('\n'),
      title: `Permission retry: ${parentTask.title || 'Untitled'}`,
      model: parentTask.model,
      sandbox,
      autoStart,
      constraints: parentTask.constraints,
      acceptanceCriteria: parentTask.acceptanceCriteria,
      projectRoot: parentTask.projectRoot,
    };

    const retryTask = this.submitTask(retryInput);
    retryTask.parentTaskId = parentTask.id;
    return retryTask;
  }

  private createPermissionRequestIfNeeded(taskId: string, error: string): void {
    const task = this.tasks.get(taskId);
    if (!task || task.sandbox === 'danger-full-access') return;
    if (this.listPermissionRequests({ taskId, status: 'pending' }).length > 0) return;

    const logs = this.getTaskLogs(taskId);
    const evidence = `${error}\n${logs.map((log) => log.message).join('\n')}`;
    if (!this.looksLikePermissionFailure(evidence)) return;

    const now = new Date().toISOString();
    const request: PermissionRequest = {
      id: uuidv4(),
      taskId,
      status: 'pending',
      requestedSandbox: 'danger-full-access',
      reason: this.extractPermissionReason(evidence),
      createdAt: now,
    };

    this.permissionRequests.set(request.id, request);
    this.addLog(taskId, 'warn', `Permission request created: ${request.id}`);
  }

  private looksLikePermissionFailure(text: string): boolean {
    return [
      'permission denied',
      'permissions denied',
      'approval required',
      'requires approval',
      'requires human approval',
      'requires escalated',
      'require_escalated',
      'sandbox denied',
      'sandbox restriction',
      'sandbox restrictions',
      'blocked by sandbox',
      'denied',
      'not permitted',
      'operation not permitted',
      'access is denied',
      'unauthorized',
      'outside workspace',
      'read-only file system',
    ].some((pattern) => text.toLowerCase().includes(pattern));
  }

  private extractPermissionReason(text: string): string {
    const lines = text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    const interesting = lines.find((line) => this.looksLikePermissionFailure(line));
    return interesting || 'Codex failed with a message that appears related to sandbox or permission restrictions.';
  }

  /**
   * Get all tasks (for debugging)
   */
  getAllTasks(): Task[] {
    return Array.from(this.tasks.values());
  }
}
