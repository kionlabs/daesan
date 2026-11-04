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
const formatDiff = (_label: string, value: unknown) => display(value);

type DbTeamRow = {
  id: string; sequenceNumber: string; teamName: string; category: string; memberName: string; contact: string;
  electronicFax: string; bankName: string; companyName: string; commissionRateText: string; powerUsageText: string; commissionRate: number | null;
  powerUsageKw: number | null; duplicateTeamCategory: boolean;
};

const DB_PAGE_SIZE = 50;

export default function TeamsPage() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<ComparedTeamRow[]>([]);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [fileName, setFileName] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | ImportStatus>('all');
  const [expandedRow, setExpandedRow] = useState<number | null>(null);
  const [dbRows, setDbRows] = useState<DbTeamRow[]>([]);
  const [dbSummary, setDbSummary] = useState({ totalRows: 0, uniqueTeams: 0, duplicateTeamCategories: 0 });
  const [dbLoading, setDbLoading] = useState(true);
  const [dbError, setDbError] = useState<string | null>(null);
  const [teamSearch, setTeamSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [dbPage, setDbPage] = useState(1);
  const [selectedRowId, setSelectedRowId] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [applying, setApplying] = useState(false);

  const loadDbTeams = useCallback(async () => {
    setDbLoading(true); setDbError(null);
    try {
      const response = await fetch('/api/teams/compare', { cache: 'no-store' });
      const result = await response.json() as { rows?: DbTeamRow[]; summary?: typeof dbSummary; error?: string };
      if (!response.ok || !result.rows || !result.summary) throw new Error(result.error || '팀 목록을 불러오지 못했습니다.');
      setDbRows(result.rows); setDbSummary(result.summary);
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
  const categories = useMemo(() => Array.from(new Set(dbRows.map((row) => row.category).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'ko')), [dbRows]);
  const visibleDbRows = useMemo(() => {
    const query = teamSearch.trim().toLocaleLowerCase('ko');
    return dbRows.filter((row) => {
      const matchesCategory = categoryFilter === 'all' || row.category === categoryFilter;
      const haystack = [row.sequenceNumber, row.teamName, row.memberName, row.contact, row.companyName].join(' ').toLocaleLowerCase('ko');
      return matchesCategory && (!query || haystack.includes(query));
    });
  }, [categoryFilter, dbRows, teamSearch]);
  const selectedDbRow = dbRows.find((row) => row.id === selectedRowId) || null;
  const dbPageCount = Math.max(1, Math.ceil(visibleDbRows.length / DB_PAGE_SIZE));
  const pagedDbRows = visibleDbRows.slice((dbPage - 1) * DB_PAGE_SIZE, dbPage * DB_PAGE_SIZE);
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
    <PageHeader eyebrow="OPERATIONS" title="팀 관리" description="현재 팀리스트를 확인하고 최신 행사관리 Excel의 변경사항을 비교합니다." action={<label className={`inline-flex cursor-pointer items-center self-start bg-emerald-700 px-4 py-2.5 text-sm font-bold text-white hover:bg-emerald-800 sm:self-auto ${processing ? 'pointer-events-none opacity-60' : ''}`}>{processing ? '파싱 및 비교 중...' : 'Excel 파일 선택'}<input ref={inputRef} type="file" accept=".xlsx,.xlsm" className="hidden" onChange={(event) => handleFile(event.target.files?.[0])} /></label>} />
    {error && <div className="mb-4 border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>}
    {notice && <div className="mb-4 border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">{notice}</div>}

    <section className="mb-6 grid gap-3 sm:grid-cols-3">
      <Metric label="팀리스트 전체 행" value={dbLoading ? '조회 중' : `${dbSummary.totalRows}건`} />
      <Metric label="팀명 기준 팀 수" value={dbLoading ? '조회 중' : `${dbSummary.uniqueTeams}개`} />
      <Metric label="중복 팀·분류" value={dbLoading ? '조회 중' : `${dbSummary.duplicateTeamCategories}개`} />
    </section>

    <section className="mb-6 border border-gray-200 bg-white">
      <div className="border-b border-gray-200 p-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div><h2 className="font-bold text-gray-950">현재 DB 팀리스트</h2><p className="mt-1 text-sm text-gray-500">Excel `팀리스트`의 행 순서와 주요 컬럼을 가공하지 않고 표시합니다.</p></div>
          <div className="grid gap-2 sm:grid-cols-[minmax(220px,1fr)_180px]">
            <input aria-label="팀 검색" value={teamSearch} onChange={(event) => { setTeamSearch(event.target.value); setDbPage(1); }} placeholder="팀명, 성명, 연락처 검색" className="h-10 border border-gray-300 px-3 text-sm outline-none focus:border-emerald-700" />
            <select aria-label="분류 필터" value={categoryFilter} onChange={(event) => { setCategoryFilter(event.target.value); setDbPage(1); }} className="h-10 border border-gray-300 bg-white px-3 text-sm outline-none focus:border-emerald-700"><option value="all">전체 분류</option>{categories.map((category) => <option key={category} value={category}>{category}</option>)}</select>
          </div>
        </div>
      </div>
      {dbError ? <div className="p-8 text-center text-sm text-red-700">{dbError}</div> : dbLoading ? <div className="p-8 text-center text-sm text-gray-500">팀 데이터를 불러오는 중입니다.</div> : <div className="grid min-h-[360px] lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="overflow-x-auto lg:border-r lg:border-gray-200">
          <table className="w-full min-w-[760px] text-sm"><thead className="sticky top-0 bg-gray-50 text-left text-xs text-gray-500"><tr><th className="px-4 py-3">순번</th><th className="px-4 py-3">팀명</th><th className="px-4 py-3">분류</th><th className="px-4 py-3">성명</th><th className="px-4 py-3">연락처</th></tr></thead><tbody className="divide-y divide-gray-100">{pagedDbRows.map((row) => <tr key={row.id} onClick={() => setSelectedRowId(row.id)} className={`cursor-pointer hover:bg-emerald-50 ${selectedRowId === row.id ? 'bg-emerald-50' : ''}`}><td className="px-4 py-3 text-gray-500">{display(row.sequenceNumber)}</td><td className="px-4 py-3 font-bold text-gray-950">{display(row.teamName)}{row.duplicateTeamCategory && <span className="ml-2 text-[10px] font-medium text-amber-700">중복 팀명</span>}</td><td className="px-4 py-3">{display(row.category)}</td><td className="px-4 py-3">{display(row.memberName)}</td><td className="whitespace-nowrap px-4 py-3">{display(row.contact)}</td></tr>)}{visibleDbRows.length === 0 && <tr><td colSpan={5} className="p-10 text-center text-gray-500">검색 조건에 맞는 행이 없습니다.</td></tr>}</tbody></table>
        </div>
        <aside className="p-5">{selectedDbRow ? <><div className="border-b border-gray-200 pb-4"><p className="text-xs font-bold text-emerald-700">선택 행 상세</p><h3 className="mt-1 text-xl font-bold text-gray-950">{display(selectedDbRow.teamName)}</h3><p className="mt-1 text-sm text-gray-500">순번 {display(selectedDbRow.sequenceNumber)} · {display(selectedDbRow.memberName)}</p></div><dl className="mt-5 grid grid-cols-[92px_1fr] gap-x-3 gap-y-4 text-sm"><dt className="text-gray-500">전자팩스</dt><dd>{display(selectedDbRow.electronicFax)}</dd><dt className="text-gray-500">은행명</dt><dd>{display(selectedDbRow.bankName)}</dd><dt className="text-gray-500">업체명</dt><dd>{display(selectedDbRow.companyName)}</dd><dt className="text-gray-500">수수료율</dt><dd>{display(selectedDbRow.commissionRateText)}</dd><dt className="text-gray-500">전기사용량</dt><dd>{display(selectedDbRow.powerUsageText)}</dd></dl><p className="mt-6 border-t border-gray-100 pt-4 text-xs leading-5 text-gray-500">상세 정보는 로그인한 관리자에게만 표시됩니다.</p></> : <div className="flex min-h-[280px] items-center justify-center text-center text-sm text-gray-500">목록에서 한 행을 선택하면<br />추가 정보를 확인할 수 있습니다.</div>}</aside>
      </div>}
      <div className="flex flex-col gap-3 border-t border-gray-200 bg-gray-50 px-5 py-3 text-xs text-gray-500 sm:flex-row sm:items-center sm:justify-between"><span>총 {visibleDbRows.length}개 행 · 페이지당 {DB_PAGE_SIZE}개 · 팀 수는 팀명 중복을 제외해 계산합니다.</span><div className="flex items-center gap-2"><button type="button" disabled={dbPage === 1} onClick={() => setDbPage((page) => Math.max(1, page - 1))} className="border border-gray-300 bg-white px-3 py-1.5 font-bold text-gray-700 disabled:cursor-not-allowed disabled:opacity-40">이전</button><span className="min-w-16 text-center font-bold text-gray-700">{dbPage} / {dbPageCount}</span><button type="button" disabled={dbPage === dbPageCount} onClick={() => setDbPage((page) => Math.min(dbPageCount, page + 1))} className="border border-gray-300 bg-white px-3 py-1.5 font-bold text-gray-700 disabled:cursor-not-allowed disabled:opacity-40">다음</button></div></div>
    </section>

    {rows.length > 0 && <section>
      <div className="mb-3 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between"><div><h2 className="font-bold">실제 비교 결과</h2><p className="text-xs text-gray-500">{fileName} · 변경 행을 누르면 달라진 필드만 확인할 수 있습니다.</p></div><div className="flex items-start gap-2"><button type="button" onClick={resetImport} className="border border-gray-300 bg-white px-4 py-2.5 text-sm font-bold text-gray-700">결과 닫기</button><div className="text-right"><button type="button" disabled={applicableCount === 0 || applying} onClick={() => setConfirmOpen(true)} className="bg-emerald-800 px-5 py-2.5 text-sm font-bold text-white disabled:cursor-not-allowed disabled:bg-gray-300 disabled:text-gray-600">DB 반영</button><p className="mt-1 text-xs font-medium text-gray-500">신규·변경 항목만 반영</p></div></div></div>
      <div className="mb-4 grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
        <SummaryCard label="전체" value={summary.all} active={statusFilter === 'all'} onClick={() => setStatusFilter('all')} />
        <SummaryCard label="신규" value={summary.new} active={statusFilter === 'new'} onClick={() => setStatusFilter('new')} />
        <SummaryCard label="변경" value={summary.changed} active={statusFilter === 'changed'} onClick={() => setStatusFilter('changed')} />
        <SummaryCard label="동일" value={summary.same} active={statusFilter === 'same'} onClick={() => setStatusFilter('same')} />
        <SummaryCard label="중복 후보" value={summary.duplicate} active={statusFilter === 'duplicate'} onClick={() => setStatusFilter('duplicate')} />
        <SummaryCard label="확인 필요" value={summary.review} active={statusFilter === 'review'} onClick={() => setStatusFilter('review')} />
      </div>
      <div className="overflow-x-auto border border-gray-200 bg-white"><table className="w-full min-w-[980px] text-sm"><thead className="bg-gray-50 text-left text-xs text-gray-500"><tr><th className="px-4 py-3">상태</th><th className="px-4 py-3">팀명</th><th className="px-4 py-3">분류</th><th className="px-4 py-3">성명</th><th className="px-4 py-3">연락처</th><th className="px-4 py-3">업체명</th><th className="px-4 py-3">수수료율</th><th className="px-4 py-3">전기사용량</th><th className="px-4 py-3">검토</th></tr></thead><tbody className="divide-y divide-gray-100">{filteredRows.map((row) => {
        const changes = changedFields(row); const expanded = expandedRow === row.rowNumber;
        return <Fragment key={row.rowNumber}><tr className={row.status === 'changed' ? 'cursor-pointer hover:bg-blue-50' : ''} onClick={() => row.status === 'changed' && setExpandedRow(expanded ? null : row.rowNumber)}><td className="px-4 py-3"><StatusBadge tone={statusMeta[row.status].tone}>{statusMeta[row.status].label}</StatusBadge><span className="ml-2 text-[11px] text-gray-400">{row.rowNumber}행</span></td><td className="px-4 py-3 font-bold">{display(row.teamName)}</td><td className="px-4 py-3">{display(row.category)}</td><td className="px-4 py-3">{display(row.memberName)}</td><td className="px-4 py-3">{display(row.contact)}</td><td className="px-4 py-3">{display(row.companyName)}</td><td className="px-4 py-3">{percent(row.commissionRate)}</td><td className="px-4 py-3">{row.powerUsageKw == null ? '-' : `${row.powerUsageKw}kW`}</td><td className="px-4 py-3 text-xs">{row.status === 'changed' ? <button type="button" className="font-bold text-blue-700">{changes.length}개 필드 {expanded ? '닫기' : '보기'}</button> : <span className={row.reason ? 'text-amber-800' : 'text-gray-400'}>{row.reason || '-'}</span>}</td></tr>{expanded && <tr className="bg-blue-50/70"><td colSpan={9} className="px-5 py-4"><div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">{changes.map(([label, before, after]) => <div key={label} className="border border-blue-200 bg-white p-3"><p className="text-xs font-bold text-gray-500">{label}</p><p className="mt-1 text-sm"><span className="text-red-600 line-through">{formatDiff(label, before)}</span><span className="mx-2 text-gray-400">→</span><strong className="text-emerald-700">{formatDiff(label, after)}</strong></p></div>)}</div></td></tr>}</Fragment>;
      })}{filteredRows.length === 0 && <tr><td colSpan={9} className="p-10 text-center text-gray-500">해당 상태의 행이 없습니다.</td></tr>}</tbody></table></div>
      <div className="mt-4 border border-gray-200 bg-white p-4 text-xs text-gray-500"><strong className="text-gray-700">처리 범위:</strong> 원본 파일은 업로드하거나 저장하지 않습니다. `팀리스트`의 10개 컬럼만 브라우저에서 읽어 로그인된 관리자 세션으로 비교하며 매크로는 실행하지 않습니다.</div>
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
function SummaryCard({ label, value, active, onClick }: { label: string; value: number; active: boolean; onClick: () => void }) { return <button type="button" onClick={onClick} className={`border p-4 text-left ${active ? 'border-emerald-700 bg-emerald-50' : 'border-gray-200 bg-white'}`}><p className="text-xs font-bold text-gray-500">{label}</p><p className="mt-1 text-xl font-bold">{value}건</p></button>; }
