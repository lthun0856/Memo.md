// 달력 창 로직 — 월간/주간/일간 뷰 (4단계).
// 공휴일/음력은 다음 단계에서 추가함.
// 날짜는 항상 로컬 기준으로 계산(UTC 변환 금지 — 인계서 규칙).

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
const MAX_CHIPS = 3;      // 월간: 한 칸에 보여줄 일정 개수(넘으면 "+N")
const MAX_CHIPS_WEEK = 10; // 주간: 칸이 세로로 길어서 더 많이 보여줌
const MAX_LEDGER_CHIPS = 3; // 가계부: 한 칸에 보여줄 지출 건수(넘으면 "+N")

// 현재 보고 있는 날짜(오늘 기준으로 시작)와 보기 방식
const state = {
  view: 'month', // 'month' | 'week' | 'day'
  year: 0,
  month: 0, // 0~11
  day: 1,   // 주간/일간 뷰의 기준 날짜
};

// 주 시작 요일: 0=일요일, 1=월요일 (설정에서 바꿈)
let weekStart = 0;
// 음력 날짜 표시 여부 (설정에서 켬/끔, 기본 켬)
let showLunar = true;
// 음력 변환 결과 캐시: "YYYY-MM-DD" -> { m, d, leap } (없는 날짜는 null)
let lunarCache = {};
// 공휴일 캐시: "YYYY"(연도 문자열) -> { "YYYY-MM-DD": "이름" } (연도 단위로 통째로 받아둠)
let holidayCache = {};
// 잠금(배경) 상태 — 평소엔 true라 클릭해도 반응 안 함. 더블클릭하면 풀리고, 포커스 잃으면 다시 잠김
let locked = true;

// ---- 가계부 ----
// 모드: 'calendar'(일정 표시, 기존 그대로) | 'ledger'(가계부 — 일정 숨기고 지출만 표시)
let mode = 'calendar';
let ledgerCategories = []; // [{id,name,color}]
let ledgerEntries = [];    // [{id,date:"YYYY-MM-DD",categoryId,amount,memo}]
// 가계부 설정(ledger.json의 settings): 월급날·주간/월간 예산·고정지출. 없으면 전부 null/[]
let ledgerSettings = { payday: null, weeklyBudget: null, monthlyBudget: null, fixed: [] };
// 위트 멘트 문구(데이터 폴더 멘트.json — 앱 시작 때 한 번 읽음. 수정은 파일에서, 재시작하면 반영)
let ledgerMents = null;
// 날짜별 집계: "YYYY-MM-DD" -> { total, byCat: {분류id: 금액} }
let spendByDate = {};
const DELETED_CAT_COLOR = '#8A8577'; // 삭제된 분류의 기록에 쓰는 회색

// 메모 일정 데이터: "YYYY-MM-DD" -> [{ id, title, color, hasAlarm, time }]
let eventsByDate = {};
let memosCache = [];   // 마지막으로 불러온 전체 메모(그날 목록/새 메모에 사용)
let topicsCache = [];  // 마지막으로 불러온 전체 주제(새 메모 주제 선택에 사용)
const NEW_MEMO_TIME = '09:00'; // 달력에서 새 메모 만들 때 기본 시각(메모창에서 바꿀 수 있음)

// scheduleAt("YYYY-MM-DDTHH:mm", 로컬)에서 날짜 부분만 문자열로 잘라 씀 → Date 변환 안 해서
// 타임존 문제 원천 차단(인계서 규칙). 시각(HH:mm)은 같은 날 안에서 정렬용으로만 사용.
// scheduleAt("YYYY-MM-DDTHH:mm")에서 화면에 보여줄 시각만 뽑음.
// 00:00은 빠른 입력칸에서 "시각 안 적음"으로 저장한 값이라 빈 값으로 돌려줘서 안 보이게 함
// (진짜 자정 일정도 시각이 안 보이지만, 자정에 일정을 잡는 일은 사실상 없어서 이렇게 둠)
function scheduleTimeLabel(scheduleAt) {
  if (typeof scheduleAt !== 'string' || scheduleAt.length < 16) return '';
  const t = scheduleAt.slice(11, 16);
  return t === '00:00' ? '' : t;
}

function loadEvents(memos, topics) {
  const colorByTopic = {};
  (topics || []).forEach((t) => {
    colorByTopic[t.id] = t.memoColor || t.color || null;
  });

  const map = {};
  (memos || []).forEach((m) => {
    if (!m.scheduleAt || typeof m.scheduleAt !== 'string') return;
    const dateKey = m.scheduleAt.slice(0, 10); // "YYYY-MM-DD"
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return;
    const time = scheduleTimeLabel(m.scheduleAt);
    const color = m.color || colorByTopic[m.topicId] || '#C9A24B';
    const title = (m.title && m.title.trim()) ? m.title.trim() : '(제목 없음)';
    const hasAlarm = !!(m.alarm && m.alarm.enabled);
    (map[dateKey] || (map[dateKey] = [])).push({ id: m.id, title, color, hasAlarm, time });
  });

  // 같은 날 안에서는 시각 순으로 정렬(시각 없는 건 뒤로)
  Object.keys(map).forEach((k) => {
    map[k].sort((a, b) => (a.time || '99:99').localeCompare(b.time || '99:99'));
  });
  eventsByDate = map;
}

async function reloadData() {
  if (!window.api) return; // 미리보기 등 api 없는 환경 방어
  try {
    const [memos, topics] = await Promise.all([
      window.api.getAllMemos(),
      window.api.getTopics()
    ]);
    memosCache = memos || [];
    topicsCache = topics || [];
    loadEvents(memosCache, topicsCache);
    render();
  } catch (e) {
    // 데이터 로드 실패해도 달력 뼈대는 계속 보이게(조용히 무시)
  }
}

// ---- 가계부 데이터 ----
async function reloadLedger() {
  if (!window.api || !window.api.getLedger) return;
  try {
    const ledger = await window.api.getLedger();
    ledgerCategories = (ledger && ledger.categories) || [];
    ledgerEntries = (ledger && ledger.entries) || [];
    if (ledger && ledger.settings) ledgerSettings = ledger.settings;
    computeSpend();
  } catch (e) { /* 실패해도 달력은 계속 동작 */ }
}

// 지출 기록을 날짜별로 합산해둠(그리기 전에 한 번만 계산)
function computeSpend() {
  const map = {};
  ledgerEntries.forEach((en) => {
    if (!en || !en.date || !Number.isFinite(en.amount)) return;
    const slot = map[en.date] || (map[en.date] = { total: 0, byCat: {} });
    slot.total += en.amount;
    slot.byCat[en.categoryId] = (slot.byCat[en.categoryId] || 0) + en.amount;
  });
  spendByDate = map;
}

function catById(id) {
  return ledgerCategories.find((c) => c.id === id) || null;
}

// 그날 가장 많이 쓴 분류의 색(같으면 앞 분류). 분류가 삭제됐으면 회색
function topCategoryColor(dateKey) {
  const slot = spendByDate[dateKey];
  if (!slot) return DELETED_CAT_COLOR;
  let bestId = null, bestAmt = -1;
  Object.keys(slot.byCat).forEach((cid) => {
    if (slot.byCat[cid] > bestAmt) { bestAmt = slot.byCat[cid]; bestId = cid; }
  });
  const cat = catById(bestId);
  return (cat && cat.color) || DELETED_CAT_COLOR;
}

// 금액 표시: 쉼표 구분. 칸이 좁아서 100만 이상이면 "만" 단위로 줄임(전체 값은 title로)
function formatWon(n) {
  return (n || 0).toLocaleString('ko-KR');
}
function formatWonShort(n) {
  if (n >= 1000000) {
    const man = n / 10000;
    return (man >= 1000 ? Math.round(man).toLocaleString('ko-KR') : Math.round(man)) + '만';
  }
  return formatWon(n);
}

// ---- 월급날 기준 집계 도우미 ----
// 날짜는 전부 "YYYY-MM-DD" 문자열 비교(사전순 = 시간순)로 처리 — UTC 변환 없음(인계서 규칙)
function pad2(n) { return String(n).padStart(2, '0'); }
function daysInMonth(y, m) { return new Date(y, m + 1, 0).getDate(); } // m: 0~11

// dateKey에서 delta일 만큼 이동한 날짜키(로컬 계산)
function addDaysKey(dateKey, delta) {
  const y = +dateKey.slice(0, 4), m = +dateKey.slice(5, 7) - 1, d = +dateKey.slice(8, 10);
  const dt = new Date(y, m, d + delta);
  return dateKeyOf(dt.getFullYear(), dt.getMonth(), dt.getDate());
}

// (y,m)월 화면에 보여줄 집계 구간 {from, to} (양끝 포함).
// 월급날이 없거나 1일이면 기존 그대로 1일~말일. 월급날이 있으면 "이달 월급날 ~ 다음달 월급 전날".
// 그 달에 월급날이 없으면(예: 31일 + 2월) 말일로 맞춤(setMonth 안 씀 — 인계서 규칙)
function ledgerPeriodOf(y, m, payday) {
  if (!payday || payday <= 1) {
    return { from: dateKeyOf(y, m, 1), to: dateKeyOf(y, m, daysInMonth(y, m)) };
  }
  const from = dateKeyOf(y, m, Math.min(payday, daysInMonth(y, m)));
  const ny = m === 11 ? y + 1 : y;
  const nm = (m + 1) % 12;
  const nextPayday = Math.min(payday, daysInMonth(ny, nm)); // payday>=2라 -1해도 항상 1 이상
  return { from, to: dateKeyOf(ny, nm, nextPayday - 1) };
}

// dateKey가 속한 집계 구간(멘트 판정용). 월급날 전이면 지난달 월급날부터 시작하는 구간
function periodContaining(dateKey, payday) {
  const y = +dateKey.slice(0, 4), m = +dateKey.slice(5, 7) - 1, d = +dateKey.slice(8, 10);
  if (!payday || payday <= 1) return ledgerPeriodOf(y, m, null);
  if (d >= Math.min(payday, daysInMonth(y, m))) return ledgerPeriodOf(y, m, payday);
  const py = m === 0 ? y - 1 : y;
  const pm = (m + 11) % 12;
  return ledgerPeriodOf(py, pm, payday);
}

// ---- 통계 보드 계산 도우미(전부 순수 함수 — DOM 없이 테스트 가능) ----

// (y,m)에서 delta개월 이동한 {y,m}. setMonth 안 씀(인계서 규칙) — 나머지 연산만으로 계산
function shiftYM(y, m, delta) {
  const total = m + delta;
  const ny = y + Math.floor(total / 12);
  const nm = ((total % 12) + 12) % 12;
  return { y: ny, m: nm };
}

// (y,m) 기준 최근 count개 월급 사이클 구간을 오래된 → 최신 순으로 반환 [{y,m,from,to}]
// (마지막 항목이 항상 (y,m) 자신의 구간 = 지금 보고 있는 달)
function ledgerPeriodsTrend(y, m, payday, count) {
  const list = [];
  for (let i = count - 1; i >= 0; i--) {
    const p = shiftYM(y, m, -i);
    const period = ledgerPeriodOf(p.y, p.m, payday);
    list.push({ y: p.y, m: p.m, from: period.from, to: period.to });
  }
  return list;
}

// entries 중 from~to(양끝 포함) 사이 금액 합
function sumEntriesInRange(entries, from, to) {
  let total = 0;
  (entries || []).forEach((en) => {
    if (en && en.date >= from && en.date <= to && Number.isFinite(en.amount)) total += en.amount;
  });
  return total;
}

// entries 중 from~to(양끝 포함) 사이를 분류별로 합산 + 총합
function sumByCatInRange(entries, from, to) {
  const byCat = {};
  let total = 0;
  (entries || []).forEach((en) => {
    if (!en || !en.date || en.date < from || en.date > to || !Number.isFinite(en.amount)) return;
    byCat[en.categoryId] = (byCat[en.categoryId] || 0) + en.amount;
    total += en.amount;
  });
  return { byCat, total };
}

