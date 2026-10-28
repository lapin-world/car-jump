// index.html 의 '@sim-begin' ~ '@sim-end' 코드(게임 규칙)를 모아 랭킹 서버용 리플레이 검증 모듈을 만듦
//   node supabase/build-sim.mjs          → functions/_shared/sim.js 와 index.html 의 SIM_VERSION 갱신
//   node supabase/build-sim.mjs --check  → 갱신이 필요하면 실패 (배포 전 확인용)
// SIM_VERSION 은 규칙 코드의 해시라, 규칙이 바뀌면 예전 버전 화면에서 한 판은 서버가 받지 않음 (새로고침 안내)
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const INDEX = path.join(here, '..', 'index.html');
const OUT = path.join(here, 'functions', '_shared', 'sim.js');

const html = readFileSync(INDEX, 'utf8');
const blocks = [...html.matchAll(/^[ \t]*\/\/ @sim-begin\n([\s\S]*?)^[ \t]*\/\/ @sim-end$/gm)].map((m) => m[1]);
if (blocks.length === 0) throw new Error('@sim-begin 블록이 없음');
const code = blocks.join('\n');
const version = createHash('sha256').update(code).digest('hex').slice(0, 12);

const out = `// 자동 생성 파일 — 직접 고치지 말 것. index.html 의 게임 규칙을 고친 뒤 node supabase/build-sim.mjs 실행
// 브라우저와 같은 규칙 코드로 게임을 다시 돌려(리플레이) 점수를 확인함
export const SIM_VERSION = '${version}';

// 한 판 최대 길이(스텝, 3시간)·입력 수, 받을 수 있는 공격 수 (아이템전).
// 공격은 상대가 점수 ITEM_EVERY(50)점마다 얻는 아이템이라 상대 3명이 아무리 빨리 득점해도 (초당 약 4점) 1분에 약 15개,
// 시작 전에 모아 둔 아이템까지 처음 attacksBase 개 → 이보다 많으면 가짜 공격(라이벌 점수 부풀리기)으로 보고 거절
export const LIMITS = { maxSteps: 240 * 60 * 60 * 3, maxEvents: 200000, attacksBase: 9, attacksPerMin: 15 };

// 테스트용으로도 내보냄 (tests/server 에서 봇이 직접 한 판을 만들 때)
export function createGame() {
  let W = 0, groundY = 0;
  // 화면 연출은 서버에서 필요 없음
  const smoke = () => {}, sparks = () => {}, popup = () => {}, feedPush = () => {}, onGameOver = () => {}, onGameClear = () => {};
${code}
  return {
    STEP, ITEM_MAX, ATTACKS: ITEM_KINDS.filter((k) => k !== 'shield'),
    run(seed, r) {
      W = r.w;
      clock = r.c;
      holding = !!r.h;
      simStart(seed, !!r.it);
      const ev = r.ev;
      let i = 0;
      while (state === 'playing' && simSteps < r.n) {
        while (i < ev.length && ev[i][0] === simSteps) { applyInput(ev[i][1], ev[i][2]); i++; }
        simStep();
      }
      return { over: state === 'over', score, steps: simSteps, used: i };
    },
    // 테스트용: 직접 한 판 하기 (브라우저와 같은 함수로 입력·스텝 → replay 기록)
    play: {
      start(seed, w, items = false) { W = w; simStart(seed, items); },
      input: (c, a) => simInput(c, a),
      step: () => simStep(),
      get: () => ({ state, score, player, obstacles, speed, clock, items, simSteps, replay, holding, inTunnel: inTunnel(), CAR_SCALE, HOLD_MAX }),
    },
  };
}

const num = (v, lo, hi) => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;

// seed: 서버가 준 시드, r: 클라이언트가 보낸 리플레이 { w, c, h, it, n, ev }
// 결과: { ok: true, score, simMs } 또는 { ok: false, reason }
export function verifyReplay(seed, r) {
  const g = createGame();
  const bad = (reason) => ({ ok: false, reason });
  if (!r || typeof r !== 'object' || !Array.isArray(r.ev)) return bad('replay');
  if (!num(r.w, 800, 10000) || !num(r.c, 0, 1e7) || !Number.isInteger(r.n) || !num(r.n, 1, LIMITS.maxSteps)) return bad('replay');
  if (r.ev.length > LIMITS.maxEvents) return bad('replay');
  let prev = 0, attacks = 0;
  for (const e of r.ev) {
    if (!Array.isArray(e) || !Number.isInteger(e[0]) || e[0] < prev || e[0] >= r.n) return bad('replay');
    prev = e[0];
    const [, c, a] = e;
    if (c === 'H' || c === 'R' || c === 'T' || c === 'G') { if (e.length !== 2) return bad('replay'); }
    else if (c === 'W') { if (e.length !== 3 || !num(a, 800, 10000)) return bad('replay'); }
    else if (c === 'I') { if (!r.it || e.length !== 3 || !Number.isInteger(a) || a < 0 || a >= g.ITEM_MAX) return bad('replay'); }
    else if (c === 'A') { if (!r.it || e.length !== 3 || !g.ATTACKS.includes(a)) return bad('replay'); attacks++; }
    else return bad('replay');
  }
  if (attacks > LIMITS.attacksBase + (r.n * g.STEP / 60) * LIMITS.attacksPerMin) return bad('replay');
  const res = g.run(seed | 0, r);
  // 기록한 스텝에서 정확히 게임이 끝나고 모든 입력이 쓰였어야 함
  if (!res.over || res.steps !== r.n || res.used !== r.ev.length) return bad('mismatch');
  return { ok: true, score: res.score, simMs: Math.round(r.n * g.STEP * 1000) };
}
`;

const check = process.argv.includes('--check');
const htmlNew = html.replace(/const SIM_VERSION = '[^']*';/, `const SIM_VERSION = '${version}';`);
if (htmlNew === html && !html.includes(`const SIM_VERSION = '${version}';`)) throw new Error('index.html 에 SIM_VERSION 이 없음');
const stale = htmlNew !== html || !existsSync(OUT) || readFileSync(OUT, 'utf8') !== out;
if (check) {
  if (stale) { console.error('게임 규칙이 바뀌었는데 서버용 파일이 갱신되지 않음 → node supabase/build-sim.mjs 실행 후 커밋'); process.exit(1); }
  console.log(`최신 (SIM_VERSION ${version})`);
} else {
  writeFileSync(OUT, out);
  writeFileSync(INDEX, htmlNew);
  console.log(`SIM_VERSION ${version}`);
}
