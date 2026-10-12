// 달력 설정 창 (0.23.0)
// 예전엔 달력 창 안에 겹쳐 뜨던 ⚙ 패널(calendar.js openCalendarSettingsPanel)이었는데,
// 달력 창이 좁아 설정이 답답해서 메모 설정과 같은 모양의 별도 창으로 뺌.
// 저장 통로는 예전과 100% 같음 — 그래서 바꾸는 즉시 달력에 반영됨(main이 달력에 새로고침 신호를 보냄):
//   달력 설정 → window.api.saveCalendarSettings(patch)   (settings.json의 calendar만 병합 저장)
//   가계부 기준·고정지출 → window.api.saveLedgerSettings(patch)  (ledger.json의 settings만)
//   가계부 분류 → window.api.saveLedgerCategories(list)
//   구글 캘린더 → google:* 통로(메모 설정에 있던 코드를 그대로 옮겨옴)
// 저장 버튼 없음: 모든 칸은 바꾸는 즉시 저장(예전 ⚙ 패널과 같은 방식).

// [중요] 파일 전체를 (function(){ ... })() 로 감쌈 — 0.23.0 첫 배포 때 화면이 통째로 비었던 버그 수정.
// preload가 contextBridge로 만든 window.api는 "지울 수 없는 전역 이름"이라, 이 파일 맨 위에서
// const api = ... 처럼 같은 이름을 선언하면 파일 전체가 실행조차 안 됨(SyntaxError). 감싸면 안전.
(function () {
// 달력 색 6종 — calendar.js의 CAL_COLOR_DEFAULTS와 반드시 같아야 함(기본값을 바꾸면 양쪽 다 고칠 것)
const CAL_COLORS = [
  { key: 'bgColor',    def: '#F2F2F4', label: '배경색', hint: '날짜 칸 사이 바탕' },
  { key: 'todayColor', def: '#D9A63C', label: '오늘 강조색' },
  { key: 'sunColor',   def: '#E5484D', label: '일요일·공휴일' },
  { key: 'satColor',   def: '#3B7DDD', label: '토요일' },
  { key: 'inkColor',   def: '#1D1D1F', label: '글자색' },
  { key: 'pastColor',  def: '#F7F7F8', label: '지난 날 칸' }
];

const $ = (id) => document.getElementById(id);
const api = window.api || {};

// ---------- 공용 도우미 ----------
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}
// 입력값 → 양의 정수 또는 null(비움). max가 있으면 그 이하로 자름
function posIntOrNull(v, max) {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n) || n < 1) return null;
  return max ? Math.min(n, max) : n;
}
function todayKey() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// 확인창 — 네이티브 confirm()은 닫힌 뒤 창이 클릭/입력을 못 받는 문제가 있어서(메모 설정과 같은 이유) 자체 구현
let pendingConfirm = null;
function openConfirm(title, hint, onConfirm, confirmLabel) {
  $('confirmModalTitle').textContent = title;
  $('confirmModalHint').textContent = hint || '';
  $('confirmModalHint').hidden = !hint;
  $('confirmModalConfirm').textContent = confirmLabel || '확인';
  pendingConfirm = onConfirm;
  $('confirmModal').hidden = false;
}
$('confirmModalCancel').addEventListener('click', () => { pendingConfirm = null; $('confirmModal').hidden = true; });
$('confirmModalConfirm').addEventListener('click', () => {
  const fn = pendingConfirm;
  pendingConfirm = null;
  $('confirmModal').hidden = true;
  if (fn) fn();
});

// ---------- 왼쪽 메뉴 ----------
const tabBtns = document.querySelectorAll('.tab-btn');
const tabPanels = document.querySelectorAll('.tab-panel');
function switchTab(name) {
  tabBtns.forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  tabPanels.forEach((p) => p.classList.toggle('active', p.dataset.panel === name));
  $('mainScroll').scrollTop = 0;
}
tabBtns.forEach((b) => b.addEventListener('click', () => switchTab(b.dataset.tab)));
// 주소 끝에 #google 처럼 붙여 열면 그 메뉴부터 보여줌(구글 연결 끊김 알림을 눌렀을 때 등)
const startTab = (location.hash || '').replace('#', '');
switchTab(['cal', 'look', 'ledger', 'google'].includes(startTab) ? startTab : 'cal');
if (api.onCalendarSettingsTab) api.onCalendarSettingsTab((name) => { if (name) switchTab(name); });

