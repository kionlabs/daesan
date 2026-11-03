'use client';

import { useState, useEffect, use } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { supabase } from '@/lib/supabase/client';
import MediaUpload from '@/components/MediaUpload';

interface PlanItem {
  month: string; // 예: "2026-09"
  plan: string;  // 해당 월의 계획 텍스트
}

interface Staff {
  id: string;
  name: string;
  contact: string;
  long_term_plan: PlanItem[];
  admin_notes?: string;
  video_url?: string;
  created_at: string;
}

interface Market {
  id: string;
  market_name: string;
}

interface StaffScheduleItem {
  id: string;
  schedule_date?: string;
  start_date?: string;
  end_date?: string;
  business_type: string;
  market_id: string;
  market_name: string;
}

interface StaffRevenueItem {
  id?: string;
  staff_id: string;
  market_id?: string | null;
  year: number;
  week_number: number;
  period_text?: string;
  revenue_amount: number;
}

// PromiseLike 지원 5초 타임아웃 헬퍼
const fetchWithTimeout = async <T,>(promise: PromiseLike<T>, timeoutMs = 5000): Promise<T> => {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(new Error('네트워크 연결 시간 초과 (Supabase 응답 없음)'));
    }, timeoutMs);

    promise.then(
      (res) => {
        clearTimeout(timeoutId);
        resolve(res);
      },
      (err) => {
        clearTimeout(timeoutId);
        reject(err);
      }
    );
  });
};

// 52주차별 기간 정보 계산 헬퍼 (연도 1월 1일부터 7일간 계산)
const getWeekPeriodInfo = (year: number, weekNum: number) => {
  const startDate = new Date(year, 0, 1 + (weekNum - 1) * 7);
  const endDate = new Date(year, 0, (weekNum - 1) * 7 + 7);

  const startStr = `${startDate.getFullYear()}-${String(startDate.getMonth() + 1).padStart(2, '0')}-${String(startDate.getDate()).padStart(2, '0')}`;
  const endStr = `${endDate.getFullYear()}-${String(endDate.getMonth() + 1).padStart(2, '0')}-${String(endDate.getDate()).padStart(2, '0')}`;

  const periodText = `${String(startDate.getMonth() + 1).padStart(2, '0')}.${String(startDate.getDate()).padStart(2, '0')} ~ ${String(endDate.getMonth() + 1).padStart(2, '0')}.${String(endDate.getDate()).padStart(2, '0')}`;

  return {
    startDate,
    endDate,
    startStr,
    endStr,
    periodText,
    startMonth: startDate.getMonth() + 1,
    endMonth: endDate.getMonth() + 1,
  };
};

const REVENUE_SQL_SCRIPT = `CREATE TABLE IF NOT EXISTS daesan.revenues (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    staff_id UUID NOT NULL REFERENCES daesan.staffs(id) ON DELETE CASCADE,
    market_id UUID REFERENCES daesan.markets(id) ON DELETE SET NULL,
    year INTEGER NOT NULL,
    week_number INTEGER NOT NULL CHECK (week_number BETWEEN 1 AND 53),
    period_text TEXT,
    revenue_amount INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    CONSTRAINT unique_staff_year_week UNIQUE (staff_id, year, week_number)
);

ALTER TABLE daesan.revenues ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins_manage_revenues" ON daesan.revenues FOR ALL TO authenticated
USING ((SELECT private.is_admin())) WITH CHECK ((SELECT private.is_admin()));`;

