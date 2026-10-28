// 통합 테스트: 여러 방 · 많은 사용자 · 실제 게임 진행
// 방 6개 (아이템전 4개 x 4명, 노템전 2개 x 3명) = 22명 + 방 목록만 보는 사람 2명
// 1라운드: 동시에 시작 → 중간 입장(노템전 방), 창 그냥 닫기(유령), 가득 찬 방 입장 시도
// 2라운드: 방장 나가기(방장 넘김) 후 모든 방 다시 시작 (유령이 남아 있는 방도 시작 가능해야 함)
// 라운드마다 점수 동기화·순위·방 격리·랭킹 등록·오류·프레임·메시지량 확인
const { chromium } = require('playwright');
const fs = require('fs');
const BASE = 'http://localhost:9200/';
const ROUND_CAP = Number(process.env.ROUND_CAP || 130) * 1000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

const results = []; // { check, ok, detail }
function check(name, ok, detail = '') { results.push({ name, ok, detail }); log(ok ? 'PASS' : 'FAIL', name, detail); }

(async () => {
  const args = ['--disable-renderer-backgrounding', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows'];
  const browsers = await Promise.all([0, 1, 2].map(() => chromium.launch({ args })));
  let bi = 0;
  const users = []; // { name, page, room(expected label), errors }
  const errors = [];
  async function newUser(name, url = BASE) {
    const b = browsers[bi++ % browsers.length];
    const ctx = await b.newContext({ viewport: { width: 480, height: 360 } });
    const page = await ctx.newPage();
    const u = { name, page, ctx, errors: [] };
    page.on('pageerror', (e) => { u.errors.push(e.message); errors.push(`${name}: ${e.message}`); });
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(`${name} console: ${m.text()}`); });
    await page.goto(url);
    await page.evaluate((lead) => { window.__bot = true; window.__noPause = true; window.__botLead = lead; }, 0.07 + Math.random() * 0.03);
    users.push(u);
    return u;
  }
  const dbg = (u) => u.page.evaluate(() => window.__dbg());
  async function enterName(u) { await u.page.fill('#mp-name', u.name); await u.page.click('#mp-next'); }

  // ---------- 1. 방 만들기 ----------
  const roomsSpec = [
    { label: 'R1', mode: 'item', size: 4 }, { label: 'R2', mode: 'item', size: 4 },
    { label: 'R3', mode: 'item', size: 4 }, { label: 'R4', mode: 'item', size: 4 },
    { label: 'R5', mode: 'normal', size: 3 }, { label: 'R6', mode: 'normal', size: 3 },
  ];
  const rooms = [];
  for (const spec of roomsSpec) {
    const host = await newUser(`${spec.label}-방장`);
    await host.page.click('#mode-multi'); await enterName(host);
    await host.page.click(spec.mode === 'item' ? '#mp-create-item' : '#mp-create-normal');
    await host.page.waitForSelector('#room:not([hidden])');
    const code = (await host.page.textContent('#room-code')).match(/코드 (\w+)/)[1];
    host.room = spec.label;
    rooms.push({ ...spec, code, members: [host], hostName: host.name });
  }
  log('rooms', rooms.map((r) => `${r.label}=${r.code}(${r.mode})`).join(' '));

  // ---------- 2. 입장: 절반은 방 목록에서 골라서, 절반은 초대 링크로 ----------
  let n = 0;
  for (const r of rooms) {
    for (let i = 1; i < r.size; i++) {
      const name = `${r.label}-${i}`;
      if (n++ % 2 === 0) {
        const u = await newUser(name);
        await u.page.click('#mode-multi'); await enterName(u);
        const btn = u.page.locator('#mp-rooms button', { hasText: `👑 ${r.hostName}` });
        await btn.waitFor({ timeout: 15000 });
        await btn.click();
        await u.page.waitForSelector('#room:not([hidden])', { timeout: 15000 });
        u.room = r.label; u.via = 'lobby'; r.members.push(u);
      } else {
        const u = await newUser(name, `${BASE}?room=${r.code}`);
        await enterName(u);
        await u.page.waitForSelector('#room:not([hidden])', { timeout: 15000 });
        u.room = r.label; u.via = 'invite'; r.members.push(u);
      }
    }
  }
  await sleep(1500);

  // 방 목록만 보는 사람 2명
  const viewers = [await newUser('구경꾼1'), await newUser('구경꾼2')];
  for (const v of viewers) { await v.page.click('#mode-multi'); await enterName(v); }
  await sleep(1500);
  {
    const list = (await dbg(viewers[0])).lobby;
    const okAll = rooms.every((r) => list.some((l) => l.includes(`👑 ${r.hostName}`) && l.includes(`${r.size}/4`) && l.includes(r.mode === 'item' ? '아이템전' : '노템전')));
    check('방 목록: 6개 방이 방장·인원·모드와 함께 보임', okAll && list.length === 6, JSON.stringify(list));
  }

  // 가득 찬 방(R1) 에 5번째 사람이 초대 링크로 들어오려 함
  {
    const extra = await newUser('R1-초과', `${BASE}?room=${rooms[0].code}`);
    await enterName(extra);
    await sleep(3000);
    const msg = await extra.page.textContent('#mp-msg');
    const inRoom = await extra.page.isVisible('#room');
    check('가득 찬 방 입장 거절', !inRoom && /가득/.test(msg), `msg="${msg}"`);
    const r1 = await dbg(rooms[0].members[0]);
    check('가득 찬 방 인원 그대로 4명', r1.players.length === 4, r1.players.map((p) => p.name).join(','));
    await extra.page.click('#mp-close').catch(() => {});
  }

  // 방마다 참가자 목록 확인
  for (const r of rooms) {
    const want = r.members.map((m) => m.name).sort().join(',');
    let ok = true; const seen = [];
    for (const m of r.members) {
      const got = (await dbg(m)).players.map((p) => p.name).sort().join(',');
      seen.push(got); if (got !== want) ok = false;
    }
    check(`${r.label} 참가자 목록 일치 (${r.members.length}명)`, ok, ok ? want : JSON.stringify(seen));
  }

  // ---------- 라운드 진행 ----------
  async function playRound(no, events = async () => {}) {
    log(`===== ${no}라운드 시작 =====`);
    const t0 = Date.now();
    for (const u of users) if (!u.closed) await u.page.evaluate(() => { window.__bot = true; });
    for (const r of rooms) {
      const host = r.members.find((m) => m.name === r.hostName);
      await host.page.waitForSelector('#room-start:not([disabled])', { timeout: 30000 });
      await host.page.click('#room-start');
    }
    await sleep(4000);
    const eventsDone = events(t0);
    // 진행 중 프레임 측정
    const f0 = await Promise.all(users.filter((u) => !u.closed).map(async (u) => [u, (await dbg(u)).frames]));
    await sleep(10000);
    const fps = [];
    for (const [u, f] of f0) if (!u.closed) fps.push(((await dbg(u)).frames - f) / 10);
    log(`${no}라운드 프레임: 평균 ${(fps.reduce((a, b) => a + b, 0) / fps.length).toFixed(1)}fps, 최저 ${Math.min(...fps).toFixed(1)}fps (${fps.length}창)`);
    results.push({ name: `${no}라운드 평균 fps`, ok: true, detail: `${(fps.reduce((a, b) => a + b, 0) / fps.length).toFixed(1)} (최저 ${Math.min(...fps).toFixed(1)})` });
    // 모두 끝날 때까지 (너무 길면 봇을 꺼서 마무리)
    let botsOff = false;
    for (;;) {
      const live = users.filter((u) => !u.closed && u.room && rooms.find((r) => r.label === u.room).members.includes(u));
      const states = await Promise.all(live.map(async (u) => (await dbg(u)).state));
      const playing = states.filter((s) => s === 'playing').length;
      if (!playing) break;
      if (!botsOff && Date.now() - t0 > ROUND_CAP) {
        botsOff = true; log(`${playing}명 아직 달리는 중 → 봇 끄고 마무리`);
        for (const u of live) await u.page.evaluate(() => { window.__bot = false; });
      }
      await sleep(2000);
    }
    await eventsDone;
    log(`${no}라운드 종료 (${((Date.now() - t0) / 1000).toFixed(0)}초)`);
    await sleep(3000); // 마지막 점수 전달 기다림
    await verifyRound(no);
  }

  const submitsBefore = { n: 0 };
  async function verifyRound(no) {
    const submits = await (await fetch(BASE + '__submits')).json();
    const newSubs = submits.slice(submitsBefore.n); submitsBefore.n = submits.length;
    for (const r of rooms) {
      const members = r.members.filter((m) => !m.closed);
      const ds = await Promise.all(members.map(dbg));
      const truth = Object.fromEntries(ds.map((d) => [d.name, d.score]));
      const played = ds.filter((d) => d.state === 'over');
      // a. 서로 보는 점수가 실제 점수와 같은지
      const mism = [];
      for (const d of ds) for (const p of d.players) if (p.name in truth && p.name !== d.name && played.some((q) => q.name === p.name) && p.score !== truth[p.name]) mism.push(`${d.name}가 본 ${p.name}=${p.score}(실제 ${truth[p.name]})`);
      check(`${no}R ${r.label} 점수 동기화`, mism.length === 0, mism.join('; ') || Object.entries(truth).map(([k, v]) => `${k}:${v}`).join(' '));
      // b. 순위
      const rankBad = [];
      for (const d of played) {
        // 같은 방에서 이번 판을 끝낸 사람: 접속 중인 사람 + 끝내고 창을 닫았지만 아직 목록에 남은 사람
        const finished = d.players.filter((q) => q.status === 'over').map((q) => ({ name: q.name, score: q.name in truth ? truth[q.name] : q.score }));
        const want = 1 + finished.filter((q) => q.name !== d.name && q.score > d.score).length;
        if (!d.rank || d.rank.rank !== want || d.rank.alive !== 0) rankBad.push(`${d.name}: ${JSON.stringify(d.rank)} 기대 ${want}등`);
      }
      check(`${no}R ${r.label} 최종 순위`, rankBad.length === 0, rankBad.join('; ') || played.map((d) => `${d.name}=${d.rank.rank}등`).join(' '));
      // c. 방 격리: 받은 공격은 전부 같은 방에서
      const names = new Set(r.members.map((m) => m.name));
      const leak = [];
      let hitCount = 0;
      for (const d of ds) for (const h of d.hits) { hitCount++; if (h.room !== h.myRoom || h.room !== r.code || !names.has(h.from)) leak.push(`${d.name}<-${h.from}(${h.room})`); }
      check(`${no}R ${r.label} 다른 방과 간섭 없음`, leak.length === 0, leak.join(', ') || `받은 공격 알림 ${hitCount}건 모두 같은 방`);
      // d. 1등 확정(다른 사람이 모두 끝나고 앞섬)으로 끝난 사람은 그 방 단독 1등
      const winBad = played.filter((d) => d.won && played.some((q) => q.name !== d.name && q.score >= d.score)).map((d) => d.name);
      check(`${no}R ${r.label} 1등 확정 종료`, winBad.length === 0, winBad.join(', ') || (played.filter((d) => d.won).map((d) => `${d.name}=${d.score}점 1등 확정`).join(' ') || '1등 확정 없음'));
      if (r.mode === 'item') {
        const items = ds.reduce((a, d) => a + d.items.length, 0);
        // 아이템은 ITEM_EVERY(50)점마다 생기므로 모두 그 전에 끝났으면 주고받을 게 없음
        // (예전에는 혼자 남은 사람이 계속 달려 아이템을 모았지만, 지금은 앞서면 1등 확정으로 바로 끝남)
        const anyItem = ds.some((d) => d.score >= 50);
        check(`${no}R ${r.label} 아이템전 공격 오감 (상대가 남아 있었을 때)`, hitCount > 0 || items > 0 || !anyItem, `받은 공격 ${hitCount}건, 쓰지 못한 아이템 ${items}개${anyItem ? '' : ' (모두 50점 전에 끝남)'}`);
      }
      else check(`${no}R ${r.label} 노템전 아이템 없음`, hitCount === 0 && ds.every((d) => d.items.length === 0), `${hitCount}건`);
      // d. 랭킹 자동 등록
      const missing = played.filter((d) => d.score > 0 && !newSubs.some((s) => s.name === d.name && s.score === d.score)).map((d) => `${d.name}:${d.score}`);
      check(`${no}R ${r.label} 랭킹 자동 등록`, missing.length === 0, missing.length ? `누락 ${missing.join(',')}` : `${played.filter((d) => d.score > 0).length}명 등록`);
    }
    // 다음 라운드를 위해 받은 공격 기록 비움
    for (const u of users) if (!u.closed) await u.page.evaluate(() => { window.__hits = []; });
  }

  // 1라운드 중간 사건
  await playRound(1, async (t0) => {
    await sleep(Math.max(0, t0 + 15000 - Date.now()));
    // 방 목록: 게임 중 표시
    const list = (await dbg(viewers[0])).lobby;
    check('방 목록: 게임 중 표시', rooms.every((r) => list.some((l) => l.includes(`👑 ${r.hostName}`) && l.includes('게임 중'))), JSON.stringify(list));
    // 노템전 R5 에 중간 입장 (3명 → 4명)
    const late = await newUser('R5-중간입장');
    await late.page.click('#mode-multi'); await enterName(late);
    const btn = late.page.locator('#mp-rooms button', { hasText: `👑 ${rooms[4].hostName}` });
    await btn.waitFor({ timeout: 15000 }); await btn.click();
    await late.page.waitForSelector('#room:not([hidden])', { timeout: 15000 });
    late.room = 'R5'; rooms[4].members.push(late);
    await sleep(2000);
    const d = await dbg(late);
    check('게임 중 중간 입장: 대기 상태로 들어와 상대 화면을 봄', d.state === 'ready' && d.players.length === 4 && d.topInset > 0, `state=${d.state} players=${d.players.length} 상대화면=${d.topInset}px`);
    // R2 의 한 명이 창을 그냥 닫음 (유령)
    await sleep(Math.max(0, t0 + 25000 - Date.now()));
    let quitter = null;
    for (let k = 0; k < 20 && !quitter; k++) {
      for (const m of rooms[1].members.slice(1)) if ((await dbg(m)).state === 'playing') { quitter = m; break; }
      if (!quitter) await sleep(500);
    }
    quitter = quitter || rooms[1].members[2];
    rooms[1].quitterName = quitter.name;
    quitter.closed = true;
    await quitter.ctx.close();
    rooms[1].members = rooms[1].members.filter((m) => m !== quitter);
    log(`${quitter.name} 창 닫음 (유령)`);
  });

  // 유령: 아직 접속 정보가 남아 있어도 R2 방장이 2라운드를 시작할 수 있어야 함
  {
    const d = await dbg(rooms[1].members[0]);
    const ghost = d.players.find((p) => p.name === rooms[1].quitterName);
    check('창 닫은 사람(유령)이 목록에 남아 있는 상태', !!ghost && ghost.status === 'playing', `R2 목록: ${d.players.map((p) => `${p.name}(${p.status})`).join(',')}`);
    check('유령이 있어도 방장 시작 가능', d.canStart === true, `canStart=${d.canStart}`);
    const r = d.rank;
    check('유령은 순위의 달리는 중 인원에서 빠짐', r && r.alive === 0, JSON.stringify(r));
  }
  // R3 방장 나가기 → 다음 사람이 방장
  {
    const r3 = rooms[2];
    const oldHost = r3.members.find((m) => m.name === r3.hostName);
    await oldHost.page.click('#room-leave');
    r3.members = r3.members.filter((m) => m !== oldHost); oldHost.room = null;
    await sleep(2000);
    const d = await dbg(r3.members[0]);
    r3.hostName = d.host;
    check('방장 나가면 다음 사람이 방장', !!d.host && d.host !== oldHost.name && d.players.length === 3 && (await Promise.all(r3.members.map(dbg))).every((x) => x.host === d.host), `새 방장 ${d.host}`);
    const list = (await dbg(viewers[1])).lobby;
    check('방 목록에 새 방장·인원 반영', list.some((l) => l.includes(`👑 ${d.host}`) && l.includes('3/4')), JSON.stringify(list));
  }

  await playRound(2);

  // 유령은 결국 목록에서 빠짐 (중계 서버 GHOST_MS 뒤)
  {
    let d;
    for (let k = 0; k < 90; k++) { d = await dbg(rooms[1].members[0]); if (d.players.length === 3) break; await sleep(2000); }
    check('창 닫은 사람은 시간이 지나면 방에서 빠짐', d.players.length === 3, d.players.map((p) => p.name).join(','));
  }

  // ---------- 전체 ----------
  check('모든 창 자바스크립트 오류 없음', errors.length === 0, errors.slice(0, 5).join(' | '));
  // 아이템전(공격·아이템 사용)까지 포함한 모든 판이 서버 리플레이 검증을 통과해야 함
  const { rejects } = await (await fetch(BASE + '__rejects')).json();
  check('랭킹 리플레이 검증 거절 없음', rejects.length === 0, rejects.length ? JSON.stringify(rejects.slice(0, 5)) : `${(await (await fetch(BASE + '__submits')).json()).length}건 모두 통과`);
  const stats = JSON.parse(fs.readFileSync(__dirname + '/relay-stats.json', 'utf8'));
  results.push({ name: '중계 서버 통계', ok: true, detail: `보낸 메시지 ${stats.sent}, 전달 ${stats.delivered}, 초당 최대 전달 ${stats.peakDeliveredPerSec}, 최대 동시 연결 ${stats.peakConns}, 채널별 ${JSON.stringify(stats.byTopic)}` });
  fs.writeFileSync(__dirname + '/results.json', JSON.stringify({ results, stats, errors }, null, 1));
  // 스크린샷 몇 장
  for (const [i, u] of users.filter((x) => !x.closed && x.room).slice(0, 6).entries()) await u.page.screenshot({ path: `${__dirname}/shot-${i}-${u.name}.png` });
  const fails = results.filter((r) => !r.ok).length;
  log('PASS', results.filter((r) => r.ok).length, 'FAIL', fails);
  await Promise.all(browsers.map((b) => b.close()));
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
