'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase/client';

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
  staffs?: Staff; // Joined
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

export default function ShareSchedulerPage() {
  const [baseDate, setBaseDate] = useState<Date>(new Date());
  const [weekDays, setWeekDays] = useState<Date[]>([]);
  
  const [markets, setMarkets] = useState<Market[]>([]);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  // 초기 데이터 로드 및 Realtime 채널 연동
  useEffect(() => {
    if (weekDays.length === 0) return;

    fetchInitialData();

    // Supabase Realtime 구독 설정 ('daesan' 스키마의 'schedules' 테이블 감시)
    const channel = supabase
      .channel('share-db-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'daesan',
          table: 'schedules',
        },
        (payload) => {
          console.log('공유 스케줄러 Realtime 변경 감지:', payload);
          fetchSchedulesOnly();
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
      // markets 로딩
      const marketsPromise = supabase.from('markets').select('id, market_name');

      const [marketsRes] = await Promise.all([
        fetchWithTimeout(marketsPromise),
      ]);

      if (marketsRes.error) throw marketsRes.error;
      setMarkets(marketsRes.data || []);

      await fetchSchedulesOnly();
    } catch (err: any) {
      console.error('Error fetching initial data:', err);
      setError(err.message || '데이터를 불러오는 중 에러가 발생했습니다.');
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
        staffs: Array.isArray(s.staffs) ? s.staffs[0] : s.staffs,
      }));

      setSchedules(formattedSchedules);
    } catch (err: any) {
      console.error('Error fetching schedules:', err);
    }
  };

  const formatDate = (date: Date): string => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

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

  const getSchedulesForCell = (marketId: string, dateStr: string) => {
    return schedules.filter((s: any) => {
      const start = s.start_date || s.schedule_date;
      const end = s.end_date || s.schedule_date || start;
      return s.market_id === marketId && start && end && dateStr >= start && dateStr <= end;
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center border-b pb-4 gap-4">
        <div>
          <div className="flex items-center space-x-2">
            <h1 className="text-2xl font-bold text-emerald-800">통합 일정 공유판</h1>
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-800 animate-pulse">
              ● 실시간 동기화 중
            </span>
          </div>
          <p className="text-sm text-gray-500">
            직원용 읽기 전용 스케줄 캘린더입니다. 관리자의 변경 사항이 실시간으로 새로고침 없이 동기화됩니다.
          </p>
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

      {error && (
        <div className="bg-red-50 border-l-4 border-red-400 p-4 rounded-md">
          <p className="text-sm text-red-700 font-semibold">연결 상태 알림</p>
          <p className="text-xs text-red-600">{error}</p>
        </div>
      )}

      {loading ? (
        <div className="text-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-amber-600 mx-auto mb-4"></div>
          <p className="text-gray-500 text-sm">스케줄 정보를 불러오는 중입니다...</p>
        </div>
      ) : (
        <div className="bg-white p-4 rounded-lg border border-gray-200 shadow-sm overflow-x-auto">
          <table className="w-full min-w-[700px] border-collapse border border-gray-200 table-fixed">
            <thead>
              <tr className="bg-gray-50 text-gray-700 text-xs">
                <th className="border border-gray-200 p-2 w-32 font-bold">마트 지점</th>
                {weekDays.map((day, idx) => {
                  const daysK = ['월', '화', '수', '목', '금', '토', '일'];
                  const isToday = formatDate(day) === formatDate(new Date());
                  return (
                    <th
                      key={idx}
                      className={`border border-gray-200 p-2 text-center w-24 ${
                        isToday ? 'bg-amber-600 text-white' : 'font-semibold'
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
                  <td className="border border-gray-200 p-2 font-bold text-gray-800 bg-gray-50/50 truncate">
                    {market.market_name}
                  </td>
                  {weekDays.map((day, idx) => {
                    const dateStr = formatDate(day);
                    const cellSchedules = getSchedulesForCell(market.id, dateStr);

                    return (
                      <td
                        key={idx}
                        className="border border-gray-200 p-1.5 h-24 align-top bg-white relative"
                      >
                        <div className="space-y-1 overflow-y-auto max-h-full pb-1">
                          {cellSchedules.map((sch) => (
                            <div
                              key={sch.id}
                              className="bg-amber-50/60 border border-amber-100 rounded p-1 flex flex-col justify-between"
                            >
                              <span className="font-bold text-amber-900 text-[11px] truncate">
                                {sch.staffs?.name || '미지정'}
                              </span>
                              <div className="flex justify-between items-center mt-1">
                                <span className="text-[9px] bg-amber-100 text-amber-800 px-1 rounded truncate">
                                  {sch.business_type}
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
                    스케줄할 마트가 존재하지 않습니다.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
