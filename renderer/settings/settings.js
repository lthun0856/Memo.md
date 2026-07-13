let settings = null;
let topics = [];
let categories = [];
let trash = [];
let openEditId = null;

// main.js의 TRASH_RETENTION_DAYS와 반드시 같은 값으로 맞춰야 함(화면에 보여주는 표시용 숫자일 뿐,
// 실제 자동삭제 판단은 main.js에서 함)
const TRASH_RETENTION_DAYS = 60;

// (수정) '위젯에서 숨기기' 옵션은 효용성이 없다고 판단해서 목록에서 제거함
const GESTURE_ACTIONS = [
  { value: 'none', label: LANG.settings.widgetTab.gestureNone },
  { value: 'list', label: LANG.settings.widgetTab.gestureList },
  { value: 'expandAll', label: LANG.settings.widgetTab.gestureExpandAll },
  { value: 'newMemo', label: LANG.settings.widgetTab.gestureNewMemo }
];

const els = {
  vaultPath: document.getElementById('vaultPath'),
  btnChooseVault: document.getElementById('btnChooseVault'),
  autoLaunch: document.getElementById('autoLaunch'),
  multiMode: document.getElementById('multiMode'),
  confirmMemoDelete: document.getElementById('confirmMemoDelete'),
  postSaveKeep: document.getElementById('postSaveKeep'),
  postSaveDelete: document.getElementById('postSaveDelete'),
  widgetAutoResize: document.getElementById('widgetAutoResize'),
  widgetWidth: document.getElementById('widgetWidth'),
  widgetHeight: document.getElementById('widgetHeight'),
  gestureSingle: document.getElementById('gestureSingle'),
  gestureDouble: document.getElementById('gestureDouble'),
  widgetTitlebarColor: document.getElementById('widgetTitlebarColor'),
  opacityRange: document.getElementById('opacityRange'),
  opacityValue: document.getElementById('opacityValue'),
  newMemoShortcutInput: document.getElementById('newMemoShortcutInput'),
  btnClearShortcut: document.getElementById('btnClearShortcut'),
  btnExportAll: document.getElementById('btnExportAll'),
  exportAllStatus: document.getElementById('exportAllStatus'),
  btnRestoreBackup: document.getElementById('btnRestoreBackup'),
  restoreStatus: document.getElementById('restoreStatus'),
  btnSweepAttachments: document.getElementById('btnSweepAttachments'),
  sweepStatus: document.getElementById('sweepStatus'),
  autoBackupEnabled: document.getElementById('autoBackupEnabled'),
  autoBackupFolder: document.getElementById('autoBackupFolder'),
  btnChooseBackupFolder: document.getElementById('btnChooseBackupFolder'),
  autoBackupInterval: document.getElementById('autoBackupInterval'),
  mdFeatureEnabled: document.getElementById('mdFeatureEnabled'),
  ruleAutoExport: document.getElementById('ruleAutoExport'),
  ruleIncludeTopic: document.getElementById('ruleIncludeTopic'),
  ruleIncludeTitle: document.getElementById('ruleIncludeTitle'),
  ruleIncludeDate: document.getElementById('ruleIncludeDate'),
  ruleIncludeSeq: document.getElementById('ruleIncludeSeq'),
  ruleSeparator: document.getElementById('ruleSeparator'),
  ruleExample: document.getElementById('ruleExample'),
  specialCharCount: document.getElementById('specialCharCount'),
  specialCharInputs: document.getElementById('specialCharInputs'),
  categoryList: document.getElementById('categoryList'),
  newCategoryName: document.getElementById('newCategoryName'),
  btnAddCategory: document.getElementById('btnAddCategory'),
  categoryNameError: document.getElementById('categoryNameError'),
  trashList: document.getElementById('trashList'),
  btnEmptyTrash: document.getElementById('btnEmptyTrash'),
  topicList: document.getElementById('topicList'),
  newTopicName: document.getElementById('newTopicName'),
  newTopicDesc: document.getElementById('newTopicDesc'),
  newTopicDefaultTitle: document.getElementById('newTopicDefaultTitle'),
  topicNameError: document.getElementById('topicNameError'),
  newTopicParent: document.getElementById('newTopicParent'),
  newTopicChar: document.getElementById('newTopicChar'),
  newTopicColor: document.getElementById('newTopicColor'),
  newTopicTextColor: document.getElementById('newTopicTextColor'),
  newTopicMemoColor: document.getElementById('newTopicMemoColor'),
  btnAddTopic: document.getElementById('btnAddTopic'),
  btnSave: document.getElementById('btnSave'),
  btnApply: document.getElementById('btnApply'),
  btnCancel: document.getElementById('btnCancel'),
  saveStatus: document.getElementById('saveStatus'),
  tabBtns: document.querySelectorAll('.tab-btn'),
  tabPanels: document.querySelectorAll('.tab-panel'),
  confirmModal: document.getElementById('confirmModal'),
  confirmModalTitle: document.getElementById('confirmModalTitle'),
  confirmModalHint: document.getElementById('confirmModalHint'),
  confirmModalCancel: document.getElementById('confirmModalCancel'),
  confirmModalConfirm: document.getElementById('confirmModalConfirm')
};

