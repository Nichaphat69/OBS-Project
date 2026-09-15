/**
 * ที่อยู่ของ apps/api จากมุมมองของ Next.js server (server-to-server — ไม่ใช่จาก browser)
 * ในเครือข่าย Docker คือ http://api:4301 (ดู docker-compose.yml) ตอนรัน `next dev` นอก Docker
 * ให้ชี้มาที่ localhost:4301 แทน
 */
export function apiBaseUrl(): string {
  return process.env.API_BASE_URL ?? 'http://localhost:4301';
}

/** ชื่อ cookie เดียวกับฝั่ง Express — ดู apps/api/src/lib/auth.ts (ported from src/auth.js) */
export const SESSION_COOKIE = 'obs_session';

/**
 * Same-origin proxy helper for routes that don't need the special Set-Cookie relay that
 * app/api/auth/login does — just forward the incoming session cookie and relay the JSON body +
 * status code back. Used by every apps/web/src/app/api/* route handler added after auth/*.
 */
export async function proxyJson(
  path: string,
  init: { method: string; cookieHeader: string; body?: unknown },
): Promise<Response> {
  const upstream = await fetch(`${apiBaseUrl()}${path}`, {
    method: init.method,
    headers: {
      cookie: init.cookieHeader,
      ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    cache: 'no-store',
  });
  const text = await upstream.text();
  return new Response(text, {
    status: upstream.status,
    headers: { 'content-type': upstream.headers.get('content-type') ?? 'application/json' },
  });
}