$('btnClose').addEventListener('click', () => window.close());

// ---------- 달력 / 모양 ----------
const saveCal = (patch) => { if (api.saveCalendarSettings) api.saveCalendarSettings(patch); };

function fillCalendar(cal) {
  // 한 주의 시작
  const mon = cal.weekStart === 'mon';
  $('weekSun').checked = !mon;
  $('weekMon').checked = mon;
  // 음력 — 저장값이 없으면 켜짐(calendar.js와 같은 기본값)
  $('showLunar').checked = cal.showLunar !== false;
  // 공휴일 인증키
  $('holidayKey').value = cal.holidayApiKey || '';
  // 투명도
  const op = typeof cal.opacity === 'number' ? cal.opacity : 100;
  $('calOpacity').value = op;
  $('calOpacityVal').textContent = op + '%';
  // 색 6종
  const card = $('colorCard');
  card.innerHTML = '';
  const inputs = [];
  CAL_COLORS.forEach((c) => {
    const row = el('label', 'row');
    const lab = el('span', 'lab');
    lab.appendChild(el('b', null, c.label));
    if (c.hint) lab.appendChild(el('small', 'hint', c.hint));
    const ctrl = el('span', 'ctrl');
    const code = el('span', 'color-code');
    const inp = document.createElement('input');
    inp.type = 'color';
    inp.className = 'color-input';
    inp.value = cal[c.key] || c.def;
    code.textContent = inp.value.toUpperCase();
    inp.addEventListener('input', () => { code.textContent = inp.value.toUpperCase(); });
    inp.addEventListener('change', () => saveCal({ [c.key]: inp.value }));
    inputs.push({ inp, code, c });
    ctrl.appendChild(code);
    ctrl.appendChild(inp);
    row.appendChild(lab);
    row.appendChild(ctrl);
    card.appendChild(row);
  });
  // 기본값으로 되돌리기
  const resetRow = el('div', 'row');
  const rl = el('span', 'lab');
  rl.appendChild(el('b', null, '색상 기본값으로 되돌리기'));
  const rc = el('span', 'ctrl');
  const resetBtn = el('button', 'btn-light', '되돌리기');
  resetBtn.type = 'button';
  resetBtn.addEventListener('click', () => {
    openConfirm('달력 색 6가지를 기본값으로 되돌릴까요?', '', () => {
      const patch = {};
      inputs.forEach(({ inp, code, c }) => { inp.value = c.def; code.textContent = c.def.toUpperCase(); patch[c.key] = c.def; });
      saveCal(patch);
    }, '되돌리기');
  });
  rc.appendChild(resetBtn);
  resetRow.appendChild(rl);
  resetRow.appendChild(rc);
  card.appendChild(resetRow);
}

[$('weekSun'), $('weekMon')].forEach((r) => r.addEventListener('change', () => {
  if (r.checked) saveCal({ weekStart: r.value });
}));
$('showLunar').addEventListener('change', () => saveCal({ showLunar: $('showLunar').checked }));
$('holidayKey').addEventListener('change', () => saveCal({ holidayApiKey: $('holidayKey').value.trim() }));
$('calOpacity').addEventListener('input', () => { $('calOpacityVal').textContent = $('calOpacity').value + '%'; });
$('calOpacity').addEventListener('change', () => saveCal({ opacity: Number($('calOpacity').value) || 100 }));
// 진행 띠 설정은 달력 위에서 미리보기를 보며 고르는 화면이라 달력 쪽에 열어줌
$('btnProgress').addEventListener('click', () => { if (api.openProgressSettingsInCalendar) api.openProgressSettingsInCalendar(); });

// ---------- 가계부 ----------
let ledgerCats = [];
let fixedList = [];

async function saveLedgerSettings(patch) {
  if (!api.saveLedgerSettings) return;
  try { await api.saveLedgerSettings(patch); } catch (e) { /* 실패해도 화면은 유지 */ }
}

