# Agent Collaboration Orchestrator

一个通用的多Agent协作编排框架，包含MCP桥接服务实现，支持编排层Agent与执行层Agent的分工协作。

## 概述

本框架实现了一个双层级Agent协作模式：
- **编排层Agent（Orchestrator）**：负责项目整体规划、架构设计、任务分解和质量把控
- **执行层Agent（Executor）**：负责具体代码实现、测试编写和文档生成

## 核心特性

- **智能任务分配**：自动评估任务复杂度，决定由哪层Agent处理
- **清晰的责任边界**：编排层专注设计，执行层专注实现
- **完整的审查流程**：支持多轮迭代和持续审查
- **灵活的沙箱模式**：支持只读、工作区写入、完全访问三种模式
- **内置MCP服务**：提供完整的Model Context Protocol实现

## 安装

### NPM安装

```bash
npm install agent-collaboration-orchestrator
```

### 手动安装

```bash
git clone https://github.com/your-username/agent-collaboration-orchestrator.git
cd agent-collaboration-orchestrator
npm install
npm run build
```

## 项目结构

```
agent-collaboration-orchestrator/
├── src/
│   ├── index.ts          # 主入口
│   ├── cli.ts            # CLI启动器
│   ├── mcp-server.ts     # MCP服务实现
│   ├── task-manager.ts   # 任务管理器
│   └── types.ts          # 类型定义
├── dist/                 # 编译输出
├── SKILL.md              # 技能定义文件
├── package.json
├── tsconfig.json
└── README.md
```

## MCP桥接服务

### 启动服务

```bash
# 设置环境变量
export SANDBOX_ROOT=/path/to/workspace

# 启动服务
npm start
# 或
node dist/cli.js
```

### MCP配置示例

在您的MCP客户端配置中添加：

```json
{
  "mcpServers": {
    "agent-bridge": {
      "command": "node",
      "args": ["path/to/agent-collaboration-orchestrator/dist/cli.js"],
      "env": {
        "SANDBOX_ROOT": "/path/to/workspace"
      }
    }
  }
}
```

### 可用工具

| 工具名称 | 功能描述 | 必需参数 |
|----------|----------|----------|
| `submit_task` | 提交任务给执行层Agent | prompt |
| `get_task_status` | 查询任务执行状态 | taskId |
| `get_task_log` | 获取任务执行日志 | taskId |
| `get_result_report` | 获取任务完成报告 | taskId |
| `request_revision` | 请求任务修订 | taskId, revisionNotes |
| `cancel_task` | 取消正在执行的任务 | taskId |
| `list_artifacts` | 列出任务产生的文件 | taskId |
| `diagnose_environment` | 诊断环境配置 | 无 |

### 沙箱模式

| 模式 | 说明 |
|------|------|
| `read-only` | 只读模式，仅允许读取文件 |
| `workspace-write` | 工作区写入模式（默认） |
| `danger-full-access` | 完全访问模式（谨慎使用） |

## 使用方法

### 作为NPM模块使用

```typescript
import { McpBridgeServer, TaskManager } from 'agent-collaboration-orchestrator';

// 创建任务管理器
const taskManager = new TaskManager('/path/to/workspace');

// 提交任务
const task = taskManager.submitTask({
  prompt: '实现用户认证模块',
  title: '认证模块开发',
  sandbox: 'workspace-write',
});

// 查询状态
const status = taskManager.getTaskStatus(task.id);
```

### 作为MCP服务使用

通过MCP客户端调用工具：

```json
// 提交任务
{
  "tool": "submit_task",
  "arguments": {
    "prompt": "实现用户认证模块",
    "title": "认证模块开发",
    "sandbox": "workspace-write"
  }
}

// 查询状态
{
  "tool": "get_task_status",
  "arguments": {
    "taskId": "task-uuid"
  }
}
```

## 任务复杂度评估标准

| 复杂度 | 文件数 | 代码行数 | 特征 |
|--------|--------|----------|------|
| 简单 | 1 | < 50 | 单一功能、无依赖 |
| 中等 | 2-5 | 100-500 | 模块级功能、有依赖 |
| 复杂 | > 5 | > 500 | 系统级功能、多模块 |

## 任务提交格式

```markdown
## 项目背景
[编排层设计的整体架构概述]

## 任务目标
[具体要实现的功能]

## 设计规范
- 文件结构：[列出需要创建/修改的文件]
- 接口定义：[API/函数签名]
- 数据结构：[关键数据模型]
- 约束条件：[技术限制、性能要求]

## 验收标准
- 功能完整性：[必须实现的功能]
- 代码质量：[测试覆盖率、代码规范]
- 文档要求：[需要生成的文档]
```

## 审查检查清单

编排层审查执行层输出时应检查：

- [ ] 架构一致性：是否符合设计架构
- [ ] 接口规范：是否遵循定义的接口
- [ ] 代码质量：是否通过测试、符合规范
- [ ] 文档完整：是否包含必要文档
- [ ] 风险识别：是否有潜在问题

## 示例场景

### 创建Web API项目

**编排层工作：**
1. 设计项目结构（controllers, services, models）
2. 定义API路由和接口规范
3. 制定数据模型和验证规则
4. 分解为子任务

**执行层工作：**
1. 实现路由配置
2. 编写控制器逻辑
3. 实现服务层
4. 编写单元测试

### 代码重构

**编排层工作：**
1. 分析现有代码结构
2. 设计重构目标架构
3. 制定重构步骤
4. 定义约束条件

**执行层工作：**
1. 执行重构
2. 更新测试
3. 生成报告

## 开发

```bash
# 安装依赖
npm install

# 构建
npm run build

# 开发模式
npm run dev

# 测试
npm test

# 代码检查
npm run lint
```

## 许可证

MIT License

## 贡献

欢迎提交Issue和Pull Request。