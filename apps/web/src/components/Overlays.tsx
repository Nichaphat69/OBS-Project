'use client';

/**
 * กล่องแจ้งเตือน/ยืนยัน/ขอข้อความ/ดู PDF แบบมีสไตล์ — ported from public/app.js's toast()/
 * confirmModal()/promptModal()/openPdfPreview() (ใช้แทน alert()/confirm()/prompt() ของเบราว์เซอร์
 * และแท็บ PDF ใหม่ ซึ่งหน้าตาเถื่อนไม่ตรงธีม และในบางเบราว์เซอร์/ส่วนขยาย native dialog ถูกบล็อกเงียบๆ
 * จนกดปุ่มแล้วดูเหมือนไม่มีอะไรเกิดขึ้นเลย)
 *
 * ใช้งานผ่าน hooks `useToast()`/`useConfirm()`/`usePrompt()`/`usePdfPreview()` ที่ไหนก็ได้ใต้
 * <OverlayProvider> (mount ไว้ที่ root layout แล้ว) — คืนค่าตรงกับต้นฉบับทุกจุด: `confirm()` คืน
 * Promise<boolean>, `prompt()` คืน Promise<string|null>.
 */
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Icon } from './Icon';
import { Loading } from './ui';
import { useLang } from '../lib/language';

/** นามสกุลที่ต้อง parse เป็นตารางแทนการฝัง iframe — ตรงกับชนิดไฟล์ที่หน้าอัปโหลดรับ
 * (`accept` ใน UploadFileTab.tsx — PDF/Excel/CSV/ภาพสแกน ภาพกับ PDF แสดงด้วย iframe ของเบราว์เซอร์) เดาจากชื่อไฟล์ก่อน ถ้าไม่มีชื่อไฟล์ค่อยเดาจาก URL */
function isSpreadsheetName(name: string | null): boolean {
  const n = (name ?? '').toLowerCase();
  return n.endsWith('.xlsx') || n.endsWith('.xls') || n.endsWith('.csv');
}

interface ConfirmOptions {
  iconName?: string;
  danger?: boolean;
  title: string;
  message: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
}

interface PromptOptions {
  title: string;
  message?: React.ReactNode;
  placeholder?: string;
  confirmLabel?: string;
  cancelLabel?: string;
}

interface OverlayContextValue {
  toast: (message: string, isError?: boolean) => void;
  confirm: (opts: ConfirmOptions) => Promise<boolean>;
  prompt: (opts: PromptOptions) => Promise<string | null>;
  openPdfPreview: (url: string, filename?: string | null) => void;
}

const OverlayContext = createContext<OverlayContextValue | null>(null);

type ModalState =
  | { kind: 'confirm'; opts: ConfirmOptions; resolve: (v: boolean) => void }
  | { kind: 'prompt'; opts: PromptOptions; resolve: (v: string | null) => void }
  | { kind: 'pdf'; url: string; filename: string | null }
  | null;

