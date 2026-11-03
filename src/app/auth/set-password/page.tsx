'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

export default function SetPasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (password.length < 8) { setError('비밀번호는 8자 이상이어야 합니다.'); return; }
    if (password !== confirmPassword) { setError('비밀번호가 일치하지 않습니다.'); return; }
    setLoading(true); setError(null);
    const { error: updateError } = await createClient().auth.updateUser({ password });
    if (updateError) { setError('비밀번호를 설정하지 못했습니다. 초대 링크를 다시 확인해 주세요.'); setLoading(false); return; }
    router.replace('/teams'); router.refresh();
  };

  return <div className="flex min-h-screen items-center justify-center px-4 py-12"><div className="w-full max-w-md border border-gray-200 bg-white p-7 shadow-sm">
    <h1 className="text-xl font-bold text-gray-950">최초 비밀번호 설정</h1><p className="mt-2 text-sm text-gray-500">관리자 초대를 완료하려면 사용할 비밀번호를 설정해 주세요.</p>
    <form onSubmit={save} className="mt-6 space-y-4">
      <label className="block"><span className="mb-1.5 block text-sm font-bold">새 비밀번호</span><input type="password" autoComplete="new-password" required minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} className="h-11 w-full border border-gray-300 px-3 outline-none focus:border-emerald-700" /></label>
      <label className="block"><span className="mb-1.5 block text-sm font-bold">비밀번호 확인</span><input type="password" autoComplete="new-password" required minLength={8} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} className="h-11 w-full border border-gray-300 px-3 outline-none focus:border-emerald-700" /></label>
      {error && <p className="border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <button disabled={loading} className="h-11 w-full bg-emerald-800 font-bold text-white disabled:opacity-60">{loading ? '저장 중...' : '비밀번호 설정'}</button>
    </form>
  </div></div>;
}
