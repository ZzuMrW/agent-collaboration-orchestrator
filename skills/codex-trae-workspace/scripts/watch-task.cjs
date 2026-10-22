#!/usr/bin/env node
'use strict';

// Passive viewer: read persisted snapshots, never instantiate the bridge or executor.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {stripVTControlCharacters} = require('node:util');

const HELP = `TRAE task output viewer (read-only, Node.js >= 18)

Usage:
  trae-task-watch --list [--project-root PATH]
  trae-task-watch --task ID --follow
  trae-task-watch --latest --project-root PATH --follow

Options:
  --list                List recorded tasks, newest first
  --task ID             Pin one task ID
  --latest              Select newest task (default); follow switches to newer tasks
  --project-root PATH   Filter by the task's actual projectRoot
  --follow, -f          Show new output until Ctrl+C, including after task completion
  --tail N              Initial number of log records, 0 means new output only (default 20)
  --poll-ms N           Read interval in milliseconds, 100..60000 (default 1000)
  --state-dir PATH      Override BRIDGE_STATE_DIR or ~/.local/state/agent-collaboration-orchestrator/tasks
  --help, -h            Show help

The viewer does not start an MCP server, submit tasks, modify state or signal TRAE.
Ctrl+C stops only this viewer. Log timestamps retain the bridge's ISO/UTC format.
`;

function clean(value) {
  return stripVTControlCharacters(String(value ?? ''))
    .replace(/\r\n?/g, '\n').replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '');
}

function validId(id) {
  return typeof id === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(id);
}

function parseArgs(args, env = process.env, home = os.homedir()) {
  const options = {
    mode: 'latest', taskId: null, projectRoot: null, follow: false, tail: 20,
    pollMs: 1000, stateDir: path.resolve(env.BRIDGE_STATE_DIR ||
      path.join(home, '.local/state/agent-collaboration-orchestrator/tasks')),
  };
  let selection = null;
  const select = mode => {
    if (selection) throw new Error('--list, --task and --latest are mutually exclusive');
    options.mode = selection = mode;
  };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const value = () => {
      const next = args[++i];
      if (!next || next.startsWith('--')) throw new Error(`Missing value for ${arg}`);
      return next;
    };
    if (arg === '--help' || arg === '-h') return {help: true};
    if (arg === '--list') select('list');
    else if (arg === '--latest') select('latest');
    else if (arg === '--task') { select('task'); options.taskId = value(); }
    else if (arg === '--project-root') options.projectRoot = path.resolve(value());
    else if (arg === '--state-dir') options.stateDir = path.resolve(value());
    else if (arg === '--follow' || arg === '-f') options.follow = true;
    else if (arg === '--tail' || arg === '--poll-ms') {
      const raw = value();
      if (!/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw))) {
        throw new Error(`${arg} must be an integer`);
      }
      if (arg === '--tail') options.tail = Number(raw);
      else options.pollMs = Number(raw);
    } else throw new Error(`Unknown option: ${arg}`);
  }
  if (options.taskId && !validId(options.taskId)) throw new Error('Invalid task ID');
  if (options.pollMs < 100 || options.pollMs > 60000) throw new Error('--poll-ms must be 100..60000');
  if (options.mode === 'list' && options.follow) throw new Error('--list cannot be combined with --follow');
  return options;
}

function signature(stat) { return `${stat.ino}:${stat.mtimeMs}:${stat.ctimeMs}:${stat.size}`; }

function readState(file, id) {
  const state = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!state.task || state.task.id !== id || !Array.isArray(state.logs ?? [])) {
    throw new Error('Invalid task snapshot or mismatched task ID');
  }
  const source = state.task;
  // Do not retain prompts, reports, permissions or artifacts in the metadata cache.
  const task = Object.fromEntries(['id', 'title', 'status', 'projectRoot', 'createdAt', 'updatedAt']
    .map(key => [key, source[key]]));
  return {task, logs: state.logs || []};
}

class TaskStore {
  constructor(directory) { this.directory = directory; this.cache = new Map(); this.active = null; }

  scan() {
    let files;
    try { files = fs.readdirSync(this.directory); }
    catch (error) {
      if (error.code === 'ENOENT') return {tasks: [], warnings: []};
      throw error;
    }
    const tasks = [], warnings = [], present = new Set();
    for (const name of files) {
      if (!name.endsWith('.json')) continue;
      const id = name.slice(0, -5);
      if (!validId(id)) continue;
      present.add(id);
      const file = path.join(this.directory, name);
      try {
        const stat = fs.lstatSync(file);
        if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Task snapshot is not a regular file');
        const key = signature(stat);
        let cached = this.cache.get(id);
        if (!cached || cached.signature !== key) {
          const state = readState(file, id);
          cached = {signature: key, task: state.task, lastLogAt: state.logs.at(-1)?.timestamp || ''};
          this.cache.set(id, cached);
          if (this.active?.task.id === id) this.active = {...state, signature: key};
        }
        tasks.push({...cached.task, lastLogAt: cached.lastLogAt});
      } catch (error) {
        warnings.push(`${name}: ${error.message}`);
        this.cache.delete(id);
      }
    }
    for (const id of this.cache.keys()) if (!present.has(id)) this.cache.delete(id);
    tasks.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')) ||
      String(b.id).localeCompare(String(a.id)));
    return {tasks, warnings};
  }

  read(id) {
    if (!validId(id)) throw new Error('Invalid task ID');
    const file = path.join(this.directory, `${id}.json`);
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Task snapshot is not a regular file');
    const key = signature(stat);
    if (this.active?.task.id === id && this.active.signature === key) return this.active;
    this.active = {...readState(file, id), signature: key};
    return this.active;
  }
}

