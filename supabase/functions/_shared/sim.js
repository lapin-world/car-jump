// 자동 생성 파일 — 직접 고치지 말 것. index.html 의 게임 규칙을 고친 뒤 node supabase/build-sim.mjs 실행
// 브라우저와 같은 규칙 코드로 게임을 다시 돌려(리플레이) 점수를 확인함
export const SIM_VERSION = 'f53b00742474';

// 한 판 최대 길이(스텝, 3시간)·입력 수, 받을 수 있는 공격 수 (아이템전).
// 공격은 상대가 점수 ITEM_EVERY(50)점마다 얻는 아이템이라 상대 3명이 아무리 빨리 득점해도 (초당 약 4점) 1분에 약 15개,
// 시작 전에 모아 둔 아이템까지 처음 attacksBase 개 → 이보다 많으면 가짜 공격(라이벌 점수 부풀리기)으로 보고 거절
export const LIMITS = { maxSteps: 240 * 60 * 60 * 3, maxEvents: 200000, attacksBase: 9, attacksPerMin: 15 };

// 테스트용으로도 내보냄 (tests/server 에서 봇이 직접 한 판을 만들 때)
export function createGame() {
  let W = 0, groundY = 0;
  // 화면 연출은 서버에서 필요 없음
  const smoke = () => {}, sparks = () => {}, popup = () => {}, feedPush = () => {}, onGameOver = () => {}, onGameClear = () => {};
  // 물리 상수: 체공 약 0.9초, 최고 높이 약 185px
  const GRAVITY = 1850;
  const JUMP_VELOCITY = 830;
  const CAR_SCALE = 1.6; // 로드스터 크기 배율
  const ROLLS_PER_JUMP = 1; // 점프당 배럴롤 횟수 (영상 기준 약 1바퀴)
  const START_SPEED = 380;
  const MAX_SPEED = 900;
  const SPEED_GAIN = 9; // 초당 속도 증가량
  // 길게 누르기: 상승 중 누르고 있는 동안(최대 HOLD_MAX초) 중력을 줄여 더 높고 길게 점프
  // 탭: 최고 약 186px·체공 0.9초 / 길게: 최고 약 333px·체공 1.26초
  const HOLD_GRAVITY = 0.4;
  const HOLD_MAX = 0.35;
  const NEAR_MISS = 16;     // 차량 위를 이 높이(px) 이내로 스치면 '아슬아슬'
  const MAX_COMBO_BONUS = 3;
  // 라이벌 차량: 차량을 ROLL_AFTER대 넘긴 뒤부터 가끔(ROLL_CHANCE) 우리 차와 같은 모델(민트 단색 랩핑)이
  // 배럴롤 점프로 우리 차를 뛰어넘어 뒤로 지나감. 가만히 있으면 머리 위로 지나가고, 그 순간 점프하면 공중 충돌.
  // 체공 시간은 속도와 상관없이 ROLL_TIME초로 고정해 우리 차처럼 느긋하게 돎
  const ROLL_AFTER = 25;
  const ROLL_CHANCE = 0.2;
  const ROLL_TIME = 1.1;  // 체공 시간(초) — 우리 차 탭 점프 0.9초, 길게 누르기 1.26초
  // 뛰어넘기 최고 높이: 우리 차 위를 지날 때 라이벌 바닥이 약 317 이상 → 길게 누른 점프(정점 약 333)로도 위로 넘을 수 없고 충돌
  const OVER_HOP = 380;
  const OVER_SPAN = 700;  // 뛰어넘는 동안 이동 거리 (정점이 우리 차 바로 위)
  const PLAYER_H = 64;    // 공중 충돌 판정용 우리 차 높이 (루프 표시등 포함)
  // 하이퍼루프 피버타임: FEVER_SCORE점 이상이면 달이 한 주기를 돌 때마다(삭) 터널이 등장.
  // 터널 안에서 연타하면 천장에 거꾸로 매달려 달리고 그 아래로 차량이 지나감.
  // 연타가 GRIP_TIME초 넘게 끊기면 추락해 게임 오버, 터널을 빠져나가면 배럴롤로 자동 착지
  const FEVER_SCORE = 100;
  const TUNNEL_TIME = 7;    // 터널 길이 (등장 시 속도로 달리는 시간, 초)
  const TUNNEL_CEIL = 230;  // 천장 높이(px)
  const TUNNEL_TOP = 272;   // 튜브 바깥 높이(px)
  const CEIL_Y = TUNNEL_CEIL - 66; // 매달렸을 때 player.y (뒤집힌 바퀴 윗면이 천장에 닿는 높이)
  const GRIP_TIME = 0.4;    // 마지막 탭 후 이 시간 안에 다시 눌러야 매달려 있음
  const CLIMB_TIME = 0.35;  // 천장까지 뒤집으며 올라가는 시간
  const EXIT_TIME = 0.9;    // 출구 배럴롤 착지 시간
  const FEVER_BONUS = 10;   // 터널 통과 보너스
  // 난이도 단계: LEVEL_SCORE점부터 LEVEL_STEP점마다 1단계씩 (최대 MAX_LEVEL)
  // 단계가 오를수록 연속 차량·라이벌 확률이 늘고 간격 랜덤 폭이 줄며, 박자를 깨는 러시 패턴이 자주 나옴
  const LEVEL_SCORE = 200;
  const LEVEL_STEP = 150;
  const MAX_LEVEL = 5;
  const LEVEL_OFFSET = 2;   // 단계별 난이도 = 단계 + 이 값 (LV1부터 바로 어렵게: LV1 = 예전 LV3 수준)
  const BURST_MAX = 6;      // 러시 최대 차량 수 (점프당 타이밍 허용 폭 0.1초 유지)
  // 러시 중 차량 간격 = 최소 간격 + 이 값 (랜덤 없이 일정한 박자). 점프마다 타이밍 오차를 이 폭 안에서만 허용:
  // 최악 패턴 기준 러시 4대 약 0.13초, 5대 약 0.11초, 6대(BURST_MAX) 0.1초
  const BURST_GAP = 0.035;
  // 일반 구간 최소 간격 = 최소 간격 + 이 값 = 탭 체공 시간(약 0.99초) + 0.1초 → 몇 대가 이어져도 점프당 허용 폭 0.1초 유지
  const CHAIN_GAP = 0.105;
  const GROUP_PAD = 0.35;   // 최고 속도에서 2~3대 묶음 뒤 추가 간격 (묶음 길이 무관)
  const SPREAD_CUT = 0.18;  // 난이도 값마다 간격 랜덤 폭을 이 비율씩 줄임 (LV1 약 0.5초 → LV3부터 약 0.1초)
  const SPREAD_MIN = 0.1;   // 랜덤 폭 최소 비율
  const BURST_REST = 1.0;   // 러시가 끝난 뒤 쉬는 시간 (박자 깨기)
  const BURST_PAIR = 0.35;  // 러시 중 2대 연속(길게 누르기) 섞일 확률 — 탭·길게 누르기 번갈아 요구

  // 랭킹 등록 가능한 최대 점수 (만점). 도달하면 게임 클리어. DB check 제약(supabase/scores.sql)과 같은 값이어야 함
  const MAX_SCORE = 9999;
  // 달 한 주기(초). 삭(새달)마다 피버타임 판정
  const MOON_CYCLE = 60;

  // 장애물 차량: 테슬라 차종 이미지 (모두 왼쪽을 향하도록 배경 제거·반전한 PNG)
  // w: 화면 표시 폭(px), h: 높이 (이미지 비율대로 미리 계산 — 서버 검증과 같아야 해서 이미지 로드와 무관하게 고정),
  // hitTop: 이미지 위쪽에서 판정 제외 비율, points: 넘었을 때 점수
  const OBSTACLE_TYPES = [
    { name: 'model3',     src: 'assets/cars/model3.png',     w: 150, h: 47, hitTop: 0.15, points: 1 },
    { name: 'modely',     src: 'assets/cars/modely.png',     w: 140, h: 50, hitTop: 0.15, points: 1 },
    { name: 'models',     src: 'assets/cars/models.png',     w: 150, h: 48, hitTop: 0.15, points: 1 },
    { name: 'cybercab',   src: 'assets/cars/cybercab.png',   w: 120, h: 48, hitTop: 0.2,  points: 1 },
    { name: 'modelx',     src: 'assets/cars/modelx.png',     w: 150, h: 70, hitTop: 0.35, points: 2 }, // 팔콘윙 도어
    { name: 'cybertruck', src: 'assets/cars/cybertruck.png', w: 165, h: 54, hitTop: 0.1,  points: 2 },
  ];

  let state = 'ready'; // ready | playing | over
  let speed, distance, score, obstacles, spawnTimer, flips, combo, carsPassed, level, burst;
  let holding = false; // 점프 버튼을 누르고 있는지
  let clock = 0;       // 경과 시간 (배경 애니메이션·피버 주기)
  let player;
  let tunnel = null;   // 하이퍼루프 터널 { x: 입구 위치, len: 길이 }
  let moonCycle = 0;   // 지금까지 지난 달 주기 수 (피버타임 등장 판정)
  let cleared = false; // 만점(MAX_SCORE) 달성으로 끝났는지
  let feverEndAt = -Infinity; // 터널 구간 차량 생성이 끝난 시각

  // 게임은 화면 주사율과 상관없이 STEP초 간격으로 진행 → 어느 기기에서든, 서버에서 다시 돌려도 같은 결과
  const STEP = 1 / 240;
  // 차량 배치용 시드 난수: 서버가 준 시드로 시작하므로 서버도 같은 차량 배치를 다시 만들 수 있음
  function mulberry32(a) {
    return () => {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  let rng = mulberry32(1);
  let simSteps = 0;   // 이번 판 진행 스텝 수
  let replay = null;  // 이번 판 기록 { w: 화면 폭, c: 시작 시각, h: 누르고 시작, it: 아이템전, ev: [[스텝, 종류, 값]...] }

  function simStart(seed, withItems) {
    simItems = withItems;
    reset();
    rng = mulberry32(seed);
    simSteps = 0;
    replay = { w: W, c: clock, h: holding ? 1 : 0, it: withItems ? 1 : 0, ev: [] };
    state = 'playing';
    jump();
  }

  // 게임에 영향을 주는 입력은 모두 여기로. 게임 중이면 스텝 번호와 함께 기록해 서버가 같은 순간에 다시 적용함
  // H 누름 · R 뗌 · T 점프/연타 · G 일시정지 해제 · I 아이템 사용(칸) · A 공격 받음(종류) · W 화면 폭 바뀜(폭)
  function simInput(c, a) {
    if ((c === 'H' && holding) || (c === 'R' && !holding) || (c === 'W' && W === a)) return;
    if (state === 'playing') replay.ev.push(a === undefined ? [simSteps, c] : [simSteps, c, a]);
    return applyInput(c, a);
  }

  function applyInput(c, a) {
    switch (c) {
      case 'H': holding = true; return;
      case 'R': holding = false; return;
      case 'T': if (state === 'playing') feverTap() || jump(); return;
      case 'G': // 일시정지 해제: 누르던 입력은 끊고, 천장에 매달려 있었으면 바로 떨어지지 않게
        holding = false;
        if (player.mode === 'ceiling') player.lastTap = clock;
        return;
      case 'I': return useItemEffect(a);
      case 'A': return attackEffect(a);
      case 'W': W = a; if (player) player.x = Math.max(100, W * 0.2); return;
    }
  }

  function reset() {
    speed = START_SPEED;
    distance = 0;
    score = 0;
    flips = 0;
    combo = 0;
    carsPassed = 0;
    level = 0;
    burst = 0; // 남은 러시 차량 수
    feverEndAt = -Infinity;
    obstacles = [];
    spawnTimer = 1.2;
    player = {
      x: Math.max(100, W * 0.2), y: 0, vy: 0, roll: 0, airTime: 0,
      wheel: 0, onGround: true, smokeTimer: 0, jumpClears: 0, jumpNear: 0,
      mode: null, modeT: 0, y0: 0, r0: 0, lastTap: 0, // 피버 모드: toCeiling | ceiling | falling | exitRoll
    };
    tunnel = null;
    cleared = false;
    moonCycle = Math.floor(clock / MOON_CYCLE + 0.1);
    resetItems();
  }

  function airDuration() {
    return (2 * JUMP_VELOCITY) / GRAVITY;
  }

  function jump() {
    if (!player.onGround) return;
    player.vy = JUMP_VELOCITY;
    player.onGround = false;
    player.airTime = 0;
    player.jumpClears = 0;
    player.jumpNear = 0;
    smoke(player.x - 40 * CAR_SCALE, groundY - 6, 8, 40);
  }

  function randomType() {
    return OBSTACLE_TYPES[Math.floor(rng() * OBSTACLE_TYPES.length)];
  }

  function addCar(type, x) {
    obstacles.push({ type, w: type.w, h: type.h, x, passed: false, minClear: Infinity });
  }

  // 라이벌: 차체 중심이 우리 차 위를 정점으로 지나가도록 이륙·착지 지점을 잡음 (터널 안에서는 이륙하지 않음)
  function addRival(x) {
    const o = {
      type: RIVAL, w: RIVAL.w, h: RIVAL.h, x, passed: false, minClear: Infinity,
      rival: true, jumpAt: player.x + OVER_SPAN / 2 - RIVAL.w / 2, land: player.x - OVER_SPAN / 2 - RIVAL.w / 2, peak: OVER_HOP,
      t: -1, p: 0, hop: 0, roll: 0, pitch: 0, landed: false, wheel: 0,
    };
    obstacles.push(o);
    return o;
  }

  // 장애물 패턴: 단일 차량 / 2~3대 연속(길게 누르기)
  // 연속 차량은 길게 누른 점프로 넘을 수 있는 속도 구간에서만 등장. 반환값은 다음 생성까지 추가 대기 시간
  function spawnObstacle(inBurst) {
    const x0 = W + 40;
    const r = rng();
    let count = 1;
    if (inBurst) {
      if (speed >= 450 && r < BURST_PAIR) count = 2;
    } else if (speed >= 650 && r < 0.15 + 0.04 * diff()) count = 3;
    else if (speed >= 450 && r < 0.4 + 0.06 * diff()) count = 2;
    if (!inBurst && count === 1 && carsPassed >= ROLL_AFTER && rng() < ROLL_CHANCE + 0.03 * diff()) {
      // 앞 차량과 겹치지 않게 조금 더 뒤에서 등장
      const x = x0 + speed * 0.3;
      const o = addRival(x);
      // 우리 차 위를 지나갈 때까지 다음 차량이 오지 않게 함 (점프해야 하는 상황과 겹치지 않도록)
      return (x - o.jumpAt) / speed + ROLL_TIME + 0.3;
    }
    let x = x0;
    for (let i = 0; i < count; i++) {
      const type = randomType();
      addCar(type, x);
      x += type.w + 30;
    }
    if (count === 1) return 0;
    // 묶음도 한 번에 넘고 가장 늦은 점프 시점은 첫 차량이 정하므로, 최고 속도에서는 착지가 묶음 길이와 거의 무관.
    // 길게 누르기 체공(약 1.25초)이 탭(약 0.99초)보다 긴 만큼만 여유를 둠 → 러시에서도 점프당 허용 폭 0.1초 유지
    // 그보다 느리면 묶음이 지나가는 시간이 길어 묶음 길이만큼 착지 여유를 둠
    if (speed >= MAX_SPEED) return GROUP_PAD;
    return (x - 30 - x0) / speed + 0.45;
  }

  // 난이도 값: 단계가 없으면 0, 있으면 단계 + LEVEL_OFFSET
  function diff() {
    return level ? level + LEVEL_OFFSET : 0;
  }

  // 다음 생성까지 대기 시간. 단계가 있으면 가끔 러시(짧은 간격으로 몰아서 등장 → 긴 휴식) 패턴
  function nextSpawn() {
    const minGap = 0.85 + 120 / speed;
    const d = diff();
    // 터널 출구 배럴롤 착지가 첫 점프를 늦추므로 터널 뒤 첫 차량은 러시로 시작하지 않음
    if (!burst && d && clock - feverEndAt > 1 && rng() < 0.1 + 0.05 * d) burst = Math.min(BURST_MAX, 3 + Math.floor(rng() * (1 + d / 2)));
    if (burst) {
      burst--;
      const extra = spawnObstacle(true);
      if (!burst) return minGap + extra + BURST_REST + rng() * 0.5;
      return minGap + extra + BURST_GAP;
    }
    const extra = spawnObstacle();
    // 단계가 높으면 랜덤 폭이 작아 일반 차량이 끝없이 빠듯하게 이어질 수 있음 → CHAIN_GAP 으로 허용 폭이 쌓여 줄지 않게 함
    return minGap + extra + (d ? CHAIN_GAP : 0) + rng() * 1.1 * Math.max(SPREAD_MIN, 1 - SPREAD_CUT * d);
  }

  // 착지 시 보너스 정산: 아슬아슬 콤보 + 한 번에 여러 대 넘기
  function settleJump() {
    if (!player.jumpClears) return;
    if (player.jumpNear) {
      combo++;
      const bonus = Math.min(combo, MAX_COMBO_BONUS);
      score += bonus;
      popup(combo > 1 ? `아슬아슬! x${combo} +${bonus}` : `아슬아슬! +${bonus}`, '#38bdf8');
    } else {
      combo = 0;
    }
    if (player.jumpClears >= 2) {
      const bonus = player.jumpClears - 1;
      score += bonus;
      popup(`${player.jumpClears === 2 ? 'DOUBLE' : 'TRIPLE'} +${bonus}`, '#fbbf24');
    }
  }

  // ---------- 하이퍼루프 피버타임 ----------

  function inTunnel() {
    return tunnel && player.x >= tunnel.x && player.x < tunnel.x + tunnel.len;
  }

  function startFever() {
    // 이미 화면에 나온 차량을 넘고 나서 진입하도록 화면 밖 멀리서 등장
    tunnel = { x: W + 40 + speed * 1.5, len: speed * TUNNEL_TIME };
    burst = 0;
    popup('FEVER TIME!', '#f472b6');
  }

  // 터널 구간의 차량 생성: 입구 직후·출구 착지 구간은 비우고, 안쪽에만 단일 차량(점수 2배)
  // 반환값은 다음 확인까지 대기 시간, 0 이면 터널을 지나 평소대로 생성
  function feverSpawn() {
    const x0 = W + 40;
    const end = tunnel.x + tunnel.len;
    if (x0 < tunnel.x + speed * 0.9) return 0.15;
    if (x0 + 170 < end - 700) {
      // 라이벌도 가끔 등장하지만 터널 안이라 뛰지 않고 바닥에 붙어 아래로 지나감 (updateRival)
      if (carsPassed >= ROLL_AFTER && rng() < ROLL_CHANCE) addRival(x0);
      else addCar(randomType(), x0);
      obstacles[obstacles.length - 1].fever = true;
      return 0.55 + rng() * 0.7;
    }
    if (x0 < end + speed * (EXIT_TIME + 0.6)) return 0.15;
    feverEndAt = clock;
    tunnel.done = true; // 넓은 화면에서는 아직 출구를 지나기 전일 수 있어 정리는 update 에서
    return 0;
  }

  // 피버 중 입력: 매달려 있으면 그립 유지, 터널 안이면 천장으로 점프. 처리했으면 true
  function feverTap() {
    const m = player.mode;
    if (m === 'ceiling' || m === 'toCeiling') {
      player.lastTap = clock;
      if (m === 'ceiling') sparks(player.x, groundY - TUNNEL_CEIL + 4, 5, '#f8fafc', 100);
      return true;
    }
    if (m) return true; // 추락·착지 중에는 입력 무시
    if (!inTunnel()) return false;
    startClimb();
    return true;
  }

  function startClimb() {
    if (player.onGround) smoke(player.x - 40 * CAR_SCALE, groundY - 6, 8, 40);
    player.mode = 'toCeiling';
    player.modeT = 0;
    player.y0 = player.y;
    player.r0 = player.roll % (Math.PI * 2);
    player.onGround = false;
    player.vy = 0;
    player.lastTap = clock;
    player.jumpClears = 0;
    player.jumpNear = 0;
  }

  function updateFeverPlayer(dt) {
    player.modeT += dt;
    if ((player.mode === 'ceiling' || player.mode === 'toCeiling') && (!tunnel || player.x >= tunnel.x + tunnel.len)) {
      // 출구: 배럴롤로 자동 착지
      player.mode = 'exitRoll';
      player.modeT = 0;
      player.y0 = player.y;
    }
    const ease = (p) => p - Math.sin(2 * Math.PI * p) / (2 * Math.PI);
    if (player.mode === 'toCeiling') {
      const p = Math.min(1, player.modeT / CLIMB_TIME);
      const e = p * p * (3 - 2 * p);
      player.y = player.y0 + (CEIL_Y - player.y0) * e;
      player.roll = player.r0 + (Math.PI - player.r0) * e;
      if (p >= 1) {
        player.mode = 'ceiling';
        player.lastTap = clock;
        sparks(player.x, groundY - TUNNEL_CEIL + 4, 12, '#f8fafc');
      }
    } else if (player.mode === 'ceiling') {
      player.y = CEIL_Y;
      player.roll = Math.PI;
      if (clock - player.lastTap > GRIP_TIME) {
        player.mode = 'falling';
        player.vy = 0;
        popup('연타 실패!', '#ef4444');
      }
    } else if (player.mode === 'falling') {
      player.vy -= GRAVITY * dt;
      player.y += player.vy * dt;
      if (player.y <= 0) {
        player.y = 0;
        gameOver(); // 뒤집힌 채로 도로에 추락
      }
    } else if (player.mode === 'exitRoll') {
      // 뒤집힌 상태(π)에서 1.5바퀴 돌며 작은 포물선으로 내려와 바로 선 채 착지
      const p = Math.min(1, player.modeT / EXIT_TIME);
      player.y = player.y0 * (1 - p) + 160 * p * (1 - p);
      player.roll = Math.PI + Math.PI * 3 * ease(p);
      if (p >= 1) {
        player.mode = null;
        player.y = 0;
        player.vy = 0;
        player.roll = 0;
        player.onGround = true;
        player.smokeTimer = 0.45;
        flips++;
        score += FEVER_BONUS;
        popup(`하이퍼루프 클리어! +${FEVER_BONUS}`, '#f472b6');
        smoke(player.x, groundY - 4, 26, 100 * CAR_SCALE);
      }
    }
  }

  // 게임 1스텝(STEP초). 게임 중이 아니어도 시계·달 주기는 계속 감
  function simStep() {
    const dt = STEP;
    clock += dt;
    // 달이 한 주기를 돌 때마다(삭) 피버타임 판정
    const cycle = Math.floor(clock / MOON_CYCLE + 0.1);
    const newMoon = cycle !== moonCycle;
    moonCycle = cycle;
    if (state !== 'playing') return;
    simSteps++;
    if (newMoon && score >= FEVER_SCORE && !tunnel) startFever();
    const lv = score < LEVEL_SCORE ? 0 : Math.min(MAX_LEVEL, 1 + Math.floor((score - LEVEL_SCORE) / LEVEL_STEP));
    if (lv > level) level = lv; // 단계는 화면에 표시하지 않고 난이도에만 반영
    if (tunnel) {
      tunnel.x -= speed * dt;
      // 출구 뒤 비우는 구간(feverSpawn)과 출구 착지가 모두 끝나고 출구가 화면 밖으로 나가면 정리
      if (tunnel.done && !player.mode && tunnel.x + tunnel.len < -100) tunnel = null;
    }

    speed = Math.min(MAX_SPEED, speed + SPEED_GAIN * dt);
    distance += speed * dt;

    // 일반 점프 중 터널에 들어가면 자동으로 천장에 매달림 (이후 연타 필요)
    if (!player.mode && !player.onGround && inTunnel()) startClimb();
    if (player.mode) {
      updateFeverPlayer(dt);
      if (state !== 'playing') return;
    } else if (!player.onGround) {
      player.airTime += dt;
      const boost = holding && player.vy > 0 && player.airTime < HOLD_MAX;
      player.vy -= GRAVITY * (boost ? HOLD_GRAVITY : 1) * dt;
      player.y += player.vy * dt;
      // 배럴롤: 이륙 직후 천천히 → 정점 부근에서 빠르게 → 착지 전 다시 천천히 정렬
      const p = Math.min(1, player.airTime / airDuration());
      const eased = p - Math.sin(2 * Math.PI * p) / (2 * Math.PI);
      player.roll = Math.PI * 2 * ROLLS_PER_JUMP * eased;
      if (player.y <= 0) {
        player.y = 0;
        player.vy = 0;
        player.roll = 0;
        player.onGround = true;
        player.smokeTimer = 0.45;
        flips++;
        settleJump();
        smoke(player.x, groundY - 4, 26, 100 * CAR_SCALE);
      }
    } else if (player.smokeTimer > 0) {
      // 착지 직후 잠깐 이어지는 타이어 연기
      player.smokeTimer -= dt;
      smoke(player.x - 32 * CAR_SCALE, groundY - 4, 2, 20);
    }

    spawnTimer -= dt;
    if (spawnTimer <= 0) {
      const wait = tunnel ? feverSpawn() : 0;
      spawnTimer = wait || nextSpawn();
    }

    for (const o of obstacles) {
      o.x -= speed * dt;
      if (o.rival) updateRival(o, dt);
      // 라이벌은 판정 범위가 우리 차 뒤로 완전히 벗어난 뒤에 통과 처리 (보너스 표시 후 충돌하는 일이 없도록)
      const behind = o.rival ? o.x + o.w * 0.92 < player.x - 44 * CAR_SCALE : o.x + o.w < player.x - 45;
      if (!o.passed && behind) {
        o.passed = true;
        carsPassed++;
        const pts = o.type.points * (o.fever ? 2 : 1);
        score += pts;
        if (o.rival && !o.sky) popup(`안전운전 +${pts}점`, o.fever ? '#f472b6' : '#facc15');
        else if (o.fever) popup(`FEVER +${pts}`, '#f472b6');
        if (!player.onGround && (!o.rival || o.sky)) { // 하늘색 라이벌은 일반 차량처럼 뛰어넘음
          player.jumpClears++;
          if (o.minClear < NEAR_MISS) player.jumpNear++;
        }
      }
    }
    obstacles = obstacles.filter((o) => o.x + o.w > -50);

    // 충돌 판정 (회전 중인 차체를 감안해 박스를 조금 줄임). 높이는 도로 기준이라 화면 높이와 무관
    const half = 44 * CAR_SCALE;
    const px1 = player.x - half, px2 = player.x + half;
    for (const o of obstacles) {
      if (o.rival && o.hop > 0) {
        // 공중의 라이벌: 높이 구간 [hop, hop + 차 높이]와 우리 차 [y, y + PLAYER_H]가 겹치면 공중 충돌
        if (px2 > o.x + o.w * 0.08 && px1 < o.x + o.w * 0.92
          && player.y + PLAYER_H > o.hop && player.y < o.hop + o.h * (1 - o.type.hitTop)) {
          gameOver();
          break;
        }
        continue;
      }
      // 이미지 여백을 감안해 좌우 8%, 위쪽 hitTop 비율만큼 판정 제외
      const oTop = o.h * (1 - o.type.hitTop);
      if (px2 > o.x + o.w * 0.08 && px1 < o.x + o.w * 0.92) {
        o.minClear = Math.min(o.minClear, player.y - oTop); // 차량 위 여유 높이 (아슬아슬 판정)
        if (player.y < oTop) {
          gameOver();
          break;
        }
      }
    }
    itemTick();
    if (state === 'playing' && score >= MAX_SCORE) gameClear();
  }

  function gameOver() {
    state = 'over';
    onGameOver();
  }

  // 만점 달성: 점수를 만점으로 맞추고 게임 종료 + 축하 화면
  function gameClear() {
    score = MAX_SCORE;
    cleared = true;
    state = 'over';
    onGameClear();
  }

  const ITEM_EVERY = 50;
  const ITEM_MAX = 3;
  const ATTACK_TIME = 3;   // 화이트아웃·안개 지속 시간(초)
  const SHIELD_TIME = 8;   // 방어막 지속 시간(초)
  const ITEM_INFO = {
    white: { icon: '⚪', name: '화이트아웃' },  // 상대 배경을 흰색으로
    fog: { icon: '🌫️', name: '안개' },          // 상대 차 앞에 안개
    mint: { icon: '🚙', name: '민트 라이벌' },  // 상대에게 뛰어넘어 오는 민트 라이벌
    sky: { icon: '🚘', name: '하늘 라이벌' },   // 상대에게 뛰지 않는 하늘색 라이벌
    shield: { icon: '🛡️', name: '방어막' },    // 받은 공격 제거 + 일정 시간 공격 막기
  };
  const ITEM_KINDS = Object.keys(ITEM_INFO);
  let items = [], nextItemAt = ITEM_EVERY, whiteUntil = 0, fogUntil = 0, shieldUntil = 0;
  let whiteFrom = 0, fogFrom = 0; // 효과가 시작된 시각 (겹쳐서 늘어나도 시작 페이드는 한 번만)
  let simItems = false; // 이번 판이 아이템전인지 (시작할 때 정함)

  function resetItems() {
    items = [];
    nextItemAt = ITEM_EVERY;
    whiteUntil = fogUntil = shieldUntil = whiteFrom = fogFrom = 0;
  }

  function itemTick() {
    if (!simItems) return;
    while (score >= nextItemAt) {
      nextItemAt += ITEM_EVERY;
      if (items.length >= ITEM_MAX) continue;
      const k = ITEM_KINDS[Math.floor(rng() * ITEM_KINDS.length)];
      items.push(k);
      feedPush(`🎁 ${ITEM_INFO[k].icon} ${ITEM_INFO[k].name} 획득`, '#a78bfa');
    }
  }

  // 아이템 사용: 칸에서 빼고, 방어막이면 나에게 적용 (공격 전송은 useItem 에서)
  function useItemEffect(i) {
    const k = items[i];
    if (!k) return;
    items.splice(i, 1);
    if (k !== 'shield') return;
    // 지금 받은 공격 제거: 화이트아웃·안개 끝내고, 아직 다가오는 공격 차량은 치움 (머리 위를 넘는 중인 라이벌은 그대로)
    whiteUntil = fogUntil = 0;
    obstacles = obstacles.filter((o) => !o.attack || o.passed || (o.rival && o.t >= 0 && !o.landed) || o.x < player.x + 60 * CAR_SCALE);
    // 방어막 중에 또 쓰면 남은 시간에 더함
    shieldUntil = Math.max(shieldUntil, clock) + SHIELD_TIME;
  }

  // 받은 공격 적용. 알림 문구용 결과를 돌려줌
  function attackEffect(kind) {
    if (clock < shieldUntil) return { blocked: true };
    if (kind === 'white' || kind === 'fog') {
      // 이미 같은 효과 중이면 남은 시간에 ATTACK_TIME 을 더함
      const until = kind === 'white' ? whiteUntil : fogUntil;
      const stacked = clock < until;
      const next = (stacked ? until : clock) + ATTACK_TIME;
      if (kind === 'white') { if (!stacked) whiteFrom = clock; whiteUntil = next; }
      else { if (!stacked) fogFrom = clock; fogUntil = next; }
      return { stacked, left: next - clock };
    }
    // 라이벌은 받을 때마다 한 대씩 더 (앞 라이벌 뒤에 차례로 배치)
    forceRival(kind === 'sky');
    return { n: obstacles.filter((o) => o.attack && !o.passed && !!o.sky === (kind === 'sky')).length };
  }

  // 공격으로 라이벌을 바로 등장시킴. 이미 오고 있는 차량을 다 지난 뒤에 오게 하고, 다음 차량도 그만큼 늦춰
  // 피할 수 없는 배치는 만들지 않음 (점프 착지 여유 GAP 초)
  function forceRival(sky) {
    const GAP = 0.9;
    // 각 차량이 내 차를 다 지나가는 시각(초 후)
    const done = (o) => o.rival && !o.sky ? (o.x - o.jumpAt) / speed + ROLL_TIME + 0.3 : (o.x + o.w - player.x) / speed;
    let t = 0;
    for (const o of obstacles) if (!o.passed && !(o.rival && o.t >= 0)) t = Math.max(t, done(o));
    const x = Math.max(W + 40, player.x + speed * (t + GAP));
    const o = addRival(x);
    o.attack = true;
    if (sky) {
      o.sky = true;
      o.type = SKY_RIVAL;
      o.landed = true; // 뛰지 않음
    }
    // 다음 일반 차량은 이 라이벌이 지나간 뒤에 오도록
    spawnTimer = Math.max(spawnTimer, done(o) + GAP - (W + 40 - player.x) / speed);
    burst = 0;
  }

  const RIVAL = { name: 'rival', w: Math.round(106 * CAR_SCALE), h: Math.round(36 * CAR_SCALE), hitTop: 0.25, points: 3 }; // 통과 시 '안전운전' 보너스 3점
  const SKY_RIVAL = { ...RIVAL, name: 'sky', points: 1 };

  function updateRival(o, dt) {
    o.wheel += speed * dt / 14;
    if (o.landed) return;
    if (o.t < 0) {
      if (o.x > o.jumpAt) return;
      // 터널 안에서는 천장 때문에 뛰지 않고 바닥에 붙어 그대로 지나감
      if (tunnel && o.x < tunnel.x + tunnel.len && o.x + o.w > tunnel.x) {
        o.landed = true;
        return;
      }
      o.t = 0; // 이륙
      smoke(o.x + o.w / 2, groundY - 4, 10, o.w * 0.6);
    }
    o.t += dt;
    const p = Math.min(1, o.t / ROLL_TIME);
    o.p = p;
    o.x = o.jumpAt + (o.land - o.jumpAt) * p;
    // 포물선 궤적 + 플레이어 배럴롤과 같은 이징(천천히 → 정점 부근 빠르게 → 착지 전 천천히) + 기수 들림
    o.hop = 4 * o.peak * p * (1 - p);
    o.roll = Math.PI * 2 * (p - Math.sin(2 * Math.PI * p) / (2 * Math.PI));
    o.pitch = Math.atan2(4 * o.peak * (1 - 2 * p) / ROLL_TIME, speed) * 0.35;
    if (p >= 1) {
      o.landed = true;
      o.hop = 0;
      o.roll = 0;
      o.pitch = 0;
      smoke(o.x + o.w / 2, groundY - 4, 18, o.w);
    }
  }

  return {
    STEP, ITEM_MAX, ATTACKS: ITEM_KINDS.filter((k) => k !== 'shield'),
    run(seed, r) {
      W = r.w;
      clock = r.c;
      holding = !!r.h;
      simStart(seed, !!r.it);
      const ev = r.ev;
      let i = 0;
      while (state === 'playing' && simSteps < r.n) {
        while (i < ev.length && ev[i][0] === simSteps) { applyInput(ev[i][1], ev[i][2]); i++; }
        simStep();
      }
      return { over: state === 'over', score, steps: simSteps, used: i };
    },
    // 테스트용: 직접 한 판 하기 (브라우저와 같은 함수로 입력·스텝 → replay 기록)
    play: {
      start(seed, w, items = false) { W = w; simStart(seed, items); },
      input: (c, a) => simInput(c, a),
      step: () => simStep(),
      get: () => ({ state, score, player, obstacles, speed, clock, items, simSteps, replay, holding, inTunnel: inTunnel(), CAR_SCALE, HOLD_MAX }),
    },
  };
}

const num = (v, lo, hi) => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;

// seed: 서버가 준 시드, r: 클라이언트가 보낸 리플레이 { w, c, h, it, n, ev }
// 결과: { ok: true, score, simMs } 또는 { ok: false, reason }
export function verifyReplay(seed, r) {
  const g = createGame();
  const bad = (reason) => ({ ok: false, reason });
  if (!r || typeof r !== 'object' || !Array.isArray(r.ev)) return bad('replay');
  if (!num(r.w, 800, 10000) || !num(r.c, 0, 1e7) || !Number.isInteger(r.n) || !num(r.n, 1, LIMITS.maxSteps)) return bad('replay');
  if (r.ev.length > LIMITS.maxEvents) return bad('replay');
  let prev = 0, attacks = 0;
  for (const e of r.ev) {
    if (!Array.isArray(e) || !Number.isInteger(e[0]) || e[0] < prev || e[0] >= r.n) return bad('replay');
    prev = e[0];
    const [, c, a] = e;
    if (c === 'H' || c === 'R' || c === 'T' || c === 'G') { if (e.length !== 2) return bad('replay'); }
    else if (c === 'W') { if (e.length !== 3 || !num(a, 800, 10000)) return bad('replay'); }
    else if (c === 'I') { if (!r.it || e.length !== 3 || !Number.isInteger(a) || a < 0 || a >= g.ITEM_MAX) return bad('replay'); }
    else if (c === 'A') { if (!r.it || e.length !== 3 || !g.ATTACKS.includes(a)) return bad('replay'); attacks++; }
    else return bad('replay');
  }
  if (attacks > LIMITS.attacksBase + (r.n * g.STEP / 60) * LIMITS.attacksPerMin) return bad('replay');
  const res = g.run(seed | 0, r);
  // 기록한 스텝에서 정확히 게임이 끝나고 모든 입력이 쓰였어야 함
  if (!res.over || res.steps !== r.n || res.used !== r.ev.length) return bad('mismatch');
  return { ok: true, score: res.score, simMs: Math.round(r.n * g.STEP * 1000) };
}
