'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { PageHeader, Card, ErrorState } from '../../../components/ui';
import { Icon } from '../../../components/Icon';
import { readIds, markRead } from '../../../lib/notifRead';
import { useLang } from '../../../lib/language';

interface FeedItem {
  id: string | number;
  at: string;
  by: string;
  level: string;
  title: string;
  detail: string;
  link: { view: string; id?: string; contractId?: string; period?: string } | null;
}
interface Feed {
  items: FeedItem[];
  latestAt: string | null;
  counts: { total: number; critical: number };
}

const LEVEL_TONE: Record<string, 'cr' | 'wn' | 'ok' | 'info'> = { critical: 'cr', warn: 'wn', ok: 'ok', info: 'info' };
const LEVEL_LABEL: Record<string, string> = { critical: 'ผิดพลาด', warn: 'ตีกลับ', ok: 'สำเร็จ', info: '' };
const LEVEL_ICON: Record<string, string> = { critical: 'alt', warn: 'alt', ok: 'chk', info: 'info' };

/** ported from public/app.js's ago() — เวลาแบบอ่านง่าย ใกล้ๆ บอกเป็นนาที ไกลแล้วบอกเป็นวันที่ */
function ago(iso: string | null, tx: (th: string) => string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  const min = Math.floor((Date.now() - d.getTime()) / 60000);
  if (min < 1) return tx('เมื่อสักครู่');
  if (min < 60) return `${min} ${tx('นาทีที่แล้ว')}`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} ${tx('ชั่วโมงที่แล้ว')}`;
  const day = Math.floor(hr / 24);
  if (day === 1) return tx('เมื่อวาน');
  if (day < 7) return `${day} ${tx('วันที่แล้ว')}`;
  return iso.slice(0, 10);
}

export default function NotificationsClient({ role }: { role: string }) {
  const router = useRouter();
  const { tx } = useLang();
  const [feed, setFeed] = useState<Feed | null>(null);
  const [readSet, setReadSet] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  function load() {
    setError(null);
    fetch(role === 'user' ? '/api/my-notifications' : '/api/activity?limit=50', { cache: 'no-store' })
      .then(async (r) => {
        if (!r.ok) {
          const data = await r.json().catch(() => ({}));
          setError(data?.error ?? tx('โหลดข้อมูลไม่สำเร็จ'));
          return;
        }
        const data: Feed = await r.json();
        setFeed(data);
        setReadSet(readIds());
      })
      .catch(() => setError(tx('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้')));
  }

  useEffect(load, [role]);

  if (error) {
    return (
      <>
        <PageHeader eyebrow={tx('แจ้งเตือน')} title={tx('การแจ้งเตือน')} />
        <ErrorState message={error} onRetry={load} />
      </>
    );
  }
  if (!feed) return null;

  const unreadCount = feed.items.filter((i) => !readSet.has(String(i.id))).length;

  function openNotification(item: FeedItem) {
    markRead([item.id]);
    setReadSet(readIds());
    const link = item.link;
    if (!link) return;
    if (link.view === 'detail' && link.id) {
      router.push(`/manday/${encodeURIComponent(link.id)}`);
      return;
    }
    if (link.view === 'cycle' && link.contractId && link.period) {
      router.push(`/billing/${encodeURIComponent(link.contractId)}/${encodeURIComponent(link.period)}`);
      return;
    }
    if (link.view === 'master') {
      router.push('/master');
      return;
    }
    if (link.view === 'myProgress') {
      router.push('/my-progress');
    }
  }

  function markAll() {
    if (!feed) return;
    markRead(feed.items.map((i) => i.id));
    setReadSet(readIds());
  }

  return (
    <>
      <PageHeader
        eyebrow={tx('แจ้งเตือน')}
        title={tx('การแจ้งเตือน')}
        subtitle={unreadCount ? `${tx('ยังไม่ได้อ่าน')} ${unreadCount} ${tx('เรื่อง')}` : tx('อ่านครบแล้ว')}
        actions={
          unreadCount ? (
            <button className="btn" onClick={markAll}>
              {tx('อ่านแล้วทั้งหมด')}
            </button>
          ) : undefined
        }
      />
      <Card flush>
        {feed.items.length === 0 ? (
          <div className="bp-empty">{tx('ยังไม่มีเหตุการณ์ในระบบ')}</div>
        ) : (
          <ul className="bp-list">
            {feed.items.map((n) => {
              const unread = !readSet.has(String(n.id));
              const tone = LEVEL_TONE[n.level] ?? 'info';
              return (
                <li key={n.id}>
                  <button className={unread ? 'unread' : ''} onClick={() => openNotification(n)}>
                    <span className={`tic ${tone}`}>
                      <Icon name={LEVEL_ICON[n.level] ?? 'info'} />
                    </span>
                    <span className="bp-tx">
                      <span className="bp-t">{tx(n.title)}</span>
                      <span className="bp-d">{tx(n.detail)}</span>
                      <span className="bp-m">
                        {ago(n.at, tx)} · {tx('โดย')} {n.by}
                      </span>
                    </span>
                    {LEVEL_LABEL[n.level] && <span className={`tg ${tone}`}>{tx(LEVEL_LABEL[n.level])}</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </>
  );
}
