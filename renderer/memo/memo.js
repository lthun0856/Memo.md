let memo = null;
let saveTimer = null;
let confirmMemoDelete = true;
let autoExportObsidian = false; // true면 MD내보내기 누를 때 파일명 확인창 없이 바로 저장
let mdFeatureEnabled = true; // MD/옵시디언 관련 기능(서식버튼, 메모연결, MD내보내기, 처리방식버튼) 전체 on/off
let hasSeenImageResizeNotice = false; // 이미지 자동 리사이즈 안내를 이미 봤는지(첫 이미지 삽입 때 한 번만 안내)

const els = {
  content: document.getElementById('content'),
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
  moveTopicModal: document.getElementById('moveTopicModal'),
  moveTopicList: document.getElementById('moveTopicList'),
  moveTopicModalCancel: document.getElementById('moveTopicModalCancel'),
  btnSaveTemplate: document.getElementById('btnSaveTemplate'),
  templateModal: document.getElementById('templateModal'),
  templateTopicList: document.getElementById('templateTopicList'),
  templateModalCancel: document.getElementById('templateModalCancel'),
  btnKeepToggle: document.getElementById('btnKeepToggle'),
  btnPin: document.getElementById('btnPin'),
  colorPicker: document.getElementById('colorPicker'),
  toolbar: document.getElementById('toolbar'),
  headingSelect: document.getElementById('headingSelect'),
  editorArea: document.getElementById('editorArea'),
  canvasLayer: document.getElementById('canvasLayer'),
  attachmentStrip: document.getElementById('attachmentStrip'),
  checklistArea: document.getElementById('checklistArea'),
  checklistList: document.getElementById('checklistList'),
  btnChecklistAdd: document.getElementById('btnChecklistAdd'),
  btnChecklistRevertAll: document.getElementById('btnChecklistRevertAll'),
  checklistRevertModal: document.getElementById('checklistRevertModal'),
  checklistRevertCancel: document.getElementById('checklistRevertCancel'),
  checklistRevertConfirm: document.getElementById('checklistRevertConfirm'),
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
  confirmModal: document.getElementById('confirmModal'),
  confirmModalTitle: document.getElementById('confirmModalTitle'),
  confirmModalHint: document.getElementById('confirmModalHint'),
  confirmModalCancel: document.getElementById('confirmModalCancel'),
  confirmModalConfirm: document.getElementById('confirmModalConfirm')
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
  els.btnKeepToggle.title = M.keepToggleBaseTitle;
  els.btnDelete.title = M.deleteTitle;
  els.btnClose.title = M.closeTitle;

  els.btnChecklistAdd.textContent = M.checklistAddButton;
  els.btnChecklistRevertAll.textContent = M.checklistRevertButton;
  els.btnChecklistRevertAll.title = M.checklistRevertButtonTitle;

  els.content.placeholder = M.contentPlaceholder;

  document.getElementById('btnUndo').title = M.undoTitle;
  document.getElementById('btnRedo').title = M.redoTitle;
  document.getElementById('btnChecklistCmd').title = M.checklistCmdTitle;
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
  document.getElementById('btnExportLabel').textContent = M.exportButtonText;

  document.getElementById('exportModalTitle').textContent = M.exportModalTitle;
  els.exportModalCancel.textContent = M.common.cancel;
  els.exportModalConfirm.textContent = M.common.save;

  document.getElementById('linkModalTitle').textContent = M.linkModalTitle;
  els.linkModalCancel.textContent = M.common.cancel;
  els.linkModalConfirm.textContent = M.common.confirm;

  document.getElementById('moveTopicModalTitle').textContent = M.moveTopicModalTitle;
  els.moveTopicModalCancel.textContent = M.common.cancel;

  document.getElementById('checklistRevertModalTitle').textContent = M.checklistRevertModalTitle;
  document.getElementById('checklistRevertModalHint').textContent = M.checklistRevertModalHint;
  els.checklistRevertCancel.textContent = M.common.cancel;
  els.checklistRevertConfirm.textContent = M.checklistRevertConfirmButton;

  document.getElementById('templateModalTitle').textContent = M.templateModalTitle;
  document.getElementById('templateModalHint').textContent = M.templateModalHint;
  els.templateModalCancel.textContent = M.common.cancel;

  document.getElementById('imageResizeNoticeTitle').textContent = M.imageResizeNoticeTitle;
  document.getElementById('imageResizeNoticeHint').textContent = M.imageResizeNoticeHint;
  els.imageResizeNoticeConfirm.textContent = M.common.confirm;

  els.confirmModalCancel.textContent = M.common.cancel;
  els.confirmModalConfirm.textContent = M.common.confirm;
}
applyLang();

