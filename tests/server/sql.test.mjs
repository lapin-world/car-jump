// anticheat.sql 확인: 권한(anon 은 조회만) · 토큰 1회용 · 시간 확인 · 이름 주인 · 숨김 · 요청 제한 · 리셋 문구
import { makeDb, checker } from './db.mjs';

const { check, done } = checker();
const db = await makeDb();
const sql = (await import('node:fs')).readFileSync(new URL('../../supabase/anticheat.sql', import.meta.url), 'utf8');
await db.exec(sql);
check('anticheat.sql 다시 실행해도 됨', true);

const one = async (q, p = []) => (await db.query(q, p)).rows[0];
const asRole = async (role, q) => { await db.exec(`set role ${role}`); try { return await db.query(q); } finally { await db.exec('reset role'); } };

// anon 권한
let err = await asRole('anon', `select public.game_start('1.1.1.1')`).then(() => null, (e) => e.message);
check('anon 은 game_start 호출 불가', !!err, err);
err = await asRole('anon', `insert into public.scores (name, score) values ('x', 9999)`).then(() => null, (e) => e.message);
check('anon 은 scores 에 쓰기 불가', !!err, err);
err = await asRole('anon', `select game_token from public.scores`).then(() => null, (e) => e.message);
check('anon 은 game_token 조회 불가', !!err, err);
const vis = await asRole('anon', `select name, score from public.scores order by score desc`);
check('anon 랭킹 조회', vis.rows.length === 2, JSON.stringify(vis.rows));
err = await db.query(`select 1 from pg_proc where proname = 'submit_score'`);
check('예전 submit_score 삭제', err.rows.length === 0);

// 시작 → 등록
const start = async (ip = '1.1.1.1') => (await one(`select public.game_start($1) as r`, [ip])).r;
const finish = async (token, name, score, simMs, ip = '1.1.1.1') =>
  (await one(`select public.game_finish($1, $2, $3, $4, $5, '{"ev":[]}') as r`, [token, ip, name, score, simMs])).r;
const backdate = (token, sec) => db.query(`update private.games set issued_at = now() - make_interval(secs => $2) where token = $1`, [token, sec]);
let s = await start();
check('game_start 시드·토큰', !!s.token && Number.isInteger(s.seed), JSON.stringify(s));
check('game_get', (await one(`select public.game_get($1) as r`, [s.token])).r.seed === s.seed);
check('너무 빠른 판 거절', await finish(s.token, '철수', 100, 60000) === 'too_fast');
await backdate(s.token, 70);
check('정상 등록', await finish(s.token, '철수', 100, 60000) === 'ok');
check('같은 토큰 재사용 거절', await finish(s.token, '철수', 200, 60000) === 'used');
check('없는 토큰 거절', await finish('00000000-0000-0000-0000-000000000000', '철수', 200, 1) === 'invalid');
s = await start(); await backdate(s.token, 100);
check('같은 이름은 다른 기기에서도 갱신 (대소문자 무관)', await finish(s.token, '철수', 150, 60000) === 'ok');
check('점수 갱신 확인', (await one(`select score from public.scores where name = '철수'`)).score === 150);
s = await start(); await backdate(s.token, 100);
check('낮은 점수는 유지', await finish(s.token, '철수', 90, 60000) === 'ok' && (await one(`select score from public.scores where name = '철수'`)).score === 150);
s = await start(); await backdate(s.token, 100);
check('예전 기록도 같은 이름으로 갱신', await finish(s.token, '예전유저', 60, 60000) === 'ok' && (await one(`select score from public.scores where name = '예전유저'`)).score === 60);
s = await start(); await backdate(s.token, 100);
check('13자 이름 거절', await finish(s.token, '가나다라마바사아자차카타파', 60, 60000) === 'name');
s = await start(); await backdate(s.token, 13 * 3600);
check('12시간 지난 토큰 거절', await finish(s.token, '철수', 60, 60000) === 'expired');

