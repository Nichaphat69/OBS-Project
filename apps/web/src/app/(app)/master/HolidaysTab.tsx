'use client';

import { useEffect, useState } from 'react';
import { Card, ErrorState, Loading, Tag } from '../../../components/ui';
import { Icon } from '../../../components/Icon';
import { useConfirm, useToast } from '../../../components/Overlays';
import { useLang, formatDate, formatYear } from '../../../lib/language';

interface HolidayRow {
  date: string;
  name: string;
  customerId: string | null;
}
interface HolidaysResponse {
  year: number;
  years: number[];
  holidays: HolidayRow[];
}

const dateOnly = formatDate;

/** ported from public/app.js's renderMaster() วันหยุดแท็บ — เติมวันหยุดราชการทางการให้อัตโนมัติตาม
 * ปีที่เลือก (ฝั่งเซิร์ฟเวอร์ทำให้เองตอน GET) ไม่มีฟอร์มเพิ่มวันหยุดในหน้านี้ (ต้นฉบับก็ไม่มีเหมือนกัน
 * — ปี 2570 เป็นต้นไปที่ยังไม่มีข้อมูลทางการต้องเรียก API ตรงๆ หรือรอ deploy รุ่นถัดไป) */
export default function HolidaysTab() {
  const confirm = useConfirm();
  const toast = useToast();
  const { tx, lang } = useLang();
  const [year, setYear] = useState<number>(new Date().getFullYear());
  const [data, setData] = useState<HolidaysResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  function load(y: number) {
    setError(null);
    // scoped=1 = วันหยุดทุกบริษัท + ของบริษัทเจ้าของ PO ที่เลือกบนแถบบน
    fetch(`/api/holidays?year=${y}&scoped=1`, { cache: 'no-store' })
      .then(async (r) => {
        if (!r.ok) {
          const body = await r.json().catch(() => ({}));
          setError(body?.error ?? tx('โหลดข้อมูลไม่สำเร็จ'));
          return;
        }
        setData(await r.json());
      })
      .catch(() => setError(tx('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้')));
  }

  useEffect(() => load(year), [year]);

  async function removeHoliday(h: HolidayRow) {
    const ok = await confirm({
      iconName: 'trash-solid',
      title: tx('ลบวันหยุดนี้?'),
      message: `"${h.name}" ${tx('วันที่')} ${dateOnly(h.date, lang)} ${tx('จะหายไปจากปฏิทินวันหยุด')}`,
      confirmLabel: tx('ลบ'),
    });
    if (!ok) return;
    try {
      const params = new URLSearchParams({ date: h.date });
      if (h.customerId) params.set('customerId', h.customerId);
      const res = await fetch(`/api/holidays?${params}`, { method: 'DELETE' });
      const body = await res.json();
      if (!res.ok) {
        toast(body?.error ?? tx('ลบไม่สำเร็จ'), true);
        return;
      }
      toast(tx('ลบแล้ว'));
      load(year);
    } catch {
      toast(tx('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้'), true);
    }
  }

  if (error) return <ErrorState message={error} onRetry={() => load(year)} />;
  if (!data)
    return (
      <Card title={tx('ปฏิทินวันหยุด')}>
        <Loading />
      </Card>
    );

  return (
    <Card
      title={tx('ปฏิทินวันหยุด')}
      right={
        <span className="selectchip">
          <select value={year} onChange={(e) => setYear(Number(e.target.value))}>
            {data.years.map((y) => (
              <option key={y} value={y}>
                {formatYear(y, lang)}
              </option>
            ))}
          </select>
        </span>
      }
      footer={<small className="sub">{tx('เติมวันหยุดราชการทางการให้อัตโนมัติตามปีที่เลือก ไม่ต้องพิมพ์เพิ่มเอง')}</small>}
    >
      <div className="tw">
        <table>
          <thead>
            <tr>
              <th>{tx('วันที่')}</th>
              <th>{tx('ชื่อวันหยุด')}</th>
              <th>{tx('ขอบเขต')}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {data.holidays.map((h) => (
              <tr key={`${h.date}-${h.customerId ?? ''}`}>
                <td className="n">{dateOnly(h.date, lang)}</td>
                <td>{h.name}</td>
                <td>{h.customerId ? h.customerId : <Tag tone="mu">{tx('ทุกบริษัท')}</Tag>}</td>
                <td>
                  <button className="btn sm icon dgr" onClick={() => removeHoliday(h)} title={tx('ลบวันหยุดนี้')}>
                    <Icon name="trash" />
                  </button>
                </td>
              </tr>
            ))}
            {data.holidays.length === 0 && (
              <tr>
                <td colSpan={4} style={{ textAlign: 'center', color: 'var(--mut)' }}>
                  {tx('ยังไม่มีข้อมูลวันหยุดทางการของปีนี้ในระบบ')}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
