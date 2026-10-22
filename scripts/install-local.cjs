#!/usr/bin/env node
// Install the Linux/WSL launcher, skill, and MCP entry without replacing other settings.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const root = path.resolve(__dirname,'..');
const homes = process.argv.slice(2);
if (!homes.length) homes.push(process.env.CODEX_HOME || path.join(os.homedir(),'.codex'));
const launcher = path.join(os.homedir(),'.local/bin/trae-task-bridge');
const watchLauncher = path.join(os.homedir(),'.local/bin/trae-task-watch');
const trae = process.env.TRAE_EXECUTOR_COMMAND || path.join(os.homedir(),'.local/bin/traex');
const workspace = process.env.SANDBOX_ROOT || path.dirname(root);
const state = path.join(os.homedir(),'.local/state/agent-collaboration-orchestrator/tasks');
const quote = value => `'${value.replace(/'/g,"'\\''")}'`;
for (const file of [path.join(root,'dist/cli.js'),trae]) {
  if(!fs.existsSync(file)) throw Error(`Missing ${file}; build the bridge and install TRAE first.`);
}
const block = `\n[mcp_servers.trae-task-bridge]\ncommand = ${JSON.stringify(launcher)}\nstartup_timeout_sec = 30\ntool_timeout_sec = 120\ndefault_tools_approval_mode = "writes"\n`;
const source = fs.readFileSync(path.join(root,'skills/codex-trae-workspace/SKILL.md'),'utf8');
const watchSource = path.join(root,'skills/codex-trae-workspace/scripts/watch-task.cjs');
const watchContent = fs.readFileSync(watchSource,'utf8');
// Preflight all installations before writing any settings.
const targets = homes.map(home => {
  const config = path.join(home,'config.toml');
  const text = fs.existsSync(config) ? fs.readFileSync(config,'utf8') : '';
  const skill = path.join(home,'skills/codex-trae-workspace/SKILL.md');
  if(fs.existsSync(skill) && fs.readFileSync(skill,'utf8') !== source) throw Error(`Existing skill differs: ${skill}; review before replacing it.`);
  const watch = path.join(home,'skills/codex-trae-workspace/scripts/watch-task.cjs');
  if(fs.existsSync(watch) && fs.readFileSync(watch,'utf8') !== watchContent) throw Error(`Existing viewer differs: ${watch}; review before replacing it.`);
  const match = text.match(/\[mcp_servers\.trae-task-bridge\]([^]*?)(?=\n\[|$)/);
  if(match && !match[1].includes(`command = ${JSON.stringify(launcher)}`)) throw Error(`Existing MCP entry differs: ${config}; review before replacing it.`);
  return {home, config, text, skill, watch, configured:!!match};
});
fs.mkdirSync(path.dirname(launcher),{recursive:true});
const env = {
  SANDBOX_ROOT:workspace, EXECUTOR_COMMAND:trae, EXECUTOR_AGENT:'TRAE', ORCHESTRATOR_AGENT:'Codex',
  EXECUTOR_ARGS:'--ask-for-approval never exec --cd {projectRoot} --sandbox {sandbox} --color never --output-last-message {resultFile} -',
  EXECUTOR_TIMEOUT_MS:'1800000', BRIDGE_STATE_DIR:state,
};
const script = ['#!/bin/bash','set -euo pipefail',`export PATH=${quote(path.dirname(process.execPath)+':'+path.dirname(trae))}:"$PATH"`,...Object.entries(env).map(([key,value])=>`export ${key}=${quote(value)}`),`exec ${quote(process.execPath)} ${quote(path.join(root,'dist/cli.js'))}`,''].join('\n');
if(fs.existsSync(launcher) && fs.readFileSync(launcher,'utf8') !== script) {
  fs.copyFileSync(launcher,`${launcher}.backup-${Date.now()}`);
}
fs.writeFileSync(launcher,script,{mode:0o755});
fs.chmodSync(launcher,0o755);
const watchScript = ['#!/bin/bash', `exec ${quote(process.execPath)} ${quote(watchSource)} "$@"`, ''].join('\n');
if(fs.existsSync(watchLauncher) && fs.readFileSync(watchLauncher,'utf8') !== watchScript) {
  fs.copyFileSync(watchLauncher,`${watchLauncher}.backup-${Date.now()}`);
}
fs.writeFileSync(watchLauncher,watchScript,{mode:0o755});
fs.chmodSync(watchLauncher,0o755);
for(const target of targets) {
  fs.mkdirSync(target.home,{recursive:true});
  let updated = target.configured ? target.text : target.text+block;
  if(target.configured) {
    updated = updated.replace(/(\[mcp_servers\.trae-task-bridge\])([^]*?)(?=\n\[|$)/, (all, header, body) => {
      if(body.includes('default_tools_approval_mode')) return all;
      return `${header}${body.trimEnd()}\ndefault_tools_approval_mode = "writes"\n`;
    });
  }
  for(const tool of ['submit_task','request_revision','cancel_task','resolve_permission_request']) {
    const header = `[mcp_servers.trae-task-bridge.tools.${tool}]`;
    if(!updated.includes(header)) updated += `\n${header}\napproval_mode = "${tool === 'resolve_permission_request' ? 'prompt' : 'approve'}"\n`;
  }
  if(updated !== target.text) {
    if(fs.existsSync(target.config)) fs.copyFileSync(target.config,`${target.config}.trae-backup-${Date.now()}`);
    fs.writeFileSync(target.config,updated,{mode:0o600});
  }
  fs.mkdirSync(path.dirname(target.skill),{recursive:true});
  fs.writeFileSync(target.skill,source);
  fs.mkdirSync(path.dirname(target.watch),{recursive:true});
  fs.writeFileSync(target.watch,watchContent,{mode:0o755});
  console.log(`Installed MCP and skill in ${target.home}`);
}
console.log(`Launcher: ${launcher}\nRead-only output viewer: ${watchLauncher}\nReopen the Codex chat to load the new tools and skill.`);
