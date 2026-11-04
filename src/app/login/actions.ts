'use server';

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

export type LoginState = {
  error: string | null;
};

function safeNextPath(value: FormDataEntryValue | null) {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) {
    return '/teams';
  }
  return value;
}

export async function loginAction(_previousState: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get('email') ?? '').trim();
  const password = String(formData.get('password') ?? '');
  const nextPath = safeNextPath(formData.get('next'));

  if (!email || !password) {
    return { error: '이메일과 비밀번호를 입력해 주세요.' };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error || !data.user) {
    return { error: '이메일 또는 비밀번호를 확인해 주세요.' };
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('role, is_active, must_change_password')
    .eq('id', data.user.id)
    .maybeSingle();

  if (
    profileError ||
    !profile?.is_active ||
    !['owner', 'admin'].includes(profile.role)
  ) {
    await supabase.auth.signOut();
    return { error: '활성화된 관리자 계정만 로그인할 수 있습니다.' };
  }

  redirect(profile.must_change_password ? '/auth/set-password' : nextPath);
}
