-- Supabase 대시보드 > SQL Editor 에서 한 번 실행
create table if not exists public.scores (
  id bigint generated always as identity primary key,
  name text not null check (char_length(name) between 1 and 12),
  score int not null check (score > 0 and score < 100000),
  created_at timestamptz not null default now()
);

create index if not exists scores_score_idx on public.scores (score desc, created_at);

alter table public.scores enable row level security;

-- 누구나 조회·추가만 가능 (수정·삭제 정책 없음 → 불가)
create policy "scores read" on public.scores for select to anon using (true);
create policy "scores insert" on public.scores for insert to anon with check (true);
