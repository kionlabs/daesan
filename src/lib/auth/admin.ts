import { createClient } from '@/lib/supabase/server';

export type AdminSession = {
  userId: string;
  email: string;
  displayName: string;
  role: 'owner' | 'admin';
};

export async function getAdminSession(): Promise<AdminSession | null> {
  const supabase = await createClient();
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user?.email) return null;

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('display_name, role, is_active')
    .eq('id', user.id)
    .maybeSingle();
  if (profileError || !profile?.is_active || !['owner', 'admin'].includes(profile.role)) return null;

  return { userId: user.id, email: user.email, displayName: profile.display_name, role: profile.role as 'owner' | 'admin' };
}
