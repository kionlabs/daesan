import { compareTeamRows, type ParsedTeamRow } from '@/lib/team-import';
import { getAdminSession } from '@/lib/auth/admin';
import { loadTeamBaseline } from '@/lib/server/team-baseline';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const admin = await getAdminSession();
    if (!admin) return Response.json({ error: '관리자 로그인이 필요합니다.' }, { status: 401 });
    if (admin.mustChangePassword) return Response.json({ error: '최초 로그인 비밀번호 변경이 필요합니다.' }, { status: 403 });
    const baseline = await loadTeamBaseline();
    const teamNameCounts = new Map<string, number>();
    baseline.forEach((row) => teamNameCounts.set(row.teamName, (teamNameCounts.get(row.teamName) || 0) + 1));
    const rows = baseline.map((row) => ({
      id: row.id, sequenceNumber: row.sequenceNumber, teamName: row.teamName, category: row.category,
      memberName: row.memberName, contact: row.contact, electronicFax: row.electronicFax,
      bankName: row.bankName, companyName: row.companyName, commissionRate: row.commissionRate,
      commissionRateText: row.commissionRateText, powerUsageText: row.powerUsageText,
      powerUsageKw: row.powerUsageKw, duplicateTeamName: (teamNameCounts.get(row.teamName) || 0) > 1,
    }));
    const duplicateTeamNames = Array.from(teamNameCounts.values()).filter((count) => count > 1).length;

    return Response.json({ rows, summary: { totalRows: rows.length, uniqueTeams: teamNameCounts.size, duplicateTeamNames } }, {
      headers: { 'Cache-Control': 'no-store, private', 'X-Content-Type-Options': 'nosniff' },
    });
  } catch {
    return Response.json({ error: '현재 팀 데이터를 불러오지 못했습니다.' }, { status: 503 });
  }
}

const validText = (value: unknown, max = 200) => typeof value === 'string' && value.length <= max;
const validNumber = (value: unknown) => value === null || (typeof value === 'number' && Number.isFinite(value));
const isParsedRow = (value: unknown): value is ParsedTeamRow => {
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  return Number.isInteger(row.rowNumber) && validText(row.sequenceNumber, 30) && validText(row.teamName)
    && validText(row.category) && validText(row.memberName) && validText(row.contact, 50)
    && validText(row.electronicFax, 100) && validText(row.bankName, 100) && validText(row.companyName)
    && validText(row.commissionRateText, 100) && validText(row.powerUsageText, 100)
    && validNumber(row.commissionRate) && validNumber(row.powerUsageKw);
};

export async function POST(request: Request) {
  try {
    const admin = await getAdminSession();
    if (!admin) return Response.json({ error: '관리자 로그인이 필요합니다.' }, { status: 401 });
    if (admin.mustChangePassword) return Response.json({ error: '최초 로그인 비밀번호 변경이 필요합니다.' }, { status: 403 });
    const contentLength = Number(request.headers.get('content-length') || 0);
    if (contentLength > 1_500_000) return Response.json({ error: '비교 요청이 너무 큽니다.' }, { status: 413 });
    const body = await request.json() as { rows?: unknown };
    if (!Array.isArray(body.rows) || body.rows.length === 0 || body.rows.length > 1000 || !body.rows.every(isParsedRow)) {
      return Response.json({ error: '팀리스트 데이터 형식이 올바르지 않습니다.' }, { status: 400 });
    }

    const baseline = await loadTeamBaseline();
    const compared = compareTeamRows(body.rows, baseline);
    const teamCount = new Set(baseline.map((row) => row.teamId)).size;
    return Response.json({ rows: compared, baseline: { teams: teamCount, members: baseline.length } }, {
      headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
    });
  } catch {
    return Response.json({ error: '비교 요청을 처리하지 못했습니다.' }, { status: 400 });
  }
}
