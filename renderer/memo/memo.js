let memo = null;
let saveTimer = null;
let confirmMemoDelete = true;
let autoExportObsidian = false; // true면 MD내보내기 누를 때 파일명 확인창 없이 바로 저장
let mdFeatureEnabled = true; // MD/옵시디언 관련 기능(서식버튼, 메모연결, MD내보내기, 처리방식버튼) 전체 on/off
let hasSeenImageResizeNotice = false; // 이미지 자동 리사이즈 안내를 이미 봤는지(첫 이미지 삽입 때 한 번만 안내)

const els = {
  // (1.18.0) 본문은 이제 contenteditable div. createMdEditor가 textarea처럼 쓸 수 있게
  // 감싸주기 때문에 아래 코드들(.value / .selectionStart / .setRangeText ...)은 그대로 동작함
  content: createMdEditor(document.getElementById('content')),
  contentEl: document.getElementById('content'),
  highlightPalette: document.getElementById('highlightPalette'),
  topicChip: document.getElementById('topicChip'),
  titleInput: document.getElementById('titleInput'),
  statusText: document.getElementById('statusText'),
  btnExport: document.getElementById('btnExport'),
  btnExportTxt: document.getElementById('btnExportTxt'),
  btnImport: document.getElementById('btnImport'),
  btnClose: document.getElementById('btnClose'),
  btnDelete: document.getElementById('btnDelete'),
  btnCollapseMemo: document.getElementById('btnCollapseMemo'),
  btnNewMemo: document.getElementById('btnNewMemo'),
  btnCopy: document.getElementById('btnCopy'),
  btnMoveTopic: document.getElementById('btnMoveTopic'),
  btnSaveTemplate: document.getElementById('btnSaveTemplate'),
  templateModal: document.getElementById('templateModal'),
  templateTopicList: document.getElementById('templateTopicList'),
  templateModalCancel: document.getElementById('templateModalCancel'),
  btnKeepToggle: document.getElementById('btnKeepToggle'),
  btnPin: document.getElementById('btnPin'),
  btnCalendarToggle: document.getElementById('btnCalendarToggle'),
  scheduleArea: document.getElementById('scheduleArea'),
  scheduleLabel: document.getElementById('scheduleLabel'),
  scheduleText: document.getElementById('scheduleText'),
  scheduleInput: document.getElementById('scheduleInput'),
  btnScheduleClear: document.getElementById('btnScheduleClear'),
  btnAlarmToggle: document.getElementById('btnAlarmToggle'),
  alarmArea: document.getElementById('alarmArea'),
  alarmDetail: document.getElementById('alarmDetail'),
  alarmEnabled: document.getElementById('alarmEnabled'),
  alarmEnableLabel: document.getElementById('alarmEnableLabel'),
  alarmEnableHint: document.getElementById('alarmEnableHint'),
  alarmBeforeLabel: document.getElementById('alarmBeforeLabel'),
  alarmDays: document.getElementById('alarmDays'),
  alarmHours: document.getElementById('alarmHours'),
  alarmMinutes: document.getElementById('alarmMinutes'),
  alarmDaysUnit: document.getElementById('alarmDaysUnit'),
  alarmHoursUnit: document.getElementById('alarmHoursUnit'),
  alarmMinutesUnit: document.getElementById('alarmMinutesUnit'),
  alarmRepeatLabel: document.getElementById('alarmRepeatLabel'),
  alarmRepeat: document.getElementById('alarmRepeat'),
  alarmMethodLabel: document.getElementById('alarmMethodLabel'),
  alarmNotify: document.getElementById('alarmNotify'),
  alarmSound: document.getElementById('alarmSound'),
  alarmPopup: document.getElementById('alarmPopup'),
  alarmNotifyLabel: document.getElementById('alarmNotifyLabel'),
  alarmSoundLabel: document.getElementById('alarmSoundLabel'),
  alarmPopupLabel: document.getElementById('alarmPopupLabel'),
  colorPicker: document.getElementById('colorPicker'),
  toolbar: document.getElementById('toolbar'),
  bottombar: document.getElementById('bottombar'),
  headingSelect: document.getElementById('headingSelect'),
  editorArea: document.getElementById('editorArea'),
  attachmentStrip: document.getElementById('attachmentStrip'),
  exportModal: document.getElementById('exportModal'),
  exportFileNameInput: document.getElementById('exportFileNameInput'),
  exportModalCancel: document.getElementById('exportModalCancel'),
  exportModalConfirm: document.getElementById('exportModalConfirm'),
  linkModal: document.getElementById('linkModal'),
  linkUrlInput: document.getElementById('linkUrlInput'),
  linkModalCancel: document.getElementById('linkModalCancel'),
  linkModalConfirm: document.getElementById('linkModalConfirm'),
  specialCharSep: document.getElementById('specialCharSep'),
  specialCharGroup: document.getElementById('specialCharGroup'),
  imageResizeNoticeModal: document.getElementById('imageResizeNoticeModal'),
  imageResizeNoticeConfirm: document.getElementById('imageResizeNoticeConfirm'),
  tableModal: document.getElementById('tableModal'),
  tableModalHint: document.getElementById('tableModalHint'),
  tableGrid: document.getElementById('tableGrid'),
  tableGridSize: document.getElementById('tableGridSize'),
  tableModalPaste: document.getElementById('tableModalPaste'),
  tableModalPasteHint: document.getElementById('tableModalPasteHint'),
  tableModalCancel: document.getElementById('tableModalCancel'),
  confirmModal: document.getElementById('confirmModal'),
  confirmModalTitle: document.getElementById('confirmModalTitle'),
  confirmModalHint: document.getElementById('confirmModalHint'),
  confirmModalCancel: document.getElementById('confirmModalCancel'),
  confirmModalConfirm: document.getElementById('confirmModalConfirm'),
  imageAnnotateModal: document.getElementById('imageAnnotateModal'),
  annotateCanvas: document.getElementById('annotateCanvas'),
  annotateToolLine: document.getElementById('annotateToolLine'),
  annotateToolArrow: document.getElementById('annotateToolArrow'),
  annotateToolNumber: document.getElementById('annotateToolNumber'),
  annotateColorSwatches: document.querySelectorAll('.annotate-color-swatch'),
  annotateUndo: document.getElementById('annotateUndo'),
  imageAnnotateHint: document.getElementById('imageAnnotateHint'),
  imageAnnotateCancel: document.getElementById('imageAnnotateCancel'),
  imageAnnotateSave: document.getElementById('imageAnnotateSave')
};

// 문구 안의 {fileName}/{message}/{ch}/{state} 같은 자리표시자를 실제 값으로 바꿔주는 도우미
function fmt(str, vars) {
  return str.replace(/\{(\w+)\}/g, (_, key) => vars[key]);
}

function applyLang() {
  const M = LANG.memo;
  document.title = M.windowTitle;
  els.topicChip.title = M.topicChipTitle;
  els.titleInput.placeholder = M.titlePlaceholder;
  els.btnNewMemo.title = M.newMemoTitle;
  els.colorPicker.title = M.colorPickerTitle;
  els.btnPin.title = M.pinTitle;
  els.btnCalendarToggle.title = M.calendarToggleTitle;
  els.scheduleLabel.textContent = M.scheduleLabel;
  els.scheduleText.placeholder = M.scheduleTextPlaceholder;
  els.btnScheduleClear.title = M.scheduleClearTitle;
  els.btnAlarmToggle.title = M.alarmToggleTitle;
  els.alarmEnableLabel.textContent = M.alarmEnableLabel;
  els.alarmEnableHint.textContent = M.alarmEnableHint;
  els.alarmBeforeLabel.textContent = M.alarmBeforeLabel;
  els.alarmDaysUnit.textContent = M.alarmDaysUnit;
  els.alarmHoursUnit.textContent = M.alarmHoursUnit;
  els.alarmMinutesUnit.textContent = M.alarmMinutesUnit;
  els.alarmRepeatLabel.textContent = M.alarmRepeatLabel;
  document.getElementById('alarmRepeatNone').textContent = M.alarmRepeatNone;
  document.getElementById('alarmRepeatDaily').textContent = M.alarmRepeatDaily;
  document.getElementById('alarmRepeatWeekly').textContent = M.alarmRepeatWeekly;
  document.getElementById('alarmRepeatMonthly').textContent = M.alarmRepeatMonthly;
  document.getElementById('alarmRepeatYearly').textContent = M.alarmRepeatYearly;
  els.alarmMethodLabel.textContent = M.alarmMethodLabel;
  els.alarmNotifyLabel.textContent = M.alarmMethodNotify;
  els.alarmSoundLabel.textContent = M.alarmMethodSound;
  els.alarmPopupLabel.textContent = M.alarmMethodPopup;
  els.btnKeepToggle.title = M.keepToggleBaseTitle;
  els.btnDelete.title = M.deleteTitle;
  els.btnClose.title = M.closeTitle;

  els.content.placeholder = M.contentPlaceholder;

  document.getElementById('btnUndo').title = M.undoTitle;
  document.getElementById('btnRedo').title = M.redoTitle;
  document.getElementById('btnChecklistCmd').title = M.checklistCmdTitle;
  document.getElementById('btnChecklistByLineCmd').title = M.checklistByLineCmdTitle;
  document.getElementById('btnAttachCmd').title = M.attachTitle;

  document.getElementById('optHeadingNormal').textContent = M.headingNormal;
  document.getElementById('optHeading1').textContent = M.heading1;
  document.getElementById('optHeading2').textContent = M.heading2;
  document.getElementById('optHeading3').textContent = M.heading3;
  document.getElementById('btnList').title = M.listTitle;
  document.getElementById('btnIndent').title = M.indentTitle;
  document.getElementById('btnBold').title = M.boldTitle;
  document.getElementById('btnItalic').title = M.italicTitle;
  document.getElementById('btnStrike').title = M.strikeTitle;
  document.getElementById('btnUnderline').title = M.underlineTitle;
  document.getElementById('btnHighlight').title = M.highlightTitle;
  if (els.highlightPalette && M.highlightColorTitles) {
    els.highlightPalette.querySelectorAll('.hl-swatch').forEach((btn, i) => {
      btn.title = M.highlightColorTitles[i] || '';
    });
  }
  document.getElementById('btnCode').title = M.codeTitle;
  document.getElementById('btnLink').title = M.linkTitle;
  document.getElementById('btnSup').title = M.supTitle;
  document.getElementById('btnSub').title = M.subTitle;

  els.btnMoveTopic.title = M.moveTopicTitle;
  els.btnSaveTemplate.title = M.saveTemplateTitle;
  els.btnCopy.title = M.copyTitle;
  els.btnImport.title = M.importTitle;
  els.btnExportTxt.title = M.exportTxtTitle;
  document.getElementById('btnMemoLink').title = M.memoLinkTitle;
  els.btnExport.title = M.exportButtonText;
  document.getElementById('btnExportLabel').textContent = M.exportButtonShortLabel;

  document.getElementById('exportModalTitle').textContent = M.exportModalTitle;
  els.exportModalCancel.textContent = M.common.cancel;
  els.exportModalConfirm.textContent = M.common.save;

  document.getElementById('linkModalTitle').textContent = M.linkModalTitle;
  els.linkModalCancel.textContent = M.common.cancel;
  els.linkModalConfirm.textContent = M.common.confirm;

  document.getElementById('templateModalTitle').textContent = M.templateModalTitle;
  document.getElementById('templateModalHint').textContent = M.templateModalHint;
  els.templateModalCancel.textContent = M.common.cancel;

  document.getElementById('imageResizeNoticeTitle').textContent = M.imageResizeNoticeTitle;
  document.getElementById('imageResizeNoticeHint').textContent = M.imageResizeNoticeHint;
  els.imageResizeNoticeConfirm.textContent = M.common.confirm;

  document.getElementById('tableModalTitle').textContent = M.tableModalTitle;
  els.tableModalHint.textContent = M.tableModalHint;
  els.tableModalPasteHint.textContent = M.tableModalPasteHint;
  els.tableModalPaste.textContent = M.tableModalPasteButton;
  els.tableModalCancel.textContent = M.common.cancel;

  els.annotateToolLine.textContent = M.imageAnnotateToolLine;
  els.annotateToolArrow.textContent = M.imageAnnotateToolArrow;
  els.annotateToolNumber.textContent = M.imageAnnotateToolNumber;
  els.annotateColorSwatches.forEach((btn) => (btn.title = M.imageAnnotateColorTitle));
  els.annotateUndo.textContent = M.imageAnnotateUndoButton;
  els.imageAnnotateHint.textContent = M.imageAnnotateHint;
  els.imageAnnotateCancel.textContent = M.common.cancel;
  els.imageAnnotateSave.textContent = M.imageAnnotateSaveButton;

  els.confirmModalCancel.textContent = M.common.cancel;
  els.confirmModalConfirm.textContent = M.common.confirm;
}
applyLang();

