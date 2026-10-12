'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from './Icon';
import { AnimatedLogo } from './AnimatedLogo';
import { unreadCount, NOTIF_READ_EVENT } from '../lib/notifRead';
import { useToast } from './Overlays';
import { useLang } from '../lib/language';
import { NAV } from '../lib/nav';
import { ScopeProvider, useScope } from '../lib/scope';
import { ScopeFilterBar } from './ScopeFilterBar';

/** ย่อ/กางเมนูข้าง — ported from public/app.js's `SIDE_KEY`/`applySideState()`. จำสถานะไว้ใน
 * localStorage เพราะเป็นความชอบของคนใช้ ไม่ใช่ข้อมูลของระบบ */
const SIDE_KEY = 'obs.sideCollapsed';

interface PulseData {
  needsAction: number;
  waitingCheck: number;
  readyToApprove: number;
  feed: { items: Array<{ id: string | number }>; latestAt: string | null; counts: { total: number; critical: number } };
  flowAccountMode: string;
  manualMode: boolean;
  openTicketCount: number;
  actor: string;
  role: string;
}

/** ตัวกรอง site/PO/พนักงานอยู่ใน context ตัวเดียวทั้งแถบบนและเนื้อหา — เปลี่ยนแล้วสั่ง server component โหลดใหม่
 * (router.refresh) และให้เนื้อหาของหน้า mount ใหม่ผ่าน key={version} เพื่อให้ client component ที่ fetch เองตามไปด้วย */
export function AppShell(props: { user: { nameTh: string; role: string }; children: React.ReactNode }) {
  const router = useRouter();
  return (
    <ScopeProvider role={props.user.role} onChange={() => router.refresh()}>
      <AppShellInner {...props} />
    </ScopeProvider>
  );
}

