'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import QRCode from 'qrcode';
import { Card, ErrorState, Loading } from '../../../components/ui';
import { useLang } from '../../../lib/language';

export default function MyLineLinkClient() {
  const { tx } = useLang();
  const searchParams = useSearchParams();
  const [linked, setLinked] = useState<boolean | null>(null);
  const [loginEnabled, setLoginEnabled] = useState(false);
  const [showCodeFlow, setShowCodeFlow] = useState(false);
  const [code, setCode] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [unlinking, setUnlinking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [addFriendUrl, setAddFriendUrl] = useState<string | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [oaFailed, setOaFailed] = useState(false);
  const [copied, setCopied] = useState(false);

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
        setLoginEnabled(Boolean(data.loginEnabled));
      })
      .catch(() => setLoadError(tx('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้')));
  }

  useEffect(load, []);

  // callback ของ LINE Login พากลับมาที่หน้านี้พร้อม query param บอกผล (ดู
  // apps/api/src/routes/myLineLink.ts's /oauth/callback) — วิธีเดียวกับที่ login/page.tsx อ่าน
  // googlePending/loginError จาก Google callback
  useEffect(() => {
    const lineLinked = searchParams.get('lineLinked');
    const lineLinkError = searchParams.get('lineLinkError');
    if (lineLinked) setLinked(true);
    if (lineLinkError) setError(lineLinkError);
    if (lineLinked || lineLinkError) window.history.replaceState(null, '', '/my-line-link');
  }, [searchParams]);

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

  async function copyCode() {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* คัดลอกไม่ได้ (เบราว์เซอร์บล็อก) — ผู้ใช้ยังเลือกรหัสแล้วคัดลอกเองได้ */
    }
  }

  // หน้าเชื่อมต่อ LINE (6 ต.ค. 69 จัดใหม่): การ์ดเดียวมีตราสัญลักษณ์ LINE ใหญ่ชัด (สีเขียวแบรนด์ LINE) · ปุ่มเชื่อมต่อเป็นสีเขียว LINE
  // · วิธีพิมพ์รหัสเป็นขั้นตอน 1-2-3 เลขวงกลมสีฟ้า #288adb — ตรรกะการเชื่อมต่อทั้งหมดเหมือนเดิม
  return (
    <div className="ll">
      {error && <div className="ll-err">{error}</div>}

      {linked === null ? (
        <div className="ll-card"><Loading variant="lines" rows={3} /></div>
      ) : linked ? (
        <div className="ll-card ok">
          <LineLogo size={72} />
          <div className="ll-body">
            <span className="ll-badge ok">✓ {tx('เชื่อมต่อไลน์แล้ว')}</span>
            <h2>{tx('บัญชี LINE ของคุณเชื่อมต่อกับ OBS แล้ว')}</h2>
            <p>{tx('ระบบจะส่งข้อความแจ้งเตือนมาที่ LINE ของคุณโดยตรง เลิกเชื่อมต่อได้ทุกเมื่อและเชื่อมต่อใหม่ได้เสมอ')}</p>
          </div>
          <button className="btn ghost dgr" disabled={unlinking} onClick={unlink}>
            {unlinking ? tx('กำลังเลิกเชื่อมต่อ…') : tx('เลิกเชื่อมต่อ')}
          </button>
        </div>
      ) : loginEnabled && !showCodeFlow ? (
        <div className="ll-card">
          <LineLogo size={72} />
          <div className="ll-body">
            <span className="ll-badge wn">{tx('ยังไม่ได้เชื่อมต่อ')}</span>
            <h2>{tx('เชื่อมต่อบัญชี LINE ของคุณ')}</h2>
            <p>{tx('กดปุ่มด้านล่างแล้วยืนยันตัวตนในแอป LINE — ระบบจะรู้จักบัญชีไลน์ของคุณอัตโนมัติ ไม่ต้องพิมพ์รหัสเอง (ถ้ายังไม่เคยแอดไลน์บริษัท จะมีหน้าชวนแอดโผล่ขึ้นมาให้ระหว่างทาง)')}</p>
            <div className="ll-acts">
              <a className="ll-btn" href="/api/my-line-link/oauth/start">
                <LineGlyph /> {tx('เชื่อมต่อด้วย LINE')}
              </a>
              <button type="button" className="ll-link" onClick={() => setShowCodeFlow(true)}>
                {tx('เชื่อมต่อด้วยไลน์ไม่ได้? ใช้วิธีพิมพ์รหัสแทน')}
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="ll-steps">
          <div className="ll-head">
            <LineLogo size={48} />
            <div>
              <span className="ll-badge wn">{tx('ยังไม่ได้เชื่อมต่อ')}</span>
              <h2>{tx('เชื่อมต่อ LINE ด้วยรหัส')}</h2>
            </div>
          </div>

          <div className="ll-step">
            <span className="ll-n">1</span>
            <div className="ll-sb">
              <b>{tx('ขั้นตอนที่ 1: แอดไลน์บริษัทก่อน (ข้ามได้ถ้าแอดไว้แล้ว)')}</b>
              <div className="ll-row">
                {qrDataUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={qrDataUrl} alt={tx('QR แอดไลน์บริษัท')} width={140} height={140} className="ll-qr" />
                )}
                {addFriendUrl && (
                  <a className="ll-btn" href={addFriendUrl} target="_blank" rel="noopener noreferrer">
                    <LineGlyph /> {tx('เพิ่มเพื่อนไลน์')} ↗
                  </a>
                )}
                {oaFailed && !addFriendUrl && (
                  <span className="sub">
                    {tx('ดึงลิงก์แอดไลน์อัตโนมัติไม่สำเร็จ — ค้นหา LINE OA ของบริษัทในแอป LINE แล้วแอดเป็นเพื่อนเอง หรือโหลดหน้านี้ใหม่อีกครั้ง')}
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="ll-step">
            <span className="ll-n">2</span>
            <div className="ll-sb">
              <b>{tx('ขั้นตอนที่ 2: ขอรหัสเชื่อมต่อ')}</b>
              <div className="ll-row">
                <button className="btn pri" disabled={starting} onClick={start}>
                  {starting ? tx('กำลังออกรหัส…') : tx('ขอรหัสเชื่อมต่อ')}
                </button>
              </div>
            </div>
          </div>

          <div className={`ll-step${code ? '' : ' off'}`}>
            <span className="ll-n">3</span>
            <div className="ll-sb">
              <b>{tx('ขั้นตอนที่ 3: พิมพ์รหัสนี้ส่งไปในแชทไลน์ที่แอดไว้ (หมดอายุใน 10 นาที)')}</b>
              {code && (
                <div className="ll-code">
                  <span>{code}</span>
                  <button type="button" className="btn sm" onClick={copyCode}>{copied ? tx('คัดลอกแล้ว') : tx('คัดลอก')}</button>
                </div>
              )}
            </div>
          </div>

          {loginEnabled && (
            <button type="button" className="ll-link" onClick={() => setShowCodeFlow(false)}>
              {tx('← กลับไปใช้วิธีเชื่อมต่อด้วย LINE (คลิกเดียว)')}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** ตราสัญลักษณ์ LINE: ช่องมนสีเขียวแบรนด์ LINE (#06C755) + ฟองคำพูดสีขาว + ตัวอักษร LINE */
function LineLogo({ size = 64 }: { size?: number }) {
  return (
    <svg className="ll-logo" width={size} height={size} viewBox="0 0 64 64" role="img" aria-label="LINE">
      <rect width="64" height="64" rx="16" fill="#06C755" />
      <path
        fill="#fff"
        d="M32 12C20.4 12 11 19.5 11 28.8c0 8.3 7.4 15.3 17.3 16.6.7.1 1.6.4 1.8 1 .2.5.1 1.3.1 1.8l-.3 1.7c-.1.5-.4 1.8 1.6 1 2-.9 10.7-6.3 14.6-10.8C48.8 36.6 53 33 53 28.8 53 19.5 43.6 12 32 12z"
      />
      <text x="32" y="33" textAnchor="middle" fontFamily="Arial, Helvetica, sans-serif" fontWeight="800" fontSize="11" letterSpacing="0.2" fill="#06C755">
        LINE
      </text>
    </svg>
  );
}

/** ไอคอนฟองคำพูด LINE ขนาดเล็กสำหรับใส่ในปุ่ม */
function LineGlyph() {
  return (
    <svg width="20" height="20" viewBox="0 0 64 64" aria-hidden="true">
      <path
        fill="#fff"
        d="M32 8C18.7 8 8 16.6 8 27.2c0 9.5 8.5 17.5 19.9 19 .8.2 1.8.5 2.1 1.2.2.6.1 1.5.1 2.1l-.3 2c-.1.6-.5 2.1 1.8 1.1 2.3-1 12.3-7.2 16.8-12.4C53.200 35.600 56 31.600 56 27.200 56 16.600 45.300 8 32 8z"
      />
    </svg>
  );
}
