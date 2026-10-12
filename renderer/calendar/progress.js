// 진행 띠(올해 진행 / D-day) — 2026-09-16 추가
// 상단바와 요일 줄 사이에 "올해가 얼마나 지났나" 띠와 "D-day까지 얼마나 왔나" 띠를 그림.
// calendar.js와 같은 전역에서 돌아감(locked, closeOverlays, todayParts, window.api 그대로 사용).
// calendar.js 연결점 2곳: loadCalendarSettings() → loadProgressSettings(cal), render() → renderProgress()
// 설정은 settings.json의 calendar.progress 한 덩어리로 저장(항상 통째로 저장 — 부분 저장하면 다른 줄 값이 날아감)

const PROGRESS_DEFAULTS = {
  year: { on: true, design: 'A', bar: null, pac: null, dot: null },  // bar/pac null = 달력 색(토요일색/오늘색) 따라감, dot null = 연한 회색
  // D-day는 여러 개(ddays 배열). 각 항목은 아래 DDAY_DEFAULT 모양. fmt: left(남은 날) | passed(지난 날)
  ddays: []
};
const DDAY_DEFAULT = { id: 0, on: true, design: 'A', bar: null, pac: null, dot: null, name: 'D-day', target: '', start: '', fmt: 'left' };
const PROGRESS_SWATCHES = ['#3B7DDD', '#D9A63C', '#E5484D', '#5B8A3A', '#8E5BD6', '#1D1D1F', '#A5A5AA']; // 자주 쓰는 색 7개
let progressCfg = JSON.parse(JSON.stringify(PROGRESS_DEFAULTS));

const isHex = (v) => typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v);
const isDateKey = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);

// 저장값을 읽어 빠진 항목은 기본값으로 채움(설정 파일에 없거나 깨져 있어도 안전하게)
function normalizeDday(d, fallbackId) {
  return {
    id: (typeof d.id === 'number' && d.id > 0) ? d.id : fallbackId,
    on: d.on !== false,
    design: ['A', 'B', 'C'].includes(d.design) ? d.design : 'A',
    bar: isHex(d.bar) ? d.bar : null,
    pac: isHex(d.pac) ? d.pac : null,
    dot: isHex(d.dot) ? d.dot : null,
    name: (typeof d.name === 'string' && d.name.trim()) ? d.name.trim() : 'D-day',
    target: isDateKey(d.target) ? d.target : '',
    start: isDateKey(d.start) ? d.start : '',
    fmt: d.fmt === 'passed' ? 'passed' : 'left'
  };
}
function loadProgressSettings(cal) {
  const src = (cal && cal.progress) || {};
  const y = src.year || {};
  // 주의: progressCfg나 ddays 배열·항목 객체를 새로 만들지 말 것 — 열려 있는 설정 패널이 그 객체들을 붙잡고 있어서,
  // 새 객체로 바꾸면 두 번째 변경부터 옛 객체에만 써져 저장이 안 됨(2026-09-16 버그). 값만 제자리에서 갱신함
  Object.assign(progressCfg.year, {
    on: y.on !== false,
    design: ['A', 'B', 'C'].includes(y.design) ? y.design : 'A',
    bar: isHex(y.bar) ? y.bar : null,
    pac: isHex(y.pac) ? y.pac : null,
    dot: isHex(y.dot) ? y.dot : null
  });
  // 예전 저장 형식(dday 한 개)이 있고 ddays가 없으면 첫 항목으로 옮김
  let list = Array.isArray(src.ddays) ? src.ddays : (src.dday && typeof src.dday === 'object' ? [src.dday] : []);
  list = list.filter((d) => d && typeof d === 'object').map((d, i) => normalizeDday(d, Date.now() + i));
  const arr = progressCfg.ddays;
  // id로 맞춰 제자리 갱신: 있으면 값만 덮고, 없으면 추가, 사라진 건 제거, 순서는 저장값 순서대로
  const byId = new Map(arr.map((d) => [d.id, d]));
  const merged = list.map((d) => { const old = byId.get(d.id); if (old) { Object.assign(old, d); return old; } return d; });
  arr.length = 0;
  merged.forEach((d) => arr.push(d));
}

