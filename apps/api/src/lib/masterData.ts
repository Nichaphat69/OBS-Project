/**
 * Small shared master-data readers — ported from src/service.js's `holidayMap()` and
 * `employeesForMatching()`. Used by both the Manday recompute path and the timesheet-ingest
 * pipeline, so factored out here rather than duplicated.
 */
import { prisma } from '@obs/db';
import type { MatchableEmployee } from '@obs/domain';

/** ported from service.js holidayMap() — date → holiday name, customerId=null holidays apply to
 * everyone in addition to that customer's own. */
export async function holidayMap(customerId: string | null = null): Promise<Map<string, string>> {
  const rows = await prisma.holiday.findMany({
    where: { OR: [{ customerId: null }, ...(customerId ? [{ customerId }] : [])] },
  });
  return new Map(rows.map((r) => [r.date, r.name]));
}

export interface EmployeeBasic {
  id: string;
  nameTh: string;
  customerName: string | null;
}

/** ported from server.js GET /api/employees — used to populate the "ผูกพนักงาน" dropdown on the
 * users admin screen. Customer name comes from the employee's current active assignment, if any. */
export async function listEmployeesBasic(): Promise<EmployeeBasic[]> {
  const employees = await prisma.employee.findMany({
    include: {
      assignments: {
        where: { status: 'active' },
        take: 1,
        include: { contract: { include: { customer: true } } },
      },
    },
    orderBy: { nameTh: 'asc' },
  });
  return employees.map((e) => ({
    id: e.id,
    nameTh: e.nameTh,
    customerName: e.assignments[0]?.contract.customer.nameTh ?? null,
  }));
}

/** ported from service.js employeesForMatching() — shape matchEmployee()/checkPosition() expect. */
export async function employeesForMatching(): Promise<MatchableEmployee[]> {
  const employees = await prisma.employee.findMany({
    include: { aliases: true, assignments: { where: { status: 'active' }, take: 1 } },
    orderBy: { id: 'asc' },
  });
  return employees.map((e) => ({
    id: e.id,
    nameTh: e.nameTh,
    nameEn: e.nameEn,
    aliases: e.aliases.filter((a) => a.kind === 'name').map((a) => a.alias),
    invoicePosition: e.invoicePosition,
    monthlyRate: e.assignments[0]?.monthlyRate ?? null,
    quotationNo: e.assignments[0]?.quotationNo ?? null,
  }));
}