// 문구 안의 {name} 같은 자리표시자를 실제 값으로 바꿔주는 도우미
function fmt(str, vars) {
  return str.replace(/\{(\w+)\}/g, (_, key) => vars[key]);
}

// ---- 다국어 문구 적용(지금은 한국어 파일만 있음) ----
function applyLang() {
  const S = LANG.settings;
  document.title = S.windowTitle;

  document.getElementById('tabBtnTopics').textContent = S.tabs.topics;
  document.getElementById('tabBtnGeneral').textContent = S.tabs.general;
  document.getElementById('tabBtnWidget').textContent = S.tabs.widget;
  document.getElementById('tabBtnMd').textContent = S.tabs.md;
  document.getElementById('tabBtnEdit').textContent = S.tabs.edit;
  document.getElementById('tabBtnTrash').textContent = S.tabs.trash;
  document.getElementById('tabBtnHelp').textContent = S.tabs.help;

  els.btnCancel.textContent = S.saveBar.cancel;
  els.btnApply.textContent = S.saveBar.apply;
  els.btnSave.textContent = S.saveBar.save;
  els.confirmModalCancel.textContent = S.common.confirmCancel;
  els.confirmModalConfirm.textContent = S.common.confirmConfirm;

  const T = S.topics;
  document.getElementById('topicsHeading').textContent = T.heading;
  document.getElementById('topicMainHint').innerHTML = T.mainHint;
  document.getElementById('topicMdTipHint').innerHTML = T.mdTipHint;
  document.getElementById('categoryFieldLabel').textContent = T.categoryFieldLabel;
  els.newCategoryName.placeholder = T.newCategoryPlaceholder;
  els.btnAddCategory.textContent = T.addCategoryButton;
  document.getElementById('topicEditNameHint').textContent = T.editNameHint;
  document.getElementById('newTopicParentLabel').textContent = T.parentFieldLabel;
  document.getElementById('newTopicNameLabel').textContent = T.nameFieldLabel;
  els.newTopicName.placeholder = T.namePlaceholder;
  document.getElementById('newTopicDescLabel').textContent = T.descFieldLabel;
  els.newTopicDesc.placeholder = T.descPlaceholder;
  document.getElementById('newTopicDefaultTitleLabel').textContent = T.defaultTitleFieldLabel;
  els.newTopicDefaultTitle.placeholder = T.defaultTitlePlaceholder;
  document.getElementById('newTopicCharLabel').textContent = T.charFieldLabel;
  els.newTopicChar.placeholder = T.charPlaceholder;
  document.getElementById('newTopicColorLabel').textContent = T.iconBgLabel;
  document.getElementById('newTopicTextColorLabel').textContent = T.iconTextLabel;
  document.getElementById('newTopicMemoColorLabel').textContent = T.memoBgLabel;
  els.btnAddTopic.textContent = T.addTopicButton;

  const G = S.general;
  document.getElementById('generalHeading').textContent = G.heading;
  document.getElementById('autoLaunchLabel').textContent = G.autoLaunchLabel;
  document.getElementById('multiModeLabel').textContent = G.multiModeLabel;
  document.getElementById('confirmMemoDeleteLabel').textContent = G.confirmMemoDeleteLabel;
  document.getElementById('shortcutHeading').textContent = G.shortcutHeading;
  document.getElementById('shortcutHint').textContent = G.shortcutHint;
  els.newMemoShortcutInput.placeholder = G.shortcutPlaceholder;
  els.btnClearShortcut.textContent = G.shortcutClearButton;
  document.getElementById('opacityHeading').textContent = G.opacityHeading;
  document.getElementById('opacityHint').textContent = G.opacityHint;
  document.getElementById('backupHeading').textContent = G.backupHeading;
  document.getElementById('backupHint1').textContent = G.backupHint1;
  els.btnExportAll.textContent = G.exportAllButton;
  document.getElementById('backupHint2').textContent = G.backupHint2;
  els.btnRestoreBackup.textContent = G.restoreButton;
  document.getElementById('backupHint3').textContent = G.backupHint3;
  document.getElementById('storageHeading').textContent = G.storageHeading;
  document.getElementById('storageHint').textContent = G.storageHint;
  els.btnSweepAttachments.textContent = G.sweepButton;
  document.getElementById('autoBackupHeading').textContent = G.autoBackupHeading;
  document.getElementById('autoBackupHint').textContent = G.autoBackupHint;
  document.getElementById('autoBackupEnabledLabel').textContent = G.autoBackupEnabledLabel;
  els.autoBackupFolder.placeholder = G.autoBackupFolderPlaceholder;
  els.btnChooseBackupFolder.textContent = G.chooseFolderButton;
  document.getElementById('intervalLabel').textContent = G.intervalLabel;
  document.getElementById('intervalDaily').textContent = G.intervalDaily;
  document.getElementById('interval12h').textContent = G.interval12h;
  document.getElementById('interval6h').textContent = G.interval6h;
  document.getElementById('intervalEveryLaunch').textContent = G.intervalEveryLaunch;

  const W = S.widgetTab;
  document.getElementById('widgetTabHeading').textContent = W.heading;
  document.getElementById('widgetColorGroupLabel').textContent = W.colorGroupLabel;
  document.getElementById('widgetTitlebarColorLabel').textContent = W.titlebarColorLabel;
  document.getElementById('widgetSizeGroupLabel').textContent = W.sizeGroupLabel;
  document.getElementById('widgetAutoResizeLabel').textContent = W.autoResizeLabel;
  document.getElementById('widgetWidthLabel').textContent = W.widthLabel;
  document.getElementById('widgetHeightLabel').textContent = W.heightLabel;
  document.getElementById('widgetGestureGroupLabel').textContent = W.gestureGroupLabel;
  document.getElementById('widgetSingleClickLabel').textContent = W.singleClickLabel;
  document.getElementById('widgetDoubleClickLabel').textContent = W.doubleClickLabel;
  document.getElementById('widgetGestureHint').innerHTML = W.gestureHint;

  const M = S.mdTab;
  document.getElementById('mdHeading').textContent = M.heading;
  document.getElementById('mdFeatureLabel').textContent = M.mdFeatureLabel;
  document.getElementById('mdFeatureHint').textContent = M.mdFeatureHint;
  document.getElementById('vaultHeading').textContent = M.vaultHeading;
  els.vaultPath.placeholder = M.vaultPlaceholder;
  els.btnChooseVault.textContent = M.chooseVaultButton;
  document.getElementById('postSaveHeading').textContent = M.postSaveHeading;
  document.getElementById('postSaveKeepLabel').textContent = M.postSaveKeepLabel;
  document.getElementById('postSaveDeleteLabel').textContent = M.postSaveDeleteLabel;
  document.getElementById('postSaveHint').textContent = M.postSaveHint;
  document.getElementById('exportModeHeading').textContent = M.exportModeHeading;
  document.getElementById('autoExportLabel').textContent = M.autoExportLabel;
  document.getElementById('autoExportHint').textContent = M.autoExportHint;
  document.getElementById('ruleHeading').textContent = M.ruleHeading;
  document.getElementById('ruleHint1').textContent = M.ruleHint1;
  document.getElementById('ruleHint2').innerHTML = M.ruleHint2;
  document.getElementById('includeTopicLabel').textContent = M.includeTopicLabel;
  document.getElementById('includeTitleLabel').textContent = M.includeTitleLabel;
  document.getElementById('includeDateLabel').textContent = M.includeDateLabel;
  document.getElementById('includeSeqLabel').textContent = M.includeSeqLabel;
  document.getElementById('separatorLabel').textContent = M.separatorLabel;
  document.getElementById('separatorUnderscore').textContent = M.separatorUnderscore;
  document.getElementById('separatorHyphen').textContent = M.separatorHyphen;
  document.getElementById('separatorSpace').textContent = M.separatorSpace;
  document.getElementById('exampleLabel').textContent = M.exampleLabel;

  const E = S.editTab;
  document.getElementById('editHeading').textContent = E.heading;
  document.getElementById('editHint').textContent = E.hint;
  document.getElementById('countLabel').textContent = E.countLabel;
  document.getElementById('refHeading').textContent = E.refHeading;
  document.getElementById('refHint').textContent = E.refHint;
  document.getElementById('refShapes').textContent = E.refShapes;
  document.getElementById('refArrows').textContent = E.refArrows;
  document.getElementById('refPunctuation').textContent = E.refPunctuation;
  document.getElementById('refBrackets').textContent = E.refBrackets;
  document.getElementById('refMath').textContent = E.refMath;
  document.getElementById('refNumbers').textContent = E.refNumbers;

  const R = S.trashTab;
  document.getElementById('trashHeading').textContent = R.heading;
  document.getElementById('trashHint').textContent = R.hint;
  els.btnEmptyTrash.textContent = R.emptyButton;
}
applyLang();