// 지난 사이클 대비 증감 판정(순수 함수). kind: 'empty'|'noPrev'|'same'|'up'|'down'
function ledgerCycleDiff(curTotal, prevTotal) {
  if (curTotal <= 0 && prevTotal <= 0) return { kind: 'empty' };
  if (prevTotal <= 0) return { kind: 'noPrev', curTotal };
  const diff = curTotal - prevTotal;
  if (diff === 0) return { kind: 'same', curTotal, prevTotal };
  const pct = Math.round(Math.abs(diff) / prevTotal * 100);
  return { kind: diff > 0 ? 'up' : 'down', curTotal, prevTotal, diff, pct };
}

// ---- 위트 멘트(예산 초과 등 상황별 토스트) ----
// 지출 "추가" 직전/직후의 집계를 비교해서, 문턱을 "처음 넘는 순간"에만 한 번 뜸.
// 문구는 멘트.json에서 랜덤 선택. 저장 안 하고 몇 초 뒤 사라지는 재미 기능.

// dateKey 기준의 집계 묶음(멘트 판정에 필요한 것 전부 — 순수 계산이라 테스트하기 쉬움)
function ledgerStatsFor(entries, dateKey, payday, weekStartDow) {
  const period = periodContaining(dateKey, payday);
  const prevPeriod = periodContaining(addDaysKey(period.from, -1), payday);
  const y = +dateKey.slice(0, 4), m = +dateKey.slice(5, 7) - 1, d = +dateKey.slice(8, 10);
  const wOffset = (new Date(y, m, d).getDay() - weekStartDow + 7) % 7;
  const weekFrom = addDaysKey(dateKey, -wOffset);
  const week = { from: weekFrom, to: addDaysKey(weekFrom, 6) };
  const prevWeek = { from: addDaysKey(weekFrom, -7), to: addDaysKey(weekFrom, -1) };
  const d1 = addDaysKey(dateKey, -1), d3 = addDaysKey(dateKey, -3);
  const d4 = addDaysKey(dateKey, -10), d4end = addDaysKey(dateKey, -4);
  const st = {
    periodTotal: 0, prevPeriodTotal: 0, weekTotal: 0, prevWeekTotal: 0,
    dayTotal: 0, dayCount: 0, cultureTotal: 0, foodTotal: 0,
    prev3Total: 0,      // 직전 3일 합(무지출 판정)
    prev4to10Total: 0   // 그 전 일주일 합(원래 지출이 있던 사람인지 확인용)
  };
  (entries || []).forEach((en) => {
    if (!en || !en.date || !Number.isFinite(en.amount)) return;
    const dt = en.date;
    if (dt >= period.from && dt <= period.to) {
      st.periodTotal += en.amount;
      if (en.categoryId === 'culture') st.cultureTotal += en.amount;
      if (en.categoryId === 'food') st.foodTotal += en.amount;
    }
    if (dt >= prevPeriod.from && dt <= prevPeriod.to) st.prevPeriodTotal += en.amount;
    if (dt >= week.from && dt <= week.to) st.weekTotal += en.amount;
    if (dt >= prevWeek.from && dt <= prevWeek.to) st.prevWeekTotal += en.amount;
    if (dt === dateKey) { st.dayTotal += en.amount; st.dayCount += 1; }
    if (dt >= d3 && dt <= d1) st.prev3Total += en.amount;
    if (dt >= d4 && dt <= d4end) st.prev4to10Total += en.amount;
  });
  return st;
}

// 어떤 멘트 상황인지 판정(순수 함수). 여러 개 겹치면 위쪽(더 심각/재밌는 순)이 이김.
// 반환: { key: 멘트.json의 상황 이름, budgetScope: 'month'|'week'(예산 멘트만), once: 월1회 여부 } 또는 null
function judgeMentSituation(before, after, opts) {
  const o = opts || {};
  const crossed = (b, a, limit) => b < limit && a >= limit;
  // 1) 예산 80/100/150% — 150이 최우선. 월간·주간 예산 둘 다 있으면 월간부터 확인
  const budgets = [];
  if (o.monthlyBudget) budgets.push({ b: before.periodTotal, a: after.periodTotal, budget: o.monthlyBudget, scope: 'month' });
  if (o.weeklyBudget) budgets.push({ b: before.weekTotal, a: after.weekTotal, budget: o.weeklyBudget, scope: 'week' });
  const levels = [{ r: 1.5, key: '예산150' }, { r: 1.0, key: '예산100' }, { r: 0.8, key: '예산80' }];
  for (const lv of levels) {
    for (const c of budgets) {
      if (crossed(c.b, c.a, c.budget * lv.r)) return { key: lv.key, budgetScope: c.scope };
    }
  }
  // 2) 하루 지출이 월 예산의 20%를 처음 넘는 순간
  if (o.monthlyBudget && crossed(before.dayTotal, after.dayTotal, o.monthlyBudget * 0.2)) {
    return { key: '하루큰지출' };
  }
  // 3) 25일 이후인데 월 예산 절반 미만(칭찬, 월 1회)
  if (o.monthlyBudget && o.todayDay >= 25 && after.periodTotal < o.monthlyBudget * 0.5) {
    return { key: '절약왕', once: true };
  }
  // (변경 2026-07-24 태훈님 결정) 예산 없이도 뜨던 멘트(문화·여가 비중, 식비 비중,
  // 하루 5건, 무지출 복귀)는 전부 뺌 — "예산을 모르는데 비중을 알 수 없다".
  // 멘트는 예산이 잡혀 있을 때만 발동. 문구는 멘트.json에 남아 있음(재사용 가능).
  return null;
}

// 상황 이름으로 멘트 하나 랜덤 선택
function pickMent(key) {
  const list = ledgerMents && Array.isArray(ledgerMents[key]) ? ledgerMents[key] : null;
  if (!list || !list.length) return null;
  return list[Math.floor(Math.random() * list.length)];
}

// 월 1회 멘트(문화부족·절약왕)가 이번 달 이미 떴는지 — localStorage에 표식만 남김
function mentOncePerMonth(key, ymKey) {
  const k = `calMent:${key}:${ymKey}`;
  try {
    if (localStorage.getItem(k)) return false;
    localStorage.setItem(k, '1');
  } catch (e) { /* localStorage 못 써도 멘트는 뜨게 둠 */ }
  return true;
}

// 말풍선 토스트: 달력 안에 잠깐 떴다가 사라짐(저장 안 함)
function showLedgerToast(text) {
  const root = document.getElementById('cal-root');
  if (!root) return;
  const old = root.querySelector('.cal-toast');
  if (old) old.remove();
  const t = document.createElement('div');
  t.className = 'cal-toast';
  String(text).split('\n').forEach((line) => {
    const p = document.createElement('div');
    p.textContent = line;
    t.appendChild(p);
  });
  root.appendChild(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => {
    t.classList.remove('show');
    setTimeout(() => t.remove(), 400);
  }, 5000);
}

// 지출 추가 직후 호출: 저장 전 집계(before)와 지금 집계를 비교해 멘트를 띄울지 정함.
// 발동 규칙(2026-07-24 태훈님 확정): ①예산이 잡혀 있을 때만 ②오늘 날짜에 입력할 때만
// (과거 날짜 정리 입력은 조용히) ③하루 최대 1회 — 단 예산 100%·150% 초과는 예외로 항상
function maybeShowLedgerMent(before, dateKey, entryCategoryId) {
  try {
    if (!ledgerMents || !before) return;
    const s = ledgerSettings || {};
    const today = todayParts();
    const todayKey = dateKeyOf(today.y, today.m, today.d);
    if (dateKey !== todayKey) return; // 오늘 입력에만 발동
    const after = ledgerStatsFor(ledgerEntries, dateKey, s.payday, weekStart);
    let sit = judgeMentSituation(before, after, {
      weeklyBudget: s.weeklyBudget,
      monthlyBudget: s.monthlyBudget,
      entryCategoryId,
      todayDay: today.d
    });
    // 월급날을 안 정했으면 잔소리(주 1회) — 예산 멘트가 없을 때만
    if (!sit && !s.payday) sit = { key: '월급날미정', weekly: true };
    if (!sit) return;
    // 하루 1회 제한(예산 100%·150% 초과는 중요하니 예외)
    const urgent = sit.key === '예산100' || sit.key === '예산150';
    const dayFlag = `calMentDay:${todayKey}`;
    try { if (!urgent && localStorage.getItem(dayFlag)) return; } catch (e) { /* 무시 */ }
    const ymKey = `${today.y}-${pad2(today.m + 1)}`;
    if (sit.once && !mentOncePerMonth(sit.key, ymKey)) return;
    if (sit.weekly) {
      // 주 1회 표식: 이번 주 시작일을 키로 씀
      const wOff = (new Date(today.y, today.m, today.d).getDay() - weekStart + 7) % 7;
      const weekKey = addDaysKey(todayKey, -wOff);
      if (!mentOncePerMonth(sit.key, weekKey)) return;
    }
    let text = pickMent(sit.key);
    if (!text) return;
    // 예산 멘트 뒤엔 지난주/지난달 비교를 한 줄 덧붙임(비교할 지난 기록이 있을 때만)
    if (sit.key === '예산80' || sit.key === '예산100' || sit.key === '예산150') {
      const weekUp = after.prevWeekTotal > 0 && after.weekTotal > after.prevWeekTotal;
      const monthUp = after.prevPeriodTotal > 0 && after.periodTotal > after.prevPeriodTotal;
      let extra = null;
      if (sit.budgetScope === 'week' && weekUp) {
        const n = Math.round((after.weekTotal / after.prevWeekTotal - 1) * 100);
        extra = (pickMent('비교_지난주') || '').replace('{N}', n);
      } else if (monthUp) {
        extra = pickMent('비교_지난달');
      } else if (weekUp) {
        const n = Math.round((after.weekTotal / after.prevWeekTotal - 1) * 100);
        extra = (pickMent('비교_지난주') || '').replace('{N}', n);
      }
      if (extra) text += '\n' + extra;
    }
    showLedgerToast(text);
    try { localStorage.setItem(dayFlag, '1'); } catch (e) { /* 무시 */ }
  } catch (e) { /* 재미 기능이라 실패해도 조용히 넘어감 */ }
}

// 설정에서 달력 관련 값 읽기(주 시작 요일·음력 표시. 없으면 일요일 시작·음력 켬)
async function loadCalendarSettings() {
  if (!window.api || !window.api.getSettings) return;
  try {
    const s = await window.api.getSettings();
    weekStart = (s && s.calendar && s.calendar.weekStart === 'mon') ? 1 : 0;
    showLunar = !(s && s.calendar && s.calendar.showLunar === false);
    // 달력 배경색(설정 > 달력). CSS 변수 하나만 바꾸면 전체 배경이 따라감
    const bg = (s && s.calendar && s.calendar.bgColor) || '#F7F4EC';
    document.documentElement.style.setProperty('--paper', bg);
    // 공휴일 캐시 초기화 — 설정을 다시 읽는 시점(최초 실행 + ⚙설정 변경 시)마다 비워서,
    // API 키를 새로 넣거나 바꿨을 때 곧바로 다시 시도하게 함(안 비우면 "키 없음" 결과가 계속 남음)
    holidayCache = {};
  } catch (e) { /* 실패시 기본값 유지 */ }
}

// 잠금 상태 전환: 잠기면 떠있던 패널을 닫고, 화면에 잠금 표시(🔒)·클릭 반응 없음
function setLocked(v) {
  locked = v;
  document.getElementById('cal-root').classList.toggle('locked', v);
  if (v) closeOverlays();
}

// 음력 표기: { m:6, d:9, leap:false } → "음 6.9" (윤달이면 "윤 6.9")
function lunarText(l) {
  if (!l) return '';
  return (l.leap ? '윤 ' : '음 ') + l.m + '.' + l.d;
}

// 화면에 만들어둔 음력 자리(data-lunar-for)들을 채움.
// 캐시에 없는 날짜만 모아 메인에 한 번에 요청(칸마다 따로 부르지 않음 — 인계서 규칙).
async function annotateLunar() {
  if (!showLunar) return;
  const spots = Array.from(document.querySelectorAll('[data-lunar-for]'));
  if (!spots.length) return;
  const missing = [...new Set(
    spots.map((s) => s.dataset.lunarFor).filter((k) => !(k in lunarCache))
  )];
  if (missing.length && window.api && window.api.getLunarMap) {
    try {
      const got = await window.api.getLunarMap(missing);
      missing.forEach((k) => { lunarCache[k] = (got && got[k]) ? got[k] : null; });
    } catch (e) { return; /* 변환 실패시 음력만 조용히 생략 */ }
  }
  spots.forEach((s) => {
    const l = lunarCache[s.dataset.lunarFor];
    if (l) s.textContent = lunarText(l);
  });
}

