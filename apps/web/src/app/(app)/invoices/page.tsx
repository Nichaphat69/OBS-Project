'use client';

import { useEffect, useState } from 'react';
import { Card, PageHeader, PoTag, StatusPill } from '../../../components/ui';
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

export default function InvoicesPage() {
  const { tx } = useLang();
  const [rows, setRows] = useState<InvoiceRow[] | null>(null);

  // ไม่ส่ง contractId ขึ้นไปแล้ว — เซิร์ฟเวอร์เลือกสัญญาที่กำลังดำเนินการอยู่ให้เอง เหตุผลเดียวกับหน้า
  // ตรวจ Manday: ถ้าหน้าเว็บดึงสัญญา active มาไม่ได้ query จะว่าง แล้วกลายเป็น "ขอทุกบริษัท" คือพลาด
  // แล้วขอบเขตกว้างขึ้น ซึ่งผิดทิศสำหรับยอดเงินของลูกค้าแต่ละราย
  useEffect(() => {
    fetch('/api/invoices', { cache: 'no-store' })
      .then((r) => r.json())
      .then(setRows);
  }, []);

  return (
    <>
      <PageHeader eyebrow={tx('เอกสาร')} title={tx('ใบแจ้งหนี้')} subtitle={tx('เอกสารที่ระบบสร้างเข้า FlowAccount')} />

      <Card flush>
        <div className="tw">
          <table>
            <thead>
              <tr>
                <th>{tx('เลขที่เอกสาร')}</th>
                <th>{tx('ลูกค้า')}</th>
                <th>{tx('รอบบิล')}</th>
                <th>{tx('วันที่เอกสาร')}</th>
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
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-start' }}>
                      <span className="nm">{r.customerName}</span>
                      <PoTag>{r.poNo}</PoTag>
                    </div>
                  </td>
                  <td>{r.periodLabel}</td>
                  <td>{r.documentDate}</td>
                  <td className="r n">{money(r.paymentAmount)}</td>
                  <td>
                    <StatusPill tone={STATUS_TONE[r.status] ?? 'mu'}>{r.status}</StatusPill>
                  </td>
                </tr>
              ))}
              {rows && rows.length === 0 && (
                <tr>
                  <td colSpan={6} style={{ textAlign: 'center', color: 'var(--mut)' }}>
                    {tx('ยังไม่มีใบแจ้งหนี้')}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
