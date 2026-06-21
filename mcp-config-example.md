# MCP桥接服务配置示例

本文件展示如何配置MCP桥接服务以支持Agent协作编排器。

## 配置文件示例

```json
{
  "mcpServers": {
    "agent-bridge": {
      "command": "node",
      "args": ["path/to/bridge-server/dist/index.js"],
      "env": {
        "EXECUTOR_MODEL": "your-model-name",
        "SANDBOX_ROOT": "/path/to/workspace"
      }
    }
  }
}
```

## 环境变量说明

| 变量名 | 说明 | 是否必需 |
|--------|------|----------|
| `EXECUTOR_MODEL` | 执行层Agent使用的模型名称 | 是 |
| `SANDBOX_ROOT` | 沙箱工作目录根路径 | 是 |
| `LOG_LEVEL` | 日志级别（debug/info/warn/error） | 否，默认info |

## 接口实现规范

### submit_task

提交任务给执行层Agent。

**输入参数：**
```typescript
interface SubmitTaskInput {
  prompt: string;           // 任务描述（必需）
  title?: string;          // 任务标题
  model?: string;          // 指定模型
  sandbox?: 'read-only' | 'workspace-write' | 'danger-full-access';
  autoStart?: boolean;     // 是否自动启动
  constraints?: object;    // 约束条件
  acceptanceCriteria?: object; // 验收标准
  projectRoot?: string;    // 项目根目录
}
```

**返回值：**
```typescript
interface SubmitTaskOutput {
  taskId: string;  // 任务唯一标识
  status: 'pending' | 'running' | 'completed' | 'failed';
}
```

### get_task_status

查询任务执行状态。

**输入参数：**
```typescript
interface GetTaskStatusInput {
  taskId: string;  // 任务ID（必需）
}
```

**返回值：**
```typescript
interface TaskStatus {
  taskId: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  createdAt: string;
  updatedAt: string;
  progress?: number;  // 0-100
  error?: string;     // 错误信息（如果失败）
}
```

### get_task_log

获取任务执行日志。

**输入参数：**
```typescript
interface GetTaskLogInput {
  taskId: string;     // 任务ID（必需）
  maxChars?: number;  // 最大字符数
}
```

**返回值：**
```typescript
interface TaskLog {
  taskId: string;
  logs: Array<{
    timestamp: string;
    level: 'debug' | 'info' | 'warn' | 'error';
    message: string;
  }>;
}
```

### get_result_report

获取任务完成报告。

**输入参数：**
```typescript
interface GetResultReportInput {
  taskId: string;  // 任务ID（必需）
}
```

**返回值：**
```typescript
interface ResultReport {
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
```

### request_revision

请求任务修订。

**输入参数：**
```typescript
interface RequestRevisionInput {
  taskId: string;        // 任务ID（必需）
  revisionNotes: string; // 修订说明（必需）
  model?: string;
  sandbox?: 'read-only' | 'workspace-write' | 'danger-full-access';
  autoStart?: boolean;
}
```

**返回值：**
```typescript
interface RevisionOutput {
  newTaskId: string;
  parentTaskId: string;
  status: 'pending' | 'running';
}
```

### cancel_task

取消正在执行的任务。

**输入参数：**
```typescript
interface CancelTaskInput {
  taskId: string;  // 任务ID（必需）
}
```

**返回值：**
```typescript
interface CancelTaskOutput {
  taskId: string;
  status: 'cancelled';
  cancelledAt: string;
}
```

### list_artifacts

列出任务产生的文件。

**输入参数：**
```typescript
interface ListArtifactsInput {
  taskId: string;  // 任务ID（必需）
}
```

**返回值：**
```typescript
interface ArtifactsList {
  taskId: string;
  artifacts: Array<{
    path: string;
    type: 'file' | 'directory';
    size?: number;
    createdAt: string;
  }>;
}
```

### diagnose_environment

诊断环境配置。

**输入参数：** 无

**返回值：**
```typescript
interface EnvironmentDiagnosis {
  status: 'healthy' | 'degraded' | 'error';
  checks: Array<{
    name: string;
    status: 'pass' | 'fail' | 'warn';
    message?: string;
  }>;
  environment: {
    nodeVersion?: string;
    platform: string;
    sandboxRoot: string;
  };
}
```

## 安全建议

1. **不要在代码中硬编码敏感信息**（如API密钥）
2. 使用环境变量存储配置
3. 限制沙箱访问权限
4. 启用日志审计
5. 定期检查和轮换凭证