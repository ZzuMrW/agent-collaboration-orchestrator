const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {AgentExecutor, CodexExecutor, TaskManager} = require('../dist');
const fixture = path.resolve(__dirname, 'fixtures/executor.cjs');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function terminal(manager, id) {
  for (let i = 0; i < 200; i++) {
    const task = manager.getTaskStatus(id);
    if (['completed','failed','cancelled'].includes(task.status)) return task;
    await delay(25);
  }
  throw Error('Task did not finish');
}
function setup(t, mode = 'ok', timeoutMs = 3000) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge test '));
  t.after(() => fs.rmSync(root, {recursive:true, force:true}));
  const executor = new AgentExecutor({command:process.execPath, argsTemplate:`"${fixture}" ${mode} {resultFile}`, agent:'TRAE', orchestrator:'Codex', enabled:true, timeoutMs});
  return {root, executor, manager:new TaskManager(root, executor)};
}
test('generic env settings take precedence; old executor export is compatible', () => {
  assert.equal(CodexExecutor, AgentExecutor);
  const config = AgentExecutor.fromEnv({EXECUTOR_COMMAND:'traex', CODEX_EXECUTOR_COMMAND:'codex', EXECUTOR_ARGS:'exec -', EXECUTOR_AGENT:'TRAE', ORCHESTRATOR_AGENT:'Codex'}).getConfig();
  assert.equal(config.command, 'traex'); assert.equal(config.agent, 'TRAE');
});
test('executes delegated task, preserves roles, captures final report and artifacts', async t => {
  const {root, manager} = setup(t);
  const task = manager.submitTask({prompt:'test task', constraints:{doNotChange:['package.json']}});
  assert.equal((await terminal(manager,task.id)).status,'completed');
  const output = JSON.parse(fs.readFileSync(path.join(root,'executed.json')));
  assert.match(output.prompt, /Codex is the primary operator/);
  assert.match(output.prompt, /TRAE is being invoked as the delegated executor/);
  assert.match(output.prompt, /package.json/);
  assert.match(manager.getResultReport(task.id).finalResponse, /TRAE final report/);
  assert.ok(manager.listArtifacts(task.id).some(a => a.path.endsWith('executed.json')));
  assert.ok(manager.listArtifacts(task.id).some(a => a.path.endsWith('result.md')));
  const revision = manager.requestRevision({taskId:task.id, revisionNotes:'correct this'});
  assert.equal((await terminal(manager,revision.id)).status,'completed');
  assert.equal(revision.parentTaskId,task.id);
});
test('denies projects outside the configured workspace', t => {
  const {manager} = setup(t);
  assert.throws(() => manager.submitTask({prompt:'test', projectRoot:os.tmpdir()}), /inside SANDBOX_ROOT/);
});
test('failure creates a permission request, rejected request does not retry', async t => {
  const {manager} = setup(t,'fail');
  const task = manager.submitTask({prompt:'test'});
  assert.equal((await terminal(manager,task.id)).status,'failed');
  const [request] = manager.listPermissionRequests({taskId:task.id});
  assert.ok(request);
  assert.equal(manager.resolvePermissionRequest({requestId:request.id, decision:'reject'}).status,'rejected');
});
test('timeout is recorded as failure', async t => {
  const {manager} = setup(t,'hang',100);
  const task = manager.submitTask({prompt:'test'});
  assert.match((await terminal(manager,task.id)).error,/timed out/);
});
test('cancellation remains cancelled after executor close', async t => {
  const {manager} = setup(t,'hang');
  const task = manager.submitTask({prompt:'test'});
  while (!task.executor) await delay(10);
  manager.cancelTask(task.id);
  await delay(150);
  assert.equal(task.status,'cancelled');
  assert.equal(manager.getResultReport(task.id),null);
});
test('manual execution generates prompt and stays pending', async t => {
  const {root} = setup(t);
  const manager = new TaskManager(root,new AgentExecutor({enabled:false,timeoutMs:1000}));
  const task = manager.submitTask({prompt:'manual'});
  while (!task.executor) await delay(10);
  assert.equal(task.status,'pending');
  assert.ok(fs.existsSync(task.executor.promptFile));
});
test('persistent state restores completed reports and marks interrupted runs failed', async t => {
  const {root, executor} = setup(t);
  const previous = process.env.BRIDGE_STATE_DIR;
  process.env.BRIDGE_STATE_DIR = path.join(root,'state');
  t.after(() => { if(previous === undefined) delete process.env.BRIDGE_STATE_DIR; else process.env.BRIDGE_STATE_DIR = previous; });
  const manager = new TaskManager(root,executor);
  const task = manager.submitTask({prompt:'persistent'});
  await terminal(manager,task.id);
  const restored = new TaskManager(root,executor);
  assert.equal(restored.getTaskStatus(task.id).status,'completed');
  assert.match(restored.getResultReport(task.id).finalResponse,/TRAE final report/);
  const file = path.join(process.env.BRIDGE_STATE_DIR,`${task.id}.json`);
  const state = JSON.parse(fs.readFileSync(file));
  state.task.status = 'running';
  state.ownerPid = 2147483647;
  fs.writeFileSync(file,JSON.stringify(state));
  assert.match(new TaskManager(root,executor).getTaskStatus(task.id).error,/Bridge restarted/);
});
test('separate managers keep task records and do not fail another live run', async t => {
  const {root, executor} = setup(t);
  const previous = process.env.BRIDGE_STATE_DIR;
  process.env.BRIDGE_STATE_DIR = path.join(root,'records');
  t.after(() => { if(previous === undefined) delete process.env.BRIDGE_STATE_DIR; else process.env.BRIDGE_STATE_DIR = previous; });
  const first = new TaskManager(root,executor);
  const task = first.submitTask({prompt:'first',autoStart:false});
  const second = new TaskManager(root,executor);
  const other = second.submitTask({prompt:'second',autoStart:false});
  assert.ok(first.getTaskStatus(other.id));
  assert.ok(second.getTaskStatus(task.id));
  // Simulate a live task record owned by another still-running server process.
  const file = path.join(process.env.BRIDGE_STATE_DIR,`${task.id}.json`);
  const state = JSON.parse(fs.readFileSync(file));
  state.task.status = 'running';
  fs.writeFileSync(file,JSON.stringify(state));
  assert.equal(second.getTaskStatus(task.id).status,'running');
  assert.throws(() => second.cancelTask(task.id),/originating chat/);
  assert.equal(fs.readdirSync(process.env.BRIDGE_STATE_DIR).filter(f=>f.endsWith('.json')).length,2);
});
test('shutdown cancels tasks and logs expose recent entries', async t => {
  const {manager} = setup(t,'hang');
  const task = manager.submitTask({prompt:'stop'});
  while(!task.executor) await delay(10);
  manager.shutdown();
  await delay(150);
  assert.equal(task.status,'cancelled');
  const logs = manager.getTaskLogs(task.id,300);
  assert.match(logs.at(-1).message,/cancelled/);
});
test('rejects a symlink that escapes the configured project root', t => {
  const {root,manager} = setup(t);
  const outside = fs.mkdtempSync(path.join(os.tmpdir(),'bridge-outside-'));
  t.after(()=>fs.rmSync(outside,{recursive:true,force:true}));
  fs.symlinkSync(outside,path.join(root,'linked'),'dir');
  assert.throws(()=>manager.submitTask({prompt:'test',projectRoot:path.join(root,'linked')}),/inside SANDBOX_ROOT/);
});
test('missing executor produces a failed task instead of crashing the bridge', async t => {
  const {root} = setup(t);
  const manager = new TaskManager(root,new AgentExecutor({command:path.join(root,'missing-cli'),argsTemplate:'exec -',enabled:true,timeoutMs:1000}));
  const task = manager.submitTask({prompt:'test'});
  assert.equal((await terminal(manager,task.id)).status,'failed');
});
test('legacy CODEX_EXECUTOR settings execute with TRAE leading Codex', async t => {
  const {root} = setup(t);
  const executor = CodexExecutor.fromEnv({
    CODEX_EXECUTOR_COMMAND:process.execPath,
    CODEX_EXECUTOR_ARGS:`"${fixture}" ok {resultFile}`,
  });
  const manager = new TaskManager(root,executor);
  const task = manager.submitTask({prompt:'legacy direction'});
  assert.equal((await terminal(manager,task.id)).status,'completed');
  const output = JSON.parse(fs.readFileSync(path.join(root,'executed.json')));
  assert.match(output.prompt,/TRAE Work is the primary operator/);
  assert.match(output.prompt,/Codex is being invoked as the delegated executor/);
  assert.equal(manager.getResultReport(task.id).executorAgent,'Codex');
});
