// src/pages/EventPage.tsx
import React, { useMemo, useState } from "react";
import "./EventPage.css";

type EventType = "briefing" | "workshop" | "etc";

interface EventItem {
  id: number;
  title: string;
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  type: EventType;
}

// 유틸 함수들
function parseDate(dateStr: string): Date {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function stripTime(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function isDateInRange(date: Date, event: EventItem): boolean {
  const target = stripTime(date);
  const start = stripTime(parseDate(event.startDate));
  const end = stripTime(parseDate(event.endDate));
  return target >= start && target <= end;
}

function eventOverlapsMonth(
  event: EventItem,
  monthStart: Date,
  monthEnd: Date
): boolean {
  const start = stripTime(parseDate(event.startDate));
  const end = stripTime(parseDate(event.endDate));
  return start <= monthEnd && end >= monthStart;
}

// YYYY-MM-DD -> 2025.11.03
function formatDisplayDate(dateStr: string): string {
  return dateStr.replace(/-/g, ".");
}

// Date -> 2025.11.03
function formatDisplayFromDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}.${m}.${d}`;
}

const EventPage: React.FC = () => {
  // 실제 행사 데이터
  const [events, setEvents] = useState<EventItem[]>([]);

  // 현재 보고 있는 월
  const [currentMonthDate, setCurrentMonthDate] = useState(
    new Date(new Date().getFullYear(), new Date().getMonth(), 1)
  );

  // 선택한 날짜 (해당 날짜 행사만 보기)
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);

  // 검색/필터 상태
  const [searchKeyword, setSearchKeyword] = useState("");
  const [searchStart, setSearchStart] = useState("");
  const [searchEnd, setSearchEnd] = useState("");

  const [showPeriodFilter, setShowPeriodFilter] = useState(false);
  const [showKeywordFilter, setShowKeywordFilter] = useState(false);

  // 행사 추가 폼
  const [showAddForm, setShowAddForm] = useState(false);
  const [formState, setFormState] = useState<{
    title: string;
    startDate: string;
    endDate: string;
    type: EventType;
  }>({
    title: "",
    startDate: "",
    endDate: "",
    type: "briefing",
  });

  const year = currentMonthDate.getFullYear();
  const month = currentMonthDate.getMonth(); // 0~11

  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstDayOfWeek = new Date(year, month, 1).getDay(); // 0:일 ~ 6:토

  // ---------- 필터링 ----------

  const filteredEvents = useMemo(() => {
    return events.filter((ev) => {
      // 키워드 필터
      if (
        searchKeyword &&
        !ev.title.toLowerCase().includes(searchKeyword.toLowerCase())
      ) {
        return false;
      }

      // 기간 필터
      if (searchStart || searchEnd) {
        const eventStart = stripTime(parseDate(ev.startDate));
        const eventEnd = stripTime(parseDate(ev.endDate));

        if (searchStart) {
          const filterStart = stripTime(parseDate(searchStart));
          if (eventEnd < filterStart) return false;
        }

        if (searchEnd) {
          const filterEnd = stripTime(parseDate(searchEnd));
          if (eventStart > filterEnd) return false;
        }
      }

      return true;
    });
  }, [events, searchKeyword, searchStart, searchEnd]);

  // 현재 월에 걸쳐 있는 행사
  const eventsThisMonth = useMemo(() => {
    const monthStart = new Date(year, month, 1);
    const monthEnd = new Date(year, month + 1, 0);
    const list = filteredEvents.filter((ev) =>
      eventOverlapsMonth(ev, monthStart, monthEnd)
    );
    list.sort((a, b) => a.startDate.localeCompare(b.startDate));
    return list;
  }, [filteredEvents, year, month]);

  // 달력 셀 구조
  const calendarCells = useMemo(() => {
    const cells: {
      date: Date | null;
      events: EventItem[];
    }[] = [];

    // 1일 이전 빈 칸
    for (let i = 0; i < firstDayOfWeek; i++) {
      cells.push({ date: null, events: [] });
    }

    // 1일~마지막 날
    for (let day = 1; day <= daysInMonth; day++) {
      const date = new Date(year, month, day);
      const eventsOnDay = eventsThisMonth.filter((ev) =>
        isDateInRange(date, ev)
      );
      cells.push({ date, events: eventsOnDay });
    }

    // 마지막 줄 채우기
    while (cells.length % 7 !== 0) {
      cells.push({ date: null, events: [] });
    }

    return cells;
  }, [year, month, daysInMonth, firstDayOfWeek, eventsThisMonth]);

  // 선택된 날짜에 따른 하단 리스트
  const displayedEvents = useMemo(() => {
    if (!selectedDate) return eventsThisMonth;
    return eventsThisMonth.filter((ev) => isDateInRange(selectedDate, ev));
  }, [eventsThisMonth, selectedDate]);

  // ---------- 핸들러들 ----------

  const handlePrevMonth = () => {
    setCurrentMonthDate(
      (prev) => new Date(prev.getFullYear(), prev.getMonth() - 1, 1)
    );
    setSelectedDate(null);
  };

  const handleNextMonth = () => {
    setCurrentMonthDate(
      (prev) => new Date(prev.getFullYear(), prev.getMonth() + 1, 1)
    );
    setSelectedDate(null);
  };

  const isSameDay = (d1: Date, d2: Date) => {
    return (
      d1.getFullYear() === d2.getFullYear() &&
      d1.getMonth() === d2.getMonth() &&
      d1.getDate() === d2.getDate()
    );
  };

  const handleDateClick = (date: Date | null, hasEvent: boolean) => {
    if (!date) return;

    if (!hasEvent) {
      setSelectedDate(null);
      return;
    }

    setSelectedDate((prev) =>
      prev && isSameDay(prev, date) ? null : date
    );
  };

  const handleFormChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>
  ) => {
    const { name, value } = e.target;
    setFormState((prev) => ({ ...prev, [name]: value }));
  };

  const handleAddEvent = (e: React.FormEvent) => {
    e.preventDefault();

    const { title, startDate, endDate, type } = formState;
    if (!title || !startDate || !endDate) {
      alert("제목, 시작일, 종료일을 모두 입력해주세요.");
      return;
    }

    const start = parseDate(startDate);
    const end = parseDate(endDate);

    if (start > end) {
      alert("시작일이 종료일보다 늦을 수 없습니다.");
      return;
    }

    const newEvent: EventItem = {
      id: Date.now(),
      title,
      startDate,
      endDate,
      type,
    };

    setEvents((prev) => [...prev, newEvent]);
    setShowAddForm(false);
    setFormState({
      title: "",
      startDate: "",
      endDate: "",
      type: "briefing",
    });

    // 추가한 행사 월로 이동
    setCurrentMonthDate(
      new Date(start.getFullYear(), start.getMonth(), 1)
    );
    setSelectedDate(null);
  };

  const handleDeleteEvent = (id: number) => {
    setEvents((prev) => prev.filter((ev) => ev.id !== id));
    setSelectedDate(null);
  };

  const handleTogglePeriodFilter = () => {
    setShowPeriodFilter((prev) => !prev);
  };

  const handleToggleKeywordFilter = () => {
    setShowKeywordFilter((prev) => !prev);
  };

  const clearPeriodFilter = () => {
    setSearchStart("");
    setSearchEnd("");
    setSelectedDate(null);
  };

  const clearKeywordFilter = () => {
    setSearchKeyword("");
    setSelectedDate(null);
  };

  return (
    <main className="dashboard-content event-page">
      <div className="event-page-inner">
        {/* 제목 */}
        <h1 className="event-page-title">행사일정</h1>

        {/* 상단: 캘린더 + 우측 행사 요약 카드 */}
        <div className="event-top-row">
          {/* 캘린더 카드 */}
          <section className="event-card event-calendar-card">
            <header className="event-card-header">
              <button
                type="button"
                className="month-nav-btn"
                aria-label="이전 달"
                onClick={handlePrevMonth}
              >
                &lt;
              </button>
              <span className="month-label">
                {year}년 {month + 1}월
              </span>
              <button
                type="button"
                className="month-nav-btn"
                aria-label="다음 달"
                onClick={handleNextMonth}
              >
                &gt;
              </button>
            </header>

            <div className="event-calendar-grid">
              {/* 요일 헤더 */}
              {["일", "월", "화", "수", "목", "금", "토"].map((d) => (
                <div key={d} className="calendar-day-name">
                  {d}
                </div>
              ))}

              {/* 날짜 셀 */}
              {calendarCells.map((cell, idx) => {
                const hasDate = !!cell.date;
                const eventsOnDay = cell.events;
                const hasEvent = eventsOnDay.length > 0;

                const isSelected =
                  selectedDate &&
                  cell.date &&
                  isSameDay(selectedDate, cell.date);

                return (
                  <div key={idx} className="calendar-cell">
                    {hasDate && cell.date && (
                      <button
                        type="button"
                        className={`calendar-date-inner ${
                          isSelected ? "selected" : ""
                        }`}
                        onClick={() =>
                          handleDateClick(cell.date!, hasEvent)
                        }
                      >
                        <span className="calendar-date-number">
                          {cell.date.getDate()}
                        </span>

                        {/* 겹치는 행사까지 모두 표시 */}
                        {eventsOnDay.length > 0 && (
                          <div className="calendar-event-bars">
                            {eventsOnDay.map((ev) => {
                              const prevCell = calendarCells[idx - 1];
                              const nextCell = calendarCells[idx + 1];

                              const prevHasSame =
                                prevCell &&
                                prevCell.date &&
                                prevCell.events.some(
                                  (e) => e.id === ev.id
                                );

                              const nextHasSame =
                                nextCell &&
                                nextCell.date &&
                                nextCell.events.some(
                                  (e) => e.id === ev.id
                                );

                              let spanClass = "";
                              if (!prevHasSame && !nextHasSame)
                                spanClass = "event-single";
                              else if (!prevHasSame && nextHasSame)
                                spanClass = "event-start";
                              else if (prevHasSame && nextHasSame)
                                spanClass = "event-middle";
                              else if (prevHasSame && !nextHasSame)
                                spanClass = "event-end";

                              const typeClass =
                                ev.type === "briefing"
                                  ? "bar-briefing"
                                  : ev.type === "workshop"
                                  ? "bar-workshop"
                                  : "bar-etc";

                              return (
                                <span
                                  key={ev.id}
                                  className={`calendar-event-bar ${typeClass} ${spanClass}`}
                                />
                              );
                            })}
                          </div>
                        )}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </section>

          {/* 우측 행사 리스트 카드 */}
          <section className="event-card event-legend-card">
            <ul className="event-legend-list">
              {eventsThisMonth.map((ev) => (
                <li key={ev.id} className="event-legend-item">
                  <span
                    className={`legend-pill ${
                      ev.type === "briefing"
                        ? "legend-briefing"
                        : ev.type === "workshop"
                        ? "legend-workshop"
                        : "legend-etc"
                    }`}
                  />
                  <span className="legend-name">{ev.title}</span>
                  <span className="legend-dates">
                    {formatDisplayDate(ev.startDate)} -{" "}
                    {formatDisplayDate(ev.endDate)}
                  </span>
                </li>
              ))}

              {!eventsThisMonth.length && (
                <li className="event-legend-item no-events">
                  이번 달에는 등록된 행사가 없습니다.
                </li>
              )}
            </ul>
          </section>
        </div>

        {/* 중간 버튼 영역: 행사 추가 + 검색 */}
        <div className="event-middle-actions">
          <button
            type="button"
            className="event-add-toggle-btn"
            onClick={() => setShowAddForm((prev) => !prev)}
          >
            행사 추가
          </button>
          <button
            type="button"
            className="event-search-btn"
            onClick={handleTogglePeriodFilter}
          >
            기간 검색
          </button>
          <button
            type="button"
            className="event-search-btn"
            onClick={handleToggleKeywordFilter}
          >
            키워드 검색
          </button>
        </div>

        {/* 필터 입력 영역 */}
        <div className="event-filters">
          {showPeriodFilter && (
            <div className="event-filter-row">
              <span className="filter-label">기간</span>
              <input
                type="date"
                value={searchStart}
                onChange={(e) => {
                  setSearchStart(e.target.value);
                  setSelectedDate(null);
                }}
              />
              <span className="filter-separator">~</span>
              <input
                type="date"
                value={searchEnd}
                onChange={(e) => {
                  setSearchEnd(e.target.value);
                  setSelectedDate(null);
                }}
              />
              <button
                type="button"
                className="filter-reset-btn"
                onClick={clearPeriodFilter}
              >
                초기화
              </button>
            </div>
          )}

          {showKeywordFilter && (
            <div className="event-filter-row">
              <span className="filter-label">키워드</span>
              <input
                type="text"
                placeholder="행사명을 입력하세요"
                value={searchKeyword}
                onChange={(e) => {
                  setSearchKeyword(e.target.value);
                  setSelectedDate(null);
                }}
              />
              <button
                type="button"
                className="filter-reset-btn"
                onClick={clearKeywordFilter}
              >
                초기화
              </button>
            </div>
          )}
        </div>

        {/* 하단: 행사 리스트 카드 */}
        <div className="event-bottom-row">
          <section className="event-card event-list-card">
            <div className="event-selected-info">
              {selectedDate && (
                <span>선택한 날짜 : {formatDisplayFromDate(selectedDate)}</span>
              )}
            </div>

            {showAddForm && (
              <form className="event-add-form" onSubmit={handleAddEvent}>
                <div className="event-add-row">
                  <label className="event-add-label">
                    제목
                    <input
                      type="text"
                      name="title"
                      value={formState.title}
                      onChange={handleFormChange}
                      placeholder="행사 제목"
                    />
                  </label>

                  <label className="event-add-label">
                    시작일
                    <input
                      type="date"
                      name="startDate"
                      value={formState.startDate}
                      onChange={handleFormChange}
                    />
                  </label>

                  <label className="event-add-label">
                    종료일
                    <input
                      type="date"
                      name="endDate"
                      value={formState.endDate}
                      onChange={handleFormChange}
                    />
                  </label>

                  <label className="event-add-label">
                    구분
                    <select
                      name="type"
                      value={formState.type}
                      onChange={handleFormChange}
                    >
                      <option value="briefing">사업설명회</option>
                      <option value="workshop">워크샵</option>
                      <option value="etc">기타</option>
                    </select>
                  </label>

                  <button type="submit" className="event-add-submit-btn">
                    추가
                  </button>
                </div>
              </form>
            )}

            <table className="event-table">
              <tbody>
                {displayedEvents.map((ev) => (
                  <tr key={ev.id}>
                    <td className="event-table-name">{ev.title}</td>
                    <td className="event-table-dates">
                      {formatDisplayDate(ev.startDate)} -{" "}
                      {formatDisplayDate(ev.endDate)}
                    </td>
                    <td className="event-table-actions">
                      <button
                        type="button"
                        className="event-delete-btn"
                        onClick={() => handleDeleteEvent(ev.id)}
                      >
                        삭제
                      </button>
                    </td>
                  </tr>
                ))}

                {!displayedEvents.length && (
                  <tr>
                    <td colSpan={3} className="event-table-empty">
                      {events.length === 0
                        ? "등록된 행사가 없습니다. '행사 추가' 버튼으로 새 행사를 등록해보세요."
                        : selectedDate
                        ? "선택한 날짜에 해당하는 행사가 없습니다."
                        : "현재 조건에 해당하는 행사가 없습니다."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </section>
        </div>
      </div>
    </main>
  );
};

export default EventPage;