let pendingLinkRange = null;

let locked = false;

// 체크리스트 "본문으로 되돌리기"(1.19.0에서 없어짐) 때 겪었던 것과 같은 이유로,
// confirm()을 아예 안 쓰고 이 메모창 전용 자체 확인 모달을 씀(설정창/위젯의 openConfirmModal과
// 같은 패턴). 확인을 누르면 onConfirm을 실행함
let pendingConfirmAction = null;
function openConfirmModal(title, hint, onConfirm, confirmLabel) {
  els.confirmModalTitle.textContent = title;
  els.confirmModalHint.textContent = hint || '';
  els.confirmModalHint.hidden = !hint;
  els.confirmModalConfirm.textContent = confirmLabel || LANG.memo.common.confirm;
  pendingConfirmAction = onConfirm;
  els.confirmModal.hidden = false;
}
function closeConfirmModal() {
  els.confirmModal.hidden = true;
  pendingConfirmAction = null;
}
els.confirmModalCancel.addEventListener('click', closeConfirmModal);
els.confirmModalConfirm.addEventListener('click', async () => {
  const action = pendingConfirmAction;
  closeConfirmModal();
  if (action) await action();
});

// ---- MD내보내기 버튼 흐리게/재활성화 ----
// 마지막으로 내보낸 뒤로 내용(본문/체크리스트/첨부/주제)이 안 바뀌었으면 버튼을 흐리게 해서
// "또 눌러도 새로 만들 게 없다"는 걸 보여줌. 메모창을 열 때는 저장된 exportedVersion과
// updatedAt을 비교해서 판단하고, 열려있는 동안은 실제 수정이 있을 때마다 markExportDirty()로
// 바로 갱신함(내보내기가 끝나면 다시 true로 돌림)
let exportUpToDate = false;
function renderExportButtonState() {
  els.btnExport.disabled = exportUpToDate;
}
function markExportDirty() {
  if (exportUpToDate) {
    exportUpToDate = false;
    renderExportButtonState();
  }
}

window.api.onMemoInit(async (initMemo) => {
  memo = initMemo;
  if (!memo.attachments) memo.attachments = [];
  if (!memo.checklist) memo.checklist = [];
  if (!memo.tables) memo.tables = [];
  if (typeof memo.useCalendar !== 'boolean') memo.useCalendar = false;
  if (memo.scheduleAt === undefined) memo.scheduleAt = null;
  memo.alarm = normalizeAlarmLocal(memo.alarm);
  els.content.value = memo.content || '';
  applyAccentColor(memo.color || '#C9A24B');
  els.colorPicker.value = memo.color || '#C9A24B';

  const s = await window.api.getSettings();
  globalDefaultAction = s.defaultPostSaveAction || 'keep';
  confirmMemoDelete = s.confirmMemoDelete !== false;
  autoExportObsidian = !!s.autoExportObsidian;
  mdFeatureEnabled = s.mdFeatureEnabled !== false;
  hasSeenImageResizeNotice = !!s.hasSeenImageResizeNotice;
  applyMdFeatureState();
  renderSpecialChars(s.specialChars);

  renderTopicChip();
  renderKeepToggle();
  renderPinButton();
  renderScheduleArea();
  renderAlarmArea();
  renderAttachments();
  applyCollapsedState(!!memo.collapsed);

  exportUpToDate = !!(
    memo.obsidian &&
    memo.obsidian.saved &&
    memo.obsidian.exportedVersion &&
    memo.obsidian.exportedVersion === memo.updatedAt
  );
  renderExportButtonState();

  if (memo.title || memo.skipTitleFirst) {
    // 제목이 이미 있거나(기본 제목 등), 주제에서 "제목 먼저 쓰지 않기"를 켜둔 경우엔
    // 기존처럼 본문에 바로 커서
    els.content.focus();
  } else {
    // 제목이 비어있으면 제목칸에 커서를 먼저 줘서 바로 입력할 수 있게 함
    openTitleInput();
  }
});

// ---- 접기/펼치기 ----
function applyCollapsedState(collapsed) {
  document.querySelector('.card').classList.toggle('collapsed', collapsed);
  els.btnCollapseMemo.title = collapsed ? LANG.memo.expandTitle : LANG.memo.collapseTitle;
}

els.btnCollapseMemo.addEventListener('click', async () => {
  const next = !document.querySelector('.card').classList.contains('collapsed');
  applyCollapsedState(next);
  await window.api.setMemoCollapsed(memo.id, next);
});

window.api.onSettingsOpened(() => {
  locked = true;
  applyLockState();
});
window.api.onSettingsClosed(() => {
  locked = false;
  applyLockState();
});
window.api.onForceBlur(() => {
  els.content.blur();
});
// (추가) 설정에서 주제 기본색을 바꿨을 때, 이 메모가 그 기본색을 그대로 쓰던 메모라면
// main.js가 이 이벤트로 새 색을 보내줌 — 창을 새로 열지 않아도 지금 열려있는 화면에 바로 반영
window.api.onMemoColorSync((color) => {
  memo.color = color;
  applyAccentColor(color);
  els.colorPicker.value = color;
});
function applyLockState() {
  els.content.readOnly = locked;
  document.querySelector('.card').classList.toggle('locked', locked);
}

// 최초 설치 직후 뜨는 웰컴창이 열려있는 동안, 그 사이에 단축키 등으로 메모창이 새로 열렸을 경우를
// 대비해 편집을 잠가둠. 설정창 열림 잠금(위 locked)과는 완전히 별개 플래그라 서로 안 건드림
let welcomeLocked = false;
window.api.onWelcomeOpened(() => {
  welcomeLocked = true;
  document.querySelector('.card').classList.toggle('welcome-locked', welcomeLocked);
});
window.api.onWelcomeClosed(() => {
  welcomeLocked = false;
  document.querySelector('.card').classList.toggle('welcome-locked', welcomeLocked);
});

// 배경색(memo.color)에 맞춰 글자색/테두리/오버레이 색상을 자동으로 계산해서 전체 테마에 반영
function relativeLuminance(hex) {
  const c = (hex || '#C9A24B').replace('#', '');
  const full = c.length === 3 ? c.split('').map((ch) => ch + ch).join('') : c;
  const r = parseInt(full.substr(0, 2), 16) / 255;
  const g = parseInt(full.substr(2, 2), 16) / 255;
  const b = parseInt(full.substr(4, 2), 16) / 255;
  const lin = (v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function applyAccentColor(color) {
  const root = document.documentElement.style;
  const isLight = relativeLuminance(color) > 0.5;
  const ink = isLight ? '#211F1A' : '#F5F3EC';

  root.setProperty('--paper', color);
  root.setProperty('--accent', color);
  root.setProperty('--ink', ink);
  root.setProperty('--ink-soft', isLight ? 'rgba(33,31,26,0.64)' : 'rgba(245,243,236,0.7)');
  root.setProperty('--line', isLight ? 'rgba(0,0,0,0.14)' : 'rgba(255,255,255,0.22)');
  root.setProperty('--overlay', isLight ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.09)');
  root.setProperty('--overlay-hover', isLight ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.16)');
}

async function renderTopicChip() {
  if (memo.title) {
    els.topicChip.textContent = memo.title;
    els.topicChip.classList.add('has-title');
    return;
  }
  // 제목이 없으면 주제 이름 대신 "제목을 입력하세요" 안내문구를 보여줌
  // (주제 구분은 메모 색상으로 이미 되니, 이 자리는 제목 입력 유도 용도로만 씀)
  els.topicChip.classList.remove('has-title');
  els.topicChip.textContent = LANG.memo.topicChipPlaceholder;
}

// ---- 주제칸 더블클릭으로 제목 입력 ----

// mousedown 시점에 기본 동작(포커스 이동/해제)을 막아서, 더블클릭하는 사이에
// 텍스트영역 포커스가 풀려 편집모드(:focus-within)가 순간적으로 꺼지는 것을 방지
els.topicChip.addEventListener('mousedown', (e) => {
  e.preventDefault();
});

// 제목칸을 보이게 하고 포커스+전체선택(새 메모 자동 커서와 더블클릭 편집이 공용으로 씀)
function openTitleInput() {
  els.titleInput.value = memo.title || '';
  els.topicChip.style.display = 'none';
  els.titleInput.style.display = 'inline-block';
  els.titleInput.focus();
  els.titleInput.select();
}

els.topicChip.addEventListener('dblclick', () => {
  if (locked) return;
  openTitleInput();
});

async function commitTitle() {
  const value = els.titleInput.value.trim();
  memo.title = value;
  await window.api.setMemoTitle(memo.id, value);
  els.titleInput.style.display = 'none';
  els.topicChip.style.display = '';
  renderTopicChip();
}

els.titleInput.addEventListener('blur', commitTitle);
els.titleInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    els.titleInput.blur();
  } else if (e.key === 'Escape') {
    els.titleInput.style.display = 'none';
    els.topicChip.style.display = '';
  }
});

// MD내보내기 후 동작: null(기본값 따름) <-> 'override'(기본값의 반대) 2단계 토글
let globalDefaultAction = 'keep';

// (9차 수정) 글자 버튼 대신 동그라미 아이콘(초록=유지/빨강=전송후삭제) + 자물쇠-삭제
// 버튼 사이의 짧은 상태 글자로 표시. 토글 동작(null <-> 'override') 자체는 그대로 유지
function renderKeepToggle() {
  const isOverride = memo.postSaveAction === 'override'
    || memo.postSaveAction === 'keep'
    || memo.postSaveAction === 'delete';
  const resolved = isOverride
    ? (memo.postSaveAction === 'keep' || memo.postSaveAction === 'delete'
        ? memo.postSaveAction
        : (globalDefaultAction === 'delete' ? 'keep' : 'delete'))
    : globalDefaultAction;
  const isDelete = resolved === 'delete';

  els.btnKeepToggle.classList.toggle('dot-delete', isDelete);
  els.btnKeepToggle.classList.toggle('dot-keep', !isDelete);
  els.btnKeepToggle.classList.toggle('active', isOverride);
  els.btnKeepToggle.title = isOverride
    ? fmt(LANG.memo.keepOverrideTitle, { state: isDelete ? LANG.memo.keepStateDelete : LANG.memo.keepStateKeep })
    : fmt(LANG.memo.keepDefaultTitle, { state: globalDefaultAction === 'delete' ? LANG.memo.keepStateDelete : LANG.memo.keepStateKeep });
}