export default function StaffDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = use(params);
  const id = resolvedParams.id;
  const router = useRouter();

  // 상단 탭 상태 ('profile' | 'revenue')
  const [activeTab, setActiveTab] = useState<'profile' | 'revenue'>('profile');

  const [staff, setStaff] = useState<Staff | null>(null);
  const [markets, setMarkets] = useState<Market[]>([]);
  const [staffSchedules, setStaffSchedules] = useState<StaffScheduleItem[]>([]);
  const [revenues, setRevenues] = useState<StaffRevenueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 기본 정보 편집 상태
  const [name, setName] = useState('');
  const [contact, setContact] = useState('');
  const [adminNotes, setAdminNotes] = useState('');
  const [videoUrl, setVideoUrl] = useState('');
  const [longTermPlan, setLongTermPlan] = useState<PlanItem[]>([]);

  // 달력 뷰 연월 상태 (기본값: 현재 연월)
  const today = new Date();
  const [viewYear, setViewYear] = useState<number>(today.getFullYear());
  const [viewMonth, setViewMonth] = useState<number>(today.getMonth()); // 0 ~ 11

  // 향후 6개월 대상 목록 (YYYY-MM)
  const [targetMonths, setTargetMonths] = useState<string[]>([]);

  // 일정 등록 & 기간 설정 모달 상태
  const [isScheduleModalOpen, setIsScheduleModalOpen] = useState(false);
  const [modalDateStr, setModalDateStr] = useState('');
  const [modalStartDate, setModalStartDate] = useState('');
  const [modalEndDate, setModalEndDate] = useState('');
  const [modalMarketId, setModalMarketId] = useState('');
  const [modalBusinessType, setModalBusinessType] = useState('땅콩빵');
  const [modalSaving, setModalSaving] = useState(false);

  // ==========================================
  // 💰 매출 관리 (52주 정산) 상태
  // ==========================================
  const [revenueYear, setRevenueYear] = useState<number>(today.getFullYear());
  const [revenueInputs, setRevenueInputs] = useState<Record<number, string>>({});
  const [revenueSavingWeek, setRevenueSavingWeek] = useState<number | null>(null);
  const [revenueSavingAll, setRevenueSavingAll] = useState<boolean>(false);
  const [showDbMissingNotice, setShowDbMissingNotice] = useState<boolean>(false);

  // 날짜 포맷 (YYYY-MM-DD)
  const formatDate = (date: Date): string => {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  };

  useEffect(() => {
    // 향후 6개월 목록 생성
    const months = [];
    const date = new Date();
    for (let i = 0; i < 6; i++) {
      const y = date.getFullYear();
      const m = String(date.getMonth() + 1).padStart(2, '0');
      months.push(`${y}-${m}`);
      date.setMonth(date.getMonth() + 1);
    }
    setTargetMonths(months);

    fetchStaffData();
  }, [id, revenueYear]);

  const fetchStaffData = async () => {
    setLoading(true);
    setError(null);
    try {
      // 1. 직원 기본 프로필 조회
      const staffPromise = supabase
        .from('staffs')
        .select('*')
        .eq('id', id)
        .single();

      // 2. 전체 마트 목록 조회
      const marketsPromise = supabase
        .from('markets')
        .select('id, market_name');

      // 3. 직원의 배정 스케줄 목록 조회 (마트 조인)
      const schedulesPromise = supabase
        .from('schedules')
        .select(`
          id,
          schedule_date,
          start_date,
          end_date,
          business_type,
          market_id,
          markets (
            market_name
          )
        `)
        .eq('staff_id', id);

      const [staffRes, marketsRes, schedulesRes] = await Promise.all([
        fetchWithTimeout(staffPromise),
        fetchWithTimeout(marketsPromise),
        fetchWithTimeout(schedulesPromise),
      ]);

      if (staffRes.error) throw staffRes.error;

      if (staffRes.data) {
        const data = staffRes.data;
        setStaff(data);
        setName(data.name);
        setContact(data.contact);
        setAdminNotes(data.admin_notes || '');
        setVideoUrl(data.video_url || '');

        const parsedPlan = Array.isArray(data.long_term_plan) ? data.long_term_plan : [];
        setLongTermPlan(parsedPlan);
      }

      if (marketsRes.data) {
        setMarkets(marketsRes.data || []);
        if (marketsRes.data.length > 0 && !modalMarketId) {
          setModalMarketId(marketsRes.data[0].id);
        }
      }

      // 스케줄 데이터 파싱
      if (schedulesRes.data) {
        const formatted: StaffScheduleItem[] = (schedulesRes.data || []).map((s: any) => ({
          id: s.id,
          schedule_date: s.schedule_date,
          start_date: s.start_date || s.schedule_date,
          end_date: s.end_date || s.schedule_date || s.start_date,
          business_type: s.business_type,
          market_id: s.market_id,
          market_name: Array.isArray(s.markets)
            ? s.markets[0]?.market_name || '마트'
            : s.markets?.market_name || '마트',
        }));
        setStaffSchedules(formatted);
      }

      // 4. 52주 매출 데이터 조회 (Supabase 우선, 실패 시 localStorage 폴백)
      let fetchedRevenues: StaffRevenueItem[] = [];
      let isDbError = false;

      try {
        const revenuesPromise = supabase
          .from('revenues')
          .select('*')
          .eq('staff_id', id)
          .eq('year', revenueYear);

        const revRes = await fetchWithTimeout(revenuesPromise, 3000);
        if (revRes.data && !revRes.error) {
          fetchedRevenues = revRes.data;
        } else if (revRes.error) {
          isDbError = true;
        }
      } catch (revErr) {
        console.warn('Revenues table query skipped or table not created yet:', revErr);
        isDbError = true;
      }

      // DB 조회 실패 또는 미생성 시 localStroage에서 보완
      if (isDbError) {
        setShowDbMissingNotice(true);
        const localDataStr = typeof window !== 'undefined' ? localStorage.getItem(`hrmm_revenues_${id}_${revenueYear}`) : null;
        if (localDataStr) {
          try {
            fetchedRevenues = JSON.parse(localDataStr);
          } catch (e) {
            console.error('Failed to parse local revenue data:', e);
          }
        }
      }

      setRevenues(fetchedRevenues);
      const inputMap: Record<number, string> = {};
      fetchedRevenues.forEach((r: StaffRevenueItem) => {
        if (r.week_number) {
          inputMap[r.week_number] = String(r.revenue_amount || 0);
        }
      });
      setRevenueInputs(inputMap);

    } catch (err: any) {
      console.error('Error fetching staff detail:', err);
      setError('직원 정보를 불러오는 중 오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  };

  // 장기 일정 플랜 변경 헬퍼
  const getPlanForMonth = (monthStr: string) => {
    const item = longTermPlan.find((p) => p.month === monthStr);
    return item ? item.plan : '';
  };

  const handlePlanChange = (monthStr: string, planText: string) => {
    setLongTermPlan((prev) => {
      const filtered = prev.filter((p) => p.month !== monthStr);
      return [...filtered, { month: monthStr, plan: planText }].sort((a, b) =>
        a.month.localeCompare(b.month)
      );
    });
  };

  // 프로필 및 장기 계획 저장
  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || !contact) {
      alert('이름과 연락처는 필수 항목입니다.');
      return;
    }

    setSaving(true);
    try {
      const updatePromise = supabase
        .from('staffs')
        .update({
          name,
          contact,
          admin_notes: adminNotes || null,
          video_url: videoUrl || null,
          long_term_plan: longTermPlan,
        })
        .eq('id', id);

      const { error: updateError } = await fetchWithTimeout(updatePromise, 5000);
      if (updateError) throw updateError;

      alert('직원 프로필 및 장기 일정이 정상적으로 수정 저장되었습니다.');
      fetchStaffData();
    } catch (err: any) {
      console.error('Error updating staff:', err);
      alert(`저장 실패: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  // 직원 삭제
  const handleDelete = async () => {
    if (!window.confirm('정말로 이 직원을 삭제하시겠습니까? 관련 스케줄 정보도 함께 삭제됩니다.')) {
      return;
    }

    try {
      const deletePromise = supabase
        .from('staffs')
        .delete()
        .eq('id', id);

      const { error: deleteError } = await fetchWithTimeout(deletePromise, 5000);
      if (deleteError) throw deleteError;

      alert('성공적으로 삭제되었습니다.');
      router.push('/staffs');
    } catch (err: any) {
      console.error('Error deleting staff:', err);
      alert(`삭제 실패: ${err.message}`);
    }
  };

  // 달력 날짜 클릭 시 일정 등록 모달 열기
  const handleDayCellClick = (dateStr: string) => {
    setModalDateStr(dateStr);
    setModalStartDate(dateStr);
    setModalEndDate(dateStr);
    if (markets.length > 0 && !modalMarketId) {
      setModalMarketId(markets[0].id);
    }
    setIsScheduleModalOpen(true);
  };

  // 기간 기반 일정 일괄 배정 생성 (Batch Insert)
  const handleCreateScheduleBatch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!modalMarketId || !modalStartDate || !modalEndDate) {
      alert('마트와 기간(시작일/종료일)을 정확히 입력해 주세요.');
      return;
    }

    const start = new Date(modalStartDate);
    const end = new Date(modalEndDate);
    if (start > end) {
      alert('종료일은 시작일보다 이전일 수 없습니다.');
      return;
    }

    // 단 1개의 레코드(Row)로 기간 스케줄 저장 (start_date ~ end_date)
    const scheduleRow = {
      staff_id: id,
      market_id: modalMarketId,
      start_date: modalStartDate,
      end_date: modalEndDate,
      schedule_date: modalStartDate,
      business_type: modalBusinessType,
    };

    setModalSaving(true);
    try {
      const insertPromise = supabase.from('schedules').insert([scheduleRow]);
      const { error: insertError } = await fetchWithTimeout(insertPromise, 5000);
      if (insertError) throw insertError;

      alert(`근무 기간 일정 (${modalStartDate} ~ ${modalEndDate}) 1건이 성공적으로 배정 등록되었습니다!`);
      setIsScheduleModalOpen(false);
      fetchStaffData();
    } catch (err: any) {
      console.error('Schedule create error:', err);
      alert(`일정 등록 실패: ${err.message}`);
    } finally {
      setModalSaving(false);
    }
  };

  // 기존 일정 개별 삭제 (배정 취소)
  const handleUnassignSchedule = async (scheduleId: string) => {
    if (!window.confirm('이 마트 근무 스케줄을 삭제하시겠습니까?')) return;

    try {
      const deletePromise = supabase.from('schedules').delete().eq('id', scheduleId);
      const { error: deleteError } = await fetchWithTimeout(deletePromise, 5000);
      if (deleteError) throw deleteError;

      fetchStaffData();
    } catch (err: any) {
      console.error('Error unassigning schedule:', err);
      alert(`삭제 실패: ${err.message}`);
    }
  };

  // 달력 연월 이동
  const handlePrevMonth = () => {
    if (viewMonth === 0) {
      setViewYear(viewYear - 1);
      setViewMonth(11);
    } else {
      setViewMonth(viewMonth - 1);
    }
  };

  const handleNextMonth = () => {
    if (viewMonth === 11) {
      setViewYear(viewYear + 1);
      setViewMonth(0);
    } else {
      setViewMonth(viewMonth + 1);
    }
  };

  const handleTodayMonth = () => {
    const now = new Date();
    setViewYear(now.getFullYear());
    setViewMonth(now.getMonth());
  };

  // 달력 그리드 일자 연산
  const getCalendarDays = () => {
    const firstDay = new Date(viewYear, viewMonth, 1);
    const startDayOfWeek = firstDay.getDay(); // 0(일) ~ 6(토)
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();

    const days = [];
    for (let i = 0; i < startDayOfWeek; i++) {
      days.push(null);
    }
    for (let d = 1; d <= daysInMonth; d++) {
      days.push(d);
    }
    return days;
  };

  const calendarDays = getCalendarDays();
  const currentViewMonthStr = `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}`;

  // ==========================================
  // 💰 매출 저장 & 집계 핸들러 (localStorage + Supabase 하이브리드)
  // ==========================================
  const handleRevenueInputChange = (weekNum: number, value: string) => {
    const sanitized = value.replace(/[^0-9]/g, '');
    setRevenueInputs((prev) => ({
      ...prev,
      [weekNum]: sanitized,
    }));
  };

  const handleSaveWeekRevenue = async (weekNum: number) => {
    const amountStr = revenueInputs[weekNum] || '0';
    const amount = parseInt(amountStr, 10) || 0;
    const weekInfo = getWeekPeriodInfo(revenueYear, weekNum);

    const matchedSchedule = staffSchedules.find((s) => {
      const start = s.start_date || s.schedule_date || '';
      const end = s.end_date || s.schedule_date || start;
      return start && end && !(end < weekInfo.startStr || start > weekInfo.endStr);
    });
    const marketId = matchedSchedule ? matchedSchedule.market_id : null;

    setRevenueSavingWeek(weekNum);

    const newItem: StaffRevenueItem = {
      staff_id: id,
      year: revenueYear,
      week_number: weekNum,
      period_text: weekInfo.periodText,
      revenue_amount: amount,
      market_id: marketId,
    };

    // 1. 로컬 상태 및 localStorage 즉시 반영 (실패 없는 UX 보장)
    setRevenues((prev) => {
      const idx = prev.findIndex((r) => r.year === revenueYear && r.week_number === weekNum);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = newItem;
        return next;
      }
      return [...prev, newItem];
    });

    try {
      const localKey = `hrmm_revenues_${id}_${revenueYear}`;
      const existingStr = localStorage.getItem(localKey);
      let localArr: StaffRevenueItem[] = existingStr ? JSON.parse(existingStr) : [];
      const idx = localArr.findIndex((r) => r.week_number === weekNum);
      if (idx >= 0) localArr[idx] = newItem;
      else localArr.push(newItem);
      localStorage.setItem(localKey, JSON.stringify(localArr));
    } catch (e) {
      console.warn('LocalStorage save error:', e);
    }

    // 2. Supabase DB Upsert 시도
    try {
      const upsertPromise = supabase.from('revenues').upsert(
        {
          staff_id: id,
          year: revenueYear,
          week_number: weekNum,
          period_text: weekInfo.periodText,
          revenue_amount: amount,
          market_id: marketId,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'staff_id,year,week_number' }
      );

      const { error: upsertError } = await fetchWithTimeout(upsertPromise, 4000);

      if (upsertError) {
        setShowDbMissingNotice(true);
        alert(`${weekNum}주차 매출(${amount.toLocaleString()}원)이 로컬에 저장되었습니다.\n(※ Supabase DB에 daesan.revenues 테이블 생성이 필요합니다. 상단 SQL을 실행해 주세요.)`);
      } else {
        alert(`${weekNum}주차 매출(${amount.toLocaleString()}원)이 DB에 성공적으로 저장되었습니다.`);
      }
    } catch (err: any) {
      setShowDbMissingNotice(true);
      alert(`${weekNum}주차 매출(${amount.toLocaleString()}원)이 로컬에 안전하게 저장되었습니다.\n(※ Supabase DB 생성을 위한 SQL 가이드가 상단에 표시됩니다.)`);
    } finally {
      setRevenueSavingWeek(null);
    }
  };

  // 52주 전체 일괄 저장
  const handleSaveAllRevenues = async () => {
    setRevenueSavingAll(true);
    const upsertRows: StaffRevenueItem[] = [];

    for (let w = 1; w <= 52; w++) {
      const valStr = revenueInputs[w] || '0';
      const amount = parseInt(valStr, 10) || 0;
      const weekInfo = getWeekPeriodInfo(revenueYear, w);

      const matchedSchedule = staffSchedules.find((s) => {
        const start = s.start_date || s.schedule_date || '';
        const end = s.end_date || s.schedule_date || start;
        return start && end && !(end < weekInfo.startStr || start > weekInfo.endStr);
      });

      upsertRows.push({
        staff_id: id,
        year: revenueYear,
        week_number: w,
        period_text: weekInfo.periodText,
        revenue_amount: amount,
        market_id: matchedSchedule ? matchedSchedule.market_id : null,
      });
    }

    // 로컬 상태 & localStorage 즉시 저장
    setRevenues(upsertRows);
    try {
      localStorage.setItem(`hrmm_revenues_${id}_${revenueYear}`, JSON.stringify(upsertRows));
    } catch (e) {
      console.warn('LocalStorage bulk save error:', e);
    }

    // Supabase DB 저장 시도
    try {
      const upsertPromise = supabase.from('revenues').upsert(
        upsertRows.map((r) => ({ ...r, updated_at: new Date().toISOString() })),
        { onConflict: 'staff_id,year,week_number' }
      );

      const { error: upsertError } = await fetchWithTimeout(upsertPromise, 6000);

      if (upsertError) {
        setShowDbMissingNotice(true);
        alert(`총 52주차 매출이 로컬 저장소에 일괄 저장되었습니다.\n(※ Supabase DB에 daesan.revenues 테이블을 생성하시면 DB에 완벽히 동기화됩니다.)`);
      } else {
        alert(`총 52주차 매출 데이터가 Supabase DB에 완벽하게 일괄 저장되었습니다!`);
      }
    } catch (err: any) {
      setShowDbMissingNotice(true);
      alert(`총 52주차 매출이 로컬 저장소에 일괄 저장되었습니다.\n(※ Supabase 대시보드 SQL Editor에서 daesan.revenues 테이블 생성을 진행해 주세요.)`);
    } finally {
      setRevenueSavingAll(false);
    }
  };

  // ==========================================
  // 📊 매출 집계 연산 (당월, 연간, 평균, 최고)
  // ==========================================
  const currentMonthNum = today.getMonth() + 1; // 현재 월 (1 ~ 12)

  let monthlyAccumulatedRevenue = 0;
  let annualTotalRevenue = 0;
  let maxWeeklyRevenue = 0;
  let enteredWeeksCount = 0;

  for (let w = 1; w <= 52; w++) {
    const val = parseInt(revenueInputs[w] || '0', 10) || 0;
    const weekInfo = getWeekPeriodInfo(revenueYear, w);

    annualTotalRevenue += val;

    if (val > 0) {
      enteredWeeksCount++;
      if (val > maxWeeklyRevenue) {
        maxWeeklyRevenue = val;
      }
    }

    if (weekInfo.startMonth === currentMonthNum || weekInfo.endMonth === currentMonthNum) {
      monthlyAccumulatedRevenue += val;
    }
  }

  const weeklyAverageRevenue = Math.round(annualTotalRevenue / 52);
  const dailyAverageRevenue = Math.round(annualTotalRevenue / 365);

  if (loading) {
    return (
      <div className="text-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4"></div>
        <p className="text-gray-500 text-sm">직원 상세 정보 및 매출/달력 데이터를 불러오는 중입니다...</p>
      </div>
    );
  }

  if (error || !staff) {
    return (
      <div className="bg-red-50 border-l-4 border-red-400 p-4 rounded-md">
        <p className="text-sm text-red-700 font-semibold">{error || '직원 정보를 찾을 수 없습니다.'}</p>
        <Link href="/staffs" className="text-sm text-blue-600 hover:underline mt-2 inline-block font-semibold">
          &larr; 직원 목록으로 돌아가기
        </Link>
      </div>
    );
  }

  // 선택한 날짜에 이미 배정된 스케줄 목록 (모달용 - 기간 범위 매칭)
  const selectedDateSchedules = staffSchedules.filter((s) => {
    const start = s.start_date || s.schedule_date;
    const end = s.end_date || s.schedule_date || start;
    return start && end && modalDateStr >= start && modalDateStr <= end;
  });

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-12">
      {/* 상단 헤더 영역 */}
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center border-b pb-4 gap-4">
        <div>
          <Link href="/staffs" className="text-xs font-semibold text-blue-600 hover:underline mb-1 inline-block">
            &larr; 직원 목록으로
          </Link>
          <div className="flex items-center space-x-3">
            <h1 className="text-2xl font-extrabold text-blue-600">{staff.name} 직원 상세 관리</h1>
            <span className="text-xs bg-red-100 text-red-800 font-bold px-2.5 py-1 rounded-full">
              총 {staffSchedules.length}건 배정 완료
            </span>
          </div>
        </div>
        <div className="flex space-x-2">
          <button
            type="button"
            onClick={handleDelete}
            className="px-3.5 py-2 border border-red-300 rounded-md text-xs font-semibold text-red-700 bg-white hover:bg-red-50 cursor-pointer shadow-sm"
          >
            직원 삭제
          </button>
        </div>
      </div>

      {/* ========================================================= */}
      {/* 📌 메인 탭 네비게이션 ([프로필 & 일정 달력] vs [매출 관리 (52주 정산)]) */}
      {/* ========================================================= */}
      <div className="flex border-b border-gray-200 bg-white rounded-t-xl p-1.5 gap-2 shadow-xs">
        <button
          type="button"
          onClick={() => setActiveTab('profile')}
          className={`flex-1 py-3 px-4 rounded-lg font-bold text-sm transition-all flex items-center justify-center gap-2 cursor-pointer ${
            activeTab === 'profile'
              ? 'bg-blue-600 text-white shadow-md'
              : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
          }`}
        >
          <span>👤</span> 프로필 & 일정 달력
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('revenue')}
          className={`flex-1 py-3 px-4 rounded-lg font-bold text-sm transition-all flex items-center justify-center gap-2 cursor-pointer ${
            activeTab === 'revenue'
              ? 'bg-blue-600 text-white shadow-md'
              : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
          }`}
        >
          <span>💰</span> 매출 관리 (52주 정산)
          {annualTotalRevenue > 0 && (
            <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${
              activeTab === 'revenue' ? 'bg-white text-blue-800' : 'bg-blue-100 text-blue-800'
            }`}>
              {annualTotalRevenue.toLocaleString()}원
            </span>
          )}
        </button>
      </div>

      {/* ========================================================= */}
      {/* TAB 1: 프로필 & 일정 달력 뷰 */}
      {/* ========================================================= */}
      {activeTab === 'profile' && (
        <form onSubmit={handleUpdate} className="grid grid-cols-1 md:grid-cols-3 gap-6 animate-in fade-in duration-200">
          {/* [좌측 2단 영역 (md:col-span-2)]: 시각적 달력 & 6개월 장기 일정 */}
          <div className="md:col-span-2 space-y-6">
            {/* 1. 시각적 달력 */}
            <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm">
              <div className="flex flex-col sm:flex-row justify-between items-center border-b pb-4 mb-4 gap-3">
                <div>
                  <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                    <span>📅</span> 근무 배정 및 일정 달력
                  </h2>
                  <div className="flex items-center space-x-3 mt-1 text-xs">
                    <span className="inline-flex items-center gap-1 font-semibold text-red-700">
                      <span className="w-3 h-3 bg-red-100 border border-red-300 rounded"></span>
                      일이 있는 일정 (빨간색 음영)
                    </span>
                    <span className="inline-flex items-center gap-1 font-semibold text-blue-700">
                      <span className="w-3 h-3 bg-blue-50 border border-blue-200 rounded"></span>
                      일이 없는 일정 (파란색 음영)
                    </span>
                  </div>
                </div>

                {/* 월 조작 버튼 */}
                <div className="flex items-center space-x-2 bg-gray-50 p-1 rounded-lg border border-gray-200">
                  <button
                    type="button"
                    onClick={handlePrevMonth}
                    className="px-2.5 py-1 text-xs font-bold text-gray-700 hover:bg-white rounded cursor-pointer transition-colors"
                  >
                    &larr; 이전 달
                  </button>
                  <span className="text-xs font-extrabold text-blue-700 px-2">
                    {viewYear}년 {viewMonth + 1}월
                  </span>
                  <button
                    type="button"
                    onClick={handleTodayMonth}
                    className="px-2 py-1 text-[11px] font-semibold text-blue-600 bg-blue-50 hover:bg-blue-100 rounded cursor-pointer"
                  >
                    오늘
                  </button>
                  <button
                    type="button"
                    onClick={handleNextMonth}
                    className="px-2.5 py-1 text-xs font-bold text-gray-700 hover:bg-white rounded cursor-pointer transition-colors"
                  >
                    다음 달 &rarr;
                  </button>
                </div>
              </div>

              <p className="text-xs text-gray-500 mb-3">
                💡 **날짜 칸을 클릭**하면 팝업에서 마트를 선택하고 일하는 기간을 설정해 일정을 등록할 수 있습니다.
              </p>

              {/* 달력 그리드 테이블 */}
              <div className="overflow-x-auto">
                <div className="min-w-[600px]">
                  <div className="grid grid-cols-7 gap-1 text-center font-bold text-xs text-gray-600 bg-gray-50 p-2 rounded-t-lg border border-gray-200">
                    <span className="text-red-500">일</span>
                    <span>월</span>
                    <span>화</span>
                    <span>수</span>
                    <span>목</span>
                    <span>금</span>
                    <span className="text-blue-600">토</span>
                  </div>

                  <div className="grid grid-cols-7 gap-1 border-x border-b border-gray-200 p-1 bg-gray-100/50 rounded-b-lg">
                    {calendarDays.map((dayNum, idx) => {
                      if (dayNum === null) {
                        return <div key={`empty-${idx}`} className="h-24 bg-gray-50/50 rounded border border-transparent"></div>;
                      }

                      const dateStr = `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;
                      const daySchedules = staffSchedules.filter((s) => {
                        const start = s.start_date || s.schedule_date;
                        const end = s.end_date || s.schedule_date || start;
                        return start && end && dateStr >= start && dateStr <= end;
                      });
                      const hasWork = daySchedules.length > 0;
                      const isToday = dateStr === `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
                      const dayOfWeekIdx = idx % 7;
                      const isSun = dayOfWeekIdx === 0;
                      const isSat = dayOfWeekIdx === 6;

                      return (
                        <div
                          key={dateStr}
                          onClick={() => handleDayCellClick(dateStr)}
                          className={`h-24 p-1.5 rounded border flex flex-col justify-between transition-all select-none cursor-pointer ${
                            hasWork
                              ? 'bg-red-50/80 border-2 border-red-300 hover:bg-red-100/90 shadow-2xs'
                              : 'bg-blue-50/40 border border-blue-100 hover:bg-blue-100/50'
                          } ${isToday ? 'ring-2 ring-blue-500 ring-offset-1 font-extrabold' : ''}`}
                          title="클릭하여 마트 일정 배정 및 기간 설정"
                        >
                          <div className="flex justify-between items-center">
                            <span
                              className={`text-xs font-bold ${
                                isToday
                                  ? 'bg-blue-600 text-white rounded-full w-5 h-5 flex items-center justify-center'
                                  : hasWork
                                  ? 'text-red-700 font-extrabold'
                                  : isSun
                                  ? 'text-red-500'
                                  : isSat
                                  ? 'text-blue-600'
                                  : 'text-gray-700'
                              }`}
                            >
                              {dayNum}
                            </span>
                            {hasWork ? (
                              <span className="text-[9px] bg-red-600 text-white font-bold px-1.5 py-0.5 rounded-full shadow-2xs">
                                근무 {daySchedules.length}건
                              </span>
                            ) : (
                              <span className="text-[8px] text-blue-400 opacity-60">
                                +등록
                              </span>
                            )}
                          </div>

                          <div className="space-y-1 overflow-y-auto max-h-16 my-0.5">
                            {daySchedules.map((sch) => (
                              <div
                                key={sch.id}
                                className="text-[9px] bg-white border border-red-200 text-red-950 rounded p-1 font-bold leading-tight shadow-2xs truncate"
                                title={`${sch.market_name} (${sch.business_type})`}
                              >
                                🏪 {sch.market_name}
                                <div className="text-[8px] text-red-700 font-normal">{sch.business_type}</div>
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

              {getPlanForMonth(currentViewMonthStr) && (
                <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-lg text-xs text-blue-900 flex items-start gap-2">
                  <span className="text-base">💡</span>
                  <div>
                    <span className="font-bold">{currentViewMonthStr}월 장기 일정 메모: </span>
                    <span>{getPlanForMonth(currentViewMonthStr)}</span>
                  </div>
                </div>
              )}
            </div>

            {/* 2. 향후 6개월 장기 일정 계획 통합 폼 */}
            <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm space-y-4">
              <div className="border-b pb-3">
                <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                  <span>📝</span> 향후 6개월 장기 일정 및 근무 희망계획
                </h2>
                <p className="text-xs text-gray-500 mt-0.5">
                  직원의 장기 근무 가능 지역, 희망 휴무일 또는 특이 스케줄을 월별로 입력해 관리합니다.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {targetMonths.map((monthStr) => (
                  <div key={monthStr} className="p-3 bg-gray-50 border border-gray-200 rounded-lg space-y-1.5">
                    <div className="flex justify-between items-center">
                      <label className="text-xs font-extrabold text-blue-700">{monthStr} 월간 계획</label>
                      <span className="text-[10px] text-gray-400">
                        {monthStr === currentViewMonthStr ? '● 현재 조회 중' : ''}
                      </span>
                    </div>
                    <input
                      type="text"
                      value={getPlanForMonth(monthStr)}
                      onChange={(e) => handlePlanChange(monthStr, e.target.value)}
                      placeholder="예: 서울 서초 선호, 셋째주 주말 휴무 희망 등"
                      className="w-full border border-gray-300 rounded-md px-3 py-1.5 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* [우측 1단 영역 (md:col-span-1)]: 직원 프로필 기본 정보 편집 */}
          <div className="md:col-span-1 space-y-6">
            <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm space-y-5">
              <h2 className="text-lg font-bold text-gray-900 border-b pb-3 flex items-center gap-2">
                <span>👤</span> 직원 프로필 기본 정보
              </h2>

              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1">성명</label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1">연락처</label>
                <input
                  type="text"
                  required
                  value={contact}
                  onChange={(e) => setContact(e.target.value)}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-700 mb-2">활동 증빙 영상 첨부</label>
                {videoUrl ? (
                  <div className="mb-3 space-y-1">
                    <p className="text-[11px] font-semibold text-blue-700">현재 등록된 동영상:</p>
                    <video src={videoUrl} controls className="w-full max-h-48 rounded-lg border bg-black object-cover" />
                  </div>
                ) : (
                  <p className="text-[11px] text-gray-400 mb-2">등록된 동영상이 없습니다.</p>
                )}
                <MediaUpload
                  onUploadComplete={(url) => setVideoUrl(url)}
                  accept="video/*"
                  maxDurationSeconds={12}
                  theme="blue"
                  label="새 활동 동영상 업로드 (최대 10초)"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1">
                  관리자 특이사항 메모 <span className="text-red-500 font-normal">(비공개)</span>
                </label>
                <textarea
                  value={adminNotes}
                  onChange={(e) => setAdminNotes(e.target.value)}
                  placeholder="예: 시간 약속 철저함, 숙련자, 특정 마트 선호 등 관리자 전용 메모"
                  rows={4}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>

              <div className="pt-2">
                <button
                  type="submit"
                  disabled={saving}
                  className="w-full py-2.5 px-4 bg-blue-600 hover:bg-blue-700 text-white font-bold text-sm rounded-md shadow-sm disabled:opacity-50 transition-colors cursor-pointer"
                >
                  {saving ? '프로필 저장 중...' : '프로필 & 일정 저장'}
                </button>
              </div>
            </div>
          </div>
        </form>
      )}

      {/* ========================================================= */}
      {/* TAB 2: 매출 관리 (52주 정산) 뷰 */}
      {/* ========================================================= */}
      {activeTab === 'revenue' && (
        <div className="space-y-6 animate-in fade-in duration-200">
          {/* Supabase DB 설치 안내 배너 (DB 미설치 시 자동 표시) */}
          {showDbMissingNotice && (
            <div className="bg-amber-50 border-l-4 border-amber-500 p-4 rounded-xl shadow-xs space-y-2.5">
              <div className="flex justify-between items-start">
                <div className="flex items-center gap-2 font-extrabold text-amber-900 text-sm">
                  <span>⚠️</span>
                  <span>Supabase 데이터베이스 (`daesan.revenues`) 1초 설치 안내</span>
                </div>
                <button
                  type="button"
                  onClick={() => setShowDbMissingNotice(false)}
                  className="text-amber-700 hover:text-amber-950 font-bold text-xs cursor-pointer"
                >
                  닫기 ✕
                </button>
              </div>
              <p className="text-xs text-amber-800 leading-relaxed">
                현재 Supabase DB에 <code className="bg-amber-100 px-1.5 py-0.5 rounded font-mono text-amber-900 font-bold">daesan.revenues</code> 테이블이 아직 생성되지 않아 입력하신 매출이 <strong>브라우저 내(localStorage)에 안전하게 임시 저장</strong>되고 있습니다.
                원격 데이터베이스로의 완전한 저장 및 동기화를 위해, 아래 버튼을 눌러 SQL을 복사한 후 <strong>Supabase 대시보드 &gt; SQL Editor</strong>에서 실행해 주세요.
              </p>
              <div className="bg-slate-900 text-slate-100 p-3 rounded-lg text-xs font-mono overflow-x-auto relative">
                <pre className="text-[11px] leading-relaxed">{REVENUE_SQL_SCRIPT}</pre>
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(REVENUE_SQL_SCRIPT);
                    alert('Supabase DB 설치 SQL 구문이 클립보드에 복사되었습니다!\nSupabase SQL Editor에 붙여넣어 실행(Run)해 주세요.');
                  }}
                  className="absolute top-2 right-2 bg-amber-400 hover:bg-amber-500 text-slate-950 px-3 py-1 rounded-md font-extrabold text-[11px] cursor-pointer shadow-xs transition-colors"
                >
                  📋 SQL 1초 복사
                </button>
              </div>
            </div>
          )}

          {/* 상단 정산 요약 집계 카드 (Summary - 5개 카드 구성) */}
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-3">
            {/* 1. 당월 누적 매출 */}
            <div className="bg-gradient-to-br from-blue-600 to-blue-700 text-white p-5 rounded-xl shadow-sm space-y-1">
              <div className="flex justify-between items-center text-blue-100 text-xs font-bold">
                <span>💳 {currentMonthNum}월(당월) 누적 매출</span>
                <span className="bg-white/20 px-2 py-0.5 rounded text-[10px]">월간 집계</span>
              </div>
              <div className="text-2xl font-black pt-1">
                {monthlyAccumulatedRevenue.toLocaleString()}<span className="text-base font-normal ml-1">원</span>
              </div>
              <p className="text-[11px] text-blue-200 pt-0.5">
                현재 월에 해당하는 주차들의 실적 합계
              </p>
            </div>

            {/* 2. 연간 총 매출 */}
            <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm space-y-1">
              <div className="flex justify-between items-center text-gray-500 text-xs font-bold">
                <span>🏆 {revenueYear}년 총 누적 매출</span>
                <span className="bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded text-[10px]">52주 총합</span>
              </div>
              <div className="text-2xl font-extrabold text-gray-900 pt-1">
                {annualTotalRevenue.toLocaleString()}<span className="text-base font-normal ml-1">원</span>
              </div>
              <p className="text-[11px] text-gray-400 pt-0.5">
                선택한 연도 전체 주차의 매출 총계
              </p>
            </div>

            {/* 3. 주간 평균 매출 */}
            <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm space-y-1">
              <div className="flex justify-between items-center text-gray-500 text-xs font-bold">
                <span>📊 주간 평균 매출</span>
                <span className="bg-purple-100 text-purple-800 px-2 py-0.5 rounded text-[10px]">주간 평균</span>
              </div>
              <div className="text-2xl font-extrabold text-purple-900 pt-1">
                {weeklyAverageRevenue.toLocaleString()}<span className="text-base font-normal ml-1">원/주</span>
              </div>
              <p className="text-[11px] text-gray-400 pt-0.5">
                52주 기준 1주일당 평균 발생 매출
              </p>
            </div>

            {/* 4. 평균 일매출 */}
            <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm space-y-1">
              <div className="flex justify-between items-center text-gray-500 text-xs font-bold">
                <span>📅 평균 일매출</span>
                <span className="bg-indigo-100 text-indigo-800 px-2 py-0.5 rounded text-[10px]">일일 평균</span>
              </div>
              <div className="text-2xl font-extrabold text-indigo-900 pt-1">
                {dailyAverageRevenue.toLocaleString()}<span className="text-base font-normal ml-1">원/일</span>
              </div>
              <p className="text-[11px] text-gray-400 pt-0.5">
                365일 연간 기준 1일 평균 발생 매출
              </p>
            </div>

            {/* 5. 최고 주간 매출 */}
            <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm space-y-1">
              <div className="flex justify-between items-center text-gray-500 text-xs font-bold">
                <span>🚩 최고 주간 매출</span>
                <span className="bg-amber-100 text-amber-800 px-2 py-0.5 rounded text-[10px]">최고실적</span>
              </div>
              <div className="text-2xl font-extrabold text-amber-600 pt-1">
                {maxWeeklyRevenue.toLocaleString()}<span className="text-base font-normal ml-1">원</span>
              </div>
              <p className="text-[11px] text-gray-400 pt-0.5">
                입력된 주차 중 단일 주차 최대 실적
              </p>
            </div>
          </div>

          {/* 52주 정산 컨트롤 바 (연도 선택 & 전체 저장) */}
          <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm flex flex-col sm:flex-row justify-between items-center gap-4">
            <div className="flex items-center space-x-3">
              <label className="text-sm font-bold text-gray-700">정산 연도 선택:</label>
              <select
                value={revenueYear}
                onChange={(e) => setRevenueYear(Number(e.target.value))}
                className="border border-gray-300 rounded-md px-3 py-1.5 text-sm font-bold text-blue-700 bg-gray-50 focus:ring-1 focus:ring-blue-500"
              >
                <option value={2025}>2025년 (52주 정산)</option>
                <option value={2026}>2026년 (52주 정산)</option>
                <option value={2027}>2027년 (52주 정산)</option>
                <option value={2028}>2028년 (52주 정산)</option>
              </select>
              <span className="text-xs text-gray-500 hidden md:inline">
                * 주차별 매출을 입력하고 [저장] 버튼을 누르면 정산 기록됩니다.
              </span>
            </div>

            <button
              type="button"
              onClick={handleSaveAllRevenues}
              disabled={revenueSavingAll}
              className="w-full sm:w-auto px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-md shadow-sm cursor-pointer disabled:opacity-50 flex items-center justify-center gap-1.5 transition-colors"
            >
              {revenueSavingAll ? '전체 저장 중...' : '💾 52주 매출 전체 일괄 저장'}
            </button>
          </div>

          {/* 52주 정산 데이터 테이블 (Table View) */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            <div className="p-4 border-b bg-gray-50 flex justify-between items-center">
              <h2 className="text-base font-bold text-gray-900 flex items-center gap-2">
                <span>📋</span> [{staff.name}] {revenueYear}년 52주 주간 매출 입력 및 정산표
              </h2>
              <span className="text-xs text-gray-500">
                입력된 주차: <strong className="text-blue-600">{enteredWeeksCount}</strong> / 52 주차
              </span>
            </div>

            <div className="overflow-x-auto max-h-[700px]">
              <table className="w-full text-left text-xs">
                <thead className="bg-gray-100 border-b text-gray-700 font-extrabold sticky top-0 z-10">
                  <tr>
                    <th className="py-3 px-4 w-24">주차</th>
                    <th className="py-3 px-4 w-36">기간</th>
                    <th className="py-3 px-4">담당 마트 (자동 매칭)</th>
                    <th className="py-3 px-4 w-48">매출 입력 금액 (원)</th>
                    <th className="py-3 px-4 w-24 text-center">저장</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {Array.from({ length: 52 }, (_, i) => i + 1).map((weekNum) => {
                    const weekInfo = getWeekPeriodInfo(revenueYear, weekNum);
                    
                    // 해당 주차 범위에 배정된 마트 찾기
                    const matchedSchedules = staffSchedules.filter((s) => {
                      const start = s.start_date || s.schedule_date || '';
                      const end = s.end_date || s.schedule_date || start;
                      return start && end && !(end < weekInfo.startStr || start > weekInfo.endStr);
                    });

                    // unique 마트명 추출
                    const matchedMarketNames = Array.from(
                      new Set(matchedSchedules.map((s) => `${s.market_name} (${s.business_type})`))
                    );

                    const inputValue = revenueInputs[weekNum] || '';
                    const isSavingThisWeek = revenueSavingWeek === weekNum;
                    const isCurrentMonthWeek = weekInfo.startMonth === currentMonthNum || weekInfo.endMonth === currentMonthNum;

                    return (
                      <tr
                        key={weekNum}
                        className={`hover:bg-blue-50/50 transition-colors ${
                          isCurrentMonthWeek ? 'bg-blue-50/20' : ''
                        }`}
                      >
                        {/* 주차 */}
                        <td className="py-2.5 px-4 font-bold text-gray-900">
                          <span className="inline-flex items-center gap-1.5">
                            {weekNum}주차
                            {isCurrentMonthWeek && (
                              <span className="w-2 h-2 rounded-full bg-blue-500" title="당월 주차"></span>
                            )}
                          </span>
                        </td>

                        {/* 기간 */}
                        <td className="py-2.5 px-4 font-mono text-gray-600">
                          {weekInfo.periodText}
                        </td>

                        {/* 담당 마트 */}
                        <td className="py-2.5 px-4">
                          {matchedMarketNames.length > 0 ? (
                            <div className="flex flex-wrap gap-1">
                              {matchedMarketNames.map((name, idx) => (
                                <span
                                  key={idx}
                                  className="bg-red-50 text-red-800 border border-red-200 px-2 py-0.5 rounded text-[10px] font-bold"
                                >
                                  🏪 {name}
                                </span>
                              ))}
                            </div>
                          ) : (
                            <span className="text-gray-400 text-[11px] font-normal">- 미배정 -</span>
                          )}
                        </td>

                        {/* 매출 입력 칸 */}
                        <td className="py-2.5 px-4">
                          <div className="relative max-w-xs">
                            <input
                              type="text"
                              value={inputValue ? Number(inputValue).toLocaleString() : ''}
                              onChange={(e) => handleRevenueInputChange(weekNum, e.target.value)}
                              placeholder="0"
                              className="w-full border border-gray-300 rounded-md pl-3 pr-8 py-1.5 text-xs font-bold text-right text-gray-900 focus:ring-1 focus:ring-blue-500 focus:outline-none bg-white"
                            />
                            <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 text-[11px] pointer-events-none">
                              원
                            </span>
                          </div>
                        </td>

                        {/* 저장 버튼 */}
                        <td className="py-2.5 px-4 text-center">
                          <button
                            type="button"
                            onClick={() => handleSaveWeekRevenue(weekNum)}
                            disabled={isSavingThisWeek}
                            className="px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white font-bold text-[11px] rounded shadow-2xs disabled:opacity-50 cursor-pointer transition-colors"
                          >
                            {isSavingThisWeek ? '저장...' : '저장'}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* 📅 마트 일정 배정 및 일하는 기간 설정 모달 팝업 */}
      {/* ========================================================= */}
      {isScheduleModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-xl max-w-md w-full p-6 shadow-2xl space-y-4 border-2 border-blue-600 animate-in fade-in zoom-in duration-150">
            <div className="flex justify-between items-center border-b pb-3">
              <h3 className="text-base font-bold text-blue-700 flex items-center gap-1.5">
                <span>📅</span> [{staff.name}] 마트 일정 등록 & 기간 설정
              </h3>
              <button
                type="button"
                onClick={() => setIsScheduleModalOpen(false)}
                className="text-gray-400 hover:text-gray-600 text-xl font-bold cursor-pointer"
              >
                &times;
              </button>
            </div>

            {/* 기존 배정 내역이 있을 경우 표시 */}
            {selectedDateSchedules.length > 0 && (
              <div className="bg-red-50 p-3 rounded-lg border border-red-200 space-y-2">
                <p className="text-xs font-bold text-red-900">
                  📍 선택한 날짜 ({modalDateStr}) 기존 배정 내역:
                </p>
                <div className="space-y-1.5">
                  {selectedDateSchedules.map((sch) => (
                    <div key={sch.id} className="flex justify-between items-center bg-white p-2 rounded border border-red-200 text-xs">
                      <div>
                        <span className="font-bold text-red-950">🏪 {sch.market_name}</span>
                        <span className="ml-2 text-red-700 font-semibold">({sch.business_type})</span>
                        <div className="text-[10px] text-gray-500 font-mono mt-0.5">
                          📅 기간: {sch.start_date || sch.schedule_date} ~ {sch.end_date || sch.schedule_date}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleUnassignSchedule(sch.id)}
                        className="text-[10px] bg-red-100 hover:bg-red-200 text-red-800 px-2 py-0.5 rounded font-bold cursor-pointer"
                      >
                        배정 취소
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 새로운 근무 일정 배정 & 기간 설정 폼 */}
            <form onSubmit={handleCreateScheduleBatch} className="space-y-3 pt-1">
              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1">
                  배정 마트 선택
                </label>
                <select
                  value={modalMarketId}
                  onChange={(e) => setModalMarketId(e.target.value)}
                  required
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-xs focus:ring-1 focus:ring-blue-500"
                >
                  {markets.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.market_name}
                    </option>
                  ))}
                  {markets.length === 0 && <option value="">등록된 마트가 없습니다</option>}
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1">
                  업종 선택
                </label>
                <select
                  value={modalBusinessType}
                  onChange={(e) => setModalBusinessType(e.target.value)}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-xs focus:ring-1 focus:ring-blue-500"
                >
                  <option value="땅콩빵">땅콩빵</option>
                  <option value="붕어빵">붕어빵</option>
                  <option value="만두">만두</option>
                  <option value="와플">와플</option>
                  <option value="기타">기타</option>
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3 pt-1">
                <div>
                  <label className="block text-xs font-bold text-gray-700 mb-1">
                    근무 시작일
                  </label>
                  <input
                    type="date"
                    required
                    value={modalStartDate}
                    onChange={(e) => setModalStartDate(e.target.value)}
                    className="w-full border border-gray-300 rounded-md px-2 py-1.5 text-xs focus:ring-1 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-700 mb-1">
                    근무 종료일
                  </label>
                  <input
                    type="date"
                    required
                    value={modalEndDate}
                    onChange={(e) => setModalEndDate(e.target.value)}
                    className="w-full border border-gray-300 rounded-md px-2 py-1.5 text-xs focus:ring-1 focus:ring-blue-500"
                  />
                </div>
              </div>
              <p className="text-[10px] text-gray-500">
                * 시작일부터 종료일까지 매일 일괄 근무 일정이 자동 생성 및 배정됩니다.
              </p>

              <div className="flex justify-end space-x-2 pt-3 border-t">
                <button
                  type="button"
                  onClick={() => setIsScheduleModalOpen(false)}
                  disabled={modalSaving}
                  className="px-3.5 py-1.5 border rounded-md text-xs font-semibold text-gray-700 hover:bg-gray-50 cursor-pointer"
                >
                  취소
                </button>
                <button
                  type="submit"
                  disabled={modalSaving}
                  className="px-4 py-1.5 border border-transparent rounded-md text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 cursor-pointer shadow-sm"
                >
                  {modalSaving ? '등록 중...' : '일정 등록 및 일괄 배정'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