// ---- 탭 전환 ----
function switchTab(tabName) {
  els.tabBtns.forEach((btn) => btn.classList.toggle('active', btn.dataset.tab === tabName));
  els.tabPanels.forEach((panel) => panel.classList.toggle('active', panel.dataset.panel === tabName));
}
els.tabBtns.forEach((btn) => {
  btn.addEventListener('click', () => switchTab(btn.dataset.tab));
});
switchTab('topics');

function fillGestureOptions(selectEl, current) {
  selectEl.innerHTML = '';
  GESTURE_ACTIONS.forEach((a) => {
    const opt = document.createElement('option');
    opt.value = a.value;
    opt.textContent = a.label;
    selectEl.appendChild(opt);
  });
  // 예전 설정에 이제는 없는 값(예: 삭제된 '위젯에서 숨기기')이 남아있으면 기본값으로
  const valid = GESTURE_ACTIONS.some((a) => a.value === current);
  selectEl.value = valid ? current : 'none';
}

async function loadAll() {
  [settings, topics, categories, trash] = await Promise.all([
    window.api.getSettings(),
    window.api.getTopics(),
    window.api.getCategories(),
    window.api.getTrash()
  ]);
  fillForm();
  renderCategories();
  renderTopics();
  renderTrash();
}

function fillForm() {
  els.vaultPath.value = settings.vaultPath || '';
  els.autoLaunch.checked = !!settings.autoLaunch;
  els.multiMode.checked = !!settings.multiMode;
  els.confirmMemoDelete.checked = settings.confirmMemoDelete !== false;
  (settings.defaultPostSaveAction === 'delete' ? els.postSaveDelete : els.postSaveKeep).checked = true;
  els.widgetAutoResize.checked = !!settings.widget.autoResize;
  // 위젯이 지금 접혀있으면 settings.widget.width는 "접힘 상태에서 버튼 수에 맞춰 자동으로
  // 늘어난 임시 폭"일 수 있어서, 여기서는 항상 "펼친 상태의 진짜 폭"(expandedWidth)을 보여줌
  els.widgetWidth.value = settings.widget.expandedWidth || settings.widget.width;
  els.widgetHeight.value = settings.widget.height;
  els.widgetWidth.disabled = settings.widget.autoResize;
  els.widgetHeight.disabled = settings.widget.autoResize;
  fillGestureOptions(els.gestureSingle, settings.clickGesture.single);
  fillGestureOptions(els.gestureDouble, settings.clickGesture.double);
  els.widgetTitlebarColor.value = settings.widget.titlebarColor || '#2B2820';
  const opacity = typeof settings.opacity === 'number' ? settings.opacity : 100;
  els.opacityRange.value = opacity;
  els.opacityValue.textContent = `${opacity}%`;

  els.newMemoShortcutInput.value = settings.newMemoShortcut || '';

  els.mdFeatureEnabled.checked = settings.mdFeatureEnabled !== false;
  applyMdFeatureVisibility(els.mdFeatureEnabled.checked);

  const autoBackup = settings.autoBackup || {};
  els.autoBackupEnabled.checked = !!autoBackup.enabled;
  els.autoBackupFolder.value = autoBackup.folderPath || '';
  els.autoBackupInterval.value = String(
    typeof autoBackup.intervalHours === 'number' ? autoBackup.intervalHours : 24
  );

  els.ruleAutoExport.checked = !!settings.autoExportObsidian;

  const rule = settings.exportNameRule || {};
  els.ruleIncludeTopic.checked = rule.includeTopic !== false;
  els.ruleIncludeTitle.checked = rule.includeTitle !== false;
  els.ruleIncludeDate.checked = rule.includeDate !== false;
  els.ruleIncludeSeq.checked = rule.includeSeq !== false;
  els.ruleSeparator.value = typeof rule.separator === 'string' ? rule.separator : '_';
  updateRuleExample();

  const chars = Array.isArray(settings.specialChars) ? settings.specialChars : [];
  els.specialCharCount.value = chars.length;
  renderSpecialCharInputs(chars);
}