let pendingLinkRange = null;

let locked = false;

// 체크리스트 "본문으로 되돌리기" 때(아래 doRevertChecklistToText 참고) 겪었던 것과 같은 이유로,
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
  renderAttachments();
  renderChecklist();
  applyCollapsedState(!!memo.collapsed);

  exportUpToDate = !!(
    memo.obsidian &&
    memo.obsidian.saved &&
    memo.obsidian.exportedVersion &&
    memo.obsidian.exportedVersion === memo.updatedAt
  );
  renderExportButtonState();

  if (memo.title) {
    // 제목이 이미 있는 주제(기본 제목 등)는 기존처럼 본문에 바로 커서
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

// ---- 자동 저장 ----

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    memo.content = els.content.value;
    await window.api.updateMemoContent(memo.id, memo.content);
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
  renderAttachments();
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
  renderAttachments();
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
    case 'undo':
      document.execCommand('undo');
      break;
    case 'redo':
      document.execCommand('redo');
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
      wrapSelection('==', '==');
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
    case 'attach':
      handleAttach();
      break;
  }
}

// 메모연결(memolink) 버튼이 툴바 밖 하단(footer)으로 이동했기 때문에, 위임 범위를 툴바에서
// 문서 전체로 넓혀서 data-cmd 버튼이면 어디 있든 동작하게 함
document.body.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-cmd]');
  if (btn) runToolbarCommand(btn.dataset.cmd);
});

els.headingSelect.addEventListener('change', () => {
  if (els.headingSelect.value) prefixLines(els.headingSelect.value);
  els.headingSelect.value = '';
});

// ---- 체크리스트 ----
// textarea는 순수 텍스트라 그 안에서는 실제 체크박스나 부분 취소선을 표시할 수 없어서,
// 이미지 첨부와 같은 방식으로 본문과는 별도인 목록(memo.checklist)으로 관리함.
// MD내보내기/txt저장/복사할 때만 "- [ ] 텍스트" 형식의 마크다운으로 합쳐짐(exporter.js 참고)

// 선택한 범위(선택 없으면 메모 전체)를 체크리스트 항목으로 옮기고, 그 부분은 본문에서 제거함.
// 문단 사이에 빈 줄(띄어쓰기)이 있으면 그 빈 줄을 기준으로 묶어서 항목 하나씩 만들고(여러 줄이
// 한 항목), 빈 줄이 전혀 없으면(그냥 줄바꿈만 있는 목록) 기존처럼 한 줄 = 항목 하나로 나눔
function convertSelectionToChecklist() {
  const ta = els.content;
  let start = ta.selectionStart;
  let end = ta.selectionEnd;
  if (start === end) {
    start = 0;
    end = ta.value.length;
  }
  const raw = ta.value.slice(start, end);
  if (!raw.trim()) {
    // 빈 메모(글자 선택도 없고 본문도 비어있음)에서 누르면 아무 일도 안 일어나던 문제 수정:
    // btnChecklistAdd와 같은 방식으로 빈 항목 하나를 만들어줌
    const newItem = { id: crypto.randomUUID(), text: '', checked: false };
    memo.checklist = [...(memo.checklist || []), newItem];
    renderChecklist();
    persistChecklist();
    const rows = els.checklistList.querySelectorAll('.checklist-item-text');
    const lastRow = rows[rows.length - 1];
    if (lastRow) lastRow.focus();
    return;
  }

  const hasBlankLine = /\n[ \t]*\r?\n/.test(raw);
  const groups = hasBlankLine
    ? raw
        .split(/\n[ \t]*\r?\n+/)
        .map((block) => block.split('\n').map((l) => l.trim()).filter(Boolean).join(' '))
        .filter(Boolean)
    : raw.split('\n').map((l) => l.trim()).filter(Boolean);
  if (!groups.length) return;

  const newItems = groups.map((text) => ({ id: crypto.randomUUID(), text, checked: false }));
  memo.checklist = [...(memo.checklist || []), ...newItems];

  ta.focus();
  ta.setRangeText('', start, end, 'end');
  scheduleSave();

  renderChecklist();
  persistChecklist();
}

