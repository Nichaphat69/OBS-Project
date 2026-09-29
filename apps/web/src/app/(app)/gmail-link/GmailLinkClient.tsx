'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Card, ErrorState, Loading, StatusPill } from '../../../components/ui';
import { Icon } from '../../../components/Icon';
import { useLang } from '../../../lib/language';
import { readJson } from '../../../lib/fetchJson';

interface ConnectionStatus {
  connected: boolean;
  email: string | null;
  connectedBy: string | null;
  connectedAt: string | null;
  lastOkAt: string | null;
  lastError: string | null;
  lastErrorAt: string | null;
  canReadMail: boolean;
  usingEnvFallback: boolean;
}

/** โลโก้ Google ตัวเดียวกับปุ่มเข้าสู่ระบบ — ให้คนจำได้ว่ากำลังจะไปหน้าจอของ Google */
function GoogleMark() {
  return (
    <svg viewBox="0 0 18 18" width="17" height="17" aria-hidden="true">
      <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62Z" />
      <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.81.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.95v2.33A9 9 0 0 0 9 18Z" />
      <path fill="#FBBC05" d="M3.97 10.72A5.4 5.4 0 0 1 3.68 9c0-.6.1-1.18.29-1.72V4.95H.95A9 9 0 0 0 0 9c0 1.45.35 2.83.95 4.05l3.02-2.33Z" />
      <path fill="#EA4335" d="M9 3.58c1.32 0 2.51.46 3.44 1.35l2.59-2.59A8.9 8.9 0 0 0 9 0 9 9 0 0 0 .95 4.95l3.02 2.33C4.68 5.16 6.66 3.58 9 3.58Z" />
    </svg>
  );
}

