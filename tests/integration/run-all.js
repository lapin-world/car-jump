// 한 번에 실행: 테스트용 사본 만들기 → 사이트 서버·중계 서버 켜기 → 시나리오(run.js) → 서버 끄기
// 사용법: npm test  (또는 node run-all.js [시나리오 파일, 기본 run.js])
const { spawn, execFileSync } = require('child_process');
const path = require('path');
const here = __dirname;

execFileSync('python3', [path.join(here, 'build-test-copy.py')], { stdio: 'inherit' });

const env = { ...process.env, GHOST_MS: process.env.GHOST_MS || '200000' };
const server = spawn(process.execPath, [path.join(here, 'server.js')], { stdio: 'inherit' });
const relay = spawn(process.execPath, [path.join(here, 'relay.js')], { stdio: 'inherit', env });
const stop = () => { server.kill(); relay.kill(); };
process.on('SIGINT', () => { stop(); process.exit(130); });

setTimeout(() => {
  const run = spawn(process.execPath, [path.join(here, process.argv[2] || 'run.js')], { stdio: 'inherit' });
  run.on('exit', (code) => { stop(); process.exit(code); });
}, 1000);
