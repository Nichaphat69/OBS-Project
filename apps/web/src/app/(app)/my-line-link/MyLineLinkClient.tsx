'use client';

import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Card, ErrorState, StatusPill } from '../../../components/ui';
import { useLang } from '../../../lib/language';

export default function MyLineLinkClient() {
  const { tx } = useLang();
  const [linked, setLinked] = useState<boolean | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [unlinking, setUnlinking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [addFriendUrl, setAddFriendUrl] = useState<string | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [oaFailed, setOaFailed] = useState(false);

  function load() {
    setLoadError(null);
    fetch('/api/my-line-link/status', { cache: 'no-store' })
      .then(async (r) => {
        const data = await r.json().catch(() => ({}));
        // 404 = บัญชีนี้ไม่ได้ผูกกับพนักงานคนไหนเลย (ต่างจาก linked=false ที่แปลว่าผูกกับพนักงานแล้ว
        // แต่ยังไม่เชื่อม LINE) — ต้องแยกให้ user รู้ว่าต้องให้ admin ผูกบัญชีก่อน ไม่ใช่แค่กด "เชื่อมต่อ"
        if (!r.ok) {
          setLoadError(data?.error ?? tx('โหลดสถานะไม่สำเร็จ'));
          return;
        }
        setLinked(Boolean(data.linked));
      })
      .catch(() => setLoadError(tx('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้')));
  }

  useEffect(load, []);

  // ลิงก์แอดเพื่อน OA ไว้ล่วงหน้าก่อน user กด "เชื่อมต่อไลน์" — พนักงานใหม่ที่ยังไม่เคยแอด LINE บริษัท
  // จะได้รู้ว่าต้องแอดก่อนถึงจะพิมพ์รหัสได้ (ของเดิมมีแค่คำอธิบายเฉยๆ ไม่มีลิงก์/QR ให้กดจริง)
  useEffect(() => {
    if (linked !== false) return;
    setOaFailed(false);
    fetch('/api/my-line-link/oa-info', { cache: 'no-store' })
      .then(async (r) => {
        const data = await r.json().catch(() => ({}));
        if (!r.ok || !data.addFriendUrl) {
          setOaFailed(true);
          return;
        }
        setAddFriendUrl(data.addFriendUrl);
        return QRCode.toDataURL(data.addFriendUrl, { width: 180, margin: 1 });
      })
      .then((dataUrl) => {
        if (dataUrl) setQrDataUrl(dataUrl);
      })
      .catch(() => {
        // ต้องบอกทางไปต่อเสมอ ห้ามปล่อยให้ "ขั้นตอนที่ 1" ว่างเปล่า — พนักงานใหม่ที่ยังไม่รู้จัก OA
        // จะไปต่อไม่ถูกเลยถ้าไม่มีทั้ง QR ทั้งลิงก์และไม่มีคำอธิบาย
        setOaFailed(true);
      });
  }, [linked]);

  async function start() {
    setStarting(true);
    setError(null);
    setCode(null);
    try {
      const res = await fetch('/api/my-line-link/start', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? tx('ขอรหัสไม่สำเร็จ'));
        return;
      }
      if (data.alreadyLinked) {
        setLinked(true);
        return;
      }
      setCode(data.code);
    } catch {
      setError(tx('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้'));
    } finally {
      setStarting(false);
    }
  }

  async function unlink() {
    const ok = window.confirm(tx('เลิกเชื่อมต่อไลน์?\n\nจะไม่ได้รับแจ้งเตือนสถานะ Timesheet ผ่านไลน์ส่วนตัวอีก — เชื่อมต่อใหม่ได้ทุกเมื่อ'));
    if (!ok) return;
    setUnlinking(true);
    setError(null);
    try {
      const res = await fetch('/api/my-line-link/unlink', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? tx('เลิกเชื่อมต่อไม่สำเร็จ'));
        return;
      }
      setLinked(false);
      setCode(null);
    } catch {
      setError(tx('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้'));
    } finally {
      setUnlinking(false);
    }
  }

  if (loadError) {
    return (
      <Card title={tx('สถานะการเชื่อมต่อ')}>
        <ErrorState message={loadError} onRetry={load} />
      </Card>
    );
  }

  return (
    <Card title={tx('สถานะการเชื่อมต่อ')}>
      {error && <div style={{ color: 'var(--cr)', marginBottom: 14 }}>{error}</div>}

      {linked === null ? null : linked ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <StatusPill tone="ok">✓ {tx('เชื่อมต่อไลน์แล้ว')}</StatusPill>
          <button className="btn ghost sm" disabled={unlinking} onClick={unlink}>
            {unlinking ? tx('กำลังเลิกเชื่อมต่อ…') : tx('เลิกเชื่อมต่อ')}
          </button>
        </div>
      ) : (
        <div>
          <div style={{ marginBottom: 18 }}>
            <div className="sub" style={{ marginBottom: 10 }}>
              {tx('ขั้นตอนที่ 1: แอดไลน์บริษัทก่อน (ข้ามได้ถ้าแอดไว้แล้ว)')}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
              {qrDataUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={qrDataUrl} alt={tx('QR แอดไลน์บริษัท')} width={140} height={140} style={{ borderRadius: 8, border: '1px solid var(--hair)' }} />
              )}
              {addFriendUrl && (
                <a className="btn ghost sm" href={addFriendUrl} target="_blank" rel="noopener noreferrer">
                  {tx('เพิ่มเพื่อนไลน์')} ↗
                </a>
              )}
              {oaFailed && !addFriendUrl && (
                <div className="sub">
                  {tx('ดึงลิงก์แอดไลน์อัตโนมัติไม่สำเร็จ — ค้นหา LINE OA ของบริษัทในแอป LINE แล้วแอดเป็นเพื่อนเอง หรือโหลดหน้านี้ใหม่อีกครั้ง')}
                </div>
              )}
            </div>
          </div>

          <div style={{ borderTop: '1px solid var(--hair)', paddingTop: 14, display: 'flex', alignItems: 'center', gap: 12, marginBottom: code ? 18 : 0 }}>
            <StatusPill tone="wn">{tx('ยังไม่ได้เชื่อมต่อ')}</StatusPill>
            <button className="btn pri sm" disabled={starting} onClick={start}>
              {starting ? tx('กำลังออกรหัส…') : tx('ขั้นตอนที่ 2: ขอรหัสเชื่อมต่อ')}
            </button>
          </div>
          {code && (
            <div style={{ borderTop: '1px solid var(--hair)', paddingTop: 14 }}>
              <div className="sub" style={{ marginBottom: 8 }}>
                {tx('ขั้นตอนที่ 3: พิมพ์รหัสนี้ส่งไปในแชทไลน์ที่แอดไว้ (หมดอายุใน 10 นาที)')}
              </div>
              <b style={{ fontSize: '1.3em', letterSpacing: '.05em' }}>{code}</b>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
