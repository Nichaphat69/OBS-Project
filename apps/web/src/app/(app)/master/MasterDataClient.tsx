'use client';

import { useState } from 'react';
import { PageHeader } from '../../../components/ui';
import EmployeesTab from './EmployeesTab';
import CustomersContractsTab from './CustomersContractsTab';
import HolidaysTab from './HolidaysTab';
import { useLang } from '../../../lib/language';

const TABS = [
  { key: 'employees', label: 'พนักงาน & ชื่อพ้อง' },
  { key: 'customers', label: 'ลูกค้า & สัญญา' },
  { key: 'holidays', label: 'วันหยุด' },
] as const;

/** ported from public/app.js's renderMaster() — หน้า "ข้อมูลหลัก" 3 แท็บ ฐานข้อมูลที่ทั้ง 3 ขั้นตอน
 * (อัปโหลด/ตรวจ Manday/วางบิล) ใช้ร่วมกัน ใช้ตัวสลับแท็บแบบ "pill button" เดียวกับแท็บ Admin/period
 * อื่นๆ ในสแต็กใหม่ (จงใจต่างจากต้นฉบับที่ใช้เส้นใต้ `.tabs`/`.tab` เพื่อความสม่ำเสมอในสแต็กนี้) */
export default function MasterDataClient() {
  const [tab, setTab] = useState<(typeof TABS)[number]['key']>('employees');
  const { tx } = useLang();

  return (
    <>
      <PageHeader
        eyebrow={tx('อ้างอิง')}
        title={tx('ข้อมูลหลัก')}
        subtitle={tx('ฐานข้อมูลที่ทั้ง 3 ขั้นใช้ร่วมกัน — จับคู่ชื่อ · หาเรทค่าบริการ · นับวันทำงานของเดือน')}
      />

      <div style={{ display: 'flex', gap: 8, marginBottom: 22, flexWrap: 'wrap' }}>
        {TABS.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)} className={`btn sm${tab === t.key ? ' pri' : ''}`}>
            {tx(t.label)}
          </button>
        ))}
      </div>

      {tab === 'employees' && <EmployeesTab />}
      {tab === 'customers' && <CustomersContractsTab />}
      {tab === 'holidays' && <HolidaysTab />}
    </>
  );
}
