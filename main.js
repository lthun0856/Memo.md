const { app, BrowserWindow, Tray, Menu, ipcMain, dialog, screen, clipboard, globalShortcut, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const { randomUUID } = require('crypto');
const store = require('./src/store');
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
let settingsWindow = null;
let welcomeWindow = null;
let memoLinkWindow = null; // "메모 연결" 검색 팝업(메모지 크기에 안 갇히게 별도 작은 창으로 뜸)
let memoLinkTargetMemoId = null; // 팝업에서 고른 링크를 어느 메모창에 꽂아줄지 기억해둠
let searchWindow = null; // 위젯 🔍 검색 팝업(메모 연결 팝업과 같은 방식의 별도 작은 창)
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
      contextIsolation: true
    }
  });

  win.loadFile(path.join(__dirname, 'renderer', 'memo', 'index.html'));

  win.webContents.on('did-finish-load', () => {
    win.webContents.send('memo:init', memo);
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
    // 메모창이 닫히면 위젯의 "열림/숨김" 표시 아이콘이 최신 상태를 반영하도록 새로고침 신호를 보냄
    if (widgetWindow) widgetWindow.webContents.send('memos:updated');
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
    if (widgetWindow) widgetWindow.webContents.send('memos:updated');
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
    resizable: true,
    maximizable: false, // 타이틀바(드래그 영역) 더블클릭시 전체화면으로 "터지는" 것 방지 — 위젯은 전체화면일 필요가 없음
    skipTaskbar: true,
    opacity: currentOpacity(),
    icon: ICON_PATH,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true
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
    widgetWindow.webContents.send('screen:workAreaChanged', { width: work.width, height: work.height });
  });
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
    skipTaskbar: true,
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
    postSaveAction: null, // null 이면 설정 기본값 따름, 'override' 면 기본값의 반대 (옵시디언으로 보낸 후 동작)
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
  createMemoWindow(memo, { forceVisible: true });
  // (수정) 예전엔 여기서 위젯에 알림을 안 보내서, 새 메모 만든 직후엔 위젯 목록에
  // 바로 안 보이고 뭔가 입력해야(제목 등) 그때서야 반영되는 약간의 지연이 있었음
  if (widgetWindow) widgetWindow.webContents.send('memos:updated');
  return memo;
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
  } catch (err) {
    console.error('자동 백업 실패:', err);
    return; // 실패하면 lastRunAt을 안 남겨서 다음 체크 때 다시 시도하게 함
  }

  const latest = store.getSettings();
  latest.autoBackup = { ...latest.autoBackup, lastRunAt: new Date().toISOString() };
  store.saveSettings(latest);
}

// ---------- 앱 시작 ----------

