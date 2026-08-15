const { app, BrowserWindow, Tray, Menu, ipcMain, dialog, screen, clipboard, globalShortcut, nativeImage, Notification, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { randomUUID } = require('crypto');
const store = require('./src/store');
const {
  needsChecklistMigration,
  buildContentWithChecklist,
  needsTableMigration,
  buildContentWithTables,
  needsImageMigration,
  buildContentWithImages,
} = require('./src/migrate');
const {
  exportMemoToObsidian,
  exportAsTxt,
  sanitizeFileName,
  suggestFileName,
  exportAllMemos,
  exportAllMemosOverwrite
} = require('./src/exporter');

// (되돌림) 하드웨어 가속을 끄면 투명 창(위젯/메모창)이 아예 안 보이는 문제가 있어서 제거함.
// 타이핑시 깜빡임은 다른 방법으로 다시 시도해야 함

// ---- 이중 실행 방지 ----
// 예전엔 앱을 몇 개든 동시에 켤 수 있어서(예: 부팅 자동시작이 느린 사이에 아이콘을 또 클릭),
// 두 앱이 같은 설정파일을 서로 덮어쓰며 "접어놨는데 펴져 있음/숨겨놨는데 다 켜짐" 같은
// 상태 기억 실패의 원인이 됐음. 잠금을 못 얻은(=이미 켜져 있는) 두 번째 실행은 즉시 종료하고,
// 대신 이미 켜져 있던 앱이 위젯을 앞으로 보여줌
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    // 사용자가 앱을 또 실행하려고 했다는 뜻 — 이미 켜져 있다는 걸 알 수 있게 위젯을 앞으로
    if (widgetWindow) {
      if (widgetWindow.isMinimized()) widgetWindow.restore();
      widgetWindow.show();
      widgetWindow.focus();
    } else {
      createWidgetWindow();
    }
  });
}

const ATTACH_DIR = () => {
  const dir = path.join(app.getPath('userData'), 'attachments');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
};

let tray = null;
let widgetWindow = null;
// (1.8.16 신규) 위젯 세로 자동크기조절시 어느 모서리를 고정할지('top'=기존처럼 위쪽 고정,
// 아래로 늘어남 | 'bottom'=아래쪽 고정, 위로 늘어남). 위젯을 만들 때/옮길 때만 다시 계산하고
// (아래 computeWidgetVerticalAnchor 참고), 내용물 크기 때문에 창이 늘고 줄 때는 다시 계산하지
// 않음 — 매번 다시 계산하면 화면 중간쯤에서 창이 커지는 도중에 위/아래 기준이 갑자기 바뀌어
// 버릴 수 있어서(위쪽 남은 공간과 아래쪽 남은 공간이 커지는 도중 역전됨), 사용자가 위젯을
// "옮길 때"만 다시 판단하도록 함
let widgetVerticalAnchor = 'top';
let settingsWindow = null;
let calendarWindow = null; // 바탕화면 달력 창(메모앱과 데이터 공유하는 별도 창)
let welcomeWindow = null;
let memoLinkWindow = null; // "메모 연결" 검색 팝업(메모지 크기에 안 갇히게 별도 작은 창으로 뜸)
let memoLinkTargetMemoId = null; // 팝업에서 고른 링크를 어느 메모창에 꽂아줄지 기억해둠
let searchWindow = null; // 위젯 🔍 검색 팝업(메모 연결 팝업과 같은 방식의 별도 작은 창)
let moveTopicWindow = null; // "다른 주제로 이동" 팝업(메모지 안에 갇혀 있던 걸 메모 연결 팝업과 같은 방식으로 분리함)
let moveTopicTargetMemoId = null; // 팝업에서 고른 주제를 어느 메모창에 반영할지 기억해둠
const memoWindows = new Map(); // memoId -> BrowserWindow
// (변경) 예전엔 전체숨김/주제숨김 상태가 메모리에만 있어서 재시작하면 무조건 초기화됐고,
// 부팅 후 일부러 숨겨둔 메모까지 전부 다시 켜지는 불편이 있었음(태훈님 요청으로 영구 저장으로 전환).
// 아래 값들은 바뀔 때마다 persistVisibilityState()로 settings.json의 memoVisibility에 저장되고,
// 앱 시작 때 다시 읽어와서 종료 직전 상태 그대로 복원됨
let allMemosHidden = false; // 위젯 '전체 숨기기' 상태 (영구 저장)
const hiddenTopicIds = new Set(); // 주제별 '숨기기' 상태 (영구 저장)
// 전체숨김 버튼 4단계 순환: 누를 때마다 0)다 숨기기 → 1)직전 상태로 복원 → 2)다 보이기 → 3)직전 상태로 복원
let visibilityCycle = 0; // 다음에 누르면 실행될 단계 (영구 저장)
let visibilitySnapshot = []; // "다 숨기기"를 누르기 직전의 hiddenTopicIds 스냅샷 (복원 단계에서 사용, 영구 저장)
const pinnedTopicIds = new Set(); // 주제별 '항상위' 상태 (메모리 상주, 메모별 alwaysOnTop 값에도 반영됨)
let lastNewMemoPos = null; // 새 메모를 마지막으로 어디에 열었는지(겹치지 않게 사선으로 배치하는 데 사용)
let lastNewMemoDisplayId = null; // 위 위치가 어느 모니터 기준이었는지(모니터가 바뀌면 사선 배치를 이어가지 않고 새로 시작하기 위함)
// 단축키로 새 메모를 만들 때 "직전에 작업하던 주제"에 만들어주기 위한 추적값.
// 메모창이 포커스를 얻을 때마다 그 메모의 주제로 갱신됨(main.js 안에서만 쓰는 메모리 상주 값)
let lastActiveTopicId = null;

const ICON_PATH = path.join(__dirname, 'assets', 'icon.png');
const ICON_ICO_PATH = path.join(__dirname, 'assets', 'icon.ico');
// 트레이는 Windows에서 .ico가 더 안정적으로 표시됨
const TRAY_ICON_PATH = process.platform === 'win32' ? ICON_ICO_PATH : ICON_PATH;

const WIDGET_COLLAPSED_HEIGHT = 44;
const MEMO_COLLAPSED_HEIGHT = 44;
const MEMO_MIN_HEIGHT = 220;

function currentOpacity() {
  const settings = store.getSettings();
  const value = settings.opacity;
  return (typeof value === 'number' ? value : 100) / 100;
}

// ---------- 창 생성 ----------

function createMemoWindow(memo, options = {}) {
  // 이미 내보낸 적 있는 메모라면, 실제 내보낸 파일이 지금도 있는지 열 때마다 확인함.
  // 앱이 Vault 폴더를 계속 감시하고 있는 건 아니라서, 폴더에서 파일을 직접 지웠어도
  // 그 사이엔 모르고 있다가 이렇게 다음에 열 때 확인해서 알아챔 — 파일이 없으면
  // "내보내기 완료" 표시를 지우고 내보내기 버튼이 다시 눌리게 해줌
  if (memo.obsidian && memo.obsidian.saved && memo.obsidian.filePath && !fs.existsSync(memo.obsidian.filePath)) {
    memo.obsidian = { saved: false, filePath: null };
    const memos = store.getMemos();
    const idx = memos.findIndex((m) => m.id === memo.id);
    if (idx !== -1) {
      memos[idx].obsidian = memo.obsidian;
      store.saveMemos(memos);
    }
  }

  const win = new BrowserWindow({
    width: memo.size?.width || 320,
    height: memo.collapsed ? MEMO_COLLAPSED_HEIGHT : (memo.size?.height || 380),
    x: memo.position?.x,
    y: memo.position?.y,
    frame: false,
    // (수정) 모서리를 각지게 바꾼 이상 창을 굳이 투명(transparent)하게 만들 이유가 없음.
    // 카드 배경(memo.css의 --paper)이 창 전체를 불투명하게 꽉 채우고 있어서, 원래 transparent는
    // "둥근 모서리 바깥쪽을 투명하게 보이게" 하려고 있었던 것뿐임. 투명 창은 Windows에서
    // 타이핑할 때 다시 그려지며 깜빡이는 문제의 유력한 원인이라 꺼봄(화면 투명도 슬라이더는
    // 아래 opacity 옵션으로 별도 동작하니 계속 정상 작동함)
    transparent: false,
    // 창 크기를 조절할 때 아직 안 그려진 영역이 이 색으로 잠깐 보임 — 기본 크림색으로 고정돼 있으면
    // 어두운 메모지에서 잔상이 도드라져 보여서, 처음부터 메모지 색과 똑같이 맞춰줌
    // (색을 바꾸면 memos:setColor/memos:setTopic에서 setBackgroundColor로 같이 갱신함)
    backgroundColor: memo.color || '#FBFAF5',
    hasShadow: false,
    roundedCorners: false, // 모서리를 각지게(직각)로
    alwaysOnTop: !!memo.alwaysOnTop,
    resizable: true,
    minWidth: 240,
    minHeight: memo.collapsed ? MEMO_COLLAPSED_HEIGHT : MEMO_MIN_HEIGHT,
    skipTaskbar: true,
    opacity: currentOpacity(),
    icon: ICON_PATH,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      // 체크리스트/표 칸(spellcheck=false를 각 요소에 개별로도 걸어뒀지만, 혹시 빠뜨린 칸이
      // 있어도 빨간 밑줄이 안 뜨도록 창 전체 단위로 한 번 더 확실히 꺼둠) — 1.8.14 2차 피드백
      spellcheck: false,
      // 위젯이 닫혀 있을 때 알람 소리를 낼 수 있도록 메모창에도 자동재생 허용(대체 재생처)
      autoplayPolicy: 'no-user-gesture-required'
    }
  });

  win.loadFile(path.join(__dirname, 'renderer', 'memo', 'index.html'));

  win.webContents.on('did-finish-load', () => {
    // skipTitleFirst는 저장 파일(memos.json)에 남기지 않는 값 — 새 메모를 만드는
    // 이 순간에만 "제목 입력창을 건너뛸지"를 알려주는 용도라 memo 객체엔 없고
    // options로만 넘어옴 (기존 메모를 다시 열 때는 항상 false)
    win.webContents.send('memo:init', { ...memo, skipTitleFirst: !!options.skipTitleFirst });
    if (settingsWindow) win.webContents.send('app:settingsOpened');
  });

  win.on('focus', () => {
    lastActiveTopicId = memo.topicId;
  });

  win.on('moved', () => {
    const [x, y] = win.getPosition();
    updateMemoGeometry(memo.id, { position: { x, y } });
  });
  win.on('resized', () => {
    const [x, y] = win.getPosition();
    const [width, height] = win.getSize();
    const cur = store.getMemos().find((m) => m.id === memo.id);
    if (cur && cur.collapsed) {
      // 접힘 상태의 임시 높이는 저장하지 않고, 폭/위치만 반영
      updateMemoGeometry(memo.id, { position: { x, y }, size: { width, height: cur.size?.height || height } });
      return;
    }
    updateMemoGeometry(memo.id, { position: { x, y }, size: { width, height } });
  });

  memoWindows.set(memo.id, win);
  markMemoWindowOpen(memo.id, true);
  win.on('closed', () => {
    memoWindows.delete(memo.id);
    // 이 메모창을 대상으로 "메모 연결" 팝업이 열려있었다면 갈 곳이 없어지니 같이 닫음
    if (memoLinkWindow && memoLinkTargetMemoId === memo.id) memoLinkWindow.close();
    // 이 메모창을 대상으로 "주제 이동" 팝업이 열려있었다면 같이 닫음
    if (moveTopicWindow && moveTopicTargetMemoId === memo.id) moveTopicWindow.close();
    // 메모창이 닫히면 위젯의 "열림/숨김" 표시 아이콘이 최신 상태를 반영하도록 새로고침 신호를 보냄
    broadcastMemosUpdated();
  });

  // forceVisible: 주제가 숨김 상태여도 이번에 새로 만든 메모만은 숨기지 않고 바로 보여줌
  // (전체숨김 중의 새 메모는 createNewMemo가 materializeHiddenState로 전체숨김을 주제별
  // 숨김으로 풀어준 뒤 forceVisible로 들어오므로 여기서도 바로 보이게 됨)
  if (allMemosHidden || (!options.forceVisible && hiddenTopicIds.has(memo.topicId))) win.hide();

  return win;
}

// showInactive()는 OS가 창을 실제로 화면에 띄우는 데 살짝 시간이 걸려서, 호출한 바로 다음 줄에서
// 위젯에 새로고침 신호를 보내면 아직 "안 보이는" 상태로 읽혀 눈 아이콘이 한 박자 늦게 갱신되는
// 문제가 있었음(숨길 때는 즉시 반영되는데 보이게 할 때만 유독 안 되던 원인). 'show' 이벤트가
// 실제로 발생한 뒤에 신호를 보내도록 바꿔서 해결함
function showWindowAndNotify(win) {
  win.once('show', () => {
    broadcastMemosUpdated();
  });
  win.showInactive();
}

// initialPos를 넘기면(예: 최초 설치 직후 웰컴창 옆에 붙이는 용도) 저장된 위치/기본 귀퉁이 위치
// 대신 그 좌표를 그대로 씀. 그 외에는 기존처럼 저장된 위치 → 없으면 화면 우측 상단 귀퉁이 순
function createWidgetWindow(initialPos) {
  if (widgetWindow) {
    widgetWindow.focus();
    return;
  }
  const settings = store.getSettings();
  const { width: sw } = screen.getPrimaryDisplay().workAreaSize;
  const startHeight = settings.widget.collapsed ? WIDGET_COLLAPSED_HEIGHT : settings.widget.height;
  const hasSavedPos = typeof settings.widget.x === 'number' && typeof settings.widget.y === 'number';

  let startX, startY;
  if (initialPos) {
    // 화면이 좁아서 웰컴창 오른쪽에 다 안 들어가면(드물지만) 화면 안쪽으로 당겨줌
    startX = Math.min(initialPos.x, sw - settings.widget.width - 10);
    startY = initialPos.y;
  } else if (hasSavedPos) {
    startX = settings.widget.x;
    startY = settings.widget.y;
  } else {
    startX = sw - settings.widget.width - 20;
    startY = 40;
  }

  widgetWindow = new BrowserWindow({
    width: settings.widget.width,
    height: startHeight,
    x: startX,
    y: startY,
    frame: false,
    // (수정) 메모창과 같은 이유로 transparent 끔 — 위젯 배경(widget.css의 --paper)이
    // 창 전체를 불투명하게 채우므로 더는 필요 없고, 타이핑 깜빡임의 유력한 원인이었음
    transparent: false,
    backgroundColor: '#F7F4EC',
    hasShadow: false,
    roundedCorners: false, // 모서리를 각지게(직각)로
    alwaysOnTop: settings.widget.alwaysOnTop !== false,
    // 완전축소 상태로 종료했다가 다시 켠 경우, 시작부터 크기 조절이 막혀 있어야
    // widget:setHandleOnly에서 켠 잠금과 어긋나지 않음
    resizable: !settings.widget.handleOnly,
    maximizable: false, // 타이틀바(드래그 영역) 더블클릭시 전체화면으로 "터지는" 것 방지 — 위젯은 전체화면일 필요가 없음
    skipTaskbar: true,
    opacity: currentOpacity(),
    icon: ICON_PATH,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      // 알람 소리를 사용자 클릭 없이도 낼 수 있게 자동재생 허용(위젯이 알람음 재생 담당)
      autoplayPolicy: 'no-user-gesture-required'
    }
  });

  widgetWindow.loadFile(path.join(__dirname, 'renderer', 'widget', 'index.html'));
  widgetWindow.on('closed', () => (widgetWindow = null));

  // 세로 크기는 사용자가 마우스로 임의 조절 못하게 막음(가로만 허용) — 세로는 항상
  // 메모 목록 내용에 맞춰 자동으로만 정해짐 (아래 widget:resize 로만 높이가 바뀜)
  // (수정) newBounds 값만 되돌리는 방식은 일부 환경에서 실제로 안 먹는 경우가 있어서,
  // 리사이즈 자체를 취소(preventDefault)한 뒤 폭만 반영해서 다시 크기를 지정하는 방식으로 변경함
  widgetWindow.on('will-resize', (event, newBounds) => {
    if (store.getSettings().widget.collapsed) return; // 접힘 상태는 높이가 고정값이라 상관없음
    const bounds = widgetWindow.getBounds();
    if (newBounds.height === bounds.height) return; // 폭만 바뀌는 경우는 그대로 허용
    event.preventDefault();
    widgetWindow.setBounds({
      x: newBounds.x,
      y: bounds.y,
      width: newBounds.width,
      height: bounds.height
    });
  });

  // 위젯 크기가 바뀔 때마다(자동 확장/축소든) 실제 크기를 저장해둠
  // → 접었다 펼쳤을 때나 재시작 후에도 마지막 크기가 그대로 복원됨
  widgetWindow.on('resized', () => {
    const s = store.getSettings();
    const [width, height] = widgetWindow.getSize();
    // width는 "지금 실제 창 폭"이라 접힘/펼침 상관없이 항상 저장(재시작시 복원용)
    s.widget.width = width;
    // 하지만 "펼친 상태의 진짜 폭"(expandedWidth)과 "펼친 상태의 진짜 높이"(expandedHeight)는
    // 펼쳐져 있을 때 바뀐 경우에만 저장 — 접힘 상태에서 주제 버튼 수에 맞춰 자동으로 늘고 준 폭이나
    // 접힘 임시 높이(44px)가 "펼친 상태 값"까지 덮어써버리면 안 됨(펼쳤을 때 그 값으로 복원되므로)
    if (!s.widget.collapsed) {
      s.widget.height = height;
      s.widget.expandedHeight = height;
      s.widget.expandedWidth = width;
    }
    store.saveSettings(s);
    widgetWindow.webContents.send('widget:sizeChanged', { width, height });
  });

  // 위젯 위치가 바뀔 때마다 저장 → 다음 실행시 마지막 위치에서 시작
  // (수정) 저장뿐 아니라, 위젯이 다른 모니터로 옮겨졌을 수도 있으니 그 모니터의 화면 크기를
  // 즉시 다시 계산해서 렌더러에 알려줌 — 자동크기 한도(syncHeight/syncCollapsedWidth)가
  // 옮긴 직후 모니터가 바뀐 걸 바로 반영하도록 함(다음 loadAll까지 기다리지 않아도 됨)
  widgetWindow.on('moved', () => {
    const s = store.getSettings();
    const [x, y] = widgetWindow.getPosition();
    s.widget.x = x;
    s.widget.y = y;
    store.saveSettings(s);
    const work = screen.getDisplayNearestPoint({ x, y }).workArea;
    // (1.8.16 신규) 위젯을 옮길 때만 위/아래 고정 기준을 다시 계산함(내용물 때문에 창이
    // 커질 때는 계산 안 함 — computeWidgetVerticalAnchor 주석 참고)
    widgetVerticalAnchor = computeWidgetVerticalAnchor(widgetWindow);
    widgetWindow.webContents.send('screen:workAreaChanged', {
      width: work.width,
      height: work.height,
      verticalAnchor: widgetVerticalAnchor
    });
  });
}

// ---------- 달력 창 ----------
// 메모앱과 같은 앱 안의 별도 창. 위젯 창과 같은 안정적 방식(frameless, skipTaskbar,
// transparent 끄고 배경색 채움, opacity로 반투명)을 그대로 따름. 위치/크기는 저장·복원.
function createCalendarWindow() {
  if (calendarWindow) {
    calendarWindow.show();
    calendarWindow.focus();
    return calendarWindow;
  }
  const settings = store.getSettings();
  const cal = settings.calendar || {};
  const { width: sw, height: shp } = screen.getPrimaryDisplay().workAreaSize;

  const winW = typeof cal.width === 'number' ? cal.width : 340;
  const winH = typeof cal.height === 'number' ? cal.height : 360;
  const hasSavedPos = typeof cal.x === 'number' && typeof cal.y === 'number';
  const startX = hasSavedPos ? cal.x : Math.round((sw - winW) / 2);
  const startY = hasSavedPos ? cal.y : Math.round((shp - winH) / 2);

  calendarWindow = new BrowserWindow({
    width: winW,
    height: winH,
    x: startX,
    y: startY,
    minWidth: 280,
    minHeight: 280,
    frame: false,
    transparent: false,
    backgroundColor: '#F7F4EC',
    hasShadow: false,
    roundedCorners: false,
    alwaysOnTop: false,      // 바탕화면 위젯처럼 뒤에 깔림(항상위 아님). 뒤로/앞으로 동작은 다음 단계에서 다듬음
    resizable: true,
    maximizable: false,
    skipTaskbar: true,
    // (7단계) 평소엔 포커스를 안 받는 "잠금" 상태로 시작 — 클릭해도 달력이 앞으로 튀어나오지 않음
    focusable: false,
    // 투명도는 전체 설정과 별개로 달력 전용 값 사용(설정 > 달력)
    opacity: (typeof cal.opacity === 'number' ? cal.opacity : 100) / 100,
    icon: ICON_PATH,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true
    }
  });

  calendarWindow.loadFile(path.join(__dirname, 'renderer', 'calendar', 'index.html'));
  calendarWindow.on('closed', () => (calendarWindow = null));

  // "달력이 열려 있음"을 기억 — 앱을 껐다 켜면 자동으로 다시 열림(태훈님 요청 2026-07-24).
  // 트레이에서 직접 닫으면 toggleCalendar가 기억을 지움. 앱 종료 때는 안 지워짐(그래서 복원됨)
  saveCalendarOpenState(true);

  // 위치가 바뀌면 저장 → 다음에 켤 때 그 자리에서 시작
  calendarWindow.on('moved', () => {
    const s = store.getSettings();
    const [x, y] = calendarWindow.getPosition();
    s.calendar = { ...(s.calendar || {}), x, y };
    store.saveSettings(s);
  });
  // 크기가 바뀌면 저장
  calendarWindow.on('resized', () => {
    const s = store.getSettings();
    const [width, height] = calendarWindow.getSize();
    s.calendar = { ...(s.calendar || {}), width, height };
    store.saveSettings(s);
  });

  // (7단계) 활성화 상태에서 다른 곳을 클릭해 포커스를 잃으면 → 다시 잠금(배경) 상태로.
  // setFocusable(false)라서 이후 클릭으로는 달력이 앞으로 안 나오고, 더블클릭해야 다시 활성화됨.
  calendarWindow.on('blur', () => {
    if (!calendarWindow || calendarWindow.isDestroyed()) return;
    calendarWindow.setFocusable(false);
    calendarWindow.webContents.send('calendar:activeChanged', false);
  });

  return calendarWindow;
}