els.btnKeepToggle.addEventListener('click', async () => {
  const isOverride = memo.postSaveAction === 'override'
    || memo.postSaveAction === 'keep'
    || memo.postSaveAction === 'delete';
  const next = isOverride ? null : 'override';
  memo.postSaveAction = next;
  await window.api.setPostSaveAction(memo.id, next);
  renderKeepToggle();
});

function pinIconSvg(active) {
  const fill = active ? 'currentColor' : 'none';
  const rotate = active ? '' : ' style="transform:rotate(-35deg)"';
  return `<svg viewBox="0 0 24 24" width="13" height="13"${rotate}>
    <circle cx="12" cy="7" r="4" fill="${fill}" stroke="currentColor" stroke-width="1.5"/>
    <line x1="12" y1="11" x2="12" y2="20" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
  </svg>`;
}

function renderPinButton() {
  els.btnPin.classList.toggle('active', !!memo.alwaysOnTop);
  els.btnPin.innerHTML = pinIconSvg(!!memo.alwaysOnTop);
}

els.btnPin.addEventListener('click', async () => {
  memo.alwaysOnTop = !memo.alwaysOnTop;
  await window.api.setAlwaysOnTop(memo.id, memo.alwaysOnTop);
  renderPinButton();
});

els.colorPicker.addEventListener('input', async () => {
  memo.color = els.colorPicker.value;
  applyAccentColor(memo.color);
  await window.api.setMemoColor(memo.id, memo.color);
});

// ---- 일정 날짜(달력) ----
// memo.useCalendar가 켜져 있을 때만 제목줄 아래 일정 날짜 칸을 보여줌.
// 저장값(memo.scheduleAt)은 "YYYY-MM-DDTHH:mm"(로컬 시각). 숫자칸으로 빠르게 치거나 달력으로 고를 수 있음.

// 숫자만 뽑아 일정 문자열로 변환. 자리수로 형식을 판단:
//  6=YYMMDD, 8=YYYYMMDD (둘 다 시간 00:00), 10=YYMMDDHHmm, 12=YYYYMMDDHHmm.
//  2자리 연도는 20YY로 봄. 실제로 없는 날짜(예: 2월30일, 13월)면 null 반환.
function parseScheduleDigits(raw) {
  const d = (raw || '').replace(/[^0-9]/g, '');
  let y, mo, da, hh = '00', mi = '00';
  if (d.length === 6) { y = '20' + d.slice(0, 2); mo = d.slice(2, 4); da = d.slice(4, 6); }
  else if (d.length === 8) { y = d.slice(0, 4); mo = d.slice(4, 6); da = d.slice(6, 8); }
  else if (d.length === 10) { y = '20' + d.slice(0, 2); mo = d.slice(2, 4); da = d.slice(4, 6); hh = d.slice(6, 8); mi = d.slice(8, 10); }
  else if (d.length === 12) { y = d.slice(0, 4); mo = d.slice(4, 6); da = d.slice(6, 8); hh = d.slice(8, 10); mi = d.slice(10, 12); }
  else return null;
  const Y = +y, Mo = +mo, Da = +da, H = +hh, Mi = +mi;
  if (Mo < 1 || Mo > 12 || Da < 1 || Da > 31 || H > 23 || Mi > 59) return null;
  const dt = new Date(Y, Mo - 1, Da, H, Mi);
  if (dt.getFullYear() !== Y || dt.getMonth() !== Mo - 1 || dt.getDate() !== Da) return null;
  const p = (n) => String(n).padStart(2, '0');
  return `${Y}-${p(Mo)}-${p(Da)}T${p(H)}:${p(Mi)}`;
}

// 저장값("...T...")을 사람이 읽는 표시("YYYY-MM-DD HH:mm")로
function formatScheduleDisplay(val) {
  return val ? val.replace('T', ' ') : '';
}

function renderScheduleArea() {
  const on = !!memo.useCalendar;
  els.scheduleArea.hidden = !on;
  els.btnCalendarToggle.classList.toggle('active', on);
  els.scheduleInput.value = memo.scheduleAt || '';
  els.scheduleText.value = formatScheduleDisplay(memo.scheduleAt);
  els.scheduleText.classList.remove('invalid');
}

async function saveScheduleAt(value) {
  memo.scheduleAt = value || null;
  els.scheduleInput.value = memo.scheduleAt || '';
  els.scheduleText.value = formatScheduleDisplay(memo.scheduleAt);
  await window.api.setMemoScheduleAt(memo.id, memo.scheduleAt);
}

// 달력 토글: 이 메모에서 일정 날짜 기능 켜기/끄기 (끈다고 이미 넣은 날짜를 지우지는 않음)
els.btnCalendarToggle.addEventListener('click', async () => {
  memo.useCalendar = !memo.useCalendar;
  if (!memo.useCalendar) alarmPanelOpen = false; // 달력 끄면 알람칸도 접음
  renderScheduleArea();
  renderAlarmArea();
  await window.api.setMemoUseCalendar(memo.id, memo.useCalendar);
});

// 숫자칸에서 값을 확정(엔터 또는 칸 밖 클릭)했을 때: 비면 지움, 올바르면 저장, 틀리면 빨갛게
async function commitScheduleText() {
  const raw = els.scheduleText.value.trim();
  if (!raw) { els.scheduleText.classList.remove('invalid'); await saveScheduleAt(null); return; }
  const parsed = parseScheduleDigits(raw);
  if (!parsed) { els.scheduleText.classList.add('invalid'); return; }
  els.scheduleText.classList.remove('invalid');
  await saveScheduleAt(parsed);
}
els.scheduleText.addEventListener('change', commitScheduleText);
els.scheduleText.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); els.scheduleText.blur(); }
});
// 다시 입력하려고 고칠 때 빨간 표시는 즉시 지워줌
els.scheduleText.addEventListener('input', () => els.scheduleText.classList.remove('invalid'));

// 달력에서 고르면 숫자칸에도 같은 값이 반영됨
els.scheduleInput.addEventListener('change', async () => {
  await saveScheduleAt(els.scheduleInput.value || null);
});

// ✕ 버튼: 일정 날짜만 지움(달력 기능 자체는 켜둔 채)
els.btnScheduleClear.addEventListener('click', async () => {
  els.scheduleText.classList.remove('invalid');
  await saveScheduleAt(null);
});

// ---- 알람 ----
// 일정 날짜(memo.scheduleAt)에 맞춰 알람을 울림. 실제 울리는 건 메인 프로세스가 담당하고,
// 여기서는 설정 UI만 그림. 🔔 버튼으로 설정칸을 펼쳤다 접음.
let alarmPanelOpen = false;

// 저장값이 없거나 옛 메모라도 항상 온전한 알람 객체를 갖도록 기본값으로 채움(방어)
function normalizeAlarmLocal(a) {
  a = a || {};
  const b = a.before || {};
  const num = (v, d) => (Number.isFinite(+v) ? Math.max(0, Math.floor(+v)) : d);
  const repeats = ['none', 'daily', 'weekly', 'monthly', 'yearly'];
  let methods = Array.isArray(a.methods)
    ? a.methods.filter((m) => ['notify', 'sound', 'popup'].includes(m))
    : null;
  if (methods === null) methods = ['notify', 'sound']; // 옛 메모 기본값
  return {
    enabled: !!a.enabled,
    before: { days: num(b.days, 0), hours: num(b.hours, 0), minutes: num(b.minutes, 0) },
    repeat: repeats.includes(a.repeat) ? a.repeat : 'none',
    methods,
    firedFor: a.firedFor || null
  };
}

// UI에 현재 memo.alarm 값을 반영
function renderAlarmArea() {
  const al = memo.alarm || (memo.alarm = normalizeAlarmLocal(null));
  // 🔔 버튼: 알람이 켜져 있으면 색으로 표시, 패널이 열려 있으면 눌린 표시
  els.btnAlarmToggle.classList.toggle('on', !!al.enabled);
  els.btnAlarmToggle.classList.toggle('active', alarmPanelOpen);
  // 일정 날짜 기능이 꺼져 있으면(schedule-area 숨김) 알람칸도 같이 숨김
  els.alarmArea.hidden = !(alarmPanelOpen && memo.useCalendar);

  els.alarmEnabled.checked = !!al.enabled;
  // 일정 날짜가 아직 없으면 안내문구를 보여줌(알람은 켜둘 수 있지만 날짜를 정해야 울림)
  els.alarmEnableHint.hidden = !!memo.scheduleAt;

  els.alarmDays.value = al.before.days || 0;
  els.alarmHours.value = al.before.hours || 0;
  els.alarmMinutes.value = al.before.minutes || 0;
  els.alarmRepeat.value = al.repeat || 'none';
  els.alarmNotify.checked = al.methods.includes('notify');
  els.alarmSound.checked = al.methods.includes('sound');
  els.alarmPopup.checked = al.methods.includes('popup');

  // 알람이 꺼져 있으면 세부 설정은 흐리게(못 누르게)
  els.alarmDetail.classList.toggle('disabled', !al.enabled);
}

// 현재 UI 입력값을 모아 memo.alarm으로 만들고 저장
async function saveAlarm() {
  const clampInt = (el, hi) => {
    let v = Math.floor(+el.value || 0);
    if (v < 0) v = 0;
    if (v > hi) v = hi;
    el.value = v;
    return v;
  };
  const methods = [];
  if (els.alarmNotify.checked) methods.push('notify');
  if (els.alarmSound.checked) methods.push('sound');
  if (els.alarmPopup.checked) methods.push('popup');
  memo.alarm = {
    enabled: els.alarmEnabled.checked,
    before: {
      days: clampInt(els.alarmDays, 3650),
      hours: clampInt(els.alarmHours, 23),
      minutes: clampInt(els.alarmMinutes, 59)
    },
    repeat: els.alarmRepeat.value || 'none',
    methods,
    firedFor: memo.alarm ? memo.alarm.firedFor : null
  };
  els.alarmDetail.classList.toggle('disabled', !memo.alarm.enabled);
  els.btnAlarmToggle.classList.toggle('on', !!memo.alarm.enabled);
  // 메인 프로세스가 firedFor를 재기준해서 돌려주므로 그 값으로 갱신
  const saved = await window.api.setMemoAlarm(memo.id, memo.alarm);
  if (saved && saved.alarm) memo.alarm = saved.alarm;
}

// 🔔 버튼: 알람 설정칸 펼치기/접기
els.btnAlarmToggle.addEventListener('click', () => {
  alarmPanelOpen = !alarmPanelOpen;
  renderAlarmArea();
});

// 알람 켜기/끄기
els.alarmEnabled.addEventListener('change', saveAlarm);
// 미리 알림 숫자칸(값 확정 시 저장)
[els.alarmDays, els.alarmHours, els.alarmMinutes].forEach((el) => {
  el.addEventListener('change', saveAlarm);
});
// 반복/방식
els.alarmRepeat.addEventListener('change', saveAlarm);
[els.alarmNotify, els.alarmSound, els.alarmPopup].forEach((el) => {
  el.addEventListener('change', saveAlarm);
});