// 화면에 만들어둔 공휴일 이름 자리(data-holiday-for)들을 채움. 그리드에 걸친 연도만 모아서
// 한꺼번에 요청(달마다 부르지 않음 — 음력과 같은 원칙). API 키가 없으면 메인이 빈 값을 돌려줌.
async function annotateHolidays() {
  const spots = Array.from(document.querySelectorAll('[data-holiday-for]'));
  if (!spots.length) return;
  const years = [...new Set(spots.map((s) => s.dataset.holidayFor.slice(0, 4)))];
  const missing = years.filter((y) => !(y in holidayCache));
  if (missing.length && window.api && window.api.getHolidays) {
    await Promise.all(missing.map(async (y) => {
      try {
        const got = await window.api.getHolidays(Number(y));
        holidayCache[y] = got || {};
      } catch (e) { holidayCache[y] = {}; }
    }));
  }
  spots.forEach((s) => {
    const key = s.dataset.holidayFor;
    const name = (holidayCache[key.slice(0, 4)] || {})[key];
    const cell = s.closest('.cal-cell');
    if (name) {
      s.textContent = name;
      s.style.display = '';
      if (cell) cell.classList.add('holiday');
    } else {
      s.style.display = 'none';
      if (cell) cell.classList.remove('holiday');
    }
  });
}

// 오늘 날짜(연/월/일)를 로컬로 구해둠 — "오늘 강조"와 "지난 날짜" 판단용
function todayParts() {
  const d = new Date();
  return { y: d.getFullYear(), m: d.getMonth(), d: d.getDate() };
}

// 두 날짜(연,월,일)를 숫자로 비교하기 쉽게 YYYYMMDD 정수로
function ymd(y, m, d) {
  return y * 10000 + (m + 1) * 100 + d;
}

