# 랭킹 서버 (점수 조작 방지)

브라우저는 랭킹을 **조회만** 할 수 있습니다. 등록은 Edge Function `score` 가 게임을 서버에서 다시 돌려 점수를 확인한 뒤에만 합니다.

```
게임 시작 전  브라우저 ── start ──▶ score 함수 ──▶ game_start   시드·1회용 토큰 발급
한 판 하는 중 브라우저: 시드로 차량 배치, 모든 입력(점프·떼기·일시정지·아이템·받은 공격·화면 크기)을 스텝 번호와 함께 기록
게임 끝      브라우저 ── submit(리플레이) ──▶ score 함수
               ├ 사람 확인 (Cloudflare Turnstile, 설정한 경우)
               ├ 같은 시드·같은 입력으로 게임을 다시 돌려 점수 계산 → 보낸 점수와 다르면 거절
               └ game_finish: 토큰 1회용 · 실제 흐른 시간 ≥ 게임 시간 · 요청 횟수 확인 후 등록
```

| 막는 것 | 방법 |
|---|---|
| `curl` 등으로 점수만 보내기 | 등록 함수는 service_role 만 호출 가능. 리플레이가 없으면 등록 불가 |
| 점수 숫자만 바꾸기 (개발자 도구 등) | 서버가 리플레이로 다시 계산한 점수와 달라 거절 |
| 리플레이 조작 (입력 수정·다른 판 재사용·판 늘리기) | 시드가 판마다 다르고 토큰은 1회용, 끝난 스텝까지 정확히 맞아야 통과 |
| 미리 계산한 완벽한 입력을 바로 보내기 | 게임 시간이 토큰 발급 후 실제로 흐른 시간보다 길면 거절 (`too_fast`) |
| 가짜 공격으로 점수 부풀리기 (아이템전) | 1분에 받을 수 있는 공격 수 제한 |
| 대량 자동 등록 | IP당 시작 10분 120번 · 등록 10분 30번, Turnstile |
| 그래도 들어온 이상한 기록 | 관리자가 `hidden` 으로 숨김 (리플레이가 남아 있어 확인 가능) |

**이름:** 같은 이름은 어느 기기에서든 갱신됩니다 (공용 기기·여러 기기에서 같은 이름으로 플레이). 대신 다른 사람이 내 이름으로 **실제로 플레이한** 더 높은 점수를 올리는 것은 막지 않습니다.

**한계:** 게임이 브라우저에서 돌아가는 한 "실제로 게임을 대신 해 주는 봇"(사람처럼 입력을 실시간으로 넣는 프로그램)은 완전히 막을 수 없습니다. 위 방법으로 그 봇도 실제 시간만큼 플레이해야 하고, 사람 확인을 통과해야 하며, 남은 리플레이로 나중에 찾아 숨길 수 있게 했습니다.

## 처음 설정 (한 번)

순서대로 하면 랭킹 등록이 멈추는 시간이 가장 짧습니다.

1. **Edge Function 자동 배포 설정** (권장)
   - Supabase 대시보드 → 계정 → Access Tokens 에서 토큰 생성
   - GitHub 저장소 → Settings → Secrets and variables → Actions → `SUPABASE_ACCESS_TOKEN` 으로 저장
   - 이후 `main` 에 올라올 때마다 `.github/workflows/score-function.yml` 이 테스트 후 배포합니다

   직접 배포하려면 (Supabase CLI):
   ```bash
   npx supabase login
   npx supabase functions deploy score --project-ref auwkyehgnxejxacoklqt --no-verify-jwt
   ```
   `--no-verify-jwt` 가 꼭 필요합니다 (브라우저는 로그인 없이 publishable 키만 씀).

2. **SQL Editor 에서 `anticheat.sql` 실행** — 이 순간부터 예전 방식(`submit_score`) 등록이 막힙니다
3. **PR 머지** → GitHub Pages 에 새 화면 배포 + (1번을 했다면) Edge Function 자동 배포

## Cloudflare Turnstile (사람 확인, 선택)

