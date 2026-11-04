import type { BaselineTeamRow } from '@/lib/team-import';
import { createClient } from '@/lib/supabase/server';

type BaselineDbRow = {
  member_id: string; team_id: string; team_name: string; normalized_team: string; source_key: string;
  source_row_number: number; sequence_number: string | null; member_name: string | null; normalized_member: string | null;
  contact: string | null; normalized_phone: string | null; category: string | null;
  electronic_fax: string | null; bank_name: string | null;
  company_name: string | null; normalized_company: string | null;
  commission_rate_text: string | null; power_usage_text: string | null;
  commission_rate: number | null; power_usage_kw: number | null;
};

export async function loadTeamBaseline(): Promise<BaselineTeamRow[]> {
  const compareSecret = process.env.TEAM_COMPARE_SECRET;
  if (!compareSecret) throw new Error('missing_config');

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('get_team_baseline', { p_secret: compareSecret });
  if (error) throw new Error('baseline_unavailable');

  return ((data || []) as BaselineDbRow[]).map((row) => ({
    id: row.member_id, teamId: row.team_id, sourceKey: row.source_key, rowNumber: row.source_row_number,
    sequenceNumber: row.sequence_number || '',
    teamName: row.team_name, normalizedTeam: row.normalized_team, memberName: row.member_name || '',
    normalizedMember: row.normalized_member || '', contact: row.contact || '', normalizedPhone: row.normalized_phone || '',
    category: row.category || '', electronicFax: row.electronic_fax || '', bankName: row.bank_name || '',
    companyName: row.company_name || '', normalizedCompany: row.normalized_company || '',
    commissionRateText: row.commission_rate_text || '', powerUsageText: row.power_usage_text || '',
    commissionRate: row.commission_rate, powerUsageKw: row.power_usage_kw,
  }));
}
