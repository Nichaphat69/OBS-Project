import type { Metadata } from 'next';
import IconSprite from '../components/IconSprite';
import { OverlayProvider } from '../components/Overlays';
import { LanguageProvider } from '../lib/language';
import './globals.css';

export const metadata: Metadata = {
  title: 'OBS — ระบบวางบิล Outsource (new stack)',
  description: 'Next.js + Express + Prisma migration — design matches the legacy OBS UI.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="th">
      <body>
        <IconSprite />
        <LanguageProvider>
          <OverlayProvider>{children}</OverlayProvider>
        </LanguageProvider>
      </body>
    </html>
  );
}
