'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const login = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoading(true); setError(null);
    const supabase = createClient();
    const { error: signInError } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (signInError) { setError('이메일 또는 비밀번호를 확인해 주세요.'); setLoading(false); return; }
    const requestedNext = new URLSearchParams(window.location.search).get('next');
    const next = requestedNext?.startsWith('/') && !requestedNext.startsWith('//') ? requestedNext : '/teams';
    router.replace(next);
    router.refresh();
  };

  return <div className="flex min-h-screen items-center justify-center px-4 py-12">
    <div className="w-full max-w-md border border-gray-200 bg-white p-7 shadow-sm">
      <div className="flex items-center gap-3 border-b border-gray-200 pb-5">
        <div className="flex h-12 w-12 items-center justify-center bg-white"><img src="/logo.png" alt="대산유통" className="max-h-full object-contain" /></div>
        <div><h1 className="text-xl font-bold text-gray-950">대산유통 ERP</h1><p className="text-sm text-gray-500">관리자 로그인</p></div>
      </div>
      <form onSubmit={login} className="mt-6 space-y-4">
        <label className="block"><span className="mb-1.5 block text-sm font-bold text-gray-700">이메일</span><input type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} className="h-11 w-full border border-gray-300 px-3 outline-none focus:border-emerald-700" /></label>
        <label className="block"><span className="mb-1.5 block text-sm font-bold text-gray-700">비밀번호</span><input type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} className="h-11 w-full border border-gray-300 px-3 outline-none focus:border-emerald-700" /></label>
        {error && <p className="border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <button disabled={loading} className="h-11 w-full bg-emerald-800 font-bold text-white disabled:opacity-60">{loading ? '로그인 중...' : '로그인'}</button>
      </form>
      <p className="mt-5 text-center text-xs text-gray-500">초대받은 관리자 계정만 로그인할 수 있습니다.</p>
    </div>
  </div>;
}
