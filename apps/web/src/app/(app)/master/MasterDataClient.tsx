'use client';

import { useState } from 'react';
import { PageHeader, TabStrip } from '../../../components/ui';
import EmployeesTab from './EmployeesTab';
import CustomersContractsTab from './CustomersContractsTab';
import HolidaysTab from './HolidaysTab';
import { useLang } from '../../../lib/language';

const TABS = [
  { key: 'customers', label: 'สัญญาบริษัท' },
  { key: 'employees', label: 'พนักงาน' },
  { key: 'holidays', label: 'วันหยุด' },
] as const;

/** ported from public/app.js's renderMaster() — หน้า "ข้อมูลหลัก" 3 แท็บ ฐานข้อมูลที่ทั้ง 3 ขั้นตอน
 * (อัปโหลด/ตรวจ Manday/วางบิล) ใช้ร่วมกัน ใช้ตัวสลับแท็บแบบ "pill button" เดียวกับแท็บ Admin/period
 * อื่นๆ ในสแต็กใหม่ (จงใจต่างจากต้นฉบับที่ใช้เส้นใต้ `.tabs`/`.tab` เพื่อความสม่ำเสมอในสแต็กนี้)
 *
 * ลำดับ/ชื่อแท็บแก้ตามที่เจ้าของระบบสั่ง 18 ก.ย. 69: "สัญญาบริษัท" มาก่อน "พนักงาน" เพราะพนักงาน
 * เข้าระบบได้ผ่านสัญญาเท่านั้น (ดูคอมเมนต์ใน EmployeesTab.tsx) ลำดับแท็บจึงควรสะท้อนลำดับงานจริง */
export default function MasterDataClient() {
  const [tab, setTab] = useState<(typeof TABS)[number]['key']>('customers');
  const { tx } = useLang();

  return (
    <>
      <PageHeader eyebrow={tx('อ้างอิง')} title={tx('ข้อมูลหลัก')} />

      <TabStrip tabs={TABS} active={tab} onChange={setTab} />

      {tab === 'employees' && <EmployeesTab />}
      {tab === 'customers' && <CustomersContractsTab />}
      {tab === 'holidays' && <HolidaysTab />}
    </>
  );
}