function dateKeyOf(y, m, d) {
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function renderWeekdays() {
  const host = document.getElementById('cal-weekdays');
  host.classList.toggle('ledger-mode', mode === 'ledger'); // 가계부 모드는 오른쪽에 합계열 추가
  host.innerHTML = '';
  for (let i = 0; i < 7; i++) {
    const dow = (i + weekStart) % 7; // 주 시작 요일에 따라 순서만 밀림
    const el = document.createElement('div');
    el.className = 'cal-weekday' + (dow === 0 ? ' sun' : dow === 6 ? ' sat' : '');
    el.textContent = WEEKDAYS[dow];
    host.appendChild(el);
  }
  if (mode === 'ledger') {
    const el = document.createElement('div');
    el.className = 'cal-weekday cal-weeksum-head';
    el.textContent = '합계';
    host.appendChild(el);
  }
}

// 주간 뷰의 시작일(그 주 첫 요일의 날짜)을 로컬 Date로
function weekStartDate() {
  const base = new Date(state.year, state.month, state.day);
  const offset = (base.getDay() - weekStart + 7) % 7;
  return new Date(state.year, state.month, state.day - offset);
}

function renderTitle() {
  const el = document.getElementById('cal-title');
  // 가계부 모드는 제목에 💰가계부를 붙여 한눈에 구분(가계부는 월간만 씀)
  if (mode === 'ledger') {
    el.textContent = `${state.year}년 ${state.month + 1}월 💰가계부`;
    return;
  }
  if (state.view === 'month') {
    el.textContent = `${state.year}년 ${state.month + 1}월`;
  } else if (state.view === 'week') {
    const s = weekStartDate();
    const e = new Date(s.getFullYear(), s.getMonth(), s.getDate() + 6);
    el.textContent =
      `${s.getFullYear()}년 ${s.getMonth() + 1}.${s.getDate()} ~ ${e.getMonth() + 1}.${e.getDate()}`;
  } else {
    const dow = new Date(state.year, state.month, state.day).getDay();
    el.textContent = `${state.year}년 ${state.month + 1}월 ${state.day}일 (${WEEKDAYS[dow]})`;
  }
}

// 날짜 칸 하나 만들기(월간/주간 공용)
function buildDayCell(cellY, cellM, cellD, otherMonth, dow, todayNum, maxChips) {
  const cell = document.createElement('div');
  cell.className = 'cal-cell';

  if (dow === 0) cell.classList.add('sun');
  if (dow === 6) cell.classList.add('sat');
  if (otherMonth) cell.classList.add('other-month');

  const cellNum = ymd(cellY, cellM, cellD);
  if (!otherMonth && cellNum === todayNum) cell.classList.add('today');
  // (2026-08-15) past/future는 지난달·다음달 칸에도 붙임 — 안 붙이면 첫 줄만 배경이 달라서
  // 구분선이 중간에 끊긴 것처럼 보임. 글자 흐리게 하는 건 CSS에서 other-month를 빼둠
  if (cellNum < todayNum) cell.classList.add('past');
  else if (cellNum > todayNum) cell.classList.add('future');

  // 날짜 숫자
  const num = document.createElement('div');
  num.className = 'cal-daynum';
  num.textContent = cellD;
  cell.appendChild(num);

  const dateKey = dateKeyOf(cellY, cellM, cellD);
  cell.dataset.date = dateKey;
  cell.dataset.otherMonth = otherMonth ? '1' : '0';

  // 공휴일 이름 자리(숫자 밑에 작게, 빨간 글씨). showLunar 설정과 무관하게 항상 만들어두고,
  // annotateHolidays()가 한꺼번에 채움(공휴일이 아니면 자동으로 숨겨짐). 캐시에 이미 있으면 즉시 표시
  const holi = document.createElement('span');
  holi.className = 'cal-holiday-name';
  holi.dataset.holidayFor = dateKey;
  holi.style.display = 'none';
  const holiCached = holidayCache[dateKey.slice(0, 4)];
  if (holiCached && holiCached[dateKey]) {
    holi.textContent = holiCached[dateKey];
    holi.style.display = '';
    cell.classList.add('holiday');
  }
  cell.appendChild(holi);

  // 음력 자리(숫자 밑에 작게). 값은 annotateLunar()가 한꺼번에 채움(캐시에 있으면 즉시)
  if (showLunar) {
    const lun = document.createElement('span');
    lun.className = 'cal-lunar';
    lun.dataset.lunarFor = dateKey;
    const cached = lunarCache[dateKey];
    if (cached) lun.textContent = lunarText(cached);
    cell.appendChild(lun);
  }

  // 가계부 모드: 일정 칩 대신 지출 내역 칩 + 그날 합계 표시(태훈님 확정 — 일정은 숨김)
  if (mode === 'ledger') {
    if (!otherMonth) {
      const slot = spendByDate[dateKey];
      if (slot && slot.total > 0) {
        cell.classList.add('has-spend');

        // 지출 건별 칩: "분류명 금액" (메모는 칸에 안 보여줌 — 날짜 클릭 목록에서만. 태훈님 확정)
        const entries = entriesOnDate(dateKey);
        const box = document.createElement('div');
        box.className = 'cal-events';
        entries.slice(0, MAX_LEDGER_CHIPS).forEach((en) => {
          const cat = catById(en.categoryId);
          const chip = document.createElement('div');
          chip.className = 'cal-event';
          chip.style.borderLeftColor = (cat && cat.color) || DELETED_CAT_COLOR;
          chip.title = `${(cat && cat.name) || '(삭제된 분류)'} ${formatWon(en.amount)}원`
            + (en.memo ? ` — ${en.memo}` : '');
          const t = document.createElement('span');
          t.className = 'cal-event-title';
          t.textContent = `${(cat && cat.name) || '(삭제됨)'} ${formatWonShort(en.amount)}`;
          chip.appendChild(t);
          box.appendChild(chip);
        });
        if (entries.length > MAX_LEDGER_CHIPS) {
          const more = document.createElement('div');
          more.className = 'cal-more';
          more.textContent = `+${entries.length - MAX_LEDGER_CHIPS}`;
          box.appendChild(more);
        }
        cell.appendChild(box);

        // 맨 아래 그날 합계(제일 많이 쓴 분류 색) — 기존 그대로
        const amt = document.createElement('div');
        amt.className = 'cal-spend';
        amt.textContent = formatWonShort(slot.total);
        amt.title = formatWon(slot.total) + '원';
        amt.style.color = topCategoryColor(dateKey); // 제일 많이 쓴 분류 색
        cell.appendChild(amt);
      }
      // 날짜 클릭 → 지출 입력/목록 패널
      cell.addEventListener('click', () => { if (!locked) openLedgerPanel(dateKey); });
    }
    return cell;
  }

  // 이 날짜에 일정(메모)이 있으면 주제 색 칩으로 표시(알람 걸린 건 🔔)
  const dayEvents = eventsByDate[dateKey];
  if (dayEvents && dayEvents.length) {
    const box = document.createElement('div');
    box.className = 'cal-events';
    dayEvents.slice(0, maxChips).forEach((ev) => {
      const chip = document.createElement('div');
      chip.className = 'cal-event';
      chip.style.borderLeftColor = ev.color;
      chip.title = (ev.time ? ev.time + ' ' : '') + ev.title;

      const t = document.createElement('span');
      t.className = 'cal-event-title';
      t.textContent = ev.title;
      chip.appendChild(t);

      if (ev.hasAlarm) {
        const bell = document.createElement('span');
        bell.className = 'cal-event-bell';
        bell.textContent = '🔔';
        chip.appendChild(bell);
      }
      // 칩을 직접 누르면 그 메모 열기(칸 클릭으로 목록 뜨는 것과 겹치지 않게 전파 중단)
      chip.addEventListener('click', (e) => {
        e.stopPropagation();
        if (locked) return; // 잠금 중엔 무반응(더블클릭으로 먼저 활성화)
        openMemo(ev.id);
      });
      box.appendChild(chip);
    });
    if (dayEvents.length > maxChips) {
      const more = document.createElement('div');
      more.className = 'cal-more';
      more.textContent = `+${dayEvents.length - maxChips}`;
      box.appendChild(more);
    }
    cell.appendChild(box);
  }

  // 칸을 누르면 그날 메모 목록 패널 표시(월간의 지난달/다음달 칸은 제외, 잠금 중엔 무반응)
  if (!otherMonth) {
    cell.addEventListener('click', () => { if (!locked) openDayPanel(dateKey); });
  }

  return cell;
}

// ---- 월간 뷰 ----
function renderGrid() {
  const grid = document.getElementById('cal-grid');
  grid.className = 'cal-grid' + (mode === 'ledger' ? ' ledger-mode' : '');
  grid.innerHTML = '';

  const { year: y, month: m } = state;
  const today = todayParts();
  const todayNum = ymd(today.y, today.m, today.d);

  // 이 달 1일이 그리드에서 몇 번째 칸인지(주 시작 요일 반영) / 이 달 일수 / 지난달 일수
  const firstDow = (new Date(y, m, 1).getDay() - weekStart + 7) % 7;
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const daysInPrev = new Date(y, m, 0).getDate();

  let weekSum = 0; // 가계부 모드: 이번 달 날짜만 합산(주 오른쪽 끝에 표시)
  let weekByCat = {};        // 그 주 분류별 합계(색막대·클릭 상세용)
  let weekFirstKey = null;   // 그 주에 합산된 이번 달 첫/마지막 날짜(패널 제목용)
  let weekLastKey = null;

  // 6주(42칸) 고정 — 앞쪽은 지난달 꼬리, 뒤쪽은 다음달 머리로 채움
  for (let i = 0; i < 42; i++) {
    let cellY = y, cellM = m, cellD;
    let otherMonth = false;

    if (i < firstDow) {
      // 지난달 꼬리
      cellD = daysInPrev - firstDow + 1 + i;
      cellM = m - 1;
      if (cellM < 0) { cellM = 11; cellY = y - 1; }
      otherMonth = true;
    } else if (i >= firstDow + daysInMonth) {
      // 다음달 머리
      cellD = i - (firstDow + daysInMonth) + 1;
      cellM = m + 1;
      if (cellM > 11) { cellM = 0; cellY = y + 1; }
      otherMonth = true;
    } else {
      // 이번 달
      cellD = i - firstDow + 1;
    }

    const dow = (i + weekStart) % 7; // 실제 요일(색 표시용)
    grid.appendChild(buildDayCell(cellY, cellM, cellD, otherMonth, dow, todayNum, MAX_CHIPS));

    // 가계부 모드: 7칸(한 주)마다 오른쪽에 주간 합계 칸 추가(이번 달 날짜만 합산)
    if (mode === 'ledger') {
      if (!otherMonth) {
        const k = dateKeyOf(cellY, cellM, cellD);
        if (!weekFirstKey) weekFirstKey = k;
        weekLastKey = k;
        const slot = spendByDate[k];
        if (slot) {
          weekSum += slot.total;
          Object.keys(slot.byCat).forEach((cid) => {
            weekByCat[cid] = (weekByCat[cid] || 0) + slot.byCat[cid];
          });
        }
      }
      if (i % 7 === 6) {
        grid.appendChild(buildWeekSumCell(weekSum, weekByCat, weekFirstKey, weekLastKey));
        weekSum = 0; weekByCat = {}; weekFirstKey = null; weekLastKey = null;
      }
    }
  }
}

// 주간 합계 칸: 금액 + 분류별 비율 미니 색막대. 누르면 그 주 분류별 상세 패널
function buildWeekSumCell(total, byCat, firstKey, lastKey) {
  const sumCell = document.createElement('div');
  sumCell.className = 'cal-weeksum';
  if (total > 0) {
    const amt = document.createElement('div');
    amt.className = 'cal-weeksum-amt';
    amt.textContent = formatWonShort(total);
    sumCell.appendChild(amt);

    // 분류별 비율 미니 색막대(큰 순서. 하단 월간 막대와 같은 방식)
    const sorted = Object.keys(byCat).sort((a, b) => byCat[b] - byCat[a]);
    const bar = document.createElement('div');
    bar.className = 'cal-weeksum-bar';
    sorted.forEach((cid) => {
      const cat = catById(cid);
      const seg = document.createElement('div');
      seg.style.width = (byCat[cid] / total * 100) + '%';
      seg.style.background = (cat && cat.color) || DELETED_CAT_COLOR;
      bar.appendChild(seg);
    });
    sumCell.appendChild(bar);

    sumCell.classList.add('clickable');
    sumCell.title = formatWon(total) + '원 — 누르면 분류별 상세';
    sumCell.addEventListener('click', () => {
      if (!locked) openWeekLedgerPanel(total, byCat, firstKey, lastKey);
    });
  }
  return sumCell;
}

// dateKey "YYYY-MM-DD" → "M/D" (주간 상세 제목용 짧은 표기)
function shortDate(dateKey) {
  if (!dateKey) return '';
  const parts = dateKey.split('-').map(Number);
  return parts[1] + '/' + parts[2];
}

// 주간 합계 칸 클릭 → 그 주 분류별 지출 상세 패널
function openWeekLedgerPanel(total, byCat, firstKey, lastKey) {
  closeOverlays();
  const root = document.getElementById('cal-root');
  const ov = document.createElement('div');
  ov.className = 'cal-overlay';

  const head = document.createElement('div');
  head.className = 'cal-overlay-head';
  const back = document.createElement('button');
  back.className = 'cal-ov-btn';
  back.textContent = '‹';
  back.title = '달력으로';
  back.addEventListener('click', closeOverlays);
  const title = document.createElement('div');
  title.className = 'cal-ov-title';
  title.textContent = `${shortDate(firstKey)} ~ ${shortDate(lastKey)} 주간 지출`;
  const spacer = document.createElement('button'); // 좌우 대칭용 투명 버튼
  spacer.className = 'cal-ov-btn';
  spacer.style.visibility = 'hidden';
  spacer.textContent = '‹';
  head.appendChild(back);
  head.appendChild(title);
  head.appendChild(spacer);

  // 분류별 금액(큰 순서) + 맨 아래 합계
  const list = document.createElement('div');
  list.className = 'cal-ov-list';
  const sorted = Object.keys(byCat).sort((a, b) => byCat[b] - byCat[a]);
  sorted.forEach((cid) => {
    const cat = catById(cid);
    const row = document.createElement('div');
    row.className = 'cal-ov-item cal-week-item';
    row.style.borderLeftColor = (cat && cat.color) || DELETED_CAT_COLOR;

    const name = document.createElement('span');
    name.className = 'cal-ledger-catname';
    name.textContent = (cat && cat.name) || '(삭제된 분류)';
    row.appendChild(name);

    const pct = document.createElement('span');
    pct.className = 'cal-week-pct';
    pct.textContent = Math.round(byCat[cid] / total * 100) + '%';
    row.appendChild(pct);

    const amt = document.createElement('span');
    amt.className = 'cal-ledger-amt';
    amt.textContent = formatWon(byCat[cid]);
    row.appendChild(amt);

    list.appendChild(row);
  });
  const totalLine = document.createElement('div');
  totalLine.className = 'cal-ledger-daytotal';
  totalLine.textContent = `합계 ${formatWon(total)}원`;
  list.appendChild(totalLine);

  ov.appendChild(head);
  ov.appendChild(list);
  root.appendChild(ov);
}

// 가계부 모드 하단: 이번달 총합계 + 분류별 색 막대(비율)
function renderLedgerFooter() {
  const foot = document.getElementById('cal-ledgerfoot');
  if (mode !== 'ledger') { foot.style.display = 'none'; return; }
  foot.style.display = '';
  foot.innerHTML = '';

  // 이번 달 지출 집계(분류별). 월급날이 설정돼 있으면 "월급날~다음 월급 전날" 구간으로 묶음
  const payday = ledgerSettings && ledgerSettings.payday;
  const period = ledgerPeriodOf(state.year, state.month, payday);
  const byCat = {};
  let total = 0;
  ledgerEntries.forEach((en) => {
    if (!en.date || en.date < period.from || en.date > period.to) return;
    byCat[en.categoryId] = (byCat[en.categoryId] || 0) + en.amount;
    total += en.amount;
  });

  const totalLine = document.createElement('div');
  totalLine.className = 'cal-ledger-total';
  totalLine.textContent = `이번달 총 ${formatWon(total)}원`;
  if (payday && payday > 1) {
    // 어느 구간의 합인지 궁금할 때 마우스 올리면 보이게
    totalLine.title = `${shortDate(period.from)} ~ ${shortDate(period.to)} 합계 (월급날 기준)`;
  }
  // 월간 예산이 있으면 "예산 대비 N%" — 100% 넘으면 빨강
  const budget = ledgerSettings && ledgerSettings.monthlyBudget;
  if (budget) {
    const pct = Math.round((total / budget) * 100);
    const pctEl = document.createElement('span');
    pctEl.className = 'cal-ledger-budget' + (pct > 100 ? ' over' : '');
    pctEl.textContent = ` · 예산 대비 ${pct}%`;
    pctEl.title = `월간 예산 ${formatWon(budget)}원`;
    totalLine.appendChild(pctEl);
  }
  foot.appendChild(totalLine);

  if (total > 0) {
    // 분류별 비율 색 막대(큰 순서). 삭제된 분류 기록은 회색
    const sorted = Object.keys(byCat).sort((a, b) => byCat[b] - byCat[a]);
    const bar = document.createElement('div');
    bar.className = 'cal-ledger-bar';
    sorted.forEach((cid) => {
      const cat = catById(cid);
      const seg = document.createElement('div');
      seg.className = 'cal-ledger-seg';
      seg.style.width = (byCat[cid] / total * 100) + '%';
      seg.style.background = (cat && cat.color) || DELETED_CAT_COLOR;
      seg.title = `${(cat && cat.name) || '(삭제된 분류)'} ${formatWon(byCat[cid])}원`;
      bar.appendChild(seg);
    });
    foot.appendChild(bar);

    // 막대 아래 작은 범례: 분류명 + 금액(쓴 분류만, 큰 순서)
    const legend = document.createElement('div');
    legend.className = 'cal-ledger-legend';
    sorted.forEach((cid) => {
      const cat = catById(cid);
      const item = document.createElement('span');
      item.className = 'cal-ledger-legenditem';
      const dot = document.createElement('span');
      dot.className = 'dot';
      dot.style.background = (cat && cat.color) || DELETED_CAT_COLOR;
      item.appendChild(dot);
      item.appendChild(document.createTextNode(
        `${(cat && cat.name) || '(삭제된 분류)'} ${formatWonShort(byCat[cid])}`
      ));
      legend.appendChild(item);
    });
    foot.appendChild(legend);
  }
}

// ---- 주간 뷰 (가로 7칸 목록형) ----
function renderWeek() {
  const grid = document.getElementById('cal-grid');
  grid.className = 'cal-grid week-mode';
  grid.innerHTML = '';

  const today = todayParts();
  const todayNum = ymd(today.y, today.m, today.d);
  const s = weekStartDate();

  for (let i = 0; i < 7; i++) {
    const d = new Date(s.getFullYear(), s.getMonth(), s.getDate() + i);
    const dow = d.getDay();
    // 주간에서는 모든 칸이 "이번 주"라 otherMonth 없음(전부 클릭 가능)
    grid.appendChild(
      buildDayCell(d.getFullYear(), d.getMonth(), d.getDate(), false, dow, todayNum, MAX_CHIPS_WEEK)
    );
  }
}

// ---- 일간 뷰 (그날 일정 목록) ----
function renderDay() {
  const grid = document.getElementById('cal-grid');
  grid.className = 'cal-grid day-mode';
  grid.innerHTML = '';

  const dateKey = dateKeyOf(state.year, state.month, state.day);
  const view = document.createElement('div');
  view.className = 'cal-dayview';

  // 일간 뷰는 제목 아래에 음력 한 줄(설정 켜져 있을 때만)
  if (showLunar) {
    const lunLine = document.createElement('div');
    lunLine.className = 'cal-lunar-dayline';
    lunLine.dataset.lunarFor = dateKey;
    const cached = lunarCache[dateKey];
    if (cached) lunLine.textContent = lunarText(cached);
    view.appendChild(lunLine);
  }

  const list = document.createElement('div');
  list.className = 'cal-ov-list';
  const items = memosOnDate(dateKey);
  if (!items.length) {
    const empty = document.createElement('div');
    empty.className = 'cal-ov-empty';
    empty.textContent = '이 날의 일정이 없습니다.';
    list.appendChild(empty);
  } else {
    items.forEach((it) => list.appendChild(buildMemoRow(it)));
  }

  const foot = buildQuickAddFoot(dateKey, null);

  view.appendChild(list);
  view.appendChild(foot);
  grid.appendChild(view);
}

// ---- 화면 전체 그리기(뷰에 따라 나눠서) ----
function render() {
  renderTitle();
  updateViewButtons();
  const weekdaysEl = document.getElementById('cal-weekdays');
  if (state.view === 'month') {
    weekdaysEl.style.display = '';
    renderWeekdays();
    renderGrid();
  } else if (state.view === 'week') {
    weekdaysEl.style.display = '';
    renderWeekdays();
    renderWeek();
  } else {
    weekdaysEl.style.display = 'none'; // 일간은 요일 헤더 불필요(제목에 요일 표시)
    renderDay();
  }
  renderLedgerFooter(); // 가계부 모드면 하단 총합+색막대, 달력 모드면 숨김
  annotateLunar(); // 그리고 나서 음력을 한꺼번에 채움(비동기, 캐시되어 두 번째부턴 즉시)
  annotateHolidays(); // 공휴일 이름도 같은 방식으로 한꺼번에 채움(연도 단위 캐시)
}

// ---- 달력/가계부 모드 전환 ----
// 가계부 모드는 월간 화면만 사용(주간/일간 가계부 화면은 추후 논의 — 인계서).
function setMode(m) {
  if (mode === m) return;
  mode = m;
  closeOverlays();
  const root = document.getElementById('cal-root');
  root.classList.toggle('ledger-mode', m === 'ledger');
  const btn = document.getElementById('cal-mode');
  if (m === 'ledger') {
    btn.textContent = '📅';
    btn.title = '달력 모드로 전환';
    btn.classList.add('active'); // 가계부 모드 동안 색 채워서 강조
    if (state.view !== 'month') state.view = 'month';
  } else {
    btn.textContent = '₩';
    btn.title = '가계부 모드로 전환';
    btn.classList.remove('active');
  }
  render();
}

function setView(view) {
  if (state.view === view) return;
  state.view = view;
  closeOverlays();
  // 이전/다음 버튼 안내 문구도 뷰에 맞게
  const t = { month: ['이전 달', '다음 달'], week: ['이전 주', '다음 주'], day: ['전날', '다음날'] }[view];
  document.getElementById('cal-prev').title = t[0];
  document.getElementById('cal-next').title = t[1];
  render();
}

function updateViewButtons() {
  const map = { month: 'cal-view-month', week: 'cal-view-week', day: 'cal-view-day' };
  Object.keys(map).forEach((v) => {
    document.getElementById(map[v]).classList.toggle('active', state.view === v);
  });
}

function goToday() {
  const t = todayParts();
  state.year = t.y;
  state.month = t.m;
  state.day = t.d;
  render();
}

function shiftMonth(delta) {
  let m = state.month + delta;
  let y = state.year;
  while (m < 0) { m += 12; y--; }
  while (m > 11) { m -= 12; y++; }
  state.year = y;
  state.month = m;
  // 기준 날짜가 그 달에 없는 날이면(예: 31일 → 2월) 그 달 말일로 맞춤
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  if (state.day > daysInMonth) state.day = daysInMonth;
  render();
}

// 기준 날짜를 며칠만큼 이동(주간 ±7, 일간 ±1). Date가 월/연 경계를 알아서 처리(로컬).
function shiftDays(delta) {
  const d = new Date(state.year, state.month, state.day + delta);
  state.year = d.getFullYear();
  state.month = d.getMonth();
  state.day = d.getDate();
  render();
}

function shiftPrevNext(delta) {
  if (state.view === 'month') shiftMonth(delta);
  else if (state.view === 'week') shiftDays(delta * 7);
  else shiftDays(delta);
}

function wireControls() {
  // 모든 버튼은 잠금 중엔 무반응(실수 클릭 방지) — 더블클릭으로 활성화한 뒤 사용
  document.getElementById('cal-prev').addEventListener('click', () => { if (!locked) shiftPrevNext(-1); });
  document.getElementById('cal-next').addEventListener('click', () => { if (!locked) shiftPrevNext(1); });
  document.getElementById('cal-today').addEventListener('click', () => { if (!locked) goToday(); });
  document.getElementById('cal-close').addEventListener('click', () => { if (!locked) window.close(); });
  document.getElementById('cal-view-month').addEventListener('click', () => { if (!locked) setView('month'); });
  document.getElementById('cal-view-week').addEventListener('click', () => { if (!locked) setView('week'); });
  document.getElementById('cal-view-day').addEventListener('click', () => { if (!locked) setView('day'); });
  document.getElementById('cal-mode').addEventListener('click', () => {
    if (!locked) setMode(mode === 'ledger' ? 'calendar' : 'ledger');
  });
  // ⚙️ 달력 설정(설정창에서 이곳으로 이동 — 태훈님 요청 2026-07-24)
  document.getElementById('cal-settings').addEventListener('click', () => {
    if (!locked) openCalendarSettingsPanel();
  });
  // 📊 가계부 통계 보드(가계부 모드에서만 보이는 버튼 — CSS로 숨김 처리)
  document.getElementById('cal-stats').addEventListener('click', () => {
    if (!locked && mode === 'ledger') openLedgerStatsPanel();
  });

  // 잠금 상태에서 달력 아무 곳이나 더블클릭 → 활성화(메인이 창을 앞으로 가져옴)
  document.addEventListener('dblclick', () => {
    if (locked && window.api && window.api.setCalendarActive) {
      window.api.setCalendarActive(true);
    }
  });
}

// ---- 메모 열기 / 그날 목록 / 새 메모 ----

function openMemo(memoId) {
  if (window.api && window.api.openExistingMemo) window.api.openExistingMemo(memoId);
}

// dateKey "YYYY-MM-DD" → "M월 D일 (요일)"
function formatDayTitle(dateKey) {
  const [y, m, d] = dateKey.split('-').map(Number);
  const dow = new Date(y, m - 1, d).getDay();
  return `${m}월 ${d}일 (${WEEKDAYS[dow]})`;
}

// 그날 메모들(제목/시각/색/알람), 시각순 정렬
function memosOnDate(dateKey) {
  const colorByTopic = {};
  topicsCache.forEach((t) => { colorByTopic[t.id] = t.memoColor || t.color || null; });
  return memosCache
    .filter((m) => typeof m.scheduleAt === 'string' && m.scheduleAt.slice(0, 10) === dateKey)
    .map((m) => ({
      id: m.id,
      title: (m.title && m.title.trim()) ? m.title.trim() : '(제목 없음)',
      color: m.color || colorByTopic[m.topicId] || '#C9A24B',
      // 00:00은 "시각을 안 적은 일정"이라 목록에 시각을 안 띄움(빠른 입력칸이 그렇게 저장함)
      time: scheduleTimeLabel(m.scheduleAt),
      hasAlarm: !!(m.alarm && m.alarm.enabled)
    }))
    .sort((a, b) => (a.time || '99:99').localeCompare(b.time || '99:99'));
}

/* ---- 목록 줄의 시각을 그 자리에서 고치기 (0.20.1, 태훈님 확정 2026-08-15) ----
   예전에는 시각 하나 바꾸려고 메모창을 열어야 했음. 이제 목록의 시각을 누르면
   그 자리가 작은 입력칸으로 바뀐다.
   - 엔터 또는 다른 곳 클릭 = 저장, Esc = 취소
   - 비우면 00:00("시각 안 적은 일정")으로 되돌아가 목록에서 시각이 안 보임
   - 시각 해석("9" → 09:00)은 main.js 한 곳에서만 함(여기서 또 만들면 나중에 어긋남)

   [주의] 줄 전체에 "메모창 열기" 클릭이 걸려 있으므로 시각 쪽 클릭은 반드시
   stopPropagation 할 것. 안 하면 고치려고 누르는 순간 메모창이 같이 뜬다.
   (위젯의 눈 아이콘이 전파를 안 막아서 생긴 문제와 같은 종류) */
function startTimeEdit(tm, it, afterEdit) {
  if (locked) return;
  if (!window.api || !window.api.setCalendarScheduleTime) return;

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'cal-ov-item-timeedit';
  input.maxLength = 5;
  input.value = it.time || '';
  input.placeholder = '예: 930';
  input.title = '엔터로 저장 · Esc로 취소 · 비우면 시간 없는 일정이 됩니다';

  let done = false;
  const restore = () => { if (input.parentNode) input.replaceWith(tm); };
  const cancel = () => { if (done) return; done = true; restore(); };
  const save = async () => {
    if (done) return;
    done = true;
    const v = input.value.trim();
    if (v === (it.time || '')) { restore(); return; }   // 안 바뀌었으면 저장도 안 함
    input.disabled = true;
    const res = await window.api.setCalendarScheduleTime(it.id, v);
    if (!res) { restore(); return; }                    // 못 알아본 값 → 원래대로
    await reloadData();                                 // 달력 본체 다시 그리기
    if (afterEdit) afterEdit();                         // 열려 있던 목록 패널 다시 그리기
  };

  // 줄 전체의 "메모창 열기"가 같이 터지지 않게 막음
  ['click', 'mousedown', 'dblclick'].forEach((ev) =>
    input.addEventListener(ev, (e) => e.stopPropagation())
  );
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancel(); return; }
    if (e.key !== 'Enter' || e.isComposing) return;     // 한글 조합 끝내는 엔터는 무시
    e.preventDefault();
    e.stopPropagation();
    save();
  });
  input.addEventListener('blur', save);

  tm.replaceWith(input);
  input.focus();
  input.select();
}