// ---- 자동 저장 ----

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    // (1.18.0 방어코드) 본문 편집기가 어떤 이유로든 통째로 비어버린(줄이 하나도 없는)
    // 비정상 상태면 저장을 건너뜀 — 그대로 저장하면 메모 내용이 통째로 날아감.
    // 사용자가 직접 다 지운 경우는 빈 줄이 하나 남아 있으므로 정상 저장됨
    const broken = els.contentEl.childNodes.length === 0 && (memo.content || '').length > 0;
    if (broken) return;
    memo.content = els.content.value;
    await window.api.updateMemoContent(memo.id, memo.content);
    await pruneUnusedImages();
    // 자동저장 표시(문구 깜빡임)는 끔 — 저장 자체는 계속 조용히 동작함
  }, 500);
}

els.content.addEventListener('input', () => {
  markExportDirty();
  scheduleSave();
});

// ---- 클립보드 이미지 붙여넣기(Ctrl+V) ----

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(String(reader.result).split(',')[1] || '');
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

els.content.addEventListener('paste', async (e) => {
  if (locked) return;

  // 클립보드에 진짜 표(HTML table)가 들어있으면 본문에 글자로 붙이지 않고 새 표로 만듦.
  // ("표 복사" 버튼·엑셀·다른 메모에서 온 경우만 해당. 일반 글자는 그대로 기본 붙여넣기)
  // getData는 await보다 먼저 동기로 읽어야 함 — await 뒤에는 clipboardData가 비워질 수 있음.
  const pasteHtml = e.clipboardData ? e.clipboardData.getData('text/html') : '';
  if (pasteHtml && /<table/i.test(pasteHtml)) {
    const pasteText = e.clipboardData ? e.clipboardData.getData('text/plain') : '';
    const rows = parseClipboardTable(pasteHtml, pasteText);
    if (rows) {
      e.preventDefault();
      els.content.insertTable(0, 0, rows);
      scheduleSave();
      updateTableBar();
      return;
    }
  }

  const items = e.clipboardData ? Array.from(e.clipboardData.items) : [];
  const imageItem = items.find((it) => it.type && it.type.startsWith('image/'));
  if (!imageItem) return; // 이미지가 아니면 기본 붙여넣기 동작 그대로 둠

  e.preventDefault();
  const blob = imageItem.getAsFile();
  if (!blob) return;
  const ext = '.' + (imageItem.type.split('/')[1] || 'png');
  const base64 = await blobToBase64(blob);
  const attachment = await window.api.saveClipboardImage(base64, ext);
  await window.api.addAttachment(memo.id, attachment);
  memo.attachments.push(attachment);
  markExportDirty();
  await renderAttachments();
  insertImageAtCursor(attachment);
  maybeShowImageResizeNotice();
});

// ---- 탐색기에서 파일을 끌어다 놓기(드래그앤드롭) ----

els.editorArea.addEventListener('dragover', (e) => {
  e.preventDefault();
  els.editorArea.classList.add('drag-over');
});
els.editorArea.addEventListener('dragleave', () => {
  els.editorArea.classList.remove('drag-over');
});
els.editorArea.addEventListener('drop', async (e) => {
  e.preventDefault();
  els.editorArea.classList.remove('drag-over');
  if (locked) return;
  const files = e.dataTransfer ? Array.from(e.dataTransfer.files) : [];
  const paths = files.map((f) => f.path).filter(Boolean);
  if (!paths.length) return;
  const added = await window.api.addAttachmentsFromPaths(paths);
  for (const file of added) {
    await window.api.addAttachment(memo.id, file);
    memo.attachments.push(file);
  }
  markExportDirty();
  await renderAttachments();
  added.forEach((file) => { if (file.isImage) insertImageAtCursor(file); });
  if (added.some((file) => file.isImage)) maybeShowImageResizeNotice();
});

// ---- 서식 툴바 (마크다운 삽입 방식) ----

function wrapSelection(before, after) {
  const ta = els.content;
  const start = ta.selectionStart;
  const end = ta.selectionEnd;
  const selected = ta.value.slice(start, end);
  ta.focus();
  ta.setRangeText(before + selected + after, start, end, 'end');
  scheduleSave();
}

// 이미 마커(예: **)로 감싸진 선택 영역이면 마커를 제거(취소), 아니면 새로 감쌈(적용) — 굵게 등 토글용
function toggleWrapSelection(marker) {
  const ta = els.content;
  const start = ta.selectionStart;
  const end = ta.selectionEnd;
  const selected = ta.value.slice(start, end);
  const before = ta.value.slice(Math.max(0, start - marker.length), start);
  const after = ta.value.slice(end, end + marker.length);
  ta.focus();

  // 선택 영역 바로 바깥쪽에 마커가 있는 경우 (마커 없이 안쪽 글자만 선택한 상태) → 마커 제거
  if (before === marker && after === marker) {
    ta.setRangeText(selected, start - marker.length, end + marker.length, 'end');
    scheduleSave();
    return;
  }
  // 마커까지 통째로 선택한 경우 → 마커만 벗겨냄
  if (selected.startsWith(marker) && selected.endsWith(marker) && selected.length >= marker.length * 2) {
    const inner = selected.slice(marker.length, selected.length - marker.length);
    ta.setRangeText(inner, start, end, 'end');
    scheduleSave();
    return;
  }
  // 그 외에는 새로 감쌈
  ta.setRangeText(marker + selected + marker, start, end, 'end');
  scheduleSave();
}

function prefixLines(prefix) {
  const ta = els.content;
  const value = ta.value;
  const start = ta.selectionStart;
  const end = ta.selectionEnd;
  const lineStart = value.lastIndexOf('\n', start - 1) + 1;
  let lineEnd = value.indexOf('\n', end);
  if (lineEnd === -1) lineEnd = value.length;
  const block = value.slice(lineStart, lineEnd);
  const newBlock = block
    .split('\n')
    .map((line) => prefix + line)
    .join('\n');
  ta.focus();
  ta.setRangeText(newBlock, lineStart, lineEnd, 'end');
  scheduleSave();
}

function runToolbarCommand(cmd) {
  switch (cmd) {
    // (1.18.0) 본문이 contenteditable로 바뀌면서 브라우저 기본 실행취소를 못 쓰게 됐음
    // (다시 그릴 때마다 기록이 끊김) → mdeditor.js의 자체 실행취소를 사용
    case 'undo':
      els.content.focus();
      els.content.undo();
      break;
    case 'redo':
      els.content.focus();
      els.content.redo();
      break;
    case 'list':
      prefixLines('- ');
      break;
    case 'indent':
      prefixLines('  ');
      break;
    case 'bold':
      toggleWrapSelection('**');
      break;
    case 'italic':
      wrapSelection('*', '*');
      break;
    case 'strike':
      wrapSelection('~~', '~~');
      break;
    case 'underline':
      wrapSelection('<u>', '</u>');
      break;
    case 'highlight':
      toggleHighlightPalette();
      break;
    case 'code': {
      const hasNewline = els.content.value
        .slice(els.content.selectionStart, els.content.selectionEnd)
        .includes('\n');
      hasNewline ? wrapSelection('```\n', '\n```') : wrapSelection('`', '`');
      break;
    }
    case 'link': {
      // Electron은 window.prompt()를 지원하지 않아 자체 모달로 URL을 입력받음
      const ta = els.content;
      pendingLinkRange = { start: ta.selectionStart, end: ta.selectionEnd };
      els.linkUrlInput.value = 'https://';
      els.linkModal.hidden = false;
      els.linkUrlInput.focus();
      els.linkUrlInput.select();
      break;
    }
    case 'memolink':
      openMemoLinkPopup();
      break;
    case 'sup':
      wrapSelection('<sup>', '</sup>');
      break;
    case 'sub':
      wrapSelection('<sub>', '</sub>');
      break;
    case 'checklist':
      convertSelectionToChecklist();
      break;
    case 'checklistByLine':
      convertSelectionToChecklistByLine();
      break;
    case 'attach':
      handleAttach();
      break;
    case 'table':
      openTableModal();
      break;
  }
}

// 메모연결(memolink) 버튼이 툴바 밖 하단(footer)으로 이동했기 때문에, 위임 범위를 툴바에서
// 문서 전체로 넓혀서 data-cmd 버튼이면 어디 있든 동작하게 함
document.body.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-cmd]');
  if (btn) runToolbarCommand(btn.dataset.cmd);
});

// (1.18.0) 본문이 contenteditable이 되면서, 툴바 버튼을 누르는 순간 본문에서 포커스가
// 빠져나가 선택 영역이 풀려버리는 문제가 생김. 버튼 누를 때의 기본 포커스 이동만 막아서
// 선택한 글자가 그대로 남아 있게 함(버튼 클릭 자체는 정상 동작)
els.bottombar.addEventListener('mousedown', (e) => {
  if (e.target.closest('button')) e.preventDefault();
});

// ---- 형광펜 색 고르기 ----
// 노랑은 마크다운 표준(==강조==), 나머지 색은 표준 문법이 없어서 <mark style> HTML로 넣음
// (태훈님 확정 2026-08-14: md 파일이 조금 지저분해지더라도 여러 색을 쓰기로 함)

function toggleHighlightPalette() {
  const palette = els.highlightPalette;
  if (!palette) return;
  if (!palette.hidden) { palette.hidden = true; return; }
  if (locked) return;

  // 카드 바깥(position:fixed)에 있으므로 🖍 버튼 위치를 재서 그 바로 위에 띄움.
  // 창 밖으로 넘치면 좌우로 밀어 넣고, 위쪽 공간이 모자라면 버튼 아래로 내림
  const btn = document.getElementById('btnHighlight');
  palette.hidden = false;
  if (!btn) return;
  const b = btn.getBoundingClientRect();
  const p = palette.getBoundingClientRect();
  let left = b.left + b.width / 2 - p.width / 2;
  left = Math.max(6, Math.min(left, window.innerWidth - p.width - 6));
  let top = b.top - p.height - 6;
  if (top < 6) top = b.bottom + 6;
  palette.style.left = `${Math.round(left)}px`;
  palette.style.top = `${Math.round(top)}px`;
}

function closeHighlightPalette() {
  if (els.highlightPalette) els.highlightPalette.hidden = true;
}

if (els.highlightPalette) {
  // 하단바 버튼과 같은 이유(선택 영역이 풀리지 않게) — 색을 누를 때 포커스 이동만 막음
  els.highlightPalette.addEventListener('mousedown', (e) => e.preventDefault());
  els.highlightPalette.addEventListener('click', (e) => {
    const swatch = e.target.closest('.hl-swatch');
    if (!swatch) return;
    const color = swatch.dataset.hl || '';
    closeHighlightPalette();
    els.content.focus();
    if (!color) toggleWrapSelection('==');
    else wrapSelection(`<mark style="background:${color}">`, '</mark>');
  });
  document.addEventListener('click', (e) => {
    if (e.target.closest('.hl-wrap') || e.target.closest('.hl-palette')) return;
    closeHighlightPalette();
  });
}

// 워드처럼 Ctrl+B / Ctrl+I / Ctrl+U 로도 서식을 걸 수 있게 함
// (contenteditable의 브라우저 기본 동작은 <b> 태그를 심어버려서 mdeditor.js에서 막아뒀음)
els.content.addEventListener('keydown', (e) => {
  if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey) return;
  const key = String(e.key).toLowerCase();
  if (key === 'b') runToolbarCommand('bold');
  else if (key === 'i') runToolbarCommand('italic');
  else if (key === 'u') runToolbarCommand('underline');
});

els.headingSelect.addEventListener('change', () => {
  if (els.headingSelect.value) prefixLines(els.headingSelect.value);
  els.headingSelect.value = '';
});

