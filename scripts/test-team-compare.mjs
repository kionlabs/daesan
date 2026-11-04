import { readSheet } from 'read-excel-file/node';

const [workbookPath, endpoint = 'http://localhost:3001/api/teams/compare'] = process.argv.slice(2);
if (!workbookPath) throw new Error('Workbook path is required.');

const text = (value) => value == null ? '' : String(value).trim();
const number = (value, percent = false) => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = typeof value === 'number' ? value : Number(text(value).replace(/[% ,]/g, ''));
  if (!Number.isFinite(parsed)) return null;
  return percent && parsed > 1 ? parsed / 100 : percent && typeof value !== 'number' ? parsed / 100 : parsed;
};
const sheet = await readSheet(workbookPath, '팀리스트');
const headerIndex = sheet.findIndex((row) => row.map((value) => text(value).replace(/\s/g, '')).includes('팀명'));
const columns = new Map(sheet[headerIndex].map((value, index) => [text(value).replace(/\s/g, ''), index]));
const get = (row, ...names) => {
  const index = names.map((name) => columns.get(name)).find((value) => value !== undefined);
  return index === undefined ? null : row[index];
};
const rows = sheet.slice(headerIndex + 1).map((row, index) => ({
  rowNumber: headerIndex + index + 2,
  sequenceNumber: text(get(row, '순번')),
  teamName: text(get(row, '팀명')), category: text(get(row, '분류')), memberName: text(get(row, '성명')),
  contact: text(get(row, '연락처')), electronicFax: text(get(row, '전자팩스')), bankName: text(get(row, '은행명')),
  companyName: text(get(row, '업체명')), commissionRateText: text(get(row, '수수료율')),
  powerUsageText: text(get(row, '전기사용량(Kw)', '전기사용량')),
  commissionRate: number(get(row, '수수료율'), true), powerUsageKw: number(get(row, '전기사용량(Kw)', '전기사용량')),
})).filter((row) => row.teamName || row.memberName || row.contact);

const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rows }) });
const result = await response.json();
if (!response.ok) throw new Error(result.error || `Compare failed with ${response.status}`);
const summary = Object.fromEntries(['new', 'changed', 'same', 'duplicate', 'review'].map((status) => [status, result.rows.filter((row) => row.status === status).length]));
const comparedFields = ['sequenceNumber', 'teamName', 'category', 'memberName', 'contact', 'electronicFax', 'bankName', 'companyName', 'commissionRateText', 'powerUsageText'];
const changedDetails = result.rows.filter((row) => row.status === 'changed').map((row) => ({
  rowNumber: row.rowNumber,
  fields: comparedFields.filter((field) => String(row.existing?.[field] ?? '') !== String(row[field] ?? '')),
}));
console.log(JSON.stringify({ total: result.rows.length, ...summary, baseline: result.baseline, changedDetails }));
