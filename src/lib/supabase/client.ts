import { createBrowserClient } from '@supabase/ssr';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn(
    'Warning: Supabase environment variables (NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY) are not defined. Please check your .env.local file.'
  );
}

// 클라이언트와 서버 환경 모두에서 안전하게 참조할 수 있도록 설정
// 기본 데이터베이스 스키마로 'daesan' 스키마를 사용하도록 설정합니다.
export function createClient() {
  return createBrowserClient(
    supabaseUrl || 'https://placeholder.supabase.co',
    supabaseAnonKey || 'placeholder-anon-key',
    { db: { schema: 'daesan' } },
  );
}

export const supabase = createClient();