// 개수만큼 한 글자짜리 입력칸을 만들어줌. 개수를 줄였다 늘려도 이미 입력한 문자는 최대한 유지함
function renderSpecialCharInputs(chars) {
  const count = Math.max(0, Math.min(20, Number(els.specialCharCount.value) || 0));
  els.specialCharInputs.innerHTML = '';
  for (let i = 0; i < count; i++) {
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'special-char-input';
    input.maxLength = 4;
    input.placeholder = fmt(LANG.settings.editTab.charInputPlaceholder, { n: i + 1 });
    input.value = chars[i] || '';
    els.specialCharInputs.appendChild(input);
  }
}

function currentSpecialChars() {
  return Array.from(els.specialCharInputs.querySelectorAll('.special-char-input'))
    .map((i) => i.value.trim())
    .filter(Boolean);
}

els.specialCharCount.addEventListener('input', () => {
  renderSpecialCharInputs(currentSpecialChars());
});

els.opacityRange.addEventListener('input', () => {
  els.opacityValue.textContent = `${els.opacityRange.value}%`;
});

// ---- 단축키 입력 (키 조합을 눌러서 바로 Electron accelerator 문자열로 저장) ----

const SPECIAL_KEY_NAMES = {
  ' ': 'Space',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  Escape: 'Esc'
};
const MODIFIER_KEYS = ['Control', 'Shift', 'Alt', 'Meta'];

// 키보드 이벤트를 Electron accelerator 문자열로 변환. 조합키(Ctrl/Shift/Alt) 없이
// 일반 키 하나만 누른 경우는 다른 프로그램에서 오작동할 수 있어 무시함(null 반환)
function keyEventToAccelerator(e) {
  if (MODIFIER_KEYS.includes(e.key)) return null; // 조합키만 눌린 상태는 아직 완성되지 않은 입력
  if (!e.ctrlKey && !e.altKey && !e.metaKey) return null;

  const parts = [];
  if (e.ctrlKey) parts.push('Control');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  if (e.metaKey) parts.push('Meta');

  const mainKey = SPECIAL_KEY_NAMES[e.key] || (e.key.length === 1 ? e.key.toUpperCase() : e.key);
  parts.push(mainKey);
  return parts.join('+');
}

els.newMemoShortcutInput.addEventListener('keydown', (e) => {
  e.preventDefault();
  if (e.key === 'Backspace' || e.key === 'Delete') {
    els.newMemoShortcutInput.value = '';
    return;
  }
  const accel = keyEventToAccelerator(e);
  if (!accel) return;
  els.newMemoShortcutInput.value = accel;
});

