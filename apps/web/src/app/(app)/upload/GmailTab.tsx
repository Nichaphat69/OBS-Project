'use client';

import { useEffect, useMemo, useState } from 'react';
import { Card, Loading, Tag } from '../../../components/ui';
import { Icon } from '../../../components/Icon';
import { useToast, usePdfPreview } from '../../../components/Overlays';
import { useReaderPicker, ReaderPickerBar } from '../../../components/ReaderPicker';
import ReviewCard, { type ReadResultShape } from './ReviewCard';
import { QueueStatusCard } from '../../../components/QueueStatusCard';
import { useLang } from '../../../lib/language';
import { matching, useScope } from '../../../lib/scope';

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
  // ลูกค้าเดียวที่ตัวกรองบนแถบบนชี้อยู่ (ใช้ผูกโดเมนอีเมลให้ลูกค้านั้น) — หลายลูกค้า/ไม่ได้เลือก = null
  const { contracts: scopeContracts, filters: scopeFilters, ready: scopeReady } = useScope();
  const activeContract = useMemo<ActiveContract | null | undefined>(() => {
    if (!scopeReady) return undefined;
    const cs = matching(scopeContracts, scopeFilters);
    return cs.length > 0 && new Set(cs.map((c) => c.customerId)).size === 1 ? { id: cs[0].id, customerId: cs[0].customerId } : null;
  }, [scopeReady, scopeContracts, scopeFilters]);
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
  // 30 ก.ย. 69 — เปลี่ยนจากอ่านทีละไฟล์รอผลในคำขอเดียว (OCR ช้าเกิน 90 วินาทีแล้ว nginx ตัดเป็น 504 HTML)
  // มาเป็นเข้าคิวอ่านเบื้องหลังเหมือนแท็บ "อัปโหลดไฟล์" — ตอบทันที แล้วการ์ดคิวอัปเดตสถานะสดเอง
  const [queuedIds, setQueuedIds] = useState<number[] | null>(null);
  const [subjectById, setSubjectById] = useState<Map<number, string>>(new Map());
  const [reviewResult, setReviewResult] = useState<ReadResultShape | null>(null);
  const [reviewLoadingId, setReviewLoadingId] = useState<number | null>(null);
  const [queueing, setQueueing] = useState(false);

  function load() {
    setError(null);
    // ขอบเขตลูกค้ามาจากตัวกรอง site/PO/พนักงานบนแถบบน (cookie obs_scope — เซิร์ฟเวอร์อ่านเอง) ไม่ต้องแนบ contractId
    fetch(`/api/gmail/inbox${showAll ? '?all=1' : ''}`, { cache: 'no-store' })
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) {
          setError(data.error ?? tx('โหลดรายการไม่สำเร็จ'));
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

  /** ส่งไฟล์ที่ติ๊กไว้เข้าคิวอ่านเบื้องหลังทีเดียว — ตอบกลับทันทีไม่รอ OCR (API เดียวกับที่ worker หน้า
   * "อัปโหลดไฟล์" ใช้อ่านต่อ) */
  async function doReadSelected() {
    const list = [...selected].map((key) => {
      const idx = key.indexOf('::');
      return { messageId: key.slice(0, idx), attachmentFilename: key.slice(idx + 2) };
    });
    if (list.length === 0) return;

    setError(null);
    setQueueing(true);
    try {
      // โดเมนยังไม่เคยตั้ง (หรือกำลังดูแบบ "แสดงทุกบริษัท") — ผู้ใช้เลือกอ่านอีเมลนี้แปลว่ายอมรับว่าโดเมนนี้
      // เป็นของบริษัทที่กำลังดำเนินการอยู่ — บันทึกให้อัตโนมัติ (claim ครั้งแรกเท่านั้น เงียบไว้ถ้า 409)
      if (activeContract && (inbox?.domainMissing || showAll)) {
        const domains = new Set(
          list.map((l) => inbox?.messages.find((m) => m.id === l.messageId)).filter(Boolean).map((m) => senderDomain(m!.from)).filter(Boolean) as string[],
        );
        for (const domain of domains) {
          await fetch(`/api/customers/${encodeURIComponent(activeContract.customerId)}/email-domain/claim`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ domain }),
          }).catch(() => {});
        }
      }
      const res = await fetch('/api/gmail/read-queue', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          items: list,
          readerId: picker.readerId,
          abbyySkillId: picker.chosenReaderId === 'abbyy' ? picker.abbyySkillId : null,
        }),
      });
      const text = await res.text();
      let data: any = null;
      try {
        data = JSON.parse(text);
      } catch {
        /* ไม่ใช่ JSON (เช่นหน้า error ของ proxy) — แสดงรหัสสถานะจริงแทนข้อความของตัวแปลง JSON */
      }
      if (!res.ok || !data) {
        setError(data?.error ?? `${tx('เข้าคิวไม่สำเร็จ')} (HTTP ${res.status})`);
        return;
      }
      setSubjectById(new Map((data.items ?? []).map((i: any) => [i.id, i.subject ?? ''])));
      setQueuedIds(Array.isArray(data.ids) ? data.ids : []);
      setSelected(new Set());
    } catch (e: any) {
      setError(e.message ?? tx('เชื่อมต่อไม่สำเร็จ — ลองใหม่อีกครั้ง'));
    } finally {
      setQueueing(false);
    }
  }

  /** เปิด ReviewCard ของแถวที่อ่านเสร็จแล้ว ("พร้อมตรวจสอบ") ตรงนี้เลย — เหมือนแท็บ "อัปโหลดไฟล์" */
  function openReview(id: number) {
    setReviewLoadingId(id);
    fetch(`/api/ai-reads/${id}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((row: any) => {
        setReviewResult({
          ...(row.extraction ?? {}),
          documentNo: row.documentNo,
          model: row.model,
          sourceEmailId: row.sourceEmailId ?? undefined,
          email: { subject: subjectById.get(id) ?? '' },
          sourceAiReadId: id,
        } as any);
      })
      .catch(() => toast(tx('เปิดผลการอ่านไม่สำเร็จ ลองใหม่อีกครั้ง')))
      .finally(() => setReviewLoadingId(null));
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

  /* เปิด ReviewCard ทับหน้าคิว — ตรวจสอบ/ยืนยันแถวที่อ่านเสร็จแล้วได้ตรงนี้เลย ปิดแล้วกลับมาที่การ์ดคิวเดิม */
  if (reviewResult) {
    return (
      <Card title={tx('ตรวจสอบก่อนบันทึก')}>
        <ReviewCard result={reviewResult} onDone={() => setReviewResult(null)} />
      </Card>
    );
  }

  /* การ์ดสถานะคิวอ่านสด (ตัวเดียวกับหน้า "อัปโหลดไฟล์") — อ่านเบื้องหลังทีละไฟล์ ปิดหน้านี้ได้ไม่ต้องรอ */
  if (queuedIds !== null) {
    return (
      <QueueStatusCard
        ids={queuedIds}
        onOpenRow={openReview}
        openingId={reviewLoadingId}
        closeLabel={tx('กลับไปที่กล่องเมล')}
        onClose={() => {
          setQueuedIds(null);
          load();
        }}
      />
    );
  }

  return (
    <>
      <Card
        title={tx('อีเมลแจ้งอนุมัติ Timesheet')}
        right={inbox ? <span className="sub">{tx('ไฟล์ที่ n8n ส่งมา — กดอ่านเองเมื่อพร้อม')}</span> : undefined}
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
            <button className="btn pri sm" disabled={selected.size === 0 || queueing} onClick={doReadSelected}>
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
        {inbox && inbox.messages.length === 0 && <div className="empty">{tx('ไม่มีไฟล์ที่รออ่าน — ไฟล์จะโผล่ที่นี่เมื่อ n8n รับอีเมล Timesheet เข้ามา')}</div>}

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