// 메모 한 줄(제목·🔔·시각) 만들기 — 그날 목록 패널과 일간 뷰 공용
// afterEdit: 시각을 고친 뒤 목록을 다시 그리는 함수
//            (일간 뷰는 reloadData()의 render()가 알아서 다시 그리므로 안 넘김)
function buildMemoRow(it, afterEdit) {
  const row = document.createElement('div');
  row.className = 'cal-ov-item';
  row.style.borderLeftColor = it.color;
  const t = document.createElement('span');
  t.className = 'cal-ov-item-title';
  t.textContent = it.title;
  row.appendChild(t);
  if (it.hasAlarm) {
    const b = document.createElement('span');
    b.textContent = '🔔';
    b.style.fontSize = '11px';
    row.appendChild(b);
  }
  // 시각이 없는 일정도 흐린 "시각" 글자로 자리를 만들어 둠(눌러서 넣을 수 있게)
  const tm = document.createElement('span');
  tm.className = 'cal-ov-item-time' + (it.time ? '' : ' is-empty');
  tm.textContent = it.time || '시각';
  tm.title = '눌러서 시각만 고칠 수 있어요';
  tm.addEventListener('click', (e) => {
    e.stopPropagation();
    startTimeEdit(tm, it, afterEdit);
  });
  row.appendChild(tm);
  row.addEventListener('click', () => openMemo(it.id));
  return row;
}

/* ---- 그날 목록 맨 아래 "빠른 일정 입력칸" (0.20.0, 태훈님 확정 2026-08-15) ----
   예전에는 [+새 메모 → 주제 고르기 → 메모창]이라 일정 하나 적는 데 네 단계가 걸렸음.
   이제는 [시각] [제목] 치고 엔터면 끝이고 메모창은 안 뜬다.
   - 시각은 비워도 됨(00:00으로 저장하고 목록에서는 시각을 안 보여줌)
   - "9", "930", "9:30" 아무렇게나 쳐도 09:00 / 09:30으로 맞춰줌(맞추는 건 main.js)
   - 만들어진 일정은 "달력" 주제로 자동 배치됨(main.js ensureCalendarTopic)
   - 본문·알람까지 쓰고 싶으면 아래 "자세히 쓰기" → 예전 방식대로 주제 고르고 메모창이 열림

   [주의] 엔터를 받을 때 e.isComposing을 꼭 볼 것. 한글 조합을 끝내는 엔터까지 "추가"로
   받아버리면 글자가 덜 완성된 채로 저장된다. */
function buildQuickAddFoot(dateKey, afterAdd) {
  const foot = document.createElement('div');
  foot.className = 'cal-ov-foot';

  const row = document.createElement('div');
  row.className = 'cal-quickadd';

  const timeInput = document.createElement('input');
  timeInput.type = 'text';
  timeInput.className = 'cal-quick-time';
  // (0.20.1) 예전엔 안내가 '시각' 한 단어뿐이라 입력칸이 아니라 버튼처럼 보였음.
  // 예시를 그대로 보여줘서 "치는 칸"이라는 것과 "뭘 치면 되는지"를 같이 알려줌
  timeInput.placeholder = '예: 930';
  timeInput.maxLength = 5;
  timeInput.title = '비워두면 시간 없는 일정이 됩니다. 9 / 930 / 9:30 아무렇게나 쳐도 됩니다';

  const titleInput = document.createElement('input');
  titleInput.type = 'text';
  titleInput.className = 'cal-quick-title';
  titleInput.placeholder = '일정 (엔터로 추가)';

  const addBtn = document.createElement('button');
  addBtn.className = 'cal-quick-add';
  addBtn.textContent = '+';
  addBtn.title = '일정 추가';

  let adding = false;
  async function submitQuickAdd() {
    if (adding || locked) return;
    const text = titleInput.value.trim();
    if (!text) { titleInput.focus(); return; }
    if (!window.api || !window.api.createCalendarSchedule) return;
    adding = true;
    try {
      await window.api.createCalendarSchedule(dateKey, timeInput.value, text);
      await reloadData();            // 달력 본체 다시 그리기
      if (afterAdd) afterAdd();      // 열려 있던 목록 패널 다시 그리기
      // 위에서 화면을 새로 그렸으므로 새로 생긴 입력칸에 커서를 다시 넣어줌(연달아 적을 수 있게)
      const next = document.querySelector('.cal-quick-title');
      if (next) next.focus();
    } finally {
      adding = false;
    }
  }

  addBtn.addEventListener('click', submitQuickAdd);
  [timeInput, titleInput].forEach((el) => {
    el.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || e.isComposing) return;
      e.preventDefault();
      submitQuickAdd();
    });
  });

  row.appendChild(timeInput);
  row.appendChild(titleInput);
  row.appendChild(addBtn);
  foot.appendChild(row);

  const moreBtn = document.createElement('button');
  moreBtn.className = 'cal-quick-more';
  moreBtn.textContent = '자세히 쓰기 (본문·알람)';
  moreBtn.addEventListener('click', () => openTopicPicker(dateKey));
  foot.appendChild(moreBtn);

  return foot;
}

