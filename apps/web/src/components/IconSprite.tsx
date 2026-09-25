/**
 * Same inline SVG symbol sprite as public/index.html's `<symbol id="i-...">` set — ported
 * verbatim so `<Icon name="grid" />` renders identically to the old app's icons. Mount once
 * in the root layout; individual icons render via <use href="#i-...">.
 */
export default function IconSprite() {
  return (
    <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true">
      <defs>
        {/* ไล่สีฟ้าอ่อน→เข้ม ใช้กับไอคอนเมนูที่กำลังเลือกอยู่ (.mtab.on svg.i { stroke: url(#navicon-grad) })
            ต้องประกาศแบบ SVG paint server เพราะ CSS gradient ธรรมดาใส่ตรง stroke ไม่ได้ */}
        <linearGradient id="navicon-grad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" style={{ stopColor: 'var(--brand-l)' }} />
          <stop offset="1" style={{ stopColor: 'var(--brand-d)' }} />
        </linearGradient>
      </defs>
      <symbol id="i-grid" viewBox="0 0 24 24">
        <rect x="3" y="3" width="7" height="7" rx="1.5" />
        <rect x="14" y="3" width="7" height="7" rx="1.5" />
        <rect x="3" y="14" width="7" height="7" rx="1.5" />
        <rect x="14" y="14" width="7" height="7" rx="1.5" />
      </symbol>
      <symbol id="i-bld" viewBox="0 0 24 24">
        <path d="M4 21V6a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v15" />
        <path d="M15 11h3a2 2 0 0 1 2 2v8M2 21h20M8 8h3M8 12h3M8 16h3" />
      </symbol>
      <symbol id="i-bell" viewBox="0 0 24 24">
        <path d="M18 8a6 6 0 1 0-12 0c0 7-3 8-3 8h18s-3-1-3-8" />
        <path d="M13.7 21a2 2 0 0 1-3.4 0" />
      </symbol>
      {/* โซ่เชื่อมสองห่วง (เมนู "เชื่อมต่อ LINE") — เดิมใช้ i-bell ซ้ำกับเมนู "การแจ้งเตือน" ทำให้แยกกัน
          ไม่ออกในแถบเมนู (เจ้าของระบบชี้ 25 ก.ย. 69) แยกเป็นไอคอนของตัวเอง สื่อถึง "เชื่อมต่อบัญชี" ตรงๆ */}
      <symbol id="i-link" viewBox="0 0 24 24">
        <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
        <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
      </symbol>
      <symbol id="i-up" viewBox="0 0 24 24">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <path d="M12 3v13M7.5 7.5 12 3l4.5 4.5" />
      </symbol>
      {/* ลูกศรลงเข้าถาด — คนละแบบกับ i-cd (ลูกศรชี้ลงเฉยๆ ใช้กับปุ่มขยาย/dropdown) ตั้งใจแยกไว้เพราะปุ่ม
          "ดาวน์โหลด" ใช้ i-cd ผิดมาก่อน (23 ก.ย. 69) หน้าตาเหมือนปุ่ม dropdown ทำให้เข้าใจผิด */}
      <symbol id="i-download" viewBox="0 0 24 24">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <path d="M12 3v11M7.5 10l4.5 4.5L16.5 10" />
      </symbol>
      <symbol id="i-list-chk" viewBox="0 0 24 24">
        <path d="M11 6h10M11 12h10M11 18h6" />
        <path d="m3 6 1.6 1.6L7.5 4.7M3 16.4 4.6 18l2.9-2.9" />
      </symbol>
      <symbol id="i-envelope-plus" viewBox="0 0 24 24">
        <rect x="2.5" y="4.5" width="14" height="12" rx="2" />
        <path d="m3 6.5 7 5 7-5" />
        <path d="M19.5 13v6M16.5 16h6" />
      </symbol>
      <symbol id="i-invoice" viewBox="0 0 24 24">
        <path d="M7 2.5h7l4 4V20a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V3.5a1 1 0 0 1 1-1Z" />
        <path d="M14 2.5v4h4M9 12h6M9 15.5h6" />
        <circle cx="17" cy="18" r="2.6" />
        <path d="M17 16.6v2.8" />
      </symbol>
      <symbol id="i-alt" viewBox="0 0 24 24">
        <path d="M12 9v4M12 17h.01" />
        <circle cx="12" cy="12" r="9.5" />
      </symbol>
      <symbol id="i-users" viewBox="0 0 24 24">
        <path d="M16 20v-1.5a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4V20" />
        <circle cx="9" cy="7" r="3.2" />
        <path d="M22 20v-1.5a4 4 0 0 0-3-3.85M16.5 4.2a3.2 3.2 0 0 1 0 6" />
      </symbol>
      <symbol id="i-monitor" viewBox="0 0 24 24">
        <path d="M21 15V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2ZM8 21h8m-4-4v4" />
      </symbol>
      <symbol id="i-cog" viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 1.55V21a2 2 0 1 1-4 0v-.11A1.7 1.7 0 0 0 9 19.4a1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.55-1H3a2 2 0 1 1 0-4h.11A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.6h.05A1.7 1.7 0 0 0 10 3.05V3a2 2 0 1 1 4 0v.11A1.7 1.7 0 0 0 15 4.6a1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 9v.05a1.7 1.7 0 0 0 1.55 1H21a2 2 0 1 1 0 4h-.11a1.7 1.7 0 0 0-1.49 1Z" />
      </symbol>
      <symbol id="i-signout" viewBox="0 0 24 24">
        <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
        <path d="M16 17l5-5-5-5" />
        <path d="M21 12H9" />
      </symbol>
      <symbol id="i-signin" viewBox="0 0 24 24">
        <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
        <path d="M10 17l5-5-5-5" />
        <path d="M15 12H3" />
      </symbol>
      <symbol id="i-cd" viewBox="0 0 24 24">
        <path d="m6 9 6 6 6-6" />
      </symbol>
      <symbol id="i-back" viewBox="0 0 24 24">
        <path d="M19 12H5M11 18l-6-6 6-6" />
      </symbol>
      <symbol id="i-panel" viewBox="0 0 24 24">
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <path d="M9.5 4v16" />
      </symbol>
      <symbol id="i-act" viewBox="0 0 24 24">
        <path d="M21 12h-4l-2.5 6-4-13L8 12H3" />
      </symbol>
      <symbol id="i-clock" viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="9.5" />
        <path d="M12 7.5V12l3 2" />
      </symbol>
      <symbol id="i-eye" viewBox="0 0 24 24">
        <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z" />
        <circle cx="12" cy="12" r="3" />
      </symbol>
      <symbol id="i-eye-off" viewBox="0 0 24 24">
        <path d="M3 3l18 18" />
        <path d="M10.6 5.2A10.6 10.6 0 0 1 12 5c6.4 0 10 7 10 7a17.6 17.6 0 0 1-3.4 4.4M6.6 6.6C4 8.3 2 12 2 12s3.6 7 10 7a10.4 10.4 0 0 0 4-.8" />
        <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
      </symbol>
      <symbol id="i-file" viewBox="0 0 24 24">
        <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z" />
        <path d="M14 3v5h5M9 13h6M9 17h4" />
      </symbol>
      <symbol id="i-x" viewBox="0 0 24 24">
        <path d="M18 6 6 18M6 6l12 12" />
      </symbol>
      <symbol id="i-chk" viewBox="0 0 24 24">
        <path d="M20 6 9 17l-5-5" />
      </symbol>
      <symbol id="i-doc" viewBox="0 0 24 24">
        <path d="M8 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2h-2" />
        <rect x="8" y="1.8" width="8" height="4" rx="1.4" />
        <path d="M8 11h8M8 15h5" />
      </symbol>
      <symbol id="i-trash" viewBox="0 0 24 24">
        <path d="M4 7h16M9 7V4.5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1V7M6 7l1 13a2 2 0 0 0 2 1.8h6a2 2 0 0 0 2-1.8l1-13" />
        <path d="M10 11v6M14 11v6" />
      </symbol>
      <symbol id="i-trash-solid" viewBox="0 0 24 24">
        <path d="M9 3.5A1.5 1.5 0 0 1 10.5 2h3A1.5 1.5 0 0 1 15 3.5V5h4.25a.75.75 0 0 1 0 1.5H19l-1.06 13.06A2.25 2.25 0 0 1 15.7 21.5H8.3a2.25 2.25 0 0 1-2.24-1.94L5 6.5h-.25a.75.75 0 0 1 0-1.5H9V3.5Zm1.5 1.5h3V3.5h-3V5ZM9.75 10a.75.75 0 0 0-.75.75v6.5a.75.75 0 0 0 1.5 0v-6.5a.75.75 0 0 0-.75-.75Zm4.5 0a.75.75 0 0 0-.75.75v6.5a.75.75 0 0 0 1.5 0v-6.5a.75.75 0 0 0-.75-.75Z" />
      </symbol>
      <symbol id="i-info" viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="9.5" />
        <path d="M12 16v-4.5M12 8h.01" />
      </symbol>
      <symbol id="i-building" viewBox="0 0 24 24">
        <path d="M3 21h18M3 7v14m18-14v14M9 21V11h6v10M7 3h10" />
      </symbol>
      <symbol id="i-edit" viewBox="0 0 24 24">
        <path d="M12 20h9" />
        <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
      </symbol>
      <symbol id="i-money" viewBox="0 0 24 24">
        <rect x="2.5" y="6" width="19" height="12" rx="2" />
        <circle cx="12" cy="12" r="2.6" />
        <path d="M6 12h.01M18 12h.01" />
      </symbol>
      <symbol id="i-sickface" viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="10" />
        <path d="M8 15s1.5-2 4-2 4 2 4 2M9 9h.01M15 9h.01" />
      </symbol>
      <symbol id="i-idcard" viewBox="0 0 24 24">
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <path d="M7 8h10M7 12h10M7 16h4" />
      </symbol>
      <symbol id="i-plane" viewBox="0 0 24 24">
        <path d="M22 2 11 13M22 2l-7 20-4-9-9-4 20-7Z" />
      </symbol>
      <symbol id="i-gift" viewBox="0 0 24 24">
        <rect x="3" y="8" width="18" height="13" rx="1.5" />
        <path d="M3 8h18M12 8v13" />
        <path d="M8 8a2.5 2.5 0 0 1 0-5c1.8 0 3 1.6 4 5M16 8a2.5 2.5 0 0 0 0-5c-1.8 0-3 1.6-4 5" />
      </symbol>
      <symbol id="i-cal" viewBox="0 0 24 24">
        <rect x="3" y="5" width="18" height="16" rx="2" />
        <path d="M3 10h18M8 3v4M16 3v4" />
      </symbol>
      <symbol id="i-rf" viewBox="0 0 24 24">
        <path d="M21 12a9 9 0 1 1-2.64-6.36M21 3v5h-5" />
      </symbol>
      <symbol id="i-send" viewBox="0 0 24 24">
        <path d="M21.5 2.5 11 13M21.5 2.5l-7 19-3.5-8.5L2.5 9.5Z" />
      </symbol>
      <symbol id="i-mail" viewBox="0 0 24 24">
        <rect x="2.5" y="4.5" width="19" height="15" rx="2" />
        <path d="m3 6.5 9 6 9-6" />
      </symbol>
      {/* สองอันล่างไม่ได้มาจากสไปรต์เดิมของแอปเก่า — เพิ่มใหม่ตอนทำช่องค้นหา/แถวพับได้ในสารบัญฟิลด์
          วาดด้วยเส้นระยะเดียวกับที่เหลือ จะได้ไม่ดูหลุดชุด */}
      <symbol id="i-search" viewBox="0 0 24 24">
        <circle cx="11" cy="11" r="6.5" />
        <path d="m16 16 4.5 4.5" />
      </symbol>
      <symbol id="i-chev" viewBox="0 0 24 24">
        <path d="m7 10 5 5 5-5" />
      </symbol>
    </svg>
  );
}