els.btnClearShortcut.addEventListener('click', () => {
  els.newMemoShortcutInput.value = '';
});

// MD 기능 스위치: 주제관리의 "상위 주제" 드롭다운이 여기 연동돼서 실시간으로 보이거나 숨겨짐
function applyMdFeatureVisibility(enabled) {
  document.body.classList.toggle('md-disabled', !enabled);
}
els.mdFeatureEnabled.addEventListener('change', () => {
  applyMdFeatureVisibility(els.mdFeatureEnabled.checked);
});

// 파일명 규칙 미리보기: 실제 exporter.js와 같은 순서(주제 → 제목 → 날짜 → 번호)로 예시를 만들어 보여줌
function updateRuleExample() {
  const sep = els.ruleSeparator.value;
  const parts = [];
  if (els.ruleIncludeTopic.checked) parts.push(LANG.settings.mdTab.exampleTopic);
  if (els.ruleIncludeTitle.checked) parts.push(LANG.settings.mdTab.exampleTitle);
  if (els.ruleIncludeDate.checked) parts.push('20260714');
  let example = parts.length ? parts.join(sep) : LANG.settings.mdTab.exampleFallback;
  if (els.ruleIncludeSeq.checked) example += `${sep}001`;
  els.ruleExample.textContent = example;
}

[els.ruleIncludeTopic, els.ruleIncludeTitle, els.ruleIncludeDate, els.ruleIncludeSeq, els.ruleSeparator]
  .forEach((el) => el.addEventListener('change', updateRuleExample));

els.widgetAutoResize.addEventListener('change', () => {
  els.widgetWidth.disabled = els.widgetAutoResize.checked;
  els.widgetHeight.disabled = els.widgetAutoResize.checked;
});

els.btnChooseVault.addEventListener('click', async () => {
  const folder = await window.api.chooseVaultFolder();
  if (folder) els.vaultPath.value = folder;
});

// 전체 메모 내보내기(백업): 형식 선택 → 폴더 선택 → 주제별 하위폴더로 저장까지 main.js에서 처리
els.btnExportAll.addEventListener('click', async () => {
  els.exportAllStatus.textContent = '';
  const result = await window.api.exportAllMemos();
  if (!result || result.canceled) return;
  els.exportAllStatus.textContent = fmt(LANG.settings.general.exportAllDone, { count: result.count });
});

els.btnChooseBackupFolder.addEventListener('click', async () => {
  const folder = await window.api.chooseBackupFolder();
  if (folder) els.autoBackupFolder.value = folder;
});

// (정리) 예전엔 여기 알림도 네이티브 alert()로 띄우고 refocusWindow()로 포커스를 억지로
// 되돌리는 방식이었는데, 이 창(frame:true인 설정창)에서도 그 강제 포커스 복귀가 100%
// 먹지 않아서 "입력칸이 먹통되는" 문제가 재현됐음(카테고리/주제 이름을 비운 채 추가를
// 누르는 경우 등). confirm()을 openConfirmModal로 바꿨을 때와 같은 이유로, 이런 짧은
// 안내도 네이티브 창을 아예 안 띄우고 그 자리에 바로 빨간 안내문구를 보여주는 방식으로
// 바꿔서 이 문제 자체가 생길 수 없게 함(카테고리 추가/주제 추가 2곳)