function closeOverlays() {
  document.querySelectorAll('.cal-overlay, .cal-picker').forEach((el) => el.remove());
}

// 날짜 칸 클릭 → 그날 메모 목록 패널
function openDayPanel(dateKey) {
  closeOverlays();
  const root = document.getElementById('cal-root');
  const ov = document.createElement('div');
  ov.className = 'cal-overlay';

  const head = document.createElement('div');
  head.className = 'cal-overlay-head';
  const back = document.createElement('button');
  back.className = 'cal-ov-btn';
  back.textContent = '‹';
  back.title = '달력으로';
  back.addEventListener('click', closeOverlays);
  const title = document.createElement('div');
  title.className = 'cal-ov-title';
  title.textContent = formatDayTitle(dateKey);
  const spacer = document.createElement('button'); // 좌우 대칭용 투명 버튼
  spacer.className = 'cal-ov-btn';
  spacer.style.visibility = 'hidden';
  spacer.textContent = '‹';
  head.appendChild(back);
  head.appendChild(title);
  head.appendChild(spacer);

  const list = document.createElement('div');
  list.className = 'cal-ov-list';
  const items = memosOnDate(dateKey);
  if (!items.length) {
    const empty = document.createElement('div');
    empty.className = 'cal-ov-empty';
    empty.textContent = '이 날의 일정이 없습니다.';
    list.appendChild(empty);
  } else {
    items.forEach((it) => list.appendChild(buildMemoRow(it, () => openDayPanel(dateKey))));
  }

  const foot = buildQuickAddFoot(dateKey, () => openDayPanel(dateKey));

  ov.appendChild(head);
  ov.appendChild(list);
  ov.appendChild(foot);
  root.appendChild(ov);
}

// "+새 메모" → 주제 선택 작은 창
function openTopicPicker(dateKey) {
  const root = document.getElementById('cal-root');
  const picker = document.createElement('div');
  picker.className = 'cal-picker';
  const box = document.createElement('div');
  box.className = 'cal-picker-box';
  const h = document.createElement('h3');
  h.textContent = '어느 주제로 만들까요?';
  box.appendChild(h);

  const options = topicsCache.map((t) => ({
    id: t.id,
    name: t.name || '(이름 없음)',
    icon: t.iconChar || '',
    color: t.memoColor || t.color || '#C9A24B'
  }));
  options.push({ id: null, name: '일반(주제 없음)', icon: '📝', color: '#C9A24B' });

  options.forEach((o) => {
    const btn = document.createElement('button');
    btn.className = 'cal-topicbtn';
    const dot = document.createElement('span');
    dot.className = 'dot';
    dot.style.background = o.color;
    btn.appendChild(dot);
    const label = document.createElement('span');
    label.textContent = (o.icon ? o.icon + ' ' : '') + o.name;
    btn.appendChild(label);
    btn.addEventListener('click', () => createMemoOnDate(o.id, dateKey));
    box.appendChild(btn);
  });

  const cancel = document.createElement('button');
  cancel.className = 'cal-picker-cancel';
  cancel.textContent = '취소';
  cancel.addEventListener('click', () => picker.remove());
  box.appendChild(cancel);

  picker.addEventListener('click', (e) => { if (e.target === picker) picker.remove(); });
  picker.appendChild(box);
  root.appendChild(picker);
}

// ---- 가계부: 그날 지출 목록 + 입력 패널 ----
function entriesOnDate(dateKey) {
  return ledgerEntries.filter((e) => e.date === dateKey);
}

// 가계부 모드에서 날짜 클릭 → 그날 지출 목록 + 아래 입력칸.
// 목록의 지출을 누르면 입력칸에 불러와서 수정, ✕를 누르면 삭제.
function openLedgerPanel(dateKey, editingId = null) {
  closeOverlays();
  const root = document.getElementById('cal-root');
  const ov = document.createElement('div');
  ov.className = 'cal-overlay';

  // 머리: 뒤로가기 + 날짜 제목
  const head = document.createElement('div');
  head.className = 'cal-overlay-head';
  const back = document.createElement('button');
  back.className = 'cal-ov-btn';
  back.textContent = '‹';
  back.title = '달력으로';
  back.addEventListener('click', closeOverlays);
  const title = document.createElement('div');
  title.className = 'cal-ov-title';
  title.textContent = formatDayTitle(dateKey) + ' 지출';
  const spacer = document.createElement('button');
  spacer.className = 'cal-ov-btn';
  spacer.style.visibility = 'hidden';
  spacer.textContent = '‹';
  head.appendChild(back);
  head.appendChild(title);
  head.appendChild(spacer);

  // 목록
  const list = document.createElement('div');
  list.className = 'cal-ov-list';
  const items = entriesOnDate(dateKey);
  if (!items.length) {
    const empty = document.createElement('div');
    empty.className = 'cal-ov-empty';
    empty.textContent = '이 날의 지출이 없습니다.';
    list.appendChild(empty);
  } else {
    items.forEach((en) => {
      const cat = catById(en.categoryId);
      const row = document.createElement('div');
      row.className = 'cal-ov-item cal-ledger-item' + (en.id === editingId ? ' editing' : '');
      row.style.borderLeftColor = (cat && cat.color) || DELETED_CAT_COLOR;
      row.title = '누르면 수정할 수 있어요';

      const name = document.createElement('span');
      name.className = 'cal-ledger-catname';
      name.textContent = (cat && cat.name) || '(삭제된 분류)';
      row.appendChild(name);

      if (en.memo) {
        const memoEl = document.createElement('span');
        memoEl.className = 'cal-ledger-memo';
        memoEl.textContent = en.memo;
        row.appendChild(memoEl);
      }

      const amt = document.createElement('span');
      amt.className = 'cal-ledger-amt';
      amt.textContent = formatWon(en.amount);
      row.appendChild(amt);

      const del = document.createElement('button');
      del.className = 'cal-ledger-del';
      del.textContent = '✕';
      del.title = '삭제';
      del.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!window.confirm('이 지출을 삭제할까요?')) return;
        try { await window.api.deleteLedgerEntry(en.id); } catch (err) { return; }
        await reloadLedger();
        render();
        openLedgerPanel(dateKey);
      });
      row.appendChild(del);

      // 줄을 누르면 아래 입력칸에 불러와서 수정 모드로
      row.addEventListener('click', () => openLedgerPanel(dateKey, en.id));
      list.appendChild(row);
    });

    // 그날 합계 한 줄
    const slot = spendByDate[dateKey];
    if (slot && slot.total > 0) {
      const dayTotal = document.createElement('div');
      dayTotal.className = 'cal-ledger-daytotal';
      dayTotal.textContent = `합계 ${formatWon(slot.total)}원`;
      list.appendChild(dayTotal);
    }
  }

  // 입력칸(추가/수정 공용)
  const editing = editingId ? items.find((e) => e.id === editingId) : null;
  const foot = document.createElement('div');
  foot.className = 'cal-ov-foot cal-ledger-form';

  const row1 = document.createElement('div');
  row1.className = 'cal-ledger-formrow';
  const catSel = document.createElement('select');
  catSel.className = 'cal-ledger-select';
  ledgerCategories.forEach((c) => {
    const opt = document.createElement('option');
    opt.value = c.id;
    opt.textContent = c.name;
    catSel.appendChild(opt);
  });
  if (editing && catById(editing.categoryId)) catSel.value = editing.categoryId;
  const amtInput = document.createElement('input');
  amtInput.className = 'cal-ledger-input cal-ledger-amtinput';
  amtInput.type = 'number';
  amtInput.min = '1';
  amtInput.placeholder = '금액(원)';
  if (editing) amtInput.value = editing.amount;
  row1.appendChild(catSel);
  row1.appendChild(amtInput);

  const row2 = document.createElement('div');
  row2.className = 'cal-ledger-formrow';
  const memoInput = document.createElement('input');
  memoInput.className = 'cal-ledger-input';
  memoInput.type = 'text';
  memoInput.placeholder = '메모(선택)';
  if (editing) memoInput.value = editing.memo || '';
  const saveBtn = document.createElement('button');
  saveBtn.className = 'cal-newbtn cal-ledger-save';
  saveBtn.textContent = editing ? '수정' : '+ 추가';
  row2.appendChild(memoInput);
  row2.appendChild(saveBtn);

  async function save() {
    const amount = Math.round(Number(amtInput.value));
    if (!Number.isFinite(amount) || amount <= 0) { amtInput.focus(); return; }
    // 위트 멘트용: 새 지출 "추가" 직전의 집계를 찍어둠(수정은 멘트 안 뜸)
    let before = null;
    if (!editing) {
      const s = ledgerSettings || {};
      before = ledgerStatsFor(ledgerEntries, dateKey, s.payday, weekStart);
    }
    try {
      if (editing) {
        await window.api.updateLedgerEntry({
          id: editing.id, categoryId: catSel.value, amount, memo: memoInput.value
        });
      } else {
        await window.api.addLedgerEntry({
          date: dateKey, categoryId: catSel.value, amount, memo: memoInput.value
        });
      }
    } catch (err) { return; }
    await reloadLedger();
    render();
    openLedgerPanel(dateKey); // 목록 새로 그려서 바로 확인
    if (before) maybeShowLedgerMent(before, dateKey, catSel.value);
  }
  saveBtn.addEventListener('click', save);
  // 금액/메모칸에서 Enter로도 저장
  [amtInput, memoInput].forEach((el) => {
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); });
  });

  foot.appendChild(row1);
  foot.appendChild(row2);

  // 수정 모드일 땐 "취소" 버튼(입력칸을 새 지출 추가 상태로 되돌림)
  if (editing) {
    const cancel = document.createElement('button');
    cancel.className = 'cal-ledger-cancel';
    cancel.textContent = '수정 취소';
    cancel.addEventListener('click', () => openLedgerPanel(dateKey));
    foot.appendChild(cancel);
  }

  ov.appendChild(head);
  ov.appendChild(list);
  ov.appendChild(foot);
  root.appendChild(ov);
  if (editing) amtInput.focus();
}

