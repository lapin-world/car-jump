// 테스트 사본 정적 파일 + 랭킹 REST(scores) · 랭킹 등록 Edge Function(score) 흉내 서버
// 등록은 실제 서버와 같은 리플레이 검증 모듈(supabase/functions/_shared/sim.js)로 확인
const http = require('http');
const crypto = require('crypto');
const { pathToFileURL } = require('url');
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, 'site');
const scores = new Map(); // name -> score (같은 이름은 최고 점수만)
const submits = [];
const rejects = []; // 리플레이 검증에 실패한 등록 (정상 플레이만 하므로 비어 있어야 함)
const replays = []; // 받은 리플레이 (검증 속도 측정용)
const games = new Map(); // token -> { seed, at, used }
const lastSeed = new Map();
const handler = import(pathToFileURL(path.join(__dirname, '..', '..', 'supabase', 'functions', 'score', 'handler.js')).href);

// 사람 확인: 토큰을 보내지 않으면 (사이트 키 없음) 안 쓰는 것으로, 보내면 가짜 turnstile 이 준 'fake-ok' 만 통과
// anticheat.sql 의 game_start · game_get · game_finish 를 메모리로 흉내 (이름 주인·요청 제한은 tests/server 에서 확인)
async function rpc(fn, a) {
  if (fn === 'game_start') {
    const token = crypto.randomUUID();
    const seed = crypto.randomInt(-2147483648, 2147483647);
    games.set(token, { seed, at: Date.now(), used: false });
    lastSeed.set(token, seed);
    return { token, seed };
  }
  const g = games.get(a.p_token);
  if (fn === 'game_get') return g ? { seed: g.seed, used: g.used } : null;
  if (fn === 'game_finish') {
    if (!g) return 'invalid';
    if (g.used) return 'used';
    if (a.p_sim_ms > Date.now() - g.at + 5000) return 'too_fast';
    g.used = true;
    return 'ok';
  }
}
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.png': 'image/png' };

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/functions/v1/score') {
    // 실제 Edge Function 코드(handler.js)를 그대로 쓰고, DB 함수(anticheat.sql)만 메모리로 흉내
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', async () => {
      const { handle } = await handler;
      const r = await handle(new Request('http://x/score', { method: req.method, headers: { 'x-forwarded-for': '127.0.0.1' }, body: req.method === 'POST' ? body : undefined }), { rpc, verifyCaptcha: async (t) => (t ? t === 'fake-ok' : null) });
      const out = await r.text();
      if (req.method === 'POST') {
        const b = JSON.parse(body), d = JSON.parse(out);
        if (b.action === 'submit') {
          if (d.result) { submits.push({ name: b.name, score: b.score, at: Date.now() }); scores.set(b.name, Math.max(scores.get(b.name) || 0, b.score)); }
          else rejects.push({ name: b.name, score: b.score, error: d.error });
          replays.push({ seed: lastSeed.get(b.token), replay: b.replay, score: b.score });
        }
      }
      res.writeHead(r.status, { 'Content-Type': 'application/json' });
      res.end(out);
    });
    return;
  }
  if (url.pathname === '/rest/v1/rpc/log_visit') { // 접속 통계: 기록하지 않고 성공만 응답
    res.writeHead(204);
    res.end();
    return;
  }
  if (url.pathname === '/rest/v1/scores') {
    const rows = [...scores.entries()].map(([name, score]) => ({ name, score })).sort((a, b) => b.score - a.score).slice(0, 10);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(rows));
    return;
  }
  if (url.pathname === '/__submits') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(submits));
    return;
  }
  if (url.pathname === '/__replays') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(replays));
    return;
  }
  if (url.pathname === '/__rejects') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ rejects }));
    return;
  }
  const file = path.join(ROOT, url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname));
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
}).listen(9200, () => console.log('site on 9200'));
