import { compareTeamRows, type ParsedTeamRow } from '@/lib/team-import';
import { getAdminSession } from '@/lib/auth/admin';
import { loadTeamBaseline } from '@/lib/server/team-baseline';
import { createClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';

const validText = (value: unknown, max = 200): value is string => typeof value === 'string' && value.length <= max;
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
    if (contentLength > 1_500_000) return Response.json({ error: '반영 요청이 너무 큽니다.' }, { status: 413 });

    const body = await request.json() as { fileName?: unknown; rows?: unknown };
    if (!validText(body.fileName, 255) || !body.fileName.trim()) return Response.json({ error: '파일명이 올바르지 않습니다.' }, { status: 400 });
    if (!Array.isArray(body.rows) || body.rows.length === 0 || body.rows.length > 1000 || !body.rows.every(isParsedRow)) {
      return Response.json({ error: '팀 데이터 형식이 올바르지 않습니다.' }, { status: 400 });
    }

    const baseline = await loadTeamBaseline();
    const compared = compareTeamRows(body.rows, baseline);
    const applicable = compared.filter((row) => row.status === 'new' || row.status === 'changed').map((row) => ({
      status: row.status,
      existingMemberId: row.existingMemberId || null,
      rowNumber: row.rowNumber,
      sequenceNumber: row.sequenceNumber,
      teamName: row.teamName,
      category: row.category,
      memberName: row.memberName,
      contact: row.contact,
      electronicFax: row.electronicFax,
      bankName: row.bankName,
      companyName: row.companyName,
      commissionRateText: row.commissionRateText,
      powerUsageText: row.powerUsageText,
      commissionRate: row.commissionRate,
      powerUsageKw: row.powerUsageKw,
    }));
    if (!applicable.length) return Response.json({ error: '반영할 신규 또는 변경 항목이 없습니다.' }, { status: 400 });

    const supabase = await createClient();
    const { data, error } = await supabase.rpc('apply_team_import', { p_file_name: body.fileName, p_rows: applicable });
    if (error) return Response.json({ error: 'DB 반영 중 데이터가 변경되었거나 유효성 검사를 통과하지 못했습니다.' }, { status: 409 });
    const result = Array.isArray(data) ? data[0] : data;
    return Response.json({
      batchId: result?.batch_id,
      newCount: result?.new_count || 0,
      changedCount: result?.changed_count || 0,
    }, { headers: { 'Cache-Control': 'no-store, private', 'X-Content-Type-Options': 'nosniff' } });
  } catch {
    return Response.json({ error: 'DB 반영 요청을 처리하지 못했습니다.' }, { status: 400 });
  }
}
