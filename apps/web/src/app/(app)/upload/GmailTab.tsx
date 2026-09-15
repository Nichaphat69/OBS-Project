'use client';

import { useEffect, useState } from 'react';
import { Card, Tag } from '../../../components/ui';
import { Icon } from '../../../components/Icon';
import { useToast, usePdfPreview } from '../../../components/Overlays';
import ReviewCard, { type ReadResultShape } from './ReviewCard';
import ReadingCard from './ReadingCard';
import { useLang } from '../../../lib/language';

interface InboxAttachment {
  filename: string;
  size: number;
  attachmentId: string;
}
interface InboxMessage {
  id: string;
  subject: string;
  from: string;
  receivedAt: string | null;
  snippet: string;
  attachments: InboxAttachment[];
}
interface InboxResult {
  account: string;
  domain: string | null;
  activeCompanyName: string | null;
  domainMissing: boolean;
  skipped: number;
  messages: InboxMessage[];
  ingested: Array<InboxMessage & { periodLabel?: string | null; documentNo?: string | null }>;
}
interface DismissedItem {
  id: string;
  subject: string | null;
  from: string | null;
  receivedAt: string | null;
  dismissedBy: string | null;
  dismissedAt: string;
}
interface ActiveContract {
  id: string;
  customerId: string;
}
interface AiReadRef {
  id: number;
  sourceEmailId: string | null;
  fileName: string | null;
}

/** เดาโดเมนจากที่อยู่อีเมลผู้ส่ง เช่น "someone@ptt.co.th" → "ptt.co.th" */
function senderDomain(from: string): string | null {
  const match = /@([^\s>]+)/.exec(from);
  return match ? match[1].toLowerCase() : null;
}