export function OverlayProvider({ children }: { children: React.ReactNode }) {
  const { tx } = useLang();
  const [toastState, setToastState] = useState<{ message: string; isError: boolean; visible: boolean }>({
    message: '',
    isError: false,
    visible: false,
  });
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [modal, setModal] = useState<ModalState>(null);
  const [promptValue, setPromptValue] = useState('');

  const toast = useCallback((message: string, isError = false) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToastState({ message, isError, visible: true });
    toastTimer.current = setTimeout(() => setToastState((s) => ({ ...s, visible: false })), isError ? 8000 : 6000);
  }, []);

  const confirm = useCallback((opts: ConfirmOptions) => {
    return new Promise<boolean>((resolve) => {
      setModal({ kind: 'confirm', opts, resolve });
    });
  }, []);

  const prompt = useCallback((opts: PromptOptions) => {
    setPromptValue('');
    return new Promise<string | null>((resolve) => {
      setModal({ kind: 'prompt', opts, resolve });
    });
  }, []);

  const openPdfPreview = useCallback((url: string, filename?: string | null) => {
    setModal({ kind: 'pdf', url, filename: filename ?? null });
  }, []);

  function closeConfirm(result: boolean) {
    if (modal?.kind === 'confirm') modal.resolve(result);
    setModal(null);
  }
  function closePrompt(result: string | null) {
    if (modal?.kind === 'prompt') modal.resolve(result);
    setModal(null);
  }
  function closePdf() {
    setModal(null);
  }

  // ปิดด้วย ESC ได้ทุกชนิด popup ในไฟล์นี้ — เดิมปิดได้แค่คลิกนอกกรอบ/กดปุ่ม ผู้ใช้คีย์บอร์ดสายเดียวไม่มีทางออก
  // confirm/prompt ปิดแบบ "ยกเลิก"/"ไม่ยืนยัน" เสมอ (ตรงกับพฤติกรรม native dialog) ไม่ใช่ปิดเฉยๆ
  useEffect(() => {
    if (!modal) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Escape') return;
      if (modal?.kind === 'confirm') closeConfirm(false);
      else if (modal?.kind === 'prompt') closePrompt(null);
      else closePdf();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modal]);

  return (
    <OverlayContext.Provider value={{ toast, confirm, prompt, openPdfPreview }}>
      {children}

      <div className={`tst${toastState.visible ? ' on' : ''}${toastState.isError ? ' err' : ''}`}>
        <span className="tst-ic">
          <Icon name={toastState.isError ? 'alt' : 'chk'} />
        </span>
        <span className="tst-msg">{toastState.message}</span>
      </div>

      {modal?.kind === 'confirm' && (
        <div
          className="modal-backdrop"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeConfirm(false);
          }}
        >
          <div className="modal-card">
            <div className="modal-banner" />
            <span className="modal-ic">
              <span className={`modal-ic-badge${modal.opts.danger === false ? ' brand' : ''}`}>
                <Icon name={modal.opts.iconName ?? 'trash-solid'} className={(modal.opts.iconName ?? 'trash-solid').endsWith('-solid') ? 'solid' : undefined} />
              </span>
            </span>
            <div className="modal-body">
              <h3>{modal.opts.title}</h3>
              <p>{modal.opts.message}</p>
            </div>
            <div className="modal-ft">
              <button className="btn" onClick={() => closeConfirm(false)}>
                {modal.opts.cancelLabel ?? tx('ยกเลิก')}
              </button>
              <button className={`btn ${modal.opts.danger === false ? 'pri' : 'dgr'}`} onClick={() => closeConfirm(true)}>
                {modal.opts.danger === false ? null : <Icon name="trash" className="sm" />} {modal.opts.confirmLabel ?? tx('ลบ')}
              </button>
            </div>
          </div>
        </div>
      )}

      {modal?.kind === 'prompt' && (
        <div
          className="modal-backdrop"
          onClick={(e) => {
            if (e.target === e.currentTarget) closePrompt(null);
          }}
        >
          <div className="modal-card">
            <div className="modal-banner" />
            <span className="modal-ic">
              <span className="modal-ic-badge brand">
                <Icon name="doc" />
              </span>
            </span>
            <div className="modal-body">
              <h3>{modal.opts.title}</h3>
              {modal.opts.message && <p>{modal.opts.message}</p>}
              <textarea
                className="modal-prompt-input"
                rows={3}
                placeholder={modal.opts.placeholder}
                value={promptValue}
                autoFocus
                onChange={(e) => setPromptValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) closePrompt(promptValue.trim() || null);
                }}
              />
            </div>
            <div className="modal-ft">
              <button className="btn" onClick={() => closePrompt(null)}>
                {modal.opts.cancelLabel ?? tx('ยกเลิก')}
              </button>
              <button className="btn pri" onClick={() => closePrompt(promptValue.trim() || null)}>
                {modal.opts.confirmLabel ?? tx('ตกลง')}
              </button>
            </div>
          </div>
        </div>
      )}

      {modal?.kind === 'pdf' && (
        <div
          className="modal-backdrop pdf"
          onClick={(e) => {
            if (e.target === e.currentTarget) closePdf();
          }}
        >
          <div className="modal-card pdf-card">
            <div className="pdf-hd">
              <span className="pdf-title">
                <Icon name={isSpreadsheetName(modal.filename) ? 'invoice' : 'file'} className="sm" /> {modal.filename ?? tx('เอกสาร PDF')}
              </span>
              <div className="pdf-actions">
                <a
                  className="btn sm icon"
                  href={`${modal.url}${modal.url.includes('?') ? '&' : '?'}dl`}
                  download={modal.filename ?? 'document.pdf'}
                  title={tx('ดาวน์โหลดไฟล์นี้')}
                  aria-label={tx('ดาวน์โหลด')}
                >
                  <Icon name="download" />
                </a>
                <button className="btn sm icon" onClick={closePdf} title={tx('ปิด')} aria-label={tx('ปิด')}>
                  <Icon name="x" />
                </button>
              </div>
            </div>
            {isSpreadsheetName(modal.filename) ? (
              <SpreadsheetPreview url={modal.url} />
            ) : (
              <iframe className="pdf-frame" src={modal.url} title={modal.filename ?? tx('เอกสาร PDF')} />
            )}
          </div>
        </div>
      )}
    </OverlayContext.Provider>
  );
}