// ---- 달력 ⚙️ 설정 패널 ----
// 메모앱 설정창에 있던 달력·가계부 설정을 이곳으로 옮김(태훈님 요청 2026-07-24).
// 저장 버튼 없이 바꾸는 즉시 저장됨. settings.calendar만 건드림(다른 설정 무관).
async function openCalendarSettingsPanel() {
  closeOverlays();
  const root = document.getElementById('cal-root');

  // 현재 저장값(배경색·투명도는 모듈 변수에 없어서 설정에서 직접 읽음)
  let cal = {};
  try {
    const s = await window.api.getSettings();
    cal = (s && s.calendar) || {};
  } catch (e) { /* 기본값으로 진행 */ }

  const ov = document.createElement('div');
  ov.className = 'cal-overlay';

  const head = document.createElement('div');
  head.className = 'cal-overlay-head';
  const back = document.createElement('button');
  back.className = 'cal-ov-btn';
  back.textContent = '‹';
  back.title = '달력으로';
  back.addEventListener('click', closeOverlays);
  const title = document.createElement('div');
  title.className = 'cal-ov-title';
  title.textContent = '달력 설정';
  const spacer = document.createElement('button');
  spacer.className = 'cal-ov-btn';
  spacer.style.visibility = 'hidden';
  spacer.textContent = '‹';
  head.appendChild(back);
  head.appendChild(title);
  head.appendChild(spacer);

  const list = document.createElement('div');
  list.className = 'cal-ov-list cal-set';

  const save = (patch) => {
    if (window.api && window.api.saveCalendarSettings) window.api.saveCalendarSettings(patch);
  };
  const addHeading = (text) => {
    const h = document.createElement('div');
    h.className = 'cal-set-h';
    h.textContent = text;
    list.appendChild(h);
  };
  const addRow = () => {
    const r = document.createElement('div');
    r.className = 'cal-set-row';
    list.appendChild(r);
    return r;
  };
  const labeled = (inputEl, text) => {
    const lab = document.createElement('label');
    lab.className = 'cal-set-label';
    lab.appendChild(inputEl);
    lab.appendChild(document.createTextNode(' ' + text));
    return lab;
  };

  // 주 시작 요일
  addHeading('주 시작 요일');
  const rWeek = addRow();
  [['sun', '일요일'], ['mon', '월요일']].forEach(([val, text]) => {
    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'cal-set-weekstart';
    radio.checked = (weekStart === 1) === (val === 'mon');
    radio.addEventListener('change', () => { if (radio.checked) save({ weekStart: val }); });
    rWeek.appendChild(labeled(radio, text));
  });

  // 음력 표시
  addHeading('음력');
  const rLunar = addRow();
  const lunarChk = document.createElement('input');
  lunarChk.type = 'checkbox';
  lunarChk.checked = showLunar;
  lunarChk.addEventListener('change', () => save({ showLunar: lunarChk.checked }));
  rLunar.appendChild(labeled(lunarChk, '날짜 밑에 음력 표시 (예: 음 6.9)'));

  // 공휴일(특일정보 API) — 인증키는 태훈님이 직접 입력(바꿔 넣을 수 있게 별도 칸으로 분리).
  // 비워두면 공휴일 기능만 꺼지고 달력은 지금과 100% 동일하게 동작함
  addHeading('공휴일');
  const holiHint = document.createElement('div');
  holiHint.className = 'cal-set-hint';
  holiHint.textContent = '공공데이터포털 "특일정보" 인증키를 넣으면 공휴일이 빨간 숫자+이름으로 표시돼요. 비워두면 꺼져 있어요.';
  list.appendChild(holiHint);
  const rHoli = addRow();
  const holiKeyInput = document.createElement('input');
  holiKeyInput.type = 'text';
  holiKeyInput.className = 'cal-set-name';
  holiKeyInput.placeholder = '인증키 붙여넣기';
  holiKeyInput.value = cal.holidayApiKey || '';
  holiKeyInput.addEventListener('change', () => save({ holidayApiKey: holiKeyInput.value.trim() }));
  rHoli.appendChild(holiKeyInput);

  // 배경색 + 투명도
  addHeading('배경');
  const rBg = addRow();
  const bgColor = document.createElement('input');
  bgColor.type = 'color';
  bgColor.value = cal.bgColor || '#F7F4EC';
  bgColor.addEventListener('change', () => save({ bgColor: bgColor.value }));
  rBg.appendChild(labeled(bgColor, '배경색'));
  const rOp = addRow();
  const opRange = document.createElement('input');
  opRange.type = 'range';
  opRange.min = '30'; opRange.max = '100'; opRange.step = '5';
  opRange.value = typeof cal.opacity === 'number' ? cal.opacity : 100;
  opRange.style.flex = '1';
  const opVal = document.createElement('span');
  opVal.className = 'cal-set-opval';
  opVal.textContent = opRange.value + '%';
  opRange.addEventListener('input', () => { opVal.textContent = opRange.value + '%'; });
  opRange.addEventListener('change', () => save({ opacity: Number(opRange.value) || 100 }));
  rOp.appendChild(document.createTextNode('투명도'));
  rOp.appendChild(opRange);
  rOp.appendChild(opVal);

  // ---- 가계부 설정(월급날·예산·고정지출 — ledger.json에 즉시 저장) ----
  addHeading('가계부');
  const saveLs = async (patch) => {
    if (!window.api || !window.api.saveLedgerSettings) return;
    try {
      const saved = await window.api.saveLedgerSettings(patch);
      if (saved) ledgerSettings = saved;
    } catch (e) { /* 저장 실패해도 패널은 유지 */ }
  };
  // 입력값 → 양의 정수 또는 null(비움)
  const posIntOrNull = (v, max) => {
    const n = Math.floor(Number(v));
    if (!Number.isFinite(n) || n < 1) return null;
    return max ? Math.min(n, max) : n;
  };

  // 월급날
  const rPayday = addRow();
  rPayday.title = '월급날을 정하면 "월급날~다음 월급 전날"을 한 달로 묶어 합계를 내요.\n'
    + '예: 25일로 정하면 7/25~8/24 합계 — 이번 월급으로 얼마 썼는지 바로 보여요.\n'
    + '비워두면 지금처럼 1일~말일로 집계해요.';
  rPayday.appendChild(document.createTextNode('월급날 매달'));
  const paydayInput = document.createElement('input');
  paydayInput.type = 'number';
  paydayInput.min = '1'; paydayInput.max = '31';
  paydayInput.className = 'cal-set-num';
  paydayInput.placeholder = '1';
  if (ledgerSettings.payday) paydayInput.value = ledgerSettings.payday;
  paydayInput.addEventListener('change', async () => {
    await saveLs({ payday: posIntOrNull(paydayInput.value, 31) });
    render(); // 하단 총합계 구간이 바뀌므로 다시 그림
  });
  rPayday.appendChild(paydayInput);
  rPayday.appendChild(document.createTextNode('일 (비우면 1일~말일)'));

  // 주간/월간 예산
  const rWB = addRow();
  rWB.title = '예산을 정하면 하단에 "예산 대비 %"가 보이고,\n예산을 80%·100%·150% 넘는 순간 위트 멘트가 떠요.\n비워두면 예산 기능이 꺼져요.';
  rWB.appendChild(document.createTextNode('주간 예산'));
  const weeklyInput = document.createElement('input');
  weeklyInput.type = 'number';
  weeklyInput.min = '1';
  weeklyInput.className = 'cal-set-money';
  weeklyInput.placeholder = '비우면 끔';
  if (ledgerSettings.weeklyBudget) weeklyInput.value = ledgerSettings.weeklyBudget;
  weeklyInput.addEventListener('change', () => saveLs({ weeklyBudget: posIntOrNull(weeklyInput.value) }));
  rWB.appendChild(weeklyInput);
  rWB.appendChild(document.createTextNode('원'));

  const rMB = addRow();
  rMB.title = rWB.title;
  rMB.appendChild(document.createTextNode('월간 예산'));
  const monthlyInput = document.createElement('input');
  monthlyInput.type = 'number';
  monthlyInput.min = '1';
  monthlyInput.className = 'cal-set-money';
  monthlyInput.placeholder = '비우면 끔';
  if (ledgerSettings.monthlyBudget) monthlyInput.value = ledgerSettings.monthlyBudget;
  monthlyInput.addEventListener('change', async () => {
    await saveLs({ monthlyBudget: posIntOrNull(monthlyInput.value) });
    render(); // 하단 "예산 대비 %" 표시가 바뀌므로
  });
  rMB.appendChild(monthlyInput);
  rMB.appendChild(document.createTextNode('원'));

  // 고정 지출(매달 정해진 날 자동 기입)
  addHeading('고정 지출');
  const fixedHint = document.createElement('div');
  fixedHint.className = 'cal-set-hint';
  fixedHint.textContent = '매달 정한 날짜에 자동으로 기입돼요(예: 25일 월세). 금액을 넣어야 작동해요.';
  list.appendChild(fixedHint);
  const fixedHost = document.createElement('div');
  list.appendChild(fixedHost);

  let fixedList = (ledgerSettings.fixed || []).map((f) => ({ ...f }));
  const saveFixed = () => saveLs({ fixed: fixedList });
  function renderFixed() {
    fixedHost.innerHTML = '';
    fixedList.forEach((f, idx) => {
      const box = document.createElement('div');
      box.className = 'cal-set-fixed';

      const r1 = document.createElement('div');
      r1.className = 'cal-set-row';
      r1.appendChild(document.createTextNode('매달'));
      const dayIn = document.createElement('input');
      dayIn.type = 'number';
      dayIn.min = '1'; dayIn.max = '31';
      dayIn.className = 'cal-set-num';
      dayIn.value = f.day || 1;
      dayIn.addEventListener('change', () => {
        fixedList[idx].day = posIntOrNull(dayIn.value, 31) || 1;
        saveFixed();
      });
      r1.appendChild(dayIn);
      r1.appendChild(document.createTextNode('일'));
      const catSel = document.createElement('select');
      catSel.className = 'cal-ledger-select';
      ledgerCategories.forEach((c) => {
        const opt = document.createElement('option');
        opt.value = c.id;
        opt.textContent = c.name;
        catSel.appendChild(opt);
      });
      if (f.categoryId) catSel.value = f.categoryId;
      catSel.addEventListener('change', () => {
        fixedList[idx].categoryId = catSel.value;
        saveFixed();
      });
      r1.appendChild(catSel);
      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'cal-set-del';
      delBtn.textContent = '✕';
      delBtn.title = '고정 지출 삭제(이미 기입된 기록은 남아요)';
      delBtn.addEventListener('click', () => {
        if (!window.confirm('이 고정 지출을 삭제할까요? 이미 기입된 기록은 남아요.')) return;
        fixedList.splice(idx, 1);
        saveFixed();
        renderFixed();
      });
      r1.appendChild(delBtn);

      const r2 = document.createElement('div');
      r2.className = 'cal-set-row';
      const amtIn = document.createElement('input');
      amtIn.type = 'number';
      amtIn.min = '1';
      amtIn.className = 'cal-set-money';
      amtIn.placeholder = '금액(원)';
      if (f.amount) amtIn.value = f.amount;
      amtIn.addEventListener('change', () => {
        fixedList[idx].amount = posIntOrNull(amtIn.value) || 0;
        saveFixed();
      });
      r2.appendChild(amtIn);
      const memoIn = document.createElement('input');
      memoIn.type = 'text';
      memoIn.className = 'cal-ledger-input';
      memoIn.placeholder = '메모(예: 월세)';
      memoIn.value = f.memo || '';
      memoIn.addEventListener('change', () => {
        fixedList[idx].memo = memoIn.value.trim();
        saveFixed();
      });
      r2.appendChild(memoIn);

      box.appendChild(r1);
      box.appendChild(r2);
      fixedHost.appendChild(box);
    });
  }
  renderFixed();
  const addFixedBtn = document.createElement('button');
  addFixedBtn.type = 'button';
  addFixedBtn.className = 'cal-newbtn cal-set-addcat';
  addFixedBtn.textContent = '+ 고정 지출 추가';
  addFixedBtn.addEventListener('click', () => {
    const t = todayParts();
    fixedList.push({
      id: 'fix-' + Date.now(),
      day: 1,
      categoryId: (ledgerCategories[0] && ledgerCategories[0].id) || 'etc',
      amount: 0,
      memo: '',
      // 등록일 — 등록한 날보다 앞선 날짜로는 자동 기입 안 함(다음 달부터 정상 작동)
      createdAt: dateKeyOf(t.y, t.m, t.d)
    });
    renderFixed(); // 금액을 넣고 저장되기 전까지는 자동 기입 안 됨
  });
  list.appendChild(addFixedBtn);

  // ("멘트 파일 열기" 버튼은 태훈님 요청으로 뺌(2026-07-24) — 멘트.json 직접 수정은 여전히
  //  가능하고 IPC(ledger:openMentsFile)도 남아 있음. 버튼만 없앤 것)

  // 엑셀(CSV) 내보내기 — 전체 지출 기록을 표 파일로 저장(엑셀에서 바로 열림)
  const exportBtn = document.createElement('button');
  exportBtn.type = 'button';
  exportBtn.className = 'cal-newbtn cal-set-addcat';
  exportBtn.textContent = '엑셀로 내보내기 (CSV)';
  exportBtn.title = '전체 지출 기록을 날짜·분류·금액·메모 표로 저장해요. 엑셀에서 바로 열려요.';
  exportBtn.addEventListener('click', async () => {
    if (!window.api || !window.api.exportLedgerCsv) return;
    try {
      const r = await window.api.exportLedgerCsv();
      if (r && !r.canceled) showLedgerToast(`저장 완료! 지출 ${r.count}건을 내보냈어요 📊`);
    } catch (e) { /* 실패해도 조용히 */ }
  });
  list.appendChild(exportBtn);

  // 가계부 분류 관리(즉시 저장 — ledger.json)
  addHeading('가계부 분류');
  const hint = document.createElement('div');
  hint.className = 'cal-set-hint';
  hint.textContent = '색·이름 수정과 추가·삭제. 분류를 삭제해도 기록은 남아요(색만 회색).';
  list.appendChild(hint);
  const catHost = document.createElement('div');
  list.appendChild(catHost);

  let cats = ledgerCategories.map((c) => ({ ...c }));
  async function saveCats() {
    if (!window.api.saveLedgerCategories) return;
    const saved = await window.api.saveLedgerCategories(cats);
    if (saved) cats = saved.map((c) => ({ ...c }));
    // onLedgerUpdated 신호로 달력 그리드도 자동 갱신됨
  }
  function renderCats() {
    catHost.innerHTML = '';
    cats.forEach((cat, idx) => {
      const r = document.createElement('div');
      r.className = 'cal-set-row';
      const color = document.createElement('input');
      color.type = 'color';
      color.value = cat.color || '#8A8577';
      color.addEventListener('change', async () => {
        cats[idx].color = color.value;
        await saveCats();
      });
      const name = document.createElement('input');
      name.type = 'text';
      name.value = cat.name || '';
      name.className = 'cal-set-name';
      name.addEventListener('change', async () => {
        cats[idx].name = name.value.trim() || cat.name;
        await saveCats();
        renderCats();
      });
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'cal-set-del';
      del.textContent = '✕';
      del.title = '분류 삭제';
      del.addEventListener('click', async () => {
        if (cats.length <= 1) return; // 최소 1개는 남김
        if (!window.confirm('이 분류를 삭제할까요? 기록은 남지만 색은 회색이 돼요.')) return;
        cats.splice(idx, 1);
        await saveCats();
        renderCats();
      });
      r.appendChild(color);
      r.appendChild(name);
      r.appendChild(del);
      catHost.appendChild(r);
    });
  }
  renderCats();
  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'cal-newbtn cal-set-addcat';
  addBtn.textContent = '+ 분류 추가';
  addBtn.addEventListener('click', async () => {
    cats.push({ id: 'cat-' + Date.now(), name: '새 분류', color: '#C9A24B' });
    await saveCats();
    renderCats();
  });
  list.appendChild(addBtn);

  ov.appendChild(head);
  ov.appendChild(list);
  root.appendChild(ov);
}

