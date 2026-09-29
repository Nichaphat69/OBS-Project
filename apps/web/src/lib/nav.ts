/**
 * เมนูหลัก (แถบด้านซ้าย) — อยู่ในไฟล์ของตัวเองแทนที่จะฝังใน AppShell.tsx เพราะ BackButton ต้องรู้ด้วยว่า
 * หน้าไหนเป็น "หน้าแรกของเมนูหลัก" (หน้าพวกนี้ไม่ต้องมีปุ่มย้อนกลับ — เจ้าของระบบสั่ง 25 ก.ย. 69)
 * ถ้า BackButton import จาก AppShell ตรงๆ จะเกิดวงจร import: ui → BackButton → AppShell → Overlays → ui
 * ไฟล์นี้จึงต้องไม่ import อะไรจาก components/ เลย เป็นข้อมูลล้วนๆ
 */
export interface NavItem {
  href: string;
  label: string;
  icon: string;
  badgeKey?: 'queue' | 'cycle' | 'ticket' | 'bell';
  /** role ที่เห็นตัวเลขบนเมนูได้ — แยกจาก `roles` เพราะบางเมนูเปิดให้ทุกคนเข้า แต่ตัวเลขเป็นของทีมหลังบ้าน
   *  (เช่น "บันทึกการส่ง": พนักงานเข้าได้แต่ไม่ควรเห็นจำนวนตั๋วค้างของทั้งบริษัท ซึ่งไม่ใช่ของเขา) */
  badgeRoles?: string[];
  adminOnly?: boolean;
  userOnly?: boolean;
  roles?: string[];
}

export interface NavGroup {
  label?: string;
  items: NavItem[];
}

/* การมองเห็นเมนูแต่ละอันตามตาราง NAV_VISIBLE เดิมใน app.js (31 ส.ค./1 ก.ย. 69 ตามที่ขอ 4 role:
   admin/accounting/user/executive — server บล็อก 403 ไว้อีกชั้นสำหรับ endpoint ที่มีผลจริงอยู่แล้ว
   (ดู requireAdmin/requireSuperAdmin) ฝั่งนี้ซ่อนเมนูไว้เป็นแค่ความสะดวก):
   - admin/accounting: เห็นเหมือนกันทุกอย่าง ยกเว้น Skill ABBYY/จัดการระบบ/แจ้งปัญหา เฉพาะ admin
   - user (พนักงาน): เห็นแค่ "ความคืบหน้าของฉัน" + "อัปโหลด Timesheet" ของตัวเอง (+ "การแจ้งเตือน" ที่เปิด
     ให้ทุก role เห็นเหมือนกันหมด)
   - executive: เห็นแค่ "ภาพรวมทุกบริษัท" อย่างเดียว ดูได้ล้วนๆ ทำอะไรไม่ได้เลย */
