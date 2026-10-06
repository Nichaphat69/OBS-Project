'use client';

import { useLang } from '../lib/language';

/** ปุ่มสลับ TH/EN ของหน้าที่ยังไม่ล็อกอิน (Login/Register/ลืมรหัสผ่าน) — ใช้คลาส .langswitch ชุดเดียวกับแถบบนของแอป
 * ลอยมุมขวาบนของหน้า ภาษาที่เลือกจำไว้ใน localStorage ชุดเดียวกัน จึงตามผู้ใช้เข้าไปในระบบด้วย */
export function LangSwitch() {
  const { lang, setLang } = useLang();
  return (
    <div className="langswitch" role="group" aria-label="Language" style={{ position: 'fixed', top: 16, right: 16, zIndex: 10 }}>
      <span className={`opt${lang === 'th' ? ' on' : ''}`} onClick={() => setLang('th')}>
        TH
      </span>
      <span className={`opt${lang === 'en' ? ' on' : ''}`} onClick={() => setLang('en')}>
        EN
      </span>
    </div>
  );
}
