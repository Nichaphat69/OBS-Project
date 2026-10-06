'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { Icon } from '../../components/Icon';
import { LangSwitch } from '../../components/LangSwitch';
import { useLang } from '../../lib/language';

type Step = 1 | 2 | 3 | 'done';

/** ported from public/app.js's showForgotScreen()/#forgotStep1-3 — ลืมรหัสผ่านสามขั้นตอน (ขอรหัส →
 * ยืนยันรหัส → ตั้งรหัสผ่านใหม่) ต้นฉบับสลับการ์ดด้วย hidden ในหน้าเดียว สแต็กใหม่ทำเป็นหน้า
 * /forgot-password หน้าเดียวเก็บ step เป็น local state แทน (email/resetToken ต้องจำข้ามขั้นไว้เอง
 * เพราะฟอร์มขั้น 2/3 ไม่มีช่องกรอกอีเมลซ้ำ — ตรงกับต้นฉบับ) */
export default function ForgotPasswordPage() {
  const { tx } = useLang();
  const [step, setStep] = useState<Step>(1);
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [resetToken, setResetToken] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submitStep1(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const trimmed = email.trim();
      setEmail(trimmed);
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: trimmed }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error ?? 'ส่งคำขอไม่สำเร็จ');
        return;
      }
      setStep(2);
    } catch {
      setError('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้');
    } finally {
      setLoading(false);
    }
  }

  async function submitStep2(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch('/api/auth/verify-reset-code', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, code: code.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error ?? 'ยืนยันรหัสไม่สำเร็จ');
        return;
      }
      setResetToken(data.resetToken);
      setStep(3);
    } catch {
      setError('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้');
    } finally {
      setLoading(false);
    }
  }

  async function submitStep3(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, resetToken, newPassword }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error ?? 'ตั้งรหัสผ่านใหม่ไม่สำเร็จ');
        return;
      }
      setStep('done');
    } catch {
      setError('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้');
    } finally {
      setLoading(false);
    }
  }

  if (step === 'done') {
    return (
      <main className="login-wrap">
        <LangSwitch />
        <div className="login-card">
          <h1>{tx('ตั้งรหัสผ่านใหม่สำเร็จ')}</h1>
          <p>{tx('เข้าสู่ระบบด้วยรหัสผ่านใหม่ได้เลย')}</p>
          <Link href="/login" className="btn pri" style={{ justifyContent: 'center', marginTop: 20 }}>
            {tx('ไปเข้าสู่ระบบ')}
          </Link>
        </div>
      </main>
    );
  }

  if (step === 1) {
    return (
      <main className="login-wrap">
        <LangSwitch />
        <form onSubmit={submitStep1} className="login-card">
          <h1>{tx('ลืมรหัสผ่าน')}</h1>
          <p>{tx('กรอกอีเมลที่ใช้เข้าสู่ระบบ จะส่งรหัสยืนยัน 6 หลักไปให้ทางอีเมล')}</p>
          <label>
            {tx('อีเมล')}
            <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" autoComplete="email" autoFocus required />
          </label>
          {error && <p className="err">{tx(error)}</p>}
          <button type="submit" disabled={loading} className="btn pri">
            {loading ? tx('กำลังส่ง…') : tx('ส่งรหัสยืนยัน')}
          </button>
          <p className="lc-sw">
            <Link href="/login" className="lc-link">
              {tx('กลับไปเข้าสู่ระบบ')}
            </Link>
          </p>
        </form>
      </main>
    );
  }

  if (step === 2) {
    return (
      <main className="login-wrap">
        <LangSwitch />
        <form onSubmit={submitStep2} className="login-card">
          <h1>{tx('กรอกรหัสยืนยัน')}</h1>
          <p>{tx('ส่งรหัสยืนยัน 6 หลักไปที่')} {email} {tx('แล้ว — รหัสใช้ได้ภายใน 10 นาที')}</p>
          <label>
            {tx('รหัสยืนยัน 6 หลัก')}
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={6}
              autoComplete="one-time-code"
              autoFocus
              required
            />
          </label>
          {error && <p className="err">{tx(error)}</p>}
          <button type="submit" disabled={loading} className="btn pri">
            {loading ? tx('กำลังยืนยัน…') : tx('ยืนยันรหัส')}
          </button>
          <p className="lc-sw">
            <Link href="/login" className="lc-link">
              {tx('กลับไปเข้าสู่ระบบ')}
            </Link>
          </p>
        </form>
      </main>
    );
  }

  return (
    <main className="login-wrap">
        <LangSwitch />
      <form onSubmit={submitStep3} className="login-card">
        <h1>{tx('ตั้งรหัสผ่านใหม่')}</h1>
        <label>
          {tx('รหัสผ่านใหม่')}
          <div style={{ position: 'relative' }}>
            <input
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              type={showPassword ? 'text' : 'password'}
              autoComplete="new-password"
              minLength={8}
              autoFocus
              required
              style={{ paddingRight: 42 }}
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              aria-label={tx(showPassword ? 'ซ่อนรหัสผ่าน' : 'แสดงรหัสผ่าน')}
              style={{
                position: 'absolute',
                right: 10,
                top: '50%',
                transform: 'translateY(-50%)',
                border: 'none',
                background: 'none',
                color: 'var(--mut)',
                cursor: 'pointer',
                display: 'flex',
              }}
            >
              <Icon name={showPassword ? 'eye-off' : 'eye'} className="sm" />
            </button>
          </div>
        </label>
        {error && <p className="err">{tx(error)}</p>}
        <button type="submit" disabled={loading} className="btn pri">
          {loading ? tx('กำลังบันทึก…') : tx('ตั้งรหัสผ่านใหม่')}
        </button>
      </form>
    </main>
  );
}