// 체크리스트를 통째로 취소하고 싶을 때: 모든 항목을 본문 맨 끝에 줄글로 되돌려놓고 목록은 비움
// (체크 표시는 순수 텍스트로는 표현할 수 없어서 되돌리면 사라짐 — 그래서 되돌리기 전 확인창을 띄움)
//
// (수정) 원래 window.confirm()으로 물어봤었는데, 그 네이티브 확인창이 닫힌 뒤 이 메모창이
// 계속 "잠긴 것처럼" 편집이 안 되는 문제가 refocusWindow()로도 완전히 안 고쳐졌음(드래그로
// 텍스트 선택은 되는데 타이핑은 안 먹고, 다른 메모창을 갔다 와야 풀리는 증상 — Electron의
// frame:false 창이 네이티브 다이얼로그 뒤에 진짜 키보드 포커스를 잘 못 돌려받는 근본적인
// 문제로 보임). 그래서 네이티브 확인창을 아예 안 쓰고, 이 앱의 다른 곳들(파일명 입력,
// 링크 URL 입력 등)처럼 직접 만든 HTML 모달로 바꿔서 이 문제 자체를 피해감
function openChecklistRevertModal() {
  const items = memo.checklist || [];
  if (!items.length) return;
  els.checklistRevertModal.hidden = false;
}

function closeChecklistRevertModal() {
  els.checklistRevertModal.hidden = true;
}

function doRevertChecklistToText() {
  const items = memo.checklist || [];
  if (!items.length) return;

  const lines = items.map((it) => (it.text || '').trim()).filter(Boolean).join('\n');
  const ta = els.content;
  const existing = ta.value.replace(/\s+$/, '');
  ta.value = existing && lines ? `${existing}\n\n${lines}` : (existing || lines);
  ta.focus();
  scheduleSave();

  memo.checklist = [];
  renderChecklist();
  persistChecklist();
}

// 이미지를 처음 넣을 때만(설정에 기록될 때까지) 자동 리사이즈 안내를 한 번 보여줌
function maybeShowImageResizeNotice() {
  if (hasSeenImageResizeNotice) return;
  hasSeenImageResizeNotice = true; // 같은 세션에서 여러 번 안 뜨게 먼저 막아둠
  els.imageResizeNoticeModal.hidden = false;
  window.api.saveSettings({ hasSeenImageResizeNotice: true });
}
els.imageResizeNoticeConfirm.addEventListener('click', () => {
  els.imageResizeNoticeModal.hidden = true;
});

els.checklistRevertCancel.addEventListener('click', closeChecklistRevertModal);
els.checklistRevertConfirm.addEventListener('click', () => {
  closeChecklistRevertModal();
  doRevertChecklistToText();
});

function persistChecklist() {
  window.api.setMemoChecklist(memo.id, memo.checklist || []);
  markExportDirty();
}

function renderChecklist() {
  const items = memo.checklist || [];
  els.checklistArea.hidden = items.length === 0;
  els.checklistList.innerHTML = '';
  items.forEach((item) => els.checklistList.appendChild(createChecklistItemEl(item)));
}

