'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawn, spawnSync} = require('node:child_process');
const {once} = require('node:events');
const {parseArgs, TaskStore, LogCursor, clean} =
  require('../skills/codex-trae-workspace/scripts/watch-task.cjs');
const entry = path.resolve(__dirname, '../scripts/watch-task.cjs');
const bundled = path.resolve(__dirname, '../skills/codex-trae-workspace/scripts/watch-task.cjs');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trae watch test '));
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  return dir;
}
function state(id, projectRoot = '/project/a', createdAt = '2026-10-22T01:00:00Z') {
  return {ownerPid: 2147483647, task: {id, title: `Task ${id}`, status: 'running',
    projectRoot, createdAt, updatedAt: createdAt, prompt: 'PROMPT_MUST_NOT_BE_PRINTED'},
  logs: [{timestamp: createdAt, level: 'info', message: `output-${id}`}],
  permissions: [{secret: 'PERMISSIONS_MUST_NOT_BE_PRINTED'}]};
}
function save(dir, data) {
  const file = path.join(dir, `${data.task.id}.json`);
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(data));
  fs.renameSync(`${file}.tmp`, file);
  return file;
}
function view(dir, args = [], target = entry) {
  return spawnSync(process.execPath, [target, '--state-dir', dir, ...args], {encoding: 'utf8'});
}
async function until(predicate, description) {
  const end = Date.now() + 7000;
  while (!predicate()) {
    if (Date.now() > end) throw new Error(`Timed out: ${description}`);
    await sleep(30);
  }
}
function follow(t, dir, args) {
  const child = spawn(process.execPath, [entry, '--state-dir', dir, '--poll-ms', '100', '--follow', ...args]);
  const captured = {out: '', err: ''};
  child.stdout.on('data', data => { captured.out += data; });
  child.stderr.on('data', data => { captured.err += data; });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit'); child.kill('SIGTERM'); await exited;
    }
  });
  return {child, captured};
}

test('argument defaults and overrides do not depend on a project-specific resume file', () => {
  assert.equal(parseArgs([], {}, '/home/example').stateDir,
    path.resolve('/home/example/.local/state/agent-collaboration-orchestrator/tasks'));
  assert.equal(parseArgs([], {BRIDGE_STATE_DIR: '/custom'}, '/unused').stateDir, path.resolve('/custom'));
  const options = parseArgs(['--state-dir', '/explicit', '--task', 'task-1', '-f', '--tail', '0']);
  assert.equal(options.stateDir, path.resolve('/explicit'));
  assert.equal(options.taskId, 'task-1'); assert.equal(options.follow, true); assert.equal(options.tail, 0);
  for (const args of [['--task', '../private'], ['--task', '/private'], ['--task'], ['--unknown'],
    ['--tail', '-1'], ['--tail', 'NaN'], ['--poll-ms', '0'], ['--list', '-f'], ['--task', 'one', '--latest']]) {
    assert.throws(() => parseArgs(args));
  }
});

test('snapshots are read without changing bytes, metadata, recorded status or creating files', t => {
  const dir = fixture(t), file = save(dir, state('one'));
  const before = fs.statSync(file, {bigint: true}); const contents = fs.readFileSync(file);
  const result = view(dir, ['--task', 'one']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /output-one/); assert.match(result.stdout, /\[running\]/);
  assert.doesNotMatch(result.stdout, /PROMPT_MUST_NOT|PERMISSIONS_MUST_NOT/);
  assert.deepEqual(fs.readFileSync(file), contents);
  const after = fs.statSync(file, {bigint: true});
  assert.equal(after.mtimeNs, before.mtimeNs); assert.equal(after.mode, before.mode);
  assert.deepEqual(fs.readdirSync(dir), ['one.json']);
  assert.equal(JSON.parse(fs.readFileSync(file)).task.status, 'running');
});

test('list and latest use creation order and actual projectRoot', t => {
  const dir = fixture(t);
  save(dir, state('a', '/project/a', '2026-10-22T01:00:00Z'));
  save(dir, state('b', '/project/b', '2026-10-22T03:00:00Z'));
  save(dir, state('c', '/project/a', '2026-10-22T02:00:00Z'));
  let result = view(dir, ['--list', '--project-root', '/project/a']);
  assert.equal(result.status, 0); assert.ok(result.stdout.indexOf('Task c') < result.stdout.indexOf('Task a'));
  assert.doesNotMatch(result.stdout, /Task b/);
  result = view(dir, ['--latest', '--project-root', '/project/a']);
  assert.match(result.stdout, /output-c/); assert.doesNotMatch(result.stdout, /output-[ab]/);
  assert.equal(view(dir, ['--task', 'b', '--project-root', '/project/a']).status, 2);
});