export const NAV: NavGroup[] = [
  {
    items: [
      { href: '/dashboard', label: 'แดชบอร์ด', icon: 'grid', roles: ['admin', 'accounting'] },
      { href: '/my-progress', label: 'ความคืบหน้าของฉัน', icon: 'grid', roles: ['user'] },
      { href: '/companies', label: 'ภาพรวมทุกบริษัท', icon: 'bld', roles: ['executive'] },
      { href: '/notifications', label: 'การแจ้งเตือน', icon: 'bell', badgeKey: 'bell' },
    ],
  },
  {
    label: 'ขั้นตอนการทำงาน',
    items: [
      { href: '/upload', label: 'อัปโหลด Timesheet', icon: 'up', roles: ['admin', 'accounting', 'user'] },
      { href: '/manday', label: 'ตรวจ Manday', icon: 'list-chk', badgeKey: 'queue', roles: ['admin', 'accounting'] },
      { href: '/billing', label: 'วางบิล & ร่างอีเมล', icon: 'mail', badgeKey: 'cycle', roles: ['admin', 'accounting'] },
    ],
  },
  {
    label: 'อ้างอิง',
    items: [
      { href: '/invoices', label: 'ใบแจ้งหนี้', icon: 'money', roles: ['admin', 'accounting'] },
      // เดิมชื่อ "แจ้งปัญหา" และเป็น adminOnly — ตอนนี้กลายเป็นหน้ารวมบันทึกการส่ง Timesheet ตามรอบบิล
      // โดยมีแจ้งปัญหาเป็นแท็บหนึ่งข้างใน พนักงานจึงเข้าได้ด้วย แต่เห็นเฉพาะของตัวเอง — การกัน "เห็นของ
      // คนอื่น" อยู่ที่ API (เส้น /mine ผูก employeeId จาก session) ไม่ใช่ที่การซ่อนเมนูตรงนี้
      { href: '/submissions', label: 'บันทึกการส่ง', icon: 'send', roles: ['admin', 'accounting', 'user'], badgeKey: 'ticket', badgeRoles: ['admin'] },
      { href: '/master', label: 'ข้อมูลหลัก', icon: 'users', roles: ['admin', 'accounting'] },
      { href: '/readers', label: 'ตัวอ่าน Timesheet', icon: 'eye', roles: ['admin', 'accounting'] },
      { href: '/admin', label: 'จัดการระบบ', icon: 'cog', adminOnly: true },
      // เดิม userOnly (เฉพาะ role พนักงาน) — 24 ก.ย. 69 เปิดให้ admin/accounting เห็นเมนูนี้ด้วย
      // (ผูกไลน์คนละคอลัมน์กันในฐานข้อมูล ดู staffLineLinkService.ts) ไม่จำกัด role เลย — executive
      // เห็นได้ด้วยแต่ไม่มีประโยชน์อะไร (ไม่มีแจ้งเตือนอะไรผูกกับ role นี้) ปล่อยผ่านไว้เฉยๆ ไม่คุ้มเขียน
      // เงื่อนไขแยกอีกเส้นเพื่อกันแค่ role เดียว
      // ไอคอนเดิม 'bell' ซ้ำกับเมนู "การแจ้งเตือน" ด้านบน แยกไม่ออกในแถบเมนู (เจ้าของระบบชี้ 25 ก.ย. 69)
      // เปลี่ยนเป็น 'link' (โซ่เชื่อมสองห่วง) สื่อถึง "เชื่อมต่อบัญชี" ตรงตัวกว่า
      { href: '/my-line-link', label: 'เชื่อมต่อ LINE', icon: 'link' },
      // ใหม่ (29 ก.ย. 69) — ย้ายการผูกกล่อง Gmail ออกจากไฟล์ .env บนเครื่องมาไว้บนหน้าเว็บ
      // เปิดให้แผนกบัญชีด้วย ไม่ใช่แค่ admin เพราะคนที่ต้องกดยินยอมคือเจ้าของกล่องเมลซึ่งอยู่ฝั่งบัญชี
      { href: '/gmail-link', label: 'เชื่อมต่อ Gmail', icon: 'mail', roles: ['admin', 'accounting'] },
      // ใหม่ (24 ก.ย. 69 ตามที่ขอ) — แจ้งปัญหาจากเว็บได้เอง แนบรูปได้ ต่างจากทาง LINE เดิม (พิมพ์ข้อความ
      // ล้วนๆ) ที่ยังใช้ได้อยู่เหมือนเดิมคู่ขนานกัน จำกัดแค่ role 'user' เพราะ SupportTicket ผูกกับ
      // employeeId ตรงๆ (admin/accounting ไม่มี employeeId ของตัวเอง)
      { href: '/report-issue', label: 'แจ้งปัญหา', icon: 'alt', userOnly: true },
    ],
  },
];

/** ปลายทางของเมนูหลักทุกอัน — หน้าพวกนี้คือ "หน้าแรก" ของแต่ละเมนู กดย้อนกลับจากตรงนี้ไม่มีความหมาย */
export const TOP_LEVEL_HREFS = new Set(NAV.flatMap((g) => g.items.map((i) => i.href)));