function logKey(log) { return JSON.stringify([log?.timestamp, log?.level, log?.message]); }

class LogCursor {
  constructor(tail) { this.tail = tail; this.taskId = null; this.count = 0; this.anchor = null; }

  take(taskId, logs) {
    let start, reset = false;
    if (this.taskId !== taskId) start = Math.max(0, logs.length - this.tail);
    else if (this.count === 0) start = 0;
    else if (logs.length >= this.count && logKey(logs[this.count - 1]) === this.anchor) start = this.count;
    else {
      let previous = -1;
      for (let i = logs.length - 1; i >= 0; i--) {
        if (logKey(logs[i]) === this.anchor) { previous = i; break; }
      }
      reset = previous < 0;
      start = reset ? Math.max(0, logs.length - this.tail) : previous + 1;
    }
    this.taskId = taskId; this.count = logs.length;
    this.anchor = logs.length ? logKey(logs.at(-1)) : null;
    return {logs: logs.slice(start), reset};
  }
}

async function main(argv = process.argv.slice(2), io = {out: process.stdout, err: process.stderr}) {
  let options;
  try { options = parseArgs(argv); }
  catch (error) { io.err.write(`${clean(error.message)}\nUse --help for usage.\n`); return 2; }
  if (options.help) { io.out.write(HELP); return 0; }
  const store = new TaskStore(options.stateDir), cursor = new LogCursor(options.tail);
  let stopped = false, wake = null, previousWarnings = new Set(), header = '', waiting = false;
  const stop = () => { stopped = true; if (wake) wake(); };
  if (options.follow) { process.on('SIGINT', stop); process.on('SIGTERM', stop); }
  const write = message => io.out.write(`${clean(message)}\n`);
  try {
    do {
      try {
        const snapshot = options.mode === 'task' ?
          {tasks: [store.read(options.taskId).task], warnings: []} : store.scan();
        const warnings = new Set(snapshot.warnings);
        for (const warning of warnings) if (!previousWarnings.has(warning)) io.err.write(`${clean(warning)}\n`);
        previousWarnings = warnings;
        const tasks = snapshot.tasks.filter(task => !options.projectRoot ||
          (typeof task.projectRoot === 'string' && path.resolve(task.projectRoot) === options.projectRoot));
        if (options.mode === 'list') {
          write('ID\tSTATUS\tLAST OUTPUT (ISO/UTC)\tTITLE\tPROJECT');
          for (const task of tasks) write([task.id, task.status, task.lastLogAt || task.updatedAt || '',
            task.title || '', task.projectRoot || ''].map(value => clean(value).replace(/[\n\t]/g, ' ')).join('\t'));
          if (!tasks.length) write('No recorded tasks match this selection.');
          return 0;
        }
        const selected = options.mode === 'task' ? tasks.find(task => task.id === options.taskId) : tasks[0];
        if (!selected) {
          if (!waiting) write(`Waiting for task snapshots in ${options.stateDir}`);
          waiting = true;
          if (!options.follow) return 2;
        } else {
          waiting = false;
          const state = store.read(selected.id);
          const nextHeader = `${state.task.id}\0${state.task.status}`;
          if (nextHeader !== header) {
            write(`\nTRAE ${state.task.id} [${state.task.status}] ${state.task.title || ''}`);
            write(`Project: ${state.task.projectRoot || '(not recorded)'}`);
            header = nextHeader;
          }
          const update = cursor.take(state.task.id, state.logs);
          if (update.reset) write('[viewer] Snapshot logs were reset; showing the available tail.');
          for (const log of update.logs) {
            if (log && typeof log.message === 'string') {
              write(`[${log.timestamp || ''}] ${String(log.level || '').toUpperCase()} ${log.message}`);
            } else write('[viewer] Invalid log record in snapshot.');
          }
        }
      } catch (error) {
        const message = `Cannot read task snapshot: ${error.message}`;
        if (!previousWarnings.has(message)) io.err.write(`${clean(message)}\n`);
        previousWarnings = new Set([message]);
        if (!options.follow) return 2;
      }
      if (options.follow && !stopped) await new Promise(resolve => {
        const timer = setTimeout(() => { wake = null; resolve(); }, options.pollMs);
        wake = () => { clearTimeout(timer); wake = null; resolve(); };
      });
    } while (options.follow && !stopped);
    if (stopped) write('\nViewer stopped; TRAE execution was not signalled.');
    return 0;
  } finally {
    if (options.follow) { process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop); }
  }
}

function runCli() {
  process.stdout.on('error', error => {
    if (error.code === 'EPIPE') process.exit(0);
    else throw error;
  });
  main().then(code => { process.exitCode = code; }).catch(error => {
    process.stderr.write(`${clean(error.message)}\n`); process.exitCode = 2;
  });
}

module.exports = {parseArgs, TaskStore, LogCursor, clean, main, runCli};
if (require.main === module) runCli();