/** วันเวลาแบบอ่านง่าย — ไม่เอาวินาที (เจ้าของระบบสั่งไว้ 25 ก.ย. 69 ว่าเวลาเอาแค่ชั่วโมงกับนาที) */
function thaiDateTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('th-TH', { day: 'numeric', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export default function GmailLinkClient() {
  const { tx } = useLang();
  const searchParams = useSearchParams();
  const [status, setStatus] = useState<ConnectionStatus | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [flash, setFlash] = useState<{ tone: 'ok' | 'bad' | 'mut'; text: string } | null>(null);
  const [disconnecting, setDisconnecting] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);

  const load = useCallback(() => {
    setLoadError(null);
    fetch('/api/gmail/connection', { cache: 'no-store' })
      .then(async (r) => {
        const { ok, data, error } = await readJson<ConnectionStatus>(r);
        if (!ok || !data) {
          setLoadError(error ?? tx('โหลดสถานะไม่สำเร็จ'));
          return;
        }
        setStatus(data);
      })
      .catch(() => setLoadError(tx('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้')));
  }, [tx]);

  useEffect(load, [load]);

  /* Google พากลับมาที่หน้านี้พร้อมผลลัพธ์ใน query string (ดู routes/gmail.ts's /connect/callback)
     — ล้าง query ทิ้งหลังอ่าน ไม่งั้นกดรีเฟรชแล้วข้อความเดิมจะเด้งซ้ำทั้งที่ไม่ได้ทำอะไรใหม่ */
  useEffect(() => {
    const connected = searchParams.get('connected');
    const connectError = searchParams.get('connectError');
    const cancelled = searchParams.get('cancelled');
    if (connected) setFlash({ tone: 'ok', text: `${tx('เชื่อมต่อกล่อง')} ${connected} ${tx('เรียบร้อยแล้ว')}` });
    else if (connectError) setFlash({ tone: 'bad', text: connectError });
    else if (cancelled) setFlash({ tone: 'mut', text: tx('ยกเลิกการเชื่อมต่อที่หน้าจอของ Google — ยังไม่มีอะไรเปลี่ยน') });
    if (connected || connectError || cancelled) {
      window.history.replaceState(null, '', '/gmail-link');
      load();
    }
  }, [searchParams, tx, load]);

  async function doDisconnect() {
    setDisconnecting(true);
    try {
      const res = await fetch('/api/gmail/connect/disconnect', { method: 'POST' });
      const { ok, error } = await readJson(res);
      if (!ok) {
        setFlash({ tone: 'bad', text: error ?? tx('ยกเลิกการเชื่อมต่อไม่สำเร็จ') });
        return;
      }
      setConfirmDisconnect(false);
      setFlash({ tone: 'mut', text: tx('ยกเลิกการเชื่อมต่อแล้ว — ระบบจะดึงอีเมลไม่ได้จนกว่าจะเชื่อมใหม่') });
      load();
    } finally {
      setDisconnecting(false);
    }
  }

  if (loadError) return <ErrorState message={loadError} onRetry={load} />;
  if (!status) return <Loading variant="lines" rows={3} />;

  const broken = status.connected && Boolean(status.lastError);
  const missingScope = status.connected && !status.usingEnvFallback && !status.canReadMail;

  return (
    <>
      {flash && (
        <div className={`note ${flash.tone === 'ok' ? 'ok' : flash.tone === 'bad' ? 'cr' : ''}`} style={{ marginBottom: 14 }}>
          <Icon name={flash.tone === 'bad' ? 'alt' : 'chk'} />
          <span>{flash.text}</span>
        </div>
      )}

      <Card>
        {status.connected ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, flexWrap: 'wrap' }}>
              <span
                aria-hidden="true"
                style={{
                  display: 'grid', placeItems: 'center', width: 44, height: 44, borderRadius: 12,
                  background: broken || missingScope ? 'var(--cr-soft, #fbeae9)' : 'var(--ok-soft, #e7f4ec)', flex: '0 0 auto',
                }}
              >
                <Icon name={broken || missingScope ? 'alt' : 'chk'} />
              </span>
              <div style={{ flex: '1 1 260px', minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <b style={{ fontSize: 16, wordBreak: 'break-all' }}>{status.email ?? tx('ใช้ค่าที่ตั้งไว้ในเซิร์ฟเวอร์')}</b>
                  <StatusPill tone={broken || missingScope ? 'cr' : 'ok'}>
                    {broken ? tx('ใช้งานไม่ได้') : missingScope ? tx('สิทธิ์ไม่พอ') : tx('ใช้งานได้')}
                  </StatusPill>
                </div>
                <div className="sub" style={{ marginTop: 4 }}>
                  {tx('ระบบกำลังอ่านอีเมล Timesheet จากกล่องนี้')}
                </div>
              </div>
            </div>

            <dl
              style={{
                display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
                gap: 14, margin: 0, paddingTop: 16, borderTop: '1px solid var(--rule, #eaeef3)',
              }}
            >
              <div>
                <dt className="sub">{tx('เชื่อมเมื่อ')}</dt>
                <dd style={{ margin: '2px 0 0' }}>{thaiDateTime(status.connectedAt)}</dd>
              </div>
              <div>
                <dt className="sub">{tx('เชื่อมโดย')}</dt>
                <dd style={{ margin: '2px 0 0' }}>{status.connectedBy ?? '—'}</dd>
              </div>
              <div>
                <dt className="sub">{tx('ใช้งานล่าสุด')}</dt>
                <dd style={{ margin: '2px 0 0' }}>{thaiDateTime(status.lastOkAt)}</dd>
              </div>
            </dl>

            {status.usingEnvFallback && (
              <div className="note">
                <Icon name="info" />
                <span>
                  {tx('ตอนนี้ยังใช้ค่าที่ตั้งไว้ในไฟล์ของเซิร์ฟเวอร์ ซึ่งเปลี่ยนเองจากหน้านี้ไม่ได้ — กดเชื่อมต่อด้วยบัญชี Google หนึ่งครั้ง แล้วต่อจากนั้นจะเปลี่ยนกล่องเองได้ทุกเมื่อ')}
                </span>
              </div>
            )}

            {missingScope && (
              <div className="note cr">
                <Icon name="alt" />
                <span>
                  {tx('บัญชีนี้ยินยอมแล้วแต่ไม่ได้ให้สิทธิ์อ่านอีเมล ระบบจึงดึงอีเมลไม่ได้ — กดเชื่อมต่อใหม่แล้วติ๊กอนุญาตให้อ่าน Gmail ตอนที่ Google ถาม')}
                </span>
              </div>
            )}

            {broken && (
              <div className="note cr">
                <Icon name="alt" />
                <span>
                  <b>{tx('สิทธิ์เข้าถึงกล่องนี้ใช้ไม่ได้แล้ว')}</b>
                  {' — '}
                  {status.lastError}
                  <span className="sub" style={{ display: 'block', marginTop: 2 }}>
                    {tx('เมื่อ')} {thaiDateTime(status.lastErrorAt)} · {tx('มักเกิดเมื่อเจ้าของกล่องเปลี่ยนรหัสผ่านหรือถอนสิทธิ์')}
                  </span>
                </span>
              </div>
            )}

            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <a className={`btn${broken || missingScope ? ' pri' : ''}`} href="/api/gmail/connect/start">
                <GoogleMark />
                {broken || missingScope ? tx('เชื่อมต่อใหม่') : tx('เปลี่ยนกล่องอีเมล')}
              </a>
              {!status.usingEnvFallback && !confirmDisconnect && (
                <button type="button" className="btn" onClick={() => setConfirmDisconnect(true)}>
                  {tx('ยกเลิกการเชื่อมต่อ')}
                </button>
              )}
            </div>

            {confirmDisconnect && (
              <div className="note cr">
                <Icon name="alt" />
                <span>
                  <b>{tx('ยกเลิกการเชื่อมต่อกล่องนี้?')}</b>
                  <span className="sub" style={{ display: 'block', margin: '2px 0 10px' }}>
                    {tx('ระบบจะดึงอีเมล Timesheet และสร้างร่างอีเมลวางบิลไม่ได้ จนกว่าจะเชื่อมกล่องใหม่')}
                  </span>
                  <span style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <button type="button" className="btn dg" disabled={disconnecting} onClick={doDisconnect}>
                      {disconnecting ? tx('กำลังยกเลิก…') : tx('ยืนยันยกเลิก')}
                    </button>
                    <button type="button" className="btn" onClick={() => setConfirmDisconnect(false)}>
                      {tx('ไม่ยกเลิก')}
                    </button>
                  </span>
                </span>
              </div>
            )}
          </div>
        ) : (
          <div style={{ textAlign: 'center', padding: '22px 0 8px' }}>
            <span
              aria-hidden="true"
              style={{
                display: 'grid', placeItems: 'center', width: 56, height: 56, borderRadius: 16,
                background: 'var(--hair, #eaeef3)', margin: '0 auto 14px',
              }}
            >
              <Icon name="mail" />
            </span>
            <div style={{ fontSize: 17, fontWeight: 700 }}>{tx('ยังไม่ได้เชื่อมกล่องอีเมล')}</div>
            <div className="sub" style={{ maxWidth: 460, margin: '6px auto 18px', lineHeight: 1.6 }}>
              {tx('เชื่อมกล่องที่ลูกค้าส่งอีเมล Timesheet มาให้ ระบบจะได้ดึงไฟล์แนบมาอ่านและตรวจให้อัตโนมัติ')}
            </div>
            <a className="btn pri" href="/api/gmail/connect/start">
              <GoogleMark />
              {tx('เชื่อมต่อด้วยบัญชี Google')}
            </a>
          </div>
        )}
      </Card>

      <Card>
        <div className="section-title" style={{ marginBottom: 10 }}>{tx('เรื่องที่ควรรู้ก่อนกด')}</div>
        <ul style={{ margin: 0, paddingLeft: 20, lineHeight: 1.75 }}>
          <li>
            <b>{tx('เจ้าของกล่องต้องเป็นคนกดเอง')}</b>
            {' — '}
            {tx('Google ผูกสิทธิ์กับบัญชีที่ล็อกอินอยู่ในเบราว์เซอร์ตอนกดยินยอม ไม่ใช่บัญชีที่ล็อกอินเข้าระบบนี้')}
          </li>
          <li>
            <b>{tx('คนละเรื่องกับการเข้าสู่ระบบด้วย Google')}</b>
            {' — '}
            {tx('การล็อกอินขอแค่ชื่อกับอีเมลเพื่อรู้ว่าคุณเป็นใคร ส่วนตรงนี้คือการขออนุญาตอ่านอีเมลในกล่อง')}
          </li>
          <li>
            <b>{tx('ระบบเห็นอะไร')}</b>
            {' — '}
            {tx('อ่านอีเมลได้อย่างเดียว ส่งหรือลบแทนไม่ได้ และเจ้าของกล่องถอนสิทธิ์เองได้ตลอดเวลาที่หน้าบัญชี Google')}
          </li>
          <li>
            <b>{tx('มีกล่องที่ใช้งานได้ทีละหนึ่ง')}</b>
            {' — '}
            {tx('เชื่อมกล่องใหม่ทับได้ ระบบจะเปลี่ยนไปอ่านกล่องนั้นแทนทันที และบันทึกไว้ว่าใครเป็นคนเปลี่ยน')}
          </li>
        </ul>
      </Card>
    </>
  );
}
