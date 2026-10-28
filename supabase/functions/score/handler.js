// 랭킹 등록 요청 처리 (Deno Edge Function 과 Node 테스트에서 같이 씀)
//   { action: 'start' }  → { token, seed, v }  다음 판에 쓸 시드·토큰
//   { action: 'submit', v, token, name, owner, captcha, score, replay } → { result: 'ok' | 'reset' } 또는 { error }
// deps: rpc(이름, 인자) → DB 함수 결과, verifyCaptcha(토큰, ip) → true/false (사람 확인 안 쓰면 null)
import { SIM_VERSION, verifyReplay } from '../_shared/sim.js';

export const MAX_BODY = 2 * 1024 * 1024;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

// 요청한 사람 IP (요청 제한용). Supabase 앞단 프록시가 붙여 주는 x-forwarded-for 의 첫 번째 값
export function clientIp(req) {
  return (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'unknown';
}

export async function handle(req, { rpc, verifyCaptcha }) {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json(405, { error: 'method' });
  const text = await req.text();
  if (text.length > MAX_BODY) return json(413, { error: 'replay' });
  let b;
  try { b = JSON.parse(text); } catch { return json(400, { error: 'replay' }); }
  if (!b || typeof b !== 'object') return json(400, { error: 'replay' });
  const ip = clientIp(req);

  if (b.action === 'start') {
    const r = await rpc('game_start', { p_ip: ip });
    if (r.error) return json(429, { error: r.error, v: SIM_VERSION });
    return json(200, { token: r.token, seed: r.seed, v: SIM_VERSION });
  }

  if (b.action !== 'submit') return json(400, { error: 'action' });
  if (b.v !== SIM_VERSION) return json(400, { error: 'version' });
  if (typeof b.token !== 'string' || !/^[0-9a-f-]{36}$/i.test(b.token)) return json(400, { error: 'invalid' });
  if (typeof b.name !== 'string' || typeof b.owner !== 'string' || b.owner.length > 200) return json(400, { error: 'name' });
  if (!Number.isInteger(b.score)) return json(400, { error: 'invalid' });

  // 사람 확인 (Cloudflare Turnstile) — 시크릿이 설정돼 있을 때만
  const human = await verifyCaptcha(typeof b.captcha === 'string' ? b.captcha : '', ip);
  if (human === false) return json(400, { error: 'captcha' });

  const g = await rpc('game_get', { p_token: b.token });
  if (!g) return json(400, { error: 'invalid' });
  if (g.used) return json(400, { error: 'used' });

  // 서버가 같은 시드·같은 입력으로 게임을 다시 돌려 점수 확인
  const v = verifyReplay(g.seed, b.replay);
  if (!v.ok) return json(400, { error: v.reason });
  if (v.score !== b.score) return json(400, { error: 'mismatch' });

  const result = await rpc('game_finish', {
    p_token: b.token, p_ip: ip, p_name: b.name.slice(0, 20), p_owner: b.owner,
    p_score: v.score, p_sim_ms: v.simMs, p_replay: b.replay,
  });
  if (result === 'ok' || result === 'reset') return json(200, { result });
  return json(result === 'rate' ? 429 : 400, { error: result });
}

// Cloudflare Turnstile 서버 확인
export async function turnstileVerify(secret, token, ip) {
  if (!token) return false;
  const form = new FormData();
  form.append('secret', secret);
  form.append('response', token);
  if (ip !== 'unknown') form.append('remoteip', ip);
  try {
    const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: form });
    const d = await r.json();
    return d.success === true;
  } catch {
    return false;
  }
}