function saveProgressSettings() {
  if (window.api && window.api.saveCalendarSettings) window.api.saveCalendarSettings({ progress: progressCfg });
  renderProgress(); // 저장 응답 기다리지 않고 바로 다시 그림(설정 패널 미리보기 포함)
}

// ---- 날짜 계산 도우미(전부 로컬 날짜 기준) ----
function progDateOf(key) { const [y, m, d] = key.split('-').map(Number); return new Date(y, m - 1, d); }
function progDays(a, b) { return Math.round((b - a) / 86400000); } // a→b 며칠 차이
function progToday() { const t = todayParts(); return new Date(t.y, t.m, t.d); }

// 색: 저장값 없으면 달력 색상 설정(CSS 변수) 그대로. cssVar 없으면(점/남은 부분 색) 빈 문자열 → CSS 기본 회색
function progColor(v, cssVar) {
  if (isHex(v)) return v;
  if (!cssVar) return '';
  return getComputedStyle(document.documentElement).getPropertyValue(cssVar).trim() || '#3B7DDD';
}
// 점/남은 부분 색을 요소에 입힘(빈 값이면 CSS 기본 회색 그대로). big=큰 점은 살짝 진하게
function progDotStyle(el, dot, big) {
  if (!dot) return;
  el.style.background = big ? `color-mix(in srgb, ${dot} 70%, var(--ink))` : dot;
}

// 띠 하나 그리기. design A/B/C, ratio 0~1, colors {bar,pac}, segs = B의 칸 수 / C의 점 개수,
// segFn(i) = B: 그 칸이 찬 비율(0~1) / C: 'big'이면 큰 점
function buildProgressTrack(design, ratio, colors, segs, segFn) {
  ratio = Math.max(0, Math.min(1, ratio));
  const track = document.createElement('div');
  track.className = 'cal-prog-track';
  if (design === 'B') {
    const g = document.createElement('div');
    g.className = 'cal-prog-b';
    g.style.gridTemplateColumns = `repeat(${segs}, 1fr)`;
    for (let i = 0; i < segs; i++) {
      const r = segFn(i);
      const c = document.createElement('i');
      if (r >= 1) c.style.background = colors.bar;
      else if (r > 0) {
        progDotStyle(c, colors.dot);
        const em = document.createElement('em');
        em.style.width = (r * 100) + '%';
        em.style.background = colors.pac;
        c.appendChild(em);
      } else progDotStyle(c, colors.dot);
      g.appendChild(c);
    }
    track.appendChild(g);
  } else if (design === 'C') {
    const eaten = Math.floor(ratio * segs);
    const c = document.createElement('div');
    c.className = 'cal-prog-c';
    const dots = document.createElement('div');
    dots.className = 'dots';
    for (let i = 0; i < segs; i++) {
      const d = document.createElement('i');
      const big = segFn(i) === 'big';
      if (big) d.classList.add('big');
      progDotStyle(d, colors.dot, big);
      if (i < eaten) d.classList.add('eaten');
      dots.appendChild(d);
    }
    c.appendChild(dots);
    const pac = document.createElement('div');
    pac.className = 'cal-prog-pac';
    pac.style.background = colors.pac;
    pac.style.left = (ratio * 100) + '%';
    c.appendChild(pac);
    track.appendChild(c);
  } else {
    const a = document.createElement('div');
    a.className = 'cal-prog-a';
    progDotStyle(a, colors.dot);
    const fill = document.createElement('i');
    fill.style.width = (ratio * 100) + '%';
    fill.style.background = `linear-gradient(90deg, ${colors.bar}, ${colors.pac})`;
    const mark = document.createElement('b');
    mark.style.left = `calc(${ratio * 100}% - 1px)`;
    a.appendChild(fill);
    a.appendChild(mark);
    track.appendChild(a);
  }
  return track;
}