function createChecklistItemEl(item) {
  const row = document.createElement('div');
  row.className = 'checklist-item' + (item.checked ? ' checked' : '');

  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.checked = !!item.checked;
  checkbox.addEventListener('change', () => {
    item.checked = checkbox.checked;
    row.classList.toggle('checked', item.checked);
    persistChecklist();
  });
  row.appendChild(checkbox);

  // 텍스트를 클릭해서 바로 고칠 수 있게 함(주제 이름 수정과 같은 패턴)
  const text = document.createElement('span');
  text.className = 'checklist-item-text';
  text.contentEditable = 'true';
  text.dataset.placeholder = LANG.memo.checklistItemPlaceholder;
  text.textContent = item.text || '';
  text.addEventListener('blur', () => {
    item.text = text.textContent.trim();
    text.textContent = item.text;
    persistChecklist();
  });
  text.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      text.blur();
    }
  });
  row.appendChild(text);

  const delBtn = document.createElement('button');
  delBtn.type = 'button';
  delBtn.className = 'checklist-item-del';
  delBtn.title = LANG.memo.checklistItemDeleteTitle;
  delBtn.textContent = '×';
  delBtn.addEventListener('click', () => {
    // (수정) renderChecklist() 이후에 다른 곳으로 포커스를 옮기는 방식은 안 먹혔음 —
    // innerHTML로 목록을 통째로 지우는 순간 방금 누른 × 버튼이 DOM에서 사라지면서
    // 포커스가 잠깐이라도 카드 밖으로 나가버리고, 그 찰나에 :focus-within이 꺼지면서
    // 옮기려던 대상(추가 버튼 등)도 같이 display:none 처리돼서 focus()가 그냥 무시됐음.
    // 그래서 지우기 "전에" 미리 포커스를 본문(textarea, 포커스와 무관하게 항상 보임)으로
    // 옮겨둬서 :focus-within이 끊기는 순간 자체가 생기지 않게 함
    els.content.focus();
    memo.checklist = (memo.checklist || []).filter((it) => it.id !== item.id);
    renderChecklist();
    persistChecklist();
  });
  row.appendChild(delBtn);

  return row;
}

els.btnChecklistAdd.addEventListener('click', () => {
  const newItem = { id: crypto.randomUUID(), text: '', checked: false };
  memo.checklist = [...(memo.checklist || []), newItem];
  renderChecklist();
  persistChecklist();
  const rows = els.checklistList.querySelectorAll('.checklist-item-text');
  const lastRow = rows[rows.length - 1];
  if (lastRow) lastRow.focus();
});

els.btnChecklistRevertAll.addEventListener('click', openChecklistRevertModal);

// MD내보내기/복사/txt저장 등 본문 텍스트가 필요한 곳에서 체크리스트까지 합친 전체 텍스트가 필요할 때 사용
function serializeChecklistText(items) {
  if (!items || !items.length) return '';
  return items
    .filter((it) => it && it.text && it.text.trim())
    .map((it) => `- [${it.checked ? 'x' : ' '}] ${it.text.trim()}`)
    .join('\n');
}

function fullTextWithChecklist() {
  const checklistText = serializeChecklistText(memo.checklist);
  if (!checklistText) return els.content.value;
  return els.content.value.replace(/\s+$/, '') + '\n\n' + checklistText;
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
}

// ---- 첨부파일 ----

async function handleAttach() {
  const files = await window.api.pickAttachments();
  for (const file of files) {
    await window.api.addAttachment(memo.id, file);
    memo.attachments.push(file);
  }
  markExportDirty();
  renderAttachments();
  if (files.some((file) => file.isImage)) maybeShowImageResizeNotice();
}

let attachmentObservers = [];

// 새로 추가된 이미지가 겹치지 않게 대각선으로 하나씩 밀려나는 기본 위치 계산
function computeDefaultPosition(index) {
  const step = 24;
  const cascade = index % 6;
  return { x: 14 + cascade * step, y: 14 + cascade * step };
}

// 설명칸의 기본 크기(px). 사용자가 아직 옮기거나 늘린 적 없으면(옛 메모 포함) 이 값을 씀
const CAPTION_HEIGHT = 22;
const CAPTION_WIDTH = 140;

async function renderAttachments() {
  attachmentObservers.forEach((ro) => ro.disconnect());
  attachmentObservers = [];
  els.canvasLayer.innerHTML = '';
  els.attachmentStrip.innerHTML = '';

  let imageIndex = 0;
  for (const a of memo.attachments) {
    if (a.isImage) {
      await renderCanvasImage(a, imageIndex);
      imageIndex += 1;
    } else {
      renderFileChip(a);
    }
  }
}

