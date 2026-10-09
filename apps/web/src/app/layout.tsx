import type { Metadata } from 'next';
import { Noto_Sans_Thai } from 'next/font/google';
import IconSprite from '../components/IconSprite';
import { OverlayProvider } from '../components/Overlays';
import { LanguageProvider } from '../lib/language';
import './globals.css';
import './polish.css';

/** ฟอนต์หลักของทั้งระบบ — เจ้าของระบบสั่ง 22 ก.ย. 69 ให้เปลี่ยนจาก system-font stack เดิม (ที่พึ่งฟอนต์
 * ไทยของ OS แต่ละเครื่อง เช่น Sukhumvit Set/Leelawadee UI) มาเป็น Noto Sans Thai ตัวเดียวกันทุกเครื่อง
 * โหลดผ่าน next/font/google (self-host ตอน build ไม่ยิง request ออกไปหา Google ตอน runtime) — ตัวแปร
 * CSS (--font-noto-thai) ไปใช้เป็นอันดับแรกใน body's font-family ที่ globals.css แทนของเดิม */
const notoSansThai = Noto_Sans_Thai({
  subsets: ['thai', 'latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-noto-thai',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'OBS — ระบบวางบิล Outsource (new stack)',
  description: 'Next.js + Express + Prisma migration — design matches the legacy OBS UI.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="th" className={notoSansThai.variable}>
      <body>
        <IconSprite />
        <LanguageProvider>
          <OverlayProvider>{children}</OverlayProvider>
        </LanguageProvider>
      </body>
    </html>
  );
}
