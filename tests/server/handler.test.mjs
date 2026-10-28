// Edge Function 처리(handler.js) + 실제 SQL(PGlite) 확인: 진짜 플레이 리플레이는 통과, 조작한 요청은 모두 거절
// 리플레이는 봇(bot.mjs)이 게임 규칙 코드로 직접 한 판 (브라우저와 서버 결과가 같은지는 tests/integration/solo.js 에서 확인)
import { handle } from '../../supabase/functions/score/handler.js';
import { SIM_VERSION } from '../../supabase/functions/_shared/sim.js';
import { makeDb, rpcOf, checker } from './db.mjs';
import { playGame } from './bot.mjs';

const { check, done } = checker();
const db = await makeDb();
const rpc = rpcOf(db);
const seed = () => Math.floor(Math.random() * 4294967296) - 2147483648;
// 봇이 일찍 부딪히는 판도 있어 점수가 충분한 판이 나올 때까지 시드를 바꿔 다시
const game = (opts) => {
  for (let k = 0; k < 30; k++) { const sd = seed(); const g = playGame(sd, opts); if (g.score > 30) return { seed: sd, ...g }; }
  throw new Error('봇이 30번 모두 일찍 끝남');
};
const fixtures = [
  game({ maxSec: 150 }),
  // 일시정지(누르던 것 떼기 → 해제)와 게임 중 화면 크기 변경
  game({ w: 900, maxSec: 120, extra: (k, p) => {
    if (k % 2400 === 1200) { p.input('R'); p.input('G'); }
    if (k % 3000 === 1500) p.input('W', k % 6000 === 1500 ? 1100 : 900);
  } }),
  // 아이템전: 받은 공격 4종을 돌아가며, 아이템이 있으면 사용
  game({ items: true, maxSec: 150, extra: (k, p) => {
    if (k % 2880 === 1440) p.input('A', ['mint', 'white', 'sky', 'fog'][(k / 2880 | 0) % 4]);
    if (k % 2000 === 1000 && p.get().items.length) p.input('I', 0);
  } }),
];
check('봇 플레이 준비', fixtures.every((f) => f.score > 30), fixtures.map((f) => f.score).join(','));
let captcha = null; // verifyCaptcha 결과 (null: 사람 확인 안 씀)

const call = async (body, ip = '1.2.3.4') => {
  const res = await handle(new Request('http://x/score', { method: 'POST', headers: { 'x-forwarded-for': `${ip}, 10.0.0.1` }, body: JSON.stringify(body) }), { rpc, verifyCaptcha: async () => captcha });
  return { status: res.status, ...(await res.json()) };
};
// 시작해서 받은 토큰에 리플레이의 시드를 넣고, 그 판 길이만큼 시간이 흐른 것으로 맞춤
const startWith = async (fx, agoSec = fx.replay.n / 240 + 2) => {
  const s = await call({ action: 'start' });
  await db.query('update private.games set seed = $2, issued_at = now() - make_interval(secs => $3) where token = $1', [s.token, fx.seed, agoSec]);
  return s;
};
const submit = (s, fx, over = {}) => call({ action: 'submit', v: SIM_VERSION, token: s.token, name: '테스터', owner: 'owner-1', captcha: 'x', score: fx.score, replay: fx.replay, ...over });
const clone = (o) => JSON.parse(JSON.stringify(o));

const s0 = await call({ action: 'start' });
check('start: 시드·토큰·버전', !!s0.token && Number.isInteger(s0.seed) && s0.v === SIM_VERSION, JSON.stringify(s0));

for (const [i, fx] of fixtures.entries()) {
  const kinds = [...new Set(fx.replay.ev.map((e) => e[1]))].join('');
  const s = await startWith(fx);
  const r = await submit(s, fx, { name: `테스터${i}` });
  check(`진짜 플레이 통과 (${fx.score}점, ${(fx.replay.n / 240).toFixed(0)}초, 입력 ${kinds})`, r.result === 'ok', JSON.stringify(r));
  const again = await submit(s, fx, { name: `테스터${i}` });
  check('같은 판 다시 등록 거절', again.error === 'used', JSON.stringify(again));
}
const top = await db.query('select name, score from public.scores where game_token is not null order by score desc');
check('랭킹에 실제 점수로 등록', top.rows.length === fixtures.length && fixtures.every((fx, i) => top.rows.some((r) => r.name === `테스터${i}` && r.score === fx.score)), JSON.stringify(top.rows));

