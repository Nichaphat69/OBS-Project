'use client';

import { useEffect, useState } from 'react';
import { Card, ErrorState } from '../../../components/ui';
import { Icon } from '../../../components/Icon';
import { useConfirm, useToast } from '../../../components/Overlays';
import { useLang } from '../../../lib/language';
import { SETTINGS_CHANGED_EVENT } from '../../../lib/settingsChanged';

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
}
/** ลูกค้าที่สร้างไว้แล้วแต่ยังไม่มีสัญญาเลย — ดู GET /api/customers/without-contract */
interface CustomerWithoutContract {
  id: string;
  nameTh: string;
  taxId: string;
}
interface FlowAccountEmployee {
  nameTh: string;
  invoicePosition: string;
  monthlyRate: number;
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
  employees: FlowAccountEmployee[];
}

/** ปุ่มเชื่อมต่อ FlowAccount — ย้ายมาจากแถบบน (topbar) เดิม เพราะเป็นสวิตช์ที่คุมข้อมูลลูกค้า/สัญญาที่
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
          ? 'ระบบจะเริ่มเชื่อมต่อกับ FlowAccount จริง ดึงข้อมูลบริษัท/พนักงานได้ และใช้ยิงเอกสารตอนกดอนุมัติวางบิล'
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
function dateOnly(iso: string, lang: 'th' | 'en'): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(lang === 'en' ? 'en-US' : 'th-TH', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** ปัดเป็นทศนิยม 2 ตำแหน่งไม่ให้เพี้ยนจาก floating point (เช่น 0.0158*100 อาจได้ 1.5800000000000001)
 * แต่ไม่บังคับโชว์ทศนิยมท้ายที่ไม่มีนัยสำคัญ (3% ยังโชว์ "3" ไม่ใช่ "3.00") */
function pctPrecise(rate: number) {
  return Math.round(rate * 10000) / 100;
}

/** ช่องอัตราหัก ณ ที่จ่าย พร้อมปุ่มดินสอแก้เฉพาะช่องนี้ — เดิมมีแต่ตัวเลขปัดเศษเต็ม (Math.round) ล้วนๆ
 * แก้ค่าละเอียด (เช่น 1.58%) ไม่ได้เลยนอกจากเปิดฟอร์ม "แก้ไขข้อมูลสัญญา" ทั้งใบซึ่งต้องกรอกทุกช่อง
 * ยิงตรงไปที่ PATCH /:id/wht-rate (จุดเดียวกับที่หน้าอัปโหลด/ตรวจ Timesheet ใช้อยู่แล้ว) ไม่ผ่าน
 * updateContract() แบบ full-replace — validation 0–30% อยู่ฝั่ง server (updateContractWhtRate) แล้ว */
