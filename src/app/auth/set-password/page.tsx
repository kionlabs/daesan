'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

export default function SetPasswordPage() {
  const router = useRouter();
  const [supabase] = useState(() => createClient());
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    const establishRecoverySession = async () => {
      const url = new URL(window.location.href);
      const code = url.searchParams.get('code');
      const hash = new URLSearchParams(url.hash.slice(1));
      const accessToken = hash.get('access_token');
      const refreshToken = hash.get('refresh_token');

      let sessionError: Error | null = null;
      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        sessionError = error;
      } else if (accessToken && refreshToken) {
        const { error } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        });
        sessionError = error;
      }

      if (code || accessToken) {
        window.history.replaceState({}, document.title, '/auth/set-password');
      }

      const { data: { user }, error: userError } = await supabase.auth.getUser();
      if (!active) return;
      if (sessionError || userError || !user) {
        setError('비밀번호 변경 링크가 만료되었거나 올바르지 않습니다. 새 복구 메일을 요청해 주세요.');
        setCheckingSession(false);
        return;
      }
      setCheckingSession(false);
    };

    void establishRecoverySession();
    return () => { active = false; };
  }, [supabase]);

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (password.length < 8 || !/[A-Za-z]/.test(password) || !/\d/.test(password) || !/[^A-Za-z0-9]/.test(password)) {
      setError('비밀번호는 영문, 숫자, 특수문자를 포함해 8자 이상으로 설정해 주세요.');
      return;
    }
    if (password !== confirmPassword) { setError('비밀번호가 일치하지 않습니다.'); return; }
    setLoading(true); setError(null);
    const { error: updateError } = await supabase.auth.updateUser({ password });
    if (updateError) { setError('비밀번호를 변경하지 못했습니다. 다시 로그인한 뒤 시도해 주세요.'); setLoading(false); return; }
    router.replace('/teams'); router.refresh();
  };

  if (checkingSession) return <div className="flex min-h-screen items-center justify-center text-sm text-gray-500">로그인 상태를 확인하고 있습니다...</div>;

  return <div className="flex min-h-screen items-center justify-center px-4 py-12"><div className="w-full max-w-md border border-gray-200 bg-white p-7 shadow-sm">
    <h1 className="text-xl font-bold text-gray-950">최초 비밀번호 변경</h1><p className="mt-2 text-sm text-gray-500">관리자가 전달한 임시 비밀번호 대신 본인만 아는 새 비밀번호를 설정해 주세요. 변경 전에는 ERP 기능을 사용할 수 없습니다.</p>
    <form onSubmit={save} className="mt-6 space-y-4">
      <label className="block"><span className="mb-1.5 block text-sm font-bold">새 비밀번호</span><input type="password" autoComplete="new-password" required minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} className="h-11 w-full border border-gray-300 px-3 outline-none focus:border-emerald-700" /><span className="mt-1 block text-xs text-gray-500">영문, 숫자, 특수문자를 포함해 8자 이상</span></label>
      <label className="block"><span className="mb-1.5 block text-sm font-bold">비밀번호 확인</span><input type="password" autoComplete="new-password" required minLength={8} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} className="h-11 w-full border border-gray-300 px-3 outline-none focus:border-emerald-700" /></label>
      {error && <p className="border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <button disabled={loading} className="h-11 w-full bg-emerald-800 font-bold text-white disabled:opacity-60">{loading ? '변경 중...' : '비밀번호 변경'}</button>
    </form>
  </div></div>;
}
