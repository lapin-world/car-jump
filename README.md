# Taxi Jump

엔터 한 번으로 테슬라를 뛰어넘는 원버튼 점프 게임입니다. `index.html` 한 파일로 동작합니다.

## AI 제작 고지

이 게임은 AI(Anthropic의 Claude)를 활용해 제작되었습니다.

- 게임 코드와 문서의 상당 부분을 AI 코딩 도구(Claude Code)로 작성했으며, AI가 참여한 커밋에는 `Co-Authored-By: Claude` 표기가 남아 있습니다.
- 같은 내용을 게임 시작 화면 하단에도 표시합니다.
- 게임 플레이 중에는 생성형 AI가 동작하지 않습니다. 화면에 나오는 내용은 모두 미리 작성된 코드로 그려집니다.

## 실행

정적 파일 서버로 저장소 루트를 열면 됩니다.

```sh
python3 -m http.server 8000
# http://localhost:8000/
```

## 테스트

- `tests/integration` — 브라우저 자동 플레이 통합 테스트 (`tests/integration/README.md` 참고)
- `tests/server` — 랭킹 서버 테스트 (`tests/server/README.md` 참고)
