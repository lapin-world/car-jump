-- 점수 조작 방지: 랭킹 등록을 Edge Function(supabase/functions/score)으로만 받음
-- scores.sql · scores_unique_name.sql · reset_phrase.sql 을 실행한 뒤 SQL Editor 에서 한 번 실행 (다시 실행해도 됨)
--
-- 흐름: 게임 시작 전 game_start → 시드·토큰 발급 / 게임 끝 → Edge Function 이 리플레이로 점수를 다시 계산한 뒤 game_finish
-- 아래 함수들은 service_role(Edge Function)만 호출 가능. 브라우저(anon)는 랭킹 조회만 가능

create extension if not exists pgcrypto with schema extensions;
create schema if not exists private;

-- 1) 발급한 게임 (토큰 1개 = 한 판). 등록된 판은 리플레이를 남겨 나중에 의심 기록을 확인할 수 있게 함
create table if not exists private.games (
  token uuid primary key default gen_random_uuid(),
  seed int not null,
  ip text not null,
  issued_at timestamptz not null default now(),
  used_at timestamptz,
  name text,
  score int,
  sim_ms int,
  replay jsonb
);
create index if not exists games_issued_idx on private.games (issued_at);

-- 2) 요청 횟수 제한 기록 (IP별)
create table if not exists private.rate_hits (
  ip text not null,
  kind text not null,
  at timestamptz not null default now()
);
create index if not exists rate_hits_idx on private.rate_hits (ip, kind, at);

-- 3) 랭킹 테이블: 숨김(관리자가 조작 기록을 가림) · 이름 주인 · 등록한 게임
alter table public.scores add column if not exists hidden boolean not null default false;
alter table public.scores add column if not exists owner_hash text;
alter table public.scores add column if not exists game_token uuid;

-- 브라우저는 숨기지 않은 기록만, 공개 열만 조회 가능 (owner_hash·game_token 은 안 보임). 쓰기는 전부 불가
drop policy if exists "scores read" on public.scores;
create policy "scores read" on public.scores for select to anon using (not hidden);
revoke all on public.scores from anon, authenticated;
grant select (id, name, score, created_at, hidden) on public.scores to anon;

-- 예전 등록 함수(이름·점수를 그대로 믿던 것)는 삭제
drop function if exists public.submit_score(text, int);

-- 요청 제한: p_window 동안 p_limit 번까지. 넘으면 false
create or replace function private.rate_ok(p_ip text, p_kind text, p_limit int, p_window interval)
returns boolean
language plpgsql
set search_path = ''
as $$
begin
  if random() < 0.01 then
    delete from private.rate_hits where at < now() - interval '1 day';
  end if;
  if (select count(*) from private.rate_hits where ip = p_ip and kind = p_kind and at > now() - p_window) >= p_limit then
    return false;
  end if;
  insert into private.rate_hits (ip, kind) values (p_ip, p_kind);
  return true;
end;
$$;

-- 게임 시작: 시드·토큰 발급 (IP당 10분에 120번까지 — 같은 와이파이의 여러 명을 감안해 넉넉히)
create or replace function public.game_start(p_ip text)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  g private.games;
begin
  if not private.rate_ok(p_ip, 'start', 120, interval '10 minutes') then
    return json_build_object('error', 'rate');
  end if;
  if random() < 0.01 then
    delete from private.games where used_at is null and issued_at < now() - interval '2 days';
  end if;
  insert into private.games (seed, ip)
  values ((floor(random() * 4294967296) - 2147483648)::int, p_ip)
  returning * into g;
  return json_build_object('token', g.token, 'seed', g.seed);
end;
$$;

-- 리플레이 검증에 필요한 정보
create or replace function public.game_get(p_token uuid)
returns json
language sql
security definer
set search_path = ''
as $$
  select json_build_object('seed', seed, 'used', used_at is not null)
  from private.games where token = p_token;
$$;

