// 게임이 쓰는 supabase-js Realtime API 만 흉내 낸 클라이언트 (로컬 중계 서버 relay.js 에 WebSocket 으로 연결)
// createClient → { channel(name, opts), removeChannel(ch), getChannels() }
// channel → on('presence'|'broadcast', {event}, cb) / subscribe(cb) / track(meta) / untrack() / send({event,payload}) / presenceState()
window.supabase = { createClient() {
  const ws = new WebSocket('ws://localhost:9100');
  const queue = [];
  let open = false;
  ws.onopen = () => { open = true; queue.splice(0).forEach((m) => ws.send(m)); };
  const out = (m) => { const s = JSON.stringify(m); open ? ws.send(s) : queue.push(s); };
  const chans = [];
  let ref = 0;
  window.__wsStats = { sent: 0, recv: 0 };
  ws.onmessage = (e) => {
    window.__wsStats.recv++;
    const m = JSON.parse(e.data);
    const ch = chans.find((c) => c.topic === 'realtime:' + m.topic);
    if (!ch) return;
    if (m.t === 'joined') { ch._state = 'joined'; ch._sub && ch._sub('SUBSCRIBED'); }
    else if (m.t === 'left') { ch._onLeft && ch._onLeft(); }
    else if (m.t === 'presence') { ch._presence = m.state; ch._fire('presence', 'sync'); }
    else if (m.t === 'bc') ch._fire('broadcast', m.event, { payload: m.payload });
  };
  return {
    getChannels() { return chans; },
    channel(name, opts) {
      const existing = chans.find((c) => c.topic === 'realtime:' + name);
      if (existing) return existing; // supabase-js 와 같은 동작
      const key = opts.config.presence.key;
      const handlers = [];
      const ch = {
        topic: 'realtime:' + name, _state: 'init', _presence: {},
        _fire(type, ev, arg) { handlers.filter((h) => h.type === type && h.ev === ev).forEach((h) => h.cb(arg)); },
        on(type, f, cb) { handlers.push({ type, ev: f.event, cb }); return ch; },
        subscribe(cb) { ch._sub = cb; out({ t: 'join', topic: name, key, ref: ++ref }); return ch; },
        async track(meta) { out({ t: 'track', topic: name, meta }); return 'ok'; },
        async untrack() { out({ t: 'untrack', topic: name }); return 'ok'; },
        send({ event, payload }) { window.__wsStats.sent++; out({ t: 'send', topic: name, event, payload }); return Promise.resolve('ok'); },
        presenceState() { return ch._presence; },
        unsubscribe() {
          return new Promise((res) => { ch._onLeft = () => { chans.splice(chans.indexOf(ch), 1); res('ok'); }; out({ t: 'leave', topic: name, ref: ++ref }); });
        },
      };
      chans.push(ch);
      return ch;
    },
    async removeChannel(ch) { return ch.unsubscribe(); },
  };
} };
