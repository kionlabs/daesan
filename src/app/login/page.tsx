'use client';

import { Suspense, useActionState } from 'react';
import { useSearchParams } from 'next/navigation';
import { loginAction, type LoginState } from './actions';

const initialState: LoginState = { error: null };

function LoginForm() {
  const searchParams = useSearchParams();
  const requestedNext = searchParams.get('next');
  const next = requestedNext?.startsWith('/') && !requestedNext.startsWith('//') ? requestedNext : '/teams';
  const [state, formAction, pending] = useActionState(loginAction, initialState);

  return <div className="flex min-h-screen items-center justify-center px-4 py-12">
    <div className="w-full max-w-md border border-gray-200 bg-white p-7 shadow-sm">
      <div className="flex items-center gap-3 border-b border-gray-200 pb-5">
        <div className="flex h-12 w-12 items-center justify-center bg-white"><img src="/logo.png" alt="대산유통" className="max-h-full object-contain" /></div>
        <div><h1 className="text-xl font-bold text-gray-950">대산유통 ERP</h1><p className="text-sm text-gray-500">관리자 로그인</p></div>
      </div>
      <form action={formAction} className="mt-6 space-y-4">
        <input type="hidden" name="next" value={next} />
        <label className="block"><span className="mb-1.5 block text-sm font-bold text-gray-700">이메일</span><input name="email" type="email" autoComplete="email" required className="h-11 w-full border border-gray-300 px-3 outline-none focus:border-emerald-700" /></label>
        <label className="block"><span className="mb-1.5 block text-sm font-bold text-gray-700">비밀번호</span><input name="password" type="password" autoComplete="current-password" required className="h-11 w-full border border-gray-300 px-3 outline-none focus:border-emerald-700" /></label>
        {state.error && <p className="border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>}
        <button type="submit" disabled={pending} className="h-11 w-full cursor-pointer bg-emerald-800 font-bold text-white hover:bg-emerald-900 disabled:cursor-not-allowed disabled:opacity-60">{pending ? '로그인 중...' : '로그인'}</button>
      </form>
      <p className="mt-5 text-center text-xs text-gray-500">초대받은 관리자 계정만 로그인할 수 있습니다.</p>
    </div>
  </div>;
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center text-sm text-gray-500">로그인 화면을 불러오는 중...</div>}>
      <LoginForm />
    </Suspense>
  );
}
