'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { Icon } from '../../components/Icon';
import { LangSwitch } from '../../components/LangSwitch';
import { useLang } from '../../lib/language';
import GoogleButton from '../../components/GoogleButton';

/** ported from public/app.js's showRegisterScreen()/#registerForm — ลงทะเบียนบัญชีใหม่เอง บัญชีที่
 * ได้ต้องรอ admin/accounting เปิดใช้งานก่อนถึง login ได้จริง (ต่างจากต้นฉบับที่เป็น hidden-div
 * overlay ทับหน้า login เดียวกัน สแต็กใหม่แยกเป็นหน้า /register จริงตามธรรมเนียม routing ของ
 * Next.js — พฤติกรรม/ข้อความ/ฟิลด์ตรงกับต้นฉบับทุกจุด) */
export default function RegisterPage() {
  const { tx } = useLang();
  const [nameTh, setNameTh] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), nameTh: nameTh.trim(), password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error ?? 'ลงทะเบียนไม่สำเร็จ');
        return;
      }
      setDone(true);
    } catch {
      setError('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้');
    } finally {
      setLoading(false);
    }
  }

  if (done) {
    return (
      <main className="login-wrap">
        <LangSwitch />
        <div className="login-card">
          <h1>{tx('ลงทะเบียนสำเร็จ')}</h1>
          <p>{tx('รอผู้ดูแลระบบตรวจสอบและเปิดใช้งานบัญชีก่อน จึงจะเข้าสู่ระบบได้')}</p>
          <Link href="/login" className="btn pri" style={{ justifyContent: 'center', marginTop: 20 }}>
            {tx('กลับไปเข้าสู่ระบบ')}
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="login-wrap">
      <LangSwitch />
      <form onSubmit={onSubmit} className="login-card">
        <h1>
          {tx('ลงทะเบียนใช้งาน')} <span style={{ color: 'var(--brand)' }}>OBS</span>
        </h1>
        <p>{tx('ลงทะเบียนแล้วต้องรอผู้ดูแลระบบตรวจสอบและเปิดใช้งานก่อน จึงจะเข้าสู่ระบบได้')}</p>

        <label>
          {tx('ชื่อ-นามสกุล')}
          <input value={nameTh} onChange={(e) => setNameTh(e.target.value)} type="text" autoFocus required />
        </label>

        <label>
          {tx('อีเมล')}
          <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" autoComplete="email" required />
        </label>

        <label>
          {tx('รหัสผ่าน')}
          <div style={{ position: 'relative' }}>
            <input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              type={showPassword ? 'text' : 'password'}
              autoComplete="new-password"
              minLength={8}
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
          {loading ? tx('กำลังลงทะเบียน…') : tx('ลงทะเบียน')}
        </button>

        <GoogleButton label={tx('ลงทะเบียนด้วย Google')} />

        <p className="lc-sw">
          {tx('มีบัญชีอยู่แล้ว?')}
          <Link href="/login" className="lc-link">
            {tx('เข้าสู่ระบบ')}
          </Link>
        </p>
      </form>
    </main>
  );
}
