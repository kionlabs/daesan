export type ParsedTeamRow = {
  rowNumber: number;
  sequenceNumber: string;
  teamName: string;
  category: string;
  memberName: string;
  contact: string;
  electronicFax: string;
  bankName: string;
  companyName: string;
  commissionRateText: string;
  powerUsageText: string;
  commissionRate: number | null;
  powerUsageKw: number | null;
};

export type BaselineTeamRow = ParsedTeamRow & {
  id: string;
  teamId: string;
  sourceKey: string;
  normalizedTeam: string;
  normalizedMember: string;
  normalizedPhone: string;
  normalizedCompany: string;
};

export type ImportStatus = 'new' | 'changed' | 'same' | 'duplicate' | 'review';
export type ComparedTeamRow = ParsedTeamRow & {
  status: ImportStatus;
  sourceKey: string;
  existing?: ParsedTeamRow;
  existingMemberId?: string;
  reason?: string;
};

export const normalizeText = (value: unknown) => String(value ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
export const normalizePhone = (value: unknown) => String(value ?? '').replace(/\D/g, '');
export const makeSourceKey = (team: string, member: string, phone: string) =>
  `${normalizeText(team)}|${normalizeText(member)}|${normalizePhone(phone)}`;

const cellText = (value: unknown): string => value == null ? '' : String(value).trim();
const parseNumber = (value: unknown, percent = false): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) return percent && value > 1 ? value / 100 : value;
  const text = cellText(value).replace(/,/g, '').replace(/%/g, '');
  if (!text) return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? (percent ? parsed / 100 : parsed) : null;
};

export async function parseTeamWorkbook(file: File): Promise<ParsedTeamRow[]> {
  const { readSheet } = await import('read-excel-file/browser');
  let sheet: unknown[][];
  try {
    sheet = await readSheet(await file.arrayBuffer(), '팀리스트');
  } catch {
    throw new Error('팀리스트 시트를 읽을 수 없습니다. 최신 행사관리 파일인지 확인해 주세요.');
  }

  let headerRow = 0;
  const columns = new Map<string, number>();
  for (let rowNumber = 1; rowNumber <= Math.min(sheet.length, 20); rowNumber += 1) {
    const row = sheet[rowNumber - 1] || [];
    row.forEach((value, index) => {
      const header = cellText(value).replace(/\s/g, '');
      if (['순번', '팀명', '분류', '성명', '연락처', '전자팩스', '은행명', '업체명', '수수료율', '전기사용량(Kw)', '전기사용량'].includes(header)) columns.set(header, index);
    });
    if (columns.has('팀명') && columns.has('성명') && columns.has('연락처')) { headerRow = rowNumber; break; }
    columns.clear();
  }
  if (!headerRow) throw new Error('팀리스트의 필수 헤더(팀명, 성명, 연락처)를 찾을 수 없습니다.');

  const col = (...names: string[]) => names.map((name) => columns.get(name)).find((value) => value !== undefined);
  const rows: ParsedTeamRow[] = [];
  for (let rowNumber = headerRow + 1; rowNumber <= sheet.length; rowNumber += 1) {
    const row = sheet[rowNumber - 1] || [];
    const get = (...names: string[]) => { const index = col(...names); return index === undefined ? null : row[index]; };
    const teamName = cellText(get('팀명'));
    const memberName = cellText(get('성명'));
    const contact = cellText(get('연락처'));
    if (!teamName && !memberName && !contact) continue;
    rows.push({
      rowNumber, sequenceNumber: cellText(get('순번')), teamName, memberName, contact,
      category: cellText(get('분류')),
      electronicFax: cellText(get('전자팩스')),
      bankName: cellText(get('은행명')),
      companyName: cellText(get('업체명')),
      commissionRateText: cellText(get('수수료율')),
      powerUsageText: cellText(get('전기사용량(Kw)', '전기사용량')),
      commissionRate: parseNumber(get('수수료율'), true), powerUsageKw: parseNumber(get('전기사용량(Kw)', '전기사용량')),
    });
  }
  if (!rows.length) throw new Error('팀리스트에서 데이터 행을 찾을 수 없습니다.');
  return rows;
}

