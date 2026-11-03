import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      db: { schema: 'daesan' },
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    },
  );
  const { data } = await supabase.auth.getClaims();
  const pathname = request.nextUrl.pathname;
  const publicPath = pathname === '/login' || pathname.startsWith('/auth/');
  const apiPath = pathname.startsWith('/api/');

  if (!data?.claims && !publicPath && !apiPath) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = '/login';
    loginUrl.search = '';
    loginUrl.searchParams.set('next', `${pathname}${request.nextUrl.search}`);
    return NextResponse.redirect(loginUrl);
  }
  if (data?.claims && !apiPath) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('must_change_password')
      .eq('id', data.claims.sub)
      .maybeSingle();
    const mustChangePassword = profile?.must_change_password === true;

    if (mustChangePassword && pathname !== '/auth/set-password') {
      return NextResponse.redirect(new URL('/auth/set-password', request.url));
    }
    if (!mustChangePassword && pathname === '/auth/set-password') {
      return NextResponse.redirect(new URL('/teams', request.url));
    }
    if (pathname === '/login') {
      return NextResponse.redirect(new URL(mustChangePassword ? '/auth/set-password' : '/', request.url));
    }
  }
  return response;
}