test('malformed snapshots are reported; valid tasks remain viewable and symlinks are not read', t => {
  const dir = fixture(t); save(dir, state('valid'));
  fs.writeFileSync(path.join(dir, 'broken.json'), '{');
  const result = view(dir, ['--list']);
  assert.equal(result.status, 0); assert.match(result.stdout, /Task valid/); assert.match(result.stderr, /broken.json/);
  assert.equal(view(dir, ['--task', 'broken']).status, 2);
  const foreign = path.join(fixture(t), 'private.json'); fs.writeFileSync(foreign, JSON.stringify(state('link')));
  try { fs.symlinkSync(foreign, path.join(dir, 'link.json')); }
  catch (error) { if (error.code === 'EPERM') return; throw error; }
  assert.equal(view(dir, ['--task', 'link']).status, 2);
  assert.doesNotMatch(view(dir, ['--list']).stdout, /Task link/);
});

test('metadata cache notices atomic replacement and records no prompts or reports', t => {
  const dir = fixture(t), store = new TaskStore(dir); const data = state('one'); save(dir, data);
  assert.equal(store.scan().tasks[0].status, 'running');
  data.task.status = 'completed'; save(dir, data);
  assert.equal(store.scan().tasks[0].status, 'completed');
  assert.equal(store.scan().tasks[0].prompt, undefined);
});

test('cursor tails, follows append without duplication and handles log reset or truncation', () => {
  const logs = ['a', 'b', 'c'].map(message => ({timestamp: message, level: 'info', message}));
  const cursor = new LogCursor(2);
  assert.deepEqual(cursor.take('one', logs).logs, logs.slice(1));
  assert.deepEqual(cursor.take('one', logs).logs, []);
  const next = {timestamp: 'd', level: 'warn', message: 'd'};
  assert.deepEqual(cursor.take('one', [...logs, next]).logs, [next]);
  assert.equal(cursor.take('one', [{message: 'reset'}]).reset, true);
  assert.deepEqual(cursor.take('two', logs).logs, logs.slice(1));
  const zero = new LogCursor(0); assert.deepEqual(zero.take('one', logs).logs, []);
  assert.deepEqual(zero.take('one', [...logs, next]).logs, [next]);
});

test('viewer sanitizes terminal controls while preserving multiline output', () => {
  assert.equal(clean('\x1b[31mred\x1b[0m\r\nnext\x00'), 'red\nnext');
  assert.equal(clean('\x1b]52;c;clipboard\x07safe'), 'safe');
});

test('follow retries an incomplete snapshot; Ctrl+C stops only the viewer', async t => {
  const dir = fixture(t), data = state('one'); const file = save(dir, data);
  const witness = spawn(process.execPath, ['-e', 'setInterval(()=>{}, 1000)'], {stdio: 'ignore'});
  t.after(() => witness.kill('SIGTERM'));
  const {child, captured} = follow(t, dir, ['--task', 'one']);
  await until(() => captured.out.includes('output-one'), 'initial output');
  fs.writeFileSync(file, '{');
  await until(() => captured.err.includes('Cannot read'), 'transient read error');
  data.logs.push({timestamp: '2026-10-22T02:00:00Z', level: 'info', message: 'after-replacement'});
  save(dir, data);
  await until(() => captured.out.includes('after-replacement'), 'new output after recovery');
  await sleep(220);
  assert.equal(captured.out.split('after-replacement').length - 1, 1);
  assert.equal(captured.out.split('output-one').length - 1, 1);
  const contents = fs.readFileSync(file); const exit = once(child, 'exit'); child.kill('SIGINT');
  const [code, signal] = await exit;
  assert.equal(code, 0); assert.equal(signal, null); assert.equal(witness.exitCode, null);
  assert.deepEqual(fs.readFileSync(file), contents);
});

