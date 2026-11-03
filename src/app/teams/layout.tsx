import { redirect } from 'next/navigation';
import { getAdminSession } from '@/lib/auth/admin';

export default async function TeamsLayout({ children }: { children: React.ReactNode }) {
  const admin = await getAdminSession();
  if (!admin) redirect('/login?next=/teams');
  if (admin.mustChangePassword) redirect('/auth/set-password');
  return children;
}
