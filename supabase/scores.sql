-- Supabase 대시보드 > SQL Editor 에서 한 번 실행
create table if not exists public.scores (
  id bigint generated always as identity primary key,
  name text not null check (char_length(name) between 1 and 12),
  score int not null constraint scores_score_range check (score between 1 and 9999), -- 만점 9999 (index.html MAX_SCORE 와 동일)
  created_at timestamptz not null default now()
);

create index if not exists scores_score_idx on public.scores (score desc, created_at);

alter table public.scores enable row level security;

-- 누구나 조회·추가만 가능 (수정·삭제 정책 없음 → 불가)
create policy "scores read" on public.scores for select to anon using (true);
create policy "scores insert" on public.scores for insert to anon with check (true);

-- 이미 테이블을 만든 경우: 점수 범위 제약만 교체
-- alter table public.scores drop constraint if exists scores_score_check;
-- alter table public.scores drop constraint if exists scores_score_range;
-- delete from public.scores where score not between 1 and 9999;
-- alter table public.scores add constraint scores_score_range check (score between 1 and 9999);
