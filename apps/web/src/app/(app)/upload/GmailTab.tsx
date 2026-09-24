'use client';

import { useEffect, useState } from 'react';
import { Card, Loading, Tag } from '../../../components/ui';
import { Icon } from '../../../components/Icon';
import { useToast, usePdfPreview } from '../../../components/Overlays';
import { useReaderPicker, ReaderPickerBar } from '../../../components/ReaderPicker';
import ReviewCard, { type ReadResultShape } from './ReviewCard';
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
interface BulkReadItem {
  key: string;
  messageId: string;
  filename: string;
  status: 'queued' | 'reading' | 'done' | 'failed';
  error?: string;
  result?: ReadResultShape;
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
  const [showDismissed, setShowDismissed] = useState(false);
  const [dismissed, setDismissed] = useState<DismissedItem[] | null>(null);
  // 25 ก.ย. 69 ตามที่ขอ — เดิมมีแต่ปุ่ม "อ่านข้อมูล" ทีละไฟล์แนบ เปลี่ยนเป็นติ๊กเลือกได้หลายไฟล์แนบ + เลือก
  // ตัวอ่าน/Skill เอง + ปุ่ม "อ่านที่เลือก (N)" ครั้งเดียว — Gmail ไม่มีคิวเบื้องหลังแบบไฟล์อัปโหลด (ต้อง
  // เช็คสถานะอนุมัติจากเนื้ออีเมลประกอบด้วยเสมอ) จึงอ่านทีละไฟล์ตามลำดับ (sequential) แทน ไม่ใช่ขนาน แต่
  // ผู้ใช้เห็นภาพเดียวกัน: เลือกไว้ กดครั้งเดียว แล้วดูสถานะแต่ละไฟล์เปลี่ยนไปเรื่อยๆ
  const picker = useReaderPicker();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkItems, setBulkItems] = useState<BulkReadItem[] | null>(null);
  const [bulkOpenResult, setBulkOpenResult] = useState<ReadResultShape | null>(null);

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

  function toggleAttachment(key: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const selectableKeys = (inbox?.messages ?? []).flatMap((m) => m.attachments.map((a) => `${m.id}::${a.filename}`));
  const allSelected = selectableKeys.length > 0 && selectableKeys.every((k) => selected.has(k));

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(selectableKeys));
  }

  /** อ่านไฟล์แนบหนึ่งไฟล์จริงๆ — เรียกซ้ำจาก doReadSelected() ทีละรายการตามลำดับ (Gmail ไม่มีคิว
   * เบื้องหลังแบบไฟล์อัปโหลด ต้องเช็คสถานะอนุมัติจากเนื้ออีเมลประกอบทุกครั้ง) */
  async function readOne(messageId: string, attachmentFilename: string): Promise<{ ok: true; data: ReadResultShape } | { ok: false; error: string }> {
    try {
      const m = inbox?.messages.find((mm) => mm.id === messageId);
      // โดเมนยังไม่เคยตั้ง (หรือกำลังดูแบบ "แสดงทุกบริษัท") — ผู้ใช้เลือกอ่านอีเมลนี้แปลว่ายอมรับว่า
      // โดเมนนี้เป็นของบริษัทที่กำลังดำเนินการอยู่ — บันทึกให้อัตโนมัติ (claim ครั้งแรกเท่านั้น เงียบไว้ถ้า 409)
      if (m && activeContract && (inbox?.domainMissing || showAll)) {
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
        body: JSON.stringify({
          messageId,
          attachmentFilename,
          readerId: picker.readerId,
          abbyySkillId: picker.chosenReaderId === 'abbyy' ? picker.abbyySkillId : null,
        }),
      });
      const data = await res.json();
      if (!res.ok) return { ok: false, error: data.error ?? tx('อ่านไฟล์ไม่สำเร็จ') };
      return { ok: true, data };
    } catch (e: any) {
      return { ok: false, error: e.message ?? tx('เชื่อมต่อไม่สำเร็จ — ลองใหม่อีกครั้ง') };
    }
  }

  /** อ่านทุกไฟล์แนบที่ติ๊กไว้ทีละไฟล์ตามลำดับ — เห็นสถานะเปลี่ยนไปเรื่อยๆ ทีละแถว ไม่ต้องรอครบทุกไฟล์
   * ก่อนเห็นผลไฟล์แรก */
  async function doReadSelected() {
    const list = [...selected].map((key) => {
      const idx = key.indexOf('::');
      return { key, messageId: key.slice(0, idx), filename: key.slice(idx + 2) };
    });
    if (list.length === 0) return;

    setError(null);
    setBulkItems(list.map(({ key, messageId, filename }) => ({ key, messageId, filename, status: 'queued' })));
    setSelected(new Set());

    for (const { key, messageId, filename } of list) {
      setBulkItems((prev) => prev!.map((it) => (it.key === key ? { ...it, status: 'reading' } : it)));
      const outcome = await readOne(messageId, filename);
      setBulkItems((prev) =>
        prev!.map((it) =>
          it.key === key
            ? outcome.ok
              ? { ...it, status: 'done', result: outcome.data }
              : { ...it, status: 'failed', error: outcome.error }
            : it,
        ),
      );
    }
    load();
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

  /* เปิด ReviewCard ทับหน้าความคืบหน้า (25 ก.ย. 69) — ตรวจสอบ/ยืนยันไฟล์ที่อ่านเสร็จแล้วได้ตรงนี้เลย
     ปิดแล้วกลับมาที่รายการความคืบหน้าเดิม (ไม่รีเซ็ต bulkItems) */
  if (bulkOpenResult) {
    return (
      <Card title={tx('ตรวจสอบก่อนบันทึก')}>
        <ReviewCard result={bulkOpenResult} onDone={() => setBulkOpenResult(null)} />
      </Card>
    );
  }

  /* หน้าความคืบหน้าหลังกด "อ่านที่เลือก" (25 ก.ย. 69 ตามที่ขอ) — อ่านทีละไฟล์ตามลำดับ เห็นสถานะเปลี่ยน
     ไปเรื่อยๆ ทีละแถว แถวไหน "เสร็จแล้ว" คลิกเปิดตรวจสอบได้เลยเหมือนคิวอ่านของแท็บ "อัปโหลดไฟล์" */
  if (bulkItems) {
    const doneCount = bulkItems.filter((it) => it.status === 'done' || it.status === 'failed').length;
    const allDone = doneCount === bulkItems.length;
    return (
      <Card title={tx('กำลังอ่านที่เลือกไว้')} right={<span className="sub">{doneCount}/{bulkItems.length}</span>}>
        <div className="rq-list">
          {bulkItems.map((it) => {
            const clickable = it.status === 'done';
            const cssStatus = it.status === 'done' ? 'pending' : it.status === 'queued' ? '' : it.status;
            return (
              <div
                key={it.key}
                className={`rq-row ${cssStatus}${clickable ? ' clickable' : ''}`}
                role={clickable ? 'button' : undefined}
                tabIndex={clickable ? 0 : undefined}
                onClick={clickable ? () => setBulkOpenResult(it.result!) : undefined}
                onKeyDown={
                  clickable
                    ? (e) => {
                        if (e.key === 'Enter') setBulkOpenResult(it.result!);
                      }
                    : undefined
                }
              >
                {it.status === 'reading' ? (
                  <span className="rq-spinner" />
                ) : (
                  <Icon
                    name={it.status === 'done' ? 'chk' : it.status === 'failed' ? 'x' : 'clock'}
                    className="sm"
                    style={{
                      color: it.status === 'done' ? 'var(--ok)' : it.status === 'failed' ? 'var(--cr)' : 'var(--fnt)',
                      flex: 'none',
                    }}
                  />
                )}
                <span className="rq-name">
                  {it.filename}
                  {it.status === 'failed' && it.error && <span className="rq-err">{it.error}</span>}
                </span>
              </div>
            );
          })}
        </div>
        <div className="sub" style={{ marginTop: 14 }}>
          {allDone
            ? tx('อ่านครบทุกไฟล์แล้ว — คลิกแถวไหนก็ได้เพื่อตรวจสอบและยืนยันเข้าระบบ')
            : tx('กำลังอ่านทีละไฟล์ตามลำดับ ไม่ต้องปิดหน้านี้ก็ได้')}
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
          <button className="btn" disabled={!allDone} onClick={() => setBulkItems(null)}>
            {tx('กลับไปที่กล่องเมล')}
          </button>
        </div>
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

      {inbox && inbox.messages.length > 0 && (
        <div className="bulkbar" style={{ margin: '0 0 14px', borderRadius: 'var(--r-ctl)' }}>
          <label className="bulkbar-count" style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
            <input type="checkbox" checked={allSelected} onChange={toggleAll} />
            <span>
              <b>{selected.size}</b> {tx('รายการที่เลือก')}
            </span>
          </label>
          <div className="bulkbar-actions">
            <ReaderPickerBar picker={picker} />
            <button className="btn pri sm" disabled={selected.size === 0} onClick={doReadSelected}>
              <Icon name="chk" className="sm" /> {`${tx('อ่านที่เลือก')} (${selected.size})`}
            </button>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {!inbox && !error && <Loading rows={3} />}
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
              {m.attachments.map((a) => {
                const key = `${m.id}::${a.filename}`;
                return (
                  <label key={a.filename} className="mailattach" style={{ cursor: 'pointer' }}>
                    <span className="fname">
                      <input
                        type="checkbox"
                        checked={selected.has(key)}
                        onChange={() => toggleAttachment(key)}
                        style={{ marginRight: 4 }}
                      />
                      <Icon name="file" className="sm" /> {a.filename} <Icon name="cd" className="xs" />
                    </span>
                  </label>
                );
              })}
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
            {!dismissed && <Loading variant="lines" rows={2} />}
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
    </>
  );
}
