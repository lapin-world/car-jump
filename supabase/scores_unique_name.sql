-- 이름 중복 방지: 이름당 1줄, 최고 점수만 유지 (대소문자 구분 없음)
-- scores.sql 실행 후 SQL Editor 에서 한 번 실행

-- 1) 기존 중복 정리: 이름별 최고 점수(동점이면 먼저 등록된 것)만 남김
delete from public.scores s
using public.scores t
where lower(s.name) = lower(t.name)
  and (t.score > s.score or (t.score = s.score and t.id < s.id));

-- 2) 이름 유일 제약
create unique index if not exists scores_name_key on public.scores (lower(name));

-- 3) 등록 함수: 새 이름이면 추가, 있는 이름이면 더 높은 점수일 때만 갱신
create or replace function public.submit_score(p_name text, p_score int)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.scores (name, score)
  values (trim(p_name), p_score)
  on conflict ((lower(name))) do update
    set score = excluded.score, created_at = now()
    where excluded.score > scores.score;
$$;

revoke all on function public.submit_score(text, int) from public;
grant execute on function public.submit_score(text, int) to anon;

-- 4) 테이블 직접 추가는 막고 함수로만 등록 (조회 정책은 유지)
drop policy if exists "scores insert" on public.scores;
