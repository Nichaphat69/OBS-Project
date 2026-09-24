'use client';

import { useEffect, useRef, useState } from 'react';
import { Card, StatusPill, Tag } from '../../../components/ui';
import { Icon } from '../../../components/Icon';
import { useToast } from '../../../components/Overlays';
import { useLang } from '../../../lib/language';

const MAX_ATTACHMENTS = 5;

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(',')[1] ?? '');
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function fileSizeLabel(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

interface TicketAttachment {
  id: number;
  fileName: string;
  mimeType: string;
}

interface MyTicket {
  id: number;
  category: string;
  categoryLabel: string;
  description: string;
  status: string;
  createdAt: string;
  resolvedAt: string | null;
  attachments: TicketAttachment[];
}

const CATEGORY_ICON: Record<string, string> = {
  bug: 'alt',
  manday: 'list-chk',
  timesheet: 'file',
  suggestion: 'info',
};

export default function ReportIssueClient() {
  const { tx } = useLang();
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);

  const [categories, setCategories] = useState<Record<string, string>>({});
  const [category, setCategory] = useState<string | null>(null);
  const [description, setDescription] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [tickets, setTickets] = useState<MyTicket[] | null>(null);

  function loadTickets() {
    fetch('/api/support-tickets/mine', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : []))
      .then(setTickets)
      .catch(() => setTickets([]));
  }

  useEffect(() => {
    fetch('/api/support-tickets/categories', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : {}))
      .then(setCategories)
      .catch(() => setCategories({}));
    loadTickets();
  }, []);

  function pickFiles(list: FileList | File[] | null | undefined) {
    if (!list) return;
    setFiles((prev) => {
      const merged = [...prev, ...Array.from(list)];
      if (merged.length > MAX_ATTACHMENTS) {
        toast(tx(`แนบได้ไม่เกิน ${MAX_ATTACHMENTS} รูปต่อครั้ง`), true);
        return merged.slice(0, MAX_ATTACHMENTS);
      }
      return merged;
    });
  }

  function removeFile(index: number) {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  }

  async function submit() {
    if (!category) {
      setError(tx('เลือกหมวดปัญหาก่อน'));
      return;
    }
    if (!description.trim()) {
      setError(tx('กรอกรายละเอียดปัญหาก่อน'));
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const attachments = await Promise.all(
        files.map(async (f) => ({ fileName: f.name, mimeType: f.type || 'application/octet-stream', fileBase64: await fileToBase64(f) })),
      );
      const res = await fetch('/api/support-tickets/mine', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ category, description: description.trim(), attachments }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? tx('ส่งไม่สำเร็จ'));
        return;
      }
      toast(tx('แจ้งปัญหาเรียบร้อยแล้ว ขอบคุณครับ'));
      setCategory(null);
      setDescription('');
      setFiles([]);
      loadTickets();
    } catch (e: any) {
      setError(e.message ?? tx('ส่งไม่สำเร็จ'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <Card title={tx('แจ้งปัญหาใหม่')}>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 18 }}>
          {Object.entries(categories).map(([key, label]) => (
            <button
              key={key}
              type="button"
              className={`btn sm${category === key ? ' pri' : ''}`}
              onClick={() => setCategory(key)}
            >
              <Icon name={CATEGORY_ICON[key] ?? 'info'} className="sm" /> {tx(label)}
            </button>
          ))}
        </div>

        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={tx('อธิบายปัญหาที่เจอ หรือสิ่งที่อยากเสนอแนะ...')}
          rows={5}
          style={{ width: '100%', resize: 'vertical' }}
        />

        <div style={{ marginTop: 14 }}>
          <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => pickFiles(e.target.files)} />
          <button type="button" className="btn sm ghost" onClick={() => fileRef.current?.click()} disabled={files.length >= MAX_ATTACHMENTS}>
            <Icon name="up" className="sm" /> {tx('แนบรูป')} ({files.length}/{MAX_ATTACHMENTS})
          </button>
          {files.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 10 }}>
              {files.map((f, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '8px 12px', border: '1px solid var(--hair)', borderRadius: 'var(--m3-shape-md)' }}>
                  <span className="sub">{f.name} · {fileSizeLabel(f.size)}</span>
                  <button type="button" className="btn icon sm ghost" onClick={() => removeFile(i)} aria-label={tx('ลบไฟล์')}>
                    <Icon name="x" className="sm" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {error && <div style={{ color: 'var(--cr)', marginTop: 12 }}>{error}</div>}

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 18 }}>
          <button className="btn pri" disabled={submitting} onClick={submit}>
            {submitting ? tx('กำลังส่ง…') : tx('ส่งเรื่อง')}
          </button>
        </div>
      </Card>

      <Card title={tx('เรื่องที่เคยแจ้งไปแล้ว')} flush>
        {tickets === null ? (
          <div className="sub" style={{ padding: 24 }}>{tx('กำลังโหลด…')}</div>
        ) : tickets.length === 0 ? (
          <div className="sub" style={{ padding: 24, textAlign: 'center' }}>{tx('ยังไม่เคยแจ้งปัญหาไว้เลย')}</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {tickets.map((t) => (
              <div key={t.id} style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '16px 24px', borderBottom: '1px solid var(--hair)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <span className="docid">#{t.id}</span>
                  <Tag tone="mu">{tx(t.categoryLabel)}</Tag>
                  {t.status === 'resolved' ? (
                    <StatusPill tone="ok">{tx('แก้แล้ว')}</StatusPill>
                  ) : (
                    <StatusPill tone="wn">{tx('รอดำเนินการ')}</StatusPill>
                  )}
                  <span className="sub">{t.createdAt.replace('T', ' ').slice(0, 19)}</span>
                </div>
                <div>{t.description}</div>
                {t.attachments.length > 0 && (
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {t.attachments.map((a) => (
                      <a key={a.id} href={`/api/support-tickets/attachments/${a.id}`} target="_blank" rel="noreferrer">
                        <img
                          src={`/api/support-tickets/attachments/${a.id}`}
                          alt={a.fileName}
                          style={{ width: 72, height: 72, objectFit: 'cover', borderRadius: 'var(--m3-shape-sm)', border: '1px solid var(--hair)' }}
                        />
                      </a>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>
    </>
  );
}
