# 테스트용 사본: 실제 게임 코드에 자동 플레이 봇과 관찰용 훅만 덧붙임 (게임 규칙은 그대로)
import shutil, os
ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
SRC = os.path.join(ROOT, 'index.html')
HERE = os.path.dirname(os.path.abspath(__file__))
DST = os.path.join(HERE, 'site')
os.makedirs(DST, exist_ok=True)
if not os.path.exists(os.path.join(DST, 'assets')):
    shutil.copytree(os.path.join(ROOT, 'assets'), os.path.join(DST, 'assets'))
s = open(SRC, encoding='utf-8').read()

def rep(a, b):
    global s
    assert s.count(a) == 1, a
    s = s.replace(a, b)

# 창 전환 때 자동 일시정지 끔 (여러 창을 한 브라우저에서 돌리므로)
rep("  function setPaused(on) {\n    if (on && state !== 'playing') return;",
    "  function setPaused(on) {\n    if (on && window.__noPause) return;\n    if (on && state !== 'playing') return;")
# 프레임 수 측정
rep("  function loop(now) {\n", "  function loop(now) {\n    window.__frames = (window.__frames || 0) + 1;\n")
# 받은 공격 기록
rep("    const who = room.players.get(from).name;",
    "    const who = room.players.get(from).name;\n    (window.__hits = window.__hits || []).push({ from: who, room: code, myRoom: room.code, kind, target: to.includes(myId) });")
# 봇 + 관찰 함수
rep("  function update(dt) {\n    clock += dt;", r"""  let autoHold = 0, autoItemAt = 0;
  function autoPlayStep() {
    const p = player;
    if (p.mode === 'ceiling' || p.mode === 'toCeiling') { if (clock - p.lastTap > 0.12) feverTap(); return; }
    if (p.mode) return;
    if (inTunnel()) { feverTap(); return; }
    if (itemMode() && items.length && clock > autoItemAt) { autoItemAt = clock + 1 + Math.random() * 4; useItem(0); }
    if (!p.onGround) { holding = autoHold > clock; return; }
    holding = false;
    const ahead = obstacles.filter((o) => !o.passed && o.x + o.w > p.x - 40);
    // 머리 위로 넘어올 민트 라이벌이 가까우면 점프하지 않음
    const rivalNear = ahead.some((o) => o.rival && !o.sky && !o.landed && (o.t >= 0 || o.x - o.jumpAt < speed * 0.9));
    const cars = ahead.filter((o) => !o.rival || o.sky || o.landed).sort((a, b) => a.x - b.x);
    const next = cars[0];
    if (!next || rivalNear) return;
    const dist = next.x - (p.x + 44 * CAR_SCALE);
    if (dist < speed * window.__botLead) {
      const group = cars.filter((o) => o.x < next.x + 520);
      autoHold = group.length > 1 ? clock + HOLD_MAX : 0;
      holding = autoHold > clock;
      jump();
    }
  }
  window.__botLead = 0.18;
  window.__dbg = () => ({
    name: room && room.me.name, room: room && room.code, mode: room && room.mode, host: room && room.players.get(room.host) && room.players.get(room.host).name,
    me: myId, state, score, items: items.slice(), countdown: !!countdownAt,
    players: room ? [...room.players.values()].map((q) => ({ id: q.id, name: q.name, score: q.score, status: q.status })) : [],
    rank: roomRank(), topInset, frames: window.__frames || 0, hits: window.__hits || [],
    canStart: room ? canStart() : null, lobby: [...document.querySelectorAll('#mp-rooms li')].map((l) => l.textContent),
  });
  function update(dt) {
    clock += dt;
    if (window.__bot && state === 'playing') autoPlayStep();""")
# 실제 supabase-js 대신 로컬 중계 서버용 가짜 클라이언트
rep("const SUPABASE_JS = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.99.3/dist/umd/supabase.js';",
    "const SUPABASE_JS = 'fake-supabase-ws.js';")
# 랭킹 REST 는 테스트 서버(가짜)로
rep("const SUPABASE_URL = 'https://auwkyehgnxejxacoklqt.supabase.co';", "const SUPABASE_URL = location.origin;")
open(os.path.join(DST, 'index.html'), 'w', encoding='utf-8').write(s)
shutil.copy(os.path.join(HERE, 'fake-supabase-ws.js'), DST)
print('built')
