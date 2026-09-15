'use client';

import { useEffect, useState } from 'react';
import { Card, Tag } from '../../../components/ui';
import { SETTINGS_CHANGED_EVENT } from '../../../lib/settingsChanged';
import { useLang } from '../../../lib/language';

interface Settings {
  flowaccount: { mode?: string; documentType?: string };
  billingRules: { billOnDayOfNextMonth?: number; requireAllTimesheets?: boolean; requireHumanCheck?: boolean };
  env: {
    flowAccountMode: string;
    hasFlowAccountCredentials: boolean;
    localLlmBaseUrl: string;
    localTextModel: string;
    localVisionModel: string;
    hasGmail: boolean;
    gmailQuery: string;
    hasLine: boolean;
    lineRecipientCount: number;
    appBaseUrl: string | null;
  };
}

/** ported from public/app.js's renderSystemAdmin() tab 1 ("ภาพรวม") — สองการ์ดอ่านอย่างเดียวล้วนๆ
 * แสดงสถานะการเชื่อมต่อภายนอก (.env) + เงื่อนไขวางบิลที่ตั้งไว้ ไม่มีปุ่มแก้ไขในหน้านี้เลย
 * (สวิตช์เชื่อมต่อ FlowAccount อยู่ที่ชิปบนแถบบนต่างหาก — ดู AppShell.tsx's toggleFlowAccount) */
