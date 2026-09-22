/** โลโก้เคลื่อนไหว iPassion OBS — เจ้าของระบบสั่ง 22 ก.ย. 69 ให้เปลี่ยนจากตัวหนังสือไล่สีเฉยๆ เป็นไอคอน
 * กราฟแท่งเติบโต + เส้นแนวโน้มวาดตามมาแบบเคลื่อนไหว (SVG + CSS keyframes ล้วน ไม่พึ่ง library ภายนอก)
 * โผล่ที่แถบบน (เล็ก) และหน้า login (ใหญ่กว่า)
 *
 * รอบสอง (22 ก.ย. 69) — เจ้าของระบบขอให้เคลื่อนไหวตลอดไป ไม่ใช่เล่นครั้งเดียวจบเหมือนรอบแรก จึงเปลี่ยนจาก
 * `forwards` (ค้างเฟรมสุดท้าย) เป็น `infinite alternate` (โต→หด→โต→หด ไปเรื่อยๆ, เส้นวาดไปข้างหน้า→ย้อนกลับ
 * →วาดไปข้างหน้า สลับกันตลอด) ใช้ keyframe ชุดเดิมทุกอย่าง แค่เปลี่ยนวิธีเล่นซ้ำ ไม่ต้องออกแบบใหม่ทั้งหมด
 * — เคารพ prefers-reduced-motion เหมือนเดิม (ปิดอนิเมชันให้คนที่ตั้งค่านี้ไว้)
 *
 * height ควบคุมทั้งไอคอนกราฟและขนาดตัวอักษรให้เป็นสัดส่วนกัน (ปรับจุดเดียวพอ ไม่ต้องส่ง prop แยกสองค่า) */
export function AnimatedLogo({ height = 32 }: { height?: number }) {
  const textSize = Math.round(height * 0.62);
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: height * 0.28 }}>
      <svg
        width={height * 1.2}
        height={height}
        viewBox="0 0 120 100"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
        style={{ flex: 'none' }}
      >
        <defs>
          <linearGradient id="ipassionLogoGrad" x1="0%" y1="100%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="var(--brand-l)" />
            <stop offset="100%" stopColor="var(--brand-d)" />
          </linearGradient>
        </defs>
        <style>{`
          .ipl-bar { transform-origin: bottom; animation: ipl-grow 1.6s ease-in-out infinite alternate; }
          .ipl-b1 { animation-delay: 0s; }
          .ipl-b2 { animation-delay: 0.18s; }
          .ipl-b3 { animation-delay: 0.36s; }
          .ipl-line { stroke-dasharray: 300; animation: ipl-draw 2.6s ease-in-out infinite alternate; }
          @keyframes ipl-grow { from { transform: scaleY(0.72); } to { transform: scaleY(1); } }
          @keyframes ipl-draw { from { stroke-dashoffset: 300; } to { stroke-dashoffset: 0; } }
          @media (prefers-reduced-motion: reduce) {
            .ipl-bar, .ipl-line { animation: none; transform: none; stroke-dashoffset: 0; }
          }
        `}</style>
        <rect className="ipl-bar ipl-b1" x="12" y="55" width="22" height="40" rx="6" fill="url(#ipassionLogoGrad)" />
        <rect className="ipl-bar ipl-b2" x="44" y="32" width="22" height="63" rx="6" fill="url(#ipassionLogoGrad)" />
        <rect className="ipl-bar ipl-b3" x="76" y="10" width="22" height="85" rx="6" fill="url(#ipassionLogoGrad)" />
        <path
          className="ipl-line"
          d="M 5 85 Q 35 60, 55 68 T 115 25"
          fill="none"
          stroke="url(#ipassionLogoGrad)"
          strokeWidth="7"
          strokeLinecap="round"
        />
      </svg>
      <span
        style={{
          fontWeight: 800,
          fontSize: textSize,
          letterSpacing: '-0.02em',
          background: 'linear-gradient(135deg, var(--brand-l), var(--brand-d))',
          WebkitBackgroundClip: 'text',
          backgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
          color: 'var(--brand)',
          whiteSpace: 'nowrap',
        }}
      >
        iPassion OBS
      </span>
    </span>
  );
}
