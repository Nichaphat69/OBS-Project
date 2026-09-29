'use client';

import { useMemo, useState } from 'react';
import { Card, EmptyState, Loading, Tag } from '../../../components/ui';
import { Icon } from '../../../components/Icon';
import { usePdfPreview } from '../../../components/Overlays';
import { useReaderPicker, ReaderPickerBar } from '../../../components/ReaderPicker';
import { QueueStatusCard } from '../../../components/QueueStatusCard';
import ReviewCard, { type ReadResultShape } from './ReviewCard';
import { useLang } from '../../../lib/language';
import { readJson } from '../../../lib/fetchJson';

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

/**
 * แท็บ "รอจากพนักงาน" — คิวไฟล์ Timesheet ที่พนักงานส่งเองผ่านหน้า "ส่ง Timesheet" (role `user`) แล้ว
 * แต่ยังไม่มีใครอ่านเข้าระบบ (เจ้าของระบบสั่ง 22 ก.ย. 69) — ไฟล์เก็บไว้แล้วจริงตั้งแต่ตอนส่ง (ai_reads,
 * source: 'employee_submit') แค่ต้องหยิบมาป้อนเข้า pipeline อ่าน/ยืนยันเดิม
 *
 * 25 ก.ย. 69 ตามที่ขอ — เปลี่ยนจากปุ่ม "อ่านไฟล์นี้" ทีละแถวเป็นติ๊กเลือกได้หลายแถว + เลือกตัวอ่าน/Skill
 * เอง + ปุ่ม "อ่านที่เลือก (N)" ครั้งเดียว เข้าคิวอ่านเบื้องหลังเหมือนแท็บ "อัปโหลดไฟล์" ทุกอย่าง (ไฟล์พวกนี้
 * มีอยู่แล้วในระบบเป็นแถว ai_reads status='pending_review' รอ — ใช้ POST /api/timesheets/read-queue's
 * enqueueExisting ตรงๆ ไม่ต้องอัปโหลดไฟล์ใหม่)
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
  const picker = useReaderPicker();
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [queuing, setQueuing] = useState(false);
  const [queuedIds, setQueuedIds] = useState<number[] | null>(null);
  const [reviewResult, setReviewResult] = useState<ReadResultShape | null>(null);
  const [reviewLoadingId, setReviewLoadingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const allSelected = items != null && items.length > 0 && items.every((it) => selected.has(it.id));

  function toggleOne(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (!items) return;
    setSelected(allSelected ? new Set() : new Set(items.map((it) => it.id)));
  }

  async function doReadSelected() {
    if (selected.size === 0) return;
    setQueuing(true);
    setError(null);
    try {
      const res = await fetch('/api/timesheets/read-queue', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          aiReadIds: [...selected],
          readerId: picker.readerId,
          abbyySkillId: picker.chosenReaderId === 'abbyy' ? picker.abbyySkillId : null,
        }),
      });
      const { ok, error: failure } = await readJson(res);
      if (!ok) {
        setError(failure ?? tx('เข้าคิวไม่สำเร็จ'));
        return;
      }
      setQueuedIds([...selected]);
      setSelected(new Set());
    } catch (e: any) {
      setError(e.message ?? tx('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้'));
    } finally {
      setQueuing(false);
    }
  }

  /** เปิด ReviewCard ตัวเดียวกับที่แท็บ "อัปโหลดไฟล์" ใช้ — แถวที่อ่านเสร็จแล้วในรายการคิวคลิกเข้าไป
   * ตรวจสอบ/ยืนยันได้เลย ไม่ต้องสลับไปแท็บ "ประวัติ" */
  function openReview(id: number) {
    setReviewLoadingId(id);
    fetch(`/api/ai-reads/${id}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((row: any) => {
        // ไม่ใส่ sourceAiReadId — แถวนี้ถูกอัปเดตในที่เดิมโดย processQueueOnce() (เหมือนแท็บ "อัปโหลดไฟล์")
        // ไม่ใช่แถวใหม่ที่ต้องย้อนไปปิดแถวต้นทางแยกต่างหากแบบโหมด sync-read เดิม
        setReviewResult({ ...(row.extraction ?? {}), documentNo: row.documentNo, model: row.model });
      })
      .catch(() => setError(tx('โหลดรายละเอียดไม่สำเร็จ')))
      .finally(() => setReviewLoadingId(null));
  }

  const selectedList = useMemo(() => (items ?? []).filter((it) => selected.has(it.id)), [items, selected]);

  if (reviewResult) {
    return (
      <Card title={tx('ตรวจสอบก่อนบันทึกเข้าระบบ')}>
        <ReviewCard
          result={reviewResult}
          onDone={() => {
            setReviewResult(null);
            onReload();
          }}
        />
      </Card>
    );
  }

  if (queuedIds !== null) {
    return (
      <QueueStatusCard
        ids={queuedIds}
        onOpenRow={openReview}
        openingId={reviewLoadingId}
        closeLabel={tx('กลับไปที่รายการ')}
        onClose={() => {
          setQueuedIds(null);
          onReload();
        }}
      />
    );
  }

  return (
    <Card title={tx('รอจากพนักงาน')} right={<span className="sub">{tx('ไฟล์ที่พนักงานส่งเองผ่านระบบ รอฝั่งบัญชีอ่านและยืนยัน')}</span>} flush>
      {items === null ? (
        <Loading rows={4} />
      ) : items.length === 0 ? (
        <EmptyState label={tx('ยังไม่มีไฟล์ที่พนักงานส่งเข้ามารอตรวจ')} />
      ) : (
        <>
          {/* แถบเลือกตัวอ่าน + สรุปจำนวนที่ติ๊กไว้ + ปุ่มอ่านที่เลือก (25 ก.ย. 69 ตามที่ขอ) */}
          <div className="bulkbar">
            <div className="bulkbar-count">
              <b>{selected.size}</b> {tx('รายการที่เลือก')}
              {selectedList.length > 0 && (
                <span className="sub"> · {selectedList.map((it) => it.employeeName ?? tx('ไม่ทราบชื่อ')).join(', ')}</span>
              )}
            </div>
            <div className="bulkbar-actions">
              <ReaderPickerBar picker={picker} disabled={queuing} />
              <button className="btn pri sm" disabled={selected.size === 0 || queuing} onClick={doReadSelected}>
                <Icon name="chk" className="sm" /> {queuing ? tx('กำลังเข้าคิว…') : `${tx('อ่านที่เลือก')} (${selected.size})`}
              </button>
            </div>
          </div>

          <div className="tw">
            <table>
              <thead>
                <tr>
                  <th style={{ width: 36 }}>
                    <input type="checkbox" checked={allSelected} onChange={toggleAll} aria-label={tx('เลือกทั้งหมด')} />
                  </th>
                  <th>{tx('พนักงาน')}</th>
                  <th>{tx('รอบบิล')}</th>
                  <th>{tx('ช่องทาง')}</th>
                  <th>{tx('สัญญา/บริษัท')}</th>
                  <th>{tx('ไฟล์')}</th>
                  <th>{tx('ส่งเมื่อ')}</th>
                </tr>
              </thead>
              <tbody>
                {items.map((it) => (
                  <tr key={it.id} className={selected.has(it.id) ? 'sel' : undefined}>
                    <td>
                      <input
                        type="checkbox"
                        checked={selected.has(it.id)}
                        onChange={() => toggleOne(it.id)}
                        aria-label={tx('เลือกแถวนี้')}
                      />
                    </td>
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
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      {error && <div style={{ padding: '0 20px 20px', color: 'var(--cr)' }}>{error}</div>}
    </Card>
  );
}
