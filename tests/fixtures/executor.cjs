const fs = require('node:fs');
const path = require('node:path');
const [mode, resultFile] = process.argv.slice(2);
let prompt = '';
process.stdin.on('data', chunk => { prompt += chunk; });
process.stdin.on('end', () => {
  if (mode === 'hang') return setInterval(() => {}, 1000);
  if (mode === 'fail') { console.error('sandbox restriction: permission denied'); process.exitCode = 1; return; }
  fs.writeFileSync(path.join(process.cwd(), 'executed.json'), JSON.stringify({prompt, args: process.argv.slice(2)}));
  fs.writeFileSync(resultFile, 'TRAE final report: fixture executed');
  console.log('fixture complete');
});
