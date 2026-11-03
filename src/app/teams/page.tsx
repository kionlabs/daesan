'use client';

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PageHeader, StatusBadge } from '@/components/erp-ui';
import { changedFields, parseTeamWorkbook, type ComparedTeamRow, type ImportStatus } from '@/lib/team-import';

const statusMeta: Record<ImportStatus, { label: string; tone: 'green' | 'blue' | 'gray' | 'amber' | 'red' }> = {
  new: { label: '신규', tone: 'green' }, changed: { label: '변경', tone: 'blue' }, same: { label: '동일', tone: 'gray' },
  duplicate: { label: '중복 후보', tone: 'amber' }, review: { label: '확인 필요', tone: 'red' },
};
const display = (value: unknown) => value === null || value === undefined || value === '' ? '-' : String(value);
const percent = (value: number | null | undefined) => value == null ? '-' : `${(value * 100).toFixed(value * 100 % 1 ? 1 : 0)}%`;
const formatDiff = (label: string, value: unknown) => label === '수수료율' ? percent(value as number | null) : label === '전기사용량' && value != null ? `${value}kW` : display(value);

type DbTeam = {
  id: string;
  teamName: string;
  categories: string[];
  members: Array<{
    id: string; name: string; contact: string; category: string; companyName: string;
    commissionRate: number | null; powerUsageKw: number | null; needsReview: boolean;
  }>;
};