function fillLedgerBase(ls) {
  $('payday').value = ls.payday || '';
  $('weeklyBudget').value = ls.weeklyBudget || '';
  $('monthlyBudget').value = ls.monthlyBudget || '';
}
$('payday').addEventListener('change', () => saveLedgerSettings({ payday: posIntOrNull($('payday').value, 31) }));
$('weeklyBudget').addEventListener('change', () => saveLedgerSettings({ weeklyBudget: posIntOrNull($('weeklyBudget').value) }));
$('monthlyBudget').addEventListener('change', () => saveLedgerSettings({ monthlyBudget: posIntOrNull($('monthlyBudget').value) }));

// 고정 지출: 한 줄 = 매달 [일] [분류] [금액] 원 [메모] [✕]. 바꾸면 목록 통째로 저장(예전과 같음)
const saveFixed = () => saveLedgerSettings({ fixed: fixedList });
function renderFixed() {
  const card = $('fixedCard');
  card.innerHTML = '';
  fixedList.forEach((f, idx) => {
    const row = el('div', 'row fixed-row');
    row.appendChild(document.createTextNode('매달'));
    const dayIn = document.createElement('input');
    dayIn.type = 'number'; dayIn.min = '1'; dayIn.max = '31';
    dayIn.value = f.day || 1;
    dayIn.addEventListener('change', () => { fixedList[idx].day = posIntOrNull(dayIn.value, 31) || 1; dayIn.value = fixedList[idx].day; saveFixed(); });
    row.appendChild(dayIn);
    row.appendChild(document.createTextNode('일'));
    const catSel = document.createElement('select');
    ledgerCats.forEach((c) => { const o = el('option', null, c.name); o.value = c.id; catSel.appendChild(o); });
    if (f.categoryId) catSel.value = f.categoryId;
    catSel.addEventListener('change', () => { fixedList[idx].categoryId = catSel.value; saveFixed(); });
    row.appendChild(catSel);
    const amt = document.createElement('input');
    amt.type = 'number'; amt.min = '1'; amt.className = 'money'; amt.placeholder = '금액';
    if (f.amount) amt.value = f.amount;
    amt.addEventListener('change', () => { fixedList[idx].amount = posIntOrNull(amt.value) || 0; saveFixed(); });
    row.appendChild(amt);
    row.appendChild(document.createTextNode('원'));
    const memo = document.createElement('input');
    memo.type = 'text'; memo.className = 'memo-in'; memo.placeholder = '메모(예: 월세)';
    memo.value = f.memo || '';
    memo.addEventListener('change', () => { fixedList[idx].memo = memo.value.trim(); saveFixed(); });
    row.appendChild(memo);
    const del = el('button', 'del-x', '✕');
    del.type = 'button';
    del.title = '고정 지출 삭제(이미 기입된 기록은 남아요)';
    del.addEventListener('click', () => {
      openConfirm('이 고정 지출을 삭제할까요?', '이미 기입된 기록은 남아요.', () => {
        fixedList.splice(idx, 1);
        saveFixed();
        renderFixed();
      }, '삭제');
    });
    row.appendChild(del);
    card.appendChild(row);
  });
  const addRow = el('div', 'row add-row');
  const addBtn = el('button', 'btn-light', '+ 고정 지출 추가');
  addBtn.type = 'button';
  addBtn.addEventListener('click', () => {
    fixedList.push({
      id: 'fix-' + Date.now(),
      day: 1,
      categoryId: (ledgerCats[0] && ledgerCats[0].id) || 'etc',
      amount: 0,
      memo: '',
      // 등록일 — 등록한 날보다 앞선 날짜로는 자동 기입 안 함(예전 패널과 같음)
      createdAt: todayKey()
    });
    renderFixed(); // 금액을 넣기 전까지는 자동 기입 안 됨
  });
  addRow.appendChild(addBtn);
  card.appendChild(addRow);
}

