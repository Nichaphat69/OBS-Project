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

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

/** เดิมดึงทีเดียว 200 แถวสุดท้ายแล้วจบ ไม่มีทางดูแถวเก่ากว่านั้นได้เลย (เจ้าของระบบสั่ง 24 ก.ย. 69
 * "ตาราง activity ต้องทำ lazy loading เพื่อ performance") เปลี่ยนเป็นแบ่งหน้าจริงแบบเดียวกับ
 * apiActivityLogService.ts's listApiActivity() — skip/take + count คืน total ให้หน้าเว็บทำปุ่มหน้าถัดไป */
export async function auditLog({ page = 1, pageSize = DEFAULT_PAGE_SIZE }: { page?: number; pageSize?: number } = {}): Promise<{ rows: AuditLogRow[]; total: number }> {
  const size = Math.min(Math.max(pageSize, 1), MAX_PAGE_SIZE);
  const p = Math.max(page, 1);

  const [rows, total] = await Promise.all([
    prisma.auditLog.findMany({
      orderBy: { id: 'desc' },
      skip: (p - 1) * size,
      take: size,
    }),
    prisma.auditLog.count(),
  ]);
  return {
    rows: rows.map((r) => ({
      ...r,
      detail: r.detail ? JSON.parse(r.detail) : null,
    })),
    total,
  };
}
