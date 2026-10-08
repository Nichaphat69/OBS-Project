'use client';

import { useEffect, useMemo, useState } from 'react';
import { Card, ErrorState, Loading } from '../../../components/ui';
import { Icon } from '../../../components/Icon';
import { DatePicker } from '../../../components/DatePicker';
import { useLang } from '../../../lib/language';
import '../../../components/admin-log.css';

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
type Tone = 'ok' | 'info' | 'warn' | 'err' | 'sys' | 'mut';

/** สีของรหัสสถานะ HTTP: 2xx เขียว · 3xx ฟ้า · 4xx เหลืองอำพัน · 5xx แดง · ไม่มีรหัส (ต่อไม่ติด) เทา */
function codeTone(code: number | null): Tone {
  if (code === null) return 'mut';
  if (code >= 500) return 'err';
  if (code >= 400) return 'warn';
  if (code >= 300) return 'info';
  return 'ok';
}
const METHOD_TONE: Record<string, Tone> = { GET: 'info', POST: 'ok', PUT: 'warn', PATCH: 'warn', DELETE: 'err' };
/** ช้ากว่า 1 วินาทีเหลืองอำพัน ช้ากว่า 3 วินาทีแดง — ที่เหลือใช้เทาปกติ ไม่ให้เขียวทุกแถวจนแยกอะไรไม่ออก */
function durTone(ms: number): Tone {
  return ms >= 3000 ? 'err' : ms >= 1000 ? 'warn' : 'mut';
}

