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
import { createContext, useCallback, useContext, useRef, useState } from 'react';
import { Icon } from './Icon';
import { useLang } from '../lib/language';

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
                <Icon name="file" className="sm" /> {modal.filename ?? tx('เอกสาร PDF')}
              </span>
              <div className="pdf-actions">
                <button
                  className="btn sm icon"
                  onClick={() => {
                    navigator.clipboard?.writeText(modal.url).then(
                      () => toast(tx('คัดลอกลิงก์แล้ว')),
                      () => toast(tx('คัดลอกลิงก์ไม่สำเร็จ'), true),
                    );
                  }}
                  title={tx('แชร์ลิงก์')}
                  aria-label={tx('แชร์')}
                >
                  <Icon name="send" />
                </button>
                <a
                  className="btn sm icon"
                  href={`${modal.url}${modal.url.includes('?') ? '&' : '?'}dl`}
                  download={modal.filename ?? 'document.pdf'}
                  title={tx('ดาวน์โหลดไฟล์นี้')}
                  aria-label={tx('ดาวน์โหลด')}
                >
                  <Icon name="cd" />
                </a>
                <button className="btn sm icon" onClick={closePdf} title={tx('ปิด')} aria-label={tx('ปิด')}>
                  <Icon name="x" />
                </button>
              </div>
            </div>
            <iframe className="pdf-frame" src={modal.url} title={modal.filename ?? tx('เอกสาร PDF')} />
          </div>
        </div>
      )}
    </OverlayContext.Provider>
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
