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
  /** หลายค่าได้ (เลือกได้ทั้ง consume และ expose พร้อมกัน) — ไม่ระบุ/ว่าง = ทั้งหมด */
  direction?: Array<'consume' | 'expose'>;
  service?: string;
  method?: string;
  /** 'ok' | 'error' | undefined (ไม่กรอง) */
  status?: 'ok' | 'error';
  /** ค้นหาแบบ contains ใน path หรือ service */
  q?: string;
  /** ISO date/datetime — กรองแบบ at >= from */
  from?: string;
  /** ISO date/datetime — กรองแบบ at <= to */
  to?: string;
  page?: number;
  pageSize?: number;
}

const MAX_PAGE_SIZE = 200;

function buildWhere(filters: ApiActivityFilters) {
  const where: any = {};
  if (filters.direction && filters.direction.length > 0 && filters.direction.length < 2) {
    where.direction = filters.direction[0];
  }
  if (filters.service) where.service = filters.service;
  if (filters.method) where.method = filters.method;
  if (filters.status === 'ok') where.ok = true;
  if (filters.status === 'error') where.ok = false;
  if (filters.from || filters.to) {
    where.at = {};
    if (filters.from) where.at.gte = filters.from;
    if (filters.to) where.at.lte = filters.to;
  }
  if (filters.q) {
    where.OR = [{ path: { contains: filters.q, mode: 'insensitive' } }, { service: { contains: filters.q, mode: 'insensitive' } }];
  }
  return where;
}

export async function listApiActivity(filters: ApiActivityFilters = {}): Promise<{ rows: ApiActivityRow[]; total: number }> {
  const where = buildWhere(filters);
  const pageSize = Math.min(filters.pageSize ?? 10, MAX_PAGE_SIZE);
  const page = Math.max(filters.page ?? 1, 1);

  const [rows, total] = await Promise.all([
    prisma.apiActivityLog.findMany({
      where,
      orderBy: { id: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.apiActivityLog.count({ where }),
  ]);
  return { rows, total };
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

/** รายชื่อ HTTP method ที่มีอยู่จริงใน log — ใช้เติม dropdown กรองเช่นกัน */
export async function listApiActivityMethods(): Promise<string[]> {
  const rows = await prisma.apiActivityLog.findMany({
    distinct: ['method'],
    select: { method: true },
    orderBy: { method: 'asc' },
  });
  return rows.map((r) => r.method);
}