// 달력 열림 상태 저장(settings.calendar.wasOpen — 병합만, 통째 덮어쓰기 금지)
function saveCalendarOpenState(open) {
  const s = store.getSettings();
  s.calendar = { ...(s.calendar || {}), wasOpen: !!open };
  store.saveSettings(s);
}

function toggleCalendar() {
  if (calendarWindow) {
    // 사용자가 직접 닫는 경우 — 다음에 앱을 켜도 안 열리게 기억을 지움
    saveCalendarOpenState(false);
    calendarWindow.close();
  } else {
    createCalendarWindow();
  }
}

// 메모/주제가 바뀌었음을 "데이터를 보는 창"(위젯 + 달력) 모두에 알림.
// 예전엔 위젯에만 보냈는데, 달력 창도 같은 메모를 보여주므로 함께 갱신되게 헬퍼로 묶음.
// (동작은 기존과 동일 + 달력 창이 열려 있을 때만 추가로 신호를 받음)
function broadcastMemosUpdated() {
  if (widgetWindow) widgetWindow.webContents.send('memos:updated');
  if (calendarWindow) calendarWindow.webContents.send('memos:updated');
}
function broadcastTopicsUpdated() {
  if (widgetWindow) widgetWindow.webContents.send('topics:updated');
  if (calendarWindow) calendarWindow.webContents.send('topics:updated');
}

function createSettingsWindow() {
  if (settingsWindow) {
    settingsWindow.focus();
    return;
  }
  settingsWindow = new BrowserWindow({
    width: 600,
    height: 700,
    minWidth: 560,
    minHeight: 560,
    frame: true,
    // 작업표시줄에 반드시 띄움. 예전엔 true(=작업표시줄에 안 보임)였는데, 설정 도중 다른
    // 프로그램을 클릭하면 설정창이 그 뒤로 숨는데 작업표시줄에도 없어서 다시 불러올 방법이
    // 없었음 → "설정창이 저절로 닫힌다"로 보였던 문제(실제로는 살아있었음)
    skipTaskbar: false,
    icon: ICON_PATH,
    title: '설정',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true
    }
  });
  settingsWindow.setMenuBarVisibility(false);
  settingsWindow.loadFile(path.join(__dirname, 'renderer', 'settings', 'index.html'));

  refreshTrayMenu();
  broadcastSettingsState('app:settingsOpened');
  settingsWindow.on('closed', () => {
    settingsWindow = null;
    refreshTrayMenu();
    broadcastSettingsState('app:settingsClosed');
  });
}

// 위젯 + 열려있는 모든 메모창에 설정창 열림/닫힘 상태를 알려서 편집을 잠그거나 풀게 함
function broadcastSettingsState(channel) {
  if (widgetWindow) widgetWindow.webContents.send(channel);
  memoWindows.forEach((win) => win.webContents.send(channel));
}

let helpWindow = null;

function createHelpWindow() {
  if (helpWindow) {
    helpWindow.focus();
    return;
  }
  helpWindow = new BrowserWindow({
    width: 620,
    height: 720,
    minWidth: 480,
    minHeight: 480,
    frame: true,
    skipTaskbar: true,
    icon: ICON_PATH,
    title: '사용 설명서',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true
    }
  });
  helpWindow.setMenuBarVisibility(false);
  helpWindow.loadFile(path.join(__dirname, 'renderer', 'help', 'index.html'));
  helpWindow.on('closed', () => (helpWindow = null));
}

// "메모 연결" 검색 팝업. 메모지가 작으면 목록이 그 안에 갇혀서 다 안 보이던 문제 때문에,
// 메모창 안의 팝업이 아니라 메모창 밖에 따로 뜨는 작은 창으로 분리함. anchorWin(호출한
// 메모창) 바로 오른쪽에 붙이고, 화면 오른쪽에 안 들어가면 왼쪽에 붙이는 식으로 화면 안에
// 항상 보이게 위치를 계산함
function createMemoLinkWindow(memoId, anchorWin) {
  if (memoLinkWindow) {
    memoLinkWindow.close();
  }
  memoLinkTargetMemoId = memoId;

  const POPUP_WIDTH = 320;
  const POPUP_HEIGHT = 440;
  let x = 100;
  let y = 100;

  if (anchorWin && !anchorWin.isDestroyed()) {
    const b = anchorWin.getBounds();
    const work = screen.getDisplayNearestPoint({ x: b.x, y: b.y }).workArea;

    x = b.x + b.width + 8;
    if (x + POPUP_WIDTH > work.x + work.width) x = b.x - POPUP_WIDTH - 8;
    if (x < work.x) x = work.x + 8;

    y = b.y;
    if (y + POPUP_HEIGHT > work.y + work.height) y = work.y + work.height - POPUP_HEIGHT;
    if (y < work.y) y = work.y;
  }

  const win = new BrowserWindow({
    width: POPUP_WIDTH,
    height: POPUP_HEIGHT,
    x,
    y,
    frame: false,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: true,
    backgroundColor: '#FBFAF5',
    icon: ICON_PATH,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true
    }
  });
  memoLinkWindow = win;
  win.loadFile(path.join(__dirname, 'renderer', 'memoLink', 'index.html'));
  win.on('closed', () => {
    // 연달아 빨리 다시 열었을 때, 먼저 있던 창의 'closed' 이벤트가 조금 늦게 도착해서
    // 방금 새로 연 창의 참조를 지워버리는 경우를 방지 — 지금 memoLinkWindow가 정말
    // "나 자신"일 때만 정리함
    if (memoLinkWindow === win) {
      memoLinkWindow = null;
      memoLinkTargetMemoId = null;
    }
  });
}

// "다른 주제로 이동" 팝업. 메모지 안에 갇힌 모달이라 주제가 많으면 고르기 힘들다는
// 문제 때문에, 위 createMemoLinkWindow와 같은 방식(anchorWin 옆에 붙는 별도 작은 창)으로 뺌
function createMoveTopicWindow(memoId, anchorWin) {
  if (moveTopicWindow) {
    moveTopicWindow.close();
  }
  moveTopicTargetMemoId = memoId;

  const POPUP_WIDTH = 260;
  const POPUP_HEIGHT = 380;
  let x = 100;
  let y = 100;

  if (anchorWin && !anchorWin.isDestroyed()) {
    const b = anchorWin.getBounds();
    const work = screen.getDisplayNearestPoint({ x: b.x, y: b.y }).workArea;

    x = b.x + b.width + 8;
    if (x + POPUP_WIDTH > work.x + work.width) x = b.x - POPUP_WIDTH - 8;
    if (x < work.x) x = work.x + 8;

    y = b.y;
    if (y + POPUP_HEIGHT > work.y + work.height) y = work.y + work.height - POPUP_HEIGHT;
    if (y < work.y) y = work.y;
  }

  const win = new BrowserWindow({
    width: POPUP_WIDTH,
    height: POPUP_HEIGHT,
    x,
    y,
    frame: false,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: true,
    backgroundColor: '#FBFAF5',
    icon: ICON_PATH,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true
    }
  });
  moveTopicWindow = win;
  win.loadFile(path.join(__dirname, 'renderer', 'moveTopic', 'index.html'));
  win.on('closed', () => {
    if (moveTopicWindow === win) {
      moveTopicWindow = null;
      moveTopicTargetMemoId = null;
    }
  });
}

// 위젯 🔍 검색 팝업. 위치/크기 계산 방식은 위 createMemoLinkWindow와 동일(anchorWin 옆에 붙여서 띄움)
function createSearchWindow(anchorWin) {
  if (searchWindow) {
    searchWindow.close();
  }

  const POPUP_WIDTH = 320;
  const POPUP_HEIGHT = 440;
  let x = 100;
  let y = 100;

  if (anchorWin && !anchorWin.isDestroyed()) {
    const b = anchorWin.getBounds();
    const work = screen.getDisplayNearestPoint({ x: b.x, y: b.y }).workArea;

    x = b.x + b.width + 8;
    if (x + POPUP_WIDTH > work.x + work.width) x = b.x - POPUP_WIDTH - 8;
    if (x < work.x) x = work.x + 8;

    y = b.y;
    if (y + POPUP_HEIGHT > work.y + work.height) y = work.y + work.height - POPUP_HEIGHT;
    if (y < work.y) y = work.y;
  }

  const win = new BrowserWindow({
    width: POPUP_WIDTH,
    height: POPUP_HEIGHT,
    x,
    y,
    frame: false,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: true,
    backgroundColor: '#FBFAF5',
    icon: ICON_PATH,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true
    }
  });
  searchWindow = win;
  win.loadFile(path.join(__dirname, 'renderer', 'search', 'index.html'));
  win.on('closed', () => {
    // 메모 연결 팝업과 동일한 이유로, 지금 searchWindow가 정말 "나 자신"일 때만 정리함
    if (searchWindow === win) {
      searchWindow = null;
    }
  });
}

// 최초 실행시(또는 트레이 메뉴 "환영 화면 다시 보기"로) 뜨는 소개 화면.
// mandatory=true(최초 설치 직후)일 때는: (1) X 버튼을 막아서(closable:false) "다음/시작하기"로
// 끝까지 넘기기 전에는 닫을 수 없게 하고, (2) 위젯/메모창에 잠금 신호를 보내 그동안 다른
// 기능을 못 쓰게 함. 트레이 메뉴로 다시 볼 때는 mandatory 없이 불러서 예전처럼 자유롭게 닫힘
// (수정) 창이 어떤 방식으로든 닫히면(다음/닫기 버튼, ×, ESC 등 전부) "봤음" 처리해서
// 다음 실행부터는 자동으로 다시 뜨지 않게 함
function createWelcomeWindow(mandatory) {
  if (welcomeWindow) {
    welcomeWindow.focus();
    return;
  }
  welcomeWindow = new BrowserWindow({
    width: 480,
    height: 600,
    resizable: false,
    closable: !mandatory,
    frame: true,
    skipTaskbar: true,
    icon: ICON_PATH,
    title: '환영합니다',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true
    }
  });
  welcomeWindow.setMenuBarVisibility(false);
  welcomeWindow.loadFile(path.join(__dirname, 'renderer', 'welcome', 'index.html'));
  if (mandatory) broadcastSettingsState('app:welcomeOpened');
  welcomeWindow.on('closed', () => {
    welcomeWindow = null;
    if (mandatory) broadcastSettingsState('app:welcomeClosed');
    const settings = store.getSettings();
    if (!settings.hasSeenWelcome) {
      settings.hasSeenWelcome = true;
      store.saveSettings(settings);
    }
  });
}

// ---------- 메모 데이터 헬퍼 ----------

function updateMemoGeometry(memoId, { position, size } = {}) {
  const memos = store.getMemos();
  const idx = memos.findIndex((m) => m.id === memoId);
  if (idx === -1) return;
  if (position) memos[idx].position = position;
  if (size) memos[idx].size = size;
  store.saveMemos(memos);
}

// 메모창이 지금 "열려있는 것으로 쳐야 하는지"를 저장해둠 — 프로그램을 다시 켤 때 이 표시가
// true인 메모들을 그대로 다시 열어줌(reopenPreviouslyOpenMemos 참고).
// (중요) × 버튼이나 위젯에서 직접 닫을 때만 false로 바꿈. 프로그램 종료/재부팅으로
// 창이 닫힐 때는 이 값을 안 건드림 — 그래야 "종료 시점에 열려있던 것"이 계속 true로
// 남아있어서 다음 실행 때 되살릴 수 있음(만약 창이 닫힐 때마다 무조건 false로 바꾸면,
// 프로그램을 끄는 순간 전부 false가 되어버려서 이 기능 자체가 무의미해짐)
function markMemoWindowOpen(memoId, isOpen) {
  const memos = store.getMemos();
  const idx = memos.findIndex((m) => m.id === memoId);
  if (idx === -1) return;
  if (!!memos[idx].windowOpen === isOpen) return; // 이미 같은 값이면 파일 안 건드림
  memos[idx].windowOpen = isOpen;
  store.saveMemos(memos);
}

// 숨김 관련 상태(전체숨김/주제숨김/순환단계/스냅샷)를 settings.json에 저장 — 재시작해도 유지되게 함
function persistVisibilityState() {
  const s = store.getSettings();
  s.memoVisibility = {
    allHidden: allMemosHidden,
    hiddenTopicIds: Array.from(hiddenTopicIds),
    cycle: visibilityCycle,
    snapshot: visibilitySnapshot
  };
  store.saveSettings(s);
}

// 앱 시작 때 지난번 숨김 상태를 다시 읽어옴 (반드시 창들을 만들기 전에 호출해야
// createMemoWindow가 이 상태를 보고 처음부터 올바르게 숨긴 채로 만들 수 있음)
function loadVisibilityState() {
  const vis = store.getSettings().memoVisibility || {};
  allMemosHidden = !!vis.allHidden;
  (vis.hiddenTopicIds || []).forEach((id) => hiddenTopicIds.add(id));
  visibilityCycle = typeof vis.cycle === 'number' ? vis.cycle : 0;
  visibilitySnapshot = Array.isArray(vis.snapshot) ? vis.snapshot : [];
}

// 전체숨김(allMemosHidden) 상태에서 사용자가 특정 메모 하나만 직접 보이게 하려는 경우:
// 그냥 allMemosHidden만 끄면 "나머지는 숨겨져 있는데 상태값은 다 보임"으로 어긋나버림.
// 그래서 지금 실제로 숨겨져 있는 창들의 주제를 hiddenTopicIds로 옮겨 적어서(현실을 상태값에 반영)
// 전체숨김을 풀어도 나머지 메모들의 숨김이 그대로 유지되게 함
function materializeHiddenState() {
  if (!allMemosHidden) return;
  const memos = store.getMemos();
  memoWindows.forEach((win, memoId) => {
    if (!win.isVisible()) {
      const memo = memos.find((m) => m.id === memoId);
      if (memo && memo.topicId) hiddenTopicIds.add(memo.topicId);
    }
  });
  allMemosHidden = false;
}

// 사용자가 위젯 목록/주제 더블클릭 등으로 개별 숨김 상태를 "직접" 바꿨을 때 호출.
// 전체숨김 버튼의 순환을 처음(다 숨기기)부터 다시 시작하게 해서, 손으로 바꾼 뒤에도
// 버튼이 항상 예측 가능하게 동작하게 함 + 바뀐 상태를 저장
function markManualVisibilityChange() {
  visibilityCycle = 0;
  persistVisibilityState();
}

// 지금의 allMemosHidden/hiddenTopicIds 값대로 열려있는 모든 메모창의 보임/숨김을 맞춤
function applyVisibilityToWindows() {
  const memos = store.getMemos();
  memoWindows.forEach((win, memoId) => {
    const memo = memos.find((m) => m.id === memoId);
    const shouldHide = allMemosHidden || (memo && hiddenTopicIds.has(memo.topicId));
    if (shouldHide && win.isVisible()) {
      win.webContents.send('memo:forceBlur');
      win.hide();
    } else if (!shouldHide && !win.isVisible()) {
      showWindowAndNotify(win);
    }
  });
}

// 위젯의 전체숨김 버튼이 "지금 상태 + 다음에 누르면 뭐가 되는지"를 표시할 수 있게 알려줌
function getVisibilityState() {
  const nextAction = ['hideAll', 'restore', 'showAll', 'restore'][visibilityCycle % 4];
  return { allHidden: allMemosHidden, nextAction };
}

// 지난번에 프로그램을 끌 때(또는 강제 종료·재부팅) 열려있던 메모창들을 다시 열어줌.
// (변경) 예전엔 전부 한꺼번에 만들어서 부팅 직후 더 버벅였음 — 첫 창만 바로 만들고
// 나머지는 120ms 간격으로 순차 생성해서 시작 체감 속도를 개선함
function reopenPreviouslyOpenMemos() {
  const memos = store.getMemos();
  const toOpen = memos.filter((m) => m.windowOpen && !memoWindows.has(m.id));
  toOpen.forEach((m, i) => {
    if (i === 0) {
      createMemoWindow(m);
    } else {
      setTimeout(() => {
        // 지연되는 사이 사용자가 이미 열었거나 지웠을 수 있으니 다시 확인
        if (!memoWindows.has(m.id) && store.getMemos().some((x) => x.id === m.id)) {
          createMemoWindow(m);
        }
      }, 120 * i);
    }
  });
}

// 새 메모창이 매번 같은 자리에 겹쳐서 뜨지 않도록, 직전에 새로 연 메모 위치 기준으로
// 오른쪽 아래로 조금씩 사선으로 밀려나게 함. 화면 밖으로 나갈 것 같으면 다시 처음 자리로 되돌림
// (수정) 예전엔 항상 1번 모니터(주 모니터) 기준으로만 계산돼서, 다른 모니터를 쓰고 있어도
// 새 메모가 항상 1번 모니터에만 떴음 — 지금 마우스 커서가 있는 모니터를 기준으로 계산하도록 바꿈
const NEW_MEMO_CASCADE_STEP = 32;
function nextNewMemoPosition(width, height) {
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const work = display.workArea;
  const basePos = {
    x: work.x + Math.round((work.width - width) / 2),
    y: work.y + Math.round((work.height - height) / 2)
  };
  let pos;
  // 직전 새 메모가 지금과 다른 모니터에서 만들어졌으면 사선 배치를 이어가지 않고 새로 시작함
  if (!lastNewMemoPos || lastNewMemoDisplayId !== display.id) {
    pos = basePos;
  } else {
    pos = { x: lastNewMemoPos.x + NEW_MEMO_CASCADE_STEP, y: lastNewMemoPos.y + NEW_MEMO_CASCADE_STEP };
    if (pos.x + width > work.x + work.width || pos.y + height > work.y + work.height) pos = basePos;
  }
  lastNewMemoPos = pos;
  lastNewMemoDisplayId = display.id;
  return pos;
}

function createNewMemo(topicId) {
  const settings = store.getSettings();
  if (!settings.multiMode) {
    // 단일 모드: 열려있는 메모창 전부 닫기
    memoWindows.forEach((w) => w.close());
  }

  const topics = store.getTopics();
  const topic = topics.find((t) => t.id === topicId) || null;

  // 주제에 템플릿(본문/이미지/체크리스트)이 저장돼 있으면 새 메모에 자동으로 채워줌.
  // 첨부 이미지는 템플릿 원본과 독립된 사본으로 복사해서, 메모마다 자기만의 파일을 가지게 함
  const hasTemplate = !!(topic && (
    topic.templateContent ||
    (topic.templateChecklist && topic.templateChecklist.length) ||
    (topic.templateAttachments && topic.templateAttachments.length)
  ));
  const templateAttachments = hasTemplate && topic.templateAttachments
    ? topic.templateAttachments.map((a) => ({ ...a, storedName: cloneStoredFile(a.storedName) }))
    : [];
  const templateChecklist = hasTemplate && topic.templateChecklist
    ? topic.templateChecklist.map((it) => ({ id: randomUUID(), text: it.text || '', checked: !!it.checked }))
    : [];
  const templateSize = hasTemplate && topic.templateSize
    ? { width: topic.templateSize.width, height: topic.templateSize.height }
    : null;

  const memo = {
    id: randomUUID(),
    topicId: topic ? topic.id : null,
    // 주제에 "기본 제목"이 미리 정해져 있으면 새 메모 제목에 자동으로 채워줌
    // (내보낼 때 파일명 뒤에 번호가 자동으로 붙으니 여러 메모가 같은 제목이어도 안 겹침)
    title: (topic && topic.defaultTitle) ? topic.defaultTitle : '',
    content: hasTemplate ? (topic.templateContent || '') : '',
    color: topic ? (topic.memoColor || topic.color) : '#C9A24B',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    position: nextNewMemoPosition(
      templateSize ? templateSize.width : 320,
      templateSize ? templateSize.height : 380
    ), // 템플릿에 저장된 크기가 있으면 그 크기 기준으로 겹치지 않게 배치, 없으면 기본 320x380
    size: templateSize || undefined, // 템플릿에 저장된 창 크기가 있으면 그대로 적용(없으면 createMemoWindow 기본값 320x380)
    alwaysOnTop: pinnedTopicIds.has(topicId),
    collapsed: false,
    attachments: templateAttachments, // [{ storedName, originalName }] (템플릿 있으면 자동 채움)
    checklist: templateChecklist, // [{ id, text, checked }] 체크리스트 항목 목록(템플릿 있으면 자동 채움)
    tables: [], // [{ id, rows: [[셀글자,...],...] }] 표 목록(체크리스트와 같은 급, 새 메모는 항상 빈 배열로 시작)
    postSaveAction: null, // null 이면 설정 기본값 따름, 'override' 면 기본값의 반대 (옵시디언으로 보낸 후 동작)
    // 일정(달력) 기능: useCalendar=이 메모에서 일정 날짜 칸을 쓰는지(주제의 useCalendar 기본값을
    // 물려받되 메모창에서 개별로 껐다 켤 수 있음). scheduleAt="YYYY-MM-DDTHH:mm"(로컬 시각) 또는 null.
    useCalendar: topic ? !!topic.useCalendar : false,
    scheduleAt: null,
    // 알람: 일정 날짜(scheduleAt) 기준으로 울림. 앱이 켜져 있을 때만 동작(트레이 상주).
    // before=며칠/몇시간/몇분 전(전부 0=정시), repeat=반복주기, methods=울리는 방식 목록,
    // firedFor=마지막으로 울린 대상 시각(ISO 문자열, 같은 알람이 두 번 안 울리게 하는 표식).
    alarm: {
      enabled: false,
      before: { days: 0, hours: 0, minutes: 0 },
      repeat: 'none',
      methods: ['notify', 'sound'],
      firedFor: null
    },
    obsidian: { saved: false, filePath: null }
  };

  const memos = store.getMemos();
  memos.push(memo);
  store.saveMemos(memos);

  // (변경) 전체숨김 중에 새 메모를 만들면 새 메모까지 숨겨진 채 생성돼서 "눌렀는데 아무
  // 반응 없음"으로 보이던 문제 — 새로 만든 메모만은 항상 바로 보여줌. 기존에 숨겨져 있던
  // 메모들은 materializeHiddenState가 주제별 숨김으로 옮겨 적어서 그대로 숨김 유지됨
  if (allMemosHidden) {
    materializeHiddenState();
    markManualVisibilityChange();
  }
  createMemoWindow(memo, { forceVisible: true, skipTitleFirst: !!(topic && topic.skipTitleFirst) });
  // (수정) 예전엔 여기서 위젯에 알림을 안 보내서, 새 메모 만든 직후엔 위젯 목록에
  // 바로 안 보이고 뭔가 입력해야(제목 등) 그때서야 반영되는 약간의 지연이 있었음
  broadcastMemosUpdated();
  return memo;
}

