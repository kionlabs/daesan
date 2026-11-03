import { compareTeamRows, type ParsedTeamRow } from '@/lib/team-import';
import { getAdminSession } from '@/lib/auth/admin';
import { loadTeamBaseline } from '@/lib/server/team-baseline';

export const runtime = 'nodejs';

const maskContact = (value: string) => {
  if (!value) return '-';
  const digits = value.replace(/\D/g, '');
  if (digits.length < 7) return '***';
  return `${digits.slice(0, 3)}-****-${digits.slice(-4)}`;
};

export async function GET() {
  try {
    if (!await getAdminSession()) return Response.json({ error: '관리자 로그인이 필요합니다.' }, { status: 401 });
    const baseline = await loadTeamBaseline();
    const grouped = new Map<string, {
      id: string; teamName: string; categories: Set<string>; members: Array<{
        id: string; name: string; contact: string; category: string; companyName: string;
        commissionRate: number | null; powerUsageKw: number | null; needsReview: boolean;
      }>;
    }>();

    for (const row of baseline) {
      const team = grouped.get(row.teamId) || {
        id: row.teamId, teamName: row.teamName, categories: new Set<string>(), members: [],
      };
      if (row.category) team.categories.add(row.category);
      team.members.push({
        id: row.id,
        name: row.memberName || '-',
        contact: maskContact(row.contact),
        category: row.category || '-',
        companyName: row.companyName || '-',
        commissionRate: row.commissionRate,
        powerUsageKw: row.powerUsageKw,
        needsReview: !row.memberName.trim() || !row.contact.trim() || !row.category.trim(),
      });
      grouped.set(row.teamId, team);
    }

    const teams = Array.from(grouped.values()).map((team) => ({
      ...team,
      categories: Array.from(team.categories).sort((a, b) => a.localeCompare(b, 'ko')),
    })).sort((a, b) => a.teamName.localeCompare(b.teamName, 'ko'));
    const reviewRequired = teams.reduce((count, team) => count + team.members.filter((member) => member.needsReview).length, 0);

    return Response.json({ teams, summary: { teams: teams.length, members: baseline.length, reviewRequired } }, {
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
  return Number.isInteger(row.rowNumber) && validText(row.teamName) && validText(row.category) && validText(row.memberName)
    && validText(row.contact, 50) && validText(row.companyName) && validNumber(row.commissionRate) && validNumber(row.powerUsageKw);
};

export async function POST(request: Request) {
  try {
    if (!await getAdminSession()) return Response.json({ error: '관리자 로그인이 필요합니다.' }, { status: 401 });
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