export default function TeamsPage() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<ComparedTeamRow[]>([]);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [fileName, setFileName] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | ImportStatus>('all');
  const [expandedRow, setExpandedRow] = useState<number | null>(null);
  const [dbTeams, setDbTeams] = useState<DbTeam[]>([]);
  const [dbSummary, setDbSummary] = useState({ teams: 0, members: 0, reviewRequired: 0 });
  const [dbLoading, setDbLoading] = useState(true);
  const [dbError, setDbError] = useState<string | null>(null);
  const [teamSearch, setTeamSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [applying, setApplying] = useState(false);

  const loadDbTeams = useCallback(async () => {
    setDbLoading(true); setDbError(null);
    try {
      const response = await fetch('/api/teams/compare', { cache: 'no-store' });
      const result = await response.json() as { teams?: DbTeam[]; summary?: typeof dbSummary; error?: string };
      if (!response.ok || !result.teams || !result.summary) throw new Error(result.error || '팀 목록을 불러오지 못했습니다.');
      setDbTeams(result.teams); setDbSummary(result.summary);
    } catch (caught) {
      setDbError(caught instanceof Error ? caught.message : '팀 목록을 불러오지 못했습니다.');
    } finally { setDbLoading(false); }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial authenticated data load
    void loadDbTeams();
  }, [loadDbTeams]);

  const summary = useMemo(() => ({
    all: rows.length, new: rows.filter((row) => row.status === 'new').length,
    changed: rows.filter((row) => row.status === 'changed').length, same: rows.filter((row) => row.status === 'same').length,
    duplicate: rows.filter((row) => row.status === 'duplicate').length, review: rows.filter((row) => row.status === 'review').length,
  }), [rows]);
  const filteredRows = rows.filter((row) => statusFilter === 'all' || row.status === statusFilter);
  const categories = useMemo(() => Array.from(new Set(dbTeams.flatMap((team) => team.categories))).sort((a, b) => a.localeCompare(b, 'ko')), [dbTeams]);
  const visibleTeams = useMemo(() => {
    const query = teamSearch.trim().toLocaleLowerCase('ko');
    return dbTeams.filter((team) => {
      const matchesCategory = categoryFilter === 'all' || team.categories.includes(categoryFilter);
      const haystack = [team.teamName, ...team.members.flatMap((member) => [member.name, member.companyName])].join(' ').toLocaleLowerCase('ko');
      return matchesCategory && (!query || haystack.includes(query));
    });
  }, [categoryFilter, dbTeams, teamSearch]);
  const selectedTeam = dbTeams.find((team) => team.id === selectedTeamId) || null;
  const applicableCount = summary.new + summary.changed;

  const resetImport = () => {
    setRows([]); setFileName(''); setStatusFilter('all');
    setExpandedRow(null); setNotice(null); setError(null);
    if (inputRef.current) inputRef.current.value = '';
  };

  const handleFile = async (file?: File) => {
    if (!file) return;
    const extension = file.name.split('.').pop()?.toLowerCase();
    if (!['xlsx', 'xlsm'].includes(extension || '')) { setError('.xlsx 또는 .xlsm 파일만 업로드할 수 있습니다.'); return; }
    if (file.size > 20 * 1024 * 1024) { setError('파일 크기는 20MB 이하여야 합니다.'); return; }
    setProcessing(true); setError(null); setNotice(null); setExpandedRow(null);
    try {
      const parsed = await parseTeamWorkbook(file);
      const response = await fetch('/api/teams/compare', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store', body: JSON.stringify({ rows: parsed }),
      });
      const result = await response.json() as { rows?: ComparedTeamRow[]; baseline?: { teams: number; members: number }; error?: string };
      if (!response.ok || !result.rows || !result.baseline) throw new Error(result.error || '기준 데이터 비교에 실패했습니다.');
      setRows(result.rows); setFileName(file.name);
      setNotice(`${result.rows.length}개 행을 파싱하고 DB 기준 데이터와 비교했습니다. 원본 파일과 비교 결과는 저장하지 않습니다.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Excel 처리 중 오류가 발생했습니다.');
    } finally { setProcessing(false); }
  };

  const applyChanges = async () => {
    setApplying(true); setError(null);
    try {
      const response = await fetch('/api/teams/apply', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store',
        body: JSON.stringify({ fileName, rows }),
      });
      const result = await response.json() as { newCount?: number; changedCount?: number; error?: string };
      if (!response.ok) throw new Error(result.error || 'DB 반영에 실패했습니다.');
      setConfirmOpen(false); setRows([]); setFileName(''); setStatusFilter('all'); setExpandedRow(null);
      if (inputRef.current) inputRef.current.value = '';
      await loadDbTeams();
      setNotice(`DB 반영이 완료되었습니다. 신규 ${result.newCount || 0}건, 변경 ${result.changedCount || 0}건을 처리했습니다.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'DB 반영 중 오류가 발생했습니다.');
      setConfirmOpen(false);
    } finally { setApplying(false); }
  };

  return <div>
    <PageHeader eyebrow="OPERATIONS" title="팀 관리" description="최신 행사관리 Excel을 기준 팀 데이터와 비교하고 변경사항을 검토합니다." />
    {error && <div className="mb-4 border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>}
    {notice && <div className="mb-4 border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">{notice}</div>}

    <section className="mb-6 grid gap-3 sm:grid-cols-3">
      <Metric label="현재 팀 수" value={dbLoading ? '조회 중' : `${dbSummary.teams}개`} />
      <Metric label="담당자 수" value={dbLoading ? '조회 중' : `${dbSummary.members}명`} />
      <Metric label="확인 필요" value={dbLoading ? '조회 중' : `${dbSummary.reviewRequired}건`} warning={dbSummary.reviewRequired > 0} />
    </section>

    <section className="mb-6 border border-gray-200 bg-white">
      <div className="border-b border-gray-200 p-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div><h2 className="font-bold text-gray-950">현재 DB 팀 목록</h2><p className="mt-1 text-sm text-gray-500">Supabase 기준 데이터를 읽기 전용으로 표시합니다. 연락처는 서버에서 마스킹됩니다.</p></div>
          <div className="grid gap-2 sm:grid-cols-[minmax(220px,1fr)_180px]">
            <input aria-label="팀 검색" value={teamSearch} onChange={(event) => setTeamSearch(event.target.value)} placeholder="팀명, 담당자, 업체명 검색" className="h-10 border border-gray-300 px-3 text-sm outline-none focus:border-emerald-700" />
            <select aria-label="분류 필터" value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)} className="h-10 border border-gray-300 bg-white px-3 text-sm outline-none focus:border-emerald-700"><option value="all">전체 분류</option>{categories.map((category) => <option key={category} value={category}>{category}</option>)}</select>
          </div>
        </div>
      </div>
      {dbError ? <div className="p-8 text-center text-sm text-red-700">{dbError}</div> : dbLoading ? <div className="p-8 text-center text-sm text-gray-500">팀 데이터를 불러오는 중입니다.</div> : <div className="grid min-h-[360px] lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="overflow-x-auto lg:border-r lg:border-gray-200">
          <table className="w-full min-w-[620px] text-sm"><thead className="bg-gray-50 text-left text-xs text-gray-500"><tr><th className="px-4 py-3">팀명</th><th className="px-4 py-3">분류</th><th className="px-4 py-3">담당자</th><th className="px-4 py-3">업체</th><th className="px-4 py-3">상태</th></tr></thead><tbody className="divide-y divide-gray-100">{visibleTeams.map((team) => {
            const needsReview = team.members.some((member) => member.needsReview);
            return <tr key={team.id} onClick={() => setSelectedTeamId(team.id)} className={`cursor-pointer hover:bg-emerald-50 ${selectedTeamId === team.id ? 'bg-emerald-50' : ''}`}><td className="px-4 py-3 font-bold text-gray-950">{team.teamName}</td><td className="px-4 py-3">{team.categories.join(', ') || '-'}</td><td className="px-4 py-3">{team.members.length}명</td><td className="max-w-[220px] truncate px-4 py-3">{Array.from(new Set(team.members.map((member) => member.companyName).filter((name) => name !== '-'))).join(', ') || '-'}</td><td className="px-4 py-3"><StatusBadge tone={needsReview ? 'amber' : 'green'}>{needsReview ? '확인 필요' : '정상'}</StatusBadge></td></tr>;
          })}{visibleTeams.length === 0 && <tr><td colSpan={5} className="p-10 text-center text-gray-500">검색 조건에 맞는 팀이 없습니다.</td></tr>}</tbody></table>
        </div>
        <aside className="p-5">{selectedTeam ? <><div className="border-b border-gray-200 pb-4"><p className="text-xs font-bold text-emerald-700">팀 상세</p><h3 className="mt-1 text-xl font-bold text-gray-950">{selectedTeam.teamName}</h3><p className="mt-1 text-sm text-gray-500">{selectedTeam.categories.join(', ') || '분류 미등록'} · 담당자 {selectedTeam.members.length}명</p></div><div className="mt-4 space-y-3">{selectedTeam.members.map((member) => <div key={member.id} className="border border-gray-200 p-3"><div className="flex items-center justify-between gap-2"><strong>{member.name}</strong>{member.needsReview && <StatusBadge tone="amber">확인 필요</StatusBadge>}</div><dl className="mt-2 grid grid-cols-[76px_1fr] gap-y-1 text-xs"><dt className="text-gray-500">연락처</dt><dd>{member.contact}</dd><dt className="text-gray-500">업체명</dt><dd>{member.companyName}</dd><dt className="text-gray-500">분류</dt><dd>{member.category}</dd><dt className="text-gray-500">수수료율</dt><dd>{percent(member.commissionRate)}</dd><dt className="text-gray-500">전기사용량</dt><dd>{member.powerUsageKw == null ? '-' : `${member.powerUsageKw}kW`}</dd></dl></div>)}</div></> : <div className="flex min-h-[280px] items-center justify-center text-center text-sm text-gray-500">목록에서 팀을 선택하면<br />담당자 상세를 확인할 수 있습니다.</div>}</aside>
      </div>}
      <div className="border-t border-gray-200 bg-gray-50 px-5 py-3 text-xs text-gray-500">총 {visibleTeams.length}개 팀 표시 · 확인 필요는 담당자명, 연락처 또는 분류가 비어 있는 행입니다.</div>
    </section>

    <section className="mb-6 border border-gray-200 bg-white">
      <div className="flex flex-col gap-4 border-b border-gray-200 p-5 lg:flex-row lg:items-center lg:justify-between">
        <div><h2 className="font-bold text-gray-950">최신 행사관리 Excel 업로드</h2><p className="mt-1 text-sm text-gray-500">현재 DB 목록을 확인한 뒤 최신 파일을 비교합니다. 브라우저에서는 `팀리스트`의 허용 필드만 읽고 매크로는 실행하지 않습니다.</p></div>
        <div className="flex flex-wrap gap-2">{rows.length > 0 && <button type="button" onClick={resetImport} className="border border-gray-300 bg-white px-4 py-2 text-sm font-bold text-gray-700">결과 닫기</button>}<label className={`inline-flex cursor-pointer items-center bg-emerald-700 px-4 py-2 text-sm font-bold text-white ${processing ? 'pointer-events-none opacity-60' : ''}`}>{processing ? '파싱 및 비교 중...' : 'Excel 파일 선택'}<input ref={inputRef} type="file" accept=".xlsx,.xlsm" className="hidden" onChange={(event) => handleFile(event.target.files?.[0])} /></label></div>
      </div>
      <div className="grid gap-3 p-5 text-sm md:grid-cols-3"><FlowStep number="1" title="업로드·파싱" description="팀리스트와 허용 필드만 추출" /><FlowStep number="2" title="DB 기준 비교" description="복합 식별값으로 자동 매칭" /><FlowStep number="3" title="변경 검토" description="상태와 필드별 차이 확인" /></div>
    </section>

    {rows.length > 0 && <section>
      <div className="mb-3 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between"><div><h2 className="font-bold">실제 비교 결과</h2><p className="text-xs text-gray-500">{fileName} · 변경 행을 누르면 달라진 필드만 확인할 수 있습니다.</p></div><div className="text-right"><button type="button" disabled={applicableCount === 0 || applying} onClick={() => setConfirmOpen(true)} className="bg-emerald-800 px-5 py-2.5 text-sm font-bold text-white disabled:cursor-not-allowed disabled:bg-gray-300 disabled:text-gray-600">DB 반영</button><p className="mt-1 text-xs font-medium text-gray-500">신규·변경 항목만 관리자 권한으로 반영됩니다.</p></div></div>
      <div className="mb-4 grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
        <SummaryCard label="전체" value={summary.all} active={statusFilter === 'all'} onClick={() => setStatusFilter('all')} />
        <SummaryCard label="신규" value={summary.new} active={statusFilter === 'new'} onClick={() => setStatusFilter('new')} />
        <SummaryCard label="변경" value={summary.changed} active={statusFilter === 'changed'} onClick={() => setStatusFilter('changed')} />
        <SummaryCard label="동일" value={summary.same} active={statusFilter === 'same'} onClick={() => setStatusFilter('same')} />
        <SummaryCard label="중복 후보" value={summary.duplicate} active={statusFilter === 'duplicate'} onClick={() => setStatusFilter('duplicate')} />
        <SummaryCard label="확인 필요" value={summary.review} active={statusFilter === 'review'} onClick={() => setStatusFilter('review')} />
      </div>
      <div className="overflow-x-auto border border-gray-200 bg-white"><table className="w-full min-w-[980px] text-sm"><thead className="bg-gray-50 text-left text-xs text-gray-500"><tr><th className="px-4 py-3">상태</th><th className="px-4 py-3">팀명</th><th className="px-4 py-3">분류</th><th className="px-4 py-3">담당자</th><th className="px-4 py-3">연락처</th><th className="px-4 py-3">업체명</th><th className="px-4 py-3">수수료율</th><th className="px-4 py-3">전기사용량</th><th className="px-4 py-3">검토</th></tr></thead><tbody className="divide-y divide-gray-100">{filteredRows.map((row) => {
        const changes = changedFields(row); const expanded = expandedRow === row.rowNumber;
        return <Fragment key={row.rowNumber}><tr className={row.status === 'changed' ? 'cursor-pointer hover:bg-blue-50' : ''} onClick={() => row.status === 'changed' && setExpandedRow(expanded ? null : row.rowNumber)}><td className="px-4 py-3"><StatusBadge tone={statusMeta[row.status].tone}>{statusMeta[row.status].label}</StatusBadge><span className="ml-2 text-[11px] text-gray-400">{row.rowNumber}행</span></td><td className="px-4 py-3 font-bold">{display(row.teamName)}</td><td className="px-4 py-3">{display(row.category)}</td><td className="px-4 py-3">{display(row.memberName)}</td><td className="px-4 py-3">{display(row.contact)}</td><td className="px-4 py-3">{display(row.companyName)}</td><td className="px-4 py-3">{percent(row.commissionRate)}</td><td className="px-4 py-3">{row.powerUsageKw == null ? '-' : `${row.powerUsageKw}kW`}</td><td className="px-4 py-3 text-xs">{row.status === 'changed' ? <button type="button" className="font-bold text-blue-700">{changes.length}개 필드 {expanded ? '닫기' : '보기'}</button> : <span className={row.reason ? 'text-amber-800' : 'text-gray-400'}>{row.reason || '-'}</span>}</td></tr>{expanded && <tr className="bg-blue-50/70"><td colSpan={9} className="px-5 py-4"><div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">{changes.map(([label, before, after]) => <div key={label} className="border border-blue-200 bg-white p-3"><p className="text-xs font-bold text-gray-500">{label}</p><p className="mt-1 text-sm"><span className="text-red-600 line-through">{formatDiff(label, before)}</span><span className="mx-2 text-gray-400">→</span><strong className="text-emerald-700">{formatDiff(label, after)}</strong></p></div>)}</div></td></tr>}</Fragment>;
      })}{filteredRows.length === 0 && <tr><td colSpan={9} className="p-10 text-center text-gray-500">해당 상태의 행이 없습니다.</td></tr>}</tbody></table></div>
      <div className="mt-4 border border-gray-200 bg-white p-4 text-xs text-gray-500"><strong className="text-gray-700">처리 범위:</strong> 원본 파일은 업로드하거나 저장하지 않습니다. 팀명, 분류, 성명, 연락처, 업체명, 수수료율, 전기사용량만 비교하며 은행·전자팩스 정보는 읽거나 전송하지 않습니다.</div>
    </section>}

    {confirmOpen && <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/45 px-4" role="dialog" aria-modal="true" aria-labelledby="apply-title">
      <div className="w-full max-w-md border border-gray-200 bg-white p-6 shadow-xl">
        <h2 id="apply-title" className="text-lg font-bold text-gray-950">팀 DB 반영 확인</h2>
        <p className="mt-2 text-sm text-gray-600">검토한 Excel 변경사항을 실제 팀 데이터에 반영합니다.</p>
        <dl className="mt-5 grid grid-cols-2 gap-3"><div className="border border-gray-200 bg-gray-50 p-3"><dt className="text-xs font-bold text-gray-500">신규</dt><dd className="mt-1 text-xl font-bold text-emerald-700">{summary.new}건</dd></div><div className="border border-gray-200 bg-gray-50 p-3"><dt className="text-xs font-bold text-gray-500">변경</dt><dd className="mt-1 text-xl font-bold text-blue-700">{summary.changed}건</dd></div></dl>
        <p className="mt-4 text-sm font-bold">총 {applicableCount}건을 반영하시겠습니까?</p>
        <p className="mt-2 text-xs text-amber-700">중복 후보와 확인 필요 항목은 반영되지 않습니다.</p>
        <div className="mt-6 flex justify-end gap-2"><button type="button" disabled={applying} onClick={() => setConfirmOpen(false)} className="border border-gray-300 bg-white px-4 py-2 text-sm font-bold text-gray-700">취소</button><button type="button" disabled={applying} onClick={applyChanges} className="bg-emerald-800 px-4 py-2 text-sm font-bold text-white disabled:opacity-60">{applying ? '반영 중...' : `${applicableCount}건 반영`}</button></div>
      </div>
    </div>}
  </div>;
}

function Metric({ label, value, warning = false }: { label: string; value: string; warning?: boolean }) { return <div className="border border-gray-200 bg-white p-4"><p className="text-xs font-bold text-gray-500">{label}</p><p className={`mt-2 text-2xl font-bold ${warning ? 'text-amber-700' : 'text-gray-950'}`}>{value}</p></div>; }
function FlowStep({ number, title, description }: { number: string; title: string; description: string }) { return <div className="flex gap-3"><span className="flex h-8 w-8 shrink-0 items-center justify-center bg-emerald-100 text-sm font-bold text-emerald-800">{number}</span><div><p className="font-bold">{title}</p><p className="mt-0.5 text-xs text-gray-500">{description}</p></div></div>; }
function SummaryCard({ label, value, active, onClick }: { label: string; value: number; active: boolean; onClick: () => void }) { return <button type="button" onClick={onClick} className={`border p-4 text-left ${active ? 'border-emerald-700 bg-emerald-50' : 'border-gray-200 bg-white'}`}><p className="text-xs font-bold text-gray-500">{label}</p><p className="mt-1 text-xl font-bold">{value}건</p></button>; }
