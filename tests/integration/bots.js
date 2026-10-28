// 컴퓨터 상대 통합 테스트
// 방 A(아이템전): 사람 2 + 컴퓨터 2(보통·어려움) / 방 B(노템전): 사람 1 + 컴퓨터 3(쉬움·보통·어려움, 가득 참)
// → 방 B 에 사람이 더 들어오면 컴퓨터 1대가 자리를 비켜 줌 → 두 방 동시에 2라운드
// → 방 B 방장이 나가면 컴퓨터도 사라짐
// 사용법: server.js · relay.js 를 켠 상태에서 node bots.js (또는 npm run test:bots)
const { chromium } = require('playwright');
const BASE = 'http://localhost:9200/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(ok ? 'PASS' : 'FAIL', name, detail); };

(async () => {
  const browser = await chromium.launch({ args: ['--disable-renderer-backgrounding', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows'] });
  const errors = [];
  const users = {};
  async function user(name, url = BASE, vp = { width: 640, height: 480 }) {
    const ctx = await browser.newContext({ viewport: vp });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
    await page.goto(url);
    await page.evaluate(() => { window.__bot = true; window.__noPause = true; window.__botLead = 0.08; });
    users[name] = { name, page, ctx };
    return users[name];
  }
  const dbg = (u) => u.page.evaluate(() => window.__dbg());
  async function create(name, btn) {
    const u = await user(name);
    await u.page.click('#mode-multi'); await u.page.fill('#mp-name', name); await u.page.click('#mp-next'); await u.page.click(btn);
    await u.page.waitForSelector('#room:not([hidden])');
    u.code = (await u.page.textContent('#room-code')).match(/코드 (\w+)/)[1];
    return u;
  }
  async function join(name, code) {
    const u = await user(name, `${BASE}?room=${code}`);
    await u.page.fill('#mp-name', name); await u.page.click('#mp-next');
    await u.page.waitForSelector('#room:not([hidden])');
    return u;
  }
  async function addBot(host, level) {
    await host.page.selectOption('#room-bot-level', level);
    await host.page.click('#room-bot-add');
    await sleep(400);
  }

  const A = await create('A방장', '#mp-create-item');
  const A2 = await join('A손님', A.code);
  await addBot(A, 'normal'); await addBot(A, 'hard');
  const B = await create('B방장', '#mp-create-normal');
  await addBot(B, 'easy'); await addBot(B, 'normal'); await addBot(B, 'hard');
  await sleep(800);

  for (const u of [A, A2]) {
    const d = await dbg(u);
    check(`${u.name}: 방 A 에 컴퓨터 2대 보임`, d.players.length === 4 && d.players.filter((p) => p.name.startsWith('컴퓨터')).length === 2, d.players.map((p) => p.name).join(','));
  }
  {
    const d = await dbg(B);
    check('방 B 가득 참 (사람 1 + 컴퓨터 3), 컴퓨터 추가 칸 숨김', d.players.length === 4 && await B.page.isHidden('#room-botrow'), d.players.map((p) => p.name).join(','));
  }
  // 방 목록
  const V = await user('구경꾼'); await V.page.click('#mode-multi'); await V.page.fill('#mp-name', '구경꾼'); await V.page.click('#mp-next'); await sleep(1000);
  const lobby = (await dbg(V)).lobby;
  check('방 목록에 컴퓨터 포함 인원', lobby.some((l) => l.includes('A방장') && l.includes('4/4')) && lobby.some((l) => l.includes('B방장') && l.includes('4/4')), JSON.stringify(lobby));
  await V.ctx.close();

  // 가득 찬 방 B 에 사람이 들어오면 컴퓨터가 자리를 비켜 줌
  const B2 = await join('B손님', B.code);
  await sleep(1200);
  {
    const d = await dbg(B2), h = await dbg(B);
    check('사람이 들어오면 컴퓨터 1대가 자리 비킴', d.players.length === 4 && d.players.filter((p) => p.name.startsWith('컴퓨터')).length === 2 && h.players.length === 4, d.players.map((p) => p.name).join(','));
  }

  for (let round = 1; round <= 2; round++) {
    await A.page.waitForSelector('#room-start:not([disabled])', { timeout: 60000 });
    await B.page.waitForSelector('#room-start:not([disabled])', { timeout: 60000 });
    await A.page.click('#room-start'); await B.page.click('#room-start');
    await sleep(4000);
    // 모두 끝날 때까지 (사람·컴퓨터)
    const t0 = Date.now();
    for (const u of [A, A2, B, B2]) await u.page.evaluate(() => { window.__bot = true; });
    let autoOff = false;
    for (;;) {
      // 사람 자동 플레이는 90초 뒤 끄고 마무리 (컴퓨터는 사람이 모두 끝나면 스스로 빨리 끝남)
      if (!autoOff && Date.now() - t0 > 90000) { autoOff = true; for (const u of [A, A2, B, B2]) await u.page.evaluate(() => { window.__bot = false; }); }
      const all = await Promise.all([A, A2, B, B2].map(dbg));
      if (all.every((d) => d.state === 'over') && all.every((d) => d.players.every((p) => p.status === 'over'))) break;
      if (Date.now() - t0 > 240000) { console.log('시간 초과'); break; }
      await sleep(2000);
    }
    await sleep(2500);
    for (const [label, host, guest] of [['A', A, A2], ['B', B, B2]]) {
      const h = await dbg(host), g = await dbg(guest);
      const bots = h.players.filter((p) => p.name.startsWith('컴퓨터'));
      check(`${round}R 방 ${label}: 컴퓨터가 실제로 달려 점수를 냄`, bots.every((p) => p.status === 'over') && bots.some((p) => p.score > 0), bots.map((p) => `${p.name}:${p.score}`).join(' '));
      const mism = bots.filter((p) => (g.players.find((q) => q.id === p.id) || {}).score !== p.score);
      check(`${round}R 방 ${label}: 손님 화면의 컴퓨터 점수 = 방장 화면`, mism.length === 0, mism.map((p) => p.name).join(','));
      const scores = h.players.map((p) => (p.name === h.name ? { ...p, score: h.score } : p.name === g.name ? { ...p, score: g.score } : p));
      for (const d of [h, g]) {
        const want = 1 + scores.filter((p) => p.name !== d.name && p.score > d.score).length;
        check(`${round}R 방 ${label}: ${d.name} 순위에 컴퓨터 포함`, d.rank && d.rank.n === 4 && d.rank.rank === want, `${JSON.stringify(d.rank)} 기대 ${want}등 / ${scores.map((p) => `${p.name}:${p.score}`).join(' ')}`);
      }
      const fromBots = [...h.hits, ...g.hits].filter((x) => x.from.startsWith('컴퓨터')).length;
      if (label === 'A') check(`${round}R 방 A(아이템전): 컴퓨터의 공격이 사람에게 옴`, fromBots > 0, `${fromBots}건`);
      else check(`${round}R 방 B(노템전): 공격 없음`, h.hits.length + g.hits.length === 0, `${h.hits.length + g.hits.length}건`);
      for (const u of [host, guest]) await u.page.evaluate(() => { window.__hits = []; });
    }
  }
  await B.page.screenshot({ path: `${__dirname}/shot-bots-B.png` });
  await A2.page.screenshot({ path: `${__dirname}/shot-bots-A.png` });

  // 방 B 방장이 나가면 컴퓨터도 사라짐
  await B.page.click('#room-leave');
  await sleep(1500);
  {
    const d = await dbg(B2);
    check('방장이 나가면 컴퓨터도 사라짐', d.players.length === 1 && d.players[0].name === 'B손님', d.players.map((p) => p.name).join(','));
  }
  check('자바스크립트 오류 없음', errors.length === 0, errors.slice(0, 3).join(' | '));
  const fails = results.filter((r) => !r.ok).length;
  console.log('PASS', results.length - fails, 'FAIL', fails);
  await browser.close();
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
