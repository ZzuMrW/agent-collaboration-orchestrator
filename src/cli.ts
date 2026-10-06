#!/usr/bin/env node

import { McpBridgeServer } from './mcp-server';

/**
 * CLI entry point for the MCP Bridge Server
 */
async function main(): Promise<void> {
  const sandboxRoot = process.env.SANDBOX_ROOT || process.cwd();

  console.error('Starting Agent Collaboration MCP Bridge Server...');
  console.error(`Sandbox root: ${sandboxRoot}`);

  const server = new McpBridgeServer(sandboxRoot);
  let stopping = false;
  const stop = (): void => {
    if (stopping) return;
    stopping = true;
    void server.stop().catch(error => console.error('Failed to stop bridge:', error));
  };
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
  process.stdin.once('end', stop);

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
