import { v4 as uuidv4 } from 'uuid';
import {
  Task,
  TaskStatus,
  TaskLog,
  Artifact,
  ResultReport,
  EnvironmentDiagnosis,
  SubmitTaskInput,
  RequestRevisionInput,
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
  private sandboxRoot: string;

  constructor(sandboxRoot: string = process.cwd()) {
    this.sandboxRoot = sandboxRoot;
  }

  /**
   * Submit a new task
   */
  submitTask(input: SubmitTaskInput): Task {
    const taskId = uuidv4();
    const now = new Date().toISOString();

    const task: Task = {
      id: taskId,
      title: input.title,
      prompt: input.prompt,
      model: input.model,
      sandbox: input.sandbox || 'workspace-write',
      autoStart: input.autoStart ?? true,
      constraints: input.constraints,
      acceptanceCriteria: input.acceptanceCriteria,
      projectRoot: input.projectRoot || this.sandboxRoot,
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
      projectRoot: parentTask.projectRoot,
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

    this.addLog(taskId, 'info', 'Task cancelled by user');

    return task;
  }

  /**
   * List artifacts for a task
   */
  listArtifacts(taskId: string): Artifact[] {
    return this.taskArtifacts.get(taskId) || [];
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
      artifacts.push(artifact);
    }
  }

  /**
   * Set result report (internal method for executor)
   */
  setResultReport(taskId: string, report: ResultReport): void {
    this.taskReports.set(taskId, report);
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

  /**
   * Get all tasks (for debugging)
   */
  getAllTasks(): Task[] {
    return Array.from(this.tasks.values());
  }
}