// 네이티브 confirm() 대신 쓰는 자체 확인 모달(재사용 가능). 확인을 누르면 onConfirm을 실행함
let pendingConfirmAction = null;
function openConfirmModal(title, hint, onConfirm, confirmLabel) {
  els.confirmModalTitle.textContent = title;
  els.confirmModalHint.textContent = hint || '';
  els.confirmModalHint.hidden = !hint;
  els.confirmModalConfirm.textContent = confirmLabel || LANG.settings.common.confirmConfirm;
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

// 백업에서 복구: 항상 "추가"만 되고 기존 데이터는 안 건드리므로, 미리 한 번 안내함
els.btnRestoreBackup.addEventListener('click', () => {
  openConfirmModal(
    LANG.settings.general.restoreConfirmTitle,
    LANG.settings.general.restoreConfirmHint,
    restoreFromBackupNow
  );
});

async function restoreFromBackupNow() {
  els.restoreStatus.textContent = '';
  const result = await window.api.restoreFromBackup();
  if (!result || result.canceled) return;
  els.restoreStatus.textContent = fmt(LANG.settings.general.restoreDone, { count: result.count, topicCount: result.topicCount });
  // 새로 생긴 주제가 주제관리 목록에도 바로 보이게 다시 불러옴
  topics = await window.api.getTopics();
  renderTopics();
}

// 안 쓰는 첨부파일 정리: 지금 어떤 메모/템플릿에서도 참조하지 않는 파일만 골라 지움
els.btnSweepAttachments.addEventListener('click', async () => {
  els.sweepStatus.textContent = LANG.settings.general.sweepInProgress;
  const result = await window.api.sweepOrphanAttachments();
  if (!result) { els.sweepStatus.textContent = LANG.settings.general.sweepFailed; return; }
  els.sweepStatus.textContent = result.removed
    ? fmt(LANG.settings.general.sweepDone, { removed: result.removed, total: result.total })
    : LANG.settings.general.sweepNone;
});

// 새 주제 만들 때 "상위 주제"로 고를 수 있는 드롭다운을 카테고리 목록으로 채움.
// (카테고리는 실제 메모가 딸린 주제와 별개인 이름표라서, 주제를 지워도 이 목록은 그대로 유지됨)
function populateParentTopicOptions() {
  const current = els.newTopicParent.value;
  els.newTopicParent.innerHTML = `<option value="">${LANG.settings.topics.noParentOption}</option>`
    + categories.map((c) => `<option value="${escapeAttr(c.name)}">${escapeHtml(c.name)}</option>`).join('');
  els.newTopicParent.value = categories.some((c) => c.name === current) ? current : '';
}

// ---- 카테고리(상위주제) 목록 ----
function renderCategories() {
  populateParentTopicOptions();
  els.categoryList.innerHTML = '';
  if (!categories.length) {
    els.categoryList.innerHTML = `<p class="hint">${LANG.settings.topics.categoryEmptyHint}</p>`;
    return;
  }
  categories.forEach((c) => {
    const item = document.createElement('div');
    item.className = 'category-item';
    item.innerHTML = `<span class="name">${escapeHtml(c.name)}</span>`;
    const delBtn = document.createElement('button');
    delBtn.className = 'del-btn';
    delBtn.title = LANG.settings.common.delete;
    delBtn.textContent = '×';
    delBtn.addEventListener('click', () => {
      openConfirmModal(
        fmt(LANG.settings.topics.deleteCategoryConfirmTitle, { name: c.name }),
        LANG.settings.topics.deleteCategoryConfirmHint,
        async () => {
          categories = await window.api.deleteCategory(c.id);
          renderCategories();
        },
        LANG.settings.common.delete
      );
    });
    item.appendChild(delBtn);
    els.categoryList.appendChild(item);
  });
}

els.btnAddCategory.addEventListener('click', async () => {
  const name = els.newCategoryName.value.trim();
  if (!name) {
    els.categoryNameError.textContent = LANG.settings.topics.categoryNameRequiredError;
    els.categoryNameError.hidden = false;
    els.newCategoryName.focus();
    return;
  }
  els.categoryNameError.hidden = true;
  const added = await window.api.addCategory({ name });
  categories.push(added);
  renderCategories();
  els.newCategoryName.value = '';
});
els.newCategoryName.addEventListener('input', () => { els.categoryNameError.hidden = true; });

function renderTopics() {
  populateParentTopicOptions();
  els.topicList.innerHTML = '';
  if (!topics.length) {
    els.topicList.innerHTML = `<p class="hint">${LANG.settings.topics.topicEmptyHint}</p>`;
    return;
  }
  topics.forEach((t) => {
    const item = document.createElement('div');
    item.className = 'topic-item';

    const head = document.createElement('div');
    head.className = 'topic-item-head';
    head.innerHTML = `
      <div class="swatch" style="background:${t.color};color:${t.textColor || '#FFFFFF'}">${escapeHtml(t.iconChar || '')}</div>
      <div class="name">${escapeHtml(t.name)}${t.hidden ? LANG.settings.topics.hiddenSuffix : ''}</div>
      <div class="desc">${escapeHtml(t.description || '')}</div>
    `;
    const delBtn = document.createElement('button');
    delBtn.className = 'del-btn';
    delBtn.title = LANG.settings.common.delete;
    delBtn.textContent = '×';
    delBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      openConfirmModal(
        fmt(LANG.settings.topics.deleteTopicConfirmTitle, { name: t.name }),
        LANG.settings.topics.deleteTopicConfirmHint,
        async () => {
          topics = await window.api.deleteTopic(t.id);
          renderTopics();
        },
        LANG.settings.common.delete
      );
    });
    head.appendChild(delBtn);
    head.addEventListener('click', () => {
      openEditId = openEditId === t.id ? null : t.id;
      renderTopics();
    });
    item.appendChild(head);

    const editForm = buildEditForm(t);
    if (openEditId === t.id) editForm.classList.add('open');
    item.appendChild(editForm);

    els.topicList.appendChild(item);
  });
}

