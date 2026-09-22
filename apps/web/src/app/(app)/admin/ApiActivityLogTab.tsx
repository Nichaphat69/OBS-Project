'use client';

import { Fragment, useEffect, useMemo, useState } from 'react';
import { Card, ErrorState, Tag } from '../../../components/ui';
import { Icon } from '../../../components/Icon';
import { useLang } from '../../../lib/language';

interface ApiActivityRow {
  id: number;
  at: string;
  direction: string;
  service: string;
  method: string;
  path: string;
  durationMs: number;
  statusCode: number | null;
  ok: boolean;
  requestBody: string | null;
  responseBody: string | null;
  errorMessage: string | null;
}

const PAGE_SIZE = 10;

function timeAgo(iso: string, tx: (s: string) => string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60_000);
  if (min < 1) return tx('เมื่อสักครู่');
  if (min < 60) return `${min} ${tx('นาทีที่แล้ว')}`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} ${tx('ชั่วโมงที่แล้ว')}`;
  const day = Math.floor(hr / 24);
  return `${day} ${tx('วันที่แล้ว')}`;
}

function formatDuration(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(ms % 1000 === 0 ? 0 : 1)} sec` : `${ms} ms`;
}

/** แยก URL/path เต็มเป็น Base URL + URL Path (+ query string) เพื่อแสดงแบบเดียวกับตัวอย่างอ้างอิง — path
 * ที่เก็บไว้มีทั้งแบบ URL เต็ม (ฝั่ง consume เช่น https://api.line.me/...) และแบบ path อย่างเดียว (ฝั่ง
 * expose เช่น /api/line/webhook จาก req.originalUrl) จึงต้องกันเคส URL ไม่สมบูรณ์ไว้ด้วย */
function splitUrl(path: string): { base: string | null; pathOnly: string; query: string | null } {
  try {
    const u = new URL(path);
    return { base: u.origin, pathOnly: u.pathname, query: u.search ? u.search.slice(1) : null };
  } catch {
    const qIdx = path.indexOf('?');
    if (qIdx === -1) return { base: null, pathOnly: path, query: null };
    return { base: null, pathOnly: path.slice(0, qIdx), query: path.slice(qIdx + 1) };
  }
}