1. Cloudflare 대시보드 → Turnstile → 사이트 추가, 도메인 `lapin-world.github.io`, 위젯 모드 **Managed**
2. **사이트 키**를 `index.html` 의 `TURNSTILE_SITE_KEY` 에 넣고 배포 (공개용이라 코드에 넣어도 됨)
3. 새 화면이 배포된 뒤 **시크릿 키**를 Edge Function 시크릿으로 저장:
   Supabase 대시보드 → Edge Functions → Secrets 에서 `TURNSTILE_SECRET`
   (또는 `npx supabase secrets set TURNSTILE_SECRET=... --project-ref auwkyehgnxejxacoklqt`)

시크릿이 없으면 서버는 사람 확인을 하지 않습니다. 시크릿을 먼저 넣으면 사이트 키가 없는 화면의 등록이 모두 거절되니 2 → 3 순서로 하세요.

## 조작된 기록 정리 (SQL Editor)

```sql
-- 예전 방식으로 들어간 기록 (서버 검증 없이 등록된 것)
select name, score, created_at from public.scores where game_token is null order by score desc;
-- 숨기기 (같은 이름은 계속 숨김) / 다시 보이기
update public.scores set hidden = true where name = '이름';
update public.scores set hidden = false where name = '이름';
-- 이 이름으로 등록된 판의 기록 (IP · 게임 시간 · 입력 수)
select used_at, ip, score, sim_ms, jsonb_array_length(replay->'ev') as inputs
from private.games where lower(name) = lower('이름') order by used_at desc;
```

## 접속 통계 (`visits.sql`)

`anticheat.sql` 다음에 SQL Editor 에서 `visits.sql` 을 한 번 실행하면, 게임 화면이 페이지 접속(`visit`)과 게임 시작(`play`, 모드별)을 기록합니다.
방문자는 브라우저마다 저장한 무작위 ID 로만 구분하고 이름·IP 는 저장하지 않습니다. 브라우저(anon)는 기록만 할 수 있고 조회는 SQL Editor 에서만 됩니다.
(실행 전에는 기록 요청이 실패하지만 게임에는 영향 없음)

```sql
-- 날짜별 (한국 시간): 순 방문자 · 접속 수 · 플레이한 기기 수 · 게임 시작 수 · 모드별 시작 수
select * from private.daily_stats limit 30;
-- 전체 순 방문자 수
select count(distinct visitor) from private.visits where kind = 'visit';
-- 시간대별 접속 (최근 7일)
select extract(hour from at at time zone 'Asia/Seoul') as hour, count(*)
from private.visits where kind = 'visit' and at > now() - interval '7 days' group by 1 order by 1;
```

순 방문자는 기기(브라우저) 기준이라, 같은 사람이 다른 기기·사생활 보호 모드로 들어오면 따로 셉니다.

## 게임 규칙을 바꿀 때

`index.html` 의 `// @sim-begin` ~ `// @sim-end` 사이 코드는 서버 검증과 공유됩니다. 이 부분을 고치면:

```bash
node supabase/build-sim.mjs   # functions/_shared/sim.js 와 index.html 의 SIM_VERSION 갱신
```

을 실행해 함께 커밋하세요 (안 하면 GitHub Actions 테스트가 실패합니다). `SIM_VERSION` 이 바뀌면 예전 화면에서 하던 판은 등록되지 않고 새로고침 안내가 나옵니다.

이 사이 코드에서는 `Math.random`·화면(DOM/canvas)을 쓰지 말고, 무작위는 `rng()`, 연출은 `smoke`·`sparks`·`popup`·`feedPush`·`onGameOver`·`onGameClear` 호출로만 합니다. 점수에 영향을 주는 계산에 `Math.sin` 같은 삼각·지수 함수를 쓰면 브라우저마다 결과가 미세하게 달라질 수 있으니 피하세요 (지금은 차체 회전 연출에만 씀).

## 파일

| 파일 | 역할 |
|---|---|
| `anticheat.sql` | 게임 토큰 · 요청 제한 · 숨김 · 등록 함수 |
| `visits.sql` | 접속 통계 (접속 · 게임 시작 기록, `daily_stats`) |
| `functions/score/index.ts` | Edge Function 진입점 (Deno) |
| `functions/score/handler.js` | 요청 처리 (start / submit) |
| `functions/_shared/sim.js` | **자동 생성** — 리플레이 검증 (index.html 의 게임 규칙 코드) |
| `build-sim.mjs` | 위 파일 생성 |
| `../tests/server/` | SQL · 검증 · Edge Function 테스트 (`npm install && npm test`) |