export default function OverviewTab() {
  const { tx } = useLang();
  const [settings, setSettings] = useState<Settings | null>(null);

  useEffect(() => {
    function load() {
      fetch('/api/settings', { cache: 'no-store' })
        .then((r) => r.json())
        .then(setSettings);
    }
    load();
    // สวิตช์ FlowAccount บนแถบบน (AppShell.tsx) แก้ค่านี้ได้จากทุกหน้า — ฟังอีเวนต์นี้เพื่อดึงค่าล่าสุด
    // ทันทีถ้าแท็บนี้เปิดค้างอยู่ตอนกด (เหมือน ต้นฉบับ ที่ refreshView() วาดหน้าที่เปิดอยู่ใหม่ทุกครั้งที่มี
    // การเปลี่ยนแปลงผ่าน SSE)
    window.addEventListener(SETTINGS_CHANGED_EVENT, load);
    return () => window.removeEventListener(SETTINGS_CHANGED_EVENT, load);
  }, []);

  if (!settings) return null;

  const effectiveFlowAccountMode = settings.flowaccount?.mode ?? settings.env.flowAccountMode;
  const sameLlmModel = settings.env.localTextModel === settings.env.localVisionModel;

  return (
    <div className="g2">
      <Card title={tx('การเชื่อมต่อ')}>
        <dl className="kv">
          <dt>FlowAccount (.env)</dt>
          <dd>
            <Tag tone={settings.env.flowAccountMode === 'dry-run' ? 'wn' : 'ok'}>{settings.env.flowAccountMode}</Tag>
          </dd>

          <dt>{tx('FlowAccount (ใช้จริงตอนกดอนุมัติ)')}</dt>
          <dd>
            <Tag tone={effectiveFlowAccountMode === 'dry-run' ? 'wn' : 'ok'}>{effectiveFlowAccountMode}</Tag>
            {settings.flowaccount?.mode && settings.flowaccount.mode !== settings.env.flowAccountMode && (
              <small style={{ display: 'block', color: 'var(--cr)' }}>{tx('ไม่ตรงกับค่าใน .env ด้านบน — ค่านี้ในฐานข้อมูลเป็นตัวที่ใช้จริง')}</small>
            )}
          </dd>

          <dt>Credential FlowAccount</dt>
          <dd>{settings.env.hasFlowAccountCredentials ? <Tag tone="ok">{tx('ตั้งค่าแล้ว')}</Tag> : <Tag tone="wn">{tx('ยังไม่ตั้ง')}</Tag>}</dd>

          <dt>{tx('ชนิดเอกสาร')}</dt>
          <dd>{settings.flowaccount?.documentType ?? '—'}</dd>

          <dt>Gmail</dt>
          <dd>{settings.env.hasGmail ? <Tag tone="ok">{tx('เชื่อมต่อแล้ว')}</Tag> : <Tag tone="wn">{tx('ยังไม่เชื่อม')}</Tag>}</dd>

          <dt>LINE</dt>
          <dd>
            {settings.env.hasLine ? (
              <>
                <Tag tone="ok">{tx('เชื่อมต่อแล้ว')}</Tag> <small>{tx('ผู้รับแจ้งเตือน')} {settings.env.lineRecipientCount} {tx('ราย')}</small>
              </>
            ) : (
              <Tag tone="wn">{tx('ยังไม่เชื่อม')}</Tag>
            )}
          </dd>

          <dt>{tx('ลิงก์ในข้อความ LINE')}</dt>
          <dd>
            {settings.env.appBaseUrl ? (
              <span className="n">{settings.env.appBaseUrl}</span>
            ) : (
              <>
                <Tag tone="wn">{tx('ยังไม่ตั้ง')}</Tag>
                <small style={{ display: 'block' }}>{tx('ข้อความแจ้งเตือนจะไม่มีปุ่มกดเข้าระบบ')}</small>
              </>
            )}
          </dd>

          <dt>{tx('ระบบในเครื่อง')}</dt>
          <dd className="n">{settings.env.localLlmBaseUrl}</dd>

          {sameLlmModel ? (
            <>
              <dt>{tx('โมเดล')}</dt>
              <dd className="n">{settings.env.localTextModel}</dd>
            </>
          ) : (
            <>
              <dt>{tx('โมเดล (ข้อความ)')}</dt>
              <dd className="n">{settings.env.localTextModel}</dd>
              <dt>{tx('โมเดล (อ่านไฟล์)')}</dt>
              <dd className="n">{settings.env.localVisionModel}</dd>
            </>
          )}
        </dl>
      </Card>

      <Card title={tx('เงื่อนไขวางบิล')}>
        <dl className="kv">
          <dt>{tx('วันที่ลงเอกสาร')}</dt>
          <dd>{tx('วันที่')} {settings.billingRules?.billOnDayOfNextMonth ?? 2} {tx('ของเดือนถัดไป')}</dd>

          <dt>{tx('ต้องได้ครบทุกคน')}</dt>
          <dd>{settings.billingRules?.requireAllTimesheets ? tx('ใช่') : tx('ไม่')}</dd>

          <dt>{tx('ต้องมีคนกดยืนยัน')}</dt>
          <dd>
            <Tag tone={settings.billingRules?.requireHumanCheck === false ? 'mu' : 'ok'}>
              {settings.billingRules?.requireHumanCheck === false ? tx('ไม่ (โหมด auto)') : tx('ใช่ (โหมด manual)')}
            </Tag>
          </dd>

          <dt>{tx('ส่งอีเมลอัตโนมัติ')}</dt>
          <dd>
            <Tag tone="ok">{tx('สร้างร่างเท่านั้น')}</Tag>
          </dd>

          <dt>{tx('ไฟล์แนบในร่างอีเมล')}</dt>
          <dd>
            {tx('ใบวางบิล + Timesheet ทุกคนในรอบ')}
            <small style={{ display: 'block' }}>{tx('ใบวางบิลดึงจาก FlowAccount มาเก็บให้เองตอนกดอนุมัติ')}</small>
          </dd>

          <dt>{tx('ปิดรอบเมื่อส่งเมล')}</dt>
          <dd>
            <Tag tone="ok">{tx('อัตโนมัติ')}</Tag>
            <small style={{ display: 'block' }}>{tx('ระบบดูจากกล่อง Gmail เองว่าร่างถูกกดส่งแล้วหรือยัง')}</small>
          </dd>
        </dl>
      </Card>
    </div>
  );
}