// ---- 체크리스트 ----
// (1.19.0 / 위지윅 2-1단계) 예전엔 textarea 안에 체크박스를 그릴 수 없어서 본문과 별개인
// 목록(memo.checklist)으로 관리했음. 이제 본문이 실시간 서식 편집기라 "- [ ] 할일" 줄을
// 본문 안에 그대로 두고 진짜 체크박스로 그린다(mdeditor.js 참고).
// 그래서 여기 있던 별도 목록 관련 코드는 전부 사라졌고, 툴바 버튼은 선택한 줄 앞에
// "- [ ] "를 붙였다 떼는 역할만 함.

// 이미 체크리스트 항목인 줄인지
function isTaskLine(line) {
  return /^\s*[-*+][ \t]+\[[ xX]\][ \t]/.test(line);
}

// 줄 앞에 이미 붙어있는 글머리표(- , * , 1. , - [ ] )를 떼어냄 — 버튼을 눌렀을 때 겹치지 않게
function stripLineMarker(line) {
  return line.replace(/^\s*([-*+][ \t]+\[[ xX]\][ \t]|[-*+][ \t]+|\d+\.[ \t]+)/, '');
}

// 선택 영역(선택이 없으면 커서가 있는 줄)을 줄 단위로 잘라서 앞뒤를 다듬어줌
function selectedLineRange() {
  const ta = els.content;
  const value = ta.value;
  const start = value.lastIndexOf('\n', ta.selectionStart - 1) + 1;
  let end = value.indexOf('\n', ta.selectionEnd);
  if (end === -1) end = value.length;
  return { start, end, raw: value.slice(start, end) };
}

// 체크리스트 버튼 공통 처리.
// byBlock = true  → 빈 줄 기준(빈 줄로 나뉜 덩어리 하나가 항목 하나. 덩어리 안 줄바꿈은 공백으로 합침)
// byBlock = false → 한 줄 기준(줄 하나가 항목 하나)
// 고른 줄이 전부 이미 체크리스트면 다시 눌렀을 때 해제됨(껐다 켜는 버튼)
function applyChecklist(byBlock) {
  const ta = els.content;
  const { start, end, raw } = selectedLineRange();

  if (!raw.trim()) {
    // 빈 줄에서 눌렀으면 빈 항목 하나를 만들어줌
    ta.setRangeText('- [ ] ', start, end, 'end');
    scheduleSave();
    return;
  }

  const nonEmpty = raw.split('\n').filter((l) => l.trim());
  const allTasks = nonEmpty.length > 0 && nonEmpty.every(isTaskLine);

  let out;
  if (allTasks) {
    // 해제: 앞의 "- [ ] "만 떼고 글자는 그대로 둠
    out = raw.split('\n').map((l) => (isTaskLine(l) ? stripLineMarker(l) : l)).join('\n');
  } else if (byBlock) {
    out = raw
      .split(/\n[ \t]*\r?\n+/)
      .map((block) => block.split('\n').map((l) => stripLineMarker(l).trim()).filter(Boolean).join(' '))
      .filter(Boolean)
      .map((t) => `- [ ] ${t}`)
      .join('\n');
  } else {
    out = raw
      .split('\n')
      .map((l) => (l.trim() ? `- [ ] ${stripLineMarker(l).trim()}` : ''))
      .filter((l) => l !== '')
      .join('\n');
  }

  ta.setRangeText(out, start, end, 'end');
  scheduleSave();
}

function convertSelectionToChecklist() {
  applyChecklist(true);
}

function convertSelectionToChecklistByLine() {
  applyChecklist(false);
}

function maybeShowImageResizeNotice() {
  if (hasSeenImageResizeNotice) return;
  hasSeenImageResizeNotice = true; // 같은 세션에서 여러 번 안 뜨게 먼저 막아둠
  els.imageResizeNoticeModal.hidden = false;
  window.api.saveSettings({ hasSeenImageResizeNotice: true });
}
els.imageResizeNoticeConfirm.addEventListener('click', () => {
  els.imageResizeNoticeModal.hidden = true;
});


// (0.19.1) 표도 본문 안으로 들어왔으므로 뒤에 따로 이어붙일 게 없음.
// 이름은 그대로 두어 부르는 쪽(복사·txt 내보내기)을 안 건드림
function fullTextWithChecklist() {
  return els.content.value;
}
// ---- 특수문자 (설정에서 지정한 문자를 툴바 버튼으로 노출, 클릭시 커서 위치에 삽입) ----

function insertAtCursor(text) {
  const ta = els.content;
  const start = ta.selectionStart;
  const end = ta.selectionEnd;
  ta.focus();
  ta.setRangeText(text, start, end, 'end');
  scheduleSave();
}

// ---- 표 (0.19.1: 본문 안으로 들어감) ----------------------------------------
// 예전에는 본문과 별개인 .table-area 에 실제 <table>을 그렸는데(memo.tables),
// 0.19.1부터 표도 본문 글자("| 가 | 나 |")로 들어간다. 그리는 일은 mdeditor.js가 하고
// 여기서는 "표 만들기"와 "커서가 표 안에 있을 때 뜨는 작은 버튼"만 담당한다.
//
// ⚠️ 열 폭 드래그 조절은 없앴음 — 칸 너비는 마크다운에 저장할 방법이 없어서
//    앱에만 따로 보관하면 표를 고칠 때 폭 정보와 어긋난다(태훈님 확정 2026-08-15).

// 커서가 표 안에 있을 때만 뜨는 조작 버튼들.
// (0.19.1b) 한 곳에 몰아두면 "지금 어느 줄/어느 칸에 적용되는지"가 눈으로 안 보여서
// 자리로 구분하도록 바꿈(태훈님 요청 2026-08-15):
//   열 버튼(＋ －) = 표 "위", 커서가 있는 칸의 가로 위치에 맞춰서
//   행 버튼(＋ －) = 표 "왼쪽", 커서가 있는 줄의 높이에 맞춰서
//   표 버튼(복사/삭제) = 표 "아래"
// ⚠️ 세 묶음 모두 body 바로 밑에 position:fixed로 띄움 — 카드 안(.toolbar/.bottombar)에
//    넣으면 overflow:hidden 때문에 잘려서 안 보인다(0.18.0 형광펜 팔레트 실제 버그).
let tableBars = null; // { col, row, tbl }

function buildTableBars() {
  if (tableBars) return tableBars;
  const M = LANG.memo;
  const make = (cls, defs) => {
    const bar = document.createElement('div');
    bar.className = `table-bar ${cls}`;
    bar.hidden = true;
    defs.forEach(([cmd, label, title, extra]) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `table-bar-btn${extra ? ' ' + extra : ''}`;
      btn.dataset.tcmd = cmd;
      btn.textContent = label;
      btn.title = title || label;
      bar.appendChild(btn);
    });
    // 버튼을 누르는 순간 본문에서 포커스가 빠지면 커서 자리를 잃어버림(형광펜 팔레트와 같은 이유)
    bar.addEventListener('mousedown', (e) => e.preventDefault());
    bar.addEventListener('click', onTableBarClick);
    document.body.appendChild(bar);
    return bar;
  };
  tableBars = {
    col: make('table-bar-col', [
      ['addCol', '＋', M.tableBarAddColTitle],
      ['deleteCol', '－', M.tableBarDeleteColTitle, 'danger'],
    ]),
    row: make('table-bar-row', [
      ['addRow', '＋', M.tableBarAddRowTitle],
      ['deleteRow', '－', M.tableBarDeleteRowTitle, 'danger'],
    ]),
    tbl: make('table-bar-tbl', [
      ['copy', M.tableCopyButton, M.tableCopyButtonTitle],
      ['deleteTable', M.tableDeleteButton, M.tableDeleteButtonTitle, 'danger'],
    ]),
  };
  return tableBars;
}

async function onTableBarClick(e) {
  const btn = e.target.closest('button[data-tcmd]');
  if (!btn || locked) return;
  const cmd = btn.dataset.tcmd;
  if (cmd === 'copy') {
    await copyTableAtCaret(btn);
    return;
  }
  els.content.focus();
  els.content.tableCommand(cmd);
  scheduleSave();
  updateTableBar();
}

// 커서가 표 안에 있으면 세 묶음을 각자 자리에 놓고, 아니면 전부 감춤
function updateTableBar() {
  const bars = buildTableBars();
  const info = !locked && els.content.tableAtCaret ? els.content.tableAtCaret() : null;
  const hideAll = () => { bars.col.hidden = true; bars.row.hidden = true; bars.tbl.hidden = true; };
  if (!info || !info.firstLineEl || !info.lineEl) { hideAll(); return; }

  const box = els.contentEl.getBoundingClientRect();
  const first = info.firstLineEl.getBoundingClientRect();
  const last = (info.lastLineEl || info.firstLineEl).getBoundingClientRect();
  const tableTop = first.top;
  const tableBottom = last.bottom;
  const tableLeft = Math.min(first.left, last.left);
  const tableRight = Math.max(first.right, last.right);
  // 표가 스크롤 때문에 본문 영역 밖으로 나가 있으면 버튼도 감춤
  if (tableBottom < box.top || tableTop > box.bottom) { hideAll(); return; }

  const clampX = (x, el) => Math.max(2, Math.min(x, window.innerWidth - el.offsetWidth - 2));
  const clampY = (y, el) => Math.max(2, Math.min(y, window.innerHeight - el.offsetHeight - 2));

  // 열 버튼: 표 위, 커서가 있는 칸의 가운데
  const cell = info.cellEl ? info.cellEl.getBoundingClientRect() : null;
  bars.col.hidden = false;
  const colX = cell ? cell.left + cell.width / 2 - bars.col.offsetWidth / 2 : tableLeft;
  bars.col.style.left = `${clampX(colX, bars.col)}px`;
  bars.col.style.top = `${clampY(tableTop - bars.col.offsetHeight - 3, bars.col)}px`;

  // 행 버튼: 표 왼쪽, 커서가 있는 줄의 가운데. 왼쪽에 자리가 없으면 오른쪽으로 보냄
  const line = info.lineEl.getBoundingClientRect();
  bars.row.hidden = false;
  let rowX = tableLeft - bars.row.offsetWidth - 3;
  if (rowX < 2) rowX = tableRight + 3;
  bars.row.style.left = `${clampX(rowX, bars.row)}px`;
  bars.row.style.top = `${clampY(line.top + line.height / 2 - bars.row.offsetHeight / 2, bars.row)}px`;

  // 표 버튼: 표 아래 왼쪽
  bars.tbl.hidden = false;
  bars.tbl.style.left = `${clampX(tableLeft, bars.tbl)}px`;
  bars.tbl.style.top = `${clampY(tableBottom + 3, bars.tbl)}px`;
}

// 커서가 있는 표를 엑셀에 붙여넣을 수 있는 형태(탭 구분 텍스트 + HTML 표)로 복사
async function copyTableAtCaret(btn) {
  const rows = els.content.tableTextAtCaret && els.content.tableTextAtCaret();
  if (!rows || !rows.length) return;
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const text = rows.map((r) => r.join('\t')).join('\n');
  const headCells = rows[0].map((c) => `<th>${esc(c)}</th>`).join('');
  const bodyRows = rows.slice(1).map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('');
  const html = `<table><thead><tr>${headCells}</tr></thead><tbody>${bodyRows}</tbody></table>`;
  const ok = await window.api.copyTable(text, html);
  if (!ok) return;
  const original = btn.textContent;
  btn.textContent = LANG.memo.tableCopyDoneButton;
  btn.classList.add('copied');
  setTimeout(() => {
    btn.textContent = original;
    btn.classList.remove('copied');
  }, 1200);
}

