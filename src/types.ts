/**
 * Task types and interfaces
 */
export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
export type SandboxMode = 'read-only' | 'workspace-write' | 'danger-full-access';

export interface Task {
  id: string;
  title?: string;
  prompt: string;
  model?: string;
  sandbox?: SandboxMode;
  autoStart?: boolean;
  constraints?: Record<string, unknown>;
  acceptanceCriteria?: Record<string, unknown>;
  projectRoot?: string;
  status: TaskStatus;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
  error?: string;
  progress?: number;
  parentTaskId?: string;
}

export interface TaskLog {
  taskId: string;
  timestamp: string;
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
}

export interface Artifact {
  path: string;
  type: 'file' | 'directory';
  size?: number;
  createdAt: string;
}

export interface ResultReport {
  taskId: string;
  summary: string;
  filesCreated: string[];
  filesModified: string[];
  testResults?: {
    passed: number;
    failed: number;
    coverage?: number;
  };
  recommendations?: string[];
}

export interface EnvironmentCheck {
  name: string;
  status: 'pass' | 'fail' | 'warn';
  message?: string;
}

export interface EnvironmentDiagnosis {
  status: 'healthy' | 'degraded' | 'error';
  checks: EnvironmentCheck[];
  environment: {
    nodeVersion: string;
    platform: string;
    sandboxRoot: string;
  };
}

// MCP Tool input types
export interface SubmitTaskInput {
  prompt: string;
  title?: string;
  model?: string;
  sandbox?: SandboxMode;
  autoStart?: boolean;
  constraints?: Record<string, unknown>;
  acceptanceCriteria?: Record<string, unknown>;
  projectRoot?: string;
}

export interface GetTaskStatusInput {
  taskId: string;
}

export interface GetTaskLogInput {
  taskId: string;
  maxChars?: number;
}

export interface GetResultReportInput {
  taskId: string;
}

export interface RequestRevisionInput {
  taskId: string;
  revisionNotes: string;
  model?: string;
  sandbox?: SandboxMode;
  autoStart?: boolean;
}

export interface CancelTaskInput {
  taskId: string;
}

export interface ListArtifactsInput {
  taskId: string;
}