function toCsvValue(v: unknown): string {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** หน้า "API Activity Log" (design brief 7.3) — ดูได้ในหน้าเดียวว่า OBS เรียกออกไปหาระบบอื่น (Consume)
 * หรือถูกเรียกเข้ามา (Expose) เมื่อไหร่ สำเร็จหรือไม่ ใช้เวลาเท่าไหร่ — ข้อมูลเชิงเทคนิค เข้าถึงได้เฉพาะ
 * admin หน้าตาอ้างอิงตามตัวอย่างที่เจ้าของระบบส่งมา 21 ก.ย. 69 (หน้า API monitor ของระบบอื่น) — โครงสร้าง
 * ข้อมูลจริงมีเท่าที่ backend เก็บ (ไม่มี Header แยก/Request Key จริง เลยไม่ใส่ช่องพวกนั้นมาหลอกว่ามีข้อมูล) */
export default function ApiActivityLogTab() {
  const { tx } = useLang();
  const [rows, setRows] = useState<ApiActivityRow[] | null>(null);
  const [total, setTotal] = useState(0);
  const [services, setServices] = useState<string[]>([]);
  const [methods, setMethods] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [q, setQ] = useState('');
  const [qDraft, setQDraft] = useState('');
  const [direction, setDirection] = useState<Array<'consume' | 'expose'>>([]);
  const [service, setService] = useState('');
  const [method, setMethod] = useState('');
  const [status, setStatus] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState<number | null>(null);

  useEffect(() => {
    fetch('/api/api-activity-log/services', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : [])).then(setServices).catch(() => setServices([]));
    fetch('/api/api-activity-log/methods', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : [])).then(setMethods).catch(() => setMethods([]));
  }, []);

  function load() {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams();
    if (direction.length > 0) params.set('direction', direction.join(','));
    if (service) params.set('service', service);
    if (method) params.set('method', method);
    if (status) params.set('status', status);
    if (q) params.set('q', q);
    if (from) params.set('from', from);
    if (to) params.set('to', `${to}T23:59:59`);
    params.set('page', String(page));
    params.set('pageSize', String(PAGE_SIZE));
    fetch(`/api/api-activity-log?${params}`, { cache: 'no-store' })
      .then(async (r) => {
        if (!r.ok) {
          const data = await r.json().catch(() => ({}));
          setError(data.error ?? tx('โหลดข้อมูลไม่สำเร็จ'));
          return;
        }
        const data = await r.json();
        setRows(data.rows);
        setTotal(data.total);
      })
      .catch(() => setError(tx('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้')))
      .finally(() => setLoading(false));
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [direction, service, method, status, q, from, to, page]);

  function clearFilters() {
    setQDraft('');
    setQ('');
    setDirection([]);
    setService('');
    setMethod('');
    setStatus('');
    setFrom('');
    setTo('');
    setPage(1);
  }

  function toggleDirection(d: 'consume' | 'expose') {
    setPage(1);
    setDirection((cur) => (cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d]));
  }

  function downloadCsv() {
    if (!rows || rows.length === 0) return;
    const header = ['id', 'at', 'direction', 'service', 'method', 'path', 'durationMs', 'statusCode', 'ok', 'errorMessage'];
    const lines = [header.join(',')];
    for (const r of rows) {
      lines.push([r.id, r.at, r.direction, r.service, r.method, r.path, r.durationMs, r.statusCode ?? '', r.ok, r.errorMessage ?? ''].map(toCsvValue).join(','));
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `api-activity-log-page${page}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const rangeFrom = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const rangeTo = Math.min(page * PAGE_SIZE, total);

  const hasFilters = useMemo(
    () => direction.length > 0 || Boolean(service) || Boolean(method) || Boolean(status) || Boolean(q) || Boolean(from) || Boolean(to),
    [direction, service, method, status, q, from, to],
  );

  return (
    <Card title={tx('API Activity Log')}>
      <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        <input
          type="text"
          placeholder={tx('ค้นหา URL หรือ Service')}
          value={qDraft}
          onChange={(e) => setQDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { setPage(1); setQ(qDraft); }
          }}
          style={{ flex: '1 1 260px', minWidth: 200 }}
        />
        <button type="button" className="btn pri sm" onClick={() => { setPage(1); setQ(qDraft); }}>
          {tx('ค้นหา')}
        </button>
        <button type="button" className="btn ghost sm" disabled={!hasFilters} onClick={clearFilters}>
          {tx('ล้างตัวกรอง')}
        </button>
        <button type="button" className="btn ghost sm" disabled={!rows || rows.length === 0} onClick={downloadCsv}>
          <Icon name="up" className="sm" style={{ transform: 'rotate(180deg)' }} /> {tx('ดาวน์โหลดรายงาน')}
        </button>
      </div>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16, alignItems: 'center' }}>
        <span className="sub">{tx('วันที่เรียกใช้')}</span>
        <input type="date" value={from} onChange={(e) => { setPage(1); setFrom(e.target.value); }} aria-label={tx('ตั้งแต่วันที่')} />
        <span className="sub">–</span>
        <input type="date" value={to} onChange={(e) => { setPage(1); setTo(e.target.value); }} aria-label={tx('ถึงวันที่')} />

        <details className="ddwrap">
          <summary className="ddbtn">
            {tx('ชนิด')}{direction.length > 0 ? ` (${direction.length})` : ''} <Icon name="chev" className="xs" />
          </summary>
          <div className="ddpanel">
            <label className="ddopt">
              <input type="checkbox" checked={direction.includes('expose')} onChange={() => toggleDirection('expose')} /> Expose
            </label>
            <label className="ddopt">
              <input type="checkbox" checked={direction.includes('consume')} onChange={() => toggleDirection('consume')} /> Consume
            </label>
          </div>
        </details>

        <select value={service} onChange={(e) => { setPage(1); setService(e.target.value); }}>
          <option value="">{tx('ทุก Service')}</option>
          {services.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={method} onChange={(e) => { setPage(1); setMethod(e.target.value); }}>
          <option value="">{tx('ทุก Method')}</option>
          {methods.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
        <select value={status} onChange={(e) => { setPage(1); setStatus(e.target.value); }}>
          <option value="">{tx('ทุกสถานะ')}</option>
          <option value="ok">{tx('สำเร็จ')}</option>
          <option value="error">{tx('ล้มเหลว')}</option>
        </select>
      </div>

      {error ? (
        <ErrorState message={error} onRetry={load} />
      ) : (
        <>
          <div className="tw">
            <table>
              <thead>
                <tr>
                  <th style={{ width: 28 }} />
                  <th>{tx('ชนิดระบบ')}</th>
                  <th>{tx('ชนิด')}</th>
                  <th>URL</th>
                  <th>Method</th>
                  <th>{tx('วันที่เรียกใช้')}</th>
                  <th className="r">{tx('ระยะเวลา')}</th>
                  <th>{tx('สถานะ')}</th>
                </tr>
              </thead>
              <tbody>
                {rows?.map((r) => {
                  const isOpen = expanded === r.id;
                  const { base, pathOnly, query } = splitUrl(r.path);
                  const requestedOn = new Date(new Date(r.at).getTime() - r.durationMs).toLocaleString('th-TH');
                  const respondedOn = new Date(r.at).toLocaleString('th-TH');
                  return (
                    <Fragment key={r.id}>
                      <tr className="rw" onClick={() => setExpanded(isOpen ? null : r.id)}>
                        <td>
                          <Icon name="chev" className="sm" style={{ transform: isOpen ? 'rotate(180deg)' : undefined }} />
                        </td>
                        <td className="docid">{r.service}</td>
                        <td><Tag tone="mu">{r.direction === 'consume' ? 'Consume' : 'Expose'}</Tag></td>
                        <td className="sub" style={{ maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.path}>
                          {r.path}
                        </td>
                        <td>{r.method}</td>
                        <td className="sub" style={{ whiteSpace: 'nowrap' }}>{timeAgo(r.at, tx)}</td>
                        <td className="r sub n">{formatDuration(r.durationMs)}</td>
                        <td>
                          <Tag tone={r.ok ? 'ok' : 'cr'}>{r.ok ? tx('สำเร็จ') : tx('ล้มเหลว')}</Tag>
                        </td>
                      </tr>
                      {isOpen && (
                        <tr key={`${r.id}-detail`}>
                          <td colSpan={8} style={{ background: 'var(--sunk)', padding: 0 }}>
                            <div className="actlog-detail">
                              <div className="actlog-grid">
                                <div><span className="sub">Log ID</span><b>#{r.id}</b></div>
                                <div><span className="sub">Requested On</span><b>{requestedOn}</b></div>
                                <div><span className="sub">Responded On</span><b>{respondedOn}</b></div>
                                <div><span className="sub">Duration</span><b>{formatDuration(r.durationMs)}</b></div>
                                <div><span className="sub">{tx('สถานะ')}</span><Tag tone={r.ok ? 'ok' : 'cr'}>{r.ok ? tx('สำเร็จ') : tx('ล้มเหลว')}</Tag></div>
                              </div>
                              <div className="actlog-grid">
                                <div><span className="sub">Service</span><b>{r.service}</b></div>
                                <div><span className="sub">HTTP Method</span><b>{r.method}</b></div>
                                <div><span className="sub">Base URL</span><b>{base ?? '—'}</b></div>
                                <div><span className="sub">URL Path</span><b>{pathOnly}</b></div>
                                <div><span className="sub">Status Code</span><b>{r.statusCode ?? '—'}</b></div>
                              </div>
                              {r.errorMessage && (
                                <div style={{ color: 'var(--cr)', fontSize: 12.5 }}>{r.errorMessage}</div>
                              )}
                              <div>
                                <div className="sub" style={{ marginBottom: 4 }}>Query Parameter</div>
                                <pre className="code">{query ?? '—'}</pre>
                              </div>
                              <div>
                                <div className="sub" style={{ marginBottom: 4 }}>Request Body</div>
                                <pre className="code">{r.requestBody ?? '—'}</pre>
                              </div>
                              <div>
                                <div className="sub" style={{ marginBottom: 4 }}>Response Body</div>
                                <pre className="code">{r.responseBody ?? '—'}</pre>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
                {rows && rows.length === 0 && (
                  <tr>
                    <td colSpan={8} style={{ textAlign: 'center', color: 'var(--mut)' }}>
                      {tx('ยังไม่มีบันทึก')}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 14, flexWrap: 'wrap', gap: 10 }}>
            <span className="sub">
              {loading ? tx('กำลังโหลด…') : `${rangeFrom.toLocaleString()} ${tx('ถึง')} ${rangeTo.toLocaleString()} ${tx('จาก')} ${total.toLocaleString()} ${tx('รายการ')}`}
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <button type="button" className="btn ghost sm" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                ‹
              </button>
              <span className="sub">{page} / {totalPages}</span>
              <button type="button" className="btn ghost sm" disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>
                ›
              </button>
            </div>
          </div>
        </>
      )}
    </Card>
  );
}