document.addEventListener('selectionchange', () => {
  if (document.activeElement !== els.contentEl) return;
  updateTableBar();
});
els.contentEl.addEventListener('blur', () => {
  // 버튼을 누른 것 때문에 포커스가 빠진 경우까지 감추면 버튼이 안 눌리므로 잠깐 뒤에 확인
  setTimeout(() => {
    if (document.activeElement !== els.contentEl) hideTableBars();
  }, 150);
});
els.contentEl.addEventListener('scroll', () => { if (tableBars && !tableBars.col.hidden) updateTableBar(); });
window.addEventListener('resize', () => { if (tableBars && !tableBars.col.hidden) updateTableBar(); });

function hideTableBars() {
  if (!tableBars) return;
  tableBars.col.hidden = true;
  tableBars.row.hidden = true;
  tableBars.tbl.hidden = true;
}

// ---- 표 삽입 버튼: 격자를 가리켰다 떼면(드래그하듯) 그 크기의 빈 표를 만듦 ----
const TABLE_GRID_ROWS = 8;
const TABLE_GRID_COLS = 8;
let tableGridBuilt = false;
let tablePickerRows = 0;
let tablePickerCols = 0;

function buildTableGrid() {
  if (tableGridBuilt) return;
  tableGridBuilt = true;
  els.tableGrid.innerHTML = '';
  for (let r = 1; r <= TABLE_GRID_ROWS; r += 1) {
    for (let c = 1; c <= TABLE_GRID_COLS; c += 1) {
      const cell = document.createElement('button');
      cell.type = 'button';
      cell.className = 'table-grid-cell';
      cell.dataset.row = String(r);
      cell.dataset.col = String(c);
      // 마우스가 지나가는 칸마다 미리보기 갱신 — 실제 드래그(누른 채 이동)든 그냥 가리키기든
      // 똑같이 동작함. 확정은 클릭 위치가 아니라 "손을 떼는 순간"(mouseup, 격자 전체에서
      // 한 번만 등록)의 마지막 미리보기 크기로 함 — 드래그 중엔 mousedown/mouseup 칸이
      // 서로 달라서 click 이벤트 자체가 안 일어나는 경우가 있기 때문
      cell.addEventListener('mouseenter', () => setTablePickerPreview(r, c));
      els.tableGrid.appendChild(cell);
    }
  }
  els.tableGrid.addEventListener('mouseup', () => confirmTablePicker());
}

function setTablePickerPreview(rows, cols) {
  tablePickerRows = rows;
  tablePickerCols = cols;
  els.tableGrid.querySelectorAll('.table-grid-cell').forEach((cell) => {
    const picked = Number(cell.dataset.row) <= rows && Number(cell.dataset.col) <= cols;
    cell.classList.toggle('picked', picked);
  });
  els.tableGridSize.textContent = rows && cols ? fmt(LANG.memo.tableGridSizeLabel, { rows, cols }) : '';
}

function openTableModal() {
  buildTableGrid();
  setTablePickerPreview(0, 0);
  els.tableModalPasteHint.textContent = LANG.memo.tableModalPasteHint; // 지난번 "붙여넣을 표 없음" 오류문구가 남아있지 않게 초기화
  els.tableModal.hidden = false;
}

function closeTableModal() {
  els.tableModal.hidden = true;
}

// 고른 행/열 크기의 빈 표를 본문의 커서 자리에 넣음 (0.19.1: 별도 영역이 아니라 본문 안)
function confirmTablePicker() {
  if (tablePickerRows < 1 || tablePickerCols < 1) return;
  closeTableModal();
  els.content.focus();
  els.content.insertTable(tablePickerRows, tablePickerCols);
  scheduleSave();
  updateTableBar();
}

// 클립보드에 있는 표(엑셀 등에서 복사한 것)를 그대로 새 표로 붙여넣음.
// html에 <table>이 있으면 그걸 우선 파싱(칸 구분이 더 정확함), 없으면 text를
// 줄바꿈=행 / 탭=칸(TSV)으로 봄 — 엑셀/시트에서 칸을 복사하면 이 두 형식이 같이 클립보드에 담김
function parseClipboardTable(html, text) {
  if (html && /<table/i.test(html)) {
    try {
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const trs = Array.from(doc.querySelectorAll('table tr'));
      const htmlRows = trs
        .map((tr) => Array.from(tr.querySelectorAll('td,th')).map((cell) => cell.textContent.trim()))
        .filter((r) => r.length > 0);
      if (htmlRows.length) return padRowsToSameWidth(htmlRows);
    } catch (err) {
      // html 파싱이 실패하면 그냥 아래 일반 텍스트(TSV) 방식으로 넘어감
    }
  }
  const plain = (text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = plain.split('\n').filter((l) => l.length > 0);
  if (!lines.length) return null;
  return padRowsToSameWidth(lines.map((l) => l.split('\t')));
}

// 표는 모든 줄의 칸 수가 같아야 하므로, 가장 긴 줄 기준으로 짧은 줄 뒤를 빈 칸으로 채움
function padRowsToSameWidth(rows) {
  const maxCols = Math.max(...rows.map((r) => r.length));
  if (!maxCols) return null;
  return rows.map((r) => {
    const padded = r.slice(0, maxCols);
    while (padded.length < maxCols) padded.push('');
    return padded;
  });
}

els.tableModalPaste.addEventListener('click', async () => {
  const { html, text } = await window.api.pasteTable();
  const rows = parseClipboardTable(html, text);
  if (!rows) {
    els.tableModalPasteHint.textContent = LANG.memo.tableModalPasteEmptyError;
    return;
  }
  closeTableModal();
  els.content.focus();
  els.content.insertTable(0, 0, rows);
  scheduleSave();
  updateTableBar();
});

els.tableModalCancel.addEventListener('click', closeTableModal);
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (!els.tableModal.hidden) closeTableModal();
  else if (!els.imageAnnotateModal.hidden) closeImageAnnotator();
});

// ---- 첨부 이미지 그림그리기(선/화살표/번호): 첨부 이미지를 끌지 않고 그냥 클릭하면 열림 ----
// (attachDragHandlers의 onUp에서 dragged가 false일 때 openImageAnnotator를 호출함)
const ANNOTATE_SUPPORTED_EXT = ['.png', '.jpg', '.jpeg']; // gif/webp/svg는 원본 형식을 지켜야 해서 제외(자동 리사이즈 예외 목록과 같은 이유)
let annotateTarget = null; // 지금 그림 그리는 중인 첨부 객체(memo.attachments의 항목)
let annotateBaseImg = null; // 캔버스 배경으로 그릴, 이미 화면에 떠 있는 <img> 엘리먼트
let annotateStrokes = []; // 이번에 그린 도형들(선/화살표/번호) - 쌓인 순서 그대로 실행취소에도 씀
let annotateTool = 'line';
let annotateColor = '#ff3b30';
let annotateNumberNext = 1;

function attachmentExt(storedName) {
  const i = storedName.lastIndexOf('.');
  return i === -1 ? '' : storedName.slice(i).toLowerCase();
}

function openImageAnnotator(a, imgEl) {
  if (!ANNOTATE_SUPPORTED_EXT.includes(attachmentExt(a.storedName))) {
    els.statusText.textContent = LANG.memo.imageAnnotateUnsupported;
    setTimeout(() => (els.statusText.textContent = ''), 1800);
    return;
  }
  annotateTarget = a;
  annotateBaseImg = imgEl;
  annotateStrokes = [];
  annotateNumberNext = 1;
  annotateTool = 'line';
  annotateColor = '#ff3b30';
  updateAnnotateToolButtons();
  updateAnnotateColorButtons();
  els.imageAnnotateHint.textContent = LANG.memo.imageAnnotateHint; // 지난번 저장실패 문구가 남아있지 않게 초기화

  els.annotateCanvas.width = imgEl.naturalWidth;
  els.annotateCanvas.height = imgEl.naturalHeight;
  redrawAnnotateCanvas();

  els.imageAnnotateModal.hidden = false;
}

function closeImageAnnotator() {
  els.imageAnnotateModal.hidden = true;
  annotateTarget = null;
  annotateBaseImg = null;
  annotateStrokes = [];
}

function redrawAnnotateCanvas() {
  const cvs = els.annotateCanvas;
  const ctx = cvs.getContext('2d');
  ctx.clearRect(0, 0, cvs.width, cvs.height);
  if (annotateBaseImg) ctx.drawImage(annotateBaseImg, 0, 0, cvs.width, cvs.height);
  annotateStrokes.forEach((s) => drawAnnotateStroke(ctx, s));
}

// 선 굵기/번호 원 크기를 이미지 해상도에 비례하게 정해서, 이미지가 커도 작아도 눈에 잘 띄게 함
function annotateLineWidth(canvasWidth) {
  return Math.max(3, Math.round(canvasWidth / 260));
}

function drawAnnotateLine(ctx, x1, y1, x2, y2, color) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = annotateLineWidth(ctx.canvas.width);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  ctx.restore();
}