function progLabel(text, extraClass) {
  const s = document.createElement('span');
  s.className = 'cal-prog-lbl' + (extraClass ? ' ' + extraClass : '');
  s.textContent = text;
  return s;
}
function progTip(text) {
  const t = document.createElement('div');
  t.className = 'cal-prog-tip';
  t.textContent = text;
  return t;
}

// ---- 화면에 그리기(render()에서 호출) ----
function renderProgress() {
  renderProgressInto(document.getElementById('cal-progress'));
  renderProgressInto(document.getElementById('cal-progress-preview')); // 설정 패널이 열려 있으면 미리보기도
}
function renderProgressInto(host) {
  if (!host) return;
  host.innerHTML = '';
  const T = progToday();
  const Y = T.getFullYear();

  // 올해 진행 띠
  if (progressCfg.year.on) {
    const cfg = progressCfg.year;
    const colors = { bar: progColor(cfg.bar, '--sat'), pac: progColor(cfg.pac, '--today'), dot: progColor(cfg.dot, null) };
    const y0 = new Date(Y, 0, 1), y1 = new Date(Y + 1, 0, 1);
    const total = progDays(y0, y1);
    const n = progDays(y0, T) + 1;         // 오늘이 올해 며칠째
    const left = total - n;                // 남은 날
    const ratio = n / total;
    const pct = (ratio * 100).toFixed(1);
    const week = Math.ceil(n / 7);
    let segs = 0, segFn = null;
    if (cfg.design === 'B') {
      segs = 12;
      segFn = (i) => {
        const m0 = new Date(Y, i, 1), m1 = new Date(Y, i + 1, 1);
        return Math.max(0, Math.min(1, (progDays(m0, T) + 1) / progDays(m0, m1)));
      };
    } else if (cfg.design === 'C') {
      segs = 52;
      const bigWeeks = new Set();
      for (let m = 0; m < 12; m++) bigWeeks.add(Math.floor(progDays(y0, new Date(Y, m, 1)) / 7));
      segFn = (i) => (bigWeeks.has(i) ? 'big' : '');
    }
    const row = document.createElement('div');
    row.className = 'cal-prog-row';
    row.appendChild(progLabel(String(Y)));
    row.appendChild(buildProgressTrack(cfg.design, ratio, colors, segs, segFn));
    row.appendChild(progLabel(T.getMonth() === 11 ? (left === 0 ? 'D-DAY' : `D-${left}`) : `${pct}%`)); // 12월엔 연말(12/31) 카운트다운
    row.appendChild(progTip(`${Y}년 ${n}일째 · ${week}주차 · ${left}일 남음 (${pct}%)`));
    host.appendChild(row);
  }

  // D-day 띠(켜진 것만, 저장된 순서대로 한 줄씩)
  progressCfg.ddays.filter((d) => d.on).forEach((cfg) => {
    const colors = { bar: progColor(cfg.bar, '--sat'), pac: progColor(cfg.pac, '--today'), dot: progColor(cfg.dot, null) };
    const row = document.createElement('div');
    row.className = 'cal-prog-row';
    row.appendChild(progLabel(cfg.name, 'name'));
    if (!cfg.target) {
      row.appendChild(buildProgressTrack(cfg.design, 0, colors, cfg.design === 'B' ? 10 : 40, () => 0));
      row.appendChild(progLabel('목표일을 정해주세요'));
    } else {
      const tg = progDateOf(cfg.target);
      const st = cfg.start ? progDateOf(cfg.start) : tg;
      const total = Math.max(1, progDays(st, tg));
      const passed = progDays(st, T);
      const left = progDays(T, tg);
      const ratio = left < 0 ? 1 : passed / total;
      const segFn = cfg.design === 'B'
        ? (i) => Math.max(0, Math.min(1, ratio * 10 - i))
        : (i) => (i % 5 === 0 ? 'big' : '');
      row.appendChild(buildProgressTrack(cfg.design, ratio, colors, cfg.design === 'B' ? 10 : 40, segFn));
      let txt;
      if (left < 0) txt = `D+${-left}`;                                  // 목표일 지남
      else if (cfg.fmt === 'passed' && passed >= 0) txt = `+${passed}일`; // 지난 날
      else txt = left === 0 ? 'D-DAY' : `D-${left}`;                     // 남은 날
      row.appendChild(progLabel(txt));
      const tipLeft = left >= 0 ? `${left}일 남음` : `${-left}일 지남`;
      row.appendChild(progTip(`${cfg.start || cfg.target} → ${cfg.target} · ${Math.max(0, passed)}일 지남 · ${tipLeft}`));
    }
    host.appendChild(row);
  });

  // 전부 꺼져 있으면 얇은 줄 하나만 남겨서 클릭할 자리는 유지(미리보기 영역은 제외 — CSS 안내 문구가 대신 나옴)
  if (!host.children.length && host.id === 'cal-progress') {
    const slim = document.createElement('div');
    slim.className = 'cal-prog-slim';
    slim.title = '진행 띠 설정 (전부 꺼짐)';
    host.appendChild(slim);
  }
}

