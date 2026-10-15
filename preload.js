const { contextBridge, ipcRenderer, webUtils } = require('electron');

// 알람 소리: 메인 프로세스가 'alarm:playSound'를 이 창으로 보내면 짧은 "딩동" 소리를 냄.
// 창 웹오디오로 직접 재생하므로 별도 음원 파일이 필요 없음(창의 autoplayPolicy 허용 필요).
let _alarmAudioCtx = null;
ipcRenderer.on('alarm:playSound', () => {
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    if (!_alarmAudioCtx) _alarmAudioCtx = new AC();
    const ctx = _alarmAudioCtx;
    if (ctx.state === 'suspended') ctx.resume();
    const t0 = ctx.currentTime;
    [[880, 0], [1174.66, 0.18]].forEach(([freq, dt]) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      const s = t0 + dt;
      gain.gain.setValueAtTime(0.0001, s);
      gain.gain.exponentialRampToValueAtTime(0.25, s + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, s + 0.35);
      osc.connect(gain).connect(ctx.destination);
      osc.start(s);
      osc.stop(s + 0.36);
    });
  } catch (e) { /* 소리 실패는 조용히 무시(알림/메모창 방식은 그대로 동작) */ }
});

contextBridge.exposeInMainWorld('api', {
  // 설정
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (settings) => ipcRenderer.invoke('settings:save', settings),
  chooseVaultFolder: () => ipcRenderer.invoke('settings:chooseVaultFolder'),
  chooseBackupFolder: () => ipcRenderer.invoke('settings:chooseBackupFolder'),
  getScreenWorkArea: () => ipcRenderer.invoke('screen:getWorkArea'),
  getAppVersion: () => ipcRenderer.invoke('app:getVersion'),
  // 설치본인지 테스트 실행(npm start)인지 — 설정 화면의 자동 실행 안내에 씀 (0.20.2)
  isPackaged: () => ipcRenderer.invoke('app:isPackaged'),

  // 주제
  getTopics: () => ipcRenderer.invoke('topics:getAll'),
  addTopic: (topic) => ipcRenderer.invoke('topics:add', topic),
  updateTopic: (topic) => ipcRenderer.invoke('topics:update', topic),
  deleteTopic: (topicId) => ipcRenderer.invoke('topics:delete', topicId),
  reorderTopics: (orderedIds) => ipcRenderer.invoke('topics:reorder', orderedIds),

  // 카테고리(상위주제) — 실제 메모가 딸린 주제와 별개인 이름표 목록
  getCategories: () => ipcRenderer.invoke('categories:getAll'),
  addCategory: (category) => ipcRenderer.invoke('categories:add', category),
  updateCategory: (category) => ipcRenderer.invoke('categories:update', category),
  deleteCategory: (categoryId) => ipcRenderer.invoke('categories:delete', categoryId),
  setCategoryHidden: (categoryName, hidden) =>
    ipcRenderer.invoke('topics:setCategoryHidden', { categoryName, hidden }),

  // 메모
  getAllMemos: () => ipcRenderer.invoke('memos:getAll'),
  getMemosByTopic: (topicId) => ipcRenderer.invoke('memos:getByTopic', topicId),
  createNewMemo: (topicId) => ipcRenderer.invoke('memos:createNew', topicId),
  // 달력에서 제목만 치고 엔터 → 메모창 없이 바로 일정 만들기 (0.20.0)
  // (0.21.0) 이제 메모가 아니라 일정 파일(events.json)에 저장됨
  createCalendarSchedule: (dateKey, time, title) =>
    ipcRenderer.invoke('calendar:createSchedule', { dateKey, time, title }),
  // 달력 일정(0.21.0): 메모와 분리된 일정 전용 통로
  listEvents: () => ipcRenderer.invoke('events:list'),
  createEvent: (payload) => ipcRenderer.invoke('events:create', payload),
  updateEvent: (id, patch) => ipcRenderer.invoke('events:update', { id, patch }),
  setEventTime: (id, time) => ipcRenderer.invoke('events:setTime', { id, time }),
  deleteEvent: (id) => ipcRenderer.invoke('events:delete', id),
  onEventsUpdated: (callback) => ipcRenderer.on('events:updated', () => callback()),
  onCalendarOpenEvent: (callback) => ipcRenderer.on('calendar:openEvent', (e, id) => callback(id)),
  // (0.22.0) 구글 캘린더 동기화 — 설정 > 일반 > 구글 캘린더
  googleGetStatus: () => ipcRenderer.invoke('google:getStatus'),
  googleChooseClientFile: () => ipcRenderer.invoke('google:chooseClientFile'),
  googleConnect: () => ipcRenderer.invoke('google:connect'),
  googleDisconnect: () => ipcRenderer.invoke('google:disconnect'),
  googleSyncNow: () => ipcRenderer.invoke('google:syncNow'),
  googleSetInterval: (minutes) => ipcRenderer.invoke('google:setInterval', minutes),
  onGoogleStatus: (callback) => ipcRenderer.on('google:status', (e, status) => callback(status)),
  // 달력 목록에서 시각만 그 자리에서 고칠 때 (0.20.1). 날짜는 그대로 두고 "HH:mm"만 갈아끼움
  setCalendarScheduleTime: (memoId, time) =>
    ipcRenderer.invoke('calendar:setScheduleTime', { memoId, time }),
  updateMemoContent: (memoId, content) =>
    ipcRenderer.invoke('memos:updateContent', { memoId, content }),
  setPostSaveAction: (memoId, action) =>
    ipcRenderer.invoke('memos:setPostSaveAction', { memoId, action }),
  setMemoTitle: (memoId, title) => ipcRenderer.invoke('memos:setTitle', { memoId, title }),
  setMemoScheduleAt: (memoId, scheduleAt) =>
    ipcRenderer.invoke('memos:setScheduleAt', { memoId, scheduleAt }),
  setMemoUseCalendar: (memoId, useCalendar) =>
    ipcRenderer.invoke('memos:setUseCalendar', { memoId, useCalendar }),
  setMemoAlarm: (memoId, alarm) =>
    ipcRenderer.invoke('memos:setAlarm', { memoId, alarm }),
  setAlwaysOnTop: (memoId, value) =>
    ipcRenderer.invoke('memos:setAlwaysOnTop', { memoId, value }),
  setMemoCollapsed: (memoId, value) =>
    ipcRenderer.invoke('memos:setCollapsed', { memoId, value }),
  setMemoColor: (memoId, color) => ipcRenderer.invoke('memos:setColor', { memoId, color }),
  moveMemoToTopic: (memoId, topicId) => ipcRenderer.invoke('memos:setTopic', { memoId, topicId }),
  saveMemoAsTemplate: (memoId, topicId) =>
    ipcRenderer.invoke('memos:saveAsTemplate', { memoId, topicId }),
  setMemoChecklist: (memoId, checklist) =>
    ipcRenderer.invoke('memos:setChecklist', { memoId, checklist }),
  setMemoTables: (memoId, tables) =>
    ipcRenderer.invoke('memos:setTables', { memoId, tables }),
  addAttachment: (memoId, attachment) =>
    ipcRenderer.invoke('memos:addAttachment', { memoId, attachment }),
  pickAttachments: () => ipcRenderer.invoke('attachments:pick'),
  getAttachmentPath: (storedName) => ipcRenderer.invoke('attachments:getPath', storedName),
  exportTxt: (content, suggestedName) =>
    ipcRenderer.invoke('files:exportTxt', { content, suggestedName }),
  importTextFile: () => ipcRenderer.invoke('files:importTextFile'),
  deleteMemo: (memoId) => ipcRenderer.invoke('memos:delete', memoId),
  openExistingMemo: (memoId) => ipcRenderer.invoke('memos:openExisting', memoId),
  toggleMemoOpen: (memoId) => ipcRenderer.invoke('memos:toggleOpen', memoId),
  toggleTopicOpen: (topicId) => ipcRenderer.invoke('memos:toggleTopicOpen', topicId),
  removeAttachment: (memoId, storedName) =>
    ipcRenderer.invoke('memos:removeAttachment', { memoId, storedName }),
  updateAttachmentSize: (memoId, storedName, width, height) =>
    ipcRenderer.invoke('memos:updateAttachmentSize', { memoId, storedName, width, height }),
  updateAttachmentPosition: (memoId, storedName, x, y) =>
    ipcRenderer.invoke('memos:updateAttachmentPosition', { memoId, storedName, x, y }),
  updateAttachmentCaption: (memoId, storedName, caption) =>
    ipcRenderer.invoke('memos:updateAttachmentCaption', { memoId, storedName, caption }),
  updateAttachmentCaptionSize: (memoId, storedName, width, height) =>
    ipcRenderer.invoke('memos:updateAttachmentCaptionSize', { memoId, storedName, width, height }),
  updateAttachmentCaptionOffset: (memoId, storedName, offsetX, offsetY) =>
    ipcRenderer.invoke('memos:updateAttachmentCaptionOffset', { memoId, storedName, offsetX, offsetY }),
  saveClipboardImage: (base64, ext) =>
    ipcRenderer.invoke('attachments:saveFromClipboard', { base64, ext }),
  overwriteAttachmentImage: (storedName, base64) =>
    ipcRenderer.invoke('attachments:overwriteImage', { storedName, base64 }),
  toggleAllMemosVisibility: () => ipcRenderer.invoke('memos:toggleVisibility'),
  getVisibilityState: () => ipcRenderer.invoke('memos:getVisibilityState'),
  getHiddenTopics: () => ipcRenderer.invoke('memos:getHiddenTopics'),
  getVisibleMemoIds: () => ipcRenderer.invoke('memos:getVisibleMemoIds'),
  toggleTopicAlwaysOnTop: (topicId) => ipcRenderer.invoke('memos:toggleTopicAlwaysOnTop', topicId),
  getPinnedTopics: () => ipcRenderer.invoke('memos:getPinnedTopics'),
  toggleTopicFront: (topicId) => ipcRenderer.invoke('memos:toggleTopicFront', topicId),
  addAttachmentsFromPaths: (paths) => ipcRenderer.invoke('attachments:addFromPaths', paths),
  copyText: (text) => ipcRenderer.invoke('app:copyText', text),
  pasteText: () => ipcRenderer.invoke('app:pasteText'),
  copyTable: (text, html) => ipcRenderer.invoke('app:copyTable', { text, html }),
  pasteTable: () => ipcRenderer.invoke('app:pasteTable'),
  exportAllMemos: () => ipcRenderer.invoke('memos:exportAll'),
  restoreFromBackup: () => ipcRenderer.invoke('memos:restoreFromBackup'),
  sweepOrphanAttachments: () => ipcRenderer.invoke('attachments:sweepOrphans'),

  // 휴지통
  getTrash: () => ipcRenderer.invoke('trash:list'),
  restoreFromTrash: (memoId) => ipcRenderer.invoke('trash:restore', memoId),
  permanentlyDeleteFromTrash: (memoId) => ipcRenderer.invoke('trash:permanentDelete', memoId),
  emptyTrash: () => ipcRenderer.invoke('trash:empty'),

  // 옵시디언
  exportToObsidian: (memoId, customFileName, extraTags) =>
    ipcRenderer.invoke('obsidian:export', { memoId, customFileName, extraTags }),
  suggestObsidianFileName: (memoId) => ipcRenderer.invoke('obsidian:suggestFileName', memoId),
  getExportLog: () => ipcRenderer.invoke('obsidian:getExportLog'),

  // 창 제어
  closeMemoWindow: (memoId) => ipcRenderer.invoke('window:closeMemo', memoId),
  openSettingsWindow: () => ipcRenderer.invoke('window:openSettings'),
  // (0.23.0) 달력 설정 전용 창. tab을 주면 그 메뉴부터('cal'|'look'|'ledger'|'google')
  openCalendarSettingsWindow: (tab) => ipcRenderer.invoke('window:openCalendarSettings', tab),
  onCalendarSettingsTab: (callback) => ipcRenderer.on('calSettings:tab', (e, tab) => callback(tab)),
  // 달력 설정 창 → 달력 위에 진행 띠 설정 띄우기 / 달력 쪽에서 그 신호 받기
  openProgressSettingsInCalendar: () => ipcRenderer.invoke('calendar:openProgressSettings'),
  onOpenProgressSettings: (callback) => ipcRenderer.on('calendar:openProgressSettings', () => callback()),
  openWidgetWindow: () => ipcRenderer.invoke('window:openWidget'),
  openCalendarWindow: () => ipcRenderer.invoke('window:openCalendar'),
  // 날짜들("YYYY-MM-DD" 배열)의 음력 날짜를 한꺼번에 받아옴(달력창 음력 표시용)
  getLunarMap: (dateKeys) => ipcRenderer.invoke('calendar:getLunarMap', dateKeys),
  // 어떤 연도의 공휴일을 받아옴({ "YYYY-MM-DD": "이름" }) — 특일정보 API, 결과는 메인이 캐시
  getHolidays: (year) => ipcRenderer.invoke('calendar:getHolidays', year),
  // 달력 잠금/활성화(더블클릭으로 활성화, 포커스 잃으면 자동 잠금)
  setCalendarActive: (active) => ipcRenderer.invoke('calendar:setActive', active),
  // 달력창 ⚙️ 설정 저장(settings.calendar만 병합 저장)
  saveCalendarSettings: (cal) => ipcRenderer.invoke('calendar:saveSettings', cal),
  onCalendarActiveChanged: (callback) =>
    ipcRenderer.on('calendar:activeChanged', (e, active) => callback(active)),
  // 가계부(달력 가계부 모드): 분류+지출 기록. 메모와 별개인 ledger.json 사용
  getLedger: () => ipcRenderer.invoke('ledger:get'),
  addLedgerEntry: (entry) => ipcRenderer.invoke('ledger:addEntry', entry),
  updateLedgerEntry: (entry) => ipcRenderer.invoke('ledger:updateEntry', entry),
  deleteLedgerEntry: (entryId) => ipcRenderer.invoke('ledger:deleteEntry', entryId),
  saveLedgerCategories: (categories) => ipcRenderer.invoke('ledger:saveCategories', categories),
  // 가계부 설정(월급날·예산·고정지출) — ledger.json의 settings만 병합 저장
  saveLedgerSettings: (patch) => ipcRenderer.invoke('ledger:saveSettings', patch),
  // 위트 멘트 문구 읽기 / 멘트.json 파일을 메모장으로 열기
  getLedgerMents: () => ipcRenderer.invoke('ledger:getMents'),
  openLedgerMentsFile: () => ipcRenderer.invoke('ledger:openMentsFile'),
  // 가계부 전체 기록을 CSV(엑셀용)로 저장
  exportLedgerCsv: () => ipcRenderer.invoke('ledger:exportCsv'),
  onLedgerUpdated: (callback) => ipcRenderer.on('ledger:updated', () => callback()),
  // page를 주면 설명서의 그 메뉴부터 엶('start'|'widget'|'memo'|'obsidian'|'calendar'|'ledger'|'settings'|'faq')
  openHelpWindow: (page) => ipcRenderer.invoke('window:openHelp', page),
  refocusSelf: () => ipcRenderer.invoke('window:refocusSelf'),
  resizeWidget: (width, height) => ipcRenderer.invoke('widget:resize', { width, height }),
  setWidgetAlwaysOnTop: (value) => ipcRenderer.invoke('widget:setAlwaysOnTop', value),
  setWidgetCollapsed: (value) => ipcRenderer.invoke('widget:setCollapsed', value),
  setWidgetHandleOnly: (value) => ipcRenderer.invoke('widget:setHandleOnly', value),
  openMemoLinkWindow: (memoId) => ipcRenderer.invoke('window:openMemoLink', memoId),
  closeMemoLinkWindow: () => ipcRenderer.invoke('window:closeMemoLink'),
  chooseMemoLink: (fileNameNoExt) => ipcRenderer.invoke('memoLink:choose', fileNameNoExt),
  openMoveTopicWindow: (memoId) => ipcRenderer.invoke('window:openMoveTopic', memoId),
  closeMoveTopicWindow: () => ipcRenderer.invoke('window:closeMoveTopic'),
  getMoveTopicData: () => ipcRenderer.invoke('moveTopic:getData'),
  chooseMoveTopic: (topicId) => ipcRenderer.invoke('moveTopic:choose', topicId),
  openSearchWindow: () => ipcRenderer.invoke('window:openSearch'),
  closeSearchWindow: () => ipcRenderer.invoke('window:closeSearch'),
  chooseSearchResult: (memoId) => ipcRenderer.invoke('search:choose', memoId),

  // 메인 -> 렌더러 이벤트 구독
  onMemoInit: (callback) => ipcRenderer.on('memo:init', (e, memo) => callback(memo)),
  onTopicsUpdated: (callback) => ipcRenderer.on('topics:updated', () => callback()),
  onMemosUpdated: (callback) => ipcRenderer.on('memos:updated', () => callback()),
  onSettingsOpened: (callback) => ipcRenderer.on('app:settingsOpened', () => callback()),
  onSettingsClosed: (callback) => ipcRenderer.on('app:settingsClosed', () => callback()),
  onWelcomeOpened: (callback) => ipcRenderer.on('app:welcomeOpened', () => callback()),
  onWelcomeClosed: (callback) => ipcRenderer.on('app:welcomeClosed', () => callback()),
  onSettingsUpdated: (callback) => ipcRenderer.on('settings:updated', () => callback()),
  onWidgetSizeChanged: (callback) =>
    ipcRenderer.on('widget:sizeChanged', (e, data) => callback(data)),
  onScreenWorkAreaChanged: (callback) =>
    ipcRenderer.on('screen:workAreaChanged', (e, workArea) => callback(workArea)),
  onForceBlur: (callback) => ipcRenderer.on('memo:forceBlur', () => callback()),
  onMemoColorSync: (callback) => ipcRenderer.on('memo:colorSync', (e, color) => callback(color)),
  onMemoLinkSelected: (callback) =>
    ipcRenderer.on('memoLink:selected', (e, fileNameNoExt) => callback(fileNameNoExt)),
  onMoveTopicSelected: (callback) =>
    ipcRenderer.on('moveTopic:selected', (e, topicId) => callback(topicId))
});

