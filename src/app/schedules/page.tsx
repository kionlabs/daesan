'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase/client';
import { WorkflowNav } from '@/components/erp-ui';

interface Staff {
  id: string;
  name: string;
  contact: string;
}

interface Market {
  id: string;
  market_name: string;
}

interface Schedule {
  id: string;
  staff_id: string;
  market_id: string;
  schedule_date: string; // YYYY-MM-DD
  business_type: string;
  weekly_revenue?: number;
  status?: string;
  staffs?: Staff; // Joined
}

interface WaitingPoolItem {
  id: string;
  staff_id: string;
  week_start_date: string; // YYYY-MM-DD (월요일)
  status: 'waiting' | 'assigned' | 'completed';
  staffs?: Staff;
}

// PromiseLike(thenable)을 지원하는 5초 타임아웃 헬퍼 함수
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

export default function SchedulesPage() {
  const [baseDate, setBaseDate] = useState<Date>(new Date());
  const [weekDays, setWeekDays] = useState<Date[]>([]);
  
  const [staffs, setStaffs] = useState<Staff[]>([]);
  const [markets, setMarkets] = useState<Market[]>([]);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [waitingPools, setWaitingPools] = useState<WaitingPoolItem[]>([]);
  
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 대기방 주차 탭 선택 ('current': 이번 주, 'next': 다음 주)
  const [activePoolWeek, setActivePoolWeek] = useState<'current' | 'next'>('current');

  // 대기방 상태 필터 ('all': 전체, 'unassigned': 미배정 대기, 'assigned': 배정 완료)
  const [poolFilter, setPoolFilter] = useState<'all' | 'unassigned' | 'assigned'>('all');

  // 모바일 터치 배정 상태 (선택된 대기 직원 ID)
  const [selectedStaffForAssign, setSelectedStaffForAssign] = useState<string | null>(null);

  // 모바일 실시간 터치 드래그 앤 드롭 상태
  const [touchDragInfo, setTouchDragInfo] = useState<{
    type: 'new-staff' | 'existing-schedule';
    id: string;
    label: string;
  } | null>(null);
  const [touchPosition, setTouchPosition] = useState<{ x: number; y: number } | null>(null);

  // 일정 편집 모달 상태
  const [editingSchedule, setEditingSchedule] = useState<Schedule | null>(null);
  const [businessType, setBusinessType] = useState('땅콩빵');
  const [weeklyRevenue, setWeeklyRevenue] = useState<number | ''>('');
  const [selectedStaffId, setSelectedStaffId] = useState('');
  const [selectedMarketId, setSelectedMarketId] = useState('');
  const [selectedDateStr, setSelectedDateStr] = useState('');
  const [editingStaffName, setEditingStaffName] = useState('');
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  // 긴급 배정 팝업 상태 (결원 클릭 시)
  const [emergencyTarget, setEmergencyTarget] = useState<{ marketId: string; dateStr: string; marketName: string } | null>(null);

  // 날짜 포맷 (YYYY-MM-DD)
  const formatDate = (date: Date): string => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  // 주차 일자 계산
  useEffect(() => {
    const currentDay = baseDate.getDay();
    const distance = (currentDay === 0 ? 7 : currentDay) - 1;
    const monday = new Date(baseDate);
    monday.setDate(baseDate.getDate() - distance);

    const days = [];
    for (let i = 0; i < 7; i++) {
      const day = new Date(monday);
      day.setDate(monday.getDate() + i);
      days.push(day);
    }
    setWeekDays(days);
  }, [baseDate]);

  // 현재 월요일 날짜 문자열
  const currentWeekStart = weekDays.length > 0 ? formatDate(weekDays[0]) : '';
  
  // 다음 주 월요일 날짜 문자열
  const getNextWeekStart = (): string => {
    if (weekDays.length === 0) return '';
    const nextMon = new Date(weekDays[0]);
    nextMon.setDate(nextMon.getDate() + 7);
    return formatDate(nextMon);
  };
  const nextWeekStart = getNextWeekStart();

  // 현재 선택된 대기방 타겟 월요일 날짜
  const targetPoolWeekStart = activePoolWeek === 'current' ? currentWeekStart : nextWeekStart;

  // 초기 데이터 로드 및 Realtime 채널 연동
  useEffect(() => {
    if (weekDays.length === 0) return;

    fetchInitialData();

    // Supabase Realtime 구독 설정 ('daesan' 스키마의 'schedules' 및 'waiting_pools' 감시)
    const channel = supabase
      .channel('schema-db-changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'daesan', table: 'schedules' },
        () => {
          fetchSchedulesOnly();
          fetchWaitingPoolsOnly();
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'daesan', table: 'waiting_pools' },
        () => {
          fetchWaitingPoolsOnly();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [weekDays]);

  const fetchInitialData = async () => {
    setLoading(true);
    setError(null);
    try {
      const staffsPromise = supabase.from('staffs').select('id, name, contact');
      const marketsPromise = supabase.from('markets').select('id, market_name');

      const [staffsRes, marketsRes] = await Promise.all([
        fetchWithTimeout(staffsPromise),
        fetchWithTimeout(marketsPromise),
      ]);

      if (staffsRes.error) throw staffsRes.error;
      if (marketsRes.error) throw marketsRes.error;

      const loadedStaffs = staffsRes.data || [];
      setStaffs(loadedStaffs);
      setMarkets(marketsRes.data || []);

      await Promise.all([fetchSchedulesOnly(), fetchWaitingPoolsOnly(loadedStaffs)]);
    } catch (err: any) {
      console.error('Error fetching initial data:', err);
      setError(err.message || '데이터를 불러오는 중 네트워크 에러가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  };

  const fetchSchedulesOnly = async () => {
    if (weekDays.length === 0) return;
    const startDateStr = formatDate(weekDays[0]);
    const endDateStr = formatDate(weekDays[6]);

    try {
      const schedulesPromise = supabase
        .from('schedules')
        .select(`
          id,
          staff_id,
          market_id,
          schedule_date,
          start_date,
          end_date,
          business_type,
          weekly_revenue,
          staffs (
            id,
            name,
            contact
          )
        `);

      const { data, error: schedulesError } = await fetchWithTimeout(schedulesPromise, 5000);
      if (schedulesError) throw schedulesError;

      const formattedSchedules = (data || []).map((s: any) => ({
        id: s.id,
        staff_id: s.staff_id,
        market_id: s.market_id,
        schedule_date: s.schedule_date,
        start_date: s.start_date || s.schedule_date,
        end_date: s.end_date || s.schedule_date || s.start_date,
        business_type: s.business_type,
        weekly_revenue: s.weekly_revenue,
        status: s.status || 'assigned',
        staffs: Array.isArray(s.staffs) ? s.staffs[0] : s.staffs,
      }));

      setSchedules(formattedSchedules);
    } catch (err: any) {
      console.error('Error fetching schedules:', err);
    }
  };

  const fetchWaitingPoolsOnly = async (currentStaffsList = staffs) => {
    if (!currentWeekStart) return;

    try {
      const poolsPromise = supabase
        .from('waiting_pools')
        .select(`
          id,
          staff_id,
          week_start_date,
          status,
          staffs (
            id,
            name,
            contact
          )
        `);

      const { data, error: poolsError } = await fetchWithTimeout(poolsPromise, 5000);
      
      // 테이블이 아직 없거나 에러가 난 경우 안전 처리
      if (poolsError) {
        console.warn('waiting_pools table notice:', poolsError.message);
        return;
      }

      const formattedPools = (data || []).map((p: any) => ({
        id: p.id,
        staff_id: p.staff_id,
        week_start_date: p.week_start_date,
        status: p.status,
        staffs: Array.isArray(p.staffs) ? p.staffs[0] : p.staffs,
      }));

      setWaitingPools(formattedPools);
    } catch (err: any) {
      console.error('Error fetching waiting pools:', err);
    }
  };

  // 특정 주차(월~일) 범위 계산
  const getWeekRange = (mondayStr: string) => {
    const mon = new Date(mondayStr);
    const sun = new Date(mon);
    sun.setDate(mon.getDate() + 6);
    return {
      startDate: formatDate(mon),
      endDate: formatDate(sun),
    };
  };

  // 주차별 인력 배정 수량 및 스케줄 목록 동적 계산 (다중 배정 완벽 지원)
  const getStaffWeeklySummary = (targetWeekMonday: string) => {
    const { startDate, endDate } = getWeekRange(targetWeekMonday);

    const staffSchedulesMap = new Map<string, Array<{ marketName: string; dateStr: string; dayK: string }>>();

    schedules.forEach((sch) => {
      if (sch.schedule_date >= startDate && sch.schedule_date <= endDate) {
        const market = markets.find((m) => m.id === sch.market_id);
        const list = staffSchedulesMap.get(sch.staff_id) || [];
        
        const dayDate = new Date(sch.schedule_date);
        const daysK = ['일', '월', '화', '수', '목', '금', '토'];
        const dayK = daysK[dayDate.getDay()];

        list.push({
          marketName: market ? market.market_name : '마트 배정됨',
          dateStr: sch.schedule_date.substring(5), // MM-DD
          dayK,
        });
        staffSchedulesMap.set(sch.staff_id, list);
      }
    });

    const staffSummaries = staffs.map((staff) => {
      const assignedList = staffSchedulesMap.get(staff.id) || [];
      return {
        ...staff,
        assignedCount: assignedList.length,
        assignedList,
      };
    });

    return staffSummaries;
  };

  const allStaffSummaries = getStaffWeeklySummary(targetPoolWeekStart);
  
  // 필터에 따른 인력 리스트 분리
  const unassignedStaffs = allStaffSummaries.filter((s) => s.assignedCount === 0);
  const assignedStaffs = allStaffSummaries.filter((s) => s.assignedCount > 0);

  const displayedStaffs =
    poolFilter === 'all'
      ? allStaffSummaries
      : poolFilter === 'unassigned'
      ? unassignedStaffs
      : assignedStaffs;

  // 대기방에서 인력 배정 처리 (DB 상태 업데이트)
  const updateWaitingPoolStatus = async (staffId: string, weekMonday: string, newStatus: 'waiting' | 'assigned') => {
    try {
      const upsertPromise = supabase
        .from('waiting_pools')
        .upsert(
          [
            {
              staff_id: staffId,
              week_start_date: weekMonday,
              status: newStatus,
            },
          ],
          { onConflict: 'staff_id,week_start_date' }
        );

      await fetchWithTimeout(upsertPromise, 5000);
      fetchWaitingPoolsOnly();
    } catch (err: any) {
      console.warn('Failed to update waiting pool status:', err);
    }
  };

  // 주차 이동 조작
  const handlePrevWeek = () => {
    const prev = new Date(baseDate);
    prev.setDate(baseDate.getDate() - 7);
    setBaseDate(prev);
  };

  const handleNextWeek = () => {
    const next = new Date(baseDate);
    next.setDate(baseDate.getDate() + 7);
    setBaseDate(next);
  };

  const handleCurrentWeek = () => {
    setBaseDate(new Date());
  };

  // 모바일/터치 클릭식 직원 선택 토글
  const handleStaffClick = (staffId: string) => {
    if (selectedStaffForAssign === staffId) {
      setSelectedStaffForAssign(null);
    } else {
      setSelectedStaffForAssign(staffId);
    }
  };

  // 대기 리스트의 직원 드래그 시작 이벤트 (PC - 크로스 브라우저 JSON 데이터 지원)
  const handleDragStartFromQueue = (e: React.DragEvent, staffId: string) => {
    const payload = JSON.stringify({ type: 'new-staff', id: staffId });
    e.dataTransfer.setData('text/plain', payload);
    e.dataTransfer.setData('application/json', payload);
    e.dataTransfer.setData('drag-type', 'new-staff');
    e.dataTransfer.setData('staff-id', staffId);
    e.dataTransfer.effectAllowed = 'move';
  };

  // 이미 배정된 일정 카드 드래그 시작 이벤트 (PC - 크로스 브라우저 JSON 데이터 지원)
  const handleDragStartFromBoard = (e: React.DragEvent, scheduleId: string) => {
    const payload = JSON.stringify({ type: 'existing-schedule', id: scheduleId });
    e.dataTransfer.setData('text/plain', payload);
    e.dataTransfer.setData('application/json', payload);
    e.dataTransfer.setData('drag-type', 'existing-schedule');
    e.dataTransfer.setData('schedule-id', scheduleId);
    e.dataTransfer.effectAllowed = 'move';
  };

  // 모바일 실시간 터치 드래그 앤 드롭 구현부
  const handleTouchStart = (
    e: React.TouchEvent,
    type: 'new-staff' | 'existing-schedule',
    id: string,
    label: string
  ) => {
    const touch = e.touches[0];
    setTouchDragInfo({ type, id, label });
    setTouchPosition({ x: touch.clientX, y: touch.clientY });
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!touchDragInfo) return;
    const touch = e.touches[0];
    setTouchPosition({ x: touch.clientX, y: touch.clientY });
  };

  const handleTouchEnd = async (e: React.TouchEvent) => {
    if (!touchDragInfo) return;

    const touch = e.changedTouches[0];
    const x = touch.clientX;
    const y = touch.clientY;

    const element = document.elementFromPoint(x, y);
    if (element) {
      const cell = element.closest('[data-cell-market-id]');
      if (cell) {
        const marketId = cell.getAttribute('data-cell-market-id');
        const dateStr = cell.getAttribute('data-cell-date-str');
        if (marketId && dateStr) {
          await executeTouchDrop(touchDragInfo.type, touchDragInfo.id, marketId, dateStr);
        }
      }
    }

    setTouchDragInfo(null);
    setTouchPosition(null);
  };

  const executeTouchDrop = async (
    type: 'new-staff' | 'existing-schedule',
    id: string,
    marketId: string,
    dateStr: string
  ) => {
    if (type === 'new-staff') {
      const staffId = id;
      const isAlreadyScheduled = schedules.some(
        (s) => s.staff_id === staffId && s.market_id === marketId && s.schedule_date === dateStr
      );
      if (isAlreadyScheduled) {
        alert('해당 직원은 이미 이 마트의 같은 날짜에 배정되어 있습니다.');
        return;
      }

      try {
        const insertPromise = supabase
          .from('schedules')
          .insert([
            {
              staff_id: staffId,
              market_id: marketId,
              schedule_date: dateStr,
              business_type: '땅콩빵',
            },
          ]);

        const { error: insertError } = await fetchWithTimeout(insertPromise, 5000);
        if (insertError) throw insertError;

        await updateWaitingPoolStatus(staffId, currentWeekStart, 'assigned');
        fetchSchedulesOnly();
      } catch (err: any) {
        console.error('Error assigning via touch drop:', err);
        alert(`배정 실패: ${err.message}`);
      }
    } else if (type === 'existing-schedule') {
      const scheduleId = id;
      const targetSchedule = schedules.find((s) => s.id === scheduleId);
      if (!targetSchedule) return;

      if (targetSchedule.market_id === marketId && targetSchedule.schedule_date === dateStr) {
        return;
      }

      const isAlreadyScheduled = schedules.some(
        (s) => s.id !== scheduleId && s.staff_id === targetSchedule.staff_id && s.market_id === marketId && s.schedule_date === dateStr
      );
      if (isAlreadyScheduled) {
        alert('이 직원은 이미 목적지 마트의 같은 날짜에 배정되어 있습니다.');
        return;
      }

      try {
        const updatePromise = supabase
          .from('schedules')
          .update({
            market_id: marketId,
            schedule_date: dateStr,
          })
          .eq('id', scheduleId);

        const { error: updateError } = await fetchWithTimeout(updatePromise, 5000);
        if (updateError) throw updateError;

        fetchSchedulesOnly();
      } catch (err: any) {
        console.error('Error moving via touch drop:', err);
        alert(`일정 이동 실패: ${err.message}`);
      }
    }
  };

  // 셀 클릭 배정 (터치 및 원클릭)
  const handleCellClick = async (marketId: string, dateStr: string) => {
    if (!selectedStaffForAssign) return;

    const staffId = selectedStaffForAssign;

    const isAlreadyScheduled = schedules.some(
      (s) => s.staff_id === staffId && s.market_id === marketId && s.schedule_date === dateStr
    );
    if (isAlreadyScheduled) {
      alert('해당 직원은 이미 이 마트의 같은 날짜에 배정되어 있습니다.');
      setSelectedStaffForAssign(null);
      return;
    }

    try {
      const insertPromise = supabase
        .from('schedules')
        .insert([
          {
            staff_id: staffId,
            market_id: marketId,
            schedule_date: dateStr,
            business_type: '땅콩빵',
          },
        ]);

      const { error: insertError } = await fetchWithTimeout(insertPromise, 5000);
      if (insertError) throw insertError;

      await updateWaitingPoolStatus(staffId, currentWeekStart, 'assigned');
      setSelectedStaffForAssign(null);
      fetchSchedulesOnly();
    } catch (err: any) {
      console.error('Error assigning via tap:', err);
      alert(`배정 실패: ${err.message}`);
    }
  };

  // 드롭 이벤트 처리 (PC 환경 - 크로스 브라우저 호환)
  const handleDrop = async (e: React.DragEvent, marketId: string, dateStr: string) => {
    e.preventDefault();

    let rawData = e.dataTransfer.getData('application/json') || e.dataTransfer.getData('text/plain');
    let dragType = 'new-staff';
    let targetId = '';

    if (rawData) {
      try {
        const parsed = JSON.parse(rawData);
        dragType = parsed.type || 'new-staff';
        targetId = parsed.id || '';
      } catch (err) {
        targetId = rawData;
      }
    }

    if (!targetId) {
      dragType = e.dataTransfer.getData('drag-type') || 'new-staff';
      targetId = e.dataTransfer.getData('staff-id') || e.dataTransfer.getData('schedule-id');
    }

    if (!targetId) return;

    if (dragType === 'new-staff') {
      const staffId = targetId;
      const isAlreadyScheduled = schedules.some(
        (s) => s.staff_id === staffId && s.market_id === marketId && s.schedule_date === dateStr
      );
      if (isAlreadyScheduled) {
        alert('해당 직원은 이미 이 마트의 같은 날짜에 배정되어 있습니다.');
        return;
      }

      try {
        const insertPromise = supabase
          .from('schedules')
          .insert([
            {
              staff_id: staffId,
              market_id: marketId,
              schedule_date: dateStr,
              business_type: '땅콩빵',
            },
          ]);

        const { error: insertError } = await fetchWithTimeout(insertPromise, 5000);
        if (insertError) throw insertError;

        await updateWaitingPoolStatus(staffId, currentWeekStart, 'assigned');
        fetchSchedulesOnly();
      } catch (err: any) {
        console.error('Error assigning schedule:', err);
        alert(`배정 실패: ${err.message}`);
      }
    } else if (dragType === 'existing-schedule') {
      const scheduleId = targetId;
      const targetSchedule = schedules.find((s) => s.id === scheduleId);
      if (!targetSchedule) return;

      if (targetSchedule.market_id === marketId && targetSchedule.schedule_date === dateStr) {
        return;
      }

      const isAlreadyScheduled = schedules.some(
        (s) => s.id !== scheduleId && s.staff_id === targetSchedule.staff_id && s.market_id === marketId && s.schedule_date === dateStr
      );
      if (isAlreadyScheduled) {
        alert('이 직원은 이미 목적지 마트의 같은 날짜에 배정되어 있습니다.');
        return;
      }

      try {
        const updatePromise = supabase
          .from('schedules')
          .update({
            market_id: marketId,
            schedule_date: dateStr,
          })
          .eq('id', scheduleId);

        const { error: updateError } = await fetchWithTimeout(updatePromise, 5000);
        if (updateError) throw updateError;

        fetchSchedulesOnly();
      } catch (err: any) {
        console.error('Error moving schedule:', err);
        alert(`일정 이동 실패: ${err.message}`);
      }
    }
  };

  // 배정 취소 (스케줄 삭제 및 대기방 인력 환원)
  const handleUnassign = async (scheduleId: string) => {
    if (!window.confirm('이 스케줄 배정을 취소하시겠습니까? (대기방으로 인력이 환원됩니다)')) return;

    const targetSchedule = schedules.find((s) => s.id === scheduleId);

    try {
      const deletePromise = supabase
        .from('schedules')
        .delete()
        .eq('id', scheduleId);

      const { error: deleteError } = await fetchWithTimeout(deletePromise, 5000);
      if (deleteError) throw deleteError;

      if (targetSchedule) {
        await updateWaitingPoolStatus(targetSchedule.staff_id, currentWeekStart, 'waiting');
      }

      fetchSchedulesOnly();
    } catch (err: any) {
      console.error('Error deleting schedule:', err);
      alert(`배정 취소 실패: ${err.message}`);
    }
  };

  // 상세 편집 모달에서 스케줄 삭제
  const handleUnassignFromModal = async (scheduleId: string) => {
    if (!window.confirm('이 스케줄 배정을 취소하시겠습니까? (대기방으로 인력이 환원됩니다)')) return;

    const targetSchedule = schedules.find((s) => s.id === scheduleId);

    setSaving(true);
    try {
      const deletePromise = supabase
        .from('schedules')
        .delete()
        .eq('id', scheduleId);

      const { error: deleteError } = await fetchWithTimeout(deletePromise, 5000);
      if (deleteError) throw deleteError;

      if (targetSchedule) {
        await updateWaitingPoolStatus(targetSchedule.staff_id, currentWeekStart, 'waiting');
      }

      setIsEditModalOpen(false);
      fetchSchedulesOnly();
    } catch (err: any) {
      console.error('Error deleting schedule from modal:', err);
      alert(`배정 취소 실패: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  // 긴급 인력 즉시 배정 액션
  const handleQuickEmergencyAssign = async (staffId: string) => {
    if (!emergencyTarget) return;

    const { marketId, dateStr } = emergencyTarget;

    try {
      const insertPromise = supabase
        .from('schedules')
        .insert([
          {
            staff_id: staffId,
            market_id: marketId,
            schedule_date: dateStr,
            business_type: '땅콩빵',
          },
        ]);

      const { error: insertError } = await fetchWithTimeout(insertPromise, 5000);
      if (insertError) throw insertError;

      await updateWaitingPoolStatus(staffId, currentWeekStart, 'assigned');
      setEmergencyTarget(null);
      fetchSchedulesOnly();
    } catch (err: any) {
      console.error('Emergency assignment error:', err);
      alert(`긴급 배정 실패: ${err.message}`);
    }
  };

  // 상세 편집 모달 열기
  const handleOpenEditModal = (schedule: Schedule) => {
    setEditingSchedule(schedule);
    setEditingStaffName(schedule.staffs?.name || '알 수 없음');
    setSelectedStaffId(schedule.staff_id);
    setSelectedMarketId(schedule.market_id);
    setSelectedDateStr(schedule.schedule_date);
    setBusinessType(schedule.business_type);
    setWeeklyRevenue(schedule.weekly_revenue || '');
    setIsEditModalOpen(true);
  };

  // 상세 편집 저장
  const handleUpdateDetails = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingSchedule) return;

    const isConflict = schedules.some(
      (s) =>
        s.id !== editingSchedule.id &&
        s.staff_id === selectedStaffId &&
        s.market_id === selectedMarketId &&
        s.schedule_date === selectedDateStr
    );

    if (isConflict) {
      alert('선택한 직원은 이미 해당 목적지의 다른 일정으로 배정되어 있습니다.');
      return;
    }

    setSaving(true);
    try {
      const updatePromise = supabase
        .from('schedules')
        .update({
          staff_id: selectedStaffId,
          market_id: selectedMarketId,
          schedule_date: selectedDateStr,
          business_type: businessType,
          weekly_revenue: weeklyRevenue === '' ? null : Number(weeklyRevenue),
        })
        .eq('id', editingSchedule.id);

      const { error: updateError } = await fetchWithTimeout(updatePromise, 5000);
      if (updateError) throw updateError;

      setIsEditModalOpen(false);
      fetchSchedulesOnly();
    } catch (err: any) {
      console.error('Error updating schedule details:', err);
      alert(`저장 실패: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  // 특정 셀(마트 + 날짜)에 배정된 스케줄들 찾기 (기간 범위 매칭)
  const getSchedulesForCell = (marketId: string, dateStr: string) => {
    return schedules.filter((s: any) => {
      const start = s.start_date || s.schedule_date;
      const end = s.end_date || s.schedule_date || start;
      return s.market_id === marketId && start && end && dateStr >= start && dateStr <= end;
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:justify-between md:items-center border-b pb-4 gap-4">
        <div>
          <h1 className="text-2xl font-bold text-emerald-800">통합 일정</h1>
          <div className="text-sm text-gray-500 mt-1 space-y-1">
            <p>💻 **PC:** 대기방 인력을 드래그하여 배정하거나, 캘린더 카드를 드래그해 이동합니다. (동일 직원 다중 날짜 배정 가능)</p>
            <p>📱 **모바일:** 대기방 직원을 **선택(터치)** 후 원하는 칸을 **터치**하면 즉시 배정됩니다. 미배정 빈 셀의 <span className="text-red-600 font-bold">🚨 결원</span> 버튼을 누르면 긴급 인력을 빠른 투입할 수 있습니다.</p>
          </div>
        </div>
        <div className="flex items-center space-x-2">
          <button
            onClick={handlePrevWeek}
            className="px-3 py-1.5 border rounded-md text-xs font-semibold hover:bg-gray-100 cursor-pointer bg-white"
          >
            &larr; 이전 주
          </button>
          <button
            onClick={handleCurrentWeek}
            className="px-3 py-1.5 border rounded-md text-xs font-semibold hover:bg-gray-100 cursor-pointer bg-white"
          >
            이번 주
          </button>
          <button
            onClick={handleNextWeek}
            className="px-3 py-1.5 border rounded-md text-xs font-semibold hover:bg-gray-100 cursor-pointer bg-white"
          >
            다음 주 &rarr;
          </button>
        </div>
      </div>

      <WorkflowNav current="통합 일정" />

      {error && (
        <div className="bg-red-50 border-l-4 border-red-400 p-4 rounded-md flex justify-between items-center">
          <div>
            <p className="text-sm text-red-700 font-semibold">데이터 연결 에러</p>
            <p className="text-xs text-red-600">{error}</p>
          </div>
          <button
            onClick={() => {
              setError(null);
              setLoading(false);
            }}
            className="text-xs bg-red-100 text-red-800 px-2 py-1 rounded hover:bg-red-200"
          >
            닫기
          </button>
        </div>
      )}

      {loading ? (
        <div className="text-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-600 mx-auto mb-4"></div>
          <p className="text-gray-500 text-sm">데이터를 구성하는 중입니다...</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          {/* 왼쪽: 주차별 인력 대기방 (Waiting Pool / 전체 인력 풀) */}
          <div className="bg-white p-4 rounded-lg border border-gray-200 shadow-sm flex flex-col h-[75vh]">
            <div className="border-b pb-3 mb-3 space-y-2">
              <div className="flex justify-between items-center">
                <h2 className="text-sm font-bold text-purple-900 flex items-center gap-1">
                  <span>🏊‍♂️</span> 주차별 인력 풀
                </h2>
                <span className="text-[10px] bg-purple-100 text-purple-800 font-bold px-2 py-0.5 rounded-full">
                  총 {allStaffSummaries.length}명
                </span>
              </div>
              
              {/* 1차 주차 선택 탭 (이번 주 vs 다음 주) */}
              <div className="grid grid-cols-2 gap-1 bg-gray-100 p-1 rounded-md text-xs font-semibold">
                <button
                  type="button"
                  onClick={() => setActivePoolWeek('current')}
                  className={`py-1 rounded text-center transition-colors cursor-pointer ${
                    activePoolWeek === 'current' ? 'bg-purple-600 text-white shadow-sm' : 'text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  이번 주 대기방
                </button>
                <button
                  type="button"
                  onClick={() => setActivePoolWeek('next')}
                  className={`py-1 rounded text-center transition-colors cursor-pointer ${
                    activePoolWeek === 'next' ? 'bg-purple-600 text-white shadow-sm' : 'text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  다음 주 대기방
                </button>
              </div>

              {/* 2차 인력 상태 구분 필터 (전체 vs 대기 중 vs 배정 완료) */}
              <div className="grid grid-cols-3 gap-1 pt-1 text-[11px] font-bold">
                <button
                  type="button"
                  onClick={() => setPoolFilter('all')}
                  className={`py-1 text-center border-b-2 transition-colors cursor-pointer ${
                    poolFilter === 'all'
                      ? 'border-purple-600 text-purple-700'
                      : 'border-transparent text-gray-400 hover:text-gray-600'
                  }`}
                >
                  전체 ({allStaffSummaries.length})
                </button>
                <button
                  type="button"
                  onClick={() => setPoolFilter('unassigned')}
                  className={`py-1 text-center border-b-2 transition-colors cursor-pointer ${
                    poolFilter === 'unassigned'
                      ? 'border-purple-600 text-purple-700'
                      : 'border-transparent text-gray-400 hover:text-gray-600'
                  }`}
                >
                  대기 ({unassignedStaffs.length})
                </button>
                <button
                  type="button"
                  onClick={() => setPoolFilter('assigned')}
                  className={`py-1 text-center border-b-2 transition-colors cursor-pointer ${
                    poolFilter === 'assigned'
                      ? 'border-green-600 text-green-700'
                      : 'border-transparent text-gray-400 hover:text-gray-600'
                  }`}
                >
                  배정 ({assignedStaffs.length})
                </button>
              </div>
            </div>

            <p className="text-[10px] text-gray-500 mb-3">
              * 모든 인원은 여러 요일/마트에 다중 배정 가능합니다. 드래그하여 배정하세요.
            </p>

            <div className="flex-1 overflow-y-auto space-y-2 pr-1">
              {displayedStaffs.map((staff) => {
                const isSelected = selectedStaffForAssign === staff.id;
                const hasAssigned = staff.assignedCount > 0;

                return (
                  <div
                    key={staff.id}
                    draggable
                    onDragStart={(e) => handleDragStartFromQueue(e, staff.id)}
                    onTouchStart={(e) => handleTouchStart(e, 'new-staff', staff.id, staff.name)}
                    onTouchMove={handleTouchMove}
                    onTouchEnd={handleTouchEnd}
                    onClick={() => handleStaffClick(staff.id)}
                    className={`p-3 rounded-lg shadow-sm cursor-grab transition-all flex flex-col justify-between select-none ${
                      isSelected
                        ? 'bg-purple-100 border-2 border-purple-600 ring-2 ring-purple-300 animate-pulse'
                        : hasAssigned
                        ? 'bg-green-50/70 border border-green-200 hover:bg-green-100/80 active:cursor-grabbing'
                        : 'bg-purple-50/70 border border-purple-100 hover:bg-purple-100 active:cursor-grabbing'
                    }`}
                  >
                    <div className="flex justify-between items-center">
                      <span className="font-bold text-sm text-gray-900">{staff.name}</span>
                      {isSelected ? (
                        <span className="text-[10px] bg-purple-600 text-white px-1.5 py-0.5 rounded-full font-bold">
                          선택됨
                        </span>
                      ) : hasAssigned ? (
                        <span className="text-[9px] bg-green-600 text-white px-1.5 py-0.5 rounded font-bold">
                          ✓ {staff.assignedCount}건 배정됨
                        </span>
                      ) : (
                        <span className="text-[9px] bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded font-semibold">
                          대기 중
                        </span>
                      )}
                    </div>

                    <div className="mt-1 flex flex-col gap-0.5">
                      <span className="text-[10px] text-gray-500">{staff.contact}</span>
                      {hasAssigned && (
                        <div className="text-[9px] text-green-800 font-semibold bg-white/80 p-1 rounded border border-green-100 mt-1">
                          📍 {staff.assignedList.map((a) => `${a.dayK}(${a.marketName})`).join(', ')}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}

              {displayedStaffs.length === 0 && (
                <div className="text-center py-10 bg-gray-50 rounded-lg border border-dashed border-gray-200">
                  <p className="text-xs text-gray-400 font-semibold">해당하는 인력이 없습니다.</p>
                </div>
              )}
            </div>
          </div>

          {/* 오른쪽: 스케줄링 캘린더 그리드 및 결원 알림 */}
          <div className="lg:col-span-3 bg-white p-4 rounded-lg border border-gray-200 shadow-sm overflow-x-auto">
            <div className="flex justify-between items-center border-b pb-2 mb-3">
              <h2 className="text-sm font-bold text-gray-900">
                스케줄링 그리드 (
                {weekDays.length > 0 &&
                  `${formatDate(weekDays[0])} ~ ${formatDate(weekDays[6])}`}
                )
                {selectedStaffForAssign && (
                  <span className="ml-3 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-purple-100 text-purple-800 animate-pulse">
                    📍 원하는 달력 칸을 클릭하여 직원을 배정하세요
                  </span>
                )}
              </h2>
              <div className="flex items-center space-x-2 text-[11px] text-gray-500">
                <span className="inline-flex items-center gap-1">
                  <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-ping"></span>
                  <span className="font-semibold text-red-600">🚨 결원 빈 셀 (점멸 경고)</span>
                </span>
              </div>
            </div>

            <table className="w-full min-w-[800px] border-collapse border border-gray-200 table-fixed">
              <thead>
                <tr className="bg-gray-50 text-gray-700 text-xs">
                  <th className="border border-gray-200 p-2 w-32 font-bold">마트 / 지점</th>
                  {weekDays.map((day, idx) => {
                    const daysK = ['월', '화', '수', '목', '금', '토', '일'];
                    const isToday = formatDate(day) === formatDate(new Date());
                    return (
                      <th
                        key={idx}
                        className={`border border-gray-200 p-2 text-center w-28 ${
                          isToday ? 'bg-purple-600 text-white' : 'font-semibold'
                        }`}
                      >
                        <div>{daysK[idx]}요일</div>
                        <div className="text-[10px] opacity-80">{formatDate(day).substring(5)}</div>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {markets.map((market) => (
                  <tr key={market.id} className="text-xs">
                    {/* 마트명 */}
                    <td className="border border-gray-200 p-2 font-bold text-gray-800 bg-gray-50/50 truncate">
                      {market.market_name}
                    </td>
                    {/* 날짜 셀들 */}
                    {weekDays.map((day, idx) => {
                      const dateStr = formatDate(day);
                      const cellSchedules = getSchedulesForCell(market.id, dateStr);
                      const isVacant = cellSchedules.length === 0;

                      return (
                        <td
                          key={idx}
                          data-cell-market-id={market.id}
                          data-cell-date-str={dateStr}
                          onDragOver={(e) => {
                            e.preventDefault();
                            e.dataTransfer.dropEffect = 'move';
                          }}
                          onDrop={(e) => handleDrop(e, market.id, dateStr)}
                          onClick={() => handleCellClick(market.id, dateStr)}
                          className={`border p-1.5 h-24 align-top transition-colors relative select-none ${
                            isVacant
                              ? 'border-2 border-red-300 bg-red-50/30 hover:bg-red-50/70 animate-pulse'
                              : 'border-gray-200 bg-white hover:bg-purple-50/20'
                          } ${selectedStaffForAssign && isVacant ? 'cursor-pointer' : ''}`}
                        >
                          {/* 스케줄이 비어있는 셀에만 결원 알림 경고 뱃지 노출 */}
                          {isVacant && (
                            <div className="flex justify-between items-center mb-1">
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setEmergencyTarget({
                                    marketId: market.id,
                                    dateStr,
                                    marketName: market.market_name,
                                  });
                                }}
                                className="inline-flex items-center gap-1 text-[9px] bg-red-600 text-white px-1.5 py-0.5 rounded-full font-bold shadow-sm hover:bg-red-700 cursor-pointer animate-bounce"
                                title="클릭하여 긴급 인력 투입"
                              >
                                <span>🚨 결원</span>
                              </button>
                            </div>
                          )}

                          {/* 배정된 직원 스케줄 카드 목록 */}
                          <div className="space-y-1 overflow-y-auto max-h-full pb-1">
                            {cellSchedules.map((sch) => (
                              <div
                                key={sch.id}
                                draggable
                                onDragStart={(e) => handleDragStartFromBoard(e, sch.id)}
                                onTouchStart={(e) =>
                                  handleTouchStart(e, 'existing-schedule', sch.id, sch.staffs?.name || '미조인')
                                }
                                onTouchMove={handleTouchMove}
                                onTouchEnd={handleTouchEnd}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleOpenEditModal(sch);
                                }}
                                className="group relative bg-white border border-gray-200 rounded p-1.5 shadow-sm flex flex-col justify-between cursor-grab hover:border-purple-500 active:cursor-grabbing transition-all select-none"
                                title="드래그하여 일정 이동 / 클릭하여 상세 퀵 편집"
                              >
                                <div className="flex justify-between items-start">
                                  <span className="font-bold text-purple-950 text-[11px] truncate">
                                    {sch.staffs?.name || '미조인'}
                                  </span>
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleUnassign(sch.id);
                                    }}
                                    className="text-gray-400 hover:text-red-500 text-[10px] leading-none cursor-pointer"
                                    title="배정 취소"
                                  >
                                    &times;
                                  </button>
                                </div>
                                <div className="flex justify-between items-center mt-1">
                                  <span className="text-[9px] bg-purple-100 text-purple-800 px-1 rounded font-medium truncate">
                                    {sch.business_type}
                                  </span>
                                  <span className="text-[8px] text-gray-400 opacity-60 group-hover:opacity-100 transition-opacity">
                                    편집
                                  </span>
                                </div>
                              </div>
                            ))}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
                {markets.length === 0 && (
                  <tr>
                    <td colSpan={8} className="text-center p-8 text-xs text-gray-400">
                      등록된 마트가 없습니다. 마트를 먼저 등록해 주세요.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 모바일 실시간 드래그 피드백 엘리먼트 */}
      {touchDragInfo && touchPosition && (
        <div
          className="fixed pointer-events-none z-[9999] p-3 bg-purple-600 text-white rounded-lg shadow-lg opacity-95 text-xs font-bold transition-transform duration-75"
          style={{
            left: `${touchPosition.x - 50}px`,
            top: `${touchPosition.y - 25}px`,
            width: '100px',
            textAlign: 'center',
          }}
        >
          {touchDragInfo.label}
        </div>
      )}

      {/* 🚨 결원 긴급 인력 투입 팝업 모달 */}
      {emergencyTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-lg max-w-sm w-full p-6 shadow-xl space-y-4 border-2 border-red-500">
            <div className="flex justify-between items-center border-b pb-3">
              <h2 className="text-base font-bold text-red-600 flex items-center gap-1">
                <span>🚨</span> 긴급 인력 빠른 투입
              </h2>
              <button
                onClick={() => setEmergencyTarget(null)}
                className="text-gray-400 hover:text-gray-600 text-xl font-bold cursor-pointer"
              >
                &times;
              </button>
            </div>

            <div className="bg-red-50 p-3 rounded-md text-xs text-red-900 border border-red-100 space-y-1">
              <p><span className="font-bold">대상 마트:</span> {emergencyTarget.marketName}</p>
              <p><span className="font-bold">결원 일자:</span> {emergencyTarget.dateStr}</p>
            </div>

            <div>
              <label className="block text-xs font-bold text-gray-700 mb-2">
                투입할 인력 선택 (클릭 시 1초 만에 바로 배정):
              </label>
              <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                {allStaffSummaries.map((staff) => (
                  <button
                    key={staff.id}
                    type="button"
                    onClick={() => handleQuickEmergencyAssign(staff.id)}
                    className="w-full text-left p-2.5 bg-purple-50 hover:bg-purple-100 border border-purple-200 rounded-md flex justify-between items-center transition-colors cursor-pointer"
                  >
                    <div>
                      <span className="font-bold text-purple-900 text-xs">{staff.name}</span>
                      <span className="text-[10px] text-purple-700 block">
                        {staff.assignedCount > 0 ? `현재 ${staff.assignedCount}건 배정 중` : '미배정 (대기 중)'}
                      </span>
                    </div>
                    <span className="text-xs bg-red-600 text-white font-bold px-2 py-1 rounded">
                      투입 &rarr;
                    </span>
                  </button>
                ))}
              </div>
            </div>

            <div className="flex justify-end pt-3 border-t">
              <button
                type="button"
                onClick={() => setEmergencyTarget(null)}
                className="px-3 py-1.5 border rounded text-xs text-gray-700 hover:bg-gray-50 cursor-pointer"
              >
                닫기
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 스케줄 인라인 퀵 편집 모달 */}
      {isEditModalOpen && editingSchedule && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-lg max-w-sm w-full p-6 shadow-xl space-y-4">
            <div className="flex justify-between items-center border-b pb-3">
              <h2 className="text-base font-bold text-purple-600">
                일정 상세 편집 및 이동
              </h2>
              <button
                onClick={() => setIsEditModalOpen(false)}
                className="text-gray-400 hover:text-gray-600 text-xl font-bold cursor-pointer"
              >
                &times;
              </button>
            </div>

            <form onSubmit={handleUpdateDetails} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">담당 직원 변경</label>
                <select
                  value={selectedStaffId}
                  onChange={(e) => setSelectedStaffId(e.target.value)}
                  className="w-full border rounded-md px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-purple-500"
                >
                  {staffs.map((staff) => (
                    <option key={staff.id} value={staff.id}>
                      {staff.name} ({staff.contact})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">배정 마트 변경 (이동)</label>
                <select
                  value={selectedMarketId}
                  onChange={(e) => setSelectedMarketId(e.target.value)}
                  className="w-full border rounded-md px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-purple-500"
                >
                  {markets.map((market) => (
                    <option key={market.id} value={market.id}>
                      {market.market_name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">배정 날짜 변경 (이동)</label>
                <select
                  value={selectedDateStr}
                  onChange={(e) => setSelectedDateStr(e.target.value)}
                  className="w-full border rounded-md px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-purple-500"
                >
                  {weekDays.map((day, idx) => {
                    const daysK = ['월', '화', '수', '목', '금', '토', '일'];
                    const dateVal = formatDate(day);
                    return (
                      <option key={idx} value={dateVal}>
                        {daysK[idx]}요일 ({dateVal.substring(5)})
                      </option>
                    );
                  })}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">배정 업종</label>
                <select
                  value={businessType}
                  onChange={(e) => setBusinessType(e.target.value)}
                  className="w-full border rounded-md px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-purple-500"
                >
                  <option value="땅콩빵">땅콩빵</option>
                  <option value="붕어빵">붕어빵</option>
                  <option value="만두">만두</option>
                  <option value="와플">와플</option>
                  <option value="기타">기타</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">주간 매출액 (원)</label>
                <input
                  type="number"
                  value={weeklyRevenue}
                  onChange={(e) =>
                    setWeeklyRevenue(e.target.value === '' ? '' : Number(e.target.value))
                  }
                  placeholder="예: 1200000 (숫자만 입력)"
                  className="w-full border rounded-md px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-purple-500"
                />
              </div>

              <div className="flex justify-between items-center pt-3 border-t">
                {/* 퀵 삭제 버튼 */}
                <button
                  type="button"
                  onClick={() => handleUnassignFromModal(editingSchedule.id)}
                  disabled={saving}
                  className="px-3 py-1.5 bg-red-50 hover:bg-red-100 text-red-600 rounded text-xs font-semibold cursor-pointer transition-colors"
                >
                  일정 삭제
                </button>

                <div className="flex space-x-2">
                  <button
                    type="button"
                    onClick={() => setIsEditModalOpen(false)}
                    disabled={saving}
                    className="px-3 py-1.5 border rounded text-xs text-gray-700 hover:bg-gray-50 cursor-pointer"
                  >
                    취소
                  </button>
                  <button
                    type="submit"
                    disabled={saving}
                    className="px-3 py-1.5 border border-transparent rounded text-xs font-medium text-white bg-purple-600 hover:bg-purple-700 disabled:opacity-50 cursor-pointer"
                  >
                    {saving ? '저장 중...' : '저장'}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