// ---- 설정 패널(띠 클릭) — 달력 설정 패널과 같은 오버레이 방식 ----
function openProgressSettingsPanel() {
  closeOverlays();
  const root = document.getElementById('cal-root');
  const cfg = progressCfg;

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
  title.textContent = '진행 띠 설정';
  const spacer = document.createElement('button');
  spacer.className = 'cal-ov-btn';
  spacer.style.visibility = 'hidden';
  spacer.textContent = '‹';
  head.appendChild(back); head.appendChild(title); head.appendChild(spacer);

  // 미리보기: 패널이 창 전체를 덮어서 실제 띠가 안 보이므로, 같은 띠를 패널 맨 위에 한 번 더 그림
  const preview = document.createElement('div');
  preview.id = 'cal-progress-preview';
  preview.className = 'cal-progress cal-progress-preview';

  const list = document.createElement('div');
  list.className = 'cal-ov-list cal-set';

  let target = null; // 지금 줄을 붙일 곳(null이면 list). D-day 섹션 만들 때 잠깐 바꿈
  const addRow = () => { const r = document.createElement('div'); r.className = 'cal-set-row'; (target || list).appendChild(r); return r; };
  const addHint = (text) => { const h = document.createElement('div'); h.className = 'cal-set-hint'; h.textContent = text; (target || list).appendChild(h); };
  const label = (text, width) => { const s = document.createElement('span'); s.textContent = text; s.style.width = (width || 72) + 'px'; s.style.color = 'var(--ink-soft)'; s.style.flex = '0 0 auto'; return s; };

  // 제목 줄 + 켜기/끄기 스위치
  // (host 생략시 list에 붙음. onDelete 있으면 삭제 버튼도)
  const addHeadingToggle = (text, obj, host, onDelete) => {
    const h = document.createElement('div');
    h.className = 'cal-set-h';
    h.style.display = 'flex'; h.style.alignItems = 'center'; h.style.gap = '8px';
    const t = document.createElement('span');
    t.textContent = text;
    t.style.flex = '1 1 auto';
    h.appendChild(t);
    if (onDelete) {
      const del = document.createElement('button');
      del.className = 'cal-set-del';
      del.textContent = '삭제';
      del.title = '이 D-day를 지워요';
      del.addEventListener('click', onDelete);
      h.appendChild(del);
    }
    const tg = document.createElement('span');
    tg.className = 'cal-prog-tg' + (obj.on ? ' on' : '');
    tg.title = obj.on ? '켜짐 — 누르면 끔' : '꺼짐 — 누르면 켬';
    tg.addEventListener('click', () => { obj.on = !obj.on; tg.classList.toggle('on', obj.on); tg.title = obj.on ? '켜짐 — 누르면 끔' : '꺼짐 — 누르면 켬'; saveProgressSettings(); });
    h.appendChild(tg);
    (host || list).appendChild(h);
    return t;
  };
  // 디자인 A/B/C 고르기
  const addDesignRow = (obj, bLabel) => {
    const r = addRow();
    r.appendChild(label('디자인'));
    const sw = document.createElement('div');
    sw.className = 'cal-prog-sw';
    [['A', 'A 막대'], ['B', bLabel], ['C', 'C 팩맨']].forEach(([v, text]) => {
      const b = document.createElement('button');
      b.textContent = text;
      b.classList.toggle('on', obj.design === v);
      b.addEventListener('click', () => {
        obj.design = v;
        sw.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
        saveProgressSettings();
      });
      sw.appendChild(b);
    });
    r.appendChild(sw);
  };
  // 색 고르기(색상 선택기 + 자주 쓰는 색 동그라미)
  const addColorRow = (text, obj, key, cssVar) => {
    const r = addRow();
    r.appendChild(label(text));
    const inp = document.createElement('input');
    inp.type = 'color';
    inp.value = progColor(obj[key], cssVar) || '#DCDCE0'; // 점 색 기본은 연한 회색으로 표시
    inp.addEventListener('change', () => { obj[key] = inp.value; saveProgressSettings(); });
    r.appendChild(inp);
    const sw = document.createElement('div');
    sw.className = 'cal-prog-swatch';
    PROGRESS_SWATCHES.forEach((c) => {
      const i = document.createElement('i');
      i.style.background = c;
      i.title = c;
      i.addEventListener('click', () => { inp.value = c; obj[key] = c; saveProgressSettings(); });
      sw.appendChild(i);
    });
    r.appendChild(sw);
    const reset = document.createElement('button');
    reset.className = 'cal-set-del';
    reset.textContent = cssVar ? '달력색 따라감' : '기본 회색';
    reset.title = cssVar ? '저장한 색을 지우고 달력 색상 설정(토요일색/오늘색)을 따라가요' : '저장한 색을 지우고 기본 연한 회색으로 돌아가요';
    reset.addEventListener('click', () => { obj[key] = null; inp.value = progColor(null, cssVar) || '#DCDCE0'; saveProgressSettings(); });
    r.appendChild(reset);
  };

  // ---- 올해 진행 띠 ----
  addHeadingToggle('올해 진행 띠', cfg.year);
  addHint('1월 1일부터 12월 31일까지 올해가 얼마나 지났는지 보여줘요. 12월엔 연말 카운트다운(D-N)으로 바뀌어요.');
  addDesignRow(cfg.year, 'B 12칸');
  addColorRow('바 색', cfg.year, 'bar', '--sat');
  addColorRow('팩맨/오늘 색', cfg.year, 'pac', '--today');
  addColorRow('점/남은 부분 색', cfg.year, 'dot', null);

  // ---- D-day 띠(여러 개) ----
  const ddayHost = document.createElement('div'); // D-day 섹션들이 들어가는 곳(추가/삭제시 여기만 다시 그림)
  list.appendChild(ddayHost);
  const addBtnRow = document.createElement('div');
  addBtnRow.className = 'cal-set-row cal-set-addcat';
  const addBtn = document.createElement('button');
  addBtn.className = 'cal-ledger-cancel';
  addBtn.textContent = '+ D-day 추가';
  addBtn.addEventListener('click', () => {
    const d = { ...DDAY_DEFAULT, id: Date.now(), name: `D-day ${cfg.ddays.length + 1}` };
    cfg.ddays.push(d);
    saveProgressSettings();
    renderDdaySections();
    // 새로 만든 섹션의 이름 칸으로 바로 포커스
    const inputs = ddayHost.querySelectorAll('input.cal-set-name');
    if (inputs.length) { inputs[inputs.length - 1].focus(); inputs[inputs.length - 1].select(); }
  });
  addBtnRow.appendChild(addBtn);
  list.appendChild(addBtnRow);

  const buildDdaySection = (d, idx) => {
    const sec = document.createElement('div');
    sec.className = 'cal-prog-ddaysec';
    target = sec;
    const titleEl = addHeadingToggle(`D-day ${idx + 1} · ${d.name}`, d, sec, () => {
      const i = cfg.ddays.indexOf(d);
      if (i >= 0) cfg.ddays.splice(i, 1);
      saveProgressSettings();
      renderDdaySections();
    });
    if (idx === 0) addHint('시작일부터 목표일까지 얼마나 왔는지 보여줘요. 시작일을 비워두면 오늘 정한 날이 시작일이 돼요.');
    const rName = addRow();
    rName.appendChild(label('이름'));
    const nameInp = document.createElement('input');
    nameInp.type = 'text';
    nameInp.className = 'cal-set-name';
    nameInp.placeholder = '예: 프로젝트 마감';
    nameInp.value = d.name;
    nameInp.addEventListener('change', () => { d.name = nameInp.value.trim() || 'D-day'; nameInp.value = d.name; titleEl.textContent = `D-day ${idx + 1} · ${d.name}`; saveProgressSettings(); });
    rName.appendChild(nameInp);

    const rDate = addRow();
    rDate.appendChild(label('목표일'));
    const targetInp = document.createElement('input');
    targetInp.type = 'date';
    targetInp.className = 'cal-set-date';
    targetInp.value = d.target;
    const startInp = document.createElement('input');
    startInp.type = 'date';
    startInp.className = 'cal-set-date';
    startInp.value = d.start;
    targetInp.addEventListener('change', () => {
      d.target = isDateKey(targetInp.value) ? targetInp.value : '';
      // 시작일이 비어 있으면 오늘을 시작일로 잡아둠(띠가 0에서 시작하도록)
      if (d.target && !d.start) { const t = todayParts(); d.start = dateKeyOf(t.y, t.m, t.d); startInp.value = d.start; }
      saveProgressSettings();
    });
    startInp.addEventListener('change', () => { d.start = isDateKey(startInp.value) ? startInp.value : ''; saveProgressSettings(); });
    rDate.appendChild(targetInp);
    rDate.appendChild(label('시작일', 40));
    rDate.appendChild(startInp);

    const rFmt = addRow();
    rFmt.appendChild(label('문구'));
    const fmtSw = document.createElement('div');
    fmtSw.className = 'cal-prog-sw';
    [['left', '남은 날 (D-N)'], ['passed', '지난 날 (+N일)']].forEach(([v, text]) => {
      const b = document.createElement('button');
      b.textContent = text;
      b.classList.toggle('on', d.fmt === v);
      b.addEventListener('click', () => {
        d.fmt = v;
        fmtSw.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
        saveProgressSettings();
      });
      fmtSw.appendChild(b);
    });
    rFmt.appendChild(fmtSw);
    addDesignRow(d, 'B 10칸');
    addColorRow('바 색', d, 'bar', '--sat');
    addColorRow('팩맨/오늘 색', d, 'pac', '--today');
    addColorRow('점/남은 부분 색', d, 'dot', null);
    target = null;
    return sec;
  };
  const renderDdaySections = () => {
    ddayHost.innerHTML = '';
    if (!cfg.ddays.length) {
      const h = document.createElement('div');
      h.className = 'cal-set-h';
      h.textContent = 'D-day 띠';
      ddayHost.appendChild(h);
      const hint = document.createElement('div');
      hint.className = 'cal-set-hint';
      hint.textContent = '아직 D-day가 없어요. 아래 "+ D-day 추가"를 눌러 만들어요. 여러 개 만들면 한 줄씩 늘어나요.';
      ddayHost.appendChild(hint);
    }
    cfg.ddays.forEach((d, i) => ddayHost.appendChild(buildDdaySection(d, i)));
  };
  renderDdaySections();

  ov.appendChild(head);
  ov.appendChild(preview);
  ov.appendChild(list);
  root.appendChild(ov);
  renderProgressInto(preview);
}

// 띠 클릭 → 설정 패널(잠금 중엔 무반응). 날짜가 바뀌어도 띠가 따라오도록 10분마다 다시 그림
document.addEventListener('DOMContentLoaded', () => {
  const host = document.getElementById('cal-progress');
  if (host) host.addEventListener('click', () => { if (!locked) openProgressSettingsPanel(); });
  setInterval(() => { try { renderProgress(); } catch (e) { /* 무시 */ } }, 10 * 60 * 1000);
});
