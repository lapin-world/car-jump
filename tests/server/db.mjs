// 테스트용 DB: Supabase 역할(anon · service_role)과 기본 권한을 흉내 내고 supabase/*.sql 을 순서대로 실행
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { readFileSync } from 'node:fs';

const SQL = new URL('../../supabase/', import.meta.url);
export const RESET_PHRASE = '초기화해줘!';

export async function makeDb({ legacyRows = true } = {}) {
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(`create role anon; create role authenticated; create role service_role; create schema extensions;
    grant usage on schema public to anon, service_role;`);
  const run = (f, fix = (s) => s) => db.exec(fix(readFileSync(new URL(f, SQL), 'utf8')));
  await run('scores.sql');
  await db.exec('grant all on public.scores to anon, authenticated;'); // Supabase 는 public 테이블에 기본으로 모든 권한을 줌
  await run('scores_unique_name.sql');
  await run('reset_phrase.sql', (s) => s.replaceAll("'<리셋 문구>'", `'${RESET_PHRASE}'`));
  if (legacyRows) await db.exec(`insert into public.scores (name, score) values ('조작범', 9999), ('예전유저', 50);`);
  await run('anticheat.sql');
  await run('visits.sql');
  return db;
}

// Edge Function 이 supabase-js 로 부르는 rpc 와 같은 결과 (service_role 로 public 함수 호출)
export function rpcOf(db) {
  return async (fn, args) => {
    const keys = Object.keys(args);
    const params = keys.map((k) => (args[k] !== null && typeof args[k] === 'object' ? JSON.stringify(args[k]) : args[k]));
    await db.exec('set role service_role');
    try {
      const r = await db.query(`select public.${fn}(${keys.map((k, i) => `${k} => $${i + 1}`).join(', ')}) as r`, params);
      return r.rows[0].r;
    } finally {
      await db.exec('reset role');
    }
  };
}

export function checker() {
  let pass = 0, fail = 0;
  const check = (name, ok, info = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${info ? ` — ${info}` : ''}`); };
  const done = () => { console.log(`PASS ${pass} FAIL ${fail}`); process.exit(fail ? 1 : 0); };
  return { check, done };
}
