'use client';

import { useEffect, useState } from 'react';
import { Card, ErrorState, StatusPill, Loading } from '../../../components/ui';
import { useToast } from '../../../components/Overlays';
import { useLang } from '../../../lib/language';

interface CustomerDomainRow {
  id: string;
  name: string;
  emailDomain: string | null;
}

export default function EmailDomainsTab() {
  const toast = useToast();
  const { tx } = useLang();
  const [rows, setRows] = useState<CustomerDomainRow[] | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function load() {
    setError(null);
    fetch('/api/customers/domains', { cache: 'no-store' })
      .then(async (r) => {
        if (!r.ok) {
          const data = await r.json().catch(() => ({}));
          setError(data?.error ?? tx('โหลดข้อมูลไม่สำเร็จ'));
          return;
        }
        const data: CustomerDomainRow[] = await r.json();
        setRows(data);
        setDrafts(Object.fromEntries(data.map((r) => [r.id, r.emailDomain ?? ''])));
      })
      .catch(() => setError(tx('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้')));
  }

  useEffect(load, []);

  async function save(row: CustomerDomainRow) {
    setSaving(row.id);
    try {
      const domain = drafts[row.id]?.trim() ?? '';
      const res = await fetch(`/api/customers/${row.id}/email-domain`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ domain: domain || null }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast(data.error ?? tx('บันทึกไม่สำเร็จ'), true);
        return;
      }
      toast(domain ? `${tx('ตั้งโดเมน')} "${domain}"` : tx('ล้างโดเมนแล้ว — กลับไปแสดงทุกฉบับเหมือนเดิม'));
      load();
    } catch {
      toast(tx('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้'), true);
    } finally {
      setSaving(null);
    }
  }

  return (
    <Card title={tx('โดเมนอีเมลลูกค้า')} flush>
      {error ? (
        <ErrorState message={error} onRetry={load} />
      ) : (
      <div className="tw">
        <table>
          <thead>
            <tr>
              <th>{tx('บริษัท')}</th>
              <th>{tx('สถานะ')}</th>
              <th>{tx('โดเมนอีเมล')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows?.map((r) => {
              const draft = drafts[r.id] ?? '';
              const changed = draft.trim() !== (r.emailDomain ?? '');
              return (
                <tr key={r.id}>
                  <td className="nm">{r.name}</td>
                  <td>
                    <StatusPill tone={r.emailDomain ? 'ok' : 'wn'}>{r.emailDomain ? tx('ตั้งค่าแล้ว') : tx('ยังไม่ได้ตั้ง')}</StatusPill>
                  </td>
                  <td>
                    <input
                      value={draft}
                      onChange={(e) => setDrafts((d) => ({ ...d, [r.id]: e.target.value }))}
                      placeholder="เช่น thailife.com"
                      style={{ height: 36, borderRadius: 'var(--r-ctl)', border: '1px solid var(--rule)', padding: '0 12px', width: '100%' }}
                    />
                  </td>
                  <td>
                    <button className="btn sm" disabled={!changed || saving === r.id} onClick={() => save(r)}>
                      {saving === r.id ? tx('กำลังบันทึก…') : tx('บันทึก')}
                    </button>
                  </td>
                </tr>
              );
            })}
            {!rows && (
              <tr>
                <td colSpan={4}>
                  <Loading rows={4} />
                </td>
              </tr>
            )}
            {rows && rows.length === 0 && (
              <tr>
                <td colSpan={4} style={{ textAlign: 'center', color: 'var(--mut)' }}>
                  {tx('ยังไม่มีลูกค้าในระบบ')}
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