/* ---------- 달력 빠른 일정 (0.20.0, 태훈님 확정 2026-08-15) ----------
   예전에는 달력에서 일정을 만들려면 [날짜 클릭 → +새 메모 → 주제 고르기 → 메모창]
   네 단계를 거쳐야 했고, 만들어진 일정이 일반 메모와 섞여서 메모장이 지저분해졌음.

   [고른 방법] 데이터를 따로 쪼개지 않고 "달력"이라는 주제 하나에 자동으로 넣는다.
   - 데이터 구조를 안 건드리므로 기존 일정(scheduleAt이 붙은 메모)이 그대로 살아 있음
   - 메모장에서는 주제로 묶여 있어서 접거나 걸러볼 수 있음
   - 되돌리기도 쉬움(주제만 지우면 됨)
   [버린 방법] 일정 전용 데이터 파일(events.json)로 완전 분리 → 달력·위젯·내보내기·백업·
   알람이 전부 두 갈래가 되고, 기존 일정을 옮기는 변환까지 필요해서 위험 대비 이득이 적음.
   -------------------------------------------------------------------- */

const CALENDAR_TOPIC_NAME = '달력';

// "달력" 주제를 찾고, 없으면 그때 만든다.
// 앱 켤 때 미리 만들지 않는 이유: 태훈님이 주제를 지워도 다음 실행에 되살아나 버리기 때문.
// 실제로 일정을 만들 때만 생기므로 안 쓰면 생기지도 않는다.
function ensureCalendarTopic() {
  const topics = store.getTopics();
  let t = topics.find((x) => x && x.calendarTopic);
  if (t) return t;
  // 표식(calendarTopic)이 없더라도 이름이 "달력"인 주제가 이미 있으면 그걸 씀
  // (손으로 먼저 만들어 뒀을 수 있음. 이름은 "상위주제/달력" 형태일 수도 있어서 뒤쪽도 봄)
  t = topics.find((x) => {
    const n = String((x && x.name) || '');
    return n === CALENDAR_TOPIC_NAME || n.endsWith('/' + CALENDAR_TOPIC_NAME);
  });
  if (t) {
    t.calendarTopic = true;
    t.useCalendar = true;
    store.saveTopics(topics);
    refreshTrayMenu();
    broadcastTopicsUpdated();
    return t;
  }
  const created = {
    id: randomUUID(),
    name: CALENDAR_TOPIC_NAME,
    description: '달력에서 만든 일정',
    iconChar: '📅',
    color: '#C9A24B',
    textColor: '#3A2E10',
    memoColor: '#F3E6C4',
    hidden: false,
    useCalendar: true,   // 이 주제의 메모는 일정 날짜 칸을 기본으로 켬
    calendarTopic: true, // 이름을 바꿔도 계속 찾을 수 있게 하는 표식
  };
  topics.push(created);
  store.saveTopics(topics);
  refreshTrayMenu();
  broadcastTopicsUpdated();
  return created;
}

// "09", "930", "9:30", "0930" 같은 입력을 "HH:mm"으로 맞춰줌. 못 알아보면 null
function normalizeScheduleTime(raw) {
  const s = String(raw == null ? '' : raw).trim();
  if (!s) return null;
  const d = s.replace(/[^0-9]/g, '');
  let h, m;
  if (d.length === 1 || d.length === 2) { h = +d; m = 0; }
  else if (d.length === 3) { h = +d.slice(0, 1); m = +d.slice(1); }
  else if (d.length === 4) { h = +d.slice(0, 2); m = +d.slice(2); }
  else return null;
  if (!(h >= 0 && h <= 23 && m >= 0 && m <= 59)) return null;
  const p = (n) => String(n).padStart(2, '0');
  return `${p(h)}:${p(m)}`;
}

// ---------- 전역 단축키 ----------
// 설정에 저장된 accelerator 문자열로 "새 메모 만들기"를 전역 등록. 설정이 바뀔 때마다
// (settings:save) 다시 불러서 항상 최신 값으로 갱신함. 빈 문자열이면 등록하지 않음(단축키 끔)
function registerGlobalShortcuts() {
  globalShortcut.unregisterAll();
  const settings = store.getSettings();
  const accel = (settings.newMemoShortcut || '').trim();
  if (!accel) return;
  try {
    globalShortcut.register(accel, () => createNewMemo(lastActiveTopicId));
  } catch (err) {
    console.error('단축키 등록 실패:', accel, err);
  }
}

// ---------- 트레이 ----------

function buildTrayMenu() {
  const topics = store.getTopics();
  const locked = !!settingsWindow; // 설정창이 열려있는 동안은 트레이에서도 새 메모 생성을 막음
  const topicItems = topics.map((t) => ({
    label: `${t.iconChar} ${t.name}`,
    enabled: !locked,
    click: () => createNewMemo(t.id)
  }));

  return Menu.buildFromTemplate([
    { label: '일반 새 메모', enabled: !locked, click: () => createNewMemo(null) },
    ...(topicItems.length ? [{ type: 'separator' }, ...topicItems] : []),
    { type: 'separator' },
    { label: '위젯 열기/닫기', click: toggleWidget },
    { label: '달력 열기/닫기', click: toggleCalendar },
    { label: '설정', click: createSettingsWindow },
    { label: '도움말', click: createHelpWindow },
    // (주의) click: createWelcomeWindow 로 직접 넘기면 Electron이 (menuItem, ...) 인자를 그대로
    // 넘겨서 createWelcomeWindow의 mandatory 파라미터가 항상 truthy가 돼버림(X버튼 막힘 등
    // 최초 설치 전용 동작이 트레이 메뉴로 열 때도 적용되는 버그) — 인자 없이 호출되게 감싸줌
    { label: '환영 화면 다시 보기', click: () => createWelcomeWindow() },
    { type: 'separator' },
    { label: '종료', click: () => app.quit() }
  ]);
}

function toggleWidget() {
  if (widgetWindow) {
    widgetWindow.close();
  } else {
    createWidgetWindow();
  }
}

function refreshTrayMenu() {
  if (tray) tray.setContextMenu(buildTrayMenu());
}

// ---------- 최초 실행시 예시 주제/메모 생성 ----------
// 앱을 처음 설치해서 데이터가 완전히 비어있을 때만, 딱 한 번 예시 주제 2개(인사말/헬프파일)와
// 메모 2개를 만들어둠 — 빈 화면보다 뭔가 이미 있는 상태에서 시작하는 게 이해하기 쉬움.
// seedDataCreated 플래그로 한 번만 동작하게 막아서, 나중에 사용자가 주제/메모를 전부 지워도
// 다시 자동으로 안 생기게 함(업데이트로 기존 사용자 데이터가 있는 경우에도 안전하게 건너뜀)
function seedInitialDataIfNeeded() {
  const settings = store.getSettings();
  if (settings.seedDataCreated) return;

  const hasNoData = store.getTopics().length === 0 && store.getMemos().length === 0;
  if (hasNoData) {
    // 상위주제(카테고리) 예시 2개도 같이 만들어서, 처음 켰을 때부터
    // "카테고리 → 주제 → 메모" 구조가 어떻게 되는지 바로 보여줌
    const categoryGuide = { id: randomUUID(), name: '가이드' };
    const categorySettings = { id: randomUUID(), name: '설정' };
    store.saveCategories([categoryGuide, categorySettings]);

    const topicGreeting = {
      id: randomUUID(),
      name: `${categoryGuide.name}/여기를 보세요`,
      description: '한번만 클릭해봐요',
      iconChar: 'Hi',
      color: '#FCE8A8',
      textColor: '#5C4A12',
      memoColor: '#FCE8A8',
      hidden: false
    };
    const topicHelp = {
      id: randomUUID(),
      name: `${categorySettings.name}/read me`,
      description: '도움말',
      iconChar: 'HP',
      color: '#BFE1F0',
      textColor: '#1F3A4A',
      memoColor: '#BFE1F0',
      hidden: false
    };
    store.saveTopics([topicGreeting, topicHelp]);

    const now = new Date().toISOString();
    const makeSeedMemo = (topic, content, title = '') => ({
      id: randomUUID(),
      topicId: topic.id,
      title,
      content,
      color: topic.memoColor,
      createdAt: now,
      updatedAt: now,
      position: null,
      size: { width: 620, height: 495 }, // 안내 내용이 다 보이도록 처음 열 때부터 넉넉한 크기로 시작
      alwaysOnTop: false,
      collapsed: false,
      attachments: [],
      checklist: [],
      postSaveAction: null,
      obsidian: { saved: false, filePath: null }
    });

    const memoGreeting = makeSeedMemo(
      topicGreeting,
      '안녕하세요 NEMO 입니다.\n설정의 도움말을 읽어보세요.\n주제를 먼저 설정한후 주제에 맞는 메모를 작성하세요.\n주제가 없으면 메모를 작성할수 없어요.\n\n설정창을 열어 주제를 작성하세요\n\n기존의 주제는 x표를 눌러 삭제하세요\n\n주제작성후 반드시 작성 버튼을 눌러 저장을 해야 반영이 돼요\n\n설정창이 열려 있으면 메모를 작성할수 없으니 반드시 설정창을 닫고 메모를 작성하세요\n\n상단의 제목부분을 더블클릭하면 제목을 넣거나 바꿀수 있어요',
      '나도 클릭해줘요'
    );
    const memoHelp = makeSeedMemo(
      topicHelp,
      '☆설정의 MD설정에서 MD기능을 on/off 하실수 있습니다.\n☆MD(마크다운 문법)을 사용하지 않으시면 설정에서 MD기능을 체크해제 하시고 사용하세요\n☆주제 이름에 슬래시(/)를 넣으면 옵시디언에서 중첩 폴더 + 중첩 태그로 자동 정리돼요.\n  예: 주제 이름을 "업무/마케팅"으로 만들면\n  - MD내보내기할 때 Vault 안에 업무 폴더 → 그 안에 마케팅 폴더로 저장되고\n  - 태그도 #업무/마케팅 으로 붙어서 옵시디언 태그창에서 계층으로 보여요\n  설정 > 주제관리에서 주제 이름을 작성할 때 이 방식을 활용해보세요.\n\n☆MD 설정을 사용하시면 이미 만들어진 주제를 상위주제로 사용 하실수 있습니다.\n☆본 내용은 마크다운 문법을 사용하지 않으시면 전혀 알 필요 없는 내용입니다. \n  자유롭게 사용하시면 됩니다.',
      'MD 설정 하기'
    );
    const memoBackup = makeSeedMemo(
      topicHelp,
      '【수동으로 한 번 백업】\n☆설정 > 일반 탭의 "전체 메모 내보내기" 버튼을 누르면, 지금까지 작성한 모든 메모를 한꺼번에 저장할 수 있어요.\n☆누르면 순서대로 두 번 물어봐요.\n  1) 어떤 형식으로 저장할지 (txt만 / md만 / 둘 다)\n  2) 어디에 저장할지 (원하는 폴더 선택)\n☆저장할 때 주제별로 폴더가 자동으로 나뉘어서, 주제마다 하위폴더 안에 그 주제의 메모들이 저장돼요.\n\n【자동 백업(주기적으로 알아서)】\n☆같은 탭 아래 "자동 백업" 항목에서 켤 수 있어요.\n☆백업할 폴더와 주기(매일 / 12시간마다 / 6시간마다 / 프로그램 켤 때마다)를 정해두면, 그 뒤로는 알아서 md 파일로 저장돼요.\n☆자동 백업은 항상 같은 파일에 덮어써져서, 예전 백업이 계속 쌓이지 않아요(용량 걱정 없음). 최신 상태만 유지돼요.',
      '💾 전체 메모 백업하기'
    );
    const memoOperation = makeSeedMemo(
      topicGreeting,
      '◆위젯을 항상위에 두고 싶으면 핀버튼으로 토글 하면돼요\n◆눈 버튼은 누를 때마다 [다 숨김 → 직전 상태로 → 다 보임 → 직전 상태로] 순서로 돌아가요\n◆위젯바를 더블클릭하면 목록을 접을수 있어요\n◆접힌 위젯의 주제 버튼: 한 번 클릭=새 메모, 두 번 클릭=그 주제 메모 숨김/보임\n◆위젯바의 6개점을 클릭 드래그 하면 이동이 쉬워요\n◆목록에서 개별 메모를 클릭하면 숨기거나 보여지게 할수있어요\n◆주제이름을 더블클릭하면 같은 주제의 메모가 숨겨져요\n◆위젯의 주제 버튼을 누르면 해당 주제의 새 메모를 열어요\n◆🔍 버튼으로 모든 메모의 제목·내용을 검색할수 있어요\n◆지운 메모는 설정>휴지통에 60일 보관되고 복구할수 있어요\n◆목록 왼쪽 6개의 점을 클릭 드래그 해서 순서를 바꿀수 있어요\n◆주제 리스트 오른쪽 끝에 있는 핀모양을 누르면 그 주제만 항상위에 할수 있어요\n◆더 자세한 기능은 도움말을 참조하세요',
      '동작설명'
    );
    store.saveMemos([memoGreeting, memoHelp, memoBackup, memoOperation]);
  }

  settings.seedDataCreated = true;
  store.saveSettings(settings);
}

// ---------- 데이터 원본 백업(일정·알람·가계부 보호) ----------
// md 백업만으로는 일정 날짜·알람 설정·가계부 기록이 복구되지 않음(md 파일에 그 정보가 없음).
// 그래서 백업할 때 원본 JSON(memos/topics/categories/ledger)도 백업 폴더의
// "데이터원본" 하위폴더에 같이 복사해둠. 복구 때 이 폴더가 있으면 이걸 우선 사용함.
// settings.json은 컴퓨터마다 다른 값(경로 등)이라 일부러 뺌.
function backupRawData(baseDir) {
  try {
    const dir = path.join(baseDir, '데이터원본');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    ['memos', 'topics', 'categories', 'ledger'].forEach((key) => {
      const src = store.getDataFilePath(key);
      if (src && fs.existsSync(src)) {
        fs.copyFileSync(src, path.join(dir, path.basename(src)));
      }
    });
    fs.writeFileSync(
      path.join(dir, '읽어주세요.txt'),
      'Memo.md가 복구할 때 쓰는 원본 데이터 폴더입니다.\n' +
      '일정 날짜·알람·가계부 기록까지 복구하려면 이 폴더를 지우거나 수정하지 마세요.\n',
      'utf-8'
    );
  } catch (err) {
    console.error('데이터 원본 백업 실패:', err); // md 백업은 이미 됐으니 조용히 넘어감
  }
}

// ---------- 자동 백업 ----------
// 설정 > 일반 탭의 "자동 백업"이 켜져있으면, 지정한 주기(또는 프로그램 켤 때마다)에 맞춰
// 조용히 md 파일로 저장함. exportAllMemosOverwrite를 써서 항상 같은 파일에 덮어쓰기 때문에
// 예전 백업이 계속 쌓이지 않음(같은 메모는 항상 같은 파일명이라 다음 백업 때 그 파일을 그대로 덮어씀)
function maybeRunAutoBackup({ isLaunch } = {}) {
  const settings = store.getSettings();
  const cfg = settings.autoBackup || {};
  if (!cfg.enabled || !cfg.folderPath) return;
  if (!fs.existsSync(cfg.folderPath)) return; // 폴더가 없어졌으면 조용히 건너뜀(외장하드 분리 등)

  const intervalHours = Number(cfg.intervalHours) || 0;
  let due;
  if (intervalHours === 0) {
    // "프로그램 켤 때마다": 앱을 새로 시작한 시점에만 실행(켜둔 채로 계속 있다고 계속 반복 실행하진 않음)
    due = !!isLaunch;
  } else {
    const now = Date.now();
    const last = cfg.lastRunAt ? new Date(cfg.lastRunAt).getTime() : 0;
    due = now - last >= intervalHours * 60 * 60 * 1000;
  }
  if (!due) return;

  try {
    exportAllMemosOverwrite({
      baseDir: cfg.folderPath,
      memos: store.getMemos(),
      topics: store.getTopics(),
      format: 'md',
      attachDir: ATTACH_DIR()
    });
    backupRawData(cfg.folderPath); // 일정·알람·가계부 원본도 같이 백업
  } catch (err) {
    console.error('자동 백업 실패:', err);
    return; // 실패하면 lastRunAt을 안 남겨서 다음 체크 때 다시 시도하게 함
  }

  const latest = store.getSettings();
  latest.autoBackup = { ...latest.autoBackup, lastRunAt: new Date().toISOString() };
  store.saveSettings(latest);
}

// ---------- 위지윅 2-1단계: 체크리스트를 본문 안으로 옮기는 1회 변환 ----------
// 예전 메모는 체크리스트가 본문과 별개인 memo.checklist 배열에 들어있었음.
// 이제는 본문에 "- [ ] 할일" 줄로 직접 들어가므로, 예전 메모를 한 번 변환해줘야 함.
//
// [설계 결정 2026-08-14] 원래 인계서에는 "메모를 열 때 1회 변환"으로 적어뒀는데,
// 앱을 켤 때 전체를 한 번에 변환하는 방식으로 바꿨음. 이유:
//  - 백업을 딱 한 번만 뜨면 됨(메모마다 뜨면 백업이 지저분해짐)
//  - 변환된 메모와 안 된 메모가 섞여 있는 상태가 아예 안 생김(내보내기 코드가 단순해짐)
//  - 중간에 앱이 꺼져도 다음 실행 때 남은 것부터 이어서 함
//
// 합치는 순서는 인계서대로 "화면에 보이던 순서" = 체크리스트를 본문 맨 앞에 붙임.
// 되돌릴 수 없는 작업이므로 변환 전에 memos.json 사본을 반드시 남긴다.
function migrateChecklistIntoContent() {
  let memos;
  try {
    memos = store.getMemos();
  } catch (err) {
    console.error('체크리스트 변환: 메모를 읽지 못해 건너뜀', err);
    return;
  }
  const targets = memos.filter(needsChecklistMigration);
  if (!targets.length) return;

  // 되돌릴 수 없으므로 원본 사본을 먼저 남김 (앱 데이터 폴더에 날짜 붙여 저장)
  try {
    const src = store.getDataFilePath('memos');
    if (src && fs.existsSync(src)) {
      const d = new Date();
      const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
      const dst = path.join(path.dirname(src), `memos.체크리스트변환전.${stamp}.json`);
      if (!fs.existsSync(dst)) fs.copyFileSync(src, dst);
    }
  } catch (err) {
    console.error('체크리스트 변환: 백업 실패 — 변환을 중단함', err);
    return; // 백업을 못 뜨면 변환하지 않음(안전 우선)
  }

  targets.forEach((memo) => {
    memo.content = buildContentWithChecklist(memo);
    memo.checklist = [];
    memo.schemaVersion = 2;
  });

  try {
    store.saveMemos(memos);
    console.log(`체크리스트 변환 완료: 메모 ${targets.length}개`);
  } catch (err) {
    console.error('체크리스트 변환: 저장 실패', err);
  }
}

// ---------- 위지윅 2-2단계: 표를 본문 안으로 옮기는 1회 변환 ----------
// 방식은 위 체크리스트 변환과 완전히 같음(앱 켤 때 한 번에, 백업 먼저, 백업 실패 시 중단).
// 붙이는 자리는 본문 맨 앞 — 예전 메모창에서 표가 본문 위에 있었기 때문(태훈님 확정 2026-08-15).
function migrateTablesIntoContent() {
  let memos;
  try {
    memos = store.getMemos();
  } catch (err) {
    console.error('표 변환: 메모를 읽지 못해 건너뜀', err);
    return;
  }
  const targets = memos.filter(needsTableMigration);
  if (!targets.length) return;

  // 되돌릴 수 없으므로 원본 사본을 먼저 남김
  try {
    const src = store.getDataFilePath('memos');
    if (src && fs.existsSync(src)) {
      const d = new Date();
      const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
      const dst = path.join(path.dirname(src), `memos.표변환전.${stamp}.json`);
      if (!fs.existsSync(dst)) fs.copyFileSync(src, dst);
    }
  } catch (err) {
    console.error('표 변환: 백업 실패 — 변환을 중단함', err);
    return; // 백업을 못 뜨면 변환하지 않음(안전 우선)
  }

  targets.forEach((memo) => {
    memo.content = buildContentWithTables(memo);
    memo.tables = [];
    memo.schemaVersion = 3;
  });

  try {
    store.saveMemos(memos);
    console.log(`표 변환 완료: 메모 ${targets.length}개`);
  } catch (err) {
    console.error('표 변환: 저장 실패', err);
  }
}

// ---------- 위지윅 3단계: 이미지를 본문 안으로 옮기는 1회 변환 ----------
// 방식은 위 두 변환과 완전히 같음(앱 켤 때 한 번에, 백업 먼저, 백업 실패 시 중단).
// 붙이는 자리는 본문 맨 앞, 캡션은 이미지 바로 아랫줄 *기울임* (태훈님 확정 2026-08-15).
// 이미지 파일 자체는 건드리지 않는다 — 본문에 참조 줄을 넣을 뿐이라 되돌리기도 쉬움.
function migrateImagesIntoContent() {
  let memos;
  try {
    memos = store.getMemos();
  } catch (err) {
    console.error('이미지 변환: 메모를 읽지 못해 건너뜀', err);
    return;
  }
  const targets = memos.filter(needsImageMigration);
  if (!targets.length) return;

  // 되돌릴 수 없으므로 원본 사본을 먼저 남김
  try {
    const src = store.getDataFilePath('memos');
    if (src && fs.existsSync(src)) {
      const d = new Date();
      const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
      const dst = path.join(path.dirname(src), `memos.이미지변환전.${stamp}.json`);
      if (!fs.existsSync(dst)) fs.copyFileSync(src, dst);
    }
  } catch (err) {
    console.error('이미지 변환: 백업 실패 — 변환을 중단함', err);
    return; // 백업을 못 뜨면 변환하지 않음(안전 우선)
  }

  targets.forEach((memo) => {
    memo.content = buildContentWithImages(memo);
    memo.schemaVersion = 4;
  });

  try {
    store.saveMemos(memos);
    console.log(`이미지 변환 완료: 메모 ${targets.length}개`);
  } catch (err) {
    console.error('이미지 변환: 저장 실패', err);
  }
}

