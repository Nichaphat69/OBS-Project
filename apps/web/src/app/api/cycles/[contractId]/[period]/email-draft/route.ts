import { NextRequest } from 'next/server';
import { proxyJson } from '../../../../../../lib/api';

export async function POST(req: NextRequest, { params }: { params: { contractId: string; period: string } }) {
  return proxyJson(`/api/cycles/${params.contractId}/${params.period}/email-draft`, {
    method: 'POST',
    cookieHeader: req.headers.get('cookie') ?? '',
    body: {},
  });
}
