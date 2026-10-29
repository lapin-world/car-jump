-- 접속 통계: 페이지 접속(visit)과 게임 시작(play)을 기록
-- anticheat.sql 을 실행한 뒤 SQL Editor 에서 한 번 실행 (다시 실행해도 됨)
--
-- 브라우저(anon)는 log_visit 으로 기록만 할 수 있고, 기록 조회는 불가 (SQL Editor 에서만 확인)
-- 방문자는 기기(브라우저)마다 localStorage 에 저장한 무작위 ID 로 구분 — 이름·IP 는 저장하지 않음

create table if not exists private.visits (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  visitor uuid,  -- localStorage 를 못 쓰는 브라우저(사생활 보호 모드 등)는 null
  kind text not null check (kind in ('visit', 'play')),
  mode text check (mode in ('solo', 'normal', 'item', 'contest')) -- play 만: 혼자 하기 · 노템전 · 아이템전 · 대회 모드
);
create index if not exists visits_at_idx on private.visits (at);

create or replace function public.log_visit(p_visitor uuid, p_kind text, p_mode text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  ip text := split_part(coalesce(nullif(current_setting('request.headers', true), '')::json->>'x-forwarded-for', ''), ',', 1);
begin
  if p_kind is null or p_kind not in ('visit', 'play') then return; end if;
  if p_kind = 'visit' then p_mode := null;
  elsif p_mode is null or p_mode not in ('solo', 'normal', 'item', 'contest') then return;
  end if;
  -- 대량 기록 방지: IP당 10분에 300번까지 (넘으면 조용히 버림)
  if ip <> '' and not private.rate_ok(ip, 'visit', 300, interval '10 minutes') then return; end if;
  insert into private.visits (visitor, kind, mode) values (p_visitor, p_kind, p_mode);
end;
$$;

revoke all on function public.log_visit(uuid, text, text) from public, anon, authenticated;
grant execute on function public.log_visit(uuid, text, text) to anon;

-- 하루 통계 (한국 시간 기준). SQL Editor 에서: select * from private.daily_stats limit 30;
create or replace view private.daily_stats as
select
  (at at time zone 'Asia/Seoul')::date as day,
  count(distinct visitor) filter (where kind = 'visit') as visitors,  -- 순 방문자 (기기 수)
  count(*) filter (where kind = 'visit') as visits,                   -- 페이지 접속 수
  count(distinct visitor) filter (where kind = 'play') as players,    -- 한 판 이상 한 기기 수
  count(*) filter (where kind = 'play') as plays,                     -- 게임 시작 수
  count(*) filter (where mode = 'solo') as solo,
  count(*) filter (where mode = 'normal') as normal,
  count(*) filter (where mode = 'item') as item,
  count(*) filter (where mode = 'contest') as contest
from private.visits
group by 1
order by 1 desc;

revoke all on private.visits, private.daily_stats from public, anon, authenticated;