// ---------- 앱 시작 ----------

app.whenReady().then(() => {
  // 이중 실행으로 판정돼 종료 중인 앱이 트레이/창을 만들지 않게 함(위 requestSingleInstanceLock 참고)
  if (!gotSingleInstanceLock) return;
  seedInitialDataIfNeeded();
  migrateChecklistIntoContent(); // 창을 만들기 전에 끝내야 함(메모창이 옛 데이터를 읽지 않게)
  migrateTablesIntoContent();    // 같은 이유로 여기서(체크리스트 다음에) 한 번에 끝냄
  migrateImagesIntoContent();    // 3단계. 표 다음에 붙어야 순서가 이미지 → 표 → 체크리스트 → 본문

  tray = new Tray(TRAY_ICON_PATH);
  tray.setToolTip('Memo.md - 클릭: 위젯 열기/앞으로, 더블클릭: 새 메모');
  tray.setContextMenu(buildTrayMenu());
  // (변경) 예전엔 한 번 클릭 = 새 일반 메모였는데, 트레이를 실수로 클릭만 해도 메모가
  // 생겨서 오작동 여지가 컸음. 관례대로 클릭 = 위젯 열기/앞으로 가져오기로 바꾸고,
  // 새 일반 메모는 더블클릭으로 이동(트레이 우클릭 메뉴의 "일반 새 메모"도 그대로 있음)
  tray.on('click', () => {
    if (widgetWindow) {
      widgetWindow.show();
      widgetWindow.focus();
    } else {
      createWidgetWindow();
    }
  });
  tray.on('double-click', () => createNewMemo(null));

  const settings = store.getSettings();
  app.setLoginItemSettings({ openAtLogin: !!settings.autoLaunch });

  // 지난번 종료 시점의 전체숨김/주제숨김 상태를 창 만들기 "전에" 복원 —
  // 그래야 아래 reopenPreviouslyOpenMemos가 메모창을 만들 때부터 올바르게 숨긴 채로 만듦
  // (부팅 후 일부러 숨겨둔 메모까지 전부 다시 켜지던 문제의 해결 지점)
  loadVisibilityState();

  const isMandatoryWelcome = !settings.hasSeenWelcome;
  const hasSavedWidgetPos = typeof settings.widget.x === 'number' && typeof settings.widget.y === 'number';

  if (isMandatoryWelcome && !hasSavedWidgetPos) {
    // 진짜 최초 설치 직후(위젯을 한 번도 움직인 적 없음): 웰컴창을 먼저 띄운 뒤,
    // 그 오른쪽 위 귀퉁이에 맞닿게 위젯을 생성함
    createWelcomeWindow(true);
    const wb = welcomeWindow.getBounds();
    createWidgetWindow({ x: wb.x + wb.width, y: wb.y });
    // 위젯이 방금 생겨서 위의 잠금 신호를 못 받았을 테니 다시 한번 알려줌
    broadcastSettingsState('app:welcomeOpened');
  } else {
    createWidgetWindow();
    if (isMandatoryWelcome) createWelcomeWindow(true);
  }
  registerGlobalShortcuts();

  // 지난 실행 때 열어둔 채로 프로그램이 꺼졌던 메모창들을 그대로 되살림(× 버튼 등으로
  // 직접 닫은 건 대상에서 빠짐 — markMemoWindowOpen/reopenPreviouslyOpenMemos 참고)
  reopenPreviouslyOpenMemos();

  // 달력도 마찬가지 — 지난번에 열어둔 채 껐으면 자동으로 다시 열어줌
  // (트레이에서 직접 닫고 껐으면 wasOpen=false라 안 열림)
  if (settings.calendar && settings.calendar.wasOpen) {
    createCalendarWindow();
  }

  // 휴지통 보관기한(60일) 지난 항목 정리 — 앱 켤 때 한 번만 확인
  cleanupExpiredTrash();

  // 자동 백업: 시작할 때 한 번 확인하고, 이후엔 프로그램이 켜져있는 동안 한 시간마다
  // "지금이 백업할 때인지" 다시 확인함(정확한 그 시각이 아니라 최대 1시간 오차 안에서 실행됨)
  maybeRunAutoBackup({ isLaunch: true });
  setInterval(() => maybeRunAutoBackup({ isLaunch: false }), 60 * 60 * 1000);

  // 알람 검사: 앱이 켜져 있는 동안 20초마다 모든 메모의 일정 시각을 확인해 때가 되면 울림
  // (앱이 꺼져 있으면 안 울림 — 트레이 상주 전제). 켜자마자 한 번도 확인.
  checkAlarms();
  setInterval(checkAlarms, 20 * 1000);

  // 가계부 고정 지출: 켤 때 한 번 + 한 시간마다 "오늘이 기입할 날인지" 확인
  // (자정을 넘겨 계속 켜둔 경우에도 다음 확인 때 자동 기입됨)
  applyFixedExpenses();
  setInterval(applyFixedExpenses, 60 * 60 * 1000);
});

app.on('window-all-closed', (e) => {
  // 트레이 상주 앱이므로 창이 다 닫혀도 종료하지 않음
  e.preventDefault?.();
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

// ---------- IPC: 설정 ----------

ipcMain.handle('settings:get', () => store.getSettings());

// (1.8.16 신규) 설정화면에 지금 실행 중인 버전을 작게 보여주기 위함 — package.json의
// version 값을 Electron이 자동으로 읽어서 돌려줌(따로 관리 안 해도 항상 정확함)
ipcMain.handle('app:getVersion', () => app.getVersion());

// 위젯이 화면 밖으로 넘어갈 만큼 커지지 않도록, 위젯 자동크기 계산에 쓸 화면 크기를 알려줌
// (수정) 예전엔 항상 1번 모니터(주 모니터) 크기로 알려줘서, 위젯을 다른(특히 더 작은) 모니터에
// 두고 쓰면 그 모니터보다 크게 자동 확장될 수 있었음 — 위젯이 지금 실제로 있는 모니터 기준으로 알려주도록 바꿈
ipcMain.handle('screen:getWorkArea', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const b = win ? win.getBounds() : null;
  const work = b ? screen.getDisplayNearestPoint({ x: b.x, y: b.y }).workArea : screen.getPrimaryDisplay().workArea;
  // (1.8.16 신규) 위젯을 처음 띄울 때(재시작 포함)도 그 시점 위치 기준으로 위/아래 고정
  // 기준을 한 번 계산해둠 — 이 핸들러는 지금 위젯 창에서만 호출되므로 win이 곧 위젯 창임
  if (win) widgetVerticalAnchor = computeWidgetVerticalAnchor(win);
  return { width: work.width, height: work.height, verticalAnchor: widgetVerticalAnchor };
});

ipcMain.handle('settings:save', (event, incoming) => {
  // 설정창 UI가 다루지 않는 위젯 내부 상태(항상위/접힘 등)는 유지하며 병합
  const current = store.getSettings();
  const merged = {
    ...current,
    ...incoming,
    widget: { ...current.widget, ...incoming.widget },
    exportNameRule: { ...current.exportNameRule, ...incoming.exportNameRule },
    // autoBackup.lastRunAt은 설정창 폼에 없는 내부 값이라, 그냥 덮어쓰면 자동 백업 다음 실행
    // 시점 계산이 틀어짐 — 기존 값을 지키면서 설정창에서 바꾼 값만 덧씀
    autoBackup: { ...current.autoBackup, ...incoming.autoBackup },
    // calendar에는 설정창 폼에 없는 내부 값(창 위치/크기)이 있어서 통째로 덮어쓰면 안 됨
    calendar: { ...current.calendar, ...incoming.calendar }
  };
  const saved = store.saveSettings(merged);
  app.setLoginItemSettings({ openAtLogin: !!saved.autoLaunch });
  registerGlobalShortcuts();
  if (widgetWindow && saved.widget.autoResize === false && !saved.widget.collapsed) {
    widgetWindow.setSize(saved.widget.width, saved.widget.height);
  }

  // 투명도는 위젯 + 열려있는 모든 메모창에 즉시, 동일하게 적용
  const op = (typeof saved.opacity === 'number' ? saved.opacity : 100) / 100;
  if (widgetWindow) widgetWindow.setOpacity(op);
  memoWindows.forEach((w) => w.setOpacity(op));
  // 달력은 전용 투명도(설정 > 달력) 사용
  if (calendarWindow && !calendarWindow.isDestroyed()) {
    const calOp = (saved.calendar && typeof saved.calendar.opacity === 'number' ? saved.calendar.opacity : 100) / 100;
    calendarWindow.setOpacity(calOp);
  }

  // 위젯 상단바 색상, 특수문자 목록 등 렌더러가 반영해야 할 값이 바뀌었을 수 있으니 새로고침 신호
  if (widgetWindow) widgetWindow.webContents.send('settings:updated');
  memoWindows.forEach((w) => w.webContents.send('settings:updated'));
  // 달력창도(주 시작 요일 등) 즉시 반영
  if (calendarWindow && !calendarWindow.isDestroyed()) calendarWindow.webContents.send('settings:updated');

  return saved;
});

// 달력창 ⚙️ 전용 저장: settings.calendar 부분만 병합 저장(다른 설정은 안 건드림).
// 저장 후 달력 투명도 즉시 적용 + 달력창에 새로고침 신호
ipcMain.handle('calendar:saveSettings', (event, incoming) => {
  const current = store.getSettings();
  const merged = {
    ...current,
    calendar: { ...current.calendar, ...(incoming || {}) }
  };
  const saved = store.saveSettings(merged);
  if (calendarWindow && !calendarWindow.isDestroyed()) {
    const calOp = (saved.calendar && typeof saved.calendar.opacity === 'number' ? saved.calendar.opacity : 100) / 100;
    calendarWindow.setOpacity(calOp);
    calendarWindow.webContents.send('settings:updated');
  }
  return saved.calendar;
});

ipcMain.handle('settings:chooseVaultFolder', async () => {
  const result = await dialog.showOpenDialog({ properties: ['openDirectory'] });
  if (result.canceled || !result.filePaths.length) return null;
  return result.filePaths[0];
});

ipcMain.handle('settings:chooseBackupFolder', async () => {
  const result = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] });
  if (result.canceled || !result.filePaths.length) return null;
  return result.filePaths[0];
});

// ---------- IPC: 주제 ----------

ipcMain.handle('topics:getAll', () => store.getTopics());

ipcMain.handle('topics:add', (event, topic) => {
  const topics = store.getTopics();
  const newTopic = { id: randomUUID(), ...topic };
  topics.push(newTopic);
  store.saveTopics(topics);
  refreshTrayMenu();
  broadcastTopicsUpdated();
  return newTopic;
});

ipcMain.handle('topics:update', (event, topic) => {
  const topics = store.getTopics();
  const idx = topics.findIndex((t) => t.id === topic.id);
  // (수정) 예전엔 topics[idx] = topic 로 통째로 갈아끼웠는데, 설정창이 주제 목록을 불러온
  // "이후"에 다른 창(예: 메모창의 템플릿 저장)이 그 주제를 건드리면, 설정창은 그 변경을
  // 모른 채로 저장해서 방금 생긴 변경이 조용히 사라지는 문제가 있었음. 저장된 값 위에
  // 넘어온 값만 덧씌우는 "병합" 방식으로 바꿔서, 설정창 폼이 모르는 필드(템플릿 등)는
  // 그대로 보존되게 함
  const oldMemoColor = idx !== -1 ? (topics[idx].memoColor || topics[idx].color) : null;
  if (idx !== -1) topics[idx] = { ...topics[idx], ...topic };
  store.saveTopics(topics);

  // (추가) 주제의 기본 메모색이 바뀌면, 그 기본색을 그대로 쓰던 기존 메모들도 새 색으로 같이
  // 맞춰줌. 메모창에서 사용자가 직접 색을 골라 개별로 바꿔둔 메모는 memo.color가 이미 옛
  // 기본색과 달라져 있어서 아래 조건(m.color === oldMemoColor)에 안 걸리므로 건드리지 않음
  const newMemoColor = idx !== -1 ? (topics[idx].memoColor || topics[idx].color) : null;
  if (idx !== -1 && oldMemoColor && newMemoColor && oldMemoColor !== newMemoColor) {
    const memos = store.getMemos();
    let memosChanged = false;
    memos.forEach((m) => {
      if (m.topicId === topic.id && m.color === oldMemoColor) {
        m.color = newMemoColor;
        memosChanged = true;
        // 열려있는 메모창이 있으면 네이티브 배경색과 화면에 보이는 색을 즉시 같이 갱신
        const win = memoWindows.get(m.id);
        if (win) {
          try { win.setBackgroundColor(newMemoColor); } catch (err) { console.error('배경색 변경 실패:', err); }
          win.webContents.send('memo:colorSync', newMemoColor);
        }
      }
    });
    if (memosChanged) store.saveMemos(memos);
  }

  refreshTrayMenu();
  broadcastTopicsUpdated();
  return idx !== -1 ? topics[idx] : topic;
});

// 주제 순서 변경(위젯 대시보드에서 드래그로 재배열). orderedIds는 "보이는" 주제들의 새 순서.
// 숨겨진 주제는 원래 있던 자리를 그대로 유지하고, 보이는 주제 자리에만 새 순서를 채워넣음
ipcMain.handle('topics:reorder', (event, orderedIds) => {
  const topics = store.getTopics();
  const visibleSet = new Set(orderedIds);
  let qi = 0;
  const reordered = topics.map((t) => {
    if (visibleSet.has(t.id)) {
      const nextId = orderedIds[qi];
      qi += 1;
      return topics.find((x) => x.id === nextId) || t;
    }
    return t;
  });
  store.saveTopics(reordered);
  refreshTrayMenu();
  broadcastTopicsUpdated();
  return reordered;
});

ipcMain.handle('topics:delete', (event, topicId) => {
  const target = store.getTopics().find((t) => t.id === topicId);
  const topics = store.getTopics().filter((t) => t.id !== topicId);
  store.saveTopics(topics);
  // 지운 주제의 흔적이 숨김/항상위 목록과 스냅샷에 남아 파일에 쌓이지 않게 같이 정리
  pinnedTopicIds.delete(topicId);
  if (hiddenTopicIds.delete(topicId) || visibilitySnapshot.includes(topicId)) {
    visibilitySnapshot = visibilitySnapshot.filter((id) => id !== topicId);
    persistVisibilityState();
  }
  // 이 주제에 저장돼있던 템플릿 이미지 사본도 같이 지움(안 지우면 임시폴더에 계속 쌓임).
  // 주의: 이 주제에 딸린 메모들의 첨부파일은 여기서 안 건드림(메모는 그대로 유지되니까)
  if (target) (target.templateAttachments || []).forEach((a) => deleteStoredFile(a.storedName));
  refreshTrayMenu();
  broadcastTopicsUpdated();
  return topics;
});

// 메모를 다른 주제로 옮김. 메모지 색상은 새 주제 색으로 즉시 맞추고,
// 창이 열려있으면 새 주제의 지금 숨김/보임 상태에 맞춰 창도 같이 숨기거나 보여줌
ipcMain.handle('memos:setTopic', (event, { memoId, topicId }) => {
  const memos = store.getMemos();
  const idx = memos.findIndex((m) => m.id === memoId);
  if (idx === -1) return null;
  const topics = store.getTopics();
  const topic = topics.find((t) => t.id === topicId) || null;

  memos[idx].topicId = topic ? topic.id : null;
  if (topic) {
    memos[idx].color = topic.memoColor || topic.color;
    // 주제 이동으로 메모지 색이 바뀌면 창의 네이티브 배경색(리사이즈 잔상 색)도 같이 맞춤
    const movedWin = memoWindows.get(memoId);
    if (movedWin) {
      try { movedWin.setBackgroundColor(memos[idx].color); } catch (err) { console.error('배경색 변경 실패:', err); }
    }
  }
  // 주제를 옮기면 MD내보내기에 들어가는 태그가 바뀌므로, 다시 내보내야 하는 상태로 표시되게
  // updatedAt도 갱신함(아래 memos:setChecklist 등과 같은 이유)
  memos[idx].updatedAt = new Date().toISOString();
  store.saveMemos(memos);

  const win = memoWindows.get(memoId);
  if (win && !allMemosHidden) {
    if (topic && hiddenTopicIds.has(topic.id)) {
      win.webContents.send('memo:forceBlur');
      win.hide();
    } else if (!win.isVisible()) {
      showWindowAndNotify(win);
    }
  }

  broadcastMemosUpdated();
  return memos[idx];
});

// 현재 메모의 본문+이미지+체크리스트를 주제(topic)의 템플릿으로 저장.
// 첨부파일 중 이미지(isImage: true)만 대상이고, 제목은 템플릿에서 제외(defaultTitle 기능이 담당).
// 그 주제로 새 메모를 만들면(createNewMemo) 자동으로 채워짐. 기존 템플릿이 있으면 덮어씀
ipcMain.handle('memos:saveAsTemplate', (event, { memoId, topicId }) => {
  const memos = store.getMemos();
  const memo = memos.find((m) => m.id === memoId);
  if (!memo) return null;
  const topics = store.getTopics();
  const idx = topics.findIndex((t) => t.id === topicId);
  if (idx === -1) return null;

  // 원본 메모의 첨부와 독립된 사본을 만들어서, 원본 이미지를 나중에 지워도 템플릿은 그대로 유지되게 함
  const templateAttachments = (memo.attachments || [])
    .filter((a) => a.isImage)
    .map((a) => ({ ...a, storedName: cloneStoredFile(a.storedName) }));

  // 이 주제에 기존 템플릿이 이미 있었으면(덮어쓰는 경우), 그 옛 템플릿용 이미지 사본은
  // 더 이상 어디서도 안 쓰이니 지워둠(안 지우면 템플릿을 다시 저장할 때마다 계속 쌓임)
  (topics[idx].templateAttachments || []).forEach((a) => deleteStoredFile(a.storedName));

  topics[idx] = {
    ...topics[idx],
    templateContent: memo.content || '',
    // 체크 표시는 매번 새로 시작하는 게 맞아서(재사용할 목록이니) checked는 항상 false로 저장
    templateChecklist: (memo.checklist || []).map((it) => ({ text: it.text || '', checked: false })),
    templateAttachments,
    // 메모창 크기도 기억해뒀다가 템플릿으로 새 메모를 만들 때 그대로 적용함(접힌 상태의
    // 임시 높이가 아니라, 접히기 전 실제 높이를 저장하는 memo.size를 그대로 사용)
    templateSize: memo.size || null
  };
  store.saveTopics(topics);
  broadcastTopicsUpdated();
  return topics[idx];
});

// ---------- IPC: 카테고리(상위주제) ----------
// 실제 메모가 딸린 "주제"와는 별개인, 이름표 목록. 주제 만들 때 상위주제 드롭다운을 채우는 용도.

ipcMain.handle('categories:getAll', () => store.getCategories());

ipcMain.handle('categories:add', (event, category) => {
  const categories = store.getCategories();
  const newCategory = {
    id: randomUUID(),
    name: String(category.name || '').trim(),
    color: category.color || '#8A8574'
  };
  categories.push(newCategory);
  store.saveCategories(categories);
  return newCategory;
});

// 카테고리 색상만 나중에 바꿀 수 있게(이름은 지금처럼 삭제 후 재생성으로만 바뀜 — 이름은
// 주제 이름의 "카테고리/주제" 접두사와 직접 연결돼있어서 여기서 바꾸면 기존 주제와 어긋남)
ipcMain.handle('categories:update', (event, category) => {
  const categories = store.getCategories();
  const idx = categories.findIndex((c) => c.id === category.id);
  if (idx !== -1) categories[idx] = { ...categories[idx], ...category };
  store.saveCategories(categories);
  return idx !== -1 ? categories[idx] : category;
});

ipcMain.handle('categories:delete', (event, categoryId) => {
  const categories = store.getCategories().filter((c) => c.id !== categoryId);
  store.saveCategories(categories);
  return categories;
});

// 위젯의 카테고리별 숨김버튼: 그 카테고리에 속한 주제 전체를 한번에 화면에서만 숨김/보임 처리.
// (변경, 1.8.14) 예전엔 주제관리에서 하나씩 체크하는 topic.hidden 값을 여러 개 한번에 바꾸는
// 방식이었는데, 그러면 위젯 상단의 "숨김 N개" 버튼(topic.hidden 개수를 세는 것)과 주제목록의
// 숨김 표시가 카테고리 버튼을 누를 때마다 같이 바뀌어버리는 문제가 있었음(태훈님 확인).
// 그래서 topic.hidden은 전혀 건드리지 않고, 카테고리 자신의 hidden 값만 따로 저장하는 방식으로
// 분리함 — 화면에 보일지 말지는 renderer(widget.js)의 visibleTopics()에서 "주제 자신의 hidden"과
// "소속 카테고리의 hidden"을 각각 따로 확인해서 판단함
ipcMain.handle('topics:setCategoryHidden', (event, { categoryName, hidden }) => {
  const categories = store.getCategories();
  const idx = categories.findIndex((c) => c.name === categoryName);
  if (idx !== -1) {
    categories[idx] = { ...categories[idx], hidden: !!hidden };
    store.saveCategories(categories);
  }
  refreshTrayMenu();
  broadcastTopicsUpdated();
  return categories;
});

// ---------- IPC: 메모 ----------

ipcMain.handle('memos:getAll', () => store.getMemos());