// 그림판처럼 본문 위에 자유롭게 놓이는 이미지 하나 + 그 이미지에 딸린 설명칸을 그림
// - 이미지(box>body>img): 위치/크기 자유
// - 설명칸(captionBox>textarea): 이미지와는 별개의 독립된 상자. 이미지 기준 상대좌표
//   (captionOffsetX/Y)로 저장해서, 이미지를 옮기면 같이 따라가지만 ⠿ 손잡이로 따로 잡으면
//   원하는 방향 아무 곳에나 뗄 수 있음
async function renderCanvasImage(a, index) {
  const filePath = await window.api.getAttachmentPath(a.storedName);
  const box = document.createElement('div');
  box.className = 'canvas-image';

  const pos = a.displayX != null ? { x: a.displayX, y: a.displayY } : computeDefaultPosition(index);
  box.style.left = pos.x + 'px';
  box.style.top = pos.y + 'px';
  const width = a.displayWidth || 140;
  const height = a.displayHeight || 100;
  box.style.width = width + 'px';
  box.style.height = height + 'px';
  if (a.displayX == null) {
    // 처음 배치되는 기본 위치는 바로 저장해둬서 다음에 열어도 같은 자리에 있도록 함
    window.api.updateAttachmentPosition(memo.id, a.storedName, pos.x, pos.y);
    a.displayX = pos.x;
    a.displayY = pos.y;
  }

  const body = document.createElement('div');
  body.className = 'canvas-image-body';
  body.style.width = width + 'px';
  body.style.height = height + 'px';

  const img = document.createElement('img');
  img.src = `file://${filePath}`;
  img.title = a.originalName;
  body.appendChild(img);
  box.appendChild(body);

  const removeBtn = document.createElement('button');
  removeBtn.className = 'attachment-remove';
  removeBtn.title = LANG.memo.imageDeleteTitle;
  removeBtn.textContent = '×';
  removeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    handleRemoveAttachment(a.storedName);
  });
  box.appendChild(removeBtn);

  els.canvasLayer.appendChild(box);

  // ---- 설명칸(이미지와 분리된 별도 상자) ----
  const captionBox = document.createElement('div');
  captionBox.className = 'caption-box';
  const capWidth = a.captionWidth || width || CAPTION_WIDTH;
  const capHeight = a.captionHeight || CAPTION_HEIGHT;
  // 기본값: 옮긴 적 없으면 이미지 바로 아래(offsetY=이미지 높이, offsetX=0)에 둠
  const offsetX = a.captionOffsetX != null ? a.captionOffsetX : 0;
  const offsetY = a.captionOffsetY != null ? a.captionOffsetY : height;
  captionBox.style.left = (pos.x + offsetX) + 'px';
  captionBox.style.top = (pos.y + offsetY) + 'px';
  captionBox.style.width = capWidth + 'px';
  captionBox.style.height = capHeight + 'px';

  const caption = document.createElement('textarea');
  caption.className = 'canvas-image-caption';
  caption.placeholder = LANG.memo.captionPlaceholder;
  caption.value = a.caption || '';
  caption.style.width = capWidth + 'px';
  caption.style.height = capHeight + 'px';
  caption.title = LANG.memo.captionTitle;
  caption.addEventListener('mousedown', (e) => e.stopPropagation()); // 드래그 핸들러와 충돌 방지
  caption.addEventListener('change', () => {
    a.caption = caption.value;
    window.api.updateAttachmentCaption(memo.id, a.storedName, caption.value);
    markExportDirty();
  });
  captionBox.appendChild(caption);

  const moveHandle = document.createElement('div');
  moveHandle.className = 'caption-move-handle';
  moveHandle.title = LANG.memo.captionMoveHandleTitle;
  moveHandle.textContent = '⠿';
  captionBox.appendChild(moveHandle);

  els.canvasLayer.appendChild(captionBox);

  attachDragHandlers(box, body, captionBox, a);
  attachResizeObserver(box, body, a);
  attachCaptionDragHandlers(captionBox, moveHandle, box, a);
  attachCaptionResizeObserver(captionBox, caption, a);
}

