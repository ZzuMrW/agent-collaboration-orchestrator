#!/usr/bin/env node
// Run a task through the same stdio MCP tools used by Codex.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {Client} = require('@modelcontextprotocol/sdk/client/index.js');
const {StdioClientTransport} = require('@modelcontextprotocol/sdk/client/stdio.js');
async function main() {
  const [inputFile, outputFile] = process.argv.slice(2);
  if (!inputFile) throw Error('Usage: node scripts/run-task.cjs task.json [report.json]');
  const input = JSON.parse(fs.readFileSync(inputFile,'utf8'));
  const client = new Client({name:'bridge-local-verification',version:'1.0.0'});
  const transport = new StdioClientTransport({command:process.env.BRIDGE_LAUNCHER || path.join(os.homedir(),'.local/bin/trae-task-bridge'),stderr:'inherit'});
  const call = async (name,args={}) => {
    const result = await client.callTool({name,arguments:args});
    if(result.isError) throw Error(JSON.stringify(result));
    return JSON.parse(result.content.find(c => c.type === 'text').text);
  };
  let task;
  try {
    await client.connect(transport);
    const tools = await client.listTools();
    console.log('MCP tools:',tools.tools.length);
    console.log('Environment:',JSON.stringify(await call('diagnose_environment')));
    task = await call(input.revisionNotes ? 'request_revision' : 'submit_task',input);
    task.id = task.taskId;
    console.log('Task:',task.id);
    const deadline = Date.now() + 10*60*1000;
    let status;
    do {
      status = await call('get_task_status',{taskId:task.id});
      console.log('Status:',status.status);
      if(['completed','failed','cancelled'].includes(status.status)) break;
      await new Promise(resolve => setTimeout(resolve,5000));
    } while(Date.now()<deadline);
    if(!['completed','failed','cancelled'].includes(status.status)) {
      await call('cancel_task',{taskId:task.id});
      throw Error('Verification client timed out');
    }
    const result = {
      task:status,
      artifacts:await call('list_artifacts',{taskId:task.id}),
      logs:await call('get_task_log',{taskId:task.id,maxChars:12000}),
      report:status.status === 'completed' ? await call('get_result_report',{taskId:task.id}) : null,
    };
    if(outputFile) fs.writeFileSync(outputFile,JSON.stringify(result,null,2));
    console.log(JSON.stringify({taskId:status.id,status:status.status,artifacts:result.artifacts,report:result.report},null,2));
    if(status.status !== 'completed') process.exitCode=1;
  } finally { await client.close(); }
}
main().catch(error => {console.error(error);process.exitCode=1;});