-- 게임 끝: Edge Function 이 리플레이로 확인한 점수를 등록
-- 반환: 'ok' | 'reset' | 오류 코드 (invalid · used · expired · too_fast · rate · name · name_taken)
create or replace function public.game_finish(
  p_token uuid, p_ip text, p_name text, p_owner text, p_score int, p_sim_ms int, p_replay jsonb)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  g private.games;
  v_name text := trim(p_name);
  v_owner text := encode(extensions.digest(coalesce(p_owner, ''), 'sha256'), 'hex');
  v_cur public.scores;
begin
  select * into g from private.games where token = p_token for update;
  if not found then return 'invalid'; end if;
  if g.used_at is not null then return 'used'; end if;
  if g.issued_at < now() - interval '12 hours' then return 'expired'; end if;
  -- 실제로 흐른 시간보다 긴 판은 불가능 (미리 계산한 입력을 빨리 감아 보내는 것 차단). 5초는 네트워크 여유
  if p_sim_ms > extract(epoch from now() - g.issued_at) * 1000 + 5000 then return 'too_fast'; end if;
  if not private.rate_ok(p_ip, 'submit', 30, interval '10 minutes') then return 'rate'; end if;

  -- 랭킹 초기화 문구 (reset_phrase.sql). 검증된 한 판을 끝낸 뒤에만 가능
  if encode(extensions.digest(
       regexp_replace(normalize(p_name, NFC), '[[:space:][:punct:]！？]', '', 'g'), 'sha256'), 'hex')
     = (select value from private.settings where key = 'reset_hash') then
    update private.games set used_at = now(), name = p_name, score = p_score, sim_ms = p_sim_ms, replay = p_replay
    where token = p_token;
    delete from public.scores where true;
    return 'reset';
  end if;

  if char_length(v_name) not between 1 and 12 then return 'name'; end if;
  if p_score not between 1 and 9999 then return 'invalid'; end if;

  -- 이름 주인 확인: 처음 등록한 브라우저의 비밀값과 같아야 갱신 가능 (예전 기록처럼 주인이 없으면 이번에 주인이 됨)
  select * into v_cur from public.scores where lower(name) = lower(v_name) for update;
  if found and v_cur.owner_hash is not null and v_cur.owner_hash <> v_owner then
    return 'name_taken';
  end if;

  update private.games set used_at = now(), name = v_name, score = p_score, sim_ms = p_sim_ms, replay = p_replay
  where token = p_token;

  -- 이름당 1줄, 더 높은 점수일 때만 갱신. 숨긴 이름은 계속 숨김
  insert into public.scores (name, score, owner_hash, game_token)
  values (v_name, p_score, v_owner, p_token)
  on conflict ((lower(name))) do update set
    owner_hash = coalesce(scores.owner_hash, excluded.owner_hash),
    score = greatest(scores.score, excluded.score),
    created_at = case when excluded.score > scores.score then now() else scores.created_at end,
    game_token = case when excluded.score > scores.score then excluded.game_token else scores.game_token end;
  return 'ok';
end;
$$;

revoke all on function private.rate_ok(text, text, int, interval) from public, anon, authenticated;
revoke all on function public.game_start(text) from public, anon, authenticated;
revoke all on function public.game_get(uuid) from public, anon, authenticated;
revoke all on function public.game_finish(uuid, text, text, text, int, int, jsonb) from public, anon, authenticated;
grant execute on function public.game_start(text) to service_role;
grant execute on function public.game_get(uuid) to service_role;
grant execute on function public.game_finish(uuid, text, text, text, int, int, jsonb) to service_role;

-- ---------- 관리자용 (SQL Editor 에서 필요할 때) ----------
-- 조작 의심 기록 숨기기 (이름은 그대로 묶여 있어 같은 이름으로 다시 올라오지 않음):
--   update public.scores set hidden = true where name = '이름';
-- 다시 보이기:
--   update public.scores set hidden = false where name = '이름';
-- 이 이름으로 등록된 판들의 리플레이·걸린 시간 보기:
--   select issued_at, used_at, ip, score, sim_ms, jsonb_array_length(replay->'ev') as inputs
--   from private.games where lower(name) = lower('이름') order by used_at desc;
-- 이번에 조작된 기록처럼 예전 방식으로 들어간 기록(game_token 없음)만 보기:
--   select name, score, created_at from public.scores where game_token is null order by score desc;
