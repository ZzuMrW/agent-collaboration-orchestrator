#!/usr/bin/env node

import { McpBridgeServer } from './mcp-server';

/**
 * CLI entry point for the MCP Bridge Server
 */
async function main(): Promise<void> {
  const sandboxRoot = process.env.SANDBOX_ROOT || process.cwd();

  console.log(`Starting Agent Collaboration MCP Bridge Server...`);
  console.log(`Sandbox root: ${sandboxRoot}`);

  const server = new McpBridgeServer(sandboxRoot);

  try {
    await server.start();
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});