ipcMain.handle('memos:getByTopic', (event, topicId) =>
  store.getMemos().filter((m) => m.topicId === topicId)
);

ipcMain.handle('app:copyText', (event, text) => {
  try {
    clipboard.writeText(text || '');
    return true;
  } catch (err) {
    console.error('클립보드 복사 실패:', err);
    return false;
  }
});

// 색상 붙여넣기 버튼용: 클립보드 텍스트를 읽어서 돌려줌(유효한 색상코드인지 판단은
// 렌더러 쪽(settings.js)에서 함 — 여기선 클립보드 원본 텍스트만 그대로 전달)
ipcMain.handle('app:pasteText', () => {
  try {
    return clipboard.readText() || '';
  } catch (err) {
    console.error('클립보드 읽기 실패:', err);
    return '';
  }
});

// 표 복사 버튼용: 마크다운 문법이 아니라 실제 표로 인식되도록 text(TSV)와 html(<table>)을
// 같이 클립보드에 씀 — 엑셀/워드/구글시트 등은 붙여넣을 때 html 쪽을 우선 표로 인식하고,
// 메모장 같은 곳은 text(TSV, 칸은 탭으로 구분)로 붙여넣어짐
ipcMain.handle('app:copyTable', (event, { text, html }) => {
  try {
    clipboard.write({ text: text || '', html: html || '' });
    return true;
  } catch (err) {
    console.error('표 복사 실패:', err);
    return false;
  }
});

// 표 붙여넣기 버튼용: 클립보드의 html/text를 둘 다 돌려줌(어느 걸 쓸지 판단은 렌더러에서 함 —
// html에 <table>이 있으면 그걸 우선 쓰고, 없으면 text를 줄바꿈=행/탭=칸으로 봄)
ipcMain.handle('app:pasteTable', () => {
  try {
    return { html: clipboard.readHTML() || '', text: clipboard.readText() || '' };
  } catch (err) {
    console.error('표 붙여넣기 실패:', err);
    return { html: '', text: '' };
  }
});

ipcMain.handle('memos:createNew', (event, topicId) => {
  if (settingsWindow) return null; // 설정창이 열려있는 동안은 새 메모 생성을 막음
  return createNewMemo(topicId);
});

/* 달력에서 제목만 치고 엔터 → 메모창을 열지 않고 바로 일정 하나를 만듦 (0.20.0).
   createNewMemo를 쓰지 않는 이유: 그쪽은 반드시 메모창을 띄우고 주제 템플릿까지 채우는데,
   여기서 필요한 건 "제목 한 줄짜리 일정"뿐이라 창이 뜨면 오히려 번거로워짐.
   시각을 안 적으면 00:00으로 저장하고 달력 목록에서는 시각을 안 보여줌
   (memo.scheduleAt은 "YYYY-MM-DDTHH:mm" 16글자여야 메모창의 일정칸이 정상 동작함). */
ipcMain.handle('calendar:createSchedule', (event, { dateKey, time, title } = {}) => {
  if (settingsWindow) return null;
  const cleanTitle = String(title == null ? '' : title).trim();
  if (!cleanTitle) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateKey || ''))) return null;
  const hhmm = normalizeScheduleTime(time) || '00:00';

  const topic = ensureCalendarTopic();
  const now = new Date().toISOString();
  const memo = {
    id: randomUUID(),
    topicId: topic.id,
    title: cleanTitle,
    content: '',
    color: topic.memoColor || topic.color || '#C9A24B',
    createdAt: now,
    updatedAt: now,
    position: nextNewMemoPosition(320, 380),
    alwaysOnTop: false,
    collapsed: false,
    attachments: [],
    checklist: [],
    tables: [],
    postSaveAction: null,
    useCalendar: true,
    scheduleAt: `${dateKey}T${hhmm}`,
    alarm: {
      enabled: false,
      before: { days: 0, hours: 0, minutes: 0 },
      repeat: 'none',
      methods: ['notify', 'sound'],
      firedFor: null
    },
    obsidian: { saved: false, filePath: null }
  };

  const memos = store.getMemos();
  memos.push(memo);
  store.saveMemos(memos);
  broadcastMemosUpdated();
  return memo;
});

/* 달력 목록에서 시각만 그 자리에서 고침 (0.20.1, 태훈님 확정 2026-08-15).
   날짜는 안 건드리고 뒤의 "HH:mm"만 갈아끼운다. 예전에는 시각 하나 바꾸려고
   메모창을 열어야 했음.
   - 시각 해석("9" → 09:00)은 빠른 입력칸과 똑같이 normalizeScheduleTime 하나만 쓴다.
     달력 쪽에 같은 규칙을 또 만들면 나중에 한쪽만 고쳐져서 어긋난다.
   - 빈 값이면 00:00("시각을 안 적은 일정")으로 되돌린다. 목록에서 시각이 안 보이게 됨.
   - 못 알아보는 값이면 아무것도 안 바꾸고 null을 돌려준다(달력이 원래 값으로 되돌림).
   - 시각이 바뀌면 알람 기준도 바뀌므로 memos:setScheduleAt 과 똑같이 firedFor를 다시 맞춘다.
     안 그러면 지나간 시각으로 바꾼 순간 알람이 곧바로 울린다. */
ipcMain.handle('calendar:setScheduleTime', (event, { memoId, time } = {}) => {
  const memos = store.getMemos();
  const idx = memos.findIndex((m) => m.id === memoId);
  if (idx === -1) return null;

  const cur = memos[idx].scheduleAt;
  if (typeof cur !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(cur)) return null;

  const raw = String(time == null ? '' : time).trim();
  const hhmm = raw ? normalizeScheduleTime(raw) : '00:00';
  if (!hhmm) return null;   // 못 알아보는 값 → 안 바꿈

  const next = `${cur.slice(0, 10)}T${hhmm}`;
  if (next === cur) return memos[idx];   // 바뀐 게 없으면 저장도 안 함

  memos[idx].scheduleAt = next;
  memos[idx].updatedAt = new Date().toISOString();
  if (memos[idx].alarm && memos[idx].alarm.enabled) {
    memos[idx].alarm.firedFor = latestDueFire(memos[idx], new Date());
  }
  store.saveMemos(memos);
  broadcastMemosUpdated();
  return memos[idx];
});

ipcMain.handle('memos:updateContent', (event, { memoId, content }) => {
  const memos = store.getMemos();
  const idx = memos.findIndex((m) => m.id === memoId);
  if (idx === -1) return null;
  memos[idx].content = content;
  memos[idx].updatedAt = new Date().toISOString();
  store.saveMemos(memos);
  broadcastMemosUpdated();
  return memos[idx];
});

ipcMain.handle('memos:setTitle', (event, { memoId, title }) => {
  const memos = store.getMemos();
  const idx = memos.findIndex((m) => m.id === memoId);
  if (idx === -1) return null;
  memos[idx].title = title || '';
  store.saveMemos(memos);
  broadcastMemosUpdated();
  return memos[idx];
});

// 일정 날짜 저장. value는 "YYYY-MM-DDTHH:mm"(로컬 시각) 문자열 또는 null(지움).
// 일정 날짜는 MD내보내기 파일명/상단정보에 반영되므로 updatedAt도 갱신해 다시 내보내기 대상이 되게 함.
ipcMain.handle('memos:setScheduleAt', (event, { memoId, scheduleAt }) => {
  const memos = store.getMemos();
  const idx = memos.findIndex((m) => m.id === memoId);
  if (idx === -1) return null;
  memos[idx].scheduleAt = scheduleAt || null;
  memos[idx].updatedAt = new Date().toISOString();
  // 일정 날짜를 바꾸면 알람 기준 시각도 바뀌므로, 이미 지나간 시각으로 알람이 곧바로
  // 울리지 않도록 firedFor를 "지금 기준 가장 최근에 지나간 알람 시각"으로 다시 맞춰둠(재기준).
  if (memos[idx].alarm && memos[idx].alarm.enabled) {
    memos[idx].alarm.firedFor = latestDueFire(memos[idx], new Date());
  }
  store.saveMemos(memos);
  broadcastMemosUpdated();
  return memos[idx];
});

// 이 메모에서 달력(일정 날짜) 기능을 쓸지 on/off. 끄면 일정 칸이 사라지고 저장날짜 기준으로 동작.
ipcMain.handle('memos:setUseCalendar', (event, { memoId, useCalendar }) => {
  const memos = store.getMemos();
  const idx = memos.findIndex((m) => m.id === memoId);
  if (idx === -1) return null;
  memos[idx].useCalendar = !!useCalendar;
  store.saveMemos(memos);
  return memos[idx];
});

// ---------- 알람 ----------
// 저장값("YYYY-MM-DDTHH:mm", 로컬 시각)을 로컬 Date로 만든다. 형식이 아니면 null.
function alarmBaseDate(scheduleAt) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(scheduleAt || '');
  if (!m) return null;
  return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], 0, 0);
}
// 기준(base)에서 반복주기로 n번째 발생 시각을 만듦. 항상 base에서 직접 계산하므로 오차가
// 누적되지 않음. 매월/매년은 그 달에 그 날짜가 없으면(예: 1/31의 다음달, 2/29의 평년) 그 달의
// 말일로 맞춤 — "매월 말일" 류 알람이 엉뚱한 날로 밀리지 않게 함.
function occurrenceAt(base, repeat, n) {
  if (repeat === 'daily') { const d = new Date(base.getTime()); d.setDate(d.getDate() + n); return d; }
  if (repeat === 'weekly') { const d = new Date(base.getTime()); d.setDate(d.getDate() + 7 * n); return d; }
  const y = base.getFullYear(), mo = base.getMonth(), da = base.getDate(), h = base.getHours(), mi = base.getMinutes();
  if (repeat === 'monthly') {
    const total = mo + n;
    const ny = y + Math.floor(total / 12);
    const nm = ((total % 12) + 12) % 12;
    const dim = new Date(ny, nm + 1, 0).getDate(); // 그 달의 마지막 날
    return new Date(ny, nm, Math.min(da, dim), h, mi, 0, 0);
  }
  if (repeat === 'yearly') {
    const ny = y + n;
    const dim = new Date(ny, mo + 1, 0).getDate();
    return new Date(ny, mo, Math.min(da, dim), h, mi, 0, 0);
  }
  return new Date(base.getTime());
}
// "며칠/몇시간/몇분 전"을 밀리초로.
function beforeMs(before) {
  const b = before || {};
  return ((+b.days || 0) * 1440 + (+b.hours || 0) * 60 + (+b.minutes || 0)) * 60000;
}
// 렌더러에서 온 알람 설정을 안전한 형태로 다듬음(빠진 값·이상한 값 방어).
function normalizeAlarm(a) {
  a = a || {};
  const b = a.before || {};
  const repeats = ['none', 'daily', 'weekly', 'monthly', 'yearly'];
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.floor(+v || 0)));
  const methods = Array.isArray(a.methods)
    ? a.methods.filter((m) => ['notify', 'sound', 'popup'].includes(m))
    : [];
  return {
    enabled: !!a.enabled,
    before: { days: clamp(b.days, 0, 3650), hours: clamp(b.hours, 0, 23), minutes: clamp(b.minutes, 0, 59) },
    repeat: repeats.includes(a.repeat) ? a.repeat : 'none',
    methods,
    firedFor: a.firedFor || null
  };
}
// 지금(now) 기준으로 "이미 지나간 알람 시각" 중 가장 최근 것의 ISO 문자열. 아직 아무것도
// 안 지났으면 null. (반복이면 scheduleAt에서 주기만큼 굴려가며 지나간 것 중 최신을 찾음)
function latestDueFire(memo, now) {
  if (!memo || !memo.useCalendar || !memo.scheduleAt || !memo.alarm || !memo.alarm.enabled) return null;
  const base = alarmBaseDate(memo.scheduleAt);
  if (!base) return null;
  const off = beforeMs(memo.alarm.before);
  const repeat = memo.alarm.repeat || 'none';
  const nowMs = now.getTime();
  if (repeat === 'none') {
    const f = base.getTime() - off;
    return f <= nowMs ? new Date(f).toISOString() : null;
  }
  let n = 0;
  let last = null;
  let guard = 0;
  while (guard++ < 200000) {
    const f = occurrenceAt(base, repeat, n).getTime() - off;
    if (f <= nowMs) { last = f; n++; }
    else break;
  }
  return last === null ? null : new Date(last).toISOString();
}
// 메모창을 앞으로(없으면 새로 열어) 가져옴 — 알람 클릭/"메모창 띄우기" 방식용.
function focusOrOpenMemo(memoId) {
  const memo = store.getMemos().find((m) => m.id === memoId);
  if (!memo) return;
  const win = memoWindows.get(memoId);
  if (win && !win.isDestroyed()) {
    if (win.isMinimized()) win.restore();
    if (!win.isVisible()) win.show();
    win.focus();
  } else {
    createMemoWindow(memo, { forceVisible: true });
  }
}
// 실제로 알람을 울림: 방식(methods)에 따라 윈도우 알림/소리/메모창 띄우기.
function fireAlarm(memo) {
  const methods = (memo.alarm && memo.alarm.methods) || [];
  const wantNotify = methods.includes('notify');
  const wantSound = methods.includes('sound');
  const wantPopup = methods.includes('popup');

  // 소리: 열려있는 창(위젯 우선, 없으면 아무 메모창)에서 짧은 알림음을 재생. 재생할 창이
  // 하나도 없으면 아래에서 윈도우 알림 자체의 소리로 대체함(soundPlayed=false).
  let soundPlayed = false;
  if (wantSound) {
    let target = (widgetWindow && !widgetWindow.isDestroyed()) ? widgetWindow : null;
    if (!target) {
      for (const w of memoWindows.values()) { if (w && !w.isDestroyed()) { target = w; break; } }
    }
    if (target) { try { target.webContents.send('alarm:playSound'); soundPlayed = true; } catch (e) {} }
  }

  if (wantNotify && Notification.isSupported()) {
    const title = (memo.title && memo.title.trim()) ? memo.title.trim() : '메모 알람';
    let body = (memo.content || '').replace(/\s+/g, ' ').trim();
    if (body.length > 80) body = body.slice(0, 80) + '…';
    if (!body) body = memo.scheduleAt ? memo.scheduleAt.replace('T', ' ') : '';
    const n = new Notification({
      title: '⏰ ' + title,
      body,
      // 소리를 원하는데 재생할 창이 없었으면, 알림 자체의 소리로라도 울리게 함(silent=false)
      silent: !(wantSound && !soundPlayed),
      icon: ICON_PATH
    });
    n.on('click', () => focusOrOpenMemo(memo.id));
    n.show();
  }

  if (wantPopup) focusOrOpenMemo(memo.id);
}
// 주기적으로 모든 메모의 알람을 검사해서 시각이 된 것을 울림(중복 방지: firedFor).
function checkAlarms() {
  const now = new Date();
  const memos = store.getMemos();
  let changed = false;
  for (const memo of memos) {
    if (!memo.useCalendar || !memo.scheduleAt || !memo.alarm || !memo.alarm.enabled) continue;
    const due = latestDueFire(memo, now);
    if (due && memo.alarm.firedFor !== due) {
      fireAlarm(memo);
      memo.alarm.firedFor = due;
      changed = true;
    }
  }
  if (changed) store.saveMemos(memos);
}

// 알람 설정 저장. 저장 시점 기준으로 firedFor를 재기준해서 "이미 지나간 시각"으로는 곧바로
// 울리지 않게 함(앞으로 올 시각에만 울림). scheduleAt/useCalendar는 다른 핸들러가 관리함.
ipcMain.handle('memos:setAlarm', (event, { memoId, alarm }) => {
  const memos = store.getMemos();
  const idx = memos.findIndex((m) => m.id === memoId);
  if (idx === -1) return null;
  const norm = normalizeAlarm(alarm);
  memos[idx].alarm = norm;
  // 재기준: 지금 기준 이미 지나간 알람 시각을 firedFor로 찍어두면, 그 지나간 건은 안 울리고
  // 다음에 올 시각부터 울린다. (아직 아무것도 안 지났으면 null → 제 시각에 울림)
  norm.firedFor = latestDueFire(memos[idx], new Date());
  store.saveMemos(memos);
  broadcastMemosUpdated();
  return memos[idx];
});

// 체크리스트 항목 전체를 통째로 교체 저장(추가/삭제/체크/텍스트수정 모두 렌더러에서 배열을 만들어 넘김)
ipcMain.handle('memos:setChecklist', (event, { memoId, checklist }) => {
  const memos = store.getMemos();
  const idx = memos.findIndex((m) => m.id === memoId);
  if (idx === -1) return null;
  memos[idx].checklist = Array.isArray(checklist) ? checklist : [];
  // 체크리스트도 MD내보내기 결과물에 포함되므로, 다시 내보내야 하는 상태로 표시되게 updatedAt 갱신
  // (아래 MD내보내기 버튼 흐리게/재활성화 판단 기준 — obsidian:export에서 exportedVersion과 비교함)
  memos[idx].updatedAt = new Date().toISOString();
  store.saveMemos(memos);
  return memos[idx];
});

// 표(들) 전체를 통째로 교체 저장(칸 글자수정/행·열 추가삭제/표 추가삭제 모두 렌더러에서
// memo.tables 배열을 만들어 넘김) — memos:setChecklist와 완전히 같은 패턴(1.8.14)
ipcMain.handle('memos:setTables', (event, { memoId, tables }) => {
  const memos = store.getMemos();
  const idx = memos.findIndex((m) => m.id === memoId);
  if (idx === -1) return null;
  memos[idx].tables = Array.isArray(tables) ? tables : [];
  // 표도 MD내보내기 결과물에 포함되므로, 다시 내보내야 하는 상태로 표시되게 updatedAt 갱신
  memos[idx].updatedAt = new Date().toISOString();
  store.saveMemos(memos);
  return memos[idx];
});

ipcMain.handle('memos:setPostSaveAction', (event, { memoId, action }) => {
  const memos = store.getMemos();
  const idx = memos.findIndex((m) => m.id === memoId);
  if (idx === -1) return null;
  memos[idx].postSaveAction = action; // null | 'override' (하위호환: 'keep' | 'delete')
  store.saveMemos(memos);
  return memos[idx];
});

ipcMain.handle('memos:delete', (event, memoId) => {
  const target = store.getMemos().find((m) => m.id === memoId);
  const memos = store.getMemos().filter((m) => m.id !== memoId);
  store.saveMemos(memos);
  // (변경) 첨부파일까지 같이 바로 지우던 걸 휴지통(trash.json)으로 옮기는 방식으로 바꿈.
  // 첨부파일은 여기서 안 지우고 그대로 둠 — 나중에 복구할 때 같이 살아나야 하니까(영구삭제/
  // 보관기한 만료 때만 실제로 지움. trash:permanentDelete, cleanupExpiredTrash 참고).
  // sweepOrphanAttachments도 휴지통에 있는 첨부파일은 "참조중"으로 쳐서 안 지우게 같이 고침
  if (target) {
    const trash = store.getTrash();
    trash.push({ ...target, deletedAt: new Date().toISOString() });
    store.saveTrash(trash);
  }
  const win = memoWindows.get(memoId);
  if (win) win.close();
  broadcastMemosUpdated();
  return true;
});

// ---- 휴지통 ----
// 삭제한 메모를 이 보관기한(일) 동안 trash.json에 보관. 지나면 cleanupExpiredTrash()가
// 앱 시작할 때 자동으로 첨부파일까지 완전히 지움(아래 app.whenReady에서 호출)
const TRASH_RETENTION_DAYS = 60;

ipcMain.handle('trash:list', () => store.getTrash());

ipcMain.handle('trash:restore', (event, memoId) => {
  const trash = store.getTrash();
  const idx = trash.findIndex((t) => t.id === memoId);
  if (idx === -1) return trash;
  const [restored] = trash.splice(idx, 1);
  store.saveTrash(trash);
  delete restored.deletedAt;
  const memos = store.getMemos();
  memos.push(restored);
  store.saveMemos(memos);
  // (참고) 복구된 메모의 원래 주제가 그 사이 삭제됐을 수 있음 — 그 경우 위젯 주제 목록엔 안
  // 보이지만(주제를 지워도 딸린 메모는 그대로 남는 기존 동작과 동일한 현상), 데이터는
  // 안전하게 살아있고 memos.json에도 정상적으로 들어있음
  broadcastMemosUpdated();
  return trash;
});

ipcMain.handle('trash:permanentDelete', (event, memoId) => {
  const trash = store.getTrash();
  const idx = trash.findIndex((t) => t.id === memoId);
  if (idx === -1) return trash;
  const [target] = trash.splice(idx, 1);
  store.saveTrash(trash);
  (target.attachments || []).forEach((a) => deleteStoredFile(a.storedName));
  return trash;
});

ipcMain.handle('trash:empty', () => {
  const trash = store.getTrash();
  trash.forEach((t) => (t.attachments || []).forEach((a) => deleteStoredFile(a.storedName)));
  store.saveTrash([]);
  return [];
});

// 보관기한(TRASH_RETENTION_DAYS)이 지난 휴지통 항목을 첨부파일까지 완전히 지움.
// 무거운 작업이 아니라서 인터벌 타이머 없이 앱 켤 때 한 번만 확인함
function cleanupExpiredTrash() {
  const trash = store.getTrash();
  if (!trash.length) return;
  const cutoff = Date.now() - TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const expired = trash.filter((t) => new Date(t.deletedAt).getTime() < cutoff);
  if (!expired.length) return;
  expired.forEach((t) => (t.attachments || []).forEach((a) => deleteStoredFile(a.storedName)));
  const remaining = trash.filter((t) => new Date(t.deletedAt).getTime() >= cutoff);
  store.saveTrash(remaining);
}

// 메모창을 열거나(없으면 새로) 이미 있으면 앞으로 가져옴 — memos:openExisting과 검색 결과
// 클릭(search:choose) 둘 다 여기를 같이 씀(로직이 어긋나지 않게 한 곳으로 모음)
function openOrFocusMemoWindow(memoId) {
  const memo = store.getMemos().find((m) => m.id === memoId);
  if (!memo) return null;
  const win = memoWindows.get(memoId);
  if (win) {
    // (수정) 창이 존재해도 주제 전체숨김 등으로 숨겨져 있을 수 있음 — 그 경우 focus()만으론
    // 안 보이던 문제가 있어서, 숨겨진 상태면 먼저 다시 보이게 한 뒤 포커스를 줌
    if (!win.isVisible()) {
      materializeHiddenState();
      hiddenTopicIds.delete(memo.topicId);
      showWindowAndNotify(win);
      markManualVisibilityChange();
    }
    win.focus();
  } else {
    createMemoWindow(memo);
    // (수정) 창이 없어서 새로 만든 경우 눈 아이콘이 안 갱신되던 문제 방지(위와 동일)
    broadcastMemosUpdated();
  }
  return memo;
}