const comparable = (row: Partial<ParsedTeamRow>) => ({
  sequenceNumber: cellText(row.sequenceNumber), teamName: normalizeText(row.teamName), category: normalizeText(row.category), memberName: normalizeText(row.memberName),
  contact: normalizePhone(row.contact), companyName: normalizeText(row.companyName),
  electronicFax: cellText(row.electronicFax), bankName: cellText(row.bankName),
  commissionRateText: cellText(row.commissionRateText), powerUsageText: cellText(row.powerUsageText),
});
const asExisting = (row: BaselineTeamRow): ParsedTeamRow => ({
  rowNumber: row.rowNumber, sequenceNumber: row.sequenceNumber, teamName: row.teamName, category: row.category, memberName: row.memberName,
  contact: row.contact, electronicFax: row.electronicFax, bankName: row.bankName, companyName: row.companyName,
  commissionRateText: row.commissionRateText, powerUsageText: row.powerUsageText,
  commissionRate: row.commissionRate, powerUsageKw: row.powerUsageKw,
});

export function compareTeamRows(rows: ParsedTeamRow[], baseline: BaselineTeamRow[]): ComparedTeamRow[] {
  const inputCounts = new Map<string, number>();
  rows.forEach((row) => { const key = makeSourceKey(row.teamName, row.memberName, row.contact); inputCounts.set(key, (inputCounts.get(key) || 0) + 1); });

  return rows.map((row) => {
    const normalizedTeam = normalizeText(row.teamName);
    const normalizedMember = normalizeText(row.memberName);
    const normalizedContact = normalizePhone(row.contact);
    const normalizedCompany = normalizeText(row.companyName);
    const sourceKey = makeSourceKey(row.teamName, row.memberName, row.contact);
    if (!normalizedTeam || !normalizedMember || !normalizedContact) return { ...row, sourceKey, status: 'review', reason: '팀명, 성명 또는 연락처가 비어 있습니다.' };
    if ((inputCounts.get(sourceKey) || 0) > 1) return { ...row, sourceKey, status: 'duplicate', reason: '업로드 파일 안에 같은 팀·담당자·연락처가 반복됩니다.' };

    const exact = baseline.filter((item) => item.sourceKey === sourceKey);
    if (exact.length > 1) return { ...row, sourceKey, status: 'duplicate', reason: '기준 데이터에 같은 식별값이 여러 건 존재합니다.' };
    if (exact.length === 1) {
      const existing = asExisting(exact[0]);
      const changed = JSON.stringify(comparable(existing)) !== JSON.stringify(comparable(row));
      return { ...row, sourceKey, status: changed ? 'changed' : 'same', existing, existingMemberId: exact[0].id };
    }

    const scored = baseline.map((item) => {
      const signals = [item.normalizedTeam === normalizedTeam ? 4 : 0, item.normalizedPhone === normalizedContact ? 4 : 0,
        item.normalizedMember === normalizedMember ? 3 : 0, normalizedCompany && item.normalizedCompany === normalizedCompany ? 2 : 0];
      return { item, score: signals.reduce((sum, value) => sum + value, 0), signalCount: signals.filter(Boolean).length };
    }).filter((candidate) => candidate.score > 0).sort((a, b) => b.score - a.score);
    const best = scored[0];
    const tied = best ? scored.filter((candidate) => candidate.score === best.score) : [];
    if (best && best.score >= 7 && best.signalCount >= 2 && tied.length === 1) {
      return { ...row, sourceKey, status: 'changed', existing: asExisting(best.item), existingMemberId: best.item.id };
    }
    if (best && (tied.length > 1 || best.score >= 4)) return { ...row, sourceKey, status: 'review', reason: '여러 기준 행과 일부 식별값이 겹쳐 자동 연결할 수 없습니다.' };
    const crossIdentity = scored.some((candidate) => candidate.item.normalizedPhone === normalizedContact || candidate.item.normalizedMember === normalizedMember);
    if (crossIdentity) return { ...row, sourceKey, status: 'duplicate', reason: '다른 팀의 담당자 또는 연락처와 겹칩니다.' };
    return { ...row, sourceKey, status: 'new' };
  });
}

export function changedFields(row: ComparedTeamRow) {
  if (!row.existing) return [];
  const fields: Array<[string, unknown, unknown]> = [
    ['순번', row.existing.sequenceNumber, row.sequenceNumber], ['팀명', row.existing.teamName, row.teamName],
    ['분류', row.existing.category, row.category], ['성명', row.existing.memberName, row.memberName],
    ['연락처', row.existing.contact, row.contact], ['전자팩스', row.existing.electronicFax, row.electronicFax],
    ['은행명', row.existing.bankName, row.bankName],
    ['업체명', row.existing.companyName, row.companyName], ['수수료율', row.existing.commissionRateText, row.commissionRateText],
    ['전기사용량', row.existing.powerUsageText, row.powerUsageText],
  ];
  return fields.filter(([, before, after]) => String(before ?? '') !== String(after ?? ''));
}