// 분류: 한 줄 = [색] [이름] [✕]. 바꾸면 목록 통째로 저장
async function saveCats() {
  if (!api.saveLedgerCategories) return;
  try {
    const saved = await api.saveLedgerCategories(ledgerCats);
    if (saved) ledgerCats = saved.map((c) => ({ ...c }));
  } catch (e) { /* 실패해도 화면 유지 */ }
}
function renderCats() {
  const card = $('catCard');
  card.innerHTML = '';
  ledgerCats.forEach((cat, idx) => {
    const row = el('div', 'row cat-row');
    const color = document.createElement('input');
    color.type = 'color'; color.className = 'color-input';
    color.value = cat.color || '#8A8577';
    color.addEventListener('change', async () => { ledgerCats[idx].color = color.value; await saveCats(); });
    const name = document.createElement('input');
    name.type = 'text';
    name.value = cat.name || '';
    name.addEventListener('change', async () => {
      ledgerCats[idx].name = name.value.trim() || cat.name;
      await saveCats();
      renderCats();
      renderFixed(); // 고정 지출의 분류 이름도 새로
    });
    const del = el('button', 'del-x', '✕');
    del.type = 'button';
    del.title = '분류 삭제';
    del.disabled = ledgerCats.length <= 1; // 최소 1개는 남김
    del.addEventListener('click', () => {
      if (ledgerCats.length <= 1) return;
      openConfirm(`"${cat.name}" 분류를 삭제할까요?`, '기록은 남지만 색은 회색이 돼요.', async () => {
        ledgerCats.splice(idx, 1);
        await saveCats();
        renderCats();
        renderFixed();
      }, '삭제');
    });
    row.appendChild(color);
    row.appendChild(name);
    row.appendChild(del);
    card.appendChild(row);
  });
  const addRow = el('div', 'row add-row');
  const addBtn = el('button', 'btn-light', '+ 분류 추가');
  addBtn.type = 'button';
  addBtn.addEventListener('click', async () => {
    ledgerCats.push({ id: 'cat-' + Date.now(), name: '새 분류', color: '#C9A24B' });
    await saveCats();
    renderCats();
    renderFixed();
  });
  addRow.appendChild(addBtn);
  card.appendChild(addRow);
}

$('btnCsv').addEventListener('click', async () => {
  if (!api.exportLedgerCsv) return;
  try {
    const r = await api.exportLedgerCsv();
    if (r && !r.canceled) $('csvStatus').textContent = `저장 완료 — 지출 ${r.count}건을 내보냈어요`;
  } catch (e) {
    $('csvStatus').textContent = '내보내기에 실패했어요';
  }
});

// ---------- 처음 불러오기 ----------
async function loadAll() {
  let cal = {};
  try { const s = await api.getSettings(); cal = (s && s.calendar) || {}; } catch (e) { /* 기본값 */ }
  fillCalendar(cal);
  try {
    const ledger = await api.getLedger();
    ledgerCats = ((ledger && ledger.categories) || []).map((c) => ({ ...c }));
    const ls = (ledger && ledger.settings) || {};
    fixedList = (ls.fixed || []).map((f) => ({ ...f }));
    fillLedgerBase(ls);
  } catch (e) { /* 가계부를 못 읽어도 나머지는 동작 */ }
  renderFixed();
  renderCats();
}
loadAll();

/* ---------- 구글 캘린더(0.22.0) — 메모 설정(settings.js)에서 그대로 옮겨옴 ----------
   누르는 즉시 main 으로 보냄(google:* 통로). 상태는 main 이 'google:status' 로 계속 알려줌 */
