// 실제 Edge Function(index.ts)을 Deno 로 띄워 끝까지 확인: Deno → supabase-js rpc → 가짜 PostgREST → PGlite(실제 SQL)
// Deno 가 없으면 건너뜀 (DENO=경로 로 지정 가능). Deno.serve 기본 포트 8000 사용
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { makeDb, rpcOf, checker } from './db.mjs';
import { playGame } from './bot.mjs';
import { SIM_VERSION } from '../../supabase/functions/_shared/sim.js';

const DENO = process.env.DENO || 'deno';
if (spawnSync(DENO, ['--version']).status !== 0) {
  console.log('SKIP Deno 없음 (DENO=경로 로 지정하면 실행)');
  process.exit(0);
}
const { check, done } = checker();
const db = await makeDb();
const rpc = rpcOf(db);

// PostgREST 흉내: POST /rest/v1/rpc/<함수> → JSON 결과
const rest = createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', async () => {
    const m = req.url.match(/^\/rest\/v1\/rpc\/(\w+)/);
    if (!m) { res.writeHead(404); return res.end(); }
    try {
      const out = await rpc(m[1], JSON.parse(body || '{}'));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(out));
    } catch (e) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ message: e.message }));
    }
  });
}).listen(54399);

const fn = spawn(DENO, ['run', '--allow-net', '--allow-env', '--allow-read', '--no-lock', new URL('../../supabase/functions/score/index.ts', import.meta.url).pathname], {
  env: { ...process.env, SUPABASE_URL: 'http://127.0.0.1:54399', SUPABASE_SERVICE_ROLE_KEY: 'test-key' },
  stdio: ['ignore', 'pipe', 'inherit'],
});
const stop = () => { fn.kill(); rest.close(); };
const FN = 'http://127.0.0.1:8000/';
for (let i = 0; i < 100; i++) {
  try { await fetch(FN, { method: 'OPTIONS' }); break; } catch { await new Promise((r) => setTimeout(r, 200)); }
}
const post = async (body) => { const r = await fetch(FN, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '5.6.7.8' }, body: JSON.stringify(body) }); return { status: r.status, ...(await r.json()) }; };

try {
  let fx;
  for (let sd = 1; !fx || fx.score < 20; sd++) fx = { seed: sd, ...playGame(sd, { maxSec: 60 }) };
  const s = await post({ action: 'start' });
  check('Deno: start', !!s.token && s.v === SIM_VERSION, JSON.stringify(s));
  await db.query("update private.games set seed = $2, issued_at = now() - interval '1 hour' where token = $1", [s.token, fx.seed]);
  const sub = { action: 'submit', v: SIM_VERSION, token: s.token, name: '데노', captcha: '', score: fx.score, replay: fx.replay };
  const bad = await post({ ...sub, score: fx.score + 1 });
  check('Deno: 조작 점수 거절', bad.error === 'mismatch', JSON.stringify(bad));
  const ok = await post(sub);
  check('Deno: 진짜 플레이 등록', ok.result === 'ok', JSON.stringify(ok));
  const row = await db.query("select score from public.scores where name = '데노'");
  check('Deno: DB 에 반영', row.rows[0]?.score === fx.score, JSON.stringify(row.rows));
  const used = await post(sub);
  check('Deno: 재사용 거절', used.error === 'used', JSON.stringify(used));
  const broken = await post({ ...sub, token: 'not-a-uuid-not-a-uuid-not-a-uuid-123' });
  check('Deno: 잘못된 토큰 거절', broken.error === 'invalid', JSON.stringify(broken));
} finally {
  stop();
}
done();