function WhtRateCell({ contract, onSaved }: { contract: ContractRow; onSaved: () => void }) {
  const toast = useToast();
  const { tx } = useLang();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(String(pctPrecise(contract.whtRate)));
  const [saving, setSaving] = useState(false);

  async function save() {
    const pct = Number(value);
    if (!Number.isFinite(pct) || pct < 0 || pct > 30) {
      toast(tx('อัตราหัก ณ ที่จ่ายต้องอยู่ระหว่าง 0–30%'), true);
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/contracts/${encodeURIComponent(contract.id)}/wht-rate`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ whtRate: pct / 100 }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast(data?.error ?? tx('บันทึกไม่สำเร็จ'), true);
        return;
      }
      toast(tx('บันทึกอัตราหัก ณ ที่จ่ายแล้ว'));
      setEditing(false);
      onSaved();
    } catch {
      toast(tx('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้'), true);
    } finally {
      setSaving(false);
    }
  }

  if (!editing) {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        {pctPrecise(contract.whtRate)}%
        <button
          type="button"
          className="btn sm icon"
          title={tx('แก้อัตราหัก ณ ที่จ่าย')}
          aria-label={tx('แก้ไข')}
          onClick={() => {
            setValue(String(pctPrecise(contract.whtRate)));
            setEditing(true);
          }}
        >
          <Icon name="edit" />
        </button>
      </span>
    );
  }

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <input
        type="number"
        min={0}
        max={30}
        step={0.01}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        autoFocus
        style={{
          width: 64,
          height: 30,
          borderRadius: 'var(--r-ctl)',
          border: '1px solid var(--rule)',
          padding: '0 8px',
          fontSize: 12.5,
        }}
      />
      %
      <button type="button" className="btn sm pri" disabled={saving} onClick={save}>
        {tx('บันทึก')}
      </button>
      <button type="button" className="btn sm ghost" disabled={saving} onClick={() => setEditing(false)}>
        {tx('ยกเลิก')}
      </button>
    </span>
  );
}

/** ported from public/app.js's renderMaster() tab 2 (ลูกค้า & สัญญา) + renderCustomerAddForm()/
 * renderContractEditForm() */
export default function CustomersContractsTab() {
  const confirm = useConfirm();
  const toast = useToast();
  const { tx, lang } = useLang();

  const [contracts, setContracts] = useState<ContractRow[] | null>(null);
  const [orphanCustomers, setOrphanCustomers] = useState<CustomerWithoutContract[]>([]);
  const [addOpen, setAddOpen] = useState(false);
  const [editContractId, setEditContractId] = useState<string | null>(null);
  const [addContractForCustomerId, setAddContractForCustomerId] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function load() {
    setError(null);
    fetch('/api/contracts', { cache: 'no-store' })
      .then(async (r) => {
        if (!r.ok) {
          const data = await r.json().catch(() => ({}));
          setError(data?.error ?? tx('โหลดข้อมูลไม่สำเร็จ'));
          return;
        }
        setContracts(await r.json());
      })
      .catch(() => setError(tx('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้')));
    // ลูกค้าที่สร้างไว้แต่ยังไม่มีสัญญา (เพิ่งแยกขั้นตอนสร้างลูกค้า/สัญญาออกจากกัน) — ล้มเหลวได้เงียบๆ
    // เพราะไม่ใช่ข้อมูลหลักของหน้านี้ ไม่ควรทำให้ทั้งหน้าใช้งานไม่ได้ถ้าดึงไม่สำเร็จ
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

  async function deleteContract(contract: ContractRow) {
    const ok = await confirm({
      iconName: 'trash-solid',
      danger: true,
      title: tx('ลบสัญญานี้?'),
      message: `"${contract.poNo} — ${contract.projectName}" ${tx('และพนักงาน/Timesheet ทั้งหมดของสัญญานี้จะหายไปถาวร — กู้คืนไม่ได้ (ลบได้เฉพาะสัญญาที่ยังไม่เคยออกใบแจ้งหนี้เลยเท่านั้น ถ้าเคยวางบิลไปแล้วแม้แต่ใบเดียว ระบบจะปฏิเสธการลบทั้งหมด)')}`,
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

  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!contracts) return null;

  return (
    <>
      <div className="metabar">
        <span className="ey">{contracts.length} {tx('บริษัท')}</span>
        <FlowAccountToggle />
        <button className="btn pri sm" onClick={() => setAddOpen(true)}>
          <Icon name="grid" className="sm" /> {tx('เพิ่มลูกค้าใหม่')}
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

      {/* ลูกค้าที่สร้างไว้แล้วแต่ยังไม่มีสัญญา (เพิ่งเพิ่มลูกค้าแบบเว้นสัญญาไว้ก่อน) — ต้องมีที่ให้กลับมา
          หาแล้วเพิ่มสัญญาต่อได้ ไม่งั้นลูกค้ากลุ่มนี้จะหายไปจากหน้านี้ถาวรเพราะรายการหลักไล่จากสัญญา */}
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
          <Card title={tx('ลูกค้าที่ยังไม่มีสัญญา')} right={<span className="rt">{orphanCustomers.length}</span>}>
            <div className="tasklist">
              {orphanCustomers.map((o) => (
                <div key={o.id} className="taskrow">
                  <div className="tt">
                    <b>{o.nameTh}</b>
                    <span>{tx('เลขผู้เสียภาษี')} {o.taxId}</span>
                  </div>
                  <button className="btn pri sm" onClick={() => setAddContractForCustomerId(o.id)}>
                    {tx('เพิ่มสัญญา')}
                  </button>
                </div>
              ))}
            </div>
          </Card>
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
          <Card
            key={c.id}
            title={`${c.poNo} — ${c.projectName}`}
            right={
              <div className="rowacts">
                <label
                  className={`toggle${c.status === 'active' ? ' on' : ''}`}
                  title={tx(c.status === 'active' ? 'กำลังดำเนินการอยู่ — ปิดไปยังไม่มีบริษัทอื่นมาแทนที่อัตโนมัติ' : 'ปิดอยู่ — เปิดเพื่อให้ระบบทำงานกับบริษัทนี้ (จะปิดบริษัทอื่นที่เปิดอยู่ให้เองอัตโนมัติ)')}
                >
                  <input type="checkbox" checked={c.status === 'active'} disabled={togglingId === c.id} onChange={(e) => toggleActive(c, e.target.checked)} />
                  <span className="tk" />
                  <span className="tl">{c.status === 'active' ? tx('กำลังดำเนินการ') : tx('ปิดอยู่')}</span>
                </label>
                <button className="btn sm icon" title={tx('แก้ไขข้อมูลสัญญา')} aria-label={tx('แก้ไข')} onClick={() => setEditContractId(c.id)}>
                  <Icon name="edit" />
                </button>
                <button className="btn sm icon dgr" title={tx('ลบสัญญานี้')} aria-label={tx('ลบ')} onClick={() => deleteContract(c)}>
                  <Icon name="trash" />
                </button>
              </div>
            }
          >
            <div className="g2">
              <dl className="kv">
                <dt>{tx('ลูกค้า')}</dt>
                <dd>{c.customerName}</dd>
                <dt>{tx('เลขผู้เสียภาษี')}</dt>
                <dd className="n">{c.taxId}</dd>
                <dt>{tx('เลขที่สัญญา')}</dt>
                <dd className="n">{c.contractNo ?? '—'}</dd>
                <dt>{tx('ช่วงสัญญา')}</dt>
                <dd>
                  {dateOnly(c.startDate, lang)} – {dateOnly(c.endDate, lang)}
                </dd>
                <dt>{tx('จำนวนคน')}</dt>
                <dd className="n">{c.headcount} {tx('คน')}</dd>
              </dl>
              <dl className="kv">
                <dt>{tx('ยอดต่อเดือน')}</dt>
                <dd className="n">{money(c.monthlyTotal)} {tx('บาท')}</dd>
                <dt>{tx('ตัวหารอัตราต่อวัน')}</dt>
                <dd>{c.divisorMode === 'fixed' ? `${tx('คงที่')} ${c.divisorValue}` : tx('วันทำงานจริงของเดือน')}</dd>
                <dt>VAT</dt>
                <dd className="n">{Math.round(c.vatRate * 100)}%</dd>
                <dt>{tx('หัก ณ ที่จ่าย')}</dt>
                <dd className="n">
                  <WhtRateCell contract={c} onSaved={load} />
                </dd>
                <dt>{tx('เครดิต')}</dt>
                <dd className="n">{c.creditDays} {tx('วัน')}</dd>
                <dt>{tx('ผู้ประสานงาน')}</dt>
                <dd>
                  {c.contactName ?? '—'} {c.contactPhone ?? ''}
                </dd>
                {c.billingPlace && (
                  <>
                    <dt>{tx('สถานที่วางบิล')}</dt>
                    <dd>{c.billingPlace}</dd>
                  </>
                )}
              </dl>
            </div>
          </Card>
        ),
      )}
    </>
  );
}

/** ฟอร์ม "เพิ่มลูกค้าใหม่" — สร้างลูกค้า + สัญญาแรกในคราวเดียว เพราะลูกค้าที่ไม่มีสัญญาเลยใช้งานอะไร
 * ไม่ได้ (ไม่มีอัตราจ้าง ไม่มีรอบบิล) */
function CustomerAddForm({ onCancel, onSaved }: { onCancel: () => void; onSaved: () => void }) {
  const toast = useToast();
  const { tx } = useLang();
  const [faCompanies, setFaCompanies] = useState<FlowAccountCompany[]>([]);
  const [faIndex, setFaIndex] = useState('');
  const [faContactId, setFaContactId] = useState<string | null>(null);
  const [faHint, setFaHint] = useState('');

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
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch('/api/flowaccount/companies', { cache: 'no-store' })
      .then((r) => r.json())
      .then(setFaCompanies)
      .catch(() => setFaCompanies([]));
  }, []);

  function onFromFaChange(indexStr: string) {
    setFaIndex(indexStr);
    const c = faCompanies[Number(indexStr)];
    if (!c) return;
    setNameTh(c.nameTh);
    setTaxId(c.taxId);
    setBranch(c.branch || 'สำนักงานใหญ่');
    setAddress(c.address ?? '');
    setContactName(c.contactName ?? '');
    setContactPhone(c.contactPhone ?? '');
    setContactEmail(c.contactEmail ?? '');
    if (c.projectName) setProjectName(c.projectName);
    setFaContactId(c.flowaccountContactId);
    setFaHint(c.employees?.length ? `${tx('ดึงพนักงาน')} ${c.employees.length} ${tx('คน + เรทต่อเดือนจากใบเสนอราคานี้มาให้อัตโนมัติ')}` : tx('ใบเสนอราคานี้ไม่มีรายชื่อพนักงานให้ดึง — เพิ่มพนักงานเองทีหลังได้จากแท็บ "พนักงาน & ชื่อพ้อง"'));
  }

  async function save() {
    const nt = nameTh.trim();
    const ti = taxId.trim();
    const po = poNo.trim();
    const pn = projectName.trim();
    if (!nt || !ti) {
      toast(tx('กรอกชื่อบริษัทและเลขผู้เสียภาษีให้ครบก่อน'), true);
      return;
    }
    // สัญญาไม่บังคับกรอกตอนสร้างลูกค้าอีกต่อไป (createCustomer() เองก็ต้องการแค่ชื่อ+เลขผู้เสียภาษี
    // อยู่แล้ว) แต่ถ้าจะกรอกสัญญาด้วยก็ต้องครบทั้ง 4 ช่อง เพราะ createContract() ฝั่ง server ยัง
    // ต้องการครบเหมือนเดิม — ไม่แตะ validation นั้นเพราะมีเหตุผลของมันเอง (บิล/PO อ้างอิงฟิลด์พวกนี้)
    const hasAnyContractField = Boolean(po || pn || startDate || endDate);
    const hasAllContractFields = Boolean(po && pn && startDate && endDate);
    if (hasAnyContractField && !hasAllContractFields) {
      toast(tx('ถ้าจะเพิ่มสัญญาด้วยเลย ต้องกรอกเลขที่ใบว่าจ้าง ชื่อโครงการ และช่วงสัญญาให้ครบ — หรือเว้นว่างทั้งหมดไว้ก่อนแล้วเพิ่มสัญญาทีหลังก็ได้'), true);
      return;
    }
    setSaving(true);
    try {
      const customerRes = await fetch('/api/customers', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          nameTh: nt,
          taxId: ti,
          branch: branch.trim() || undefined,
          address: address.trim() || null,
          creditDays: Number(creditDays) || 30,
          contactName: contactName.trim() || null,
          contactPhone: contactPhone.trim() || null,
          contactEmail: contactEmail.trim() || null,
          billingPlace: billingPlace.trim() || null,
          flowaccountContactId: faContactId || null,
        }),
      });
      const customer = await customerRes.json();
      if (!customerRes.ok) {
        toast(customer?.error ?? tx('สร้างลูกค้าไม่สำเร็จ'), true);
        setSaving(false);
        return;
      }

      if (!hasAllContractFields) {
        // ยังไม่กรอกสัญญาเลย — สร้างแค่ลูกค้าไว้ก่อน ไปเพิ่มสัญญาทีหลังได้จากรายการ "ลูกค้าที่ยังไม่มี
        // สัญญา" ด้านบน (ดึงจาก GET /api/customers/without-contract)
        toast(`${tx('เพิ่มลูกค้า')} "${nt}" ${tx('แล้ว — ยังไม่มีสัญญา เพิ่มสัญญาให้ทีหลังได้จากรายการ "ลูกค้าที่ยังไม่มีสัญญา" ด้านบน')}`);
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
          startDate,
          endDate,
          vatRate: (Number(vat) || 0) / 100,
          whtRate: (Number(wht) || 0) / 100,
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
                startDate,
                endDate,
                quotationNo: faCompany.quotationNo || null,
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
      title={tx('เพิ่มลูกค้าใหม่')}
      right={<span className="rt">{tx('กรอกข้อมูลบริษัทและสัญญาแรกในคราวเดียว')}</span>}
      footer={
        <>
          <button className="btn" onClick={onCancel}>
            {tx('ยกเลิก')}
          </button>
          <button className="btn pri" disabled={saving} onClick={save}>
            {tx('บันทึกลูกค้าใหม่')}
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
                  <option key={c.flowaccountContactId} value={i}>
                    {c.nameTh} ({c.quotationNo ?? '—'})
                  </option>
                ))}
              </select>
            </span>
          </label>
          <small className="fhint">{faHint}</small>
        </div>
      )}

      <div className="frm">
        <label>
          {tx('ชื่อบริษัท')}
          <input value={nameTh} onChange={(e) => setNameTh(e.target.value)} placeholder="เช่น บริษัท ทดสอบ จำกัด" />
        </label>
        <label>
          {tx('เลขผู้เสียภาษี')}
          <input value={taxId} onChange={(e) => setTaxId(e.target.value)} />
        </label>
        <label>
          {tx('สาขา')}
          <input value={branch} onChange={(e) => setBranch(e.target.value)} />
        </label>
        <label>
          {tx('ที่อยู่')}
          <input value={address} onChange={(e) => setAddress(e.target.value)} />
        </label>
        <label>
          {tx('เครดิต (วัน)')}
          <input type="number" min={0} value={creditDays} onChange={(e) => setCreditDays(e.target.value)} />
        </label>
        <label>
          {tx('ผู้ประสานงาน')}
          <input value={contactName} onChange={(e) => setContactName(e.target.value)} />
        </label>
        <label>
          {tx('เบอร์ผู้ประสานงาน')}
          <input value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} />
        </label>
        <label>
          {tx('อีเมลผู้ประสานงาน')}
          <input type="email" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} />
        </label>
        <label>
          {tx('สถานที่วางบิล')}
          <input value={billingPlace} onChange={(e) => setBillingPlace(e.target.value)} />
        </label>
      </div>

      <div className="fsec">
        <div className="fsec-h">
          <b>{tx('สัญญาแรก')}</b>
          <span style={{ fontSize: 12, color: 'var(--mut)' }}>{tx('ไม่บังคับ — เว้นว่างไว้ก่อนแล้วเพิ่มสัญญาทีหลังก็ได้')}</span>
        </div>
        <div className="frm">
          <label>
            {tx('เลขที่ใบว่าจ้าง (PO)')}
            <input value={poNo} onChange={(e) => setPoNo(e.target.value)} placeholder="เช่น 26/B0200" />
          </label>
          <label>
            {tx('เลขที่สัญญา')}
            <input value={contractNo} onChange={(e) => setContractNo(e.target.value)} />
          </label>
          <label>
            {tx('ชื่อโครงการ')}
            <input value={projectName} onChange={(e) => setProjectName(e.target.value)} />
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
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </label>
          <label>
            {tx('วันสิ้นสุดสัญญา')}
            <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
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
        <small className="fhint">{tx('พนักงาน/อัตราจ้างของลูกค้ารายนี้เพิ่มได้ทีหลังจากแท็บ "พนักงาน & ชื่อพ้อง"')}</small>
      </div>

    </Card>
  );
}

/** ฟอร์ม "เพิ่มสัญญา" ให้ลูกค้าที่มีอยู่แล้วแต่ยังไม่มีสัญญาเลย (มาจาก CustomerAddForm ที่แยกขั้นตอนไว้
 * ให้เว้นสัญญาว่างไว้ก่อนได้) validation ฝั่งนี้ครบทุกช่องเหมือน createContract() ฝั่ง server เดิม
 * ไม่ได้ผ่อนอะไรลง แค่แยกเวลากรอกออกจากตอนสร้างลูกค้าเท่านั้น */
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

  async function save() {
    const po = poNo.trim();
    const pn = projectName.trim();
    if (!po || !pn || !startDate || !endDate) {
      toast(tx('กรอกเลขที่ใบว่าจ้าง ชื่อโครงการ และช่วงสัญญาให้ครบก่อน'), true);
      return;
    }
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
          <input value={poNo} onChange={(e) => setPoNo(e.target.value)} placeholder="เช่น 26/B0200" />
        </label>
        <label>
          {tx('เลขที่สัญญา')}
          <input value={contractNo} onChange={(e) => setContractNo(e.target.value)} />
        </label>
        <label>
          {tx('ชื่อโครงการ')}
          <input value={projectName} onChange={(e) => setProjectName(e.target.value)} />
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
          <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        </label>
        <label>
          {tx('วันสิ้นสุดสัญญา')}
          <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
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
      <small className="fhint">{tx('พนักงาน/อัตราจ้างของลูกค้ารายนี้เพิ่มได้ทีหลังจากแท็บ "พนักงาน & ชื่อพ้อง"')}</small>
    </Card>
  );
}

/** ฟอร์ม "แก้ไขข้อมูลสัญญา" — แก้ทั้งลูกค้า+สัญญาในคราวเดียว (มาแทนที่การ์ดของสัญญานั้นเลยในหน้า) */
function ContractEditForm({ contract, onCancel, onSaved }: { contract: ContractRow; onCancel: () => void; onSaved: () => void }) {
  const toast = useToast();
  const { tx } = useLang();
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

  async function save() {
    const cnt = customerNameTh.trim();
    const ti = taxId.trim();
    const po = poNo.trim();
    const pn = projectName.trim();
    if (!cnt || !ti || !po || !pn || !startDate || !endDate) {
      toast(tx('กรอกชื่อบริษัท เลขผู้เสียภาษี เลขที่ใบว่าจ้าง ชื่อโครงการ และช่วงสัญญาให้ครบก่อน'), true);
      return;
    }
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
          {contract.poNo} — {contract.projectName}
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
          <input value={customerNameTh} onChange={(e) => setCustomerNameTh(e.target.value)} />
        </label>
        <label>
          {tx('เลขผู้เสียภาษี')}
          <input value={taxId} onChange={(e) => setTaxId(e.target.value)} />
        </label>
        <label>
          {tx('ผู้ประสานงาน')}
          <input value={contactName} onChange={(e) => setContactName(e.target.value)} />
        </label>
        <label>
          {tx('เบอร์ผู้ประสานงาน')}
          <input value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} />
        </label>
        <label>
          {tx('สถานที่วางบิล')}
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
            <input value={poNo} onChange={(e) => setPoNo(e.target.value)} />
          </label>
          <label>
            {tx('เลขที่สัญญา')}
            <input value={contractNo} onChange={(e) => setContractNo(e.target.value)} />
          </label>
          <label>
            {tx('ชื่อโครงการ')}
            <input value={projectName} onChange={(e) => setProjectName(e.target.value)} />
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
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </label>
          <label>
            {tx('วันสิ้นสุดสัญญา')}
            <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          </label>
          <label>
            VAT (%)
            <input type="number" min={0} max={100} step={0.1} value={vat} onChange={(e) => setVat(e.target.value)} />
          </label>
          <label>
            {tx('หัก ณ ที่จ่าย (%)')}
            <input type="number" min={0} max={100} step={0.1} value={wht} onChange={(e) => setWht(e.target.value)} />
          </label>
          <label>
            {tx('เครดิต (วัน)')}
            <input type="number" min={0} value={creditDays} onChange={(e) => setCreditDays(e.target.value)} />
          </label>
        </div>
      </div>

    </Card>
  );
}
