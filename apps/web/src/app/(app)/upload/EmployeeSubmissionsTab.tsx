'use client';

import { useState } from 'react';
import { Card, EmptyState, Loading, Tag } from '../../../components/ui';
import { Icon } from '../../../components/Icon';
import { usePdfPreview } from '../../../components/Overlays';
import ReviewCard, { type ReadResultShape } from './ReviewCard';
import ReadingCard from './ReadingCard';
import { useLang } from '../../../lib/language';

export interface EmployeeSubmissionItem {
  id: number;
  source: string;
  fileName: string | null;
  employeeId: string | null;
  employeeName: string | null;
  period: string | null;
  periodLabel: string | null;
  status: string;
  readAt: string;
  contract?: { id: string; poNo: string; projectName: string; customerName: string } | null;
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(',')[1] ?? '');
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/**
 * แท็บ "รอจากพนักงาน" — คิวไฟล์ Timesheet ที่พนักงานส่งเองผ่านหน้า "ส่ง Timesheet" (role `user`) แล้ว
 * แต่ยังไม่มีใครอ่านเข้าระบบ (เจ้าของระบบสั่ง 22 ก.ย. 69) — ไฟล์เก็บไว้แล้วจริงตั้งแต่ตอนส่ง (ai_reads,
 * source: 'employee_submit') แค่ต้องหยิบมาป้อนเข้า pipeline อ่าน/ยืนยันเดิม (เหมือนแท็บ "อัปโหลดไฟล์"
 * ทุกอย่าง ต่างแค่ที่มาไฟล์เป็นการดึงจากเซิร์ฟเวอร์แทนการเลือกจากเครื่อง) — ไม่สร้างขั้นตอนใหม่เลย
 */
export default function EmployeeSubmissionsTab({
  items,
  onReload,
}: {
  items: EmployeeSubmissionItem[] | null;
  onReload: () => void;
}) {
  const { tx } = useLang();
  const openPdfPreview = usePdfPreview();
  const [readingId, setReadingId] = useState<number | null>(null);
  const [readingFileName, setReadingFileName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ReadResultShape | null>(null);

  async function doRead(item: EmployeeSubmissionItem) {
    setReadingId(item.id);
    setReadingFileName(item.fileName);
    setError(null);
    try {
      const fileRes = await fetch(`/api/ai-reads/${item.id}/file`);
      if (!fileRes.ok) {
        setError(tx('โหลดไฟล์ต้นฉบับไม่สำเร็จ'));
        return;
      }
      const fileBase64 = await blobToBase64(await fileRes.blob());
      const res = await fetch('/api/timesheets/read', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          fileBase64,
          fileName: item.fileName,
          expectedPeriod: item.period ?? undefined,
          contractId: item.contract?.id ?? null,
          sourceAiReadId: item.id,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? tx('อ่านไฟล์ไม่สำเร็จ'));
        return;
      }
      setResult(data);
    } catch (e: any) {
      setError(e.message ?? tx('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้'));
    } finally {
      setReadingId(null);
    }
  }

  if (result) {
    return (
      <Card title={tx('ตรวจสอบก่อนบันทึกเข้าระบบ')}>
        <ReviewCard
          result={result}
          onDone={() => {
            setResult(null);
            onReload();
          }}
        />
      </Card>
    );
  }

  return (
    <>
      <Card title={tx('รอจากพนักงาน')} right={<span className="sub">{tx('ไฟล์ที่พนักงานส่งเองผ่านระบบ รอฝั่งบัญชีอ่านและยืนยัน')}</span>} flush>
        {items === null ? (
          <Loading rows={4} />
        ) : items.length === 0 ? (
          <EmptyState label={tx('ยังไม่มีไฟล์ที่พนักงานส่งเข้ามารอตรวจ')} />
        ) : (
          <div className="tw">
            <table>
              <thead>
                <tr>
                  <th>{tx('พนักงาน')}</th>
                  <th>{tx('รอบบิล')}</th>
                  <th>{tx('ช่องทาง')}</th>
                  <th>{tx('สัญญา/บริษัท')}</th>
                  <th>{tx('ไฟล์')}</th>
                  <th>{tx('ส่งเมื่อ')}</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {items.map((it) => (
                  <tr key={it.id}>
                    <td className="nm">{it.employeeName ?? tx('ไม่ทราบชื่อ')}</td>
                    <td>{it.periodLabel ?? '—'}</td>
                    <td>
                      <Tag tone="mu">{tx('พนักงานส่งเองผ่านระบบ OBS')}</Tag>
                    </td>
                    <td className="sub">
                      {it.contract ? `${it.contract.customerName} · ${it.contract.projectName}` : tx('จับคู่สัญญาไม่ได้')}
                    </td>
                    <td>
                      <button
                        type="button"
                        className="lnk"
                        style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
                        onClick={() => it.fileName && openPdfPreview(`/api/ai-reads/${it.id}/file`, it.fileName)}
                      >
                        <Icon name="file" className="sm" /> {it.fileName ?? '—'}
                      </button>
                    </td>
                    <td className="sub">{it.readAt?.slice(0, 19).replace('T', ' ')}</td>
                    <td className="r">
                      <button
                        className="btn pri sm"
                        disabled={readingId === it.id}
                        onClick={() => doRead(it)}
                      >
                        {readingId === it.id ? tx('กำลังอ่าน…') : tx('อ่านไฟล์นี้')}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {error && <div style={{ padding: '0 20px 20px', color: 'var(--cr)' }}>{error}</div>}
      </Card>

      {readingId !== null && <ReadingCard fileName={readingFileName} />}
    </>
  );
}
