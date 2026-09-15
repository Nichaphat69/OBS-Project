/** ported from service.js auditLog() — read side of the audit trail, for the admin viewer. */
import { prisma } from '@obs/db';

export interface AuditLogRow {
  id: number;
  at: string;
  actor: string;
  action: string;
  entityType: string | null;
  entityId: string | null;
  detail: unknown;
}

export async function auditLog({ limit = 200 }: { limit?: number } = {}): Promise<AuditLogRow[]> {
  const rows = await prisma.auditLog.findMany({
    orderBy: { id: 'desc' },
    take: limit,
  });
  return rows.map((r) => ({
    ...r,
    detail: r.detail ? JSON.parse(r.detail) : null,
  }));
}
