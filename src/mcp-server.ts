import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ErrorCode,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import { TaskManager } from './task-manager';
import {
  SubmitTaskInput,
  GetTaskStatusInput,
  GetTaskLogInput,
  GetResultReportInput,
  RequestRevisionInput,
  CancelTaskInput,
  ListArtifactsInput,
  ListTasksInput,
  GetMobileDashboardInput,
  ListPermissionRequestsInput,
  ResolvePermissionRequestInput,
} from './types';

/**
 * MCP Bridge Server
 * Implements the Model Context Protocol for agent collaboration
 */
export class McpBridgeServer {
  private server: Server;
  private taskManager: TaskManager;

  constructor(sandboxRoot?: string) {
    this.taskManager = new TaskManager(sandboxRoot);
    this.server = new Server(
      {
        name: 'agent-collaboration-bridge',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.setupHandlers();
  }

  /**
   * Setup MCP request handlers
   */
  private setupHandlers(): void {
    // List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          {
            name: 'submit_task',
            description: 'Submit a development task to the executor agent',
            inputSchema: {
              type: 'object',
              properties: {
                prompt: {
                  type: 'string',
                  description: 'Task description (required)',
                },
                title: {
                  type: 'string',
                  description: 'Task title',
                },
                model: {
                  type: 'string',
                  description: 'Model to use for execution',
                },
                sandbox: {
                  type: 'string',
                  enum: ['read-only', 'workspace-write', 'danger-full-access'],
                  description: 'Sandbox access mode',
                },
                autoStart: {
                  type: 'boolean',
                  description: 'Whether to auto-start the task',
                },
                constraints: {
                  type: 'object',
                  description: 'Task constraints',
                },
                acceptanceCriteria: {
                  type: 'object',
                  description: 'Acceptance criteria',
                },
                projectRoot: {
                  type: 'string',
                  description: 'Project root directory',
                },
              },
              required: ['prompt'],
            },
          },
          {
            name: 'get_task_status',
            description: 'Get the status of a task',
            inputSchema: {
              type: 'object',
              properties: {
                taskId: {
                  type: 'string',
                  description: 'Task ID',
                },
              },
              required: ['taskId'],
            },
          },
          {
            name: 'get_task_log',
            description: 'Get execution logs for a task',
            inputSchema: {
              type: 'object',
              properties: {
                taskId: {
                  type: 'string',
                  description: 'Task ID',
                },
                maxChars: {
                  type: 'number',
                  description: 'Maximum characters to return',
                },
              },
              required: ['taskId'],
            },
          },
          {
            name: 'get_result_report',
            description: 'Get the final result report for a completed task',
            inputSchema: {
              type: 'object',
              properties: {
                taskId: {
                  type: 'string',
                  description: 'Task ID',
                },
              },
              required: ['taskId'],
            },
          },
          {
            name: 'request_revision',
            description: 'Request revision for a task',
            inputSchema: {
              type: 'object',
              properties: {
                taskId: {
                  type: 'string',
                  description: 'Original task ID',
                },
                revisionNotes: {
                  type: 'string',
                  description: 'Notes explaining what needs to be revised',
                },
                model: {
                  type: 'string',
                  description: 'Model to use',
                },
                sandbox: {
                  type: 'string',
                  enum: ['read-only', 'workspace-write', 'danger-full-access'],
                  description: 'Sandbox access mode',
                },
                autoStart: {
                  type: 'boolean',
                  description: 'Whether to auto-start',
                },
              },
              required: ['taskId', 'revisionNotes'],
            },
          },
          {
            name: 'cancel_task',
            description: 'Cancel a running or pending task',
            inputSchema: {
              type: 'object',
              properties: {
                taskId: {
                  type: 'string',
                  description: 'Task ID to cancel',
                },
              },
              required: ['taskId'],
            },
          },
          {
            name: 'list_artifacts',
            description: 'List files and artifacts produced by a task',
            inputSchema: {
              type: 'object',
              properties: {
                taskId: {
                  type: 'string',
                  description: 'Task ID',
                },
              },
              required: ['taskId'],
            },
          },
          {
            name: 'list_tasks',
            description: 'List task summaries for TRAE desktop/mobile progress views',
            inputSchema: {
              type: 'object',
              properties: {
                status: {
                  type: 'string',
                  enum: ['pending', 'running', 'completed', 'failed', 'cancelled'],
                  description: 'Optional task status filter',
                },
                projectRoot: {
                  type: 'string',
                  description: 'Optional project root filter',
                },
                limit: {
                  type: 'number',
                  description: 'Maximum number of tasks to return',
                },
              },
            },
          },
          {
            name: 'get_mobile_dashboard',
            description: 'Get a compact dashboard with task counts, recent tasks, and pending permission requests',
            inputSchema: {
              type: 'object',
              properties: {
                projectRoot: {
                  type: 'string',
                  description: 'Optional project root filter',
                },
                limit: {
                  type: 'number',
                  description: 'Maximum number of recent task summaries to return',
                },
              },
            },
          },
          {
            name: 'list_permission_requests',
            description: 'List permission requests created after Codex fails due to sandbox or approval restrictions',
            inputSchema: {
              type: 'object',
              properties: {
                status: {
                  type: 'string',
                  enum: ['pending', 'approved', 'rejected'],
                  description: 'Optional permission request status filter',
                },
                taskId: {
                  type: 'string',
                  description: 'Optional task ID filter',
                },
              },
            },
          },
          {
            name: 'resolve_permission_request',
            description: 'Approve or reject a pending permission request. Approval creates a retry task with the requested sandbox.',
            inputSchema: {
              type: 'object',
              properties: {
                requestId: {
                  type: 'string',
                  description: 'Permission request ID',
                },
                decision: {
                  type: 'string',
                  enum: ['approve', 'reject'],
                  description: 'Whether to approve or reject the request',
                },
                note: {
                  type: 'string',
                  description: 'Optional approval or rejection note',
                },
                sandbox: {
                  type: 'string',
                  enum: ['read-only', 'workspace-write', 'danger-full-access'],
                  description: 'Sandbox to use for the retry task when approving',
                },
                autoStart: {
                  type: 'boolean',
                  description: 'Whether the retry task should start immediately',
                },
              },
              required: ['requestId', 'decision'],
            },
          },
          {
            name: 'diagnose_environment',
            description: 'Check the MCP environment configuration',
            inputSchema: {
              type: 'object',
              properties: {},
            },
          },
        ],
      };
    });

    // Handle tool calls
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;
      const toolArgs = this.getToolArgs(args);

      try {
        switch (name) {
          case 'submit_task':
            return this.handleSubmitTask(toolArgs as unknown as SubmitTaskInput);

          case 'get_task_status':
            return this.handleGetTaskStatus(toolArgs as unknown as GetTaskStatusInput);

          case 'get_task_log':
            return this.handleGetTaskLog(toolArgs as unknown as GetTaskLogInput);

          case 'get_result_report':
            return this.handleGetResultReport(toolArgs as unknown as GetResultReportInput);

          case 'request_revision':
            return this.handleRequestRevision(toolArgs as unknown as RequestRevisionInput);

          case 'cancel_task':
            return this.handleCancelTask(toolArgs as unknown as CancelTaskInput);

          case 'list_artifacts':
            return this.handleListArtifacts(toolArgs as unknown as ListArtifactsInput);

          case 'list_tasks':
            return this.handleListTasks(toolArgs as unknown as ListTasksInput);

          case 'get_mobile_dashboard':
            return this.handleGetMobileDashboard(toolArgs as unknown as GetMobileDashboardInput);

          case 'list_permission_requests':
            return this.handleListPermissionRequests(toolArgs as unknown as ListPermissionRequestsInput);

          case 'resolve_permission_request':
            return this.handleResolvePermissionRequest(toolArgs as unknown as ResolvePermissionRequestInput);

          case 'diagnose_environment':
            return this.handleDiagnoseEnvironment();

          default:
            throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
        }
      } catch (error) {
        if (error instanceof McpError) {
          throw error;
        }
        throw new McpError(ErrorCode.InternalError, `Error executing ${name}: ${error}`);
      }
    });
  }

  private getToolArgs(args: Record<string, unknown> | undefined): Record<string, unknown> {
    return args || {};
  }

  /**
   * Handle submit_task tool
   */
  private handleSubmitTask(input: SubmitTaskInput) {
    const task = this.taskManager.submitTask(input);
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            taskId: task.id,
            status: task.status,
            createdAt: task.createdAt,
          }, null, 2),
        },
      ],
    };
  }

  /**
   * Handle get_task_status tool
   */
  private handleGetTaskStatus(input: GetTaskStatusInput) {
    const task = this.taskManager.getTaskStatus(input.taskId);
    if (!task) {
      throw new McpError(ErrorCode.InvalidParams, `Task not found: ${input.taskId}`);
    }
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(task, null, 2),
        },
      ],
    };
  }

  /**
   * Handle get_task_log tool
   */
  private handleGetTaskLog(input: GetTaskLogInput) {
    const logs = this.taskManager.getTaskLogs(input.taskId, input.maxChars);
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            taskId: input.taskId,
            logs,
          }, null, 2),
        },
      ],
    };
  }

  /**
   * Handle get_result_report tool
   */
  private handleGetResultReport(input: GetResultReportInput) {
    const report = this.taskManager.getResultReport(input.taskId);
    if (!report) {
      throw new McpError(ErrorCode.InvalidParams, `No report available for task: ${input.taskId}`);
    }
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(report, null, 2),
        },
      ],
    };
  }

  /**
   * Handle request_revision tool
   */
  private handleRequestRevision(input: RequestRevisionInput) {
    const newTask = this.taskManager.requestRevision(input);
    if (!newTask) {
      throw new McpError(ErrorCode.InvalidParams, `Parent task not found: ${input.taskId}`);
    }
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            newTaskId: newTask.id,
            parentTaskId: input.taskId,
            status: newTask.status,
          }, null, 2),
        },
      ],
    };
  }

  /**
   * Handle cancel_task tool
   */
  private handleCancelTask(input: CancelTaskInput) {
    const task = this.taskManager.cancelTask(input.taskId);
    if (!task) {
      throw new McpError(ErrorCode.InvalidParams, `Task not found or cannot be cancelled: ${input.taskId}`);
    }
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            taskId: task.id,
            status: 'cancelled',
            cancelledAt: task.completedAt,
          }, null, 2),
        },
      ],
    };
  }

  /**
   * Handle list_artifacts tool
   */
  private handleListArtifacts(input: ListArtifactsInput) {
    const artifacts = this.taskManager.listArtifacts(input.taskId);
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            taskId: input.taskId,
            artifacts,
          }, null, 2),
        },
      ],
    };
  }

  private handleListTasks(input: ListTasksInput) {
    const tasks = this.taskManager.listTasks(input);
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({ tasks }, null, 2),
        },
      ],
    };
  }

  private handleGetMobileDashboard(input: GetMobileDashboardInput) {
    const dashboard = this.taskManager.getMobileDashboard(input);
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(dashboard, null, 2),
        },
      ],
    };
  }

  private handleListPermissionRequests(input: ListPermissionRequestsInput) {
    const permissionRequests = this.taskManager.listPermissionRequests(input);
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({ permissionRequests }, null, 2),
        },
      ],
    };
  }

  private handleResolvePermissionRequest(input: ResolvePermissionRequestInput) {
    const permissionRequest = this.taskManager.resolvePermissionRequest(input);
    if (!permissionRequest) {
      throw new McpError(ErrorCode.InvalidParams, `Permission request not found or already resolved: ${input.requestId}`);
    }
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(permissionRequest, null, 2),
        },
      ],
    };
  }

  /**
   * Handle diagnose_environment tool
   */
  private handleDiagnoseEnvironment() {
    const diagnosis = this.taskManager.diagnoseEnvironment();
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(diagnosis, null, 2),
        },
      ],
    };
  }

  /**
   * Start the MCP server
   */
  async start(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('Agent Collaboration MCP Bridge Server started');
  }

  /**
   * Get the task manager (for testing)
   */
  getTaskManager(): TaskManager {
    return this.taskManager;
  }
}
