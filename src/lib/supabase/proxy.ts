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
        setAll(cookiesToSet, headers) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
          Object.entries(headers).forEach(([key, value]) => response.headers.set(key, value));
        },
      },
    },
  );

  const redirectWithSession = (url: URL) => {
    const redirectResponse = NextResponse.redirect(url);
    response.cookies.getAll().forEach((cookie) => redirectResponse.cookies.set(cookie));
    response.headers.forEach((value, key) => {
      if (key.toLowerCase() !== 'set-cookie') redirectResponse.headers.set(key, value);
    });
    return redirectResponse;
  };

  const { data } = await supabase.auth.getClaims();
  const pathname = request.nextUrl.pathname;
  const publicPath = pathname === '/login' || pathname.startsWith('/auth/');
  const apiPath = pathname.startsWith('/api/');

  if (!data?.claims && !publicPath && !apiPath) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = '/login';
    loginUrl.search = '';
    loginUrl.searchParams.set('next', `${pathname}${request.nextUrl.search}`);
    return redirectWithSession(loginUrl);
  }
  if (data?.claims && !apiPath) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('must_change_password')
      .eq('id', data.claims.sub)
      .maybeSingle();
    const mustChangePassword = profile?.must_change_password === true;

    if (mustChangePassword && pathname !== '/auth/set-password') {
      return redirectWithSession(new URL('/auth/set-password', request.url));
    }
    if (!mustChangePassword && pathname === '/auth/set-password') {
      return redirectWithSession(new URL('/teams', request.url));
    }
    if (pathname === '/login') {
      const requestedNext = request.nextUrl.searchParams.get('next');
      const nextPath = requestedNext?.startsWith('/') && !requestedNext.startsWith('//') ? requestedNext : '/teams';
      return redirectWithSession(new URL(mustChangePassword ? '/auth/set-password' : nextPath, request.url));
    }
  }
  return response;
}
