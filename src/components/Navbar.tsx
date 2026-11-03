'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

const navGroups = [
  { label: '운영', items: [
    { name: '대시보드', href: '/', icon: '▦' }, { name: '직원 관리', href: '/staffs', icon: '人' },
    { name: '팀 관리', href: '/teams', icon: '組' },
    { name: '마트 관리', href: '/markets', icon: '店' }, { name: '행사 관리', href: '/events', icon: '旗' },
    { name: '통합 일정', href: '/schedules', icon: '日' },
  ] },
  { label: '재무', items: [
    { name: '매출 관리', href: '/revenues', icon: '₩' }, { name: '정산 관리', href: '/settlements', icon: '計' },
    { name: '금융 관리', href: '/finance', icon: '銀' },
  ] },
  { label: '협업', items: [
    { name: '사내 메신저', href: '/messenger', icon: '話' }, { name: 'AI 업무비서', href: '/assistant', icon: 'AI' },
    { name: '일정 공유판', href: '/schedules/share', icon: '共' },
  ] },
];

export default function Navbar() {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [adminName, setAdminName] = useState('관리자');
  const active = (href: string) => href === '/' ? pathname === '/' : pathname?.startsWith(href);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) return;
      const { data } = await supabase.from('profiles').select('display_name').eq('id', user.id).maybeSingle();
      if (data?.display_name) setAdminName(data.display_name);
    });
  }, []);

  const logout = async () => {
    await createClient().auth.signOut();
    router.push('/login');
    router.refresh();
  };

  return <>
    <header className="fixed inset-x-0 top-0 z-40 flex h-16 items-center justify-between border-b border-gray-200 bg-white px-4 lg:hidden">
      <Link href="/" className="flex items-center gap-2" onClick={() => setOpen(false)}>
        <img src="/logo.png" alt="대산유통" className="h-10 w-auto object-contain" /><span className="text-sm font-bold">통합 ERP</span>
      </Link>
      <button type="button" aria-label="메뉴 열기" onClick={() => setOpen(!open)} className="h-10 w-10 border border-gray-300 bg-white text-xl text-gray-700">{open ? '×' : '☰'}</button>
    </header>
    {open && <button aria-label="메뉴 닫기" className="fixed inset-0 z-40 bg-black/35 lg:hidden" onClick={() => setOpen(false)} />}
    <aside className={`fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r border-emerald-950 bg-[#103a26] text-white transition-transform lg:sticky lg:top-0 lg:h-screen lg:translate-x-0 ${open ? 'translate-x-0' : '-translate-x-full'}`}>
      <div className="flex h-20 items-center border-b border-white/10 px-5">
        <Link href="/" className="flex items-center gap-3" onClick={() => setOpen(false)}>
          <div className="flex h-11 w-11 items-center justify-center bg-white p-1"><img src="/logo.png" alt="대산유통" className="max-h-full object-contain" /></div>
          <div><strong className="block text-base">대산유통</strong><span className="text-xs text-emerald-100">통합 ERP MVP</span></div>
        </Link>
      </div>
      <nav className="flex-1 overflow-y-auto px-3 py-4">
        {navGroups.map((group) => <div key={group.label} className="mb-5">
          <p className="mb-2 px-3 text-[11px] font-bold uppercase text-emerald-200/70">{group.label}</p>
          <div className="space-y-1">{group.items.map((item) => <Link key={item.href} href={item.href} onClick={() => setOpen(false)} className={`flex min-h-10 items-center gap-3 px-3 py-2 text-sm transition-colors ${active(item.href) ? 'bg-white text-[#103a26]' : 'text-emerald-50 hover:bg-white/10'}`}>
            <span aria-hidden className="flex h-6 w-6 items-center justify-center border border-current/25 text-[11px] font-bold">{item.icon}</span><span className="font-medium">{item.name}</span>
          </Link>)}</div>
        </div>)}
      </nav>
      <div className="border-t border-white/10 p-4"><div className="flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center bg-emerald-800 text-xs font-bold">관리</div>
        <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{adminName}</p><p className="text-[11px] text-emerald-200">관리자 세션</p></div>
        <button type="button" onClick={logout} className="border border-white/20 px-2 py-1 text-[11px] text-emerald-50 hover:bg-white/10">로그아웃</button>
      </div></div>
    </aside>
  </>;
}
