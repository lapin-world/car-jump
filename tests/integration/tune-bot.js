// 봇 점프 타이밍(lead) 맞추기: 혼자 하기로 여러 판 돌려 평균 점수 비교
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--disable-renderer-backgrounding', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows'] });
  const leads = (process.argv[2] || '0.1,0.15,0.2,0.25').split(',').map(Number);
  const pages = [];
  for (const lead of leads) for (let k = 0; k < 2; k++) {
    const p = await browser.newPage({ viewport: { width: 640, height: 400 } });
    await p.goto('http://localhost:9200/');
    await p.evaluate((lead) => { window.__bot = true; window.__noPause = true; window.__botLead = lead; }, lead);
    await p.click('#mode-solo');
    pages.push({ p, lead });
  }
  await new Promise((r) => setTimeout(r, Number(process.argv[3] || 40000)));
  const res = {};
  for (const { p, lead } of pages) {
    const d = await p.evaluate(() => window.__dbg());
    (res[lead] = res[lead] || []).push(`${d.score}${d.state === 'playing' ? '+' : ''}`);
  }
  console.log(JSON.stringify(res));
  await browser.close();
})();