function AppShellInner({
  user,
  children,
}: {
  user: { nameTh: string; role: string };
  children: React.ReactNode;
}) {
  const { version: scopeVersion, reloadOptions } = useScope();
  const pathname = usePathname();
  const router = useRouter();
  const { lang, setLang, tx } = useLang();
  const toast = useToast();
  const [whoOpen, setWhoOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const whoWrapRef = useRef<HTMLDivElement>(null);
  const [sideCollapsed, setSideCollapsed] = useState(false);
  /** เมนูข้างบนมือถือ — พับเป็น overlay ลอยแทนอยู่ในแนวเดียวกับเนื้อหา (ต่างจาก sideCollapsed ที่ย่อ
   * เหลือไอคอนบนจอใหญ่) ปิดเองทุกครั้งที่เปลี่ยนหน้า กันเมนูค้างเปิดบังเนื้อหาหลังกดลิงก์ไปแล้ว */
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const [pulseData, setPulseData] = useState<PulseData | null>(null);
  const nudgeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [, bumpReadTick] = useState(0);

  // หน้า "การแจ้งเตือน" กดอ่านแล้ว/อ่านทั้งหมด → localStorage เปลี่ยน แต่ป้ายกระดิ่งตรงนี้คำนวณจาก
  // pulseData ที่ถืออยู่แล้ว แค่ต้อง re-render ให้ unreadCount() อ่านค่าล่าสุดจาก localStorage ใหม่
  useEffect(() => {
    function onNotifRead() {
      bumpReadTick((t) => t + 1);
    }
    window.addEventListener(NOTIF_READ_EVENT, onNotifRead);
    return () => window.removeEventListener(NOTIF_READ_EVENT, onNotifRead);
  }, []);

  // อ่านสถานะย่อ/กางเมนูที่เคยตั้งไว้ตอน mount ฝั่ง client เท่านั้น (ตรงต้นฉบับ)
  useEffect(() => {
    try {
      const collapsed = localStorage.getItem(SIDE_KEY) === '1';
      setSideCollapsed(collapsed);
      document.body.classList.toggle('side-collapsed', collapsed);
    } catch {
      /* localStorage อาจถูกบล็อก — กางเมนูไว้เป็นค่าเริ่มต้นไปเลย */
    }
  }, []);

  // ปิดเมนูมือถืออัตโนมัติทุกครั้งที่เปลี่ยนหน้า (กดลิงก์ในเมนูก็ปิดผ่าน onClick ตรงๆ อยู่แล้ว แต่เผื่อ
  // เปลี่ยนหน้าด้วยวิธีอื่น เช่น ปุ่ม back ของเบราว์เซอร์)
  useEffect(() => {
    setMobileNavOpen(false);
  }, [pathname]);

  function toggleSideCollapsed() {
    const next = !sideCollapsed;
    setSideCollapsed(next);
    document.body.classList.toggle('side-collapsed', next);
    try {
      localStorage.setItem(SIDE_KEY, next ? '1' : '0');
    } catch {
      /* เงียบไว้ — แค่จำสถานะข้ามเซสชันไม่ได้ */
    }
  }

  // ปิดเมนูบัญชี เมื่อคลิกนอกกรอบ/กด Escape — ตรงกับ closeCtx()/closeWho() ของต้นฉบับ
  useEffect(() => {
    if (!whoOpen) return;
    function onDocClick(e: MouseEvent) {
      if (whoOpen && whoWrapRef.current && !whoWrapRef.current.contains(e.target as Node)) setWhoOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setWhoOpen(false);
      }
    }
    document.addEventListener('click', onDocClick);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('click', onDocClick);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [whoOpen]);

  const loadPulse = useCallback(async () => {
    try {
      const res = await fetch('/api/pulse', { cache: 'no-store' });
      if (!res.ok) return;
      setPulseData(await res.json());
    } catch {
      /* ป้ายพลาดไม่ควรทำให้หน้าพัง */
    }
  }, []);

  // pulse ทุก 60 วิ (SSE ด้านล่างช่วยให้ทันทีอีกทาง อันนี้กันพลาดเผื่อสายขาด)
  useEffect(() => {
    loadPulse();
    const timer = setInterval(loadPulse, 60_000);
    function onVisibility() {
      if (!document.hidden) loadPulse();
    }
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [loadPulse]);

  // รายชื่อบริษัท/สัญญาในดรอปดาวน์แถบบน โหลดครั้งเดียวตอน mount (AppShell เป็น layout ที่ไม่รู้ว่ามี
  // การสร้าง/แก้บริษัทใหม่เกิดขึ้นที่หน้าอื่นระหว่างนั้น) — SSE ด้านล่างช่วย refetch ให้ทันทีอีกทาง แต่พอร์ต
  // ตรงของ SSE อาจถูกบล็อก/ไม่เปิดในบางดีพลอย (เช่นหลัง reverse proxy) ทำให้ดรอปดาวน์ค้างว่างจนกว่าจะ
  // รีเฟรชหน้าเอง — กันพลาดด้วยการ refetch ทุกครั้งที่เปลี่ยนหน้าเช่นกัน ไม่ต้องพึ่ง SSE อย่างเดียว
  useEffect(() => {
    reloadOptions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  // SSE — เซิร์ฟเวอร์บอกเองว่ามีอะไรเปลี่ยน หน้าปัจจุบันตามให้ทันโดยไม่ต้องกดรีเฟรช
  //
  // ต่อผ่านเว็บ origin เดียวกัน (/api/stream → พร็อกซีไป apps/api — ดู app/api/stream/route.ts) เดิมต่อตรงพอร์ต 4301 ซึ่งปิดจากภายนอก
  // บน UAT/dev ทำให้ไม่เคยต่อติด ป้ายตัวเลขเมนู/ฟีดแจ้งเตือนเลยไม่อัปเดตหลังกดตีกลับ/ยืนยัน ฯลฯ จนกว่าจะรีเฟรช (12 ต.ค. 69)
  const nudge = useCallback(() => {
    if (nudgeTimer.current) clearTimeout(nudgeTimer.current);
    nudgeTimer.current = setTimeout(() => {
      loadPulse();
      reloadOptions();
      router.refresh();
    }, 200);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const stream = new EventSource('/api/stream', { withCredentials: true });
    stream.addEventListener('change', nudge);
    stream.addEventListener('open', () => loadPulse());
    return () => stream.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ไม่พึ่ง SSE อย่างเดียว: คำขอเขียนข้อมูล (POST/PATCH/PUT/DELETE ไปที่ /api/*) จากหน้าไหนก็ตามที่สำเร็จ = ข้อมูลเปลี่ยนแน่ๆ → รีเฟรชป้ายตัวเลข
  // รายการตัวกรอง และข้อมูลของหน้าที่เปิดอยู่ทันที (SSE ต่อไม่ติดหลัง proxy/ถูกตัด เกิดขึ้นได้จริง) ครอบคลุมทุกปุ่มทั้งระบบในจุดเดียว
  // ไม่ต้องไล่เติมทีละหน้า — ถอดตัวครอบออกตอนออกจากเลย์เอาต์
  useEffect(() => {
    const original = window.fetch;
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const response = await original(input, init);
      try {
        const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
        const url = typeof input === 'string' ? input : input instanceof URL ? input.pathname : input.url;
        if (response.ok && method !== 'GET' && method !== 'HEAD' && /\/api\//.test(url) && !/\/api\/auth\//.test(url)) nudge();
      } catch {
        /* ตัวครอบนี้ต้องไม่ทำให้คำขอจริงพังไม่ว่ากรณีใด */
      }
      return response;
    };
    return () => {
      window.fetch = original;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function logout() {
    setLoggingOut(true);
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } finally {
      router.push('/login');
      router.refresh();
    }
  }

  const initials = user.nameTh.trim().slice(0, 1) || '?';
  const roleLabel: Record<string, string> = {
    admin: 'ผู้ดูแลระบบ',
    accounting: 'บัญชี',
    user: 'พนักงาน',
    executive: 'ผู้บริหาร',
  };

  const bellUnread = pulseData ? unreadCount(pulseData.feed.items) : 0;
  const badgeValue: Record<string, number> = {
    queue: pulseData?.needsAction ?? 0,
    cycle: pulseData?.readyToApprove ?? 0,
    ticket: pulseData?.openTicketCount ?? 0,
    bell: bellUnread,
  };

  return (
    <>
      <header className="topbar">
        {/* ปุ่มกางเมนูข้าง — โผล่เฉพาะจอมือถือ (ดู CSS @media) เมนูข้างปกติอยู่ในแนวเดียวกับเนื้อหา
         * แคบไปจนใช้ไม่ได้บนจอมือถือ (เจ้าของระบบสั่ง 22 ก.ย. 69) จึงพับเป็น overlay ลอยแทน */}
        <button
          type="button"
          className="navtoggle"
          aria-label={tx('เปิดเมนู')}
          aria-expanded={mobileNavOpen}
          onClick={() => setMobileNavOpen((v) => !v)}
        >
          <Icon name="panel" />
        </button>
        <div className="brand">
          <AnimatedLogo height={30} />
        </div>
        <div className="gap" />

        {user.role !== 'user' && (
          <div className="scopef-top">
            <ScopeFilterBar />
          </div>
        )}

        {/* สลับภาษา ไทย/อังกฤษ — ported from public/app.js's #langSwitch */}
        <div className="langswitch" role="group" aria-label="Language">
          <span className={`opt${lang === 'th' ? ' on' : ''}`} onClick={() => setLang('th')}>
            TH
          </span>
          <span className={`opt${lang === 'en' ? ' on' : ''}`} onClick={() => setLang('en')}>
            EN
          </span>
        </div>

        <div className="who" ref={whoWrapRef}>
          <button type="button" className="whobtn" aria-expanded={whoOpen} onClick={() => setWhoOpen((v) => !v)}>
            <span className="av">{initials}</span>
            <span className="wt">
              <b>{user.nameTh}</b>
              <span>{tx(roleLabel[user.role] ?? user.role)}</span>
            </span>
            <Icon name="cd" className="sm cv" />
          </button>
          {whoOpen && (
            <div
              className="whomenu"
              style={{
                position: 'absolute',
                top: 'calc(100% + 8px)',
                right: 0,
                background: 'var(--paper)',
                border: '1px solid var(--rule)',
                borderRadius: 'var(--r-ctl)',
                boxShadow: 'var(--sh3)',
                minWidth: 180,
                padding: 6,
                zIndex: 60,
              }}
            >
              <button
                type="button"
                className="mtab"
                onClick={logout}
                disabled={loggingOut}
                style={{ color: 'var(--cr)' }}
              >
                <Icon name="signout" />
                <span>{loggingOut ? tx('กำลังออก…') : tx('ออกจากระบบ')}</span>
              </button>
            </div>
          )}
        </div>
      </header>

      <div className="shell">
        {mobileNavOpen && <div className="side-backdrop" onClick={() => setMobileNavOpen(false)} />}
        <aside className={`side${mobileNavOpen ? ' open' : ''}`}>
          <nav className="snav" aria-label="เมนูหลัก">
            {NAV.map((group, gi) => {
              const visibleItems = group.items.filter((item) => {
                if (item.adminOnly && user.role !== 'admin') return false;
                if (item.userOnly && user.role !== 'user') return false;
                if (item.roles && !item.roles.includes(user.role)) return false;
                return true;
              });
              if (visibleItems.length === 0) return null;
              return (
                <div key={gi}>
                  {group.label && <span className="sgrp">{tx(group.label)}</span>}
                  {visibleItems.map((item) => {
                    const active = pathname?.startsWith(item.href);
                    const badgeAllowed = !item.badgeRoles || item.badgeRoles.includes(user.role);
                    const badge = item.badgeKey && badgeAllowed ? badgeValue[item.badgeKey] : undefined;
                    return (
                      <Link key={item.href} href={item.href} className={`mtab${active ? ' on' : ''}`} onClick={() => setMobileNavOpen(false)}>
                        <Icon name={item.icon} />
                        <span>{tx(item.label)}</span>
                        {typeof badge === 'number' && badge > 0 && <span className="bdg">{item.badgeKey === 'bell' && badge > 9 ? '9+' : badge}</span>}
                      </Link>
                    );
                  })}
                </div>
              );
            })}
          </nav>

          <button type="button" className="sidetoggle" aria-pressed={sideCollapsed} title={tx(sideCollapsed ? 'กางเมนู' : 'ย่อเมนู')} onClick={toggleSideCollapsed}>
            <Icon name="panel" />
            <span>{tx('ย่อเมนู')}</span>
          </button>
        </aside>

        <div className="frame">
          {user.role !== 'user' && (
            <div className="scopef-strip">
              <ScopeFilterBar />
            </div>
          )}
          <main className="page" key={scopeVersion}>{children}</main>
        </div>
      </div>
    </>
  );
}