ipcMain.handle('memos:openExisting', (event, memoId) => openOrFocusMemoWindow(memoId));

// 위젯 목록에서 메모 항목 클릭 — 주제 클릭 제스처와는 완전히 별개로 동작.
// 안 열려있으면 열고, 열려서 보이는 중이면 닫음. 창은 있지만 숨겨진 상태(주제 전체숨김 등)면
// 그냥 닫아버리지 않고 다시 보이게 함(예전엔 존재 여부만 보고 닫아버려서, 숨김 상태인 메모를
// 목록에서 클릭해도 아무 반응 없어 보이던 문제가 있었음)
ipcMain.handle('memos:toggleOpen', (event, memoId) => {
  const memo = store.getMemos().find((m) => m.id === memoId);
  if (!memo) return null;
  const win = memoWindows.get(memoId);
  if (win) {
    if (win.isVisible()) {
      win.close();
      markMemoWindowOpen(memoId, false); // 사용자가 직접 닫은 거라 다음 실행 때 안 되살아나게 표시
      // win.on('closed')에서도 새로고침 신호를 보내지만, 그건 창이 실제로 다 닫힌 뒤라
      // 살짝 늦게 반영될 수 있어서 여기서도 바로 한 번 더 보내 눈 아이콘이 즉시 바뀌게 함
      broadcastMemosUpdated();
      markManualVisibilityChange(); // 직접 닫은 것도 보임/숨김 변화라 전체숨김 순환을 처음으로 되돌림
      return { opened: false };
    }
    materializeHiddenState();
    hiddenTopicIds.delete(memo.topicId);
    showWindowAndNotify(win);
    markManualVisibilityChange();
    return { opened: true };
  }
  createMemoWindow(memo);
  // (수정) 창이 아예 없어서 새로 만든 경우엔 여기서 신호를 안 보내서, 이 메모의 눈 아이콘이
  // 안 바뀌다가 "다른" 메모를 건드려야 그제서야 뒤늦게 갱신되는 문제가 있었음(createNewMemo의
  // 같은 패턴과 동일하게 맞춤)
  broadcastMemosUpdated();
  return { opened: true };
});

// 위젯 주제 더블클릭: 그 주제의 메모를 전부 보이게 하거나(없으면 새로 만들고, 숨겨져 있으면 다시 보이게)
// 전부 안 보이게 숨김. "닫기"가 아니라 "숨기기/보이기"라서 다시 누르면 즉시 다시 뜨고,
// 커서/스크롤 위치도 그대로 유지됨(예전엔 진짜로 창을 닫았다가 새로 만들었는데, 그러면 다시 뜰 때마다
// 순간적으로 다시 그려지는 게 눈에 띄어서 숨기기/보이기 방식으로 바꿈)
ipcMain.handle('memos:toggleTopicOpen', (event, topicId) => {
  const memos = store.getMemos().filter((m) => m.topicId === topicId);
  if (!memos.length) return false;

  const allVisible = memos.every((m) => {
    const win = memoWindows.get(m.id);
    return win && win.isVisible();
  });

  if (allVisible) {
    hiddenTopicIds.add(topicId);
    memos.forEach((m) => {
      const win = memoWindows.get(m.id);
      if (win) {
        win.webContents.send('memo:forceBlur');
        win.hide();
      }
    });
    broadcastMemosUpdated();
    markManualVisibilityChange();
    return true;
  }

  materializeHiddenState();
  hiddenTopicIds.delete(topicId);
  memos.forEach((m) => {
    const win = memoWindows.get(m.id);
    if (win) showWindowAndNotify(win);
    else createMemoWindow(m);
  });
  // (수정) 창이 없어서 새로 만든 메모가 섞여있으면 눈 아이콘이 안 갱신되던 문제 방지(위와 동일)
  broadcastMemosUpdated();
  markManualVisibilityChange();
  return false;
});

// 개별 메모 접기/펼치기: 접히면 타이틀바만 남을 정도로 창을 줄이고, 펼치면 저장된 크기로 복원
ipcMain.handle('memos:setCollapsed', (event, { memoId, value }) => {
  const memos = store.getMemos();
  const idx = memos.findIndex((m) => m.id === memoId);
  if (idx === -1) return null;
  const collapsed = !!value;
  memos[idx].collapsed = collapsed;
  store.saveMemos(memos);

  const win = memoWindows.get(memoId);
  if (win) {
    const [width] = win.getSize();
    if (collapsed) {
      // 최소높이 제한(220px)이 접힘높이(44px)보다 커서 그대로 두면 setSize가 무시되고
      // 다시 220px로 튕겨나감 — 접을 때는 최소높이도 같이 줄여줘야 함
      win.setMinimumSize(240, MEMO_COLLAPSED_HEIGHT);
      win.setSize(width, MEMO_COLLAPSED_HEIGHT);
    } else {
      win.setMinimumSize(240, MEMO_MIN_HEIGHT);
      win.setSize(width, memos[idx].size?.height || 380);
    }
  }
  broadcastMemosUpdated();
  return memos[idx];
});

ipcMain.handle('memos:setAlwaysOnTop', (event, { memoId, value }) => {
  const memos = store.getMemos();
  const idx = memos.findIndex((m) => m.id === memoId);
  if (idx === -1) return null;
  memos[idx].alwaysOnTop = !!value;
  store.saveMemos(memos);
  const win = memoWindows.get(memoId);
  if (win) win.setAlwaysOnTop(!!value);
  return memos[idx];
});

ipcMain.handle('memos:setColor', (event, { memoId, color }) => {
  const memos = store.getMemos();
  const idx = memos.findIndex((m) => m.id === memoId);
  if (idx === -1) return null;
  memos[idx].color = color;
  store.saveMemos(memos);
  // 창의 네이티브 배경색도 같이 바꿔서, 크기 조절 때 잠깐 보이는 잔상이 메모지 색과 똑같게 유지
  const colorWin = memoWindows.get(memoId);
  if (colorWin) {
    try { colorWin.setBackgroundColor(color); } catch (err) { console.error('배경색 변경 실패:', err); }
  }
  broadcastMemosUpdated();
  return memos[idx];
});

const IMAGE_EXT = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'];

// 첨부 이미지 자동 리사이즈: 저장공간/메모리 절약 목적. 가로가 이 값보다 큰 이미지만 줄임(세로는 비율대로 자동 조정).
// gif(애니메이션 깨짐)와 webp/svg(재인코딩 미지원)는 리사이즈 대상에서 제외하고 원본 그대로 저장함
const IMAGE_RESIZE_MAX_WIDTH = 1500;
const RESIZABLE_IMAGE_EXT = ['.png', '.jpg', '.jpeg'];

// 이미지 버퍼가 IMAGE_RESIZE_MAX_WIDTH보다 크면 줄여서 다시 인코딩한 버퍼를 반환,
// 리사이즈 대상이 아니거나 이미 그보다 작으면 원본 버퍼를 그대로 반환
function resizeImageBufferIfNeeded(buffer, ext) {
  const safeExt = (ext || '').toLowerCase();
  if (!RESIZABLE_IMAGE_EXT.includes(safeExt)) return buffer;
  try {
    const img = nativeImage.createFromBuffer(buffer);
    const { width } = img.getSize();
    if (!width || width <= IMAGE_RESIZE_MAX_WIDTH) return buffer;
    const resized = img.resize({ width: IMAGE_RESIZE_MAX_WIDTH });
    if (safeExt === '.png') return resized.toPNG();
    return resized.toJPEG(90);
  } catch (err) {
    console.error('이미지 리사이즈 실패, 원본으로 저장:', err);
    return buffer;
  }
}

// 앱 임시폴더 안의 첨부파일 하나를 실제로 지움(파일이 이미 없으면 조용히 넘어감).
// 메모/템플릿/주제가 더 이상 참조하지 않게 된 첨부파일을 지울 때 공용으로 씀
function deleteStoredFile(storedName) {
  if (!storedName) return;
  try {
    const filePath = path.join(ATTACH_DIR(), storedName);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch (err) {
    console.error('첨부파일 삭제 실패:', storedName, err);
  }
}

// 앱 임시폴더(첨부파일 저장소) 안에 있지만, 지금 어떤 메모의 첨부로도 / 어떤 주제의
// 템플릿으로도 더 이상 참조되지 않는 "고아" 파일을 찾아서 지움. 메모/템플릿을 지울 때마다
// 그때그때 같이 지우는 게 기본이지만(위 deleteStoredFile 사용처들), 예전 버전에서 이미
// 쌓여있던 파일이나 놓친 경우를 대비해 설정 화면에서 수동으로 한 번씩 정리할 수 있게 함
function sweepOrphanAttachments() {
  const attachDir = ATTACH_DIR();
  const referenced = new Set();
  store.getMemos().forEach((m) => (m.attachments || []).forEach((a) => a.storedName && referenced.add(a.storedName)));
  store.getTopics().forEach((t) => (t.templateAttachments || []).forEach((a) => a.storedName && referenced.add(a.storedName)));
  // (추가) 휴지통에 있는 메모의 첨부파일도 "참조중"으로 쳐야 함 — 안 그러면 복구를 기다리는
  // 동안 고아파일로 오인돼서 지워져버림(복구했더니 이미지가 사라져있는 사고 방지)
  store.getTrash().forEach((t) => (t.attachments || []).forEach((a) => a.storedName && referenced.add(a.storedName)));

  let files = [];
  try {
    files = fs.readdirSync(attachDir, { withFileTypes: true })
      .filter((e) => e.isFile())
      .map((e) => e.name);
  } catch (err) {
    console.error('첨부파일 폴더 읽기 실패:', err);
    return { removed: 0, total: 0 };
  }

  let removed = 0;
  files.forEach((name) => {
    if (referenced.has(name)) return;
    deleteStoredFile(name);
    removed += 1;
  });
  return { removed, total: files.length };
}

// 첨부파일을 앱 임시폴더 안에서 새 파일명으로 복제. 템플릿 기능처럼 원본 첨부와 독립된
// 사본이 필요할 때 사용(원본 메모/첨부가 나중에 지워져도 사본은 그대로 남아있게)
function cloneStoredFile(storedName) {
  const attachDir = ATTACH_DIR();
  const ext = path.extname(storedName);
  const newName = `${randomUUID().slice(0, 8)}${ext}`;
  fs.copyFileSync(path.join(attachDir, storedName), path.join(attachDir, newName));
  return newName;
}

// 파일 경로 목록을 앱 임시폴더로 복사하고 첨부파일 메타데이터 목록을 반환 (파일선택/드래그앤드롭 공용)
function copyPathsToAttachments(paths) {
  const attachDir = ATTACH_DIR();
  return paths.map((srcPath) => {
    const ext = path.extname(srcPath);
    const base = sanitizeFileName(path.basename(srcPath, ext));
    const storedName = `${randomUUID().slice(0, 8)}_${base}${ext}`;
    const destPath = path.join(attachDir, storedName);
    if (RESIZABLE_IMAGE_EXT.includes(ext.toLowerCase())) {
      const buffer = resizeImageBufferIfNeeded(fs.readFileSync(srcPath), ext);
      fs.writeFileSync(destPath, buffer);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
    return {
      storedName,
      originalName: path.basename(srcPath),
      isImage: IMAGE_EXT.includes(ext.toLowerCase())
    };
  });
}

// 파일 선택 다이얼로그로 첨부파일을 골라 앱 임시폴더에 복사, 렌더러에 고유 파일명 반환
ipcMain.handle('attachments:pick', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openFile', 'multiSelections']
  });
  if (result.canceled || !result.filePaths.length) return [];
  return copyPathsToAttachments(result.filePaths);
});

// 드래그앤드롭으로 파일을 직접 놓았을 때 (탐색기의 실제 경로를 그대로 사용)
ipcMain.handle('attachments:addFromPaths', (event, paths) => {
  if (!Array.isArray(paths) || !paths.length) return [];
  return copyPathsToAttachments(paths);
});

ipcMain.handle('memos:addAttachment', (event, { memoId, attachment }) => {
  const memos = store.getMemos();
  const idx = memos.findIndex((m) => m.id === memoId);
  if (idx === -1) return null;
  if (!memos[idx].attachments) memos[idx].attachments = [];
  memos[idx].attachments.push(attachment);
  memos[idx].updatedAt = new Date().toISOString(); // 첨부도 MD내보내기에 포함되므로 갱신
  store.saveMemos(memos);
  return memos[idx];
});

// 첨부 이미지를 메모창에서 미리보기 할 수 있도록 로컬 경로 제공
ipcMain.handle('attachments:getPath', (event, storedName) =>
  path.join(ATTACH_DIR(), storedName)
);

// 메모 내용을 .txt 로 내보내기 (매번 저장 위치 직접 선택)
ipcMain.handle('files:exportTxt', async (event, { content, suggestedName }) => {
  const result = await dialog.showSaveDialog({
    defaultPath: `${suggestedName || '메모'}.txt`,
    filters: [{ name: 'Text', extensions: ['txt'] }]
  });
  if (result.canceled || !result.filePath) return null;
  return exportAsTxt(result.filePath, content);
});

// txt/md 파일을 불러와서 메모에 삽입
ipcMain.handle('files:importTextFile', async () => {
  const settings = store.getSettings();
  const dialogOptions = {
    properties: ['openFile'],
    filters: [{ name: 'Text/Markdown', extensions: ['txt', 'md'] }]
  };
  // 설정에 지정해둔 옵시디언 Vault 폴더가 있으면, 불러오기 창이 그 폴더에서 바로 열리게 함
  if (settings.vaultPath && fs.existsSync(settings.vaultPath)) {
    dialogOptions.defaultPath = settings.vaultPath;
  }
  const result = await dialog.showOpenDialog(dialogOptions);
  if (result.canceled || !result.filePaths.length) return null;
  const content = fs.readFileSync(result.filePaths[0], 'utf-8');
  return { content, fileName: path.basename(result.filePaths[0]) };
});

// 작성된 모든 메모를 원하는 폴더에 원하는 형식(txt/md)으로 한꺼번에 저장(백업/전체 내보내기).
// 1) 형식 선택 → 2) 저장할 폴더 선택 → 3) 주제별 하위폴더로 나눠서 저장
ipcMain.handle('memos:exportAll', async () => {
  const parentWin = settingsWindow || widgetWindow || undefined;

  const choice = await dialog.showMessageBox(parentWin, {
    type: 'question',
    buttons: ['취소', 'txt로', 'md로', '둘 다로'],
    defaultId: 3,
    cancelId: 0,
    title: '전체 메모 내보내기',
    message: '어떤 형식으로 내보낼까요?'
  });
  if (choice.response === 0) return { canceled: true };
  const formats = choice.response === 1 ? ['txt'] : choice.response === 2 ? ['md'] : ['txt', 'md'];

  const folderResult = await dialog.showOpenDialog(parentWin, {
    title: '저장할 폴더를 선택하세요',
    properties: ['openDirectory', 'createDirectory']
  });
  if (folderResult.canceled || !folderResult.filePaths[0]) return { canceled: true };

  const result = exportAllMemos({
    baseDir: folderResult.filePaths[0],
    memos: store.getMemos(),
    topics: store.getTopics(),
    formats,
    attachDir: ATTACH_DIR()
  });
  backupRawData(folderResult.filePaths[0]); // 일정·알람·가계부 원본도 같이 백업
  return { canceled: false, ...result };
});

// "데이터원본" 폴더(백업 때 같이 복사해둔 원본 JSON)로 복구 — md 파싱 없이 원본 그대로
// 되살려서 일정 날짜·알람·가계부까지 살아남. 규칙은 md 복구와 동일: 기존 것은 절대 안
// 건드리고, 지금 없는 것만(id 기준) 새로 추가함.
function restoreFromRawData(rawDir) {
  const readBackupJson = (name) => {
    try {
      const p = path.join(rawDir, name);
      if (!fs.existsSync(p)) return null;
      return JSON.parse(fs.readFileSync(p, 'utf-8'));
    } catch (err) {
      console.error('데이터 원본 읽기 실패:', name, err);
      return null;
    }
  };

  // 주제: 없는 것만 추가(id 기준)
  const bakTopics = readBackupJson('topics.json');
  const topics = store.getTopics();
  const topicIds = new Set(topics.map((t) => t.id));
  let newTopicCount = 0;
  (Array.isArray(bakTopics) ? bakTopics : []).forEach((t) => {
    if (t && t.id && !topicIds.has(t.id)) {
      topics.push(t);
      topicIds.add(t.id);
      newTopicCount += 1;
    }
  });

  // 상위주제(카테고리) 이름 목록: 없는 것만 추가
  const bakCategories = readBackupJson('categories.json');
  if (Array.isArray(bakCategories) && bakCategories.length) {
    const categories = store.getCategories();
    const have = new Set(categories.map((c) => (typeof c === 'string' ? c : c && c.id)));
    let added = false;
    bakCategories.forEach((c) => {
      const key = typeof c === 'string' ? c : c && c.id;
      if (key && !have.has(key)) { categories.push(c); have.add(key); added = true; }
    });
    if (added) store.saveCategories(categories);
  }

  // 메모: 없는 것만 추가(id 기준) — 일정 날짜·알람·체크리스트·첨부 정보까지 원본 그대로
  const bakMemos = readBackupJson('memos.json');
  const memos = store.getMemos();
  const memoIds = new Set(memos.map((m) => m.id));
  let restoredCount = 0;
  (Array.isArray(bakMemos) ? bakMemos : []).forEach((m) => {
    if (m && m.id && !memoIds.has(m.id)) {
      memos.push(m);
      memoIds.add(m.id);
      restoredCount += 1;
    }
  });

  // 가계부: 분류·지출 기록 다 없는 것만 추가(id 기준)
  const bakLedger = readBackupJson('ledger.json');
  let ledgerCount = 0;
  if (bakLedger && typeof bakLedger === 'object') {
    const ledger = store.getLedger();
    const catIds = new Set(ledger.categories.map((c) => c.id));
    (Array.isArray(bakLedger.categories) ? bakLedger.categories : []).forEach((c) => {
      if (c && c.id && !catIds.has(c.id)) { ledger.categories.push(c); catIds.add(c.id); }
    });
    const entryIds = new Set(ledger.entries.map((e) => e.id));
    (Array.isArray(bakLedger.entries) ? bakLedger.entries : []).forEach((e) => {
      if (e && e.id && !entryIds.has(e.id)) {
        ledger.entries.push(e);
        entryIds.add(e.id);
        ledgerCount += 1;
      }
    });
    store.saveLedger(ledger);
    broadcastLedgerUpdated();
  }

  store.saveTopics(topics);
  store.saveMemos(memos);
  broadcastTopicsUpdated();
  broadcastMemosUpdated();
  return { canceled: false, count: restoredCount, topicCount: newTopicCount, ledgerCount };
}