function buildEditForm(topic) {
  const form = document.createElement('div');
  form.className = 'topic-edit-form';
  const T = LANG.settings.topics;
  form.innerHTML = `
    <input type="text" class="edit-name" value="${escapeAttr(topic.name)}" placeholder="${escapeAttr(T.namePlaceholder)}" />
    <input type="text" class="edit-desc" value="${escapeAttr(topic.description || '')}" placeholder="${escapeAttr(T.editDescPlaceholder)}" />
    <input type="text" class="edit-defaulttitle" value="${escapeAttr(topic.defaultTitle || '')}" placeholder="${escapeAttr(T.editDefaultTitlePlaceholder)}" />
    <div class="row2">
      <input type="text" class="edit-char" maxlength="2" value="${escapeAttr(topic.iconChar || '')}" style="width:54px;text-align:center;" />
      <label class="mini-label">${escapeHtml(T.iconBgLabel)} <input type="color" class="edit-color" value="${topic.color || '#8A8574'}" /></label>
      <label class="mini-label">${escapeHtml(T.iconTextLabel)} <input type="color" class="edit-textcolor" value="${topic.textColor || '#FFFFFF'}" /></label>
    </div>
    <div class="row2">
      <label class="mini-label">${escapeHtml(T.memoBgLabel)} <input type="color" class="edit-memocolor" value="${topic.memoColor || topic.color || '#8A8574'}" /></label>
      <label class="mini-label"><input type="checkbox" class="edit-hidden" ${topic.hidden ? 'checked' : ''} /> ${escapeHtml(T.editHiddenLabel)}</label>
    </div>
    <div class="row2 row2-actions">
      <button class="edit-cancel" type="button" style="background:#8A8574;">${escapeHtml(T.editCancelButton)}</button>
      <button class="edit-save">${escapeHtml(T.editSaveButton)}</button>
    </div>
  `;

  form.querySelector('.edit-save').addEventListener('click', async () => {
    // (수정) 이 폼이 열려있는 동안 다른 창(메모창의 "템플릿으로 저장" 등)이 같은 주제를
    // 건드렸을 수 있어서, 저장 직전에 최신 주제 데이터를 다시 받아와 그 위에 폼 값만 얹음
    // (이 폼이 모르는 필드는 최신 값 그대로 유지됨 — main.js의 병합 저장과 이중 안전장치)
    const latestTopics = await window.api.getTopics();
    const latestTopic = latestTopics.find((t) => t.id === topic.id) || topic;
    const updated = {
      ...latestTopic,
      name: form.querySelector('.edit-name').value.trim() || topic.name,
      description: form.querySelector('.edit-desc').value.trim(),
      defaultTitle: form.querySelector('.edit-defaulttitle').value.trim(),
      iconChar: (form.querySelector('.edit-char').value.trim() || topic.iconChar || '').slice(0, 2),
      color: form.querySelector('.edit-color').value,
      textColor: form.querySelector('.edit-textcolor').value,
      memoColor: form.querySelector('.edit-memocolor').value,
      hidden: form.querySelector('.edit-hidden').checked
    };
    await window.api.updateTopic(updated);
    topics = await window.api.getTopics();
    openEditId = null;
    renderTopics();
  });

  form.querySelector('.edit-cancel').addEventListener('click', () => {
    openEditId = null;
    renderTopics();
  });

  return form;
}

els.btnAddTopic.addEventListener('click', async () => {
  const rawName = els.newTopicName.value.trim();
  if (!rawName) {
    els.topicNameError.textContent = LANG.settings.topics.topicNameRequiredError;
    els.topicNameError.hidden = false;
    els.newTopicName.focus();
    return;
  }
  els.topicNameError.hidden = true;
  // 상위 주제를 골랐으면 "상위/이름"으로 자동 조합(직접 슬래시를 안 쳐도 중첩 폴더/태그가 됨)
  const parentName = els.newTopicParent.value;
  const name = parentName ? `${parentName}/${rawName}` : rawName;
  const iconChar = (els.newTopicChar.value.trim() || rawName.slice(0, 2)).slice(0, 2);
  const topic = {
    name,
    description: els.newTopicDesc.value.trim(),
    defaultTitle: els.newTopicDefaultTitle.value.trim(),
    iconChar,
    color: els.newTopicColor.value,
    textColor: els.newTopicTextColor.value,
    memoColor: els.newTopicMemoColor.value,
    hidden: false
  };
  const added = await window.api.addTopic(topic);
  topics.push(added);
  renderTopics();
  els.newTopicName.value = '';
  els.newTopicDesc.value = '';
  els.newTopicChar.value = '';
  els.newTopicDefaultTitle.value = '';
  els.newTopicParent.value = '';
});
els.newTopicName.addEventListener('input', () => { els.topicNameError.hidden = true; });

// ---- 휴지통 ----
function formatDate(iso) {
  return iso ? iso.slice(0, 10) : '';
}
// 삭제일로부터 몇 일이 지났는지 계산해서, 자동으로 완전삭제되기까지 남은 일수를 보여줌
function daysLeftInTrash(iso) {
  const elapsedMs = Date.now() - new Date(iso).getTime();
  const elapsedDays = Math.floor(elapsedMs / (24 * 60 * 60 * 1000));
  return Math.max(0, TRASH_RETENTION_DAYS - elapsedDays);
}