const gEls = {
  state: $('googleState'),
  client: $('btnGoogleClient'),
  connect: $('btnGoogleConnect'),
  sync: $('btnGoogleSync'),
  disconnect: $('btnGoogleDisconnect'),
  interval: $('googleInterval'),
  info: $('googleInfo'),
  error: $('googleError')
};
let gBusy = false;
let gLastStatus = null;
const gFmtTime = (iso) => {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`;
};
function googleShowError(msg) {
  gEls.error.textContent = msg ? LANG.settings.general.googleErrorPrefix + msg : '';
  gEls.error.hidden = !msg;
}
function renderGoogleStatus(st) {
  if (!st) return;
  gLastStatus = st;
  const G = LANG.settings.general;
  let text;
  if (st.connecting) text = G.googleStateConnecting;
  else if (st.syncing) text = G.googleStateSyncing;
  else if (!st.hasClient) text = G.googleStateNoClient;
  else if (st.connected && st.needsReconnect) text = G.googleStateNeedsReconnect;
  else if (st.connected) text = G.googleStateConnected.replace('{account}', st.account || '');
  else text = G.googleStateReady;
  gEls.state.textContent = text;
  gEls.connect.textContent = st.connected && st.needsReconnect ? G.googleReconnectButton : G.googleConnectButton;
  gEls.connect.hidden = st.connected && !st.needsReconnect;
  const locked = gBusy || st.connecting || st.syncing;
  gEls.client.disabled = locked;
  gEls.connect.disabled = locked || !st.hasClient;
  gEls.sync.disabled = locked || !st.connected || st.needsReconnect;
  gEls.disconnect.disabled = locked || !st.connected;
  gEls.sync.hidden = !st.connected;
  gEls.disconnect.hidden = !st.connected;
  if (document.activeElement !== gEls.interval) gEls.interval.value = String(st.intervalMin || 5);
  if (st.connected) {
    const r = st.lastResult;
    gEls.info.textContent = st.lastSyncAt
      ? G.googleLastSync.replace('{time}', gFmtTime(st.lastSyncAt)) +
        (r ? G.googleLastResult.replace('{added}', r.added || 0).replace('{updated}', r.updated || 0)
          .replace('{trashed}', r.trashed || 0).replace('{pushed}', r.pushed || 0) : '')
      : G.googleNeverSynced;
  } else {
    gEls.info.textContent = '';
  }
  // 동기화 오류는 연결돼 있을 때만 보여줌(해제 상태에서 옛 오류가 남아 보이지 않게)
  if (!gBusy) googleShowError(st.connected ? st.lastError : null);
}
async function googleAction(fn) {
  if (gBusy) return;
  gBusy = true;
  googleShowError(null);
  if (gLastStatus) renderGoogleStatus(gLastStatus);
  let res = null;
  try { res = await fn(); } catch (e) { res = { ok: false, error: String(e && e.message ? e.message : e) }; }
  gBusy = false;
  if (res && res.status) renderGoogleStatus(res.status);
  else if (gLastStatus) renderGoogleStatus(gLastStatus);
  if (res && res.ok === false && res.error) googleShowError(res.error);
  return res;
}
function initGoogleSection() {
  if (!api.googleGetStatus) { $('googleSection').hidden = true; return; }
  const G = LANG.settings.general;
  $('googleHint').textContent = G.googleHint;
  $('googleHint2').textContent = G.googleHint2;
  $('googleIntervalLabel').textContent = G.googleIntervalLabel;
  $('googleIntervalUnit').textContent = G.googleIntervalUnit;
  gEls.client.textContent = G.googleClientButton;
  gEls.connect.textContent = G.googleConnectButton;
  gEls.sync.textContent = G.googleSyncButton;
  gEls.disconnect.textContent = G.googleDisconnectButton;

  gEls.client.addEventListener('click', () => googleAction(async () => {
    const r = await api.googleChooseClientFile();
    if (r && r.ok) gEls.info.textContent = G.googleClientOk;
    return r;
  }));
  gEls.connect.addEventListener('click', () => googleAction(() => api.googleConnect()));
  gEls.sync.addEventListener('click', () => googleAction(() => api.googleSyncNow()));
  gEls.disconnect.addEventListener('click', () => {
    openConfirm(G.googleDisconnectConfirm, G.googleDisconnectHint,
      () => googleAction(() => api.googleDisconnect()));
  });
  // 주기: 칸에서 벗어나거나 엔터 치면 바로 저장
  const saveInterval = async () => {
    const v = gEls.interval.value.trim();
    if (gLastStatus && String(gLastStatus.intervalMin) === v) return;
    const r = await api.googleSetInterval(v);
    if (r && r.ok) { googleShowError(null); renderGoogleStatus(r.status); }
    else {
      googleShowError(r && r.error);
      if (gLastStatus) gEls.interval.value = String(gLastStatus.intervalMin);
    }
  };
  gEls.interval.addEventListener('change', saveInterval);
  gEls.interval.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); gEls.interval.blur(); }
  });
  if (api.onGoogleStatus) api.onGoogleStatus((st) => renderGoogleStatus(st));
  api.googleGetStatus().then(renderGoogleStatus).catch(() => {});
}
initGoogleSection();
})();