/** body ที่เป็น JSON แสดงแบบจัดย่อหน้าให้อ่านง่าย — ไม่ใช่ JSON ก็แสดงตามที่เก็บไว้ */
function prettyBody(raw: string | null): string | null {
  if (!raw || raw === '{}' || raw === '[]') return null;
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

const GRID = 'minmax(140px, 1fr) minmax(220px, 2.3fr) 74px 70px 118px 86px 96px 22px';

export default function ApiActivityLogTab() {
  const { tx, formatDateTime } = useLang();
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

  function pickDirection(d: 'consume' | 'expose' | null) {
    setPage(1);
    setDirection(d ? [d] : []);
  }

  function pickStatus(v: string) {
    setPage(1);
    setStatus(v);
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

  // สรุปเฉพาะแถวในหน้าที่แสดงอยู่ (backend ไม่ได้ส่งสรุปทั้งช่วงมา) — ระบุไว้ในป้ายให้ชัดว่าเป็น "ในหน้านี้"
  const pageStats = useMemo(() => {
    const list = rows ?? [];
    const okCount = list.filter((r) => r.ok).length;
    const avg = list.length ? Math.round(list.reduce((sum, r) => sum + r.durationMs, 0) / list.length) : 0;
    const slow = list.filter((r) => r.durationMs >= 1000).length;
    return { n: list.length, ok: okCount, fail: list.length - okCount, avg, slow };
  }, [rows]);

  return (
    <Card title={tx('API Activity Log')} right={<span className="sub">{loading ? tx('กำลังโหลด…') : `${rangeFrom.toLocaleString()} ${tx('ถึง')} ${rangeTo.toLocaleString()} ${tx('จาก')} ${total.toLocaleString()} ${tx('รายการ')}`}</span>}>
      <div className="al">
        <div className="al-head">
          <div>
            <h3>{tx('ใครเรียกใคร และผลเป็นอย่างไร')}</h3>
            <p>{tx('Expose = ระบบอื่นเรียกเข้ามาหา OBS · Consume = OBS เรียกออกไปหาระบบอื่น — กดแถวเพื่อดูรายละเอียด')}</p>
          </div>
        </div>

        <div className="al-stats">
          <div className="al-stat t-info">
            <span className="ic"><Icon name="act" /></span>
            <div><b>{pageStats.n}</b><span>{tx('รายการในหน้านี้')}</span></div>
          </div>
          <div className="al-stat t-ok">
            <span className="ic"><Icon name="chk" /></span>
            <div><b>{pageStats.ok}</b><span>{tx('สำเร็จ')}</span></div>
          </div>
          <div className={`al-stat ${pageStats.fail > 0 ? 't-err' : 't-mut'}`}>
            <span className="ic"><Icon name="x" /></span>
            <div><b>{pageStats.fail}</b><span>{tx('ล้มเหลว')}</span></div>
          </div>
          <div className={`al-stat ${pageStats.slow > 0 ? 't-warn' : 't-mut'}`}>
            <span className="ic"><Icon name="clock" /></span>
            <div><b>{formatDuration(pageStats.avg)}</b><span>{tx('เวลาเฉลี่ย')}{pageStats.slow > 0 ? ` · ${pageStats.slow} ${tx('รายการช้ากว่า 1 วินาที')}` : ''}</span></div>
          </div>
        </div>

        <div className="al-bar">
          <div className="al-search grow">
            <Icon name="search" />
            <input
              type="text"
              placeholder={tx('ค้นหา URL หรือ Service')}
              value={qDraft}
              onChange={(e) => setQDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  setPage(1);
                  setQ(qDraft);
                }
              }}
              aria-label={tx('ค้นหา URL หรือ Service')}
            />
          </div>
          <button type="button" className="al-btn pri" onClick={() => { setPage(1); setQ(qDraft); }}>
            {tx('ค้นหา')}
          </button>
          <button type="button" className="al-btn" disabled={!hasFilters} onClick={clearFilters}>
            {tx('ล้างตัวกรอง')}
          </button>
          <button type="button" className="al-btn" disabled={!rows || rows.length === 0} onClick={downloadCsv}>
            <Icon name="download" className="sm" /> {tx('ดาวน์โหลดรายงาน')}
          </button>
        </div>

        <div className="al-bar">
          <div className="al-seg" role="group" aria-label={tx('ชนิด')}>
            <button type="button" className={direction.length === 0 ? 'on' : ''} onClick={() => pickDirection(null)}>{tx('ทั้งหมด')}</button>
            <button type="button" className={`t-info${direction[0] === 'expose' ? ' on' : ''}`} onClick={() => pickDirection('expose')}><i />Expose</button>
            <button type="button" className={`t-sys${direction[0] === 'consume' ? ' on' : ''}`} onClick={() => pickDirection('consume')}><i />Consume</button>
          </div>
          <div className="al-seg" role="group" aria-label={tx('สถานะ')}>
            <button type="button" className={status === '' ? 'on' : ''} onClick={() => pickStatus('')}>{tx('ทุกสถานะ')}</button>
            <button type="button" className={`t-ok${status === 'ok' ? ' on' : ''}`} onClick={() => pickStatus('ok')}><i />{tx('สำเร็จ')}</button>
            <button type="button" className={`t-err${status === 'error' ? ' on' : ''}`} onClick={() => pickStatus('error')}><i />{tx('ล้มเหลว')}</button>
          </div>
          <select className="al-select" value={service} onChange={(e) => { setPage(1); setService(e.target.value); }} aria-label="Service">
            <option value="">{tx('ทุก Service')}</option>
            {services.map((sv) => <option key={sv} value={sv}>{sv}</option>)}
          </select>
          <select className="al-select" value={method} onChange={(e) => { setPage(1); setMethod(e.target.value); }} aria-label="Method">
            <option value="">{tx('ทุก Method')}</option>
            {methods.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
          <div className="al-dates">
            <span>{tx('วันที่เรียกใช้')}</span>
            <DatePicker value={from} onChange={(v) => { setPage(1); setFrom(v); }} ariaLabel={tx('ตั้งแต่วันที่')} />
            <span>–</span>
            <DatePicker value={to} onChange={(v) => { setPage(1); setTo(v); }} ariaLabel={tx('ถึงวันที่')} />
          </div>
        </div>

        {error ? (
          <ErrorState message={error} onRetry={load} />
        ) : (
          <>
            <div className="al-list">
              <div className="al-cols" style={{ gridTemplateColumns: GRID }}>
                <span>{tx('ระบบ')}</span>
                <span>URL</span>
                <span>Method</span>
                <span>Code</span>
                <span>{tx('เมื่อ')}</span>
                <span style={{ textAlign: 'right' }}>{tx('ระยะเวลา')}</span>
                <span>{tx('สถานะ')}</span>
                <span />
              </div>

              {!rows && <Loading rows={4} />}

              {rows?.map((r) => {
                const isOpen = expanded === r.id;
                const rowTone: Tone = r.ok ? 'ok' : 'err';
                const { base, pathOnly, query } = splitUrl(r.path);
                const requestedOn = formatDateTime(new Date(new Date(r.at).getTime() - r.durationMs));
                const respondedOn = formatDateTime(r.at);
                const reqBody = prettyBody(r.requestBody);
                const resBody = prettyBody(r.responseBody);
                const isConsume = r.direction === 'consume';
                return (
                  <div key={r.id} className={`al-item t-${rowTone}${isOpen ? ' open' : ''}`}>
                    <button type="button" className="al-row-h" style={{ gridTemplateColumns: GRID }} aria-expanded={isOpen} onClick={() => setExpanded(isOpen ? null : r.id)}>
                      <span className="al-two al-ell">
                        <b className="al-ell">{r.service}</b>
                        <span className={`al-pill ${isConsume ? 't-sys' : 't-info'}`} style={{ marginTop: 3, padding: '1px 8px', fontSize: 11 }}>
                          {isConsume ? 'Consume' : 'Expose'}
                        </span>
                      </span>
                      <span className="al-ell al-mut" title={r.path}>{r.path}</span>
                      <span><span className={`al-method t-${METHOD_TONE[r.method] ?? 'mut'}`}>{r.method}</span></span>
                      <span><span className={`al-code t-${codeTone(r.statusCode)}`}>{r.statusCode ?? '—'}</span></span>
                      <span className="al-mut" style={{ whiteSpace: 'nowrap' }}>{timeAgo(r.at, tx)}</span>
                      <span className={`al-dur t-${durTone(r.durationMs)}`}>{formatDuration(r.durationMs)}</span>
                      <span>
                        <span className={`al-pill t-${rowTone}`}><i />{r.ok ? tx('สำเร็จ') : tx('ล้มเหลว')}</span>
                      </span>
                      <span className="al-chev"><Icon name="chev" className="sm" /></span>
                    </button>
                    {isOpen && (
                      <div className="al-body">
                        {r.errorMessage && <div className="al-errbox">{r.errorMessage}</div>}
                        <div className="al-kv">
                          <div><span>Log ID</span><b>#{r.id}</b></div>
                          <div><span>Requested On</span><b>{requestedOn}</b></div>
                          <div><span>Responded On</span><b>{respondedOn}</b></div>
                          <div><span>Duration</span><b className={`t-${durTone(r.durationMs)}`} style={{ color: 'var(--x)' }}>{formatDuration(r.durationMs)}</b></div>
                          <div><span>{tx('สถานะ')}</span><b><span className={`al-pill t-${rowTone}`}><i />{r.ok ? tx('สำเร็จ') : tx('ล้มเหลว')}</span></b></div>
                          <div><span>Status Code</span><b><span className={`al-code t-${codeTone(r.statusCode)}`}>{r.statusCode ?? '—'}</span></b></div>
                          <div><span>Service</span><b>{r.service}</b></div>
                          <div><span>HTTP Method</span><b><span className={`al-method t-${METHOD_TONE[r.method] ?? 'mut'}`}>{r.method}</span></b></div>
                          <div className="wide"><span>Base URL</span><b>{base ?? '—'}</b></div>
                          <div className="wide"><span>URL Path</span><b>{pathOnly}</b></div>
                        </div>
                        <div className="al-sec">
                          <h5>Query Parameter</h5>
                          {query ? <pre className="al-pre">{query}</pre> : <span className="al-none">{tx('ไม่มี')}</span>}
                        </div>
                        <div className="al-sec">
                          <h5>Request Body</h5>
                          {reqBody ? <pre className="al-pre">{reqBody}</pre> : <span className="al-none">{tx('ไม่มี')}</span>}
                        </div>
                        <div className="al-sec">
                          <h5>Response Body</h5>
                          {resBody ? <pre className="al-pre">{resBody}</pre> : <span className="al-none">{tx('ไม่มี')}</span>}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}

              {rows && rows.length === 0 && <div className="al-empty">{tx('ยังไม่มีบันทึก')}</div>}
            </div>

            <div className="al-foot">
              <span className="al-mut">{tx('การ์ดสรุปด้านบนนับจากรายการในหน้าที่แสดงอยู่')}</span>
              <div className="al-pg">
                <button type="button" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))} aria-label={tx('หน้าก่อนหน้า')}>
                  ‹
                </button>
                <span>
                  {page} / {totalPages}
                </span>
                <button type="button" disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))} aria-label={tx('หน้าถัดไป')}>
                  ›
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </Card>
  );
}