const fx = fixtures[0];
let s, r;
s = await startWith(fx);
r = await submit(s, fx, { score: fx.score + 500 });
check('점수만 부풀리기 거절', r.error === 'mismatch', JSON.stringify(r));
r = await submit(s, fx, { score: 9999 });
check('만점으로 바꾸기 거절', r.error === 'mismatch', JSON.stringify(r));

const longer = clone(fx.replay); longer.n += 240 * 60;
r = await submit(s, fx, { replay: longer });
check('판 길이 늘리기 거절', r.error === 'mismatch', JSON.stringify(r));

// 중간 이후 점프를 모두 빼면 다음 차에 부딪혀 기록과 다른 순간에 끝남
// (점프 하나만 빼면 터널 연타처럼 결과가 같은 경우가 있어 정상 판으로 통과하고 토큰이 쓰임)
const edited = clone(fx.replay);
edited.ev = edited.ev.filter((e, k) => k < edited.ev.length / 2 || e[1] !== 'T');
r = await submit(s, fx, { replay: edited });
check('입력을 고친 리플레이 거절', r.error === 'mismatch', JSON.stringify(r));
if (r.result) s = await startWith(fx); // 혹시 통과했으면 다음 확인은 새 토큰으로

const otherSeed = await call({ action: 'start' });
await db.query("update private.games set issued_at = now() - interval '1 hour' where token = $1", [otherSeed.token]);
r = await submit(otherSeed, fx);
check('다른 판(시드)의 리플레이 거절', r.error === 'mismatch', JSON.stringify(r));

const fakeAttack = clone(fx.replay); fakeAttack.ev.splice(5, 0, [fakeAttack.ev[4][0], 'A', 'mint']);
r = await submit(s, fx, { replay: fakeAttack });
check('혼자 하기에 가짜 공격 넣기 거절', r.error === 'replay', JSON.stringify(r));
const manyAttacks = clone(fx.replay); manyAttacks.it = 1;
for (let k = 0; k < 200; k++) manyAttacks.ev.push([manyAttacks.n - 1, 'A', 'mint']);
manyAttacks.ev.sort((a, b) => a[0] - b[0]);
r = await submit(s, fx, { replay: manyAttacks });
check('아이템전 공격을 비정상적으로 많이 넣기 거절', r.error === 'replay', JSON.stringify(r));
const badW = clone(fx.replay); badW.w = 50;
r = await submit(s, fx, { replay: badW });
check('비정상 화면 폭 거절', r.error === 'replay', JSON.stringify(r));
r = await submit(s, fx, { replay: { ...clone(fx.replay), ev: 'x' } });
check('형식이 틀린 리플레이 거절', r.error === 'replay', JSON.stringify(r));
r = await submit(s, fx, { v: 'old' });
check('다른 게임 버전 거절', r.error === 'version', JSON.stringify(r));
r = await submit({ token: '00000000-0000-0000-0000-000000000000' }, fx);
check('없는 토큰 거절', r.error === 'invalid', JSON.stringify(r));

const fast = await startWith(fx, 10);
r = await submit(fast, fx);
check('실제 흐른 시간보다 긴 판 거절 (미리 계산해 빨리 보내기)', r.error === 'too_fast', JSON.stringify(r));

captcha = false;
s = await startWith(fx);
r = await submit(s, fx);
check('사람 확인 실패 거절', r.error === 'captcha', JSON.stringify(r));
captcha = true;
r = await submit(s, fx, { name: '새이름' });
check('사람 확인 통과하면 등록', r.result === 'ok', JSON.stringify(r));
captcha = null;

s = await startWith(fx);
r = await submit(s, fx, { name: '테스터0', owner: 'someone-else' });
check('남의 이름 덮어쓰기 거절', r.error === 'name_taken', JSON.stringify(r));

const ipRow = await db.query('select ip from private.games where token = $1', [s.token]);
check('요청한 사람 IP 기록 (x-forwarded-for 첫 값)', ipRow.rows[0].ip === '1.2.3.4', JSON.stringify(ipRow.rows));

const big = await handle(new Request('http://x/score', { method: 'POST', body: 'x'.repeat(3 * 1024 * 1024) }), { rpc, verifyCaptcha: async () => null });
check('너무 큰 요청 거절', big.status === 413);
const opt = await handle(new Request('http://x/score', { method: 'OPTIONS' }), { rpc, verifyCaptcha: async () => null });
check('CORS 사전 요청 허용', opt.status === 200 && opt.headers.get('access-control-allow-origin') === '*');

done();