// 이미지가 아닌 첨부(문서 등)는 기존처럼 하단에 작은 칩으로 표시
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

// 모서리(약 14px, body의 리사이즈 핸들 영역) 를 잡으면 브라우저 기본 리사이즈에 맡기고,
// 그 외 영역을 잡으면 드래그로 이동 (이동 대상은 바깥 box, 크기 기준은 안쪽 body).
// 이미지를 옮기는 동안 설명칸(captionBox)도 같은 이동량만큼 같이 옮겨서 항상 따라오게 함
// (설명칸 자체의 상대위치 값은 바뀌지 않으므로 따로 저장하지 않아도 됨)
function attachDragHandlers(box, body, captionBox, a) {
  body.addEventListener('mousedown', (e) => {
    if (e.target.closest('.attachment-remove')) return;
    const rect = body.getBoundingClientRect();
    const nearResizeCorner =
      rect.right - e.clientX < 16 && rect.bottom - e.clientY < 16;
    if (nearResizeCorner) return; // 리사이즈 핸들은 브라우저 기본 동작 사용

    e.preventDefault();
    const areaRect = els.editorArea.getBoundingClientRect();
    const startX = e.clientX;
    const startY = e.clientY;
    const startLeft = box.offsetLeft;
    const startTop = box.offsetTop;
    const captionStartLeft = captionBox.offsetLeft;
    const captionStartTop = captionBox.offsetTop;

    function onMove(ev) {
      let nextLeft = startLeft + (ev.clientX - startX);
      let nextTop = startTop + (ev.clientY - startY);
      nextLeft = Math.max(0, Math.min(nextLeft, areaRect.width - 30));
      nextTop = Math.max(0, Math.min(nextTop, areaRect.height - 30));
      const appliedDx = nextLeft - startLeft;
      const appliedDy = nextTop - startTop;
      box.style.left = nextLeft + 'px';
      box.style.top = nextTop + 'px';
      captionBox.style.left = (captionStartLeft + appliedDx) + 'px';
      captionBox.style.top = (captionStartTop + appliedDy) + 'px';
    }
    function onUp() {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      const x = box.offsetLeft;
      const y = box.offsetTop;
      a.displayX = x;
      a.displayY = y;
      window.api.updateAttachmentPosition(memo.id, a.storedName, x, y);
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
}

// body(안쪽)를 사용자가 리사이즈하면, 바깥 box도 즉시 같은 크기로 맞춰서
// 삭제버튼(box의 자식) 위치가 항상 실제 이미지 모서리에 딱 맞게 함. 저장은 디바운스.
// (ResizeObserver는 observe() 호출 직후 최초 1회 자동으로 콜백이 실행되는데,
//  그 최초 호출까지 저장해버리면 열 때마다 미세하게 사이즈가 틀어질 수 있어 첫 콜백은 저장을 건너뜀)
function attachResizeObserver(box, body, a) {
  let resizeTimer = null;
  let isFirstCallback = true;
  const ro = new ResizeObserver((entries) => {
    const { width, height } = entries[0].contentRect;
    box.style.width = width + 'px';
    box.style.height = height + 'px';
    if (isFirstCallback) {
      isFirstCallback = false;
      return;
    }
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      window.api.updateAttachmentSize(memo.id, a.storedName, width, height);
      a.displayWidth = Math.round(width);
      a.displayHeight = Math.round(height);
    }, 400);
  });
  ro.observe(body);
  attachmentObservers.push(ro);
}

// 설명칸의 ⠿ 손잡이를 드래그하면 이미지와 상관없이 원하는 위치로 옮길 수 있음.
// 다음에 열 때도 같은 자리이도록, 이미지 기준 상대좌표(offset)로 저장해둠
function attachCaptionDragHandlers(captionBox, moveHandle, box, a) {
  moveHandle.addEventListener('mousedown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const areaRect = els.editorArea.getBoundingClientRect();
    const startX = e.clientX;
    const startY = e.clientY;
    const startLeft = captionBox.offsetLeft;
    const startTop = captionBox.offsetTop;

    function onMove(ev) {
      let nextLeft = startLeft + (ev.clientX - startX);
      let nextTop = startTop + (ev.clientY - startY);
      nextLeft = Math.max(0, Math.min(nextLeft, areaRect.width - 30));
      nextTop = Math.max(0, Math.min(nextTop, areaRect.height - 30));
      captionBox.style.left = nextLeft + 'px';
      captionBox.style.top = nextTop + 'px';
    }
    function onUp() {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      const offsetX = captionBox.offsetLeft - box.offsetLeft;
      const offsetY = captionBox.offsetTop - box.offsetTop;
      a.captionOffsetX = offsetX;
      a.captionOffsetY = offsetY;
      window.api.updateAttachmentCaptionOffset(memo.id, a.storedName, offsetX, offsetY);
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
}

// 설명칸을 사용자가 모서리를 드래그해서 늘리거나 줄이면(포토샵 텍스트박스처럼) 그 크기를 기억해둠
function attachCaptionResizeObserver(captionBox, caption, a) {
  let resizeTimer = null;
  let isFirstCallback = true;
  const ro = new ResizeObserver((entries) => {
    const { width, height } = entries[0].contentRect;
    captionBox.style.width = width + 'px';
    captionBox.style.height = height + 'px';
    if (isFirstCallback) {
      isFirstCallback = false;
      return;
    }
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      window.api.updateAttachmentCaptionSize(memo.id, a.storedName, width, height);
      a.captionWidth = Math.round(width);
      a.captionHeight = Math.round(height);
    }, 400);
  });
  ro.observe(caption);
  attachmentObservers.push(ro);
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

// ---- 다른 주제로 이동 모달 ----
// 지금 속한 주제는 목록에서 빼고 보여줌(같은 주제로 "이동"할 필요는 없으니까)

async function openMoveTopicModal() {
  const topics = await window.api.getTopics();
  renderMoveTopicList(topics.filter((t) => t.id !== memo.topicId));
  els.moveTopicModal.hidden = false;
}

function closeMoveTopicModal() {
  els.moveTopicModal.hidden = true;
}

function renderMoveTopicList(topics) {
  els.moveTopicList.innerHTML = '';
  if (!topics.length) {
    const empty = document.createElement('div');
    empty.className = 'memo-link-empty';
    empty.textContent = LANG.memo.moveTopicEmpty;
    els.moveTopicList.appendChild(empty);
    return;
  }
  topics.forEach((t) => {
    const item = document.createElement('div');
    item.className = 'memo-link-item move-topic-item';
    item.innerHTML = `
      <span class="swatch" style="background:${t.color};color:${t.textColor || '#FFFFFF'}">${escapeHtmlSafe(t.iconChar || '')}</span>
      <span>${escapeHtmlSafe(t.name)}</span>
    `;
    item.addEventListener('click', () => moveToTopic(t.id));
    els.moveTopicList.appendChild(item);
  });
}

// 이 파일엔 escapeHtml 헬퍼가 따로 없어서, 목록에 이름 그대로 넣지 않고 안전하게 이스케이프해줌
function escapeHtmlSafe(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}

async function moveToTopic(topicId) {
  const updated = await window.api.moveMemoToTopic(memo.id, topicId);
  closeMoveTopicModal();
  if (!updated) return;
  memo.topicId = updated.topicId;
  memo.color = updated.color;
  applyAccentColor(memo.color);
  els.colorPicker.value = memo.color;
  markExportDirty(); // 주제가 바뀌면 MD내보내기의 태그도 바뀌므로 다시 내보내야 함
}

els.btnMoveTopic.addEventListener('click', openMoveTopicModal);
els.moveTopicModalCancel.addEventListener('click', closeMoveTopicModal);

// ---- 템플릿으로 저장 모달 ----
// 이동 모달과 같은 UI 패턴(주제 선택)을 쓰되, 지금 속한 주제도 목록에 포함시킴
// (같은 주제에 템플릿을 저장하는 것도 자연스러운 사용법이라 뺄 이유가 없음)

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
