'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

/**
 * ตัวกรองขอบเขตข้อมูล site/บริษัท · เลขที่ PO · พนักงาน บนแถบบน (1 ต.ค. 69)
 *
 * เก็บเป็น cookie `obs_scope` (ไม่ใช่ state ในหน้า) เพื่อให้ทุกหน้า ทั้ง client component ที่ fetch เอง
 * และ server component ที่ส่ง cookie ต่อให้ API เห็นขอบเขตเดียวกันโดยไม่ต้องแก้ทีละหน้า — ฝั่ง API เป็นคนอ่านและ
 * บังคับกติกา (ดู apps/api/src/lib/scopeService.ts) ที่นี่ทำแค่ UI + cascading
 */

export const SCOPE_COOKIE = 'obs_scope';

export interface ScopeFilters {
  customerId: string | null;
  contractId: string | null;
  employeeId: string | null;
}
export type ScopeKey = keyof ScopeFilters;

export interface FilterContract {
  id: string;
  poNo: string;
  contractNo: string | null;
  projectName: string;
  customerId: string;
  customerName: string;
  startDate: string;
  endDate: string;
  status: string;
  employees: Array<{ id: string; nameTh: string; position: string }>;
}

const EMPTY: ScopeFilters = { customerId: null, contractId: null, employeeId: null };
export const isEmptyScope = (f: ScopeFilters) => !f.customerId && !f.contractId && !f.employeeId;

/** 'all' = เลือกดูทุกบริษัทอย่างชัดเจน (ต่างจาก null = ยังไม่ได้เลือก ซึ่งใช้ค่าเริ่มต้น) */
type Chosen = ScopeFilters | 'all' | null;

function readCookie(): Chosen {
  try {
    const hit = document.cookie.split('; ').find((c) => c.startsWith(`${SCOPE_COOKIE}=`));
    if (!hit) return null;
    const o = JSON.parse(decodeURIComponent(hit.slice(SCOPE_COOKIE.length + 1)));
    // ไม่อ่าน employeeId — ตัวกรองพนักงานเอาออกจาก UI แล้ว (1 ต.ค. 69) cookie เก่าที่ยังมีค่านี้ต้องไม่กรองแบบมองไม่เห็น
    // ไม่อ่าน customerId/employeeId — ตัวกรองเหลือแค่ PO (2 ต.ค. 69) cookie เก่าที่ยังมีค่าเหล่านี้ต้องไม่กรองแบบมองไม่เห็น
    const f = { customerId: null, contractId: o?.contractId ?? null, employeeId: null };
    if (isEmptyScope(f)) return o?.all === true ? 'all' : null;
    return f;
  } catch {
    return null;
  }
}

function writeCookie(f: Chosen) {
  if (f === 'all') {
    document.cookie = `${SCOPE_COOKIE}=${encodeURIComponent(JSON.stringify({ all: true }))}; path=/; max-age=${30 * 86400}; samesite=lax`;
    return;
  }
  if (!f || isEmptyScope(f)) {
    document.cookie = `${SCOPE_COOKIE}=; path=/; max-age=0; samesite=lax`;
    return;
  }
  document.cookie = `${SCOPE_COOKIE}=${encodeURIComponent(JSON.stringify(f))}; path=/; max-age=${30 * 86400}; samesite=lax`;
}

/** สัญญาที่ตรงกับตัวกรองทุกช่อง ยกเว้นช่อง `except` — ใช้หาตัวเลือกของช่องนั้น (cascading) */
export function matching(contracts: FilterContract[], f: ScopeFilters, except?: ScopeKey): FilterContract[] {
  return contracts.filter(
    (c) =>
      (except === 'customerId' || !f.customerId || c.customerId === f.customerId) &&
      (except === 'contractId' || !f.contractId || c.id === f.contractId) &&
      (except === 'employeeId' || !f.employeeId || c.employees.some((e) => e.id === f.employeeId)),
  );
}

/** ตั้งค่าหนึ่งช่อง แล้วเก็บช่องอื่นให้สอดคล้องกัน (ช่องที่เพิ่งเลือกชนะเสมอ):
 *  · เลือก PO → site ตามมาเอง · เลือกพนักงาน (อยู่ได้สัญญาเดียว) → PO และ site ตามมาเอง
 *  · ช่องอื่นที่ขัดกับตัวเลือกใหม่ถูกล้างทิ้ง กันค้างค่าที่ไม่เกี่ยวกันจนรายการว่างเปล่า
 *  · ล้างเป็นลำดับขั้น site ⊃ PO ⊃ พนักงาน — ล้าง site = ล้างทั้งหมด · ล้าง PO = ล้างพนักงานด้วย (พนักงานบอก PO
 *    ในตัวอยู่แล้ว ถ้าเก็บไว้ PO จะกลับมาเองแบบงงๆ) · ล้างพนักงานล้างแค่พนักงาน */
