'use client';

import { useEffect, useState } from 'react';
import { Card, ErrorState, Loading, PageHeader, PoTag, StatusPill } from '../../../components/ui';
import { useLang } from '../../../lib/language';

interface InvoiceRow {
  id: string;
  poNo: string;
  customerName: string;
  periodLabel: string;
  documentNo: string | null;
  documentDate: string;
  paymentAmount: number;
  status: string;
  shareLink: string | null;
}

function money(n: number) {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const STATUS_TONE: Record<string, 'ok' | 'wn' | 'mu'> = {
  sent_to_flowaccount: 'ok',
  draft: 'wn',
};

// เดิมตารางนี้โชว์ค่า enum ดิบจากฐานข้อมูล (เช่น "sent_to_flowaccount") ตรงๆ — บั๊กจริงที่เจ้าของระบบ
// ชี้มา 18 ก.ย. 69 ไม่ใช่แค่ปรับคำ ค่าที่เป็นไปได้มีแค่สองค่าจริงๆ (ดู flowaccountClient.ts/cyclesService.ts)
const STATUS_LABEL: Record<string, string> = {
  sent_to_flowaccount: 'วางบิลแล้ว',
  draft: 'ร่าง',
};

export default function InvoicesClient() {
  const { tx } = useLang();
  const [rows, setRows] = useState<InvoiceRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // ไม่ส่ง contractId ขึ้นไปแล้ว — เซิร์ฟเวอร์เลือกสัญญาที่กำลังดำเนินการอยู่ให้เอง เหตุผลเดียวกับหน้า
  // ตรวจ Manday: ถ้าหน้าเว็บดึงสัญญา active มาไม่ได้ query จะว่าง แล้วกลายเป็น "ขอทุกบริษัท" คือพลาด
  // แล้วขอบเขตกว้างขึ้น ซึ่งผิดทิศสำหรับยอดเงินของลูกค้าแต่ละราย
  // เดิมไม่มี .catch — พอมี skeleton ตอน rows เป็น null แล้ว โหลดพังจะกลายเป็นหมุนค้างตลอดไป จึงเพิ่ม error state
  function load() {
    setError(null);
    fetch('/api/invoices', { cache: 'no-store' })
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

  useEffect(load, []);

  return (
    <>
      <PageHeader eyebrow={tx('เอกสาร')} title={tx('ใบแจ้งหนี้')} subtitle={tx('เอกสารที่ระบบสร้างเข้า FlowAccount')} />

      <Card flush>
        {error ? (
          <ErrorState message={error} onRetry={load} />
        ) : (
        <div className="tw">
          <table>
            <thead>
              <tr>
                <th>{tx('เลขที่เอกสาร')}</th>
                <th>{tx('เลขที่สัญญา/PO')}</th>
                <th>{tx('บริษัท')}</th>
                <th>{tx('รอบบิล')}</th>
                <th>{tx('วันที่วางบิล')}</th>
                <th className="r">{tx('ยอดรับชำระ')}</th>
                <th>{tx('สถานะ')}</th>
              </tr>
            </thead>
            <tbody>
              {rows?.map((r) => (
                <tr key={r.id}>
                  <td className="docid">
                    {r.shareLink ? (
                      <a href={r.shareLink} target="_blank" rel="noreferrer">
                        {r.documentNo ?? r.id}
                      </a>
                    ) : (
                      r.documentNo ?? r.id
                    )}
                  </td>
                  <td>
                    <PoTag>{r.poNo}</PoTag>
                  </td>
                  <td className="nm">{r.customerName}</td>
                  <td>{r.periodLabel}</td>
                  <td>{r.documentDate}</td>
                  <td className="r n">{money(r.paymentAmount)}</td>
                  <td>
                    <StatusPill tone={STATUS_TONE[r.status] ?? 'mu'}>{tx(STATUS_LABEL[r.status] ?? r.status)}</StatusPill>
                  </td>
                </tr>
              ))}
              {rows === null && (
                <tr>
                  <td colSpan={7}>
                    <Loading rows={5} />
                  </td>
                </tr>
              )}
              {rows && rows.length === 0 && (
                <tr>
                  <td colSpan={7} style={{ textAlign: 'center', color: 'var(--mut)' }}>
                    {tx('ยังไม่มีใบแจ้งหนี้')}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        )}
      </Card>
    </>
  );
}