function renderTrash() {
  els.trashList.innerHTML = '';
  const RT = LANG.settings.trashTab;
  if (!trash.length) {
    els.trashList.innerHTML = `<p class="hint">${RT.emptyListHint}</p>`;
    return;
  }
  // 최근에 지운 것부터 위로
  const sorted = trash.slice().sort((a, b) => new Date(b.deletedAt) - new Date(a.deletedAt));
  sorted.forEach((item) => {
    const topic = topics.find((t) => t.id === item.topicId);
    const topicLabel = topic ? topic.name : RT.deletedTopicFallback;

    const el = document.createElement('div');
    el.className = 'trash-item';
    // (수정) 목록을 한 줄로 압축하면서 설명 문구도 짧게 줄임. 좁은 창에서 글자가 잘려도
    // 마우스를 올리면 전체 내용이 툴팁으로 보이게 함
    el.title = fmt(RT.itemTooltip, {
      title: item.title || RT.noTitle,
      topic: topicLabel,
      date: formatDate(item.deletedAt),
      daysLeft: daysLeftInTrash(item.deletedAt)
    });
    el.innerHTML = `
      <div class="trash-item-info">
        <div class="name">${escapeHtml(item.title || RT.noTitle)}</div>
        <div class="desc">${escapeHtml(fmt(RT.itemDesc, { topic: topicLabel, date: formatDate(item.deletedAt), daysLeft: daysLeftInTrash(item.deletedAt) }))}</div>
      </div>
    `;

    const restoreBtn = document.createElement('button');
    restoreBtn.className = 'restore-btn';
    restoreBtn.type = 'button';
    restoreBtn.textContent = RT.restoreButton;
    restoreBtn.addEventListener('click', async () => {
      trash = await window.api.restoreFromTrash(item.id);
      renderTrash();
    });
    el.appendChild(restoreBtn);

    const delBtn = document.createElement('button');
    delBtn.className = 'del-btn';
    delBtn.type = 'button';
    delBtn.title = RT.permanentDeleteTitle;
    delBtn.textContent = '×';
    delBtn.addEventListener('click', () => {
      openConfirmModal(
        fmt(RT.permanentDeleteConfirmTitle, { title: item.title || RT.noTitle }),
        RT.permanentDeleteConfirmHint,
        async () => {
          trash = await window.api.permanentlyDeleteFromTrash(item.id);
          renderTrash();
        },
        RT.permanentDeleteTitle
      );
    });
    el.appendChild(delBtn);

    els.trashList.appendChild(el);
  });
}

els.btnEmptyTrash.addEventListener('click', () => {
  if (!trash.length) return;
  const RT = LANG.settings.trashTab;
  openConfirmModal(
    RT.emptyConfirmTitle,
    fmt(RT.emptyConfirmHint, { count: trash.length }),
    async () => {
      trash = await window.api.emptyTrash();
      renderTrash();
    },
    RT.emptyConfirmButton
  );
});

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
function escapeAttr(str) {
  return String(str).replace(/"/g, '&quot;');
}

function buildSettingsPayload() {
  return {
    vaultPath: els.vaultPath.value,
    autoLaunch: els.autoLaunch.checked,
    multiMode: els.multiMode.checked,
    confirmMemoDelete: els.confirmMemoDelete.checked,
    opacity: Number(els.opacityRange.value) || 100,
    newMemoShortcut: els.newMemoShortcutInput.value || '',
    defaultPostSaveAction: els.postSaveDelete.checked ? 'delete' : 'keep',
    widget: {
      autoResize: els.widgetAutoResize.checked,
      width: Number(els.widgetWidth.value) || 260,
      height: Number(els.widgetHeight.value) || 360,
      // "펼친 상태의 진짜 크기"도 같이 갱신 — 안 그러면 접힘 상태에서 자동으로 늘어난 폭 때문에
      // 여기서 새로 입력한 값이 다음에 펼칠 때 무시되고 예전 값으로 되돌아가버림
      expandedWidth: Number(els.widgetWidth.value) || 260,
      expandedHeight: Number(els.widgetHeight.value) || 360,
      titlebarColor: els.widgetTitlebarColor.value
    },
    clickGesture: {
      single: els.gestureSingle.value,
      double: els.gestureDouble.value
    },
    exportNameRule: {
      includeTopic: els.ruleIncludeTopic.checked,
      includeTitle: els.ruleIncludeTitle.checked,
      includeDate: els.ruleIncludeDate.checked,
      includeSeq: els.ruleIncludeSeq.checked,
      separator: els.ruleSeparator.value
    },
    mdFeatureEnabled: els.mdFeatureEnabled.checked,
    autoExportObsidian: els.ruleAutoExport.checked,
    specialChars: currentSpecialChars(),
    autoBackup: {
      enabled: els.autoBackupEnabled.checked,
      folderPath: els.autoBackupFolder.value,
      intervalHours: Number(els.autoBackupInterval.value) || 0
    }
  };
}

async function doSave() {
  const updated = buildSettingsPayload();
  settings = await window.api.saveSettings(updated);
  return settings;
}

els.btnSave.addEventListener('click', async () => {
  await doSave();
  els.saveStatus.textContent = LANG.settings.saveBar.savedStatus;
  setTimeout(() => window.close(), 400);
});

// 적용: 저장은 하되 창은 닫지 않음 — 투명도/색상 등을 바로 확인하며 계속 조정할 때 사용
els.btnApply.addEventListener('click', async () => {
  await doSave();
  els.saveStatus.textContent = LANG.settings.saveBar.appliedStatus;
  setTimeout(() => (els.saveStatus.textContent = ''), 1500);
});

// 취소: 저장하지 않고 그냥 창만 닫음(바꾼 내용은 버려짐)
els.btnCancel.addEventListener('click', () => window.close());

loadAll();