// ---- 📊 가계부 통계 보드 ----
// ①월별 지출 추이(최근 6사이클) ②분류별 비율(이번 사이클) ③지난 사이클 대비 증감
// 전부 이미 불러와 있는 ledgerEntries로 계산(추가 데이터 요청 없음). 차트 라이브러리 없이 div 막대.
function openLedgerStatsPanel() {
  closeOverlays();
  const root = document.getElementById('cal-root');
  const payday = ledgerSettings && ledgerSettings.payday;

  const ov = document.createElement('div');
  ov.className = 'cal-overlay';

  const head = document.createElement('div');
  head.className = 'cal-overlay-head';
  const back = document.createElement('button');
  back.className = 'cal-ov-btn';
  back.textContent = '‹';
  back.title = '달력으로';
  back.addEventListener('click', closeOverlays);
  const title = document.createElement('div');
  title.className = 'cal-ov-title';
  title.textContent = '가계부 통계';
  const spacer = document.createElement('button');
  spacer.className = 'cal-ov-btn';
  spacer.style.visibility = 'hidden';
  spacer.textContent = '‹';
  head.appendChild(back);
  head.appendChild(title);
  head.appendChild(spacer);

  const list = document.createElement('div');
  list.className = 'cal-ov-list cal-stats';

  const addHeading = (text) => {
    const h = document.createElement('div');
    h.className = 'cal-set-h';
    h.textContent = text;
    list.appendChild(h);
  };
  const addEmpty = (text) => {
    const e = document.createElement('div');
    e.className = 'cal-ov-empty';
    e.textContent = text;
    list.appendChild(e);
  };

  // ---- 1) 월별 지출 추이(최근 6사이클, 지금 보는 달이 마지막 칸) ----
  addHeading('월별 지출 추이 (최근 6개월)');
  const TREND_COUNT = 6;
  const periods = ledgerPeriodsTrend(state.year, state.month, payday, TREND_COUNT);
  const trendData = periods.map((p) => ({ ...p, total: sumEntriesInRange(ledgerEntries, p.from, p.to) }));
  const maxTotal = Math.max(0, ...trendData.map((p) => p.total));
  if (maxTotal <= 0) {
    addEmpty('아직 지출 기록이 없어요.');
  } else {
    const trend = document.createElement('div');
    trend.className = 'cal-stats-trend';
    trendData.forEach((p, idx) => {
      const col = document.createElement('div');
      col.className = 'cal-stats-col' + (idx === trendData.length - 1 ? ' current' : '');

      const amt = document.createElement('div');
      amt.className = 'cal-stats-amt';
      amt.textContent = p.total > 0 ? formatWonShort(p.total) : '';
      col.appendChild(amt);

      const box = document.createElement('div');
      box.className = 'cal-stats-barbox';
      const bar = document.createElement('div');
      bar.className = 'cal-stats-bar';
      bar.style.height = Math.max(2, Math.round((p.total / maxTotal) * 100)) + '%';
      bar.title = `${p.m + 1}월: ${formatWon(p.total)}원`;
      box.appendChild(bar);
      col.appendChild(box);

      const lbl = document.createElement('div');
      lbl.className = 'cal-stats-lbl';
      lbl.textContent = `${p.m + 1}월`;
      col.appendChild(lbl);

      trend.appendChild(col);
    });
    list.appendChild(trend);
  }

  // ---- 2) 분류별 지출 비율(이번 사이클) ----
  addHeading('분류별 지출 비율 (이번 사이클)');
  const curPeriod = ledgerPeriodOf(state.year, state.month, payday);
  const curStat = sumByCatInRange(ledgerEntries, curPeriod.from, curPeriod.to);
  const byCat = curStat.byCat;
  const curTotal = curStat.total;
  if (curTotal <= 0) {
    addEmpty('이번 사이클 지출이 없어요.');
  } else {
    const sorted = Object.keys(byCat).sort((a, b) => byCat[b] - byCat[a]);
    const bar = document.createElement('div');
    bar.className = 'cal-ledger-bar';
    sorted.forEach((cid) => {
      const cat = catById(cid);
      const seg = document.createElement('div');
      seg.className = 'cal-ledger-seg';
      seg.style.width = (byCat[cid] / curTotal * 100) + '%';
      seg.style.background = (cat && cat.color) || DELETED_CAT_COLOR;
      seg.title = `${(cat && cat.name) || '(삭제된 분류)'} ${formatWon(byCat[cid])}원`;
      bar.appendChild(seg);
    });
    list.appendChild(bar);

    const legend = document.createElement('div');
    legend.className = 'cal-ledger-legend';
    sorted.forEach((cid) => {
      const cat = catById(cid);
      const item = document.createElement('span');
      item.className = 'cal-ledger-legenditem';
      const dot = document.createElement('span');
      dot.className = 'dot';
      dot.style.background = (cat && cat.color) || DELETED_CAT_COLOR;
      item.appendChild(dot);
      const pct = Math.round(byCat[cid] / curTotal * 100);
      item.appendChild(document.createTextNode(
        `${(cat && cat.name) || '(삭제된 분류)'} ${pct}% (${formatWonShort(byCat[cid])})`
      ));
      legend.appendChild(item);
    });
    list.appendChild(legend);
  }

  // ---- 3) 지난 사이클 대비 증감 ----
  addHeading('지난 사이클 대비');
  const prevYM = shiftYM(state.year, state.month, -1);
  const prevPeriod = ledgerPeriodOf(prevYM.y, prevYM.m, payday);
  const prevTotal = sumEntriesInRange(ledgerEntries, prevPeriod.from, prevPeriod.to);
  const diffInfo = ledgerCycleDiff(curTotal, prevTotal);
  const diffLine = document.createElement('div');
  diffLine.className = 'cal-stats-diffline';
  if (diffInfo.kind === 'empty') {
    diffLine.textContent = '비교할 지출 기록이 없어요.';
  } else if (diffInfo.kind === 'noPrev') {
    diffLine.textContent = `지난 사이클엔 지출이 없었어요. 이번 사이클 ${formatWon(diffInfo.curTotal)}원.`;
  } else {
    diffLine.appendChild(document.createTextNode(`이번 ${formatWon(curTotal)}원 · 지난 ${formatWon(prevTotal)}원 · `));
    const span = document.createElement('span');
    if (diffInfo.kind === 'same') {
      span.textContent = '지난 사이클과 같아요.';
    } else if (diffInfo.kind === 'up') {
      span.className = 'cal-stats-diff up';
      span.textContent = `▲ ${diffInfo.pct}% (${formatWon(diffInfo.diff)}원) 더 썼어요`;
    } else {
      span.className = 'cal-stats-diff down';
      span.textContent = `▼ ${diffInfo.pct}% (${formatWon(-diffInfo.diff)}원) 덜 썼어요`;
    }
    diffLine.appendChild(span);
  }
  list.appendChild(diffLine);

  ov.appendChild(head);
  ov.appendChild(list);
  root.appendChild(ov);
}

// 고른 주제로 새 메모 만들고, 그 메모의 일정을 클릭한 날짜로 설정
async function createMemoOnDate(topicId, dateKey) {
  if (!window.api) return;
  try {
    const memo = await window.api.createNewMemo(topicId); // 메모 생성 + 메모창 열림
    if (memo && memo.id) {
      if (window.api.setMemoUseCalendar) await window.api.setMemoUseCalendar(memo.id, true);
      if (window.api.setMemoScheduleAt) await window.api.setMemoScheduleAt(memo.id, `${dateKey}T${NEW_MEMO_TIME}`);
    }
  } catch (e) { /* 실패시 조용히 무시 */ }
  closeOverlays();
  reloadData(); // 메모 변경 신호로도 갱신되지만 확실히 한 번 더
}

async function init() {
  await loadCalendarSettings(); // 주 시작 요일·음력 표시·배경색 설정 먼저 읽고 나서 그리기
  setLocked(true); // 잠금(배경) 상태로 시작
  goToday();      // 오늘로 시작(빈 그리드)
  wireControls();
  reloadData();   // 메모 일정 불러와 칸에 얹기
  reloadLedger().then(() => { if (mode === 'ledger') render(); }); // 가계부 데이터도 미리 읽어둠
  // 위트 멘트 문구 읽어둠(파일 수정은 앱 재시작 후 반영 — 실패해도 멘트만 안 뜰 뿐)
  if (window.api && window.api.getLedgerMents) {
    window.api.getLedgerMents().then((m) => { ledgerMents = m || null; }).catch(() => {});
  }

  // 메모/주제가 바뀌면 달력도 자동 갱신(메인이 memos:updated/topics:updated를 보내줌)
  if (window.api) {
    if (window.api.onMemosUpdated) window.api.onMemosUpdated(() => reloadData());
    if (window.api.onTopicsUpdated) window.api.onTopicsUpdated(() => reloadData());
    // 가계부가 바뀌면(설정에서 분류 수정 포함) 다시 읽어서 다시 그림
    if (window.api.onLedgerUpdated) {
      window.api.onLedgerUpdated(async () => { await reloadLedger(); render(); });
    }
    // 설정(주 시작 요일·음력 표시·배경색)이 바뀌면 다시 읽어서 다시 그림
    if (window.api.onSettingsUpdated) {
      window.api.onSettingsUpdated(async () => { await loadCalendarSettings(); render(); });
    }
    // 메인이 알려주는 잠금/활성화 상태 반영(더블클릭 → 활성, 포커스 잃음 → 잠금)
    if (window.api.onCalendarActiveChanged) {
      window.api.onCalendarActiveChanged((active) => setLocked(!active));
    }
  }
}

document.addEventListener('DOMContentLoaded', init);
