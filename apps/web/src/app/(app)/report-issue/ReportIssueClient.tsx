'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Loading } from '../../../components/ui';
import { Icon } from '../../../components/Icon';
import { useToast, usePdfPreview } from '../../../components/Overlays';
import { useLang } from '../../../lib/language';
import '../../../components/emp.css';

const MAX_ATTACHMENTS = 5;
const MAX_DESC = 1000;

const CATEGORY_HINT: Record<string, string> = {
  bug: 'ระบบใช้งานไม่ได้ / ขึ้น error',
  manday: 'ตัวเลขวันทำงานไม่ตรง',
  timesheet: 'ส่ง/แก้ไฟล์ Timesheet ไม่ได้',
  suggestion: 'อยากให้ปรับปรุงอะไรเพิ่ม',
};

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
  const { tx, formatDateTime } = useLang();
  const openPdfPreview = usePdfPreview();
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
        toast(tx('แนบได้ไม่เกิน {n} รูปต่อครั้ง').replace('{n}', String(MAX_ATTACHMENTS)), true);
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

  const previews = useMemo(() => files.map((f) => URL.createObjectURL(f)), [files]);
  useEffect(() => () => previews.forEach((u) => URL.revokeObjectURL(u)), [previews]);

  return (
    <div className="ep ep-split">
      <div className="ep-panel">
        <div className={`ep-step${category ? ' done' : ''}`}>
          <span className="ep-num">{category ? <Icon name="chk" className="sm" /> : 1}</span>
          <div>
            <h4>{tx('เรื่องอะไร')}</h4>
            <p>{tx('เลือกหมวดที่ใกล้เคียงที่สุด')}</p>
          </div>
        </div>
        <div className="ri-cats">
          {Object.entries(categories).map(([key, label]) => (
            <button key={key} type="button" className={`ep-opt${category === key ? ' on' : ''}`} onClick={() => { setCategory(key); setError(null); }}>
              <span className="ic"><Icon name={CATEGORY_ICON[key] ?? 'info'} className="sm" /></span>
              <span>
                <b>{tx(label)}</b>
                {CATEGORY_HINT[key] && <span className="s">{tx(CATEGORY_HINT[key])}</span>}
              </span>
            </button>
          ))}
        </div>

        <div className={`ep-step${description.trim() ? ' done' : ''}`}>
          <span className="ep-num">2</span>
          <div>
            <h4>{tx('เล่าให้ฟังหน่อย')}</h4>
            <p>{tx('เกิดอะไรขึ้น ทำอะไรอยู่ตอนนั้น ยิ่งละเอียดยิ่งแก้ไว')}</p>
          </div>
        </div>
        <textarea
          className="ri-ta"
          value={description}
          maxLength={MAX_DESC}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={tx('อธิบายปัญหาที่เจอ หรือสิ่งที่อยากเสนอแนะ...')}
        />
        <div className="ri-meta">
          <span />
          <span>{description.length}/{MAX_DESC}</span>
        </div>

        <div className="ep-step">
          <span className="ep-num">3</span>
          <div>
            <h4>{tx('แนบรูป (ไม่บังคับ)')}</h4>
            <p>{tx('แนบได้ไม่เกิน {n} รูปต่อครั้ง').replace('{n}', String(MAX_ATTACHMENTS))}</p>
          </div>
        </div>
        <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => { pickFiles(e.target.files); e.target.value = ''; }} />
        <div className="ri-thumbs" style={{ marginTop: 0 }}>
          {files.map((f, i) => (
            <div key={`${f.name}-${i}`} className="ri-th" title={`${f.name} · ${fileSizeLabel(f.size)}`}>
              <img src={previews[i]} alt={f.name} />
              <button type="button" onClick={() => removeFile(i)} aria-label={tx('ลบไฟล์')}>
                <Icon name="x" className="sm" />
              </button>
            </div>
          ))}
          {files.length < MAX_ATTACHMENTS && (
            <button type="button" className="ri-add" onClick={() => fileRef.current?.click()}>
              <Icon name="up" />
              {tx('แนบรูป')} ({files.length}/{MAX_ATTACHMENTS})
            </button>
          )}
        </div>

        {error && <div className="ep-err">{error}</div>}

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 24 }}>
          <button className="btn pri lg" disabled={submitting} onClick={submit}>
            <Icon name="send" /> {submitting ? tx('กำลังส่ง…') : tx('ส่งเรื่อง')}
          </button>
        </div>
      </div>

      <aside className="ep-side">
        <div className="ep-panel ri-hist">
          <h4>{tx('เรื่องที่เคยแจ้งไปแล้ว')}</h4>
          {tickets === null ? (
            <Loading rows={3} />
          ) : tickets.length === 0 ? (
            <div className="ri-empty">{tx('ยังไม่เคยแจ้งปัญหาไว้เลย')}</div>
          ) : (
            <ul className="ri-tl">
              {tickets.map((t) => (
                <li key={t.id} className={`ri-ti${t.status === 'resolved' ? ' ok' : ''}`}>
                  <div className="ri-th1">
                    <b>#{t.id} · {tx(t.categoryLabel)}</b>
                    <span className="ri-st">{t.status === 'resolved' ? tx('แก้แล้ว') : tx('รอดำเนินการ')}</span>
                    <span>{formatDateTime(t.createdAt)}</span>
                  </div>
                  <p className="ri-desc">{t.description}</p>
                  {t.attachments.length > 0 && (
                    <div className="ri-att">
                      {t.attachments.map((a) => (
                        <a
                          key={a.id}
                          href={`/api/support-tickets/attachments/${a.id}`}
                          target="_blank"
                          rel="noreferrer"
                          title={tx('เปิดดูไฟล์นี้')}
                          onClick={(e) => {
                            e.preventDefault();
                            openPdfPreview(`/api/support-tickets/attachments/${a.id}`, a.fileName);
                          }}
                        >
                          <img src={`/api/support-tickets/attachments/${a.id}`} alt={a.fileName} />
                        </a>
                      ))}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>
    </div>
  );
}