test('latest follow waits for tasks, switches only within selected project and does not stop at terminal status', async t => {
  const dir = fixture(t), root = '/project/a';
  const {child, captured} = follow(t, dir, ['--latest', '--project-root', root]);
  await until(() => captured.out.includes('Waiting'), 'empty store');
  const first = state('first', root); save(dir, first);
  await until(() => captured.out.includes('output-first'), 'first task');
  first.task.status = 'completed'; save(dir, first);
  await until(() => captured.out.includes('[completed]'), 'completed status');
  assert.equal(child.exitCode, null);
  save(dir, state('foreign', '/other', '2026-10-22T04:00:00Z'));
  save(dir, state('second', root, '2026-10-22T03:00:00Z'));
  await until(() => captured.out.includes('output-second'), 'new matching task');
  assert.doesNotMatch(captured.out, /output-foreign/);
});

test('bundled skill viewer works without the repository or MCP dependencies', t => {
  const dir = fixture(t); save(dir, state('portable'));
  const standalone = path.join(fixture(t), 'watch-task.cjs'); fs.copyFileSync(bundled, standalone);
  const result = view(dir, ['--task', 'portable'], standalone);
  assert.equal(result.status, 0, result.stderr); assert.match(result.stdout, /output-portable/);
});

function installationFixture(t) {
  const dir = fixture(t), repo = path.join(dir, 'repo'), home = path.join(dir, 'home');
  const skill = path.join(repo, 'skills/codex-trae-workspace');
  fs.mkdirSync(path.join(repo, 'scripts'), {recursive: true});
  fs.mkdirSync(path.join(repo, 'dist'), {recursive: true});
  fs.mkdirSync(path.join(skill, 'scripts'), {recursive: true});
  fs.copyFileSync(path.resolve(__dirname, '../scripts/install-local.cjs'), path.join(repo, 'scripts/install-local.cjs'));
  fs.copyFileSync(path.resolve(__dirname, '../skills/codex-trae-workspace/SKILL.md'), path.join(skill, 'SKILL.md'));
  fs.copyFileSync(bundled, path.join(skill, 'scripts/watch-task.cjs'));
  // The installer only checks existence. No bridge, executor or MCP process is launched.
  fs.writeFileSync(path.join(repo, 'dist/cli.js'), '// inert install fixture\n');
  fs.mkdirSync(home, {recursive: true});
  return {dir, repo, home, skill};
}
function install(f, targets) {
  return spawnSync(process.execPath, [path.join(f.repo, 'scripts/install-local.cjs'), ...targets], {
    encoding: 'utf8', env: {...process.env, HOME: f.home, USERPROFILE: f.home,
      CODEX_HOME: path.join(f.home, '.codex'), TRAE_EXECUTOR_COMMAND: process.execPath, SANDBOX_ROOT: f.repo},
  });
}

test('installer bundles a standalone viewer and command using only an isolated fake home', t => {
  if (process.platform === 'win32') return t.skip('Linux/WSL installer');
  const f = installationFixture(t), codex = path.join(f.home, '.codex');
  const result = install(f, [codex]);
  assert.equal(result.status, 0, result.stderr);
  const installed = path.join(codex, 'skills/codex-trae-workspace/scripts/watch-task.cjs');
  assert.deepEqual(fs.readFileSync(installed), fs.readFileSync(bundled));
  const command = path.join(f.home, '.local/bin/trae-task-watch');
  assert.ok(fs.statSync(command).mode & 0o100);
  const output = spawnSync(command, ['--state-dir', path.join(f.dir, 'empty-state'), '--list'], {encoding: 'utf8'});
  assert.equal(output.status, 0, output.stderr); assert.match(output.stdout, /No recorded tasks/);
});

test('installer refuses a conflicting viewer before changing any target or launcher', t => {
  if (process.platform === 'win32') return t.skip('Linux/WSL installer');
  const f = installationFixture(t), first = path.join(f.dir, 'first'), second = path.join(f.dir, 'second');
  const target = path.join(second, 'skills/codex-trae-workspace');
  fs.mkdirSync(path.join(target, 'scripts'), {recursive: true});
  fs.copyFileSync(path.join(f.skill, 'SKILL.md'), path.join(target, 'SKILL.md'));
  const script = path.join(target, 'scripts/watch-task.cjs');
  fs.writeFileSync(script, 'user-custom-viewer\n');
  const result = install(f, [first, second]);
  assert.notEqual(result.status, 0); assert.match(result.stderr, /Existing viewer differs/);
  assert.equal(fs.readFileSync(script, 'utf8'), 'user-custom-viewer\n');
  assert.equal(fs.existsSync(first), false);
  assert.equal(fs.existsSync(path.join(f.home, '.local/bin')), false);
});