export default function GmailTab() {
  const { tx } = useLang();
  const toast = useToast();
  const openPdfPreview = usePdfPreview();
  const [activeContract, setActiveContract] = useState<ActiveContract | null | undefined>(undefined);
  const [showAll, setShowAll] = useState(false);
  const [inbox, setInbox] = useState<InboxResult | null>(null);
  const [aiReadIds, setAiReadIds] = useState<Map<string, number>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [reading, setReading] = useState<string | null>(null);
  const [readingFileName, setReadingFileName] = useState<string | null>(null);
  const [result, setResult] = useState<ReadResultShape | null>(null);
  const [showDismissed, setShowDismissed] = useState(false);
  const [dismissed, setDismissed] = useState<DismissedItem[] | null>(null);

  function load() {
    setError(null);
    fetch('/api/contracts/active', { cache: 'no-store' })
      .then((r) => r.json())
      .then((c: ActiveContract | null) => {
        setActiveContract(c);
        const qs = c && !showAll ? `?contractId=${encodeURIComponent(c.id)}` : '';
        return fetch(`/api/gmail/inbox${qs}`, { cache: 'no-store' });
      })
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) {
          setError(data.error ?? tx('เชื่อมต่อ Gmail ไม่สำเร็จ'));
          return;
        }
        setInbox(data);
      });
    // แม็ปเมล+ไฟล์แนบที่เคยอ่านแล้ว → ai_read id เอาไว้เปิดพรีวิว (inbox ตัวเองไม่มี id นี้ติดมาด้วย)
    fetch('/api/ai-reads', { cache: 'no-store' })
      .then((r) => r.json())
      .then((rows: AiReadRef[]) => {
        setAiReadIds(new Map(rows.filter((r) => r.sourceEmailId && r.fileName).map((r) => [`${r.sourceEmailId}::${r.fileName}`, r.id])));
      })
      .catch(() => {});
  }

  useEffect(load, [showAll]);

  async function readAttachment(m: InboxMessage, attachmentFilename: string) {
    const messageId = m.id;
    setReading(`${messageId}::${attachmentFilename}`);
    setReadingFileName(attachmentFilename);
    setError(null);
    try {
      // โดเมนยังไม่เคยตั้ง (หรือกำลังดูแบบ "แสดงทุกบริษัท") — ผู้ใช้เลือกอ่านอีเมลนี้แปลว่ายอมรับว่า
      // โดเมนนี้เป็นของบริษัทที่กำลังดำเนินการอยู่ — บันทึกให้อัตโนมัติ (claim ครั้งแรกเท่านั้น เงียบไว้ถ้า 409)
      if (activeContract && (inbox?.domainMissing || showAll)) {
        const domain = senderDomain(m.from);
        if (domain) {
          await fetch(`/api/customers/${encodeURIComponent(activeContract.customerId)}/email-domain/claim`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ domain }),
          }).catch(() => {});
        }
      }
      const res = await fetch('/api/gmail/read', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ messageId, attachmentFilename }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? tx('อ่านไฟล์ไม่สำเร็จ'));
        return;
      }
      setResult(data);
    } catch (e: any) {
      setError(e.message ?? tx('เชื่อมต่อไม่สำเร็จ — ลองใหม่อีกครั้ง'));
    } finally {
      setReading(null);
    }
  }

  function openIngestedPreview(messageId: string, filename: string) {
    const id = aiReadIds.get(`${messageId}::${filename}`);
    if (!id) {
      toast(tx('พรีวิวไฟล์นี้ยังไม่พร้อมใช้งาน'));
      return;
    }
    openPdfPreview(`/api/ai-reads/${id}/file`, filename);
  }

  async function dismiss(messageId: string) {
    await fetch('/api/gmail/dismiss', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ messageId }),
    });
    load();
  }

  async function loadDismissed() {
    setShowDismissed(true);
    const res = await fetch('/api/gmail/dismissed', { cache: 'no-store' });
    setDismissed(await res.json());
  }

  async function undismiss(messageId: string) {
    await fetch('/api/gmail/undismiss', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ messageId }),
    });
    loadDismissed();
    load();
  }

  if (result) {
    return (
      <Card title={tx('ตรวจสอบก่อนบันทึก')}>
        <ReviewCard result={result} onDone={() => setResult(null)} />
      </Card>
    );
  }

  return (
    <>
      <Card
        title={tx('อีเมลแจ้งอนุมัติ Timesheet')}
        right={inbox ? <span className="sub">{tx('กล่องของ')} {inbox.account}</span> : undefined}
      >
      {error && <div style={{ color: 'var(--cr)', marginBottom: 14 }}>{error}</div>}

      {inbox && activeContract && !showAll && inbox.domain && (
        <div className="mailbanner">
          ⓘ {tx('กรองเฉพาะอีเมลของบริษัท')} <b>{inbox.activeCompanyName}</b> ({inbox.domain})
          <button type="button" className="lnk" onClick={() => setShowAll(true)}>
            {tx('แสดงทุกโดเมน')}
          </button>
        </div>
      )}

      {inbox && (showAll || inbox.domainMissing) && (
        <div className="mailbanner">
          ⓘ{' '}
          {inbox.domainMissing
            ? tx('ยังไม่ได้ตั้งโดเมนอีเมลของบริษัทนี้ไว้ — แสดงทุกฉบับที่ค้นเจอ ไม่กรองตามบริษัท')
            : tx('กำลังแสดงทุกโดเมน ไม่กรองตามโดเมนที่เลือกอยู่')}
          {activeContract && (
            <button type="button" className="lnk" onClick={() => setShowAll(false)}>
              {tx('กรองเฉพาะโดเมนนี้')}
            </button>
          )}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {inbox?.messages.map((m) => (
          <div key={m.id} style={{ border: '1px solid var(--hair)', borderRadius: 'var(--r-ctl)', padding: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
              <div>
                <div style={{ fontWeight: 600 }}>{m.subject}</div>
                <div className="sub">
                  {m.from} · {m.receivedAt?.slice(0, 19).replace('T', ' ')}
                </div>
              </div>
              <button className="btn ghost sm" onClick={() => dismiss(m.id)}>
                {tx('ซ่อน')}
              </button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 10 }}>
              {m.attachments.map((a) => (
                <div key={a.filename} className="mailattach">
                  <span className="fname">
                    <Icon name="file" className="sm" /> {a.filename} <Icon name="cd" className="xs" />
                  </span>
                  <button
                    className="btn sm pri"
                    disabled={reading === `${m.id}::${a.filename}`}
                    onClick={() => readAttachment(m, a.filename)}
                  >
                    {reading === `${m.id}::${a.filename}` ? tx('กำลังอ่าน…') : tx('อ่านข้อมูล')}
                  </button>
                </div>
              ))}
            </div>
          </div>
        ))}
        {inbox && inbox.messages.length === 0 && <div className="empty">{tx('ไม่มีอีเมลที่ต้องอ่าน')}</div>}

        {inbox && inbox.ingested.length > 0 && (
          <>
            <div className="ey" style={{ marginTop: 6 }}>
              {tx('เคยอ่านแล้ว')}
            </div>
            {inbox.ingested.map((m) => (
              <div key={m.id} style={{ border: '1px solid var(--hair)', borderRadius: 'var(--r-ctl)', padding: 14 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                  <div>
                    <div style={{ fontWeight: 600 }}>{m.subject}</div>
                    <div className="sub">
                      {m.from} · {m.receivedAt?.slice(0, 19).replace('T', ' ')}
                    </div>
                  </div>
                  <Tag tone="ok">{tx('อ่านแล้ว')}</Tag>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 10 }}>
                  {m.attachments.map((a) => (
                    <button key={a.filename} type="button" className="mailattach" onClick={() => openIngestedPreview(m.id, a.filename)}>
                      <span className="fname">
                        <Icon name="file" className="sm" /> {a.filename}
                      </span>
                      <span className="sub">{m.periodLabel ?? m.documentNo ?? ''}</span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </>
        )}
      </div>

      <div style={{ marginTop: 18, borderTop: '1px solid var(--hair)', paddingTop: 14 }}>
        <button className="btn ghost sm" onClick={() => (showDismissed ? setShowDismissed(false) : loadDismissed())}>
          {showDismissed ? tx('ซ่อน') : tx('ดูอีเมลที่เคยซ่อน')}
        </button>
        {showDismissed && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }}>
            {dismissed?.map((d) => (
              <div key={d.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                <span className="sub">{d.subject ?? d.id}</span>
                <button className="btn ghost sm" onClick={() => undismiss(d.id)}>
                  {tx('เลิกซ่อน')}
                </button>
              </div>
            ))}
            {dismissed?.length === 0 && <span className="sub">{tx('ยังไม่เคยซ่อนอีเมลใด')}</span>}
          </div>
        )}
      </div>
      </Card>
      {reading && <ReadingCard fileName={readingFileName} email />}
    </>
  );
}