// (2026-10-13) 바탕화면 정리 박스 — 박스 창, 설정창 "바탕화면 정리" 메뉴, 위젯 📦 버튼이 씀.
// 기존 api 와 섞이지 않게 이름을 boxApi 로 따로 둠
contextBridge.exposeInMainWorld('boxApi', {
  // 박스 창
  list: () => ipcRenderer.invoke('box:list'),
  open: (p) => ipcRenderer.invoke('box:open', p),
  moveIn: (paths) => ipcRenderer.invoke('box:moveIn', paths),
  dropAt: (paths, anchor, after) => ipcRenderer.invoke('box:dropAt', { paths, anchor, after: !!after }), // (10차) 직접 정렬
  // 끌어넣은 파일의 실제 경로(Electron 32부터 file.path 가 없어져서 webUtils 를 먼저 씀)
  pathForFile: (file) => {
    try { return (webUtils && webUtils.getPathForFile(file)) || file.path || ''; } catch (e) { return (file && file.path) || ''; }
  },
  startDrag: (paths) => ipcRenderer.send('box:startDrag', paths),
  dragStart: () => ipcRenderer.send('box:dragStart'),
  dragMove: () => ipcRenderer.send('box:dragMove'),
  dragEnd: () => ipcRenderer.send('box:dragEnd'),
  // (7차) 탭 끌어서 묶기·빼기, 받는 쪽 강조, 폴더 창 "탐색기에서 보기 / 전부 보기"
  tabDragStart: (boxId) => ipcRenderer.send('box:tabDragStart', boxId),
  tabDragMove: () => ipcRenderer.invoke('box:tabDragMove'),
  tabDragEnd: (cancel) => ipcRenderer.invoke('box:tabDragEnd', !!cancel),
  reorderTabs: (ids) => ipcRenderer.invoke('box:reorderTabs', ids), // (11차) 묶음 안 탭 순서
  onMergeHint: (cb) => ipcRenderer.on('box:mergeHint', (e, v) => cb(!!v)),
  openFolderSelf: () => ipcRenderer.invoke('box:openFolderSelf'),
  setIconSize: (n) => ipcRenderer.invoke('box:setIconSize', n),
  resizeStart: () => ipcRenderer.send('box:resizeStart'),
  resizeMove: () => ipcRenderer.send('box:resizeMove'),
  resizeEnd: () => ipcRenderer.send('box:resizeEnd'),
  setExpanded: (v) => ipcRenderer.invoke('box:setExpanded', v),
  toggleCollapsed: () => ipcRenderer.invoke('box:toggleCollapsed'),
  itemMenu: (paths) => ipcRenderer.invoke('box:itemMenu', paths),
  trash: (paths) => ipcRenderer.invoke('box:trash', paths), // (11차) 휴지통으로
  boxMenu: (boxId) => ipcRenderer.invoke('box:boxMenu', boxId || null),
  setActive: (boxId) => ipcRenderer.invoke('box:setActive', boxId),
  moveInTo: (boxId, paths) => ipcRenderer.invoke('box:moveInTo', { boxId, paths }),
  closeSelf: () => ipcRenderer.invoke('box:closeSelf'),
  changeFolderSelf: () => ipcRenderer.invoke('box:changeFolderSelf'),
  onChanged: (cb) => ipcRenderer.on('box:changed', () => cb()),
  onExpanded: (cb) => ipcRenderer.on('box:expanded', (e, v) => cb(v)),
  onFaded: (cb) => ipcRenderer.on('box:faded', (e, v) => cb(!!v)), // (9차) 접힌 제목줄 숨김/다시 보임
  wake: () => ipcRenderer.send('box:wake'), // (11차) 숨은 창 위에 마우스가 올라옴 → 바로 보이게
  activate: () => ipcRenderer.send('box:activate'), // (11차) 정리함 안을 누름 → 앞으로 + 키보드(Delete 키)
  onToast: (cb) => ipcRenderer.on('box:toast', (e, t) => cb(t)),
  // 설정창
  getAll: () => ipcRenderer.invoke('box:getAll'),
  getOptions: () => ipcRenderer.invoke('box:getOptions'),
  create: (name, how) => ipcRenderer.invoke('box:create', name, how || null),
  getKnown: () => ipcRenderer.invoke('box:getKnown'),
  linkKnown: (key) => ipcRenderer.invoke('box:linkKnown', key),
  link: () => ipcRenderer.invoke('box:link'),
  remove: (id) => ipcRenderer.invoke('box:remove', id),
  update: (id, patch) => ipcRenderer.invoke('box:update', { id, patch }),
  changeFolder: (id) => ipcRenderer.invoke('box:changeFolder', id),
  openFolder: (id) => ipcRenderer.invoke('box:openFolder', id),
  openWindow: (id) => ipcRenderer.invoke('box:openWindow', id),
  onListChanged: (cb) => ipcRenderer.on('box:listChanged', () => cb()),
  onShowTab: (cb) => ipcRenderer.on('box:showTab', () => cb()),
  settingsTouched: () => ipcRenderer.send('box:settingsTouched'), // (10차) ⋯로 연 설정창 자동 닫기 끄기
  // 위젯
  showWidgetMenu: () => ipcRenderer.invoke('box:widgetMenu'),
  // (4차) 공통 스타일
  getStyle: () => ipcRenderer.invoke('box:getStyle'),
  setDefault: (id, on) => ipcRenderer.invoke('box:setDefault', { id, on }),
  setGroup: (id, groupId) => ipcRenderer.invoke('box:setGroup', { id, groupId }),
  setStyle: (patch) => ipcRenderer.invoke('box:setStyle', patch)
});

// (2026-10-13) 자동 정리 — 설정창 > 바탕화면 정리 > 자동 정리
contextBridge.exposeInMainWorld('orgApi', {
  get: () => ipcRenderer.invoke('organizer:get'),
  save: (patch) => ipcRenderer.invoke('organizer:save', patch),
  resetRules: () => ipcRenderer.invoke('organizer:resetRules'),
  addFolder: () => ipcRenderer.invoke('organizer:addFolder'),
  removeFolder: (folder) => ipcRenderer.invoke('organizer:removeFolder', folder),
  preview: () => ipcRenderer.invoke('organizer:preview'),
  runNow: () => ipcRenderer.invoke('organizer:runNow'),
  getLog: () => ipcRenderer.invoke('organizer:getLog'),
  undo: (ids) => ipcRenderer.invoke('organizer:undo', ids),
  onLogChanged: (cb) => ipcRenderer.on('organizer:logChanged', () => cb())
});
