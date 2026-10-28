// 혼자 하기 리플레이 검증 테스트: 화면 크기·프레임 속도(CPU 느리게)·게임 중 일시정지·화면 크기 바꾸기를 섞어
// 봇이 여러 판을 하고 랭킹에 등록 → 서버(server.js, 실제 검증 모듈 사용)가 모든 판을 같은 점수로 확인해야 통과
// 사용법: node solo.js [초=120]   (build-test-copy.py 를 먼저 실행하고 server.js 를 켜 둔 상태)
const { chromium } = require('playwright');
const BASE = 'http://localhost:9200/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const CASES = [
  { label: '데스크톱', vp: { width: 1280, height: 720 } },
  { label: '세로 폰', vp: { width: 390, height: 844 } },
  { label: '가로 폰', vp: { width: 844, height: 390 } },
  { label: '초광폭', vp: { width: 2560, height: 900 } },
  { label: 'CPU 4배 느림', vp: { width: 1024, height: 700 }, throttle: 4 },
  { label: '일시정지 섞기', vp: { width: 1100, height: 700 }, pause: true },
  { label: '게임 중 화면 크기 변경', vp: { width: 900, height: 650 }, resize: true },
  { label: '봇 타이밍 빠름', vp: { width: 1280, height: 720 }, lead: 0.14 },
  { label: '사람 확인', vp: { width: 1280, height: 720 }, turnstile: true },
];

(async () => {
  const secs = Number(process.argv[2] || 120);
  const browser = await chromium.launch({ args: ['--disable-renderer-backgrounding', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows'] });
  const errors = [];
  const runs = await Promise.all(CASES.map(async (c) => {
    const ctx = await browser.newContext({ viewport: c.vp });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(`${c.label}: ${e.message}`));
    if (c.throttle) {
      const cdp = await ctx.newCDPSession(page);
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: c.throttle });
    }
    if (c.turnstile) {
      // 가짜 Cloudflare Turnstile: render → execute 하면 토큰을 콜백으로, reset 하면 다시 쓸 수 있음
      await page.addInitScript(() => {
        window.__tsKey = 'test-site-key';
        window.__ts = { render: 0, execute: 0, reset: 0 };
        window.turnstile = {
          render(el, o) { window.__ts.render++; this.o = o; return 'w1'; },
          execute() { window.__ts.execute++; setTimeout(() => this.o.callback('fake-ok'), 50); },
          reset() { window.__ts.reset++; },
        };
      });
    }
    await page.goto(BASE);
    // 일시정지 케이스만 실제로 멈춤 (나머지는 창 전환 자동 일시정지를 꺼 둠)
    await page.evaluate(([lead, pause]) => { window.__bot = true; window.__noPause = !pause; window.__botLead = lead; }, [c.lead || 0.1, !!c.pause]);
    await page.waitForTimeout(1500); // 시드·토큰 미리 받기
    await page.click('#mode-solo');
    const games = [];
    const submit = async (d) => {
      const name = `${c.label.replace(/\s/g, '').slice(0, 6)}${games.length}`;
      if (d.score > 0) {
        await page.fill('#rank-name', name);
        await page.click('#rank-form button');
        await page.waitForFunction(() => document.getElementById('rank-form').hidden || /실패|확인/.test(document.getElementById('rank-msg').textContent), null, { timeout: 15000 }).catch(() => {});
      }
      games.push({ name, score: d.score, msg: await page.textContent('#rank-msg') });
    };
    const end = Date.now() + secs * 1000;
    let k = 0;
    while (Date.now() < end) {
      await sleep(700);
      k++;
      const d = await page.evaluate(() => window.__dbg());
      if (d.state === 'playing') {
        if (c.pause && k % 4 === 0) {
          await page.keyboard.press('p'); await sleep(400 + Math.random() * 600);
          if (!(await page.evaluate(() => window.__paused()))) throw new Error('일시정지 안 됨');
          await page.keyboard.press('p');
        }
        if (c.resize && k % 5 === 0) await page.setViewportSize(k % 10 ? { width: 700, height: 600 } : c.vp);
        continue;
      }
      if (d.state !== 'over') continue;
      await submit(d);
      await page.click('#over-solo');
    }
    // 시간이 다 되면 봇을 꺼서 마지막 판도 끝내고 등록
    await page.evaluate(() => { window.__bot = false; });
    await page.waitForFunction(() => window.__dbg().state === 'over', null, { timeout: 30000 }).catch(() => {});
    const d = await page.evaluate(() => window.__dbg());
    if (d.state === 'over') await submit(d);
    const ts = c.turnstile ? await page.evaluate(() => window.__ts) : null;
    await ctx.close();
    return { c, games, ts };
  }));
  await browser.close();

  const submits = await (await fetch(BASE + '__submits')).json();
  const { rejects } = await (await fetch(BASE + '__rejects')).json();
  let pass = 0, fail = 0;
  for (const { c, games, ts } of runs) {
    const scored = games.filter((g) => g.score > 0);
    const missing = scored.filter((g) => !submits.some((s) => s.name === g.name && s.score === g.score));
    // 사람 확인: 위젯은 한 번만 만들고, 등록할 때마다 확인 (두 번째부터는 reset 후 다시)
    const tsOk = !ts || (ts.render === 1 && ts.execute === scored.length && ts.reset === scored.length - 1);
    const ok = scored.length > 0 && missing.length === 0 && tsOk;
    if (ts) console.log(`  사람 확인 호출: ${JSON.stringify(ts)}`);
    ok ? pass++ : fail++;
    console.log(`${ok ? 'PASS' : 'FAIL'} ${c.label}: ${scored.length}판 검증 통과 ${scored.length - missing.length} (점수 ${scored.map((g) => g.score).join(',')})${missing.length ? ` 실패: ${missing.map((g) => `${g.name}=${g.score} "${g.msg}"`).join('; ')}` : ''}`);
  }
  const noReject = rejects.length === 0;
  noReject ? pass++ : fail++;
  console.log(`${noReject ? 'PASS' : 'FAIL'} 서버 검증 거절 없음${noReject ? '' : `: ${JSON.stringify(rejects)}`}`);
  const noErr = errors.length === 0;
  noErr ? pass++ : fail++;
  console.log(`${noErr ? 'PASS' : 'FAIL'} 자바스크립트 오류 없음${noErr ? '' : `: ${errors.join(' | ')}`}`);
  console.log(`PASS ${pass} FAIL ${fail}`);
  process.exit(fail ? 1 : 0);
})();
