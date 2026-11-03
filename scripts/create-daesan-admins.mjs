import { randomInt } from 'node:crypto';
import { appendFile, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClient } from '@supabase/supabase-js';

const execute = process.argv.includes('--execute');
const envPath = process.env.DAESAN_ENV_FILE || '.env.local';

const parseEnv = (source) => Object.fromEntries(source
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter((line) => line && !line.startsWith('#') && line.includes('='))
  .map((line) => {
    const index = line.indexOf('=');
    const key = line.slice(0, index).trim();
    const value = line.slice(index + 1).trim().replace(/^(['"])(.*)\1$/, '$2');
    return [key, value];
  }));

const env = parseEnv(await readFile(envPath, 'utf8'));
const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
const adminKey = env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !adminKey) {
  throw new Error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY (or SUPABASE_SERVICE_ROLE_KEY) are required.');
}
if (adminKey === env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
  throw new Error('The publishable/anon key cannot create users. Add a server-only secret key.');
}

const supabase = createClient(supabaseUrl, adminKey, {
  db: { schema: 'daesan' },
  auth: { autoRefreshToken: false, persistSession: false },
});

const { data: allowlist, error: allowlistError } = await supabase
  .from('admin_invite_allowlist')
  .select('email, display_name, created_at')
  .order('created_at', { ascending: true });

if (allowlistError) throw new Error(`Could not load the admin allowlist: ${allowlistError.message}`);
if (!allowlist?.length) throw new Error('The Daesan admin allowlist is empty.');

const { data: usersPage, error: usersError } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
if (usersError) throw new Error(`Could not list Auth users: ${usersError.message}`);

const existingEmails = new Set(usersPage.users.map((user) => user.email?.toLowerCase()).filter(Boolean));
const pending = allowlist.filter((entry) => !existingEmails.has(entry.email.toLowerCase()));

if (!execute) {
  console.log(JSON.stringify({ mode: 'dry-run', allowlist: allowlist.length, existing: allowlist.length - pending.length, toCreate: pending.length }));
  console.log('Run again with --execute to create the missing users.');
  process.exit(0);
}

const passwordAlphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%';
const shuffle = (values) => {
  for (let index = values.length - 1; index > 0; index -= 1) {
    const swapIndex = randomInt(index + 1);
    [values[index], values[swapIndex]] = [values[swapIndex], values[index]];
  }
  return values;
};
const createTemporaryPassword = () => {
  const required = [
    'ABCDEFGHJKLMNPQRSTUVWXYZ'[randomInt(24)],
    'abcdefghijkmnopqrstuvwxyz'[randomInt(25)],
    '23456789'[randomInt(8)],
    '!@#$%'[randomInt(5)],
  ];
  while (required.length < 16) required.push(passwordAlphabet[randomInt(passwordAlphabet.length)]);
  return shuffle(required).join('');
};
const csv = (value) => `"${String(value ?? '').replaceAll('"', '""')}"`;
const timestamp = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-');
const credentialsPath = join(tmpdir(), `daesan-admin-credentials-${timestamp}.csv`);

await writeFile(credentialsPath, '\uFEFF순번,이름,이메일,임시 비밀번호,상태\n', { encoding: 'utf8', mode: 0o600 });

let created = 0;
let skipped = 0;

for (const [index, entry] of allowlist.entries()) {
  if (existingEmails.has(entry.email.toLowerCase())) {
    skipped += 1;
    await appendFile(credentialsPath, `${index + 1},${csv(entry.display_name)},${csv(entry.email)},,${csv('기존 계정 - 비밀번호 변경 안 함')}\n`, 'utf8');
    continue;
  }

  const password = createTemporaryPassword();
  const { error } = await supabase.auth.admin.createUser({
    email: entry.email,
    password,
    email_confirm: true,
  });
  if (error) {
    await appendFile(credentialsPath, `${index + 1},${csv(entry.display_name)},${csv(entry.email)},,${csv(`생성 실패: ${error.message}`)}\n`, 'utf8');
    throw new Error(`User creation stopped at allowlist row ${index + 1}. Review the local credentials report.`);
  }

  created += 1;
  await appendFile(credentialsPath, `${index + 1},${csv(entry.display_name)},${csv(entry.email)},${csv(password)},${csv('생성 완료 - 최초 로그인 시 변경 필요')}\n`, 'utf8');
}

console.log(JSON.stringify({ created, skipped, credentialsFile: credentialsPath }));
console.log('The credentials file contains temporary passwords. Distribute them privately, then delete the file.');
