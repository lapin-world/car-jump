// 테스트용 봇: 서버와 같은 게임 규칙 코드로 직접 한 판을 해서 리플레이를 만듦 (브라우저의 테스트 봇과 같은 방식)
// 게임 규칙이 바뀌어도 그 규칙대로 새로 만들어지므로 따로 갱신할 필요 없음
import { createGame } from '../../supabase/functions/_shared/sim.js';

// opts: w 화면 폭, items 아이템전, maxSec 최대 길이(초, 넘으면 봇을 꺼서 끝냄), lead 점프 타이밍,
//       extra(step, play) 매 스텝 추가 입력 (일시정지 해제·화면 크기·공격 등)
export function playGame(seed, { w = 1280, items = false, maxSec = 120, lead = 0.1, extra } = {}) {
  const { play } = createGame();
  play.start(seed, w, items);
  let botHold = 0;
  for (let k = 0; play.get().state === 'playing'; k++) {
    const g = play.get();
    if (extra) extra(k, play);
    if (k < maxSec * 240) step(g);
    play.step();
    if (k > maxSec * 240 + 240 * 60) throw new Error('끝나지 않음');
  }
  const g = play.get();
  return { score: g.score, replay: { ...g.replay, n: g.simSteps } };

  function step(g) {
    const p = g.player;
    if (p.mode === 'ceiling' || p.mode === 'toCeiling') { if (g.clock - p.lastTap > 0.12) play.input('T'); return; }
    if (p.mode) return;
    if (g.inTunnel) { play.input('T'); return; }
    if (!p.onGround) { play.input(botHold > g.clock ? 'H' : 'R'); return; }
    play.input('R');
    const ahead = g.obstacles.filter((o) => !o.passed && o.x + o.w > p.x - 40);
    const rivalNear = ahead.some((o) => o.rival && !o.sky && !o.landed && (o.t >= 0 || o.x - o.jumpAt < g.speed * 0.9));
    const cars = ahead.filter((o) => !o.rival || o.sky || o.landed).sort((a, b) => a.x - b.x);
    const next = cars[0];
    if (!next || rivalNear) return;
    if (next.x - (p.x + 44 * g.CAR_SCALE) < g.speed * lead) {
      botHold = cars.filter((o) => o.x < next.x + 520).length > 1 ? g.clock + g.HOLD_MAX : 0;
      play.input(botHold > g.clock ? 'H' : 'R');
      play.input('T');
    }
  }
}
