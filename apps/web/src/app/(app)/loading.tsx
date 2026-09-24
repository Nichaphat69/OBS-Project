'use client';

import { Loading } from '../../components/ui';

/** โชว์ทันทีตอนกดเปลี่ยนหน้าในแอป ระหว่างรอ server component ของหน้าถัดไป — เดิมหน้าเก่าค้างอยู่เฉยๆ
 * จนหน้าใหม่มาครบ ดูเหมือนกดไม่ติด (เจ้าของระบบสั่ง 24 ก.ย. 69) */
export default function AppLoading() {
  return (
    <div>
      <div className="skel-bar" style={{ width: 120, marginBottom: 10 }} />
      <div className="skel-bar lg" style={{ width: 260, marginBottom: 28 }} />
      <Loading variant="cards" rows={4} />
      <div className="card" style={{ marginTop: 22 }}>
        <div className="bd">
          <Loading rows={6} />
        </div>
      </div>
    </div>
  );
}
