# 랭킹 서버 테스트

```bash
cd tests/server
npm install
npm test
```

| 파일 | 확인하는 것 |
|---|---|
| `sql.test.mjs` | `supabase/anticheat.sql` 을 실제 Postgres(PGlite, WebAssembly)에서 실행: anon 은 조회만 · 토큰 1회용 · 실제 흐른 시간 확인 · 같은 이름은 여러 기기에서 갱신 · 숨김 · 요청 제한 · 리셋 문구 |
| `handler.test.mjs` | Edge Function 처리(`handler.js`) + 실제 SQL: 진짜 플레이 리플레이는 통과, 점수·입력·길이·시드·버전 조작, 가짜 공격, 너무 빠른 등록, 사람 확인 실패는 거절 |
| `deno-e2e.mjs` | 실제 `index.ts` 를 Deno 로 띄워 supabase-js → (가짜 PostgREST) → PGlite 까지. Deno 가 없으면 건너뜀 (`DENO=경로`) |
| `bot.mjs` | 게임 규칙 코드로 직접 한 판을 하는 봇 (일반 · 일시정지·화면 크기 변경 · 아이템전 공격). 규칙이 바뀌어도 새 규칙대로 만들어짐 |

`npm test` 는 먼저 `node ../../supabase/build-sim.mjs --check` 로 게임 규칙 코드와 서버용 파일이 일치하는지 확인합니다.
브라우저에서 한 판과 서버 계산이 같은지는 `tests/integration/solo.js`(혼자 하기)와 `npm test`(같이 하기)에서 확인합니다.
