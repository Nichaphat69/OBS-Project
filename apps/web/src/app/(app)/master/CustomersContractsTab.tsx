'use client';

import { useEffect, useState } from 'react';
import { Card, ErrorState, Loading } from '../../../components/ui';
import { Icon } from '../../../components/Icon';
import { DatePicker } from '../../../components/DatePicker';
import { useConfirm, useToast } from '../../../components/Overlays';
import { useLang, formatDate } from '../../../lib/language';
import { SETTINGS_CHANGED_EVENT } from '../../../lib/settingsChanged';
import { useScope, useContractRef } from '../../../lib/scope';

interface ContractRow {
  id: string;
  poNo: string;
  poDate: string | null;
  customerId: string;
  customerName: string;
  taxId: string;
  billingPlace: string | null;
  contactName: string | null;
  contactPhone: string | null;
  projectName: string;
  contractNo: string | null;
  startDate: string;
  endDate: string;
  creditDays: number;
  divisorMode: string;
  divisorValue: number;
  vatRate: number;
  whtRate: number;
  /** ยังอยู่ในข้อมูลและยังถูกใช้จริงโดยเส้น Gmail ที่ไม่มีคนมากดเลือก Skill ให้ — หน้านี้แค่เลิกแก้มัน
   * (ผู้ใช้เลือก Skill ที่หน้าอัปโหลดแทนแล้ว) จึงไม่ส่งคีย์นี้ขึ้นไปตอนบันทึก ไม่ใช่ส่ง null ซึ่งจะล้างค่า */
  abbyySkillId: string | null;
  headcount: number;
  monthlyTotal: number;
  status: string;
  /** บริษัทผูก FlowAccount แล้ว → พนักงาน/เรทแก้เองไม่ได้ ใช้ปุ่มซิงก์แทน */
  flowaccountLinked?: boolean;
  zipCode?: string | null;
  faReference?: string | null;
  quotationDate?: string | null;
  priceIncludesVat?: boolean;
  salesName?: string | null;
  remarks?: string | null;
  internalNotes?: string | null;
  quotationSubTotal?: number | null;
  quotationDiscount?: number | null;
  quotationGrandTotal?: number | null;
  /** ช่องที่ดึงมาจาก FlowAccount — ล็อกไม่ให้แก้ (API ปฏิเสธการแก้ด้วย) */
  faLockedFields?: string[];
}
/** บริษัทที่สร้างไว้แล้วแต่ยังไม่มีสัญญาเลย — ดู GET /api/customers/without-contract */
interface CustomerWithoutContract {
  id: string;
  nameTh: string;
  taxId: string;
}
interface FlowAccountEmployee {
  nameTh: string;
  invoicePosition: string;
  monthlyRate: number;
  quantity?: number | null;
  unitName?: string | null;
}
interface FlowAccountCompany {
  flowaccountContactId: string;
  nameTh: string;
  taxId: string;
  branch: string;
  address: string | null;
  contactName: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  quotationNo: string | null;
  projectName: string | null;
  // ฟิลด์ที่ดึงเพิ่มจากใบเสนอราคา (5 ต.ค. 69) — ดู FlowAccountCompany ฝั่ง apps/api
  zipCode?: string | null;
  reference?: string | null;
  creditDays?: number | null;
  quotationDate?: string | null;
  withholdingPercent?: number | null;
  vatPercent?: number | null;
  isVatInclusive?: boolean;
  remarks?: string | null;
  internalNotes?: string | null;
  salesName?: string | null;
  subTotal?: number | null;
  discountAmount?: number | null;
  grandTotal?: number | null;
  employees: FlowAccountEmployee[];
  // ฟิลด์ระดับเอกสาร/ทุกรายการที่เหลือของใบเสนอราคา (12 ต.ค. 69) — แสดงอ่านอย่างเดียว ดู FlowAccountQuotationExtra ฝั่ง apps/api
  quotationExtra?: Record<string, string | null>;
  quotationItems?: Array<Record<string, string | null>>;
  // เทียบกับข้อมูลในระบบ (12 ต.ค. 69): บริษัทนี้มีอยู่แล้ว → เพิ่มเป็นสัญญาใหม่ให้บริษัทเดิม · ใบเสนอราคานี้นำเข้าเป็นสัญญาแล้ว
  existingCustomerId?: string | null;
  alreadyImported?: boolean;
}

/** ปุ่มเชื่อมต่อ FlowAccount — ย้ายมาจากแถบบน (topbar) เดิม เพราะเป็นสวิตช์ที่คุมข้อมูลบริษัท/สัญญาที่
 * ซิงก์มาจาก FlowAccount โดยตรง จึงควรอยู่ในแท็บนี้แทน ไม่ใช่ปุ่มลอยบนแถบบนที่ไม่เกี่ยวกับหน้าที่เปิดอยู่ */
function FlowAccountToggle() {
  const confirm = useConfirm();
  const toast = useToast();
  const { tx } = useLang();
  const [mode, setMode] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  function loadMode() {
    setFailed(false);
    fetch('/api/pulse', { cache: 'no-store' })
      .then((r) => {
        if (!r.ok) throw new Error('failed');
        return r.json();
      })
      .then((data) => setMode(data.flowAccountMode))
      .catch(() => setFailed(true));
  }
  useEffect(loadMode, []);

  async function toggle() {
    const turningOn = mode === 'dry-run';
    const ok = await confirm({
      iconName: turningOn ? 'signin' : 'signout',
      danger: !turningOn,
      title: tx(turningOn ? 'เชื่อมต่อ FlowAccount?' : 'ปิดการเชื่อมต่อ FlowAccount?'),
      message: tx(
        turningOn
          ? 'ระบบจะเริ่มเชื่อมต่อกับ FlowAccount จริง ดึงข้อมูลบริษัท/พนักงานได้ และใช้ยิงเอกสารตอนกดอนุมัติออก INV'
          : 'ทุกคำขอจะกลายเป็น dry-run (ข้อมูลจำลอง) ทั้งระบบ ไม่เชื่อมต่อกับ FlowAccount จริงอีก จนกว่าจะเปิดใหม่',
      ),
      confirmLabel: tx(turningOn ? 'เชื่อมต่อ' : 'ปิดการเชื่อมต่อ'),
    });
    if (!ok) return;
    try {
      const res = await fetch('/api/settings/flowaccount-connected', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ enabled: turningOn }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast(data?.error ?? tx('ทำรายการไม่สำเร็จ'), true);
        return;
      }
      toast(tx(turningOn ? 'เชื่อมต่อ FlowAccount แล้ว' : 'ปิดการเชื่อมต่อ FlowAccount แล้ว'));
      loadMode();
      window.dispatchEvent(new Event(SETTINGS_CHANGED_EVENT));
    } catch {
      toast(tx('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้'), true);
    }
  }

  if (failed) {
    return (
      <button type="button" className="btn ghost sm" title={tx('โหลดสถานะ FlowAccount ไม่สำเร็จ — กดเพื่อลองใหม่')} onClick={loadMode}>
        {tx('โหลด FlowAccount ไม่สำเร็จ')}
      </button>
    );
  }
  if (mode === null) return null;
  return (
    <button type="button" className={`env ${mode === 'dry-run' ? 'dry' : 'live'}`} title={tx('โหมดการเชื่อมต่อ FlowAccount — กดเพื่อเปิด/ปิด')} onClick={toggle}>
      <span className="sw" /> FlowAccount
    </button>
  );
}