// 백업 폴더에서 다시 불러오기(복구). 폴더 안의 주제별 하위폴더를 주제로, 그 안의 md/txt
// 파일 하나하나를 메모로 되살림. 기존 주제/메모는 절대 건드리지 않고 "새로 추가"만 함
// (같은 이름 주제가 이미 있으면 새로 안 만들고 그 주제에 메모만 이어붙임)
ipcMain.handle('memos:restoreFromBackup', async () => {
  const parentWin = settingsWindow || widgetWindow || undefined;
  const folderResult = await dialog.showOpenDialog(parentWin, {
    title: '복구할 백업 폴더를 선택하세요',
    properties: ['openDirectory']
  });
  if (folderResult.canceled || !folderResult.filePaths[0]) return { canceled: true };
  const baseDir = folderResult.filePaths[0];

  // 백업할 때 만들어둔 "첨부" 폴더(이미지 원본)가 있으면, 실제 앱 저장소로 먼저 복사해둠.
  // 아래에서 각 메모 글 안의 "![[파일명]]" 구문을 다시 첨부(이미지)로 되살릴 때 이 목록을 참고함
  const backupAttachFolder = path.join(baseDir, '첨부');
  const restorableAttachNames = new Set();
  if (fs.existsSync(backupAttachFolder)) {
    const realAttachDir = ATTACH_DIR();
    fs.readdirSync(backupAttachFolder, { withFileTypes: true }).forEach((entry) => {
      if (!entry.isFile()) return;
      const src = path.join(backupAttachFolder, entry.name);
      const dest = path.join(realAttachDir, entry.name);
      try {
        if (!fs.existsSync(dest)) fs.copyFileSync(src, dest);
        restorableAttachNames.add(entry.name);
      } catch (err) {
        console.error('첨부 복구 실패:', entry.name, err);
      }
    });
  }

  // "데이터원본" 폴더(우리가 백업 때 만든 원본 JSON)가 있으면 그걸로 복구 —
  // md 파싱보다 정확하고, 일정 날짜·알람·가계부 기록까지 전부 살아남
  const rawDir = path.join(baseDir, '데이터원본');
  if (fs.existsSync(path.join(rawDir, 'memos.json'))) {
    return restoreFromRawData(rawDir);
  }

  // 하위 폴더까지 전부 뒤져서 .md / .txt 파일을 다 찾음("첨부"·"데이터원본" 폴더는 제외)
  const files = [];
  function walk(dir) {
    fs.readdirSync(dir, { withFileTypes: true }).forEach((entry) => {
      if (entry.isDirectory() && (entry.name === '첨부' || entry.name === '데이터원본')) return;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(md|txt)$/i.test(entry.name)) files.push(full);
    });
  }
  walk(baseDir);
  if (!files.length) return { canceled: false, count: 0, topicCount: 0 };

  // 내보낼 때 자동으로 덧붙인 "![[파일명]]" (+ 바로 아래 "*캡션*") 구문을 찾아내는 정규식.
  // 메모연결 기능이 쓰는 "[[파일명]]"(느낌표 없음)과는 다른 패턴이라 서로 안 섞임
  const embedRegex = () => /!\[\[([^\]\n]+)\]\](?:\n\*([^\n*]+)\*)?/g;

  const topics = store.getTopics();
  const memos = store.getMemos();
  const topicByName = new Map(topics.map((t) => [t.name, t]));
  const palette = ['#8A8574', '#C9A24B', '#BFE1F0', '#FCE8A8', '#E3B7A0', '#B7CBE3'];
  let paletteIdx = topics.length;
  let newTopicCount = 0;
  let restoredCount = 0;

  files.forEach((filePath) => {
    // 폴더 경로를 "업무/마케팅" 같은 원래 주제 이름으로 되돌림 (내보낼 때와 반대 방향 변환)
    const relDir = path.relative(baseDir, path.dirname(filePath));
    const topicName = relDir ? relDir.split(path.sep).join('/') : '미분류';

    let topic = topicByName.get(topicName);
    if (!topic) {
      const color = palette[paletteIdx % palette.length];
      paletteIdx += 1;
      topic = {
        id: randomUUID(),
        name: topicName,
        description: '',
        iconChar: topicName.slice(0, 2),
        color,
        textColor: '#FFFFFF',
        memoColor: color,
        hidden: false
      };
      topics.push(topic);
      topicByName.set(topicName, topic);
      newTopicCount += 1;
    }

    // 파일명에서 제목 복원: 자동백업의 "_추적코드8자리" 꼬리표나, 수동내보내기의 "(2)" 중복표시를 제거
    const fileNameNoExt = path.basename(filePath).replace(/\.(md|txt)$/i, '');
    const title = fileNameNoExt.replace(/_[0-9a-f]{8}$/i, '').replace(/\s\(\d+\)$/, '');
    const rawContent = fs.readFileSync(filePath, 'utf-8');
    const now = new Date().toISOString();

    // 본문 안의 "![[파일명]]"(+캡션) 구문을 다시 이미지 첨부로 되살리고, 본문에서는 그 구문을 걷어냄
    const restoredAttachments = [];
    let m;
    const findRe = embedRegex();
    while ((m = findRe.exec(rawContent)) !== null) {
      const storedName = m[1];
      if (!restorableAttachNames.has(storedName)) continue;
      restoredAttachments.push({
        storedName,
        originalName: storedName,
        isImage: /\.(png|jpe?g|gif|webp|bmp)$/i.test(storedName),
        displayX: null,
        displayY: null,
        displayWidth: null,
        displayHeight: null,
        caption: m[2] || '',
        captionWidth: null,
        captionHeight: null,
        captionOffsetX: null,
        captionOffsetY: null
      });
    }
    const content = rawContent
      .replace(embedRegex(), '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    memos.push({
      id: randomUUID(),
      topicId: topic.id,
      title,
      content,
      color: topic.memoColor || topic.color,
      createdAt: now,
      updatedAt: now,
      position: null,
      collapsed: false,
      alwaysOnTop: false,
      attachments: restoredAttachments,
      checklist: [],
      postSaveAction: null,
      obsidian: { saved: false, filePath: null }
    });
    restoredCount += 1;
  });

  store.saveTopics(topics);
  store.saveMemos(memos);
  broadcastTopicsUpdated();
  broadcastMemosUpdated();

  return { canceled: false, count: restoredCount, topicCount: newTopicCount };
});

// 내보내기 모달을 열 때 미리 채워줄 파일명(주제_제목_YYYYMMDD_001 규칙) 계산
ipcMain.handle('obsidian:suggestFileName', (event, memoId) => {
  const settings = store.getSettings();
  const memo = store.getMemos().find((m) => m.id === memoId);
  if (!memo) return '';
  const topics = store.getTopics();
  const topic = topics.find((t) => t.id === memo.topicId) || null;
  return suggestFileName({
    vaultPath: settings.vaultPath,
    topic,
    title: memo.title,
    rule: settings.exportNameRule,
    scheduleAt: (memo.useCalendar && memo.scheduleAt) ? memo.scheduleAt : null
  });
});

ipcMain.handle('obsidian:export', (event, { memoId, customFileName, extraTags }) => {
  const settings = store.getSettings();
  const memos = store.getMemos();
  const idx = memos.findIndex((m) => m.id === memoId);
  if (idx === -1) throw new Error('메모를 찾을 수 없습니다.');

  const memo = memos[idx];
  const topics = store.getTopics();
  const topic = topics.find((t) => t.id === memo.topicId) || null;

  // 이 메모를 예전에 이미 내보낸 적 있으면(memo.obsidian.filePath) 새 파일을 또 만들지 않고
  // 그 파일에 덮어씀 — customFileName은 처음 내보낼 때만 실제로 파일명에 반영됨
  const { filePath, fileName } = exportMemoToObsidian({
    vaultPath: settings.vaultPath,
    content: memo.content,
    topic,
    extraTags: extraTags || [],
    customFileName,
    attachments: memo.attachments || [],
    checklist: memo.checklist || [],
    tables: memo.tables || [],
    attachDir: ATTACH_DIR(),
    overwritePath: memo.obsidian && memo.obsidian.filePath ? memo.obsidian.filePath : undefined,
    scheduleAt: (memo.useCalendar && memo.scheduleAt) ? memo.scheduleAt : null
  });

  // exportedVersion에 지금 시점의 updatedAt을 같이 저장해둠 — 렌더러(memo.js)가 나중에
  // "이 메모, 내보낸 뒤로 수정된 적 있나?"를 memo.updatedAt과 비교해서 판단할 수 있게 됨
  // (MD내보내기 버튼을 흐리게 바꿨다가 실제 수정이 생기면 다시 눌리게 하는 기준)
  memo.obsidian = { saved: true, filePath, exportedVersion: memo.updatedAt || null };
  store.saveMemos(memos);
  broadcastMemosUpdated();

  // "메모 연결" 기능(다른 메모에 [[링크]] 걸기)에서 고를 수 있도록 내보내기 기록을 남김.
  // 메모 자체가 나중에 "전송 후 삭제"로 없어져도 이 기록은 남아있어서 계속 링크 대상이 됨
  store.addExportLogEntry({
    memoId: memo.id,
    title: memo.title || '',
    topicName: topic ? topic.name : '미분류',
    fileNameNoExt: path.basename(fileName, '.md'),
    filePath,
    exportedAt: new Date().toISOString()
  });

  // 저장 후 동작 결정: 메모가 'override'면 전역 기본값의 반대로, 아니면 전역 기본값을 따름
  // (예전 데이터에 'keep'/'delete'가 그대로 남아있을 수 있어 하위호환으로 그 값도 처리함)
  let action;
  if (memo.postSaveAction === 'override') {
    action = settings.defaultPostSaveAction === 'delete' ? 'keep' : 'delete';
  } else if (memo.postSaveAction === 'keep' || memo.postSaveAction === 'delete') {
    action = memo.postSaveAction;
  } else {
    action = settings.defaultPostSaveAction;
  }
  if (action === 'delete') {
    const win = memoWindows.get(memoId);
    if (win) win.close();
    const remaining = memos.filter((m) => m.id !== memoId);
    store.saveMemos(remaining);
    // 이미 옵시디언 Vault의 "첨부" 폴더로 복사가 끝난 뒤라 안전하게 지울 수 있음
    // (안 지우면 앱 임시폴더에 계속 쌓임)
    (memo.attachments || []).forEach((a) => deleteStoredFile(a.storedName));
  }

  return { filePath, fileName, action };
});

// "메모 연결" 기능: 지금까지 옵시디언으로 내보낸 적 있는 것들만 목록으로 줌
// (최근 내보낸 순으로 정렬해서 반환 — 화면에서 주제별로 묶고 검색하는 건 렌더러 쪽에서 처리)
ipcMain.handle('obsidian:getExportLog', () => {
  const log = store.getExportLog();
  // 파일 경로를 알고 있는데(filePath) 그 자리에 파일이 실제로 없으면(수동으로 지워졌거나
  // Vault가 옮겨진 경우) 목록에서 빼줌 — 없는 파일로 링크를 걸 수는 없으니까.
  // filePath를 모르는 예전 기록은 확인할 방법이 없어 그대로 둠
  const existing = log.filter((entry) => !entry.filePath || fs.existsSync(entry.filePath));
  return [...existing].sort((a, b) => new Date(b.exportedAt) - new Date(a.exportedAt));
});

// ---------- IPC: 창 제어 ----------

ipcMain.handle('window:closeMemo', (event, memoId) => {
  const win = memoWindows.get(memoId);
  if (win) win.close();
  markMemoWindowOpen(memoId, false); // 사용자가 직접 닫은 거라 다음 실행 때 안 되살아나게 표시
});

ipcMain.handle('window:openSettings', () => createSettingsWindow());
ipcMain.handle('window:openWidget', () => createWidgetWindow());
ipcMain.handle('window:openCalendar', () => { createCalendarWindow(); });
ipcMain.handle('window:openHelp', () => createHelpWindow());

// (7단계) 달력 잠금/활성화 전환 — 렌더러가 더블클릭을 감지하면 활성화를 요청함.
// 활성화: 포커스 가능하게 바꾸고 앞으로 가져옴. 잠금 복귀는 blur 핸들러가 처리.
ipcMain.handle('calendar:setActive', (event, active) => {
  if (!calendarWindow || calendarWindow.isDestroyed()) return;
  if (active) {
    calendarWindow.setFocusable(true);
    calendarWindow.focus();
    calendarWindow.moveTop();
    calendarWindow.webContents.send('calendar:activeChanged', true);
  } else {
    calendarWindow.blur();
  }
});

// 달력창이 달라는 날짜들("YYYY-MM-DD" 배열)의 음력 날짜를 한꺼번에 변환해서 돌려줌.
// 칸마다 따로 부르면 느려서 한 번에 배치로 처리(인계서 규칙: 음력은 API 아닌 내장 변환).
// 반환: { "YYYY-MM-DD": { m: 음력달, d: 음력일, leap: 윤달여부 } } (변환 불가한 날짜는 빠짐)
const KoreanLunarCalendar = require('korean-lunar-calendar');
ipcMain.handle('calendar:getLunarMap', (event, dateKeys) => {
  const out = {};
  if (!Array.isArray(dateKeys)) return out;
  const conv = new KoreanLunarCalendar();
  dateKeys.slice(0, 100).forEach((key) => { // 방어: 최대 100개(월간 그리드는 42개)
    if (typeof key !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(key)) return;
    const [y, m, d] = key.split('-').map(Number);
    try {
      // 라이브러리 지원 범위(1000~2050) 밖이거나 잘못된 날짜면 false 반환 → 건너뜀
      if (!conv.setSolarDate(y, m, d)) return;
      const lunar = conv.getLunarCalendar();
      if (lunar) out[key] = { m: lunar.month, d: lunar.day, leap: !!lunar.intercalation };
    } catch (e) { /* 변환 실패한 날짜는 표시 안 함 */ }
  });
  return out;
});

