import { proxyJson } from '../../../../lib/api';

export async function GET() {
  return proxyJson('/api/auth/config', { method: 'GET', cookieHeader: '' });
}