function drawAnnotateArrow(ctx, x1, y1, x2, y2, color) {
  const lw = annotateLineWidth(ctx.canvas.width);
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = lw;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();

  const headLen = Math.max(12, lw * 4.5);
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const spread = Math.PI / 7;
  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(x2 - headLen * Math.cos(angle - spread), y2 - headLen * Math.sin(angle - spread));
  ctx.lineTo(x2 - headLen * Math.cos(angle + spread), y2 - headLen * Math.sin(angle + spread));
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawAnnotateNumber(ctx, x, y, n, color) {
  const r = Math.max(14, Math.round(ctx.canvas.width / 40));
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.font = `700 ${Math.round(r * 1.15)}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(n), x, y + 1);
  ctx.restore();
}

function drawAnnotateStroke(ctx, s) {
  if (s.type === 'line') drawAnnotateLine(ctx, s.x1, s.y1, s.x2, s.y2, s.color);
  else if (s.type === 'arrow') drawAnnotateArrow(ctx, s.x1, s.y1, s.x2, s.y2, s.color);
  else if (s.type === 'number') drawAnnotateNumber(ctx, s.x, s.y, s.n, s.color);
}

// 화면에 보이는 캔버스 크기(CSS로 줄어들어 있음)와 캔버스 내부 실제 해상도가 서로 달라서,
// 마우스 좌표를 캔버스 내부 좌표로 환산해야 클릭한 자리에 정확히 그려짐
function annotateCanvasPoint(e) {
  const cvs = els.annotateCanvas;
  const rect = cvs.getBoundingClientRect();
  return {
    x: (e.clientX - rect.left) * (cvs.width / rect.width),
    y: (e.clientY - rect.top) * (cvs.height / rect.height)
  };
}

function updateAnnotateToolButtons() {
  [els.annotateToolLine, els.annotateToolArrow, els.annotateToolNumber].forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.tool === annotateTool);
  });
}

function updateAnnotateColorButtons() {
  els.annotateColorSwatches.forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.color === annotateColor);
  });
}

[els.annotateToolLine, els.annotateToolArrow, els.annotateToolNumber].forEach((btn) => {
  btn.addEventListener('click', () => {
    annotateTool = btn.dataset.tool;
    updateAnnotateToolButtons();
  });
});

els.annotateColorSwatches.forEach((btn) => {
  btn.addEventListener('click', () => {
    annotateColor = btn.dataset.color;
    updateAnnotateColorButtons();
  });
});

// 되돌리기: 마지막으로 그린 도형 하나만 지움(캔버스를 처음부터 다시 그려서 구현 — 그래서 항상 정확함).
// 방금 지운 게 마지막 번호였으면, 다음 번호도 한 칸 되돌려서 번호가 다시 이어지게 함
els.annotateUndo.addEventListener('click', () => {
  const last = annotateStrokes[annotateStrokes.length - 1];
  if (!last) return;
  if (last.type === 'number' && last.n === annotateNumberNext - 1) annotateNumberNext -= 1;
  annotateStrokes.pop();
  redrawAnnotateCanvas();
});

// 번호 도구는 클릭 한 번으로 바로 찍히고(누를 때마다 다음 숫자), 선/화살표는 눌러서 끈 채
// 움직이는 동안 미리보기를 보여주다가 손을 떼는 순간 확정됨
els.annotateCanvas.addEventListener('mousedown', (e) => {
  if (!annotateTarget) return;
  e.preventDefault();
  const start = annotateCanvasPoint(e);

  if (annotateTool === 'number') {
    annotateStrokes.push({ type: 'number', x: start.x, y: start.y, n: annotateNumberNext, color: annotateColor });
    annotateNumberNext += 1;
    redrawAnnotateCanvas();
    return;
  }

  function onMove(ev) {
    const cur = annotateCanvasPoint(ev);
    redrawAnnotateCanvas();
    const ctx = els.annotateCanvas.getContext('2d');
    if (annotateTool === 'arrow') drawAnnotateArrow(ctx, start.x, start.y, cur.x, cur.y, annotateColor);
    else drawAnnotateLine(ctx, start.x, start.y, cur.x, cur.y, annotateColor);
  }
  function onUp(ev) {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    const end = annotateCanvasPoint(ev);
    if (Math.hypot(end.x - start.x, end.y - start.y) < 4) { redrawAnnotateCanvas(); return; } // 거의 제자리(클릭 실수)면 무시
    annotateStrokes.push({ type: annotateTool, x1: start.x, y1: start.y, x2: end.x, y2: end.y, color: annotateColor });
    redrawAnnotateCanvas();
  }
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
});

els.imageAnnotateCancel.addEventListener('click', closeImageAnnotator);

els.imageAnnotateSave.addEventListener('click', async () => {
  if (!annotateTarget) return;
  const base64 = els.annotateCanvas.toDataURL('image/png').split(',')[1];
  const ok = await window.api.overwriteAttachmentImage(annotateTarget.storedName, base64);
  if (!ok) {
    els.imageAnnotateHint.textContent = LANG.memo.imageAnnotateSaveError;
    return;
  }
  // 파일을 덮어썼으므로 주소 뒤 번호를 올려 브라우저가 옛 그림을 다시 쓰지 않게 함
  imageVersion.set(annotateTarget.storedName, (imageVersion.get(annotateTarget.storedName) || 0) + 1);
  closeImageAnnotator();
  markExportDirty();
  renderAttachments();
});

function renderSpecialChars(chars) {
  const list = Array.isArray(chars) ? chars : [];
  els.specialCharGroup.innerHTML = '';
  els.specialCharSep.hidden = list.length === 0;
  list.forEach((ch) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.title = fmt(LANG.memo.specialCharInsertTitle, { ch });
    btn.textContent = ch;
    btn.addEventListener('click', () => insertAtCursor(ch));
    els.specialCharGroup.appendChild(btn);
  });
}

window.api.onSettingsUpdated(async () => {
  const s = await window.api.getSettings();
  confirmMemoDelete = s.confirmMemoDelete !== false;
  autoExportObsidian = !!s.autoExportObsidian;
  mdFeatureEnabled = s.mdFeatureEnabled !== false;
  hasSeenImageResizeNotice = !!s.hasSeenImageResizeNotice;
  applyMdFeatureState();
  renderSpecialChars(s.specialChars);
});

// MD/옵시디언 관련 UI(서식버튼, 메모연결, MD내보내기, 처리방식버튼)를 통째로 켜고 끔.
// 꺼지면 자리를 비우지 않고 display:none으로 없애서 남은 버튼들이 자동으로 당겨붙음(memo.css 참고)
function applyMdFeatureState() {
  document.body.classList.toggle('md-off', !mdFeatureEnabled);
  // MD 기능을 끄면 서식을 그리지 않고 원문 그대로 보여줌(내용은 어느 쪽이든 동일)
  if (els.content && els.content.refresh) els.content.refresh();
}

// ---- 첨부파일 ----

async function handleAttach() {
  const files = await window.api.pickAttachments();
  for (const file of files) {
    await window.api.addAttachment(memo.id, file);
    memo.attachments.push(file);
  }
  markExportDirty();
  // 먼저 파일 경로를 다 읽어둬야(await) 본문에 넣는 순간 그림이 보임
  await renderAttachments();
  files.forEach((file) => { if (file.isImage) insertImageAtCursor(file); });
  if (files.some((file) => file.isImage)) maybeShowImageResizeNotice();
}

/* ---- 본문 안 이미지 (3단계, 0.19.2) ------------------------------------
   0.19.1까지는 이미지가 본문과 완전히 별개였다 — canvas-layer 위에 절대좌표로
   얹혀 있어서 글을 써도 안 밀렸고, 아무 데나 끌어다 놓을 수 있었다.

   [태훈님 확정 2026-08-15] 자유 배치를 버리고 전부 본문 줄로 바꿈.
   마크다운에는 "x=120, y=340"을 적을 칸이 없어서 자유 배치는 md로 저장할 방법이
   아예 없기 때문(표 열 폭 때와 같은 결론). 이제 이미지는 본문의 "![[그림.png|400]]"
   한 줄이고, 글을 쓰면 같이 밀린다.

   여기서 하는 일은 "파일 이름 → 화면에 띄울 주소"를 mdeditor에 알려주는 것뿐이다.
   실제로 그리는 건 mdeditor.js가 한다.
   ---------------------------------------------------------------------- */

// 이름 → file:// 주소. 그림 그리기로 파일을 덮어쓰면 imageVersion을 올려서 새로 읽게 함.
// 매번 Date.now()를 붙이지 않는 이유: 줄을 다시 그릴 때마다 그림을 새로 내려받아 깜빡임
const imagePaths = new Map();
const imageVersion = new Map();

createMdEditor.setImageResolver((name) => {
  const p = imagePaths.get(name);
  if (!p) return '';
  const v = imageVersion.get(name) || 0;
  return `file://${p}${v ? `?v=${v}` : ''}`;
});

// 본문 안 그림을 누르면 예전과 똑같이 그림그리기(선·화살표·번호) 창이 열림.
// 그린 내용은 이미지 파일 자체에 구워져 저장되므로 본문 안으로 들어와도 그대로 동작함
if (els.content && els.content.setImageClick) {
  els.content.setImageClick((name, imgEl) => {
    if (locked) return;
    const a = (memo.attachments || []).find((x) => x.storedName === name);
    if (a) openImageAnnotator(a, imgEl);
  });
}

// 첨부 이미지들의 실제 경로를 미리 읽어둠(그리기는 동기라서 미리 있어야 함)
async function loadImagePaths() {
  for (const a of memo.attachments || []) {
    if (!a.isImage || imagePaths.has(a.storedName)) continue;
    const p = await window.api.getAttachmentPath(a.storedName);
    if (p) imagePaths.set(a.storedName, p);
  }
}

async function renderAttachments() {
  els.attachmentStrip.innerHTML = '';
  rememberBodyImages();
  await loadImagePaths();
  // 이미지가 아닌 파일만 아래 첨부 줄에 남음(이미지는 본문 안으로 들어갔음)
  for (const a of memo.attachments) {
    if (!a.isImage) renderFileChip(a);
  }
  if (els.content && els.content.refresh) els.content.refresh();
}

/* 본문에서 그림 줄을 지우면 그림도 완전히 지움 (태훈님 확정 2026-08-15).
   0.19.1까지는 그림에 ✕ 버튼이 붙어 있었지만, 이제 그림은 본문의 한 줄이므로
   "줄을 지우는 것 = 그림을 지우는 것"으로 통일했다.

   지우는 시점을 저장(0.5초 뒤)에 맞춘 이유: 실수로 지웠을 때 바로 Ctrl+Z를 누르면
   저장이 미뤄지면서 파일까지 지워지는 일을 피할 수 있음.
   [가장 중요한 안전장치] "한 번이라도 본문에 있었던 그림"만 지운다(bodyImages).
   변환이 건너뛰어진 메모는 처음부터 본문에 그림 줄이 없으므로 이 목록이 비어 있고,
   따라서 첨부가 통째로 지워지는 사고가 구조적으로 일어날 수 없다. */
const bodyImages = new Set();

function rememberBodyImages() {
  const re = /!\[\[([^\[\]|\n]+?)(?:\|\d+)?\]\]/g;
  let m;
  while ((m = re.exec(memo.content || ''))) bodyImages.add(m[1].trim());
}

async function pruneUnusedImages() {
  const body = memo.content || '';
  const gone = (memo.attachments || []).filter(
    (a) => a && a.isImage && a.storedName
      && bodyImages.has(a.storedName)
      && !body.includes(`![[${a.storedName}`)
  );
  if (!gone.length) return;
  for (const a of gone) {
    const updated = await window.api.removeAttachment(memo.id, a.storedName);
    if (updated) memo.attachments = updated.attachments || [];
    bodyImages.delete(a.storedName);
    imagePaths.delete(a.storedName);
    imageVersion.delete(a.storedName);
  }
  markExportDirty();
}

// 새 이미지를 본문 커서 자리에 넣음. 폭은 안 적음(원본 크기, 메모창 폭까지만)
function insertImageAtCursor(attachment) {
  if (!attachment || !attachment.isImage) return;
  if (!els.content || !els.content.insertImage) return;
  els.content.focus();
  els.content.insertImage(attachment.storedName);
  memo.content = els.content.value;
  bodyImages.add(attachment.storedName);
  scheduleSave();
}

function renderFileChip(a) {
  const item = document.createElement('div');
  item.className = 'attachment-item';

  const chip = document.createElement('span');
  chip.className = 'attachment-file';

  const clipIcon = document.createElement('span');
  clipIcon.className = 'attachment-file-icon';
  clipIcon.textContent = '📎';
  chip.appendChild(clipIcon);

  const nameSpan = document.createElement('span');
  nameSpan.className = 'attachment-file-name';
  nameSpan.textContent = a.originalName;
  chip.appendChild(nameSpan);

  item.appendChild(chip);

  const removeBtn = document.createElement('button');
  removeBtn.className = 'attachment-remove';
  removeBtn.title = LANG.memo.fileAttachDeleteTitle;
  removeBtn.textContent = '×';
  removeBtn.addEventListener('click', () => handleRemoveAttachment(a.storedName));
  item.appendChild(removeBtn);

  els.attachmentStrip.appendChild(item);
}

// 첨부 삭제: 데이터/본문 참조/실제 파일을 함께 제거 (memos:removeAttachment 처리 결과로 로컬 상태 동기화)
function handleRemoveAttachment(storedName) {
  openConfirmModal(LANG.memo.removeAttachmentConfirmTitle, '', async () => {
    const updated = await window.api.removeAttachment(memo.id, storedName);
    if (updated) {
      memo.attachments = updated.attachments || [];
      memo.content = updated.content;
      els.content.value = memo.content;
    }
    markExportDirty();
    renderAttachments();
  }, LANG.memo.common.delete);
}

// ---- 닫기 ----

els.btnClose.addEventListener('click', () => {
  window.api.closeMemoWindow(memo.id);
});

// ---- 같은 주제로 새 메모 ----

els.btnNewMemo.addEventListener('click', () => {
  window.api.createNewMemo(memo.topicId || null);
});

// ---- 전체 내용 복사 ----

