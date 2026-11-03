'use client';

import { usePathname } from 'next/navigation';
import Navbar from '@/components/Navbar';

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const authScreen = pathname === '/login' || pathname?.startsWith('/auth/');
  if (authScreen) return <main className="min-h-screen bg-gray-100">{children}</main>;

  return <div className="min-h-screen lg:flex">
    <Navbar />
    <main className="min-w-0 flex-1 overflow-x-hidden px-4 pb-10 pt-20 sm:px-6 lg:px-8 lg:pt-7">
      <div className="mx-auto min-w-0 w-full max-w-[1500px]">{children}</div>
    </main>
  </div>;
}
