/** อ่าน log สำหรับหน้า "จัดการระบบ" แท็บ "API Activity Log" (เฉพาะ admin) — ดู apiActivityLog.ts
 * สำหรับฝั่งเขียน (loggedFetch/logExposedRequest) ไฟล์นี้มีแค่ฝั่งอ่าน/กรอง */
import { prisma } from '@obs/db';

export interface ApiActivityRow {
  id: number;
  at: string;
  direction: string;
  service: string;
  method: string;
  path: string;
  durationMs: number;
  statusCode: number | null;
  ok: boolean;
  requestBody: string | null;
  responseBody: string | null;
  errorMessage: string | null;
}

export interface ApiActivityFilters {
  direction?: 'consume' | 'expose';
  service?: string;
  /** 'ok' | 'error' | undefined (ไม่กรอง) */
  status?: 'ok' | 'error';
  /** ISO date/datetime — กรองแบบ at >= from */
  from?: string;
  /** ISO date/datetime — กรองแบบ at <= to */
  to?: string;
  limit?: number;
}

const MAX_LIMIT = 500;

export async function listApiActivity(filters: ApiActivityFilters = {}): Promise<ApiActivityRow[]> {
  const where: any = {};
  if (filters.direction) where.direction = filters.direction;
  if (filters.service) where.service = filters.service;
  if (filters.status === 'ok') where.ok = true;
  if (filters.status === 'error') where.ok = false;
  if (filters.from || filters.to) {
    where.at = {};
    if (filters.from) where.at.gte = filters.from;
    if (filters.to) where.at.lte = filters.to;
  }

  const limit = Math.min(filters.limit ?? 100, MAX_LIMIT);
  return prisma.apiActivityLog.findMany({
    where,
    orderBy: { id: 'desc' },
    take: limit,
  });
}

/** รายชื่อ service ที่มีอยู่จริงใน log ตอนนี้ — ใช้เติม dropdown กรองฝั่งหน้าเว็บ ไม่ต้อง hardcode รายชื่อ
 * ไว้ล่วงหน้า (มี service ใหม่โผล่มาเอง dropdown ก็ตามทัน) */
export async function listApiActivityServices(): Promise<string[]> {
  const rows = await prisma.apiActivityLog.findMany({
    distinct: ['service'],
    select: { service: true },
    orderBy: { service: 'asc' },
  });
  return rows.map((r) => r.service);
}