els.btnCopy.addEventListener('click', async () => {
  const ok = await window.api.copyText(fullTextWithChecklist());
  els.statusText.textContent = ok ? LANG.memo.copiedStatus : LANG.memo.copyFailedStatus;
  setTimeout(() => (els.statusText.textContent = ''), 1200);
});

// ---- 삭제 ----

els.btnDelete.addEventListener('click', () => {
  if (confirmMemoDelete) {
    openConfirmModal(
      LANG.memo.deleteConfirmTitle,
      LANG.memo.deleteConfirmHint,
      async () => { await window.api.deleteMemo(memo.id); },
      LANG.memo.common.delete
    );
    return;
  }
  window.api.deleteMemo(memo.id);
});

// ---- MD내보내기 ----

// Electron은 window.prompt()를 지원하지 않아(호출해도 그냥 null이 즉시 반환되어
// 버튼을 눌러도 아무 반응이 없는 것처럼 보임) 파일명 입력을 자체 모달로 구현함
els.btnExport.addEventListener('click', async () => {
  // 이미 한 번 내보낸 적 있는 메모면(그리고 그 뒤로 수정이 있어서 버튼이 다시 눌린 상태라면)
  // 파일명을 새로 정할 필요 없이 그 파일에 바로 덮어씀 — 모달도 안 띄움
  if (memo.obsidian && memo.obsidian.saved) {
    try {
      const result = await window.api.exportToObsidian(memo.id, undefined, []);
      els.statusText.textContent = fmt(LANG.memo.exportDoneOverwrite, { fileName: result.fileName });
      memo.obsidian = { saved: true, filePath: result.filePath };
      exportUpToDate = true;
      renderExportButtonState();
    } catch (err) {
      els.statusText.textContent = fmt(LANG.memo.saveFailed, { message: err.message });
    }
    return;
  }

  // 파일명 규칙: 주제_제목(없으면 제목없음)_YYYYMMDD_001 (날짜 바뀌면 001부터 다시)
  const suggested = await window.api.suggestObsidianFileName(memo.id);
  const fallback = (els.content.value.split('\n')[0] || LANG.memo.untitledFallback).trim();

  // 설정에서 "자동 내보내기"를 켜뒀으면, 확인창 없이 규칙대로 바로 저장함
  if (autoExportObsidian) {
    try {
      const result = await window.api.exportToObsidian(memo.id, suggested || fallback, []);
      els.statusText.textContent = fmt(LANG.memo.exportDone, { fileName: result.fileName });
      memo.obsidian = { saved: true, filePath: result.filePath };
      exportUpToDate = true;
      renderExportButtonState();
    } catch (err) {
      els.statusText.textContent = fmt(LANG.memo.saveFailed, { message: err.message });
    }
    return;
  }

  els.exportFileNameInput.value = suggested || fallback;
  els.exportModal.hidden = false;
  els.exportFileNameInput.focus();
  els.exportFileNameInput.select();
});

function closeExportModal() {
  els.exportModal.hidden = true;
}

els.exportModalCancel.addEventListener('click', closeExportModal);

els.exportModalConfirm.addEventListener('click', async () => {
  const fileName = els.exportFileNameInput.value.trim();
  closeExportModal();
  try {
    const result = await window.api.exportToObsidian(memo.id, fileName, []);
    els.statusText.textContent = fmt(LANG.memo.exportDone, { fileName: result.fileName });
    memo.obsidian = { saved: true, filePath: result.filePath };
    exportUpToDate = true;
    renderExportButtonState();
  } catch (err) {
    els.statusText.textContent = fmt(LANG.memo.saveFailed, { message: err.message });
  }
});

els.exportFileNameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    els.exportModalConfirm.click();
  } else if (e.key === 'Escape') {
    closeExportModal();
  }
});

// ---- 링크 URL 입력 모달 (툴바의 링크 버튼) ----

function closeLinkModal() {
  els.linkModal.hidden = true;
  pendingLinkRange = null;
}

els.linkModalCancel.addEventListener('click', closeLinkModal);

els.linkModalConfirm.addEventListener('click', () => {
  const url = els.linkUrlInput.value.trim();
  const range = pendingLinkRange;
  closeLinkModal();
  if (!url || !range) return;
  const ta = els.content;
  const selected = ta.value.slice(range.start, range.end);
  ta.focus();
  ta.setRangeText(`[${selected}](${url})`, range.start, range.end, 'end');
  scheduleSave();
});

els.linkUrlInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    els.linkModalConfirm.click();
  } else if (e.key === 'Escape') {
    closeLinkModal();
  }
});

// ---- 메모 연결(이미 내보낸 다른 메모로 [[링크]] 걸기) 모달 ----
// 옵시디언 문법을 몰라도 목록에서 클릭 한 번이면 정확한 파일명으로 링크가 걸리게 하는 기능.
// 아직 한 번도 내보내지 않은 메모는 정확한 파일명을 몰라서 목록에 안 나옴(단방향 안내만 함)

// (수정) 원래는 링크 버튼 눌렀을 때 커서 있던 자리에 꽂았는데, 단어/문장 중간에 끼어들어가
// 글이 깨지는 문제가 있었음. 그래서 커서 위치는 아예 안 쓰고, 항상 본문 맨 아래 새 줄에
// 붙이는 방식으로 통일함(관련 메모 링크들이 본문 아래 한곳에 모여있는 모양이 됨)
function openMemoLinkPopup() {
  window.api.openMemoLinkWindow(memo.id);
}

async function insertMemoLink(fileNameNoExt) {
  const ta = els.content;
  const link = `[[${fileNameNoExt}]]`;
  const current = ta.value;
  const separator = !current || current.endsWith('\n') ? '' : '\n';
  ta.value = current + separator + link;
  ta.focus();
  const end = ta.value.length;
  ta.setSelectionRange(end, end);
  memo.content = ta.value;
  markExportDirty();

  // 원래는 scheduleSave()로 0.5초 뒤에 저장했는데, 이미 한 번 내보낸 메모면 바로 이어서
  // 재내보내기를 하기 때문에 그 0.5초를 기다리면 안 됨(기다리면 방금 붙인 링크 문장이
  // 빠진 옛날 내용으로 내보내질 위험이 있음) — 그래서 지연 저장 대신 여기서 즉시 저장을
  // 확정한 뒤에 내보내기를 이어감
  clearTimeout(saveTimer);
  await window.api.updateMemoContent(memo.id, memo.content);

  // 이미 한 번 MD로 내보낸 메모라면, 링크가 추가된 최신 내용으로 바로 재내보내기해서
  // 파일을 최신 상태로 맞춰줌 — 버튼을 다시 누르게 하지 않고 여기서 끝내기 때문에,
  // 내보내기가 이미 끝난 상태이므로 버튼은 계속 비활성 상태로 유지됨
  if (memo.obsidian && memo.obsidian.saved) {
    try {
      const result = await window.api.exportToObsidian(memo.id, undefined, []);
      els.statusText.textContent = fmt(LANG.memo.exportDoneOverwrite, { fileName: result.fileName });
      memo.obsidian = { saved: true, filePath: result.filePath };
      exportUpToDate = true;
      renderExportButtonState();
    } catch (err) {
      els.statusText.textContent = fmt(LANG.memo.saveFailed, { message: err.message });
    }
  }
}

window.api.onMemoLinkSelected((fileNameNoExt) => insertMemoLink(fileNameNoExt));

// ---- 다른 주제로 이동 ----
// 메모지 안에 갇혀 있던 모달이었으나, 주제가 많으면 고르기 힘들다는 문제로
// 메모 연결 팝업과 같은 방식의 별도 작은 창(renderer/moveTopic)으로 분리함.
// 이 창(메모지)은 그 팝업에서 뭘 골랐는지만 이벤트로 전달받아 실제 이동 처리를 함

els.btnMoveTopic.addEventListener('click', () => {
  window.api.openMoveTopicWindow(memo.id);
});

window.api.onMoveTopicSelected((topicId) => moveToTopic(topicId));

async function moveToTopic(topicId) {
  const updated = await window.api.moveMemoToTopic(memo.id, topicId);
  if (!updated) return;
  memo.topicId = updated.topicId;
  memo.color = updated.color;
  applyAccentColor(memo.color);
  els.colorPicker.value = memo.color;
  markExportDirty(); // 주제가 바뀌면 MD내보내기의 태그도 바뀌므로 다시 내보내야 함
}

// 이 파일엔 escapeHtml 헬퍼가 따로 없어서, 목록에 이름 그대로 넣지 않고 안전하게 이스케이프해줌
// (아래 템플릿 저장 모달에서 씀 — 주제 이동은 별도 창(renderer/moveTopic)으로 분리되며 그쪽에 자기만의 사본을 둠)
function escapeHtmlSafe(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}

// ---- 템플릿으로 저장 모달 ----
// 예전엔 "이동 모달과 같은 UI 패턴"이었으나, 이동은 별도 창으로 분리됨. 템플릿 저장은
// 지금 속한 주제도 목록에 포함시킴(같은 주제에 템플릿을 저장하는 것도 자연스러운 사용법이라 뺄 이유가 없음)

async function openTemplateModal() {
  const topics = await window.api.getTopics();
  renderTemplateTopicList(topics);
  els.templateModal.hidden = false;
}

function closeTemplateModal() {
  els.templateModal.hidden = true;
}

function renderTemplateTopicList(topics) {
  els.templateTopicList.innerHTML = '';
  if (!topics.length) {
    const empty = document.createElement('div');
    empty.className = 'memo-link-empty';
    empty.textContent = LANG.memo.templateEmpty;
    els.templateTopicList.appendChild(empty);
    return;
  }
  topics.forEach((t) => {
    const item = document.createElement('div');
    item.className = 'memo-link-item move-topic-item';
    item.innerHTML = `
      <span class="swatch" style="background:${t.color};color:${t.textColor || '#FFFFFF'}">${escapeHtmlSafe(t.iconChar || '')}</span>
      <span>${escapeHtmlSafe(t.name)}</span>
    `;
    item.addEventListener('click', () => saveAsTemplate(t.id));
    els.templateTopicList.appendChild(item);
  });
}

async function saveAsTemplate(topicId) {
  const updated = await window.api.saveMemoAsTemplate(memo.id, topicId);
  closeTemplateModal();
  els.statusText.textContent = updated ? LANG.memo.templateSaved : LANG.memo.templateSaveFailed;
  setTimeout(() => (els.statusText.textContent = ''), 1200);
}

els.btnSaveTemplate.addEventListener('click', openTemplateModal);
els.templateModalCancel.addEventListener('click', closeTemplateModal);

// ---- txt로 저장 ----

els.btnExportTxt.addEventListener('click', async () => {
  const suggested = (els.content.value.split('\n')[0] || LANG.memo.untitledFallback).trim();
  const result = await window.api.exportTxt(fullTextWithChecklist(), suggested);
  if (result) {
    els.statusText.textContent = fmt(LANG.memo.txtExportDone, { fileName: result.fileName });
  }
});

// ---- txt/md 불러오기 ----

els.btnImport.addEventListener('click', async () => {
  const result = await window.api.importTextFile();
  if (!result) return;

  const applyImport = () => {
    els.content.value = result.content;
    scheduleSave();
    els.statusText.textContent = fmt(LANG.memo.importDone, { fileName: result.fileName });
  };

  if (els.content.value.trim()) {
    openConfirmModal(
      LANG.memo.importOverwriteConfirmTitle,
      '',
      async () => applyImport(),
      LANG.memo.importOverwriteButton
    );
    return;
  }
  applyImport();
});
