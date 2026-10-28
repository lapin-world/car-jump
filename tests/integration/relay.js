// Supabase Realtime 을 흉내 내는 로컬 중계 서버 (채널 · Presence · Broadcast)
// - 연결마다 고정 지연(LAT_MIN~LAT_MAX ms)을 둬서 실제 네트워크처럼 늦게, 하지만 순서는 지켜서 전달
// - 창을 그냥 닫으면(비정상 종료) Presence 에서 GHOST_MS 뒤에야 빠짐 (실제 서버의 하트비트 타임아웃 흉내)
// - 통계: 보낸/전달된 메시지 수, 초당 최대, 채널별 수
const { WebSocketServer } = require('ws');
const PORT = Number(process.env.PORT || 9100);
const LAT_MIN = Number(process.env.LAT_MIN || 30);
const LAT_MAX = Number(process.env.LAT_MAX || 120);
const GHOST_MS = Number(process.env.GHOST_MS || 15000);

const topics = new Map(); // topic -> Map(connId -> { ws, key, meta })
const stats = { sent: 0, delivered: 0, presence: 0, perSec: new Map(), byTopic: new Map(), conns: 0, peakConns: 0, joins: 0 };
let nextId = 1;

function bump(map, k, n = 1) { map.set(k, (map.get(k) || 0) + n); }
function deliver(conn, msg) {
  stats.delivered++;
  bump(stats.perSec, Math.floor(Date.now() / 1000));
  const data = JSON.stringify(msg);
  setTimeout(() => { if (conn.ws.readyState === 1) conn.ws.send(data); }, conn.lat);
}
function presenceState(topic) {
  const st = {};
  for (const m of (topics.get(topic) || new Map()).values()) if (m.meta) st[m.key] = [m.meta];
  return st;
}
function syncPresence(topic) {
  const members = topics.get(topic);
  if (!members) return;
  const state = presenceState(topic);
  for (const m of members.values()) { stats.presence++; deliver(m.conn, { t: 'presence', topic, state }); }
}
function leave(conn, topic) {
  const members = topics.get(topic);
  if (!members || !members.has(conn.id)) return;
  members.delete(conn.id);
  if (!members.size) topics.delete(topic);
  syncPresence(topic);
}

const wss = new WebSocketServer({ port: PORT });
wss.on('connection', (ws) => {
  const conn = { id: nextId++, ws, lat: LAT_MIN + Math.random() * (LAT_MAX - LAT_MIN), topics: new Set() };
  stats.conns++; stats.peakConns = Math.max(stats.peakConns, stats.conns);
  ws.on('message', (raw) => {
    const m = JSON.parse(raw);
    if (m.t === 'join') {
      stats.joins++;
      if (!topics.has(m.topic)) topics.set(m.topic, new Map());
      topics.get(m.topic).set(conn.id, { conn, key: m.key, meta: null });
      conn.topics.add(m.topic);
      deliver(conn, { t: 'joined', topic: m.topic, ref: m.ref });
      deliver(conn, { t: 'presence', topic: m.topic, state: presenceState(m.topic) });
    } else if (m.t === 'track' || m.t === 'untrack') {
      const me = topics.get(m.topic) && topics.get(m.topic).get(conn.id);
      if (!me) return;
      me.meta = m.t === 'track' ? m.meta : null;
      syncPresence(m.topic);
    } else if (m.t === 'leave') {
      conn.topics.delete(m.topic);
      leave(conn, m.topic);
      deliver(conn, { t: 'left', topic: m.topic, ref: m.ref });
    } else if (m.t === 'send') {
      stats.sent++;
      bump(stats.byTopic, m.topic.replace(/[A-Z0-9]{4}$/, '*'));
      for (const other of (topics.get(m.topic) || new Map()).values()) {
        if (other.conn.id !== conn.id) deliver(other.conn, { t: 'bc', topic: m.topic, event: m.event, payload: m.payload });
      }
    }
  });
  ws.on('close', () => {
    stats.conns--;
    // 정상 종료(leave 를 이미 보냄)가 아니면 GHOST_MS 뒤에 빠짐
    const left = [...conn.topics];
    setTimeout(() => left.forEach((t) => leave(conn, t)), GHOST_MS);
  });
});

// 통계 조회용 HTTP 대신 stdin 명령 없이 주기적으로 파일에 기록
const fs = require('fs');
setInterval(() => {
  const per = [...stats.perSec.values()];
  fs.writeFileSync(__dirname + '/relay-stats.json', JSON.stringify({
    sent: stats.sent, delivered: stats.delivered, presence: stats.presence, joins: stats.joins,
    conns: stats.conns, peakConns: stats.peakConns,
    peakDeliveredPerSec: per.length ? Math.max(...per) : 0,
    byTopic: Object.fromEntries(stats.byTopic),
    topics: [...topics.entries()].map(([t, m]) => [t, m.size]),
  }, null, 1));
}, 1000);
console.log('relay on', PORT);