// ---- 공휴일(특일정보 API, 태훈님 키 보유) ----
// API 응답(JSON) → { "YYYY-MM-DD": "이름" } 맵으로 변환하는 순수 함수(DOM/네트워크 없이 테스트 가능).
// 실패·빈 응답이면 빈 맵을 돌려줌 — 공휴일 기능이 안 돼도 달력 자체는 항상 정상 동작해야 함.
function parseHolidayResponse(json) {
  const days = {};
  try {
    const header = json && json.response && json.response.header;
    if (!header || header.resultCode !== '00') return days; // 인증 실패 등 — 조용히 빈 맵
    const items = json.response.body && json.response.body.items;
    if (!items || items === '') return days; // 그 해 항목이 0개면 items가 빈 문자열로 옴
    let list = items.item;
    if (!list) return days;
    if (!Array.isArray(list)) list = [list]; // 항목이 1개뿐이면 배열이 아니라 객체 하나로 옴
    list.forEach((it) => {
      if (!it || it.isHoliday !== 'Y' || !it.locdate) return;
      const s = String(it.locdate);
      if (s.length !== 8) return;
      const key = `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
      days[key] = it.dateName || '공휴일';
    });
  } catch (e) { /* 파싱 실패해도 빈 맵으로 — 달력은 계속 동작 */ }
  return days;
}

// 특일정보 API에서 그 해 공휴일을 받아옴. serviceKey는 태훈님이 ⚙설정에 입력한 값을 그대로
// URL에 붙임(공공데이터포털의 "인증키(Encoding)" 형식 — 추가 인코딩하면 이중 인코딩으로 깨짐).
async function fetchHolidayYear(year, apiKey) {
  const params = new URLSearchParams({ solYear: String(year), numOfRows: '100', _type: 'json' });
  const url = `https://apis.data.go.kr/B090041/openapi/service/SpcdeInfoService/getRestDeInfo?serviceKey=${apiKey}&${params.toString()}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('공휴일 API HTTP ' + res.status);
  const json = await res.json();
  return parseHolidayResponse(json);
}

// 캐시가 아직 쓸만한지 판정(순수 함수 — 테스트하기 쉽게 분리). 지난 연도는 다시 안 바뀌니
// 캐시가 있으면 무조건 신선한 것으로 침(영구 캐시). 올해/미래 연도만 refreshMs 지나면 다시 확인
// (임시공휴일이 뒤늦게 발표되는 경우 대비).
function isHolidayCacheFresh(entry, year, currentYear, nowMs, refreshMs) {
  if (!entry) return false;
  if (year < currentYear) return true;
  const age = nowMs - new Date(entry.fetchedAt).getTime();
  return Number.isFinite(age) && age < refreshMs;
}

// 렌더러가 연도를 물어보면 위 판정에 따라 캐시를 쓰거나 다시 받아옴. 키가 없으면(태훈님이
// 아직 ⚙설정에 안 넣었으면) 네트워크 요청 없이 조용히 빈 값(또는 기존 캐시)만 돌려줌.
const HOLIDAY_REFRESH_MS = 12 * 60 * 60 * 1000;
ipcMain.handle('calendar:getHolidays', async (event, year) => {
  const y = Math.floor(Number(year));
  if (!Number.isFinite(y)) return {};
  const settings = store.getSettings();
  const apiKey = (settings.calendar && settings.calendar.holidayApiKey) || '';
  const cache = store.getHolidayCache();
  const entry = cache[y];
  const isFresh = isHolidayCacheFresh(entry, y, new Date().getFullYear(), Date.now(), HOLIDAY_REFRESH_MS);
  if (isFresh) return entry.days;
  if (!apiKey) return (entry && entry.days) || {};
  try {
    const days = await fetchHolidayYear(y, apiKey);
    store.saveHolidayYear(y, days);
    return days;
  } catch (e) {
    console.error('공휴일 조회 실패(기존 캐시로 대체):', e.message);
    return (entry && entry.days) || {};
  }
});

// ---------- IPC: 가계부(달력 가계부 모드) ----------
// 지출 데이터는 ledger.json에만 저장 — 메모 데이터와 완전히 분리(인계서 규칙).
// 바뀔 때마다 달력창에 'ledger:updated'를 보내 화면을 새로 그리게 함.
function broadcastLedgerUpdated() {
  if (calendarWindow && !calendarWindow.isDestroyed()) {
    calendarWindow.webContents.send('ledger:updated');
  }
}

ipcMain.handle('ledger:get', () => store.getLedger());

ipcMain.handle('ledger:addEntry', (event, entry) => {
  const ledger = store.getLedger();
  const amount = Math.round(Number(entry && entry.amount));
  if (!entry || !entry.date || !Number.isFinite(amount) || amount <= 0) return null;
  const newEntry = {
    id: randomUUID(),
    date: String(entry.date).slice(0, 10),      // "YYYY-MM-DD"
    categoryId: entry.categoryId || 'etc',
    amount,
    memo: typeof entry.memo === 'string' ? entry.memo.trim() : ''
  };
  ledger.entries.push(newEntry);
  store.saveLedger(ledger);
  broadcastLedgerUpdated();
  return newEntry;
});

ipcMain.handle('ledger:updateEntry', (event, entry) => {
  const ledger = store.getLedger();
  const idx = ledger.entries.findIndex((e) => e.id === (entry && entry.id));
  if (idx === -1) return null;
  const amount = Math.round(Number(entry.amount));
  ledger.entries[idx] = {
    ...ledger.entries[idx],
    ...(entry.date ? { date: String(entry.date).slice(0, 10) } : {}),
    ...(entry.categoryId ? { categoryId: entry.categoryId } : {}),
    ...(Number.isFinite(amount) && amount > 0 ? { amount } : {}),
    ...(typeof entry.memo === 'string' ? { memo: entry.memo.trim() } : {})
  };
  store.saveLedger(ledger);
  broadcastLedgerUpdated();
  return ledger.entries[idx];
});

ipcMain.handle('ledger:deleteEntry', (event, entryId) => {
  const ledger = store.getLedger();
  ledger.entries = ledger.entries.filter((e) => e.id !== entryId);
  store.saveLedger(ledger);
  broadcastLedgerUpdated();
  return true;
});

// 가계부 설정(월급날·예산·고정지출) 부분 병합 저장 — ledger.json의 settings만 건드림.
// store.getLedger()가 이상한 값을 걸러주므로 여기선 합치기만 하면 됨.
ipcMain.handle('ledger:saveSettings', (event, patch) => {
  const ledger = store.getLedger();
  ledger.settings = { ...ledger.settings, ...(patch || {}) };
  store.saveLedger(ledger);
  // 고정 지출을 새로 등록/수정했다면 이번 달 치를 바로 기입해줌(날짜가 이미 지났으면)
  applyFixedExpenses();
  broadcastLedgerUpdated();
  return store.getLedger().settings;
});

// 위트 멘트 문구 읽기(데이터 폴더의 멘트.json — 없으면 기본 멘트로 생성됨)
ipcMain.handle('ledger:getMents', () => store.getMents());

// 멘트.json을 메모장 등 기본 프로그램으로 열어줌(태훈님이 문구를 직접 수정할 수 있게).
// 파일이 아직 없으면 getMents()가 기본 멘트로 만들어준 뒤 열림
ipcMain.handle('ledger:openMentsFile', () => {
  store.getMents();
  const p = store.getDataFilePath('ments');
  if (p) shell.openPath(p);
  return true;
});

// 가계부 엑셀 내보내기: 전체 지출 기록을 CSV(엑셀에서 바로 열림)로 저장.
ipcMain.handle('ledger:exportCsv', async () => {
  const ledger = store.getLedger();
  const catName = {};
  ledger.categories.forEach((c) => { catName[c.id] = c.name; });
  const rows = [['날짜', '분류', '금액', '메모', '자동기입']];
  ledger.entries
    .slice()
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
    .forEach((e) => {
      rows.push([
        e.date,
        catName[e.categoryId] || '(삭제된 분류)',
        e.amount,
        e.memo || '',
        e.fixedId ? '고정지출' : ''
      ]);
    });
  const esc = (v) => {
    const t = String(v == null ? '' : v).replace(/"/g, '""');
    return /[",\n]/.test(t) ? `"${t}"` : t;
  };
  // BOM(0xFEFF) 표식을 맨 앞에 붙이면 엑셀이 한글을 안 깨뜨리고 읽음
  const bom = String.fromCharCode(0xFEFF);
  const csv = bom + rows.map((r) => r.map(esc).join(',')).join('\r\n');
  const now = new Date();
  const stamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const result = await dialog.showSaveDialog({
    title: '가계부 엑셀(CSV)로 내보내기',
    defaultPath: `가계부_${stamp}.csv`,
    filters: [{ name: 'CSV (엑셀에서 열림)', extensions: ['csv'] }]
  });
  if (result.canceled || !result.filePath) return { canceled: true };
  fs.writeFileSync(result.filePath, csv, 'utf-8');
  return { canceled: false, path: result.filePath, count: ledger.entries.length };
});

// 고정 지출 자동 기입: 매달 등록한 날짜(N일)가 되면 지출 기록에 자동으로 추가함.
// - 이번 달만 확인(앱을 한 달 내내 안 켰으면 그 달은 건너뜀 — 단순하고 예측 가능하게)
// - 그 달에 N일이 없으면(예: 31일 등록 + 2월) 말일로 맞춤. setMonth 안 씀(인계서 규칙)
// - 중복 방지: settings.fixedApplied["고정지출id:YYYY-MM"] 표식 — 한 번 기입한 달은
//   다시 안 넣음(자동 기입된 걸 사용자가 지워도 되살아나지 않음)
function applyFixedExpenses() {
  const ledger = store.getLedger();
  const s = ledger.settings;
  if (!Array.isArray(s.fixed) || !s.fixed.length) return;
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth(); // 0~11
  const todayDay = now.getDate();
  const ym = `${y}-${String(m + 1).padStart(2, '0')}`;
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  let changed = false;
  s.fixed.forEach((f) => {
    const amount = Math.round(Number(f && f.amount));
    if (!f || !f.id || !Number.isFinite(amount) || amount <= 0) return;
    const day = Math.min(Math.max(1, Math.floor(Number(f.day) || 1)), 31);
    const applyDay = Math.min(day, daysInMonth); // 말일 맞춤
    if (todayDay < applyDay) return; // 아직 날짜 안 됨
    const applyDate = `${ym}-${String(applyDay).padStart(2, '0')}`;
    // 등록한 날보다 앞선 날짜는 기입 안 함 — 등록 도중(날짜를 아직 못 바꾼 상태)에
    // 이번 달 지난 날짜로 잘못 들어가는 사고 방지. 다음 달부터는 정상 기입됨
    if (typeof f.createdAt === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(f.createdAt) && applyDate < f.createdAt) return;
    const key = `${f.id}:${ym}`;
    if (s.fixedApplied[key]) return; // 이번 달은 이미 기입함
    ledger.entries.push({
      id: randomUUID(),
      date: applyDate,
      categoryId: f.categoryId || 'etc',
      amount,
      memo: (typeof f.memo === 'string' && f.memo.trim()) ? f.memo.trim() : '고정 지출',
      fixedId: f.id // 자동 기입 표식(수동 기록과 구분용)
    });
    s.fixedApplied[key] = true;
    changed = true;
  });
  if (changed) {
    store.saveLedger(ledger);
    broadcastLedgerUpdated();
  }
}

// 분류 목록 통째 저장(설정창에서 이름·색 수정/추가/삭제 후 호출).
// 지출 기록(entries)은 건드리지 않음. 삭제된 분류를 쓰던 기록은 색만 회색으로 보이게 됨(기록은 보존).
ipcMain.handle('ledger:saveCategories', (event, categories) => {
  if (!Array.isArray(categories) || !categories.length) return null;
  const ledger = store.getLedger();
  ledger.categories = categories.map((c) => ({
    id: c.id || randomUUID(),
    name: String(c.name || '').trim() || '(이름 없음)',
    color: c.color || '#8A8577'
  }));
  store.saveLedger(ledger);
  broadcastLedgerUpdated();
  return ledger.categories;
});

// "메모 연결" 검색 팝업 열기/닫기 + 목록에서 하나 고르면 원래 메모창에 [[링크]]를 꽂아줌
ipcMain.handle('window:openMemoLink', (event, memoId) => {
  const anchorWin = BrowserWindow.fromWebContents(event.sender);
  createMemoLinkWindow(memoId, anchorWin);
});

ipcMain.handle('window:closeMemoLink', () => {
  if (memoLinkWindow) memoLinkWindow.close();
});

ipcMain.handle('memoLink:choose', (event, fileNameNoExt) => {
  if (memoLinkTargetMemoId) {
    const win = memoWindows.get(memoLinkTargetMemoId);
    if (win) win.webContents.send('memoLink:selected', fileNameNoExt);
  }
  if (memoLinkWindow) memoLinkWindow.close();
});

// "다른 주제로 이동" 팝업 열기/닫기 + 목록 데이터 제공 + 하나 고르면 원래 메모창에 알려줌
// (실제로 주제를 옮기는 처리는 기존처럼 메모창 쪽(memos:setTopic)에서 함 — 팝업은 "뭘 골랐는지"만 전달)
ipcMain.handle('window:openMoveTopic', (event, memoId) => {
  const anchorWin = BrowserWindow.fromWebContents(event.sender);
  createMoveTopicWindow(memoId, anchorWin);
});

ipcMain.handle('window:closeMoveTopic', () => {
  if (moveTopicWindow) moveTopicWindow.close();
});

ipcMain.handle('moveTopic:getData', () => {
  const topics = store.getTopics();
  const memos = store.getMemos();
  const memo = memos.find((m) => m.id === moveTopicTargetMemoId);
  // 지금 속한 주제는 목록에서 빼고 보여줌(같은 주제로 "이동"할 필요는 없으니까)
  return topics.filter((t) => !memo || t.id !== memo.topicId);
});

ipcMain.handle('moveTopic:choose', (event, topicId) => {
  if (moveTopicTargetMemoId) {
    const win = memoWindows.get(moveTopicTargetMemoId);
    if (win) win.webContents.send('moveTopic:selected', topicId);
  }
  if (moveTopicWindow) moveTopicWindow.close();
});

// 위젯 🔍 검색 팝업 열기/닫기 + 목록에서 하나 고르면 그 메모창을 열어주고 팝업은 닫힘
ipcMain.handle('window:openSearch', (event) => {
  const anchorWin = BrowserWindow.fromWebContents(event.sender);
  createSearchWindow(anchorWin);
});

ipcMain.handle('window:closeSearch', () => {
  if (searchWindow) searchWindow.close();
});

ipcMain.handle('search:choose', (event, memoId) => {
  openOrFocusMemoWindow(memoId);
  if (searchWindow) searchWindow.close();
});

// confirm()/alert() 같은 네이티브 확인창이 닫힌 뒤 키보드 입력을 못 받는 문제를 렌더러의
// window.focus()만으로 못 고치는 경우가 있어서(특히 frame:false인 메모창/위젯창), 메인
// 프로세스에서 직접 그 창을 focus()+webContents.focus() 해주는 더 확실한 방법을 추가로 제공
ipcMain.handle('window:refocusSelf', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) {
    win.focus();
    win.webContents.focus();
  }
});

// 위젯 폭이 바뀔 때, 손잡이+완전축소버튼이 오른쪽에 있으면(설정 > 위젯, handlePosition)
// 오른쪽 테두리는 그 자리에 고정해두고 왼쪽으로 늘고 줄게 함. 기본값인 왼쪽 손잡이는
// 지금까지와 똑같이 왼쪽 테두리를 고정한 채로 오른쪽이 늘고 줄어듦(동작 변화 없음).
// setSize는 항상 왼쪽 위(x,y)를 고정한 채 크기만 바꾸므로, 오른쪽 고정이 필요할 때만
// setBounds로 x좌표까지 같이 계산해서 넘겨줌(그 외엔 완전히 예전과 동일하게 setSize만 사용)
// (1.8.16 신규) 위젯이 지금 있는 모니터에서 위쪽/아래쪽 중 어디에 더 가까운지 계산.
// "더 가까운 쪽"이 아니라 "남는 공간이 더 적은 쪽"으로 판단함 — 위로 붙어있으면 아래쪽에
// 공간이 넉넉하니 지금처럼 아래로 늘어나면 되고(top), 아래로 붙어있으면 위쪽에 공간이
// 넉넉하니 위로 늘어나야(bottom) 화면 밖으로 안 나감
function computeWidgetVerticalAnchor(win) {
  const bounds = win.getBounds();
  const work = screen.getDisplayNearestPoint({ x: bounds.x, y: bounds.y }).workArea;
  const spaceBelow = (work.y + work.height) - (bounds.y + bounds.height);
  const spaceAbove = bounds.y - work.y;
  return spaceAbove > spaceBelow ? 'bottom' : 'top';
}

// 위젯 가로(손잡이 위치 left/right 설정)·세로(widgetVerticalAnchor) 중 필요한 쪽만 반대편
// 모서리를 고정한 채 크기를 바꿈. 기본(왼쪽+위쪽)은 예전처럼 setSize만 씀(동작 변화 없음)
function resizeWidgetKeepingAnchor(win, width, height) {
  const settings = store.getSettings();
  const w = Math.round(width);
  const h = Math.round(height);
  const anchorRight = settings.widget.handlePosition === 'right';
  const anchorBottom = widgetVerticalAnchor === 'bottom';
  if (!anchorRight && !anchorBottom) {
    win.setSize(w, h);
    return;
  }
  const bounds = win.getBounds();
  win.setBounds({
    x: anchorRight ? bounds.x + (bounds.width - w) : bounds.x,
    y: anchorBottom ? bounds.y + (bounds.height - h) : bounds.y,
    width: w,
    height: h
  });
}

ipcMain.handle('widget:resize', (event, { width, height }) => {
  const settings = store.getSettings();
  if (!widgetWindow || !settings.widget.autoResize) return;
  // (수정) 완전축소(handleOnly) 상태로 잠긴(setResizable(false)) 채로 setSize를 하면
  // 창이 안 줄어들거나 안 늘어나는 문제가 있어서, 크기를 바꿀 땐 항상 잠깐 풀었다가 바꾸고
  // 완전축소 상태일 때만 바꾼 뒤 다시 잠금
  const wasLocked = !widgetWindow.isResizable();
  if (wasLocked) widgetWindow.setResizable(true);
  if (settings.widget.collapsed) {
    // 접힘 상태에서도 폭(주제 버튼 개수에 맞춤)은 자동 조절 허용, 높이는 항상 접힘 높이로 고정
    resizeWidgetKeepingAnchor(widgetWindow, width, WIDGET_COLLAPSED_HEIGHT);
  } else {
    resizeWidgetKeepingAnchor(widgetWindow, width, height);
  }
  if (settings.widget.handleOnly) widgetWindow.setResizable(false);
});

// 위젯 자체 항상위 on/off
ipcMain.handle('widget:setAlwaysOnTop', (event, value) => {
  const settings = store.getSettings();
  settings.widget.alwaysOnTop = !!value;
  store.saveSettings(settings);
  if (widgetWindow) widgetWindow.setAlwaysOnTop(!!value);
  return settings.widget;
});

// 위젯이 접힌 상태에서, 이동손잡이만 남기고 주제버튼/다른 버튼까지 다 숨기는 완전축소 (세션 간 유지)
// 실제 창 폭 축소는 렌더러(widget.js)가 손잡이의 실제 렌더링 크기를 재서 widget:resize로 요청함.
// (수정) 완전축소 상태에서 창 테두리를 마우스로 끌면 크기(특히 세로)가 임의로 바뀌던 문제가 있어서
// 크기 조절 자체를 잠그기로 했는데, 여기서 바로 잠가버리면(setResizable(false)) 뒤이어
// widget:resize가 요청하는 축소가 안 먹는 문제가 생겨서, 잠금/해제는 실제 크기변경이 일어나는
// widget:resize 쪽에서 처리하도록 옮김 (여긴 설정값만 저장)
ipcMain.handle('widget:setHandleOnly', (event, value) => {
  const settings = store.getSettings();
  settings.widget.handleOnly = !!value;
  store.saveSettings(settings);
  return settings.widget;
});

// 위젯 접기/펼치기 (세션 간 유지)
ipcMain.handle('widget:setCollapsed', (event, value) => {
  const settings = store.getSettings();
  const collapsed = !!value;
  settings.widget.collapsed = collapsed;
  store.saveSettings(settings);
  if (widgetWindow) {
    if (collapsed) {
      // 접을 땐 지금 폭 그대로 유지(렌더러가 곧이어 주제 버튼 수에 맞춰 다시 조정함)
      const [width] = widgetWindow.getSize();
      resizeWidgetKeepingAnchor(widgetWindow, width, WIDGET_COLLAPSED_HEIGHT);
    } else {
      // 펼 땐 접힘 상태에서 자동으로 늘어나 있던 폭이 아니라, 펼친 상태의 "진짜" 폭으로 복원
      const restoreWidth = settings.widget.expandedWidth || settings.widget.width;
      resizeWidgetKeepingAnchor(widgetWindow, restoreWidth, settings.widget.expandedHeight || settings.widget.height);
    }
  }
  return settings.widget;
});

// 위젯의 전체숨김 버튼: 누를 때마다 4단계로 순환함 (태훈님 지정 동작)
// ①다 숨기기 → ②누르기 직전 상태로 복원 → ③다 보이기 → ④누르기 직전 상태로 복원 → 다시 ①
// "직전 상태"란 ①을 누르기 바로 전에 어떤 주제가 숨겨져 있었는지(스냅샷)를 말함.
// (수정) 예전엔 단순 켬/끔 토글이라, 다시 켤 때 일부러 숨겨둔 주제 메모까지 전부 켜지는 문제가 있었음
ipcMain.handle('memos:toggleVisibility', () => {
  const step = visibilityCycle % 4;
  if (step === 0) {
    // ① 지금 상태를 스냅샷으로 찍어두고 전부 숨김
    visibilitySnapshot = Array.from(hiddenTopicIds);
    allMemosHidden = true;
    memoWindows.forEach((win) => {
      win.webContents.send('memo:forceBlur'); // 숨기기 전 편집 포커스를 미리 해제
      win.hide();
    });
  } else if (step === 2) {
    // ③ 전부 보이기 (다시 보일 때 창을 활성화하지 않아 마지막 메모가 자동 편집상태로 뜨는 것 방지)
    allMemosHidden = false;
    hiddenTopicIds.clear();
    memoWindows.forEach((win) => {
      if (!win.isVisible()) showWindowAndNotify(win);
    });
  } else {
    // ②·④ 스냅샷(누르기 직전 상태)으로 복원
    allMemosHidden = false;
    hiddenTopicIds.clear();
    visibilitySnapshot.forEach((id) => hiddenTopicIds.add(id));
    applyVisibilityToWindows();
  }
  visibilityCycle = (visibilityCycle + 1) % 4;
  persistVisibilityState();
  return getVisibilityState();
});

// 위젯이 전체숨김 버튼 모양/툴팁을 그릴 때 현재 상태를 물어보는 조회용 API
ipcMain.handle('memos:getVisibilityState', () => getVisibilityState());

// (이전에 있던 주제별 숨기기 전용 버튼/IPC는 제거함 — 위젯 대시보드의 주제 더블클릭
// (memos:toggleTopicOpen)이 이제 같은 hiddenTopicIds를 이용해 열기/숨기기를 겸함)

// 대시보드에 눈 아이콘(감은눈/뜬눈)으로 숨김 상태만 "표시"하기 위한 조회용 API(클릭 동작 없음)
ipcMain.handle('memos:getHiddenTopics', () => Array.from(hiddenTopicIds));

// 대시보드 개별 메모 목록에도 눈 아이콘을 표시하기 위해, 지금 실제로 화면에 보이는(창이 있고 visible인)
// 메모 id 목록을 알려줌(조회용, 클릭 동작 없음)
ipcMain.handle('memos:getVisibleMemoIds', () => {
  const result = [];
  memoWindows.forEach((win, memoId) => {
    if (win.isVisible()) result.push(memoId);
  });
  return result;
});

// 주제별 항상위 토글: 그 주제의 모든 메모(열려있든 아니든)에 alwaysOnTop 값을 일괄 반영
ipcMain.handle('memos:toggleTopicAlwaysOnTop', (event, topicId) => {
  const nowPinned = !pinnedTopicIds.has(topicId);
  if (nowPinned) pinnedTopicIds.add(topicId);
  else pinnedTopicIds.delete(topicId);

  const memos = store.getMemos();
  memos.forEach((m) => {
    if (m.topicId === topicId) {
      m.alwaysOnTop = nowPinned;
      const win = memoWindows.get(m.id);
      if (win) win.setAlwaysOnTop(nowPinned);
    }
  });
  store.saveMemos(memos);
  broadcastMemosUpdated();
  return nowPinned;
});

ipcMain.handle('memos:getPinnedTopics', () => Array.from(pinnedTopicIds));

// (추가) 위젯에서 주제 버튼을 Ctrl+클릭하면 그 주제의 "지금 화면에 보이는" 메모창들을 다른
// 프로그램보다 앞으로 가져옴. 메모창은 평소 showWindowAndNotify()의 showInactive()로만
// 조용히 뜨기 때문에(포커스를 안 뺏으려고 일부러 이렇게 함) 다른 프로그램 창이 위에 있으면
// 그 뒤에 가려진 채로 안 나타나는데, 이 기능은 사용자가 원할 때만 예외적으로 맨 앞까지
// 끌어올려줌. (수정) 원래는 다시 누르면 뒤로 보내는 토글이었는데, blur()는 Windows에서
// 안 먹히는 경우가 많고 minimize()는 이 앱 창들이 skipTaskbar라 작업표시줄에도 안 남아서
// 완전히 꺼진 것처럼 보이는 부작용이 있어 태훈님 요청으로 뒤로 보내기는 빼고 "누를 때마다
// 무조건 앞으로 가져오기"만 남김(토글 아님, 항상위 핀과도 무관)
ipcMain.handle('memos:toggleTopicFront', (event, topicId) => {
  const memoIds = store.getMemos().filter((m) => m.topicId === topicId).map((m) => m.id);
  memoIds.forEach((memoId) => {
    const win = memoWindows.get(memoId);
    if (!win || win.isDestroyed()) return;
    if (!win.isVisible() && !win.isMinimized()) return; // 진짜 숨겨진(hide된) 메모는 제외
    if (win.isMinimized()) win.restore(); // 혹시 다른 방법(Win+D 등)으로 최소화돼있었으면 풀어줌
    win.moveTop();
    win.focus();
    // focus()만 하면 마지막으로 편집하던 텍스트 칸까지 같이 포커스를 받아서 커서가 깜빡이는
    // "편집 상태"로 딸려 나오는 문제가 있었음 — forceBlur로 그 부분만 바로 풀어줌
    win.webContents.send('memo:forceBlur');
  });
  return true;
});

// 첨부 이미지/파일 삭제: 메모 데이터에서 제거 + 본문의 ![[파일명]] 참조도 제거 + 실제 임시파일 삭제
ipcMain.handle('memos:removeAttachment', (event, { memoId, storedName }) => {
  const memos = store.getMemos();
  const idx = memos.findIndex((m) => m.id === memoId);
  if (idx === -1) return null;

  memos[idx].attachments = (memos[idx].attachments || []).filter(
    (a) => a.storedName !== storedName
  );
  // (0.19.2) 크기가 붙은 "![[파일명|400]]" 도 같이 지워야 함. 줄 전체와 뒤 줄바꿈까지 지워서
  // 그림이 있던 자리에 빈 줄이 남지 않게 함(캡션 줄은 글자이므로 일부러 남겨둠)
  const escaped = String(storedName).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  memos[idx].content = (memos[idx].content || '').replace(
    new RegExp(`[ \\t]*!\\[\\[${escaped}(\\|\\d+)?\\]\\][ \\t]*\\n?`, 'g'),
    ''
  );
  memos[idx].updatedAt = new Date().toISOString(); // 첨부도 MD내보내기에 포함되므로 갱신
  store.saveMemos(memos);

  try {
    const filePath = path.join(ATTACH_DIR(), storedName);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch (err) {
    console.error('첨부파일 삭제 실패:', err);
  }

  broadcastMemosUpdated();
  return memos[idx];
});

// 첨부 이미지의 표시 크기(사용자가 드래그로 조절한 값) 저장
ipcMain.handle('memos:updateAttachmentSize', (event, { memoId, storedName, width, height }) => {
  const memos = store.getMemos();
  const idx = memos.findIndex((m) => m.id === memoId);
  if (idx === -1) return null;
  const attachments = memos[idx].attachments || [];
  const a = attachments.find((x) => x.storedName === storedName);
  if (a) {
    a.displayWidth = Math.round(width);
    a.displayHeight = Math.round(height);
    store.saveMemos(memos);
  }
  return memos[idx];
});

// 첨부 이미지의 표시 위치(사용자가 그림판처럼 드래그로 옮긴 좌표) 저장
ipcMain.handle('memos:updateAttachmentPosition', (event, { memoId, storedName, x, y }) => {
  const memos = store.getMemos();
  const idx = memos.findIndex((m) => m.id === memoId);
  if (idx === -1) return null;
  const attachments = memos[idx].attachments || [];
  const a = attachments.find((x2) => x2.storedName === storedName);
  if (a) {
    a.displayX = Math.round(x);
    a.displayY = Math.round(y);
    store.saveMemos(memos);
  }
  return memos[idx];
});

// 이미지에 붙인 설명(캡션) 저장. 이미지와 한 덩어리로 같이 움직이는 짧은 텍스트라
// 본문(textarea)과는 별개로 첨부파일 데이터에 저장함
ipcMain.handle('memos:updateAttachmentCaption', (event, { memoId, storedName, caption }) => {
  const memos = store.getMemos();
  const idx = memos.findIndex((m) => m.id === memoId);
  if (idx === -1) return null;
  const attachments = memos[idx].attachments || [];
  const a = attachments.find((x) => x.storedName === storedName);
  if (a) {
    a.caption = caption || '';
    memos[idx].updatedAt = new Date().toISOString(); // 캡션도 MD내보내기에 포함되므로 갱신
    store.saveMemos(memos);
  }
  return memos[idx];
});

// 설명칸을 사용자가 모서리 드래그로 늘리거나 줄인 크기(너비/높이) 저장 (다음에 열 때도 그대로 유지되도록)
ipcMain.handle('memos:updateAttachmentCaptionSize', (event, { memoId, storedName, width, height }) => {
  const memos = store.getMemos();
  const idx = memos.findIndex((m) => m.id === memoId);
  if (idx === -1) return null;
  const attachments = memos[idx].attachments || [];
  const a = attachments.find((x) => x.storedName === storedName);
  if (a) {
    a.captionWidth = Math.round(width);
    a.captionHeight = Math.round(height);
    store.saveMemos(memos);
  }
  return memos[idx];
});

// 설명칸을 이미지와 별개로 원하는 위치로 드래그했을 때, 이미지 기준 상대좌표(offset)로 저장
// (절대좌표가 아니라 상대좌표라서, 이미지를 옮겨도 설명칸이 정해둔 자리를 그대로 유지한 채 같이 따라감)
ipcMain.handle('memos:updateAttachmentCaptionOffset', (event, { memoId, storedName, offsetX, offsetY }) => {
  const memos = store.getMemos();
  const idx = memos.findIndex((m) => m.id === memoId);
  if (idx === -1) return null;
  const attachments = memos[idx].attachments || [];
  const a = attachments.find((x) => x.storedName === storedName);
  if (a) {
    a.captionOffsetX = Math.round(offsetX);
    a.captionOffsetY = Math.round(offsetY);
    store.saveMemos(memos);
  }
  return memos[idx];
});

// 클립보드에 복사된 이미지를 첨부파일과 동일한 방식으로 저장
ipcMain.handle('attachments:saveFromClipboard', (event, { base64, ext }) => {
  const attachDir = ATTACH_DIR();
  const safeExt = (ext || '.png').toLowerCase();
  const storedName = `${randomUUID().slice(0, 8)}_붙여넣기${safeExt}`;
  const buffer = resizeImageBufferIfNeeded(Buffer.from(base64, 'base64'), safeExt);
  fs.writeFileSync(path.join(attachDir, storedName), buffer);
  return { storedName, originalName: `붙여넣기${safeExt}`, isImage: true };
});

// 이미지 그림그리기(선/화살표/번호) 결과로 기존 첨부 이미지 파일을 그대로 덮어씀.
// storedName(파일명)은 안 바뀌므로 memo.attachments 쪽 메타데이터는 손댈 필요 없음 — 파일 내용만 교체됨
ipcMain.handle('attachments:overwriteImage', (event, { storedName, base64 }) => {
  try {
    const attachDir = ATTACH_DIR();
    const ext = path.extname(storedName) || '.png';
    const buffer = resizeImageBufferIfNeeded(Buffer.from(base64, 'base64'), ext);
    fs.writeFileSync(path.join(attachDir, storedName), buffer);
    return true;
  } catch (err) {
    console.error('이미지 그림그리기 저장 실패:', err);
    return false;
  }
});

// 설정 화면의 "안 쓰는 첨부파일 정리" 버튼에서 호출. 지금 어디서도 안 쓰이는 파일을
// 찾아서 지우고, 몇 개를 지웠는지/전체 몇 개였는지 돌려줌
ipcMain.handle('attachments:sweepOrphans', () => sweepOrphanAttachments());