function money(n: number) {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
const dateOnly = formatDate;

/** ปัดเป็นทศนิยม 2 ตำแหน่งไม่ให้เพี้ยนจาก floating point (เช่น 0.0158*100 อาจได้ 1.5800000000000001)
 * แต่ไม่บังคับโชว์ทศนิยมท้ายที่ไม่มีนัยสำคัญ (3% ยังโชว์ "3" ไม่ใช่ "3.00") */
function pctPrecise(rate: number) {
  return Math.round(rate * 10000) / 100;
}

/** ported from public/app.js's renderMaster() tab 2 (บริษัท & สัญญา) + renderCustomerAddForm()/
 * renderContractEditForm() */
export default function CustomersContractsTab() {
  const { filters: scopeFilters } = useScope();
  const scopeHasPo = Boolean(scopeFilters.contractId);
  const confirm = useConfirm();
  const toast = useToast();
  const { tx, lang } = useLang();
  const refOf = useContractRef();

  const [contracts, setContracts] = useState<ContractRow[] | null>(null);
  const [orphanCustomers, setOrphanCustomers] = useState<CustomerWithoutContract[]>([]);
  // เดิมโชว์เป็นการ์ดแจ้งเตือนเปิดค้างไว้เสมอ ดูเหมือนบั๊ก/ของแปลกเทียบกับ FlowAccount ที่ไม่มีแนวคิดนี้
  // เลย (เจ้าของระบบทักไว้ 25 ก.ย. 69) — เก็บความสามารถ "กลับมาเพิ่มสัญญาทีหลัง" ไว้เหมือนเดิม (ยังจำเป็น
  // เพราะ CustomerAddForm ด้านล่างยอมให้เว้นสัญญาว่างไว้ตอนสร้างบริษัทได้) แค่พับซ่อนไว้เป็นค่าเริ่มต้น
  // ไม่โผล่เป็นแบนเนอร์เด่นเหมือนมีปัญหาให้ต้องรีบแก้
  const [showOrphans, setShowOrphans] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [editContractId, setEditContractId] = useState<string | null>(null);
  const [addContractForCustomerId, setAddContractForCustomerId] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function load() {
    setError(null);
    // scoped=1 = ตามตัวกรอง PO บนแถบบน (เลือก PO เดียวเห็นแค่สัญญานั้น · ทุก PO เห็นทั้งหมด)
    fetch('/api/contracts?scoped=1', { cache: 'no-store' })
      .then(async (r) => {
        if (!r.ok) {
          const data = await r.json().catch(() => ({}));
          setError(data?.error ?? tx('โหลดข้อมูลไม่สำเร็จ'));
          return;
        }
        setContracts(await r.json());
      })
      .catch(() => setError(tx('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้')));
    // บริษัทที่สร้างไว้แต่ยังไม่มีสัญญา (เพิ่งแยกขั้นตอนสร้างบริษัท/สัญญาออกจากกัน) — ล้มเหลวได้เงียบๆ
    // เพราะไม่ใช่ข้อมูลหลักของหน้านี้ ไม่ควรทำให้ทั้งหน้าใช้งานไม่ได้ถ้าดึงไม่สำเร็จ
    // บริษัทที่ยังไม่มีสัญญาไม่มี PO ให้ผูกกับตัวกรอง — โชว์เฉพาะตอนดูทุก PO เท่านั้น (เลือก PO เดียวอยู่ ไม่เกี่ยวข้อง)
    if (scopeHasPo) {
      setOrphanCustomers([]);
      return;
    }
    fetch('/api/customers/without-contract', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : []))
      .then(setOrphanCustomers)
      .catch(() => setOrphanCustomers([]));
  }
  useEffect(load, []);

  async function toggleActive(contract: ContractRow, turningOn: boolean) {
    setTogglingId(contract.id);
    try {
      const res = await fetch(`/api/contracts/${encodeURIComponent(contract.id)}/active`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ active: turningOn }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast(data?.error ?? tx('ทำรายการไม่สำเร็จ'), true);
        return;
      }
      toast(turningOn ? tx('เปิดใช้งานบริษัทนี้แล้ว — บริษัทอื่นที่เปิดอยู่ถูกปิดให้อัตโนมัติ') : tx('ปิดใช้งานแล้ว'));
      load();
    } catch {
      toast(tx('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้'), true);
    } finally {
      setTogglingId(null);
    }
  }

  const [syncingId, setSyncingId] = useState<string | null>(null);

  /** ปุ่ม "ซิงก์จาก FlowAccount" (QA EMPLOCK-003, 1 ต.ค. 69) — ข้อความ "แก้เองไม่ได้ ใช้ปุ่มซิงก์แทน" เคยชี้ไปที่ปุ่มที่ไม่มีใน
   * หน้าจอเลย (มีแต่ endpoint ฝั่ง API) ซิงก์เพิ่ม/อัปเดตเรท/ปิดสถานะพนักงานของสัญญานี้ให้ตรงกับใบเสนอราคาล่าสุดใน FlowAccount */
  async function syncFromFlowAccount(contract: ContractRow) {
    const ok = await confirm({
      iconName: 'rf',
      title: tx('ซิงก์พนักงานจาก FlowAccount?'),
      message: `"${refOf(contract).value} — ${contract.projectName}" ${tx('จะเพิ่ม/ปรับเรท/ปิดสถานะพนักงานในสัญญานี้ให้ตรงกับใบเสนอราคาล่าสุดของบริษัทนี้ใน FlowAccount')}`,
      confirmLabel: tx('ซิงก์'),
    });
    if (!ok) return;
    setSyncingId(contract.id);
    try {
      const res = await fetch(`/api/contracts/${encodeURIComponent(contract.id)}/sync-flowaccount`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast(data?.error ?? tx('ซิงก์ไม่สำเร็จ'), true);
        return;
      }
      toast(
        `${tx('ซิงก์แล้ว')}: ${tx('เพิ่ม')} ${data.created?.length ?? 0} · ${tx('ปรับเรท')} ${data.updated?.length ?? 0} · ${tx('ปิดสถานะ')} ${data.deactivated?.length ?? 0} · ${tx('ไม่เปลี่ยน')} ${data.unchanged ?? 0}`,
      );
      load();
    } catch {
      toast(tx('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้'), true);
    } finally {
      setSyncingId(null);
    }
  }

  async function deleteContract(contract: ContractRow) {
    const ok = await confirm({
      iconName: 'trash-solid',
      danger: true,
      title: tx('ลบสัญญานี้?'),
      message: `"${refOf(contract).value} — ${contract.projectName}" ${tx('และพนักงาน/Timesheet ทั้งหมดของสัญญานี้จะหายไปถาวร — กู้คืนไม่ได้ (ลบได้เฉพาะสัญญาที่ยังไม่เคยออกใบแจ้งหนี้เลยเท่านั้น ถ้าเคยออก INV ไปแล้วแม้แต่ใบเดียว ระบบจะปฏิเสธการลบทั้งหมด)')}`,
      confirmLabel: tx('ลบ'),
    });
    if (!ok) return;
    try {
      const res = await fetch(`/api/contracts/${encodeURIComponent(contract.id)}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) {
        toast(data?.error ?? tx('ลบไม่สำเร็จ'), true);
        return;
      }
      toast(tx('ลบสัญญาแล้ว'));
      load();
    } catch {
      toast(tx('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้'), true);
    }
  }

  async function deleteOrphanCustomer(customer: CustomerWithoutContract) {
    const ok = await confirm({
      iconName: 'trash-solid',
      danger: true,
      title: tx('ลบบริษัทรายนี้?'),
      message: `"${customer.nameTh}" ${tx('จะถูกลบถาวร — กู้คืนไม่ได้ (ลบได้เพราะยังไม่มีสัญญาผูกอยู่)')}`,
      confirmLabel: tx('ลบ'),
    });
    if (!ok) return;
    try {
      const res = await fetch(`/api/customers/${encodeURIComponent(customer.id)}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) {
        toast(data?.error ?? tx('ลบไม่สำเร็จ'), true);
        return;
      }
      toast(tx('ลบบริษัทแล้ว'));
      load();
    } catch {
      toast(tx('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้'), true);
    }
  }

  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!contracts)
    return (
      <Card>
        <Loading />
      </Card>
    );

  return (
    <>
      <div className="metabar">
        <FlowAccountToggle />
        <button className="btn pri sm" onClick={() => setAddOpen(true)}>
          <Icon name="grid" className="sm" /> {tx('เพิ่มบริษัทใหม่')}
        </button>
      </div>

      {addOpen && (
        <CustomerAddForm
          onCancel={() => setAddOpen(false)}
          onSaved={() => {
            setAddOpen(false);
            load();
          }}
        />
      )}

      {/* บริษัทที่สร้างไว้แล้วแต่ยังไม่มีสัญญา (เพิ่งเพิ่มบริษัทแบบเว้นสัญญาไว้ก่อน) — ต้องมีที่ให้กลับมา
          หาแล้วเพิ่มสัญญาต่อได้ ไม่งั้นบริษัทกลุ่มนี้จะหายไปจากหน้านี้ถาวรเพราะรายการหลักไล่จากสัญญา
          พับซ่อนไว้เป็นค่าเริ่มต้น (25 ก.ย. 69 ตามที่ขอ) ไม่โผล่เป็นแบนเนอร์เด่นเหมือนของเดิม */}
      {orphanCustomers.length > 0 &&
        (addContractForCustomerId ? (
          <AddContractForm
            customer={orphanCustomers.find((o) => o.id === addContractForCustomerId)!}
            onCancel={() => setAddContractForCustomerId(null)}
            onSaved={() => {
              setAddContractForCustomerId(null);
              load();
            }}
          />
        ) : (
          <div style={{ marginBottom: 18 }}>
            <button type="button" className="btn ghost sm" onClick={() => setShowOrphans((v) => !v)}>
              <Icon name="chev" className="xs" style={{ transform: showOrphans ? 'rotate(180deg)' : undefined }} />
              {tx('บริษัทที่ยังไม่มีสัญญา')} ({orphanCustomers.length})
            </button>
            {showOrphans && (
              <div style={{ marginTop: 10 }}>
                <Card title={tx('บริษัทที่ยังไม่มีสัญญา')} right={<span className="rt">{orphanCustomers.length}</span>}>
                  <div className="tasklist">
                    {orphanCustomers.map((o) => (
                      <div key={o.id} className="taskrow">
                        <div className="tt">
                          <b>{o.nameTh}</b>
                          <span>{tx('เลขผู้เสียภาษี')} {o.taxId}</span>
                        </div>
                        <div className="rowacts">
                          <button className="btn pri sm" onClick={() => setAddContractForCustomerId(o.id)}>
                            {tx('เพิ่มสัญญา')}
                          </button>
                          <button
                            className="btn sm icon dgr"
                            title={tx('ลบบริษัทรายนี้')}
                            aria-label={tx('ลบ')}
                            onClick={() => deleteOrphanCustomer(o)}
                          >
                            <Icon name="trash" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </Card>
              </div>
            )}
          </div>
        ))}

      {contracts.map((c) =>
        editContractId === c.id ? (
          <ContractEditForm
            key={c.id}
            contract={c}
              onCancel={() => setEditContractId(null)}
            onSaved={() => {
              setEditContractId(null);
              load();
            }}
          />
        ) : (
          <section key={c.id}
            className={`ct-card${c.status === 'active' ? ' live' : ''}`}>
            {/* หัวการ์ด (6 ต.ค. 69 จัดใหม่): ป้ายเลข PO สีฟ้า + ชื่อโครงการ + ชื่อบริษัทใต้ชื่อ · ปุ่มจัดการอยู่ขวาสุดแถวเดียวกัน */}
            <header className="ct-hd">
              <span className="ct-po">{refOf(c).value}</span>
              <div className="ct-ttl">
                <h3>{c.projectName}</h3>
                <span className="sub">{c.customerName}</span>
              </div>
                <div className="rowacts">
                  <label
                    className={`toggle${c.status === 'active' ? ' on' : ''}`}
                    title={tx(c.status === 'active' ? 'กำลังดำเนินการอยู่ — ปิดไปยังไม่มีบริษัทอื่นมาแทนที่อัตโนมัติ' : 'ปิดอยู่ — เปิดเพื่อให้ระบบทำงานกับบริษัทนี้ (จะปิดบริษัทอื่นที่เปิดอยู่ให้เองอัตโนมัติ)')}
                  >
                    <input type="checkbox" checked={c.status === 'active'} disabled={togglingId === c.id} onChange={(e) => toggleActive(c, e.target.checked)} />
                    <span className="tk" />
                    <span className="tl">{c.status === 'active' ? tx('กำลังดำเนินการ') : tx('ปิดอยู่')}</span>
                  </label>
                  {c.flowaccountLinked && (
                    <button className="btn sm" disabled={syncingId === c.id} title={tx('ซิงก์รายชื่อและเรทพนักงานจากใบเสนอราคาล่าสุดใน FlowAccount')} onClick={() => syncFromFlowAccount(c)}>
                      <Icon name="rf" />
                      <span>{syncingId === c.id ? tx('กำลังซิงก์…') : tx('ซิงก์จาก FlowAccount')}</span>
                    </button>
                  )}
                  <button className="btn sm icon" title={tx('แก้ไขข้อมูลสัญญา')} aria-label={tx('แก้ไข')} onClick={() => setEditContractId(c.id)}>
                    <Icon name="edit" />
                  </button>
                  <button className="btn sm icon dgr" title={tx('ลบสัญญานี้')} aria-label={tx('ลบ')} onClick={() => deleteContract(c)}>
                    <Icon name="trash" />
                  </button>
                </div>
            </header>

            {/* แถบตัวเลขสำคัญ 4 ช่อง — ของที่คนเปิดหน้านี้มาดูบ่อยสุด อ่านได้ในแวบเดียว */}
            <div className="ct-stats">
              <div className="ct-stat main">
                <span className="l">{tx('ยอดต่อเดือน')}</span>
                <span className="v">{money(c.monthlyTotal)} <small>{tx('บาท')}</small></span>
              </div>
              <div className="ct-stat">
                <span className="l">{tx('จำนวนคน')}</span>
                <span className="v">{c.headcount} <small>{tx('คน')}</small></span>
              </div>
              <div className="ct-stat wide">
                <span className="l">{tx('ช่วงสัญญา')}</span>
                <span className="v sm">{dateOnly(c.startDate, lang)} – {dateOnly(c.endDate, lang)}</span>
              </div>
              <div className="ct-stat">
                <span className="l">{tx('เครดิต')}</span>
                <span className="v">{c.creditDays} <small>{tx('วัน')}</small></span>
              </div>
            </div>

            <div className="ct-cols">
              <div className="ct-box">
                <h4>{tx('บริษัทและสัญญา')}</h4>
                <dl className="ct-kv">
                  <dt>{tx('บริษัท')}</dt>
                  <dd>{c.customerName}</dd>
                  <dt>{tx('เลขผู้เสียภาษี')}</dt>
                  <dd className="n">{c.taxId}</dd>
                  <dt>{tx('เลขที่สัญญา')}</dt>
                  <dd className="n">{c.contractNo ?? '—'}</dd>
                  <dt>{tx('ผู้ประสานงาน')}</dt>
                  <dd>{c.contactName || c.contactPhone ? `${c.contactName ?? ''} ${c.contactPhone ?? ''}`.trim() : '—'}</dd>
                  {c.billingPlace && (
                    <>
                      <dt>{tx('สถานที่ส่งใบแจ้งหนี้')}</dt>
                      <dd>{c.billingPlace}</dd>
                    </>
                  )}
                </dl>
              </div>
              <div className="ct-box">
                <h4>{tx('เงื่อนไขการคิดเงิน')}</h4>
                <dl className="ct-kv">
                  <dt>{tx('ตัวหารอัตราต่อวัน')}</dt>
                  <dd>{c.divisorMode === 'fixed' ? `${tx('คงที่')} ${c.divisorValue}` : tx('วันทำงานจริงของเดือน')}</dd>
                  <dt>VAT</dt>
                  <dd className="n">{Math.round(c.vatRate * 100)}%</dd>
                  <dt>{tx('หัก ณ ที่จ่าย')}</dt>
                  {/* ตัวเลขอย่างเดียว ไม่มีปุ่มดินสอแก้ตรงนี้ (5 ต.ค. 69 เจ้าของระบบสั่งเอาออก) — แก้ผ่านฟอร์ม "แก้ไขข้อมูลสัญญา" ด้านบนของการ์ด */}
                  <dd className="n">{pctPrecise(c.whtRate)}%</dd>
                  <dt>{tx('เครดิต')}</dt>
                  <dd className="n">{c.creditDays} {tx('วัน')}</dd>
                </dl>
              </div>
            </div>

            {/* ข้อมูลที่ดึงจากใบเสนอราคา FlowAccount (5 ต.ค. 69) — โชว์เฉพาะสัญญาที่มีค่าอย่างน้อยหนึ่งช่อง · พับเก็บไว้ได้ ไม่ให้การ์ดยาวเกินจำเป็น */}
            {(c.faReference || c.quotationDate || c.salesName || c.remarks || c.internalNotes || c.zipCode || c.quotationGrandTotal != null || c.priceIncludesVat) && (
              <details className="ct-fa">
                <summary>{tx('ข้อมูลจากใบเสนอราคา FlowAccount')}</summary>
                <div className="ct-cols">
                  <dl className="ct-kv">
                    {c.faReference && (<><dt>{tx('เลขที่อ้างอิง')}</dt><dd className="n">{c.faReference}</dd></>)}
                    {c.quotationDate && (<><dt>{tx('วันที่ใบเสนอราคา')}</dt><dd>{dateOnly(c.quotationDate, lang)}</dd></>)}
                    <dt>{tx('ราคา')}</dt>
                    <dd>{c.priceIncludesVat ? tx('รวมภาษี') : tx('ไม่รวมภาษี')}</dd>
                    {c.salesName && (<><dt>{tx('พนักงานขาย')}</dt><dd>{c.salesName}</dd></>)}
                    {c.zipCode && (<><dt>{tx('รหัสไปรษณีย์')}</dt><dd className="n">{c.zipCode}</dd></>)}
                  </dl>
                  <dl className="ct-kv">
                    {c.quotationSubTotal != null && (<><dt>{tx('ยอดก่อนส่วนลด')}</dt><dd className="n">{money(c.quotationSubTotal)} {tx('บาท')}</dd></>)}
                    {c.quotationDiscount != null && c.quotationDiscount > 0 && (<><dt>{tx('ส่วนลด')}</dt><dd className="n">{money(c.quotationDiscount)} {tx('บาท')}</dd></>)}
                    {c.quotationGrandTotal != null && (<><dt>{tx('ยอดรวมทั้งสิ้น')}</dt><dd className="n">{money(c.quotationGrandTotal)} {tx('บาท')}</dd></>)}
                    {c.remarks && (<><dt>{tx('หมายเหตุ')}</dt><dd>{c.remarks}</dd></>)}
                    {c.internalNotes && (<><dt>{tx('บันทึกภายใน')}</dt><dd>{c.internalNotes}</dd></>)}
                  </dl>
                </div>
              </details>
            )}
          </section>
        ),
      )}
    </>
  );
}

/** ฟิลด์ระดับเอกสารที่เหลือของใบเสนอราคา FlowAccount (อ่านอย่างเดียว) — คีย์ตรงกับ quotationExtra ฝั่ง API · true = เป็นจำนวนเงิน */
const FA_EXTRA_FIELDS: Array<[string, string, boolean]> = [
  ['status', 'สถานะเอกสาร', false],
  ['contactCode', 'รหัสลูกค้า', false],
  ['contactGroup', 'กลุ่มลูกค้า', false],
  ['creditType', 'เงื่อนไขการชำระเงิน', false],
  ['dueDate', 'วันครบกำหนด', false],
  ['saleChannel', 'ช่องทางการขาย', false],
  ['externalDocumentId', 'เลขที่เอกสารภายนอก', false],
  ['discountType', 'ประเภทส่วนลด', false],
  ['discountPercentage', 'ส่วนลด (%)', false],
  ['totalAfterDiscount', 'ยอดหลังหักส่วนลด', true],
  ['totalWithoutVat', 'ยอดก่อนภาษี', true],
  ['exemptAmount', 'ยอดยกเว้นภาษี', true],
  ['vatableAmount', 'ยอดที่คิดภาษี', true],
  ['vatAmount', 'ภาษีมูลค่าเพิ่ม', true],
  ['isVat', 'คิดภาษีมูลค่าเพิ่ม', false],
  ['showWithholdingTax', 'แสดงหัก ณ ที่จ่าย', false],
  ['withholdingAmount', 'ยอดหัก ณ ที่จ่าย', true],
  ['deductionType', 'ประเภทการหักเงิน', false],
  ['deductionAmount', 'ยอดหักเงิน', true],
];

function faShow(v: string | null | undefined, money = false): string {
  if (v === null || v === undefined || v === '') return '—';
  const n = Number(v);
  return money && Number.isFinite(n) ? n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : v;
}

/** ฟอร์ม "เพิ่มบริษัทใหม่" — สร้างบริษัท + สัญญาแรกในคราวเดียว เพราะบริษัทที่ไม่มีสัญญาเลยใช้งานอะไร
 * ไม่ได้ (ไม่มีอัตราจ้าง ไม่มีรอบบิล) */
function CustomerAddForm({ onCancel, onSaved }: { onCancel: () => void; onSaved: () => void }) {
  const toast = useToast();
  const { tx } = useLang();
  const [faCompanies, setFaCompanies] = useState<FlowAccountCompany[]>([]);
  const [faIndex, setFaIndex] = useState('');
  const [faContactId, setFaContactId] = useState<string | null>(null);
  const [faHint, setFaHint] = useState('');
  // ช่องที่ได้ค่ามาจากใบเสนอราคา FlowAccount จริง (ไม่ว่าง) — ล็อกแก้/พิมพ์เพิ่มไม่ได้ (5 ต.ค. 69 ตามที่สั่ง) ส่งรายการนี้ไปเก็บกับ
  // สัญญาด้วย เพื่อให้ฟอร์มแก้สัญญาล็อกต่อ และ API ปฏิเสธการแก้ช่องเหล่านี้
  const [faLocked, setFaLocked] = useState<Set<string>>(new Set());
  const locked = (key: string) => faLocked.has(key);
  // ป้ายเล็กใต้ช่องที่ล็อก — เป็นฟังก์ชันคืน JSX ไม่ใช่คอมโพเนนต์ซ้อน (กันบั๊กช่องกรอกเสียโฟกัส)
  const lockNote = (key: string) =>
    locked(key) ? (
      <small className="fa-lockhint">
        <Icon name="lock" className="sm" /> {tx('ดึงจาก FlowAccount — แก้ไม่ได้')}
      </small>
    ) : null;

  const [nameTh, setNameTh] = useState('');
  const [taxId, setTaxId] = useState('');
  const [branch, setBranch] = useState('สำนักงานใหญ่');
  const [address, setAddress] = useState('');
  const [creditDays, setCreditDays] = useState('30');
  const [contactName, setContactName] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [billingPlace, setBillingPlace] = useState('');

  const [poNo, setPoNo] = useState('');
  const [contractNo, setContractNo] = useState('');
  const [projectName, setProjectName] = useState('');
  const [divisorMode, setDivisorMode] = useState('fixed');
  const [divisorValue, setDivisorValue] = useState('20');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [vat, setVat] = useState('7');
  const [wht, setWht] = useState('3');
  // ฟิลด์ที่ดึงเพิ่มจากใบเสนอราคา FlowAccount (5 ต.ค. 69) — แก้ได้ก่อนบันทึก ยกเว้นยอดรวม (อ่านอย่างเดียว)
  const [zipCode, setZipCode] = useState('');
  const [faReference, setFaReference] = useState('');
  const [quotationDate, setQuotationDate] = useState('');
  const [priceIncludesVat, setPriceIncludesVat] = useState(false);
  const [salesName, setSalesName] = useState('');
  const [remarks, setRemarks] = useState('');
  const [internalNotes, setInternalNotes] = useState('');
  const [faTotals, setFaTotals] = useState<{ sub: number | null; disc: number | null; grand: number | null }>({ sub: null, disc: null, grand: null });
  // เลขที่เอกสาร + ฟิลด์ระดับเอกสารที่เหลือ + ทุกรายการของใบเสนอราคา (แสดงอ่านอย่างเดียว)
  const [faDoc, setFaDoc] = useState<{ no: string | null; extra: Record<string, string | null>; items: Array<Record<string, string | null>> } | null>(null);
  // โหมดดึงจาก FlowAccount (เลือกใบเสนอราคาแล้ว): เลขที่อ้างอิงช่องเดียวใช้เป็นเลข PO ของสัญญา · วันที่ใบเสนอราคาใช้เป็นวันเริ่มสัญญา
  const faMode = faIndex !== '';
  const faExistingCustomerId = faMode ? faCompanies[Number(faIndex)]?.existingCustomerId ?? null : null;
  // ข้อความเตือนให้ตรวจก่อนบันทึก (เครดิต/หัก ณ ที่จ่าย 0, ราคารวมภาษี)
  const [faNotes, setFaNotes] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetch('/api/flowaccount/companies', { cache: 'no-store' })
      .then((r) => r.json())
      .then(setFaCompanies)
      .catch(() => setFaCompanies([]));
  }, []);

  function onFromFaChange(indexStr: string) {
    setFaIndex(indexStr);
    const c = faCompanies[Number(indexStr)];
    if (!c) {
      // เลือกกลับเป็นช่องว่าง = ไม่ใช้ใบเสนอราคาแล้ว: ปลดล็อกทั้งหมดและเลิกผูก FlowAccount (ค่าที่เติมไว้ยังอยู่ให้แก้ต่อได้)
      setFaLocked(new Set());
      setFaContactId(null);
      setFaDoc(null);
      return;
    }
    const has = (v: unknown) => v !== null && v !== undefined && String(v).trim() !== '';
    const lockedNow = new Set<string>();
    const mark = (key: string, v: unknown) => {
      if (has(v)) lockedNow.add(key);
    };
    mark('customerNameTh', c.nameTh);
    mark('taxId', c.taxId);
    mark('branch', c.branch);
    mark('address', c.address);
    mark('zipCode', c.zipCode);
    mark('contactName', c.contactName);
    mark('contactPhone', c.contactPhone);
    mark('contactEmail', c.contactEmail);
    mark('projectName', c.projectName);
    mark('faReference', c.reference);
    mark('quotationDate', c.quotationDate);
    mark('salesName', c.salesName);
    mark('remarks', c.remarks);
    mark('internalNotes', c.internalNotes);
    lockedNow.add('priceIncludesVat');
    if (c.vatPercent != null) lockedNow.add('vatRate');
    if (c.withholdingPercent != null && c.withholdingPercent > 0) lockedNow.add('whtRate');
    if (c.creditDays != null && c.creditDays > 0) lockedNow.add('creditDays');
    setFaLocked(lockedNow);
    setNameTh(c.nameTh);
    setTaxId(c.taxId);
    setBranch(c.branch || 'สำนักงานใหญ่');
    setAddress(c.address ?? '');
    setContactName(c.contactName ?? '');
    setContactPhone(c.contactPhone ?? '');
    setContactEmail(c.contactEmail ?? '');
    if (c.projectName) setProjectName(c.projectName);
    setFaContactId(c.flowaccountContactId);
    // ── ฟิลด์ที่ดึงเพิ่ม (5 ต.ค. 69 เจ้าของระบบสั่งให้ดึงจาก FlowAccount ให้ครบ) ──
    const notes: string[] = [];
    setZipCode(c.zipCode ?? '');
    setFaReference(c.reference ?? '');
    setQuotationDate(c.quotationDate ?? '');
    setPriceIncludesVat(Boolean(c.isVatInclusive));
    setSalesName(c.salesName ?? '');
    setRemarks(c.remarks ?? '');
    setInternalNotes(c.internalNotes ?? '');
    setFaTotals({ sub: c.subTotal ?? null, disc: c.discountAmount ?? null, grand: c.grandTotal ?? null });
    // เลขที่อ้างอิงของ FlowAccount ช่องเดียวทำหน้าที่เป็นเลข PO ของสัญญาด้วย (12 ต.ค. 69 ตามที่สั่ง — เดิมมี 2 ช่องซ้ำกัน) ส่วนวันที่ใบเสนอราคา
    // ใช้เป็นวันเริ่มสัญญา (วันเดียวกัน ตัดช่องวันเริ่มสัญญาออกในโหมดนี้) — ใบเสนอราคาที่ไม่มีเลขอ้างอิง/วันที่ ช่องนั้นจะเปิดให้กรอกเองแทน
    setFaDoc({ no: c.quotationNo ?? null, extra: c.quotationExtra ?? {}, items: c.quotationItems ?? [] });
    // เครดิต/หัก ณ ที่จ่าย: FlowAccount ใส่ 0 เป็นค่าเริ่มต้นของใบเสนอราคาเกือบทุกใบ (ตรวจ 20 ใบ: เครดิต 0 อยู่ 13 ใบ, หัก ณ ที่จ่าย 0 ทั้ง 20 ใบ)
    // ซึ่งแปลว่า "ยังไม่ได้ตั้ง" มากกว่า "ไม่มีเครดิต/ไม่หัก" — ทับค่าเริ่มต้นของเราด้วย 0 จะทำให้วันครบกำหนด/ยอดหักผิดโดยไม่รู้ตัว
    // จึงเติมเฉพาะเมื่อมากกว่า 0 ส่วน 0 ใช้ค่าเริ่มต้นเดิมแล้วบอกให้รู้
    if (c.creditDays != null) {
      if (c.creditDays > 0) setCreditDays(String(c.creditDays));
      else notes.push(`${tx('FlowAccount ระบุเครดิต 0 วัน — ใช้ค่าเริ่มต้น')} ${creditDays} ${tx('วันไว้ แก้ได้ที่ช่อง "เครดิต"')}`);
    }
    if (c.vatPercent != null) setVat(String(c.vatPercent));
    if (c.withholdingPercent != null) {
      if (c.withholdingPercent > 0) setWht(String(c.withholdingPercent));
      else notes.push(`${tx('FlowAccount ไม่ได้ระบุหัก ณ ที่จ่าย — ใช้ค่าเริ่มต้น')} ${wht}% ${tx('ไว้ ตรวจให้ตรงกับสัญญา')}`);
    }
    if (c.isVatInclusive) notes.push(tx('⚠️ ใบเสนอราคานี้เป็นราคา "รวมภาษี" แต่ระบบคิดเงินแบบ "ไม่รวมภาษี" — ตรวจเรทต่อเดือนให้ตรงก่อนบันทึก'));
    setFaNotes(notes);
    // ข้อความหลังนี้เคยชวนไปเพิ่มพนักงานเองทีหลังจากแท็บ "พนักงาน" — ตัดออกแล้วเพราะแท็บนั้นไม่มีปุ่ม
    // เพิ่มพนักงานอีก (18 ก.ย. 69 ตามกติกาที่เจ้าของระบบยืนยัน: พนักงานเข้าระบบได้ทางเดียวคือผ่าน
    // ใบเสนอราคาที่ผูกกับสัญญาเท่านั้น) ถ้าใบเสนอราคาไม่มีรายชื่อ ทางแก้คือไปเพิ่มที่ต้นทางใน FlowAccount
    setFaHint(c.employees?.length ? `${tx('ดึงพนักงาน')} ${c.employees.length} ${tx('คน + เรทต่อเดือนจากใบเสนอราคานี้มาให้อัตโนมัติ')}` : tx('ใบเสนอราคานี้ไม่มีรายชื่อพนักงานให้ดึง — เพิ่มรายชื่อในใบเสนอราคาที่ FlowAccount ก่อน'));
  }

  async function save() {
    const nt = nameTh.trim();
    const ti = taxId.trim();
    // โหมด FlowAccount: เลขที่อ้างอิงช่องเดียวเป็นเลข PO · วันที่ใบเสนอราคาเป็นวันเริ่มสัญญา
    const po = (faMode ? faReference : poNo).trim();
    const sd = faMode && quotationDate ? quotationDate : startDate;
    const pn = projectName.trim();
    if (!nt || !ti) {
      setFieldErrors(new Set([!nt && 'nameTh', !ti && 'taxId'].filter(Boolean) as string[]));
      toast(tx('กรอกชื่อบริษัทและเลขผู้เสียภาษีให้ครบก่อน'), true);
      return;
    }
    // สัญญาไม่บังคับกรอกตอนสร้างบริษัทอีกต่อไป (createCustomer() เองก็ต้องการแค่ชื่อ+เลขผู้เสียภาษี
    // อยู่แล้ว) แต่ถ้าจะกรอกสัญญาด้วยก็ต้องครบทั้ง 4 ช่อง เพราะ createContract() ฝั่ง server ยัง
    // ต้องการครบเหมือนเดิม — ไม่แตะ validation นั้นเพราะมีเหตุผลของมันเอง (บิล/PO อ้างอิงฟิลด์พวกนี้)
    const hasAnyContractField = Boolean(po || pn || sd || endDate);
    const hasAllContractFields = Boolean(po && pn && sd && endDate);
    if (hasAnyContractField && !hasAllContractFields) {
      setFieldErrors(
        new Set([!po && 'poNo', !pn && 'projectName', !sd && 'startDate', !endDate && 'endDate'].filter(Boolean) as string[]),
      );
      toast(tx('ถ้าจะเพิ่มสัญญาด้วยเลย ต้องกรอกเลขที่ใบว่าจ้าง ชื่อโครงการ และช่วงสัญญาให้ครบ — หรือเว้นว่างทั้งหมดไว้ก่อนแล้วเพิ่มสัญญาทีหลังก็ได้'), true);
      return;
    }
    // บริษัทเดิมอยู่ในระบบแล้ว: ไม่สร้างบริษัทซ้ำ — ต้องมีสัญญาให้เพิ่มเสมอ (ไม่งั้นไม่มีอะไรให้ทำ)
    if (faExistingCustomerId && !hasAllContractFields) {
      setFieldErrors(new Set([!po && 'poNo', !pn && 'projectName', !sd && 'startDate', !endDate && 'endDate'].filter(Boolean) as string[]));
      toast(tx('บริษัทนี้มีอยู่แล้ว — ต้องกรอกเลขที่อ้างอิง/PO ชื่อโครงการ และช่วงสัญญาให้ครบเพื่อเพิ่มสัญญาใหม่'), true);
      return;
    }
    setFieldErrors(new Set());
    setSaving(true);
    try {
      // บริษัทเดิม (ตรงกับ FlowAccount contact หรือเลขผู้เสียภาษี+สาขา) ใช้ id เดิม ไม่สร้างซ้ำ — ใบเสนอราคาใหม่ของบริษัทเดียวกัน = สัญญาใหม่
      let customer: any;
      if (faExistingCustomerId) {
        customer = { id: faExistingCustomerId };
      } else {
        const customerRes = await fetch('/api/customers', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            nameTh: nt,
            taxId: ti,
            branch: branch.trim() || undefined,
            address: address.trim() || null,
            zipCode: zipCode.trim() || null,
            creditDays: Number.isFinite(Number(creditDays)) && creditDays.trim() !== '' ? Number(creditDays) : 30,
            contactName: contactName.trim() || null,
            contactPhone: contactPhone.trim() || null,
            contactEmail: contactEmail.trim() || null,
            billingPlace: billingPlace.trim() || null,
            flowaccountContactId: faContactId || null,
          }),
        });
        customer = await customerRes.json();
        if (!customerRes.ok) {
          toast(customer?.error ?? tx('สร้างบริษัทไม่สำเร็จ'), true);
          setSaving(false);
          return;
        }
      }

      if (!hasAllContractFields) {
        // ยังไม่กรอกสัญญาเลย — สร้างแค่บริษัทไว้ก่อน ไปเพิ่มสัญญาทีหลังได้จากรายการ "บริษัทที่ยังไม่มี
        // สัญญา" ด้านบน (ดึงจาก GET /api/customers/without-contract)
        toast(`${tx('เพิ่มบริษัท')} "${nt}" ${tx('แล้ว — ยังไม่มีสัญญา เพิ่มสัญญาให้ทีหลังได้จากรายการ "บริษัทที่ยังไม่มีสัญญา" ด้านบน')}`);
        onSaved();
        return;
      }

      const contractRes = await fetch('/api/contracts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          customerId: customer.id,
          poNo: po,
          projectName: pn,
          contractNo: contractNo.trim() || null,
          divisorMode,
          divisorValue: Number(divisorValue) || 20,
          startDate: sd,
          endDate,
          // เครดิตเดิมไม่เคยส่งไปกับสัญญาเลย (ใช้ค่าเริ่มต้น 30 ของฝั่ง server เสมอ) — ส่งค่าเดียวกับที่โชว์ในฟอร์ม
          creditDays: Number.isFinite(Number(creditDays)) && creditDays.trim() !== '' ? Number(creditDays) : 30,
          vatRate: (Number(vat) || 0) / 100,
          whtRate: (Number(wht) || 0) / 100,
          // ข้อมูลจากใบเสนอราคา FlowAccount (5 ต.ค. 69)
          faReference: faReference.trim() || null,
          quotationDate: quotationDate || null,
          priceIncludesVat,
          salesName: salesName.trim() || null,
          remarks: remarks.trim() || null,
          internalNotes: internalNotes.trim() || null,
          quotationSubTotal: faTotals.sub,
          quotationDiscount: faTotals.disc,
          quotationGrandTotal: faTotals.grand,
          // ช่องที่ล็อก (ดึงมาจาก FlowAccount) — เซิร์ฟเวอร์เก็บไว้กับสัญญาและปฏิเสธการแก้ช่องเหล่านี้ทีหลัง
          faLockedFields: faIndex !== '' ? [...faLocked] : [],
        }),
      });
      const contract = await contractRes.json();
      if (!contractRes.ok) {
        toast(contract?.error ?? tx('สร้างสัญญาไม่สำเร็จ'), true);
        setSaving(false);
        return;
      }

      const faCompany = faIndex ? faCompanies[Number(faIndex)] : null;
      let addedEmployees = 0;
      if (faCompany?.employees?.length) {
        for (const emp of faCompany.employees) {
          try {
            const empRes = await fetch('/api/employees', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                contractId: contract.id,
                nameTh: emp.nameTh,
                invoicePosition: emp.invoicePosition,
                monthlyRate: emp.monthlyRate,
                startDate: sd,
                endDate,
                quotationNo: faCompany.quotationNo || null,
                quantity: emp.quantity ?? null,
                unitName: emp.unitName ?? null,
                fromFlowAccountSync: true,
              }),
            });
            if (!empRes.ok) {
              const empErr = await empRes.json();
              toast(`${tx('เพิ่มพนักงาน')} "${emp.nameTh}" ${tx('ไม่สำเร็จ')}: ${empErr?.error ?? tx('ผิดพลาด')}`, true);
              continue;
            }
            addedEmployees += 1;
          } catch {
            toast(`${tx('เพิ่มพนักงาน')} "${emp.nameTh}" ${tx('ไม่สำเร็จ')}`, true);
          }
        }
      }

      toast(addedEmployees ? `${tx('เพิ่ม')} "${nt}" ${tx('พร้อมพนักงาน')} ${addedEmployees} ${tx('คนแล้ว')}` : `${tx('เพิ่ม')} "${nt}"`);
      onSaved();
    } catch {
      toast(tx('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้'), true);
      setSaving(false);
    }
  }

  return (
    <Card
      title={tx('เพิ่มบริษัทใหม่')}
      right={<span className="rt">{tx('กรอกข้อมูลบริษัทและสัญญาแรกในคราวเดียว')}</span>}
      footer={
        <>
          <button className="btn" onClick={onCancel}>
            {tx('ยกเลิก')}
          </button>
          <button className="btn pri" disabled={saving} onClick={save}>
            {tx('บันทึกบริษัทใหม่')}
          </button>
        </>
      }
    >
      {faCompanies.length > 0 && (
        <div className="frm" style={{ marginBottom: 16 }}>
          <label>
            {tx('ดึงข้อมูลจาก FlowAccount')}
            <span className="selectchip grow">
              <select value={faIndex} onChange={(e) => onFromFaChange(e.target.value)}>
                <option value="">— {tx('เลือกบริษัทจากใบเสนอราคาที่มีอยู่แล้ว')} —</option>
                {faCompanies.map((c, i) => (
                  // หนึ่งรายการ = หนึ่งใบเสนอราคา (หนึ่งสัญญา/PO) — บริษัทเดียวกันมีหลายรายการได้ · ที่นำเข้าเป็นสัญญาแล้วเลือกซ้ำไม่ได้
                  <option key={`${c.quotationNo ?? c.flowaccountContactId}-${i}`} value={i} disabled={Boolean(c.alreadyImported)}>
                    {c.nameTh} · {c.quotationNo ?? '—'}
                    {c.reference ? ` · อ้างอิง ${c.reference}` : ''}
                    {c.quotationDate ? ` · ${c.quotationDate}` : ''}
                    {c.alreadyImported ? ` · ${tx('นำเข้าแล้ว')}` : ''}
                  </option>
                ))}
              </select>
            </span>
          </label>
          <small className="fhint">{faHint}</small>
          {faExistingCustomerId && (
            <small className="fhint" style={{ color: 'var(--wn)' }}>
              {tx('บริษัทนี้มีอยู่ในระบบแล้ว — การบันทึกจะเพิ่มเป็น "สัญญาใหม่" ให้บริษัทเดิม ไม่สร้างบริษัทซ้ำ')}
            </small>
          )}
        </div>
      )}

      <div className="frm">
        <label>
          {tx('ชื่อบริษัท')}
          <input
            className={fieldErrors.has('nameTh') ? 'err' : undefined}
            value={nameTh}
            onChange={(e) => setNameTh(e.target.value)}
            readOnly={locked('customerNameTh')}
            placeholder={tx('เช่น บริษัท ทดสอบ จำกัด')}
          />
          {lockNote('customerNameTh')}
        </label>
        <label>
          {tx('เลขผู้เสียภาษี')}
          <input className={fieldErrors.has('taxId') ? 'err' : undefined} value={taxId} onChange={(e) => setTaxId(e.target.value)} readOnly={locked('taxId')} />
          {lockNote('taxId')}
        </label>
        <label>
          {tx('สาขา')}
          <input value={branch} onChange={(e) => setBranch(e.target.value)} readOnly={locked('branch')} />
          {lockNote('branch')}
        </label>
        <label>
          {tx('ที่อยู่')}
          <input value={address} onChange={(e) => setAddress(e.target.value)} readOnly={locked('address')} />
          {lockNote('address')}
        </label>
        <label>
          {tx('รหัสไปรษณีย์')}
          <input value={zipCode} onChange={(e) => setZipCode(e.target.value)} inputMode="numeric" readOnly={locked('zipCode')} />
          {lockNote('zipCode')}
        </label>
        <label>
          {tx('เครดิต (วัน)')}
          <input type="number" min={0} value={creditDays} onChange={(e) => setCreditDays(e.target.value)} readOnly={locked('creditDays')} />
          {lockNote('creditDays')}
        </label>
        <label>
          {tx('ผู้ประสานงาน')}
          <input value={contactName} onChange={(e) => setContactName(e.target.value)} readOnly={locked('contactName')} />
          {lockNote('contactName')}
        </label>
        <label>
          {tx('เบอร์ผู้ประสานงาน')}
          <input value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} readOnly={locked('contactPhone')} />
          {lockNote('contactPhone')}
        </label>
        <label>
          {tx('อีเมลผู้ประสานงาน')}
          <input type="email" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} readOnly={locked('contactEmail')} />
          {lockNote('contactEmail')}
        </label>
        <label>
          {tx('สถานที่ส่งใบแจ้งหนี้')}
          <input value={billingPlace} onChange={(e) => setBillingPlace(e.target.value)} />
        </label>
      </div>

      <div className="fsec">
        <div className="fsec-h">
          <b>{tx('สัญญาแรก')}</b>
          <span style={{ fontSize: 12, color: 'var(--mut)' }}>{tx('ไม่บังคับ — เว้นว่างไว้ก่อนแล้วเพิ่มสัญญาทีหลังก็ได้')}</span>
        </div>
        <div className="frm">
          {faMode ? (
            <label>
              {tx('เลขที่อ้างอิง')}
              <input
                className={fieldErrors.has('poNo') ? 'err' : undefined}
                value={faReference}
                onChange={(e) => setFaReference(e.target.value)}
                readOnly={locked('faReference')}
                placeholder={tx('เช่น 26/B0200')}
              />
              {lockNote('faReference')}
              <small className="fhint">{tx('ใช้เป็นเลขที่ PO ของสัญญานี้')}</small>
            </label>
          ) : (
            <label>
              {tx('เลขที่ใบว่าจ้าง (PO)')}
              <input
                className={fieldErrors.has('poNo') ? 'err' : undefined}
                value={poNo}
                placeholder={tx('เช่น 26/B0200')}
                onChange={(e) => setPoNo(e.target.value)}
              />
            </label>
          )}
          <label>
            {tx('เลขที่สัญญา')}
            <input value={contractNo} onChange={(e) => setContractNo(e.target.value)} />
          </label>
          <label>
            {tx('ชื่อโครงการ')}
            <input className={fieldErrors.has('projectName') ? 'err' : undefined} value={projectName} onChange={(e) => setProjectName(e.target.value)} readOnly={locked('projectName')} />
            {lockNote('projectName')}
          </label>
          <label>
            {tx('ตัวหารอัตราต่อวัน')}
            <span className="selectchip grow">
              <select value={divisorMode} onChange={(e) => setDivisorMode(e.target.value)}>
                <option value="fixed">{tx('คงที่ (ระบุจำนวนวัน)')}</option>
                <option value="actual_working_days">{tx('วันทำงานจริงของเดือน')}</option>
              </select>
            </span>
          </label>
          <label>
            {tx('จำนวนวัน (ถ้าคงที่)')}
            <input type="number" min={1} value={divisorValue} onChange={(e) => setDivisorValue(e.target.value)} />
          </label>
          {!(faMode && quotationDate) && (
            <label>
              {tx('วันเริ่มสัญญา')}
              <DatePicker
                value={startDate}
                onChange={setStartDate}
                className={fieldErrors.has('startDate') ? 'err' : undefined}
                />
            </label>
          )}
          <label>
            {tx('วันสิ้นสุดสัญญา')}
            <DatePicker
              value={endDate}
              onChange={setEndDate}
              className={fieldErrors.has('endDate') ? 'err' : undefined}
              />
          </label>
          <label>
            VAT (%)
            <input type="number" min={0} max={100} step={0.1} value={vat} onChange={(e) => setVat(e.target.value)} readOnly={locked('vatRate')} />
            {lockNote('vatRate')}
          </label>
          <label>
            {tx('หัก ณ ที่จ่าย (%)')}
            <input type="number" min={0} max={100} step={0.1} value={wht} onChange={(e) => setWht(e.target.value)} readOnly={locked('whtRate')} />
            {lockNote('whtRate')}
          </label>
        </div>
        <small className="fhint">{tx('พนักงาน/อัตราจ้างของบริษัทรายนี้ดึงมาจากใบเสนอราคาใน FlowAccount อัตโนมัติ — แก้ไขทีหลังได้จากแท็บ "พนักงาน"')}</small>
      </div>

      {faIndex !== '' && (
        <div className="fsec">
          <div className="fsec-h">
            <b>{tx('ข้อมูลจากใบเสนอราคา FlowAccount')}</b>
            <span style={{ fontSize: 12, color: 'var(--mut)' }}>{tx('ช่องที่ดึงจาก FlowAccount แก้ไม่ได้ — ถ้าไม่ตรง ให้แก้ที่ FlowAccount แล้วเลือกใบเสนอราคาใหม่')}</span>
          </div>
          {faNotes.length > 0 && (
            <div className="note wn" style={{ marginBottom: 12 }}>
              <Icon name="alt" />
              <span>{faNotes.join(' · ')}</span>
            </div>
          )}
          <div className="frm">
            <label>
              {tx('เลขที่เอกสาร')}
              <input value={faDoc?.no ?? '—'} readOnly />
            </label>
            <label>
              {tx('วันที่ใบเสนอราคา')}
              <DatePicker value={quotationDate} onChange={setQuotationDate} disabled={locked('quotationDate')} />
              {lockNote('quotationDate')}
              <small className="fhint">{tx('ใช้เป็นวันเริ่มสัญญา')}</small>
            </label>
            <label>
              {tx('ราคา')}
              <span className="selectchip grow">
                <select value={priceIncludesVat ? 'inc' : 'exc'} onChange={(e) => setPriceIncludesVat(e.target.value === 'inc')} disabled={locked('priceIncludesVat')}>
                  <option value="exc">{tx('ราคาไม่รวมภาษี')}</option>
                  <option value="inc">{tx('ราคารวมภาษี')}</option>
                </select>
              </span>
              {lockNote('priceIncludesVat')}
            </label>
            <label>
              {tx('พนักงานขาย')}
              <input value={salesName} onChange={(e) => setSalesName(e.target.value)} readOnly={locked('salesName')} />
              {lockNote('salesName')}
            </label>
            <label>
              {tx('หมายเหตุ')}
              <input value={remarks} onChange={(e) => setRemarks(e.target.value)} readOnly={locked('remarks')} />
              {lockNote('remarks')}
            </label>
            <label>
              {tx('บันทึกภายใน')}
              <input value={internalNotes} onChange={(e) => setInternalNotes(e.target.value)} readOnly={locked('internalNotes')} />
              {lockNote('internalNotes')}
            </label>
            <label>
              {tx('ยอดก่อนส่วนลด (อ่านอย่างเดียว)')}
              <input value={faTotals.sub != null ? faTotals.sub.toLocaleString('en-US', { minimumFractionDigits: 2 }) : '—'} readOnly />
            </label>
            <label>
              {tx('ยอดรวมทั้งสิ้น (อ่านอย่างเดียว)')}
              <input value={faTotals.grand != null ? faTotals.grand.toLocaleString('en-US', { minimumFractionDigits: 2 }) : '—'} readOnly />
            </label>
          </div>

          {faDoc && (
            <>
              <div className="fsec-h" style={{ marginTop: 18 }}>
                <b>{tx('รายละเอียดอื่นๆ ในใบเสนอราคา')}</b>
                <span style={{ fontSize: 12, color: 'var(--mut)' }}>{tx('อ่านอย่างเดียว — แสดงครบตามที่มีใน FlowAccount')}</span>
              </div>
              <div className="frm">
                <label>
                  {tx('ส่วนลดรวม (บาท)')}
                  <input value={faShow(faTotals.disc != null ? String(faTotals.disc) : null, true)} readOnly />
                </label>
                {FA_EXTRA_FIELDS.map(([key, label, isMoney]) => (
                  <label key={key}>
                    {tx(label)}
                    <input value={faShow(faDoc.extra[key], isMoney)} readOnly />
                  </label>
                ))}
              </div>

              <div className="fsec-h" style={{ marginTop: 18 }}>
                <b>{tx('รายการในใบเสนอราคา')}</b>
                <span style={{ fontSize: 12, color: 'var(--mut)' }}>{faDoc.items.length} {tx('รายการ')}</span>
              </div>
              <div className="tw">
                <table>
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>{tx('ชื่อรายการ')}</th>
                      <th>{tx('รายละเอียด')}</th>
                      <th className="r">{tx('จำนวน')}</th>
                      <th>{tx('หน่วย')}</th>
                      <th className="r">{tx('ราคาต่อหน่วย')}</th>
                      <th className="r">{tx('ส่วนลด')}</th>
                      <th className="r">VAT (%)</th>
                      <th className="r">{tx('หัก ณ ที่จ่าย (ต่อรายการ)')}</th>
                      <th className="r">{tx('จำนวนเงิน')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {faDoc.items.length === 0 && (
                      <tr>
                        <td colSpan={10} style={{ textAlign: 'center', color: 'var(--mut)' }}>
                          {tx('ใบเสนอราคานี้ไม่มีรายการ')}
                        </td>
                      </tr>
                    )}
                    {faDoc.items.map((it, i) => (
                      <tr key={i}>
                        <td className="sub">{i + 1}</td>
                        <td>{faShow(it.name)}</td>
                        <td>{faShow(it.description)}</td>
                        <td className="r n">{faShow(it.quantity)}</td>
                        <td>{faShow(it.unitName)}</td>
                        <td className="r n">{faShow(it.pricePerUnit, true)}</td>
                        <td className="r n">{faShow(it.discountAmount, true)}</td>
                        <td className="r n">{faShow(it.vatRate)}</td>
                        <td className="r n">{it.withHeldPerItem && it.withHeldPerItem !== 'None' ? `${faShow(it.withHeldPerItem)}${it.withHeldPerItemValue ? ` (${faShow(it.withHeldPerItemValue, true)})` : ''}` : '—'}</td>
                        <td className="r n">{faShow(it.total, true)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}

    </Card>
  );
}

/** ฟอร์ม "เพิ่มสัญญา" ให้บริษัทที่มีอยู่แล้วแต่ยังไม่มีสัญญาเลย (มาจาก CustomerAddForm ที่แยกขั้นตอนไว้
 * ให้เว้นสัญญาว่างไว้ก่อนได้) validation ฝั่งนี้ครบทุกช่องเหมือน createContract() ฝั่ง server เดิม
 * ไม่ได้ผ่อนอะไรลง แค่แยกเวลากรอกออกจากตอนสร้างบริษัทเท่านั้น */
function AddContractForm({ customer, onCancel, onSaved }: { customer: CustomerWithoutContract; onCancel: () => void; onSaved: () => void }) {
  const toast = useToast();
  const { tx } = useLang();
  const [poNo, setPoNo] = useState('');
  const [contractNo, setContractNo] = useState('');
  const [projectName, setProjectName] = useState('');
  const [divisorMode, setDivisorMode] = useState('fixed');
  const [divisorValue, setDivisorValue] = useState('20');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [vat, setVat] = useState('7');
  const [wht, setWht] = useState('3');
  const [saving, setSaving] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Set<string>>(new Set());

  async function save() {
    const po = poNo.trim();
    const pn = projectName.trim();
    if (!po || !pn || !startDate || !endDate) {
      setFieldErrors(
        new Set([!po && 'poNo', !pn && 'projectName', !startDate && 'startDate', !endDate && 'endDate'].filter(Boolean) as string[]),
      );
      toast(tx('กรอกเลขที่ใบว่าจ้าง ชื่อโครงการ และช่วงสัญญาให้ครบก่อน'), true);
      return;
    }
    setFieldErrors(new Set());
    setSaving(true);
    try {
      const res = await fetch('/api/contracts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          customerId: customer.id,
          poNo: po,
          projectName: pn,
          contractNo: contractNo.trim() || null,
          divisorMode,
          divisorValue: Number(divisorValue) || 20,
          startDate,
          endDate,
          vatRate: (Number(vat) || 0) / 100,
          whtRate: (Number(wht) || 0) / 100,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast(data?.error ?? tx('สร้างสัญญาไม่สำเร็จ'), true);
        setSaving(false);
        return;
      }
      toast(`${tx('เพิ่มสัญญาให้')} "${customer.nameTh}" ${tx('แล้ว')}`);
      onSaved();
    } catch {
      toast(tx('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้'), true);
      setSaving(false);
    }
  }

  return (
    <Card
      title={tx('เพิ่มสัญญา')}
      right={<span className="rt">{customer.nameTh}</span>}
      footer={
        <>
          <button className="btn" onClick={onCancel}>
            {tx('ยกเลิก')}
          </button>
          <button className="btn pri" disabled={saving} onClick={save}>
            {tx('บันทึก')}
          </button>
        </>
      }
    >
      <div className="frm">
        <label>
          {tx('เลขที่ใบว่าจ้าง (PO)')}
          <input
            className={fieldErrors.has('poNo') ? 'err' : undefined}
            value={poNo}
            onChange={(e) => setPoNo(e.target.value)}
            placeholder={tx('เช่น 26/B0200')}
          />
        </label>
        <label>
          {tx('เลขที่สัญญา')}
          <input value={contractNo} onChange={(e) => setContractNo(e.target.value)} />
        </label>
        <label>
          {tx('ชื่อโครงการ')}
          <input className={fieldErrors.has('projectName') ? 'err' : undefined} value={projectName} onChange={(e) => setProjectName(e.target.value)} />
        </label>
        <label>
          {tx('ตัวหารอัตราต่อวัน')}
          <span className="selectchip grow">
            <select value={divisorMode} onChange={(e) => setDivisorMode(e.target.value)}>
              <option value="fixed">{tx('คงที่ (ระบุจำนวนวัน)')}</option>
              <option value="actual_working_days">{tx('วันทำงานจริงของเดือน')}</option>
            </select>
          </span>
        </label>
        <label>
          {tx('จำนวนวัน (ถ้าคงที่)')}
          <input type="number" min={1} value={divisorValue} onChange={(e) => setDivisorValue(e.target.value)} />
        </label>
        <label>
          {tx('วันเริ่มสัญญา')}
          <DatePicker
            value={startDate}
            onChange={setStartDate}
            className={fieldErrors.has('startDate') ? 'err' : undefined}
            />
        </label>
        <label>
          {tx('วันสิ้นสุดสัญญา')}
          <DatePicker
            value={endDate}
            onChange={setEndDate}
            className={fieldErrors.has('endDate') ? 'err' : undefined}
            />
        </label>
        <label>
          VAT (%)
          <input type="number" min={0} max={100} step={0.1} value={vat} onChange={(e) => setVat(e.target.value)} />
        </label>
        <label>
          {tx('หัก ณ ที่จ่าย (%)')}
          <input type="number" min={0} max={100} step={0.1} value={wht} onChange={(e) => setWht(e.target.value)} />
        </label>
      </div>
      <small className="fhint">{tx('พนักงาน/อัตราจ้างของบริษัทรายนี้ดึงมาจากใบเสนอราคาใน FlowAccount อัตโนมัติ — แก้ไขทีหลังได้จากแท็บ "พนักงาน"')}</small>
    </Card>
  );
}

/** ฟอร์ม "แก้ไขข้อมูลสัญญา" — แก้ทั้งบริษัท+สัญญาในคราวเดียว (มาแทนที่การ์ดของสัญญานั้นเลยในหน้า) */
function ContractEditForm({ contract, onCancel, onSaved }: { contract: ContractRow; onCancel: () => void; onSaved: () => void }) {
  const toast = useToast();
  const { tx } = useLang();
  const refOf = useContractRef();
  const [customerNameTh, setCustomerNameTh] = useState(contract.customerName);
  const [taxId, setTaxId] = useState(contract.taxId);
  const [contactName, setContactName] = useState(contract.contactName ?? '');
  const [contactPhone, setContactPhone] = useState(contract.contactPhone ?? '');
  const [billingPlace, setBillingPlace] = useState(contract.billingPlace ?? '');

  const [poNo, setPoNo] = useState(contract.poNo);
  const [contractNo, setContractNo] = useState(contract.contractNo ?? '');
  const [projectName, setProjectName] = useState(contract.projectName);
  const [divisorMode, setDivisorMode] = useState(contract.divisorMode);
  const [divisorValue, setDivisorValue] = useState(String(contract.divisorValue));
  const [startDate, setStartDate] = useState(contract.startDate);
  const [endDate, setEndDate] = useState(contract.endDate);
  const [vat, setVat] = useState(String(Math.round(contract.vatRate * 100)));
  const [wht, setWht] = useState(String(Math.round(contract.whtRate * 100)));
  const [creditDays, setCreditDays] = useState(String(contract.creditDays));
  const [saving, setSaving] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Set<string>>(new Set());
  // ช่องที่ดึงมาจาก FlowAccount — แก้ไม่ได้ (รายการมาจาก server: สัญญาใหม่ตามที่เลือกตอนสร้าง สัญญาเก่าใช้กฎสำรอง) และ
  // server ปฏิเสธการแก้ช่องเหล่านี้ด้วย ไม่ใช่แค่ล็อกที่หน้านี้
  const lockedSet = new Set(contract.faLockedFields ?? []);
  const locked = (key: string) => lockedSet.has(key);
  const lockNote = (key: string) =>
    locked(key) ? (
      <small className="fa-lockhint">
        <Icon name="lock" className="sm" /> {tx('ดึงจาก FlowAccount — แก้ไม่ได้')}
      </small>
    ) : null;

  async function save() {
    const cnt = customerNameTh.trim();
    const ti = taxId.trim();
    const po = poNo.trim();
    const pn = projectName.trim();
    if (!cnt || !ti || !po || !pn || !startDate || !endDate) {
      setFieldErrors(
        new Set(
          [!cnt && 'customerNameTh', !ti && 'taxId', !po && 'poNo', !pn && 'projectName', !startDate && 'startDate', !endDate && 'endDate'].filter(
            Boolean,
          ) as string[],
        ),
      );
      toast(tx('กรอกชื่อบริษัท เลขผู้เสียภาษี เลขที่ใบว่าจ้าง ชื่อโครงการ และช่วงสัญญาให้ครบก่อน'), true);
      return;
    }
    setFieldErrors(new Set());
    setSaving(true);
    try {
      const res = await fetch(`/api/contracts/${encodeURIComponent(contract.id)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          customerNameTh: cnt,
          taxId: ti,
          poNo: po,
          projectName: pn,
          startDate,
          endDate,
          contractNo: contractNo.trim() || null,
          divisorMode,
          divisorValue: Number(divisorValue) || 20,
          vatRate: (Number(vat) || 0) / 100,
          whtRate: (Number(wht) || 0) / 100,
          creditDays: Number(creditDays) || 30,
          contactName: contactName.trim() || null,
          contactPhone: contactPhone.trim() || null,
          billingPlace: billingPlace.trim() || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast(data?.error ?? tx('บันทึกไม่สำเร็จ'), true);
        setSaving(false);
        return;
      }
      toast(`${tx('บันทึกการแก้ไข')} "${cnt}"`);
      onSaved();
    } catch {
      toast(tx('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้'), true);
      setSaving(false);
    }
  }

  return (
    <Card
      title={tx('แก้ไขข้อมูลสัญญา')}
      right={
        <span className="rt">
          {refOf(contract).value} — {contract.projectName}
        </span>
      }
      footer={
        <>
          <button className="btn" onClick={onCancel}>
            {tx('ยกเลิก')}
          </button>
          <button className="btn pri" disabled={saving} onClick={save}>
            {tx('บันทึกการแก้ไข')}
          </button>
        </>
      }
    >
      <div className="frm">
        <label>
          {tx('ชื่อบริษัท')}
          <input className={fieldErrors.has('customerNameTh') ? 'err' : undefined} value={customerNameTh} onChange={(e) => setCustomerNameTh(e.target.value)} readOnly={locked('customerNameTh')} />
          {lockNote('customerNameTh')}
        </label>
        <label>
          {tx('เลขผู้เสียภาษี')}
          <input className={fieldErrors.has('taxId') ? 'err' : undefined} value={taxId} onChange={(e) => setTaxId(e.target.value)} readOnly={locked('taxId')} />
          {lockNote('taxId')}
        </label>
        <label>
          {tx('ผู้ประสานงาน')}
          <input value={contactName} onChange={(e) => setContactName(e.target.value)} readOnly={locked('contactName')} />
          {lockNote('contactName')}
        </label>
        <label>
          {tx('เบอร์ผู้ประสานงาน')}
          <input value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} readOnly={locked('contactPhone')} />
          {lockNote('contactPhone')}
        </label>
        <label>
          {tx('สถานที่ส่งใบแจ้งหนี้')}
          <input value={billingPlace} onChange={(e) => setBillingPlace(e.target.value)} />
        </label>
      </div>

      <div className="fsec">
        <div className="fsec-h">
          <b>{tx('ข้อมูลสัญญา')}</b>
        </div>
        <div className="frm">
          <label>
            {tx('เลขที่ใบว่าจ้าง (PO)')}
            <input className={fieldErrors.has('poNo') ? 'err' : undefined} value={poNo} onChange={(e) => setPoNo(e.target.value)} />
          </label>
          <label>
            {tx('เลขที่สัญญา')}
            <input value={contractNo} onChange={(e) => setContractNo(e.target.value)} />
          </label>
          <label>
            {tx('ชื่อโครงการ')}
            <input className={fieldErrors.has('projectName') ? 'err' : undefined} value={projectName} onChange={(e) => setProjectName(e.target.value)} readOnly={locked('projectName')} />
            {lockNote('projectName')}
          </label>
          <label>
            {tx('ตัวหารอัตราต่อวัน')}
            <span className="selectchip grow">
              <select value={divisorMode} onChange={(e) => setDivisorMode(e.target.value)}>
                <option value="fixed">{tx('คงที่ (ระบุจำนวนวัน)')}</option>
                <option value="actual_working_days">{tx('วันทำงานจริงของเดือน')}</option>
              </select>
            </span>
          </label>
          <label>
            {tx('จำนวนวัน (ถ้าคงที่)')}
            <input type="number" min={1} value={divisorValue} onChange={(e) => setDivisorValue(e.target.value)} />
          </label>
          <label>
            {tx('วันเริ่มสัญญา')}
            <DatePicker
              value={startDate}
              onChange={setStartDate}
              className={fieldErrors.has('startDate') ? 'err' : undefined}
              />
          </label>
          <label>
            {tx('วันสิ้นสุดสัญญา')}
            <DatePicker
              value={endDate}
              onChange={setEndDate}
              className={fieldErrors.has('endDate') ? 'err' : undefined}
              />
          </label>
          <label>
            VAT (%)
            <input type="number" min={0} max={100} step={0.1} value={vat} onChange={(e) => setVat(e.target.value)} readOnly={locked('vatRate')} />
            {lockNote('vatRate')}
          </label>
          <label>
            {tx('หัก ณ ที่จ่าย (%)')}
            <input type="number" min={0} max={100} step={0.1} value={wht} onChange={(e) => setWht(e.target.value)} readOnly={locked('whtRate')} />
            {lockNote('whtRate')}
          </label>
          <label>
            {tx('เครดิต (วัน)')}
            <input type="number" min={0} value={creditDays} onChange={(e) => setCreditDays(e.target.value)} readOnly={locked('creditDays')} />
            {lockNote('creditDays')}
          </label>
        </div>
      </div>

    </Card>
  );
}
