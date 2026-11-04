import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { readSheet } from 'read-excel-file/node';

const [workbookPath, envPath, outputPath] = process.argv.slice(2);
if (!workbookPath || !envPath || !outputPath) {
  throw new Error('Usage: node scripts/generate-team-baseline-sql.mjs <workbook> <env> <output>');
}

const env = Object.fromEntries((await readFile(envPath, 'utf8')).split(/\r?\n/).filter((line) => line && !line.startsWith('#') && line.includes('=')).map((line) => {
  const index = line.indexOf('=');
  return [line.slice(0, index), line.slice(index + 1)];
}));
if (!env.TEAM_COMPARE_SECRET) throw new Error('TEAM_COMPARE_SECRET is missing.');

const normalizeText = (value) => String(value ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
const normalizePhone = (value) => String(value ?? '').replace(/\D/g, '');
const sqlText = (value) => value === null || value === undefined || value === '' ? 'null' : `'${String(value).replaceAll("'", "''")}'`;
const sqlNumber = (value) => value === null || value === undefined || value === '' || !Number.isFinite(Number(value)) ? 'null' : String(Number(value));
const parseRate = (value) => {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return value > 1 ? value / 100 : value;
  const parsed = Number(String(value).replace(/[% ,]/g, ''));
  return Number.isFinite(parsed) ? parsed / 100 : null;
};

const sheet = await readSheet(workbookPath, '팀리스트');
const headerIndex = sheet.findIndex((row) => row.map((value) => String(value ?? '').replace(/\s/g, '')).includes('팀명'));
if (headerIndex < 0) throw new Error('팀리스트 헤더를 찾지 못했습니다.');
const columns = new Map(sheet[headerIndex].map((value, index) => [String(value ?? '').replace(/\s/g, ''), index]));
const get = (row, ...names) => {
  const index = names.map((name) => columns.get(name)).find((value) => value !== undefined);
  return index === undefined ? null : row[index];
};

const rows = sheet.slice(headerIndex + 1).map((row, index) => {
  const teamName = String(get(row, '팀명') ?? '').trim();
  const memberName = String(get(row, '성명') ?? '').trim();
  const contact = String(get(row, '연락처') ?? '').trim();
  return {
    rowNumber: headerIndex + index + 2, teamName, memberName, contact,
    normalizedTeam: normalizeText(teamName), normalizedMember: normalizeText(memberName), normalizedPhone: normalizePhone(contact),
    category: String(get(row, '분류') ?? '').trim(), companyName: String(get(row, '업체명') ?? '').trim(),
    commissionRate: parseRate(get(row, '수수료율')), powerUsageKw: get(row, '전기사용량(Kw)', '전기사용량'),
  };
}).filter((row) => row.teamName || row.memberName || row.contact);
if (rows.length !== 219) throw new Error(`Expected 219 team rows, received ${rows.length}.`);

const statements = ['begin;'];
for (const [normalizedTeam, teamName] of new Map(rows.map((row) => [row.normalizedTeam, row.teamName]))) {
  statements.push(`insert into daesan.teams (team_name, normalized_name) values (${sqlText(teamName)}, ${sqlText(normalizedTeam)}) on conflict (normalized_name) do update set team_name = excluded.team_name, updated_at = now();`);
}
for (const row of rows) {
  const sourceKey = `${row.normalizedTeam}|${row.normalizedMember}|${row.normalizedPhone}`;
  statements.push(`insert into daesan.team_members (team_id, source_row_number, source_key, member_name, normalized_name, contact, normalized_phone, category, company_name, normalized_company, commission_rate, power_usage_kw) values ((select id from daesan.teams where normalized_name = ${sqlText(row.normalizedTeam)}), ${row.rowNumber}, ${sqlText(sourceKey)}, ${sqlText(row.memberName)}, ${sqlText(row.normalizedMember)}, ${sqlText(row.contact)}, ${sqlText(row.normalizedPhone)}, ${sqlText(row.category)}, ${sqlText(row.companyName)}, ${sqlText(normalizeText(row.companyName))}, ${sqlNumber(row.commissionRate)}, ${sqlNumber(row.powerUsageKw)}) on conflict (source_row_number) do update set team_id = excluded.team_id, source_key = excluded.source_key, member_name = excluded.member_name, normalized_name = excluded.normalized_name, contact = excluded.contact, normalized_phone = excluded.normalized_phone, category = excluded.category, company_name = excluded.company_name, normalized_company = excluded.normalized_company, commission_rate = excluded.commission_rate, power_usage_kw = excluded.power_usage_kw, updated_at = now();`);
}
const secretHash = createHash('sha256').update(env.TEAM_COMPARE_SECRET).digest('hex');
statements.push(`insert into daesan.team_compare_config (singleton, secret_hash) values (true, ${sqlText(secretHash)}) on conflict (singleton) do update set secret_hash = excluded.secret_hash, updated_at = now();`);
statements.push('commit;');
await writeFile(outputPath, statements.join('\n'), { encoding: 'utf8', mode: 0o600 });
console.log(JSON.stringify({ rows: rows.length, teams: new Set(rows.map((row) => row.normalizedTeam)).size }));