export function applyFilter(contracts: FilterContract[], current: ScopeFilters, key: ScopeKey, value: string | null): ScopeFilters {
  if (value === null) {
    if (key === 'customerId') return EMPTY;
    if (key === 'contractId') return { ...current, contractId: null, employeeId: null };
    return { ...current, employeeId: null };
  }
  const f: ScopeFilters = { ...current, [key]: value };
  if (key === 'contractId') {
    const c = contracts.find((x) => x.id === value);
    if (c) f.customerId = c.customerId;
    if (f.employeeId && !c?.employees.some((e) => e.id === f.employeeId)) f.employeeId = null;
  } else if (key === 'customerId') {
    const c = f.contractId ? contracts.find((x) => x.id === f.contractId) : undefined;
    if (c && c.customerId !== value) f.contractId = null;
    if (f.employeeId && !matching(contracts, f).some((x) => x.employees.some((e) => e.id === f.employeeId))) f.employeeId = null;
  } else {
    const owning = contracts.filter((c) => c.employees.some((e) => e.id === value));
    if (f.contractId && !owning.some((c) => c.id === f.contractId)) f.contractId = null;
    if (f.customerId && !owning.some((c) => c.customerId === f.customerId)) f.customerId = null;
    const fit = matching(contracts, f);
    if (fit.length === 1) {
      f.contractId = fit[0].id;
      f.customerId = fit[0].customerId;
    }
  }
  return f;
}

interface ScopeCtx {
  ready: boolean;
  contracts: FilterContract[];
  /** ค่าที่ใช้อยู่จริง: ที่เลือกไว้ · ยังไม่เคยเลือก → admin/บัญชีได้สัญญาที่กำลังดำเนินการอยู่ ส่วน executive ได้ทุกบริษัท */
  filters: ScopeFilters;
  /** true = ไม่ได้เลือกเอง กำลังใช้ค่าเริ่มต้น */
  isDefault: boolean;
  isExecutive: boolean;
  /** เปลี่ยนทุกครั้งที่ขอบเขตเปลี่ยน — ใช้เป็น key ให้หน้าโหลดข้อมูลใหม่ */
  version: number;
  setFilter: (key: ScopeKey, value: string | null) => void;
  reset: () => void;
  /** โหลดตัวเลือกใหม่ (มีสัญญา/พนักงานเพิ่มระหว่างที่เปิดหน้าไว้) */
  reloadOptions: () => Promise<void>;
}

const Ctx = createContext<ScopeCtx | null>(null);

export function ScopeProvider({
  role,
  onChange,
  children,
}: {
  role: string;
  onChange?: () => void;
  children: React.ReactNode;
}) {
  const isExecutive = role === 'executive';
  const [contracts, setContracts] = useState<FilterContract[]>([]);
  const [activeContractId, setActiveContractId] = useState<string | null>(null);
  const [chosen, setChosen] = useState<Chosen>(null);
  const [ready, setReady] = useState(false);
  const [version, setVersion] = useState(0);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/contracts/filter-options', { cache: 'no-store' });
      if (!res.ok) return;
      const data: { contracts: FilterContract[]; activeContractId: string | null } = await res.json();
      setContracts(data.contracts);
      setActiveContractId(data.activeContractId);
    } catch {
      /* ตัวกรองพลาดไม่ควรทำให้ทั้งหน้าพัง — แถบแค่ว่างอยู่ */
    }
  }, []);

  useEffect(() => {
    setChosen(readCookie());
    load().finally(() => setReady(true));
  }, [load]);

  const defaults: ScopeFilters = useMemo(
    () => (isExecutive || !activeContractId ? EMPTY : { ...EMPTY, contractId: activeContractId }),
    [isExecutive, activeContractId],
  );
  const filters: ScopeFilters = chosen === 'all' ? EMPTY : chosen ?? applyFilter(contracts, defaults, 'contractId', defaults.contractId);

  const commit = useCallback(
    (next: Chosen) => {
      writeCookie(next);
      setChosen(next === 'all' ? 'all' : next && !isEmptyScope(next) ? next : null);
      setVersion((v) => v + 1);
      onChange?.();
    },
    [onChange],
  );

  const setFilter = useCallback(
    (key: ScopeKey, value: string | null) => {
      const next = applyFilter(contracts, filters, key, value);
      // ล้างจนไม่เหลือตัวกรอง = ผู้ใช้เลือก "ทุกบริษัท" เอง ทุก role (1 ต.ค. 69) — บันทึกเป็น 'all' ชัดๆ แทนที่จะ
      // ปล่อยว่าง เพราะ "ว่าง" ฝั่งเซิร์ฟเวอร์แปลว่ายังไม่ได้เลือก ซึ่งต้องแคบลงเป็นสัญญาที่กำลังดำเนินการอยู่
      commit(isEmptyScope(next) ? (isExecutive ? null : 'all') : next);
    },
    [filters, contracts, commit, isExecutive],
  );

  const reset = useCallback(() => commit(null), [commit]);

  const value: ScopeCtx = { ready, contracts, filters, isDefault: chosen === null, isExecutive, version, setFilter, reset, reloadOptions: load };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useScope(): ScopeCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error('useScope ต้องอยู่ใต้ <ScopeProvider>');
  return v;
}
