// Everything, from a cold checkout, with nothing else running.
//
// The four acceptance suites test the *built* bundle rather than the dev
// server — minification and asset-path rewriting break things `vite dev` never
// shows — which means they need `vite preview` up on 4173. Remembering that is
// a papercut, and forgetting it produces ERR_CONNECTION_REFUSED, which looks
// like a broken test and is not one. So this builds, serves, runs all four in
// order, and takes the server down again whatever happens.
//
//   npm run verify              build, serve, run everything
//   npm run verify -- --skip-build     reuse the existing dist/
import { spawn, spawnSync } from 'node:child_process';

const skipBuild = process.argv.includes('--skip-build');
const URL = 'http://localhost:4173/';

const run = (cmd, args) => spawnSync(cmd, args, { stdio: 'inherit', shell: false });

if (!skipBuild) {
  console.log('— build —');
  if (run('npm', ['run', 'build']).status !== 0) process.exit(1);
}

console.log('— serve —');
const server = spawn('npx', ['vite', 'preview', '--port', '4173'], {
  stdio: ['ignore', 'ignore', 'inherit'],
});
const stop = () => { if (!server.killed) server.kill('SIGTERM'); };
process.on('exit', stop);
process.on('SIGINT', () => { stop(); process.exit(130); });

// Wait for the port rather than sleeping a guessed interval.
const deadline = Date.now() + 30000;
let up = false;
while (Date.now() < deadline) {
  try {
    const r = await fetch(URL, { method: 'HEAD' });
    if (r.ok || r.status === 404) { up = true; break; }
  } catch { /* not listening yet */ }
  await new Promise((r) => setTimeout(r, 250));
}
if (!up) {
  console.error(`preview server never came up on ${URL}`);
  stop();
  process.exit(1);
}

const SUITES = [
  ['smoke', 'boot and fly'],
  ['trade', 'the first trade run'],
  ['nebula', 'lanes, charts and dated news'],
  ['aliens', 'territories, postures and barter'],
];

const failed = [];
for (const [name, what] of SUITES) {
  console.log(`\n— ${name}: ${what} —`);
  if (run('node', [`tools/${name}.mjs`]).status !== 0) failed.push(name);
}

stop();
console.log('');
if (failed.length) {
  console.log(`FAILED: ${failed.join(', ')}`);
  process.exit(1);
}
console.log(`ALL ${SUITES.length} SUITES PASS`);
