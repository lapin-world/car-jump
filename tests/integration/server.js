// 테스트 사본 정적 파일 + 랭킹 REST(scores, submit_score) 흉내 서버
const http = require('http');
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, 'site');
const scores = new Map(); // name -> score (같은 이름은 최고 점수만)
const submits = [];
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.png': 'image/png' };

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/rest/v1/rpc/submit_score') {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const { p_name, p_score } = JSON.parse(body);
      submits.push({ name: p_name, score: p_score, at: Date.now() });
      scores.set(p_name, Math.max(scores.get(p_name) || 0, p_score));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('');
    });
    return;
  }
  if (url.pathname === '/rest/v1/scores') {
    const rows = [...scores.entries()].map(([name, score]) => ({ name, score })).sort((a, b) => b.score - a.score).slice(0, 10);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(rows));
    return;
  }
  if (url.pathname === '/__submits') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(submits));
    return;
  }
  const file = path.join(ROOT, url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname));
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
}).listen(9200, () => console.log('site on 9200'));
