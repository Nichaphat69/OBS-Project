'use client';

import { Suspense, useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Icon } from '../../components/Icon';
import GoogleButton from '../../components/GoogleButton';
import { AnimatedLogo } from '../../components/AnimatedLogo';

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  /* Google callback พากลับมาที่ "/login" พร้อม query param บอกผล — ?googlePending=1 = ลงทะเบียน/
   * ผูกบัญชีผ่าน Google สำเร็จแต่ยังรอ admin เปิดใช้งาน, ?loginError=... = ฝั่ง Google/callback มี
   * ปัญหา — ต้องล้าง query ออกจาก URL ทันทีด้วย ไม่งั้นกด refresh แล้วจะเห็นข้อความเดิมซ้ำอีกรอบ */
  useEffect(() => {
    const pending = searchParams.get('googlePending');
    const loginError = searchParams.get('loginError');
    if (pending) setInfo('ลงทะเบียนผ่าน Google สำเร็จ — รอผู้ดูแลระบบตรวจสอบและเปิดใช้งานบัญชีก่อน จึงจะเข้าสู่ระบบได้');
    if (loginError) setError(loginError);
    if (pending || loginError) window.history.replaceState(null, '', '/login');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username, password, remember }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error ?? 'เข้าสู่ระบบไม่สำเร็จ');
        return;
      }
      router.push('/');
      router.refresh();
    } catch {
      setError('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="login-wrap">
      <form onSubmit={onSubmit} className="login-card">
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 22 }}>
          <AnimatedLogo height={56} />
        </div>
        <h1 style={{ fontSize: 19 }}>
          เข้าสู่ระบบ <span style={{ color: 'var(--brand)' }}>Outsource Billing System</span>
        </h1>
        <p>ระบบวางบิล Outsource — ใช้ชื่อผู้ใช้/รหัสผ่านที่แอดมินสร้างให้</p>

        {info && <p className="lc-info">{info}</p>}

        <label>
          Username
          <input value={username} onChange={(e) => setUsername(e.target.value)} type="text" autoFocus required />
        </label>

        <label>
          รหัสผ่าน
          <div style={{ position: 'relative' }}>
            <input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              type={showPassword ? 'text' : 'password'}
              required
              style={{ paddingRight: 42 }}
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              aria-label={showPassword ? 'ซ่อนรหัสผ่าน' : 'แสดงรหัสผ่าน'}
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

        <div className="lc-row">
          <label className="remember" style={{ cursor: 'pointer' }}>
            <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
            จดจำฉัน (30 วัน)
          </label>
          <Link href="/forgot-password" className="lc-link">
            ลืมรหัสผ่าน?
          </Link>
        </div>

        {error && <p className="err">{error}</p>}

        <button type="submit" disabled={loading} className="btn pri">
          {loading ? 'กำลังเข้าสู่ระบบ…' : 'เข้าสู่ระบบ'}
        </button>

        <GoogleButton label="เข้าสู่ระบบด้วย Google" />

        <p className="lc-sw">
          ยังไม่มีบัญชี?
          <Link href="/register" className="lc-link">
            ลงทะเบียน
          </Link>
        </p>
      </form>
    </main>
  );
}
