import { NextRequest } from 'next/server';
import { proxyJson } from '../../../../../../lib/api';

export async function GET(req: NextRequest, { params }: { params: { contractId: string; period: string } }) {
  return proxyJson(`/api/cycles/${params.contractId}/${params.period}/employees`, {
    method: 'GET',
    cookieHeader: req.headers.get('cookie') ?? '',
  });
}
