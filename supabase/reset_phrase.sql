-- 랭킹 초기화 문구: 이 문구를 이름으로 등록하면 랭킹 전체가 초기화됨
-- 문구 자체는 GitHub 에 올리지 않음. 아래 '<리셋 문구>' 를 실제 문구로 바꿔 SQL Editor 에서 한 번 실행
-- (DB 에는 문구가 아닌 SHA-256 해시만 저장. private 스키마는 API 로 노출되지 않음)

create extension if not exists pgcrypto with schema extensions;

-- 1) 문구 해시 저장
create schema if not exists private;
create table if not exists private.settings (key text primary key, value text not null);
insert into private.settings (key, value)
values ('reset_hash', encode(extensions.digest('<리셋 문구>', 'sha256'), 'hex'))
on conflict (key) do update set value = excluded.value;

-- 2) 등록 함수 교체: 반환값 'reset' | 'ok'
--    반환 타입이 바뀌므로 기존 함수를 지우고 다시 만듦
drop function if exists public.submit_score(text, int);
create function public.submit_score(p_name text, p_score int)
returns text
language plpgsql
security definer
set search_path = public
as $$
begin
  if encode(extensions.digest(trim(p_name), 'sha256'), 'hex')
     = (select value from private.settings where key = 'reset_hash') then
    delete from public.scores where true;
    return 'reset';
  end if;

  -- 이름당 1줄, 더 높은 점수일 때만 갱신 (이름 길이·점수 범위는 테이블 check 제약으로 검사)
  insert into public.scores (name, score)
  values (trim(p_name), p_score)
  on conflict ((lower(name))) do update
    set score = excluded.score, created_at = now()
    where excluded.score > scores.score;
  return 'ok';
end;
$$;

revoke all on function public.submit_score(text, int) from public;
grant execute on function public.submit_score(text, int) to anon;