// 숨김
await db.query(`update public.scores set hidden = true where name = '조작범'`);
const vis2 = await asRole('anon', `select name from public.scores`);
check('숨긴 기록은 조회 안 됨', !vis2.rows.some((r) => r.name === '조작범'), JSON.stringify(vis2.rows));
s = await start(); await backdate(s.token, 100);
await finish(s.token, '조작범', 100, 60000);
check('숨긴 이름은 계속 숨김', (await one(`select hidden from public.scores where name = '조작범'`)).hidden === true);

// 요청 제한
let rate = null;
for (let i = 0; i < 125; i++) { const r = await start('9.9.9.9'); if (r.error) { rate = i; break; } }
check('시작 요청 제한 (10분 120번)', rate === 120, `${rate}번째에 제한`);
let subRate = null;
for (let i = 0; i < 35; i++) {
  const t = (await start('8.8.8.8')).token; await backdate(t, 100);
  const r = await finish(t, `봇${i}`, 10, 1000, '8.8.8.8');
  if (r === 'rate') { subRate = i; break; }
}
check('등록 요청 제한 (10분 30번)', subRate === 30, `${subRate}번째에 제한`);

// 리셋 문구
s = await start(); await backdate(s.token, 100);
const rr = await finish(s.token, '초기화 해줘', 10, 60000);
check('리셋 문구', rr === 'reset' && (await one(`select count(*)::int as n from public.scores`)).n === 0);

// 접속 통계 (visits.sql)
await db.exec((await import('node:fs')).readFileSync(new URL('../../supabase/visits.sql', import.meta.url), 'utf8'));
check('visits.sql 다시 실행해도 됨', true);
const vid = '11111111-1111-1111-1111-111111111111';
const logAs = async (args, ip = '') => {
  await db.query(`select set_config('request.headers', $1, false)`, [ip ? JSON.stringify({ 'x-forwarded-for': `${ip}, 10.0.0.1` }) : '']);
  return asRole('anon', `select public.log_visit(${args})`);
};
await logAs(`'${vid}', 'visit'`);
await logAs(`'${vid}', 'visit', 'solo'`); // visit 의 mode 는 버림
await logAs(`'${vid}', 'play', 'solo'`);
await logAs(`null, 'play', 'item'`);
await logAs(`'${vid}', 'play', 'hack'`); // 없는 모드는 무시
await logAs(`'${vid}', 'click'`);         // 없는 종류는 무시
await logAs(`'${vid}', 'play'`);          // play 인데 모드 없음은 무시
const rows = (await db.query(`select visitor, kind, mode from private.visits order by id`)).rows;
check('log_visit 기록', JSON.stringify(rows.map((r) => [r.kind, r.mode])) === JSON.stringify([['visit', null], ['visit', null], ['play', 'solo'], ['play', 'item']]), JSON.stringify(rows));
err = await asRole('anon', `select * from private.visits`).then(() => null, (e) => e.message);
check('anon 은 visits 조회 불가', !!err, err);
err = await asRole('anon', `insert into private.visits (kind) values ('visit')`).then(() => null, (e) => e.message);
check('anon 은 visits 에 직접 쓰기 불가', !!err, err);
err = await asRole('anon', `select * from private.daily_stats`).then(() => null, (e) => e.message);
check('anon 은 daily_stats 조회 불가', !!err, err);
const day = (await db.query(`select * from private.daily_stats`)).rows[0];
const dayN = Object.fromEntries(Object.entries(day).filter(([k]) => k !== 'day').map(([k, v]) => [k, Number(v)]));
check('daily_stats', JSON.stringify(dayN) === JSON.stringify({ visitors: 1, visits: 2, players: 1, plays: 2, solo: 1, normal: 0, item: 1, contest: 0 }), JSON.stringify(dayN));
const before = Number((await one(`select count(*) as n from private.visits`)).n);
for (let i = 0; i < 305; i++) await logAs(`'${vid}', 'visit'`, '7.7.7.7');
const added = Number((await one(`select count(*) as n from private.visits`)).n) - before;
check('접속 기록 제한 (IP당 10분 300번, x-forwarded-for 첫 IP 기준)', added === 300, `${added}번 기록`);

done();
