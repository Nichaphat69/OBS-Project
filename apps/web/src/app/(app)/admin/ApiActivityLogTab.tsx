'use client';

import { useEffect, useState } from 'react';
import { Card, ErrorState, Tag } from '../../../components/ui';
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

/** หน้า "API Activity Log" (design brief 7.3, 21 ก.ย. 69) — ดูได้ในหน้าเดียวว่า OBS เรียกออกไปหาระบบอื่น
 * (Consume: ABBYY/Clear Read/FlowAccount/Gmail/Google/HRDD/LINE) หรือถูกเรียกเข้ามา (Expose: n8n/LINE
 * webhook) เมื่อไหร่ สำเร็จหรือไม่ ใช้เวลาเท่าไหร่ — ข้อมูลเชิงเทคนิค เข้าถึงได้เฉพาะ admin */
export default function ApiActivityLogTab() {
  const { tx } = useLang();
  const [rows, setRows] = useState<ApiActivityRow[] | null>(null);
  const [services, setServices] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [direction, setDirection] = useState('');
  const [service, setService] = useState('');
  const [status, setStatus] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  useEffect(() => {
    fetch('/api/api-activity-log/services', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : []))
      .then(setServices)
      .catch(() => setServices([]));
  }, []);

  function load() {
    setError(null);
    const params = new URLSearchParams();
    if (direction) params.set('direction', direction);
    if (service) params.set('service', service);
    if (status) params.set('status', status);
    if (from) params.set('from', from);
    if (to) params.set('to', `${to}T23:59:59`);
    fetch(`/api/api-activity-log?${params}`, { cache: 'no-store' })
      .then(async (r) => {
        if (!r.ok) {
          const data = await r.json().catch(() => ({}));
          setError(data.error ?? tx('โหลดข้อมูลไม่สำเร็จ'));
          return;
        }
        setRows(await r.json());
      })
      .catch(() => setError(tx('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้')));
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [direction, service, status, from, to]);

  return (
    <Card title={tx('API Activity Log')} right={<span className="sub">{tx('ล่าสุด')} {rows?.length ?? 0} {tx('รายการ')}</span>}>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
        <select value={direction} onChange={(e) => setDirection(e.target.value)}>
          <option value="">{tx('ทุกประเภท')}</option>
          <option value="consume">Consume</option>
          <option value="expose">Expose</option>
        </select>
        <select value={service} onChange={(e) => setService(e.target.value)}>
          <option value="">{tx('ทุก Service')}</option>
          {services.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">{tx('ทุกสถานะ')}</option>
          <option value="ok">{tx('สำเร็จ')}</option>
          <option value="error">{tx('ล้มเหลว')}</option>
        </select>
        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label={tx('ตั้งแต่วันที่')} />
        <input type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label={tx('ถึงวันที่')} />
      </div>

      {error ? (
        <ErrorState message={error} onRetry={load} />
      ) : (
        <div className="tw">
          <table>
            <thead>
              <tr>
                <th>{tx('เวลา')}</th>
                <th>{tx('ประเภท')}</th>
                <th>Service</th>
                <th>Method</th>
                <th className="r">{tx('ระยะเวลา')}</th>
                <th>{tx('สถานะ')}</th>
                <th>{tx('รายละเอียด')}</th>
              </tr>
            </thead>
            <tbody>
              {rows?.map((r) => (
                <tr key={r.id}>
                  <td className="sub" style={{ whiteSpace: 'nowrap' }}>
                    {r.at.replace('T', ' ').slice(0, 19)}
                  </td>
                  <td>
                    <Tag tone={r.direction === 'consume' ? 'pr' : 'wn'}>{r.direction === 'consume' ? 'Consume' : 'Expose'}</Tag>
                  </td>
                  <td className="docid">{r.service}</td>
                  <td className="sub">{r.method}</td>
                  <td className="r sub n">{r.durationMs.toLocaleString()} ms</td>
                  <td>
                    <Tag tone={r.ok ? 'ok' : 'cr'}>{r.ok ? tx('สำเร็จ') : tx('ล้มเหลว')}{r.statusCode ? ` (${r.statusCode})` : ''}</Tag>
                  </td>
                  <td>
                    <details>
                      <summary style={{ cursor: 'pointer', color: 'var(--mut)' }}>▶ {tx('ดู request/response')}</summary>
                      <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
                        <div className="sub" style={{ wordBreak: 'break-all' }}>{r.path}</div>
                        {r.errorMessage && <div style={{ color: 'var(--cr)', fontSize: 12.5 }}>{r.errorMessage}</div>}
                        <div>
                          <div className="sub" style={{ marginBottom: 4 }}>Request</div>
                          <pre className="code">{r.requestBody ?? '—'}</pre>
                        </div>
                        <div>
                          <div className="sub" style={{ marginBottom: 4 }}>Response</div>
                          <pre className="code">{r.responseBody ?? '—'}</pre>
                        </div>
                      </div>
                    </details>
                  </td>
                </tr>
              ))}
              {rows && rows.length === 0 && (
                <tr>
                  <td colSpan={7} style={{ textAlign: 'center', color: 'var(--mut)' }}>
                    {tx('ยังไม่มีบันทึก')}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
