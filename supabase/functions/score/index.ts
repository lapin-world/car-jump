// 랭킹 등록 Edge Function. 배포 방법은 supabase/README.md
// 브라우저는 publishable 키만 갖고 있어 JWT 확인 없이(--no-verify-jwt) 배포하고, 등록 가능 여부는 이 함수가 직접 판단
import { createClient } from 'npm:@supabase/supabase-js@2.99.3';
import { handle, turnstileVerify } from './handler.js';

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
});
// 비어 있으면 사람 확인(Turnstile) 없이 받음
const TURNSTILE_SECRET = Deno.env.get('TURNSTILE_SECRET') ?? '';

async function rpc(fn: string, args: Record<string, unknown>) {
  const { data, error } = await db.rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.message}`);
  return data;
}

Deno.serve(async (req) => {
  try {
    return await handle(req, {
      rpc,
      verifyCaptcha: (token: string, ip: string) => (TURNSTILE_SECRET ? turnstileVerify(TURNSTILE_SECRET, token, ip) : Promise.resolve(null)),
    });
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ error: 'server' }), {
      status: 500,
      headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
    });
  }
});