app.whenReady().then(() => {
  // 이중 실행으로 판정돼 종료 중인 앱이 트레이/창을 만들지 않게 함(위 requestSingleInstanceLock 참고)
  if (!gotSingleInstanceLock) return;
  seedInitialDataIfNeeded();

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

  // 휴지통 보관기한(60일) 지난 항목 정리 — 앱 켤 때 한 번만 확인
  cleanupExpiredTrash();

  // 자동 백업: 시작할 때 한 번 확인하고, 이후엔 프로그램이 켜져있는 동안 한 시간마다
  // "지금이 백업할 때인지" 다시 확인함(정확한 그 시각이 아니라 최대 1시간 오차 안에서 실행됨)
  maybeRunAutoBackup({ isLaunch: true });
  setInterval(() => maybeRunAutoBackup({ isLaunch: false }), 60 * 60 * 1000);
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

// 위젯이 화면 밖으로 넘어갈 만큼 커지지 않도록, 위젯 자동크기 계산에 쓸 화면 크기를 알려줌
// (수정) 예전엔 항상 1번 모니터(주 모니터) 크기로 알려줘서, 위젯을 다른(특히 더 작은) 모니터에
// 두고 쓰면 그 모니터보다 크게 자동 확장될 수 있었음 — 위젯이 지금 실제로 있는 모니터 기준으로 알려주도록 바꿈
ipcMain.handle('screen:getWorkArea', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const b = win ? win.getBounds() : null;
  const work = b ? screen.getDisplayNearestPoint({ x: b.x, y: b.y }).workArea : screen.getPrimaryDisplay().workArea;
  return { width: work.width, height: work.height };
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
    autoBackup: { ...current.autoBackup, ...incoming.autoBackup }
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

  // 위젯 상단바 색상, 특수문자 목록 등 렌더러가 반영해야 할 값이 바뀌었을 수 있으니 새로고침 신호
  if (widgetWindow) widgetWindow.webContents.send('settings:updated');
  memoWindows.forEach((w) => w.webContents.send('settings:updated'));

  return saved;
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
  if (widgetWindow) widgetWindow.webContents.send('topics:updated');
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
  if (widgetWindow) widgetWindow.webContents.send('topics:updated');
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
  if (widgetWindow) widgetWindow.webContents.send('topics:updated');
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
  if (widgetWindow) widgetWindow.webContents.send('topics:updated');
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

  if (widgetWindow) widgetWindow.webContents.send('memos:updated');
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
  if (widgetWindow) widgetWindow.webContents.send('topics:updated');
  return topics[idx];
});

// ---------- IPC: 카테고리(상위주제) ----------
// 실제 메모가 딸린 "주제"와는 별개인, 이름표 목록. 주제 만들 때 상위주제 드롭다운을 채우는 용도.

ipcMain.handle('categories:getAll', () => store.getCategories());

ipcMain.handle('categories:add', (event, category) => {
  const categories = store.getCategories();
  const newCategory = { id: randomUUID(), name: String(category.name || '').trim() };
  categories.push(newCategory);
  store.saveCategories(categories);
  return newCategory;
});

ipcMain.handle('categories:delete', (event, categoryId) => {
  const categories = store.getCategories().filter((c) => c.id !== categoryId);
  store.saveCategories(categories);
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

ipcMain.handle('memos:createNew', (event, topicId) => {
  if (settingsWindow) return null; // 설정창이 열려있는 동안은 새 메모 생성을 막음
  return createNewMemo(topicId);
});

ipcMain.handle('memos:updateContent', (event, { memoId, content }) => {
  const memos = store.getMemos();
  const idx = memos.findIndex((m) => m.id === memoId);
  if (idx === -1) return null;
  memos[idx].content = content;
  memos[idx].updatedAt = new Date().toISOString();
  store.saveMemos(memos);
  if (widgetWindow) widgetWindow.webContents.send('memos:updated');
  return memos[idx];
});

ipcMain.handle('memos:setTitle', (event, { memoId, title }) => {
  const memos = store.getMemos();
  const idx = memos.findIndex((m) => m.id === memoId);
  if (idx === -1) return null;
  memos[idx].title = title || '';
  store.saveMemos(memos);
  if (widgetWindow) widgetWindow.webContents.send('memos:updated');
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
  if (widgetWindow) widgetWindow.webContents.send('memos:updated');
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
  if (widgetWindow) widgetWindow.webContents.send('memos:updated');
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
    if (widgetWindow) widgetWindow.webContents.send('memos:updated');
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
      if (widgetWindow) widgetWindow.webContents.send('memos:updated');
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
  if (widgetWindow) widgetWindow.webContents.send('memos:updated');
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
    if (widgetWindow) widgetWindow.webContents.send('memos:updated');
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
  if (widgetWindow) widgetWindow.webContents.send('memos:updated');
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
  if (widgetWindow) widgetWindow.webContents.send('memos:updated');
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
  if (widgetWindow) widgetWindow.webContents.send('memos:updated');
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
  return { canceled: false, ...result };
});

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

  // 하위 폴더까지 전부 뒤져서 .md / .txt 파일을 다 찾음("첨부" 폴더는 이미지 원본 폴더라 제외)
  const files = [];
  function walk(dir) {
    fs.readdirSync(dir, { withFileTypes: true }).forEach((entry) => {
      if (entry.isDirectory() && entry.name === '첨부') return;
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
  if (widgetWindow) widgetWindow.webContents.send('topics:updated');
  if (widgetWindow) widgetWindow.webContents.send('memos:updated');

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
    rule: settings.exportNameRule
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
    attachDir: ATTACH_DIR(),
    overwritePath: memo.obsidian && memo.obsidian.filePath ? memo.obsidian.filePath : undefined
  });

  // exportedVersion에 지금 시점의 updatedAt을 같이 저장해둠 — 렌더러(memo.js)가 나중에
  // "이 메모, 내보낸 뒤로 수정된 적 있나?"를 memo.updatedAt과 비교해서 판단할 수 있게 됨
  // (MD내보내기 버튼을 흐리게 바꿨다가 실제 수정이 생기면 다시 눌리게 하는 기준)
  memo.obsidian = { saved: true, filePath, exportedVersion: memo.updatedAt || null };
  store.saveMemos(memos);
  if (widgetWindow) widgetWindow.webContents.send('memos:updated');

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
ipcMain.handle('window:openHelp', () => createHelpWindow());

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

ipcMain.handle('widget:resize', (event, { width, height }) => {
  const settings = store.getSettings();
  if (!widgetWindow || !settings.widget.autoResize) return;
  if (settings.widget.collapsed) {
    // 접힘 상태에서도 폭(주제 버튼 개수에 맞춤)은 자동 조절 허용, 높이는 항상 접힘 높이로 고정
    widgetWindow.setSize(Math.round(width), WIDGET_COLLAPSED_HEIGHT);
  } else {
    widgetWindow.setSize(Math.round(width), Math.round(height));
  }
});

// 위젯 자체 항상위 on/off
ipcMain.handle('widget:setAlwaysOnTop', (event, value) => {
  const settings = store.getSettings();
  settings.widget.alwaysOnTop = !!value;
  store.saveSettings(settings);
  if (widgetWindow) widgetWindow.setAlwaysOnTop(!!value);
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
      widgetWindow.setSize(width, WIDGET_COLLAPSED_HEIGHT);
    } else {
      // 펼 땐 접힘 상태에서 자동으로 늘어나 있던 폭이 아니라, 펼친 상태의 "진짜" 폭으로 복원
      const restoreWidth = settings.widget.expandedWidth || settings.widget.width;
      widgetWindow.setSize(restoreWidth, settings.widget.expandedHeight || settings.widget.height);
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
  if (widgetWindow) widgetWindow.webContents.send('memos:updated');
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
  memos[idx].content = (memos[idx].content || '').split(`![[${storedName}]]`).join('');
  memos[idx].updatedAt = new Date().toISOString(); // 첨부도 MD내보내기에 포함되므로 갱신
  store.saveMemos(memos);

  try {
    const filePath = path.join(ATTACH_DIR(), storedName);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch (err) {
    console.error('첨부파일 삭제 실패:', err);
  }

  if (widgetWindow) widgetWindow.webContents.send('memos:updated');
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

// 설정 화면의 "안 쓰는 첨부파일 정리" 버튼에서 호출. 지금 어디서도 안 쓰이는 파일을
// 찾아서 지우고, 몇 개를 지웠는지/전체 몇 개였는지 돌려줌
ipcMain.handle('attachments:sweepOrphans', () => sweepOrphanAttachments());