/**
 * โชว์ไฟล์ Excel/CSV เป็นตาราง HTML จริงๆ แทนที่จะฝัง iframe (เบราว์เซอร์เปิด xlsx เองไม่ได้ ต่างจาก
 * PDF) — parse ฝั่ง client ด้วย `xlsx` (SheetJS) โหลดแบบ dynamic import เพราะไลบรารีมีขนาดไม่เล็ก
 * ไม่ควรรวมเข้า bundle หลักทั้งที่ผู้ใช้ส่วนใหญ่เปิดแต่ PDF
 *
 * ดาวน์โหลดไฟล์ต้นฉบับ (ปุ่มบนแถบหัว) ยังใช้ URL `?dl` เดิม ได้ไฟล์ .xlsx ตัวจริงกลับไปเสมอ — ตารางที่
 * เห็นในนี้เป็นแค่ตัวอย่างสำหรับดู ไม่ใช่ตัวไฟล์ที่จะถูกดาวน์โหลด
 */
function SpreadsheetPreview({ url }: { url: string }) {
  const { tx } = useLang();
  const [state, setState] = useState<
    | { status: 'loading' }
    | { status: 'error'; message: string }
    | { status: 'ready'; sheetNames: string[]; rowsBySheet: Record<string, string[][]> }
  >({ status: 'loading' });
  const [activeSheet, setActiveSheet] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });
    setActiveSheet(null);
    (async () => {
      try {
        const [XLSX, res] = await Promise.all([import('xlsx'), fetch(url)]);
        if (!res.ok) throw new Error(String(res.status));
        const buf = await res.arrayBuffer();
        const wb = XLSX.read(buf, { type: 'array' });
        if (cancelled) return;
        const rowsBySheet: Record<string, string[][]> = {};
        for (const name of wb.SheetNames) {
          // header:1 = อาเรย์ของอาเรย์ตามแถว/คอลัมน์จริงในไฟล์ ไม่เดาว่าแถวไหนคือหัวตาราง เพราะไฟล์
          // Timesheet จริงมักมีหัวกระดาษ/โลโก้อยู่เหนือหัวตารางจริงหลายแถว
          rowsBySheet[name] = XLSX.utils.sheet_to_json<string[]>(wb.Sheets[name], { header: 1, raw: false, defval: '' });
        }
        setState({ status: 'ready', sheetNames: wb.SheetNames, rowsBySheet });
        setActiveSheet(wb.SheetNames[0] ?? null);
      } catch {
        if (!cancelled) setState({ status: 'error', message: tx('เปิดไฟล์นี้ไม่สำเร็จ — ลองดาวน์โหลดไปเปิดแทน') });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [url, tx]);

  if (state.status === 'loading') {
    return (
      <div className="xlsx-state" style={{ placeItems: 'stretch', alignContent: 'start', padding: 16 }}>
        <Loading rows={8} label={tx('กำลังโหลดไฟล์…')} />
      </div>
    );
  }
  if (state.status === 'error') {
    return <div className="xlsx-state err">{state.message}</div>;
  }

  const rows = activeSheet ? state.rowsBySheet[activeSheet] ?? [] : [];
  // จำนวนคอลัมน์ไม่เท่ากันทุกแถวได้ (แถวท้ายๆ อาจสั้นกว่า) — ใช้แถวที่กว้างที่สุดตัดสินจำนวนคอลัมน์ตาราง
  const colCount = rows.reduce((max, r) => Math.max(max, r.length), 0);

  return (
    <div className="xlsx-preview">
      {state.sheetNames.length > 1 && (
        <div className="xlsx-tabs">
          {state.sheetNames.map((name) => (
            <button
              key={name}
              type="button"
              className={`xlsx-tab${name === activeSheet ? ' on' : ''}`}
              onClick={() => setActiveSheet(name)}
            >
              {name}
            </button>
          ))}
        </div>
      )}
      <div className="xlsx-scroll">
        {rows.length === 0 ? (
          <div className="xlsx-state">{tx('ชีตนี้ไม่มีข้อมูล')}</div>
        ) : (
          <table className="xlsx-table">
            <tbody>
              {rows.map((r, ri) => (
                <tr key={ri}>
                  {Array.from({ length: colCount }, (_, ci) => (
                    <td key={ci}>{r[ci] ?? ''}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function useOverlays(): OverlayContextValue {
  const ctx = useContext(OverlayContext);
  if (!ctx) throw new Error('useOverlays must be used within <OverlayProvider>');
  return ctx;
}

export function useToast() {
  return useOverlays().toast;
}
export function useConfirm() {
  return useOverlays().confirm;
}
export function usePrompt() {
  return useOverlays().prompt;
}
export function usePdfPreview() {
  return useOverlays().openPdfPreview;
}
