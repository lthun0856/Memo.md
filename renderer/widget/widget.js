let settings = null;
let topics = [];
let memos = [];
let expandedTopicIds = new Set(); // 펼쳐진 주제 목록(여러 개 동시에 펼칠 수 있음)
let showHidden = false;
let settingsOpen = false;
let memosHidden = false;
let hiddenTopics = new Set(); // 표시 전용(클릭 동작 없음) — 대시보드 눈 아이콘 상태 표시에만 씀
let visibleMemoIds = new Set(); // 표시 전용 — 지금 화면에 실제로 보이는 메모 id 목록(목록 항목별 눈 아이콘에 씀)
let pinnedTopics = new Set();
let screenWorkArea = { width: 1280, height: 800 }; // 화면 크기(자동조절 상한 계산용, 실제 값은 로드시 받아옴
const clickTimers = new Map(); // topicId -> timeout id

const els = {
  widget: document.getElementById('widget'),
  titlebar: document.getElementById('titlebar'),
  iconRow: document.getElementById('iconRow'),
  collapsedIcons: document.getElementById('collapsedIcons'),
  dashboard: document.getElementById('dashboard'),
  btnSettings: document.getElementById('btnSettings'),
  btnSearch: document.getElementById('btnSearch'),
  btnToggleHidden: document.getElementById('btnToggleHidden'),
  btnHideAll: document.getElementById('btnHideAll'),
  btnPinWidget: document.getElementById('btnPinWidget'),
  dragHandle: document.querySelector('.drag-handle'),
  titlebarActions: document.getElementById('titlebarActions'),
  alwaysActions: document.getElementById('alwaysActions'),
  confirmModal: document.getElementById('confirmModal'),
  confirmModalTitle: document.getElementById('confirmModalTitle'),
  confirmModalHint: document.getElementById('confirmModalHint'),
  confirmModalCancel: document.getElementById('confirmModalCancel'),
  confirmModalConfirm: document.getElementById('confirmModalConfirm')
};

// 문구 안의 {name}/{title}/{count}/{label} 같은 자리표시자를 실제 값으로 바꿔주는 도우미
function fmt(str, vars) {
  return str.replace(/\{(\w+)\}/g, (_, key) => vars[key]);
}

function applyLang() {
  document.title = LANG.widget.windowTitle;
  document.getElementById('titleText').textContent = LANG.widget.titleText;
  els.dragHandle.title = LANG.widget.dragHandleTitle;
  els.btnSettings.title = LANG.widget.settingsTitle;
  els.btnSearch.title = LANG.widget.searchTitle;
  els.btnHideAll.title = LANG.widget.hideAllTitle;
  els.confirmModalCancel.textContent = LANG.widget.confirmCancel;
  els.confirmModalConfirm.textContent = LANG.widget.confirmConfirm;
}
applyLang();

// 네이티브 confirm()이 닫힌 뒤 이 창(frame:false)이 클릭/키보드를 못 받는 문제가 있어서
// (설정창/메모창에서도 같은 문제가 있었음), confirm() 대신 쓰는 자체 확인 모달.
// 확인을 누르면 onConfirm을 실행함(설정창의 openConfirmModal과 같은 패턴)
let pendingConfirmAction = null;
function openConfirmModal(title, hint, onConfirm, confirmLabel) {
  els.confirmModalTitle.textContent = title;
  els.confirmModalHint.textContent = hint || '';
  els.confirmModalHint.hidden = !hint;
  els.confirmModalConfirm.textContent = confirmLabel || LANG.widget.confirmConfirm;
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

// (수정) 메모창을 껐다 켰다 빠르게 반복하면 memos:updated 신호가 연달아 여러 번 오는데,
// 그때마다 loadAll을 겹쳐서 부르면 먼저 시작한 호출이 나중 호출보다 "늦게" 끝나면서 오래된
// 데이터로 화면을 덮어써버리는 경우가 있었음(그래서 눈 아이콘이 한 박자 늦게, 다른 메모를
// 건드려야 그제서야 갱신되는 것처럼 보였음). 그래서 한 번에 하나만 실행되게 막고, 실행 중에
// 또 요청이 오면 "끝나고 한 번 더" 하도록 큐잉해서 항상 마지막 상태로 정확히 수렴하게 함
let loadAllInFlight = false;
let loadAllQueued = false;

async function loadAll() {
  if (loadAllInFlight) {
    loadAllQueued = true;
    return;
  }
  loadAllInFlight = true;
  try {
    const [s, t, m, hidden, visible, pinned, workArea, visState] = await Promise.all([
      window.api.getSettings(),
      window.api.getTopics(),
      window.api.getAllMemos(),
      window.api.getHiddenTopics(),
      window.api.getVisibleMemoIds(),
      window.api.getPinnedTopics(),
      window.api.getScreenWorkArea(),
      window.api.getVisibilityState()
    ]);
    settings = s;
    topics = t;
    memos = m;
    hiddenTopics = new Set(hidden);
    visibleMemoIds = new Set(visible);
    pinnedTopics = new Set(pinned);
    if (workArea && workArea.height) screenWorkArea = workArea;
    updateHideAllButton(visState); // 재시작 후에도 전체숨김 버튼이 실제 상태를 바로 반영하게 함
    applyWidgetState();
    render();
  } finally {
    loadAllInFlight = false;
    if (loadAllQueued) {
      loadAllQueued = false;
      loadAll();
    }
  }
}

function pinIconSvg(active) {
  const fill = active ? 'currentColor' : 'none';
  const rotate = active ? '' : ' style="transform:rotate(-35deg)"';
  return `<svg viewBox="0 0 24 24" width="13" height="13"${rotate}>
    <circle cx="12" cy="7" r="4" fill="${fill}" stroke="currentColor" stroke-width="1.5"/>
    <line x1="12" y1="11" x2="12" y2="20" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
  </svg>`;
}

// 클릭 안 되는 순수 표시용 눈 아이콘: open=true면 뜬눈(보임), false면 감은눈(숨김)
function eyeIconSvg(open) {
  if (open) {
    return `<svg viewBox="0 0 24 24" width="12" height="12">
      <ellipse cx="12" cy="12" rx="9" ry="5.5" fill="none" stroke="currentColor" stroke-width="1.7"/>
      <circle cx="12" cy="12" r="2.6" fill="currentColor"/>
    </svg>`;
  }
  // 감은눈: 위로 볼록하던 곡선을 아래로 볼록하게(180도 반전)해서 실제 감은 눈꺼풀처럼 보이게 함
  return `<svg viewBox="0 0 24 24" width="12" height="12">
    <path d="M3 12c3 3 6 4.5 9 4.5s6 -1.5 9 -4.5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>
  </svg>`;
}

function applyWidgetState() {
  els.widget.classList.toggle('collapsed', !!settings.widget.collapsed);
  els.titlebar.title = settings.widget.collapsed ? LANG.widget.titlebarTitleCollapsed : LANG.widget.titlebarTitleExpanded;
  const pinned = settings.widget.alwaysOnTop !== false;
  els.btnPinWidget.classList.toggle('active', pinned);
  els.btnPinWidget.title = pinned ? LANG.widget.pinTitleOn : LANG.widget.pinTitleOff;
  els.btnPinWidget.innerHTML = pinIconSvg(pinned);
  els.titlebar.style.background = settings.widget.titlebarColor || '';
}

function memosOfTopic(topicId) {
  return memos.filter((m) => m.topicId === topicId);
}

function visibleTopics() {
  return showHidden ? topics : topics.filter((t) => !t.hidden);
}

function render() {
  renderIconRow();
  renderCollapsedIcons();
  renderDashboard();
  renderHiddenToggle();
  requestAnimationFrame(syncHeight);
  requestAnimationFrame(syncCollapsedWidth);
}

// collapsedMode=true(접힘 상태 타이틀바 안의 버튼)면 원클릭/더블클릭을 구분함:
// 원클릭 = 새 메모, 더블클릭 = 그 주제 메모 전부 숨기기/보이기 토글.
// 더블클릭을 기다리느라 원클릭(새 메모)이 250ms 정도 살짝 늦게 실행되는 건 의도된 동작임.
// 펼침 상태의 아이콘 줄은 예전처럼 클릭 즉시 새 메모(더블클릭 구분 없음)
const iconClickTimers = new Map(); // topicId -> timeout id (접힘 버튼 전용, 주제 줄의 clickTimers와 별개)
function makeTopicIconBtn(t, collapsedMode) {
  const btn = document.createElement('button');
  btn.className = 'topic-icon-btn';
  const iconChar = t.iconChar || t.name.slice(0, 2);
  if (iconChar.length > 1) btn.classList.add('two-char');
  btn.style.background = t.color || '#8A8574';
  btn.style.color = t.textColor || '#FFFFFF';
  btn.textContent = iconChar;
  btn.disabled = settingsOpen;
  if (!collapsedMode) {
    btn.title = fmt(LANG.widget.iconBtnTitle, { name: t.name });
    btn.addEventListener('click', async (e) => {
      if (settingsOpen) return;
      if (e.ctrlKey) {
        handleTopicFrontToggle(t.id);
        return;
      }
      await window.api.createNewMemo(t.id);
    });
    return btn;
  }
  btn.title = fmt(LANG.widget.iconBtnTitleCollapsed, { name: t.name });
  btn.addEventListener('click', (e) => {
    if (settingsOpen) return;
    if (e.ctrlKey) {
      handleTopicFrontToggle(t.id);
      return;
    }
    if (iconClickTimers.has(t.id)) {
      clearTimeout(iconClickTimers.get(t.id));
      iconClickTimers.delete(t.id);
      window.api.toggleTopicOpen(t.id); // 완료되면 memos:updated 신호로 눈 아이콘도 자동 갱신됨
      return;
    }
    const timer = setTimeout(async () => {
      iconClickTimers.delete(t.id);
      await window.api.createNewMemo(t.id);
    }, 250);
    iconClickTimers.set(t.id, timer);
  });
  return btn;
}

function renderIconRow() {
  els.iconRow.innerHTML = '';
  const list = visibleTopics();
  if (!list.length) {
    const hint = document.createElement('div');
    hint.className = 'empty-hint';
    hint.textContent = LANG.widget.emptyTopicsHint;
    els.iconRow.appendChild(hint);
    return;
  }
  list.forEach((t) => els.iconRow.appendChild(makeTopicIconBtn(t)));
}

// 접힘 모드일 때 타이틀바 안에 표시되는 주제 버튼 목록
function renderCollapsedIcons() {
  els.collapsedIcons.innerHTML = '';
  visibleTopics().forEach((t) => els.collapsedIcons.appendChild(makeTopicIconBtn(t, true)));
}

let dragSourceTopicId = null;

// 드래그로 정한 새 "보이는" 주제 순서를 저장 → 상단 위젯바 아이콘도 같은 순서로 자동 반영됨
// (아이콘 행/대시보드 둘 다 같은 topics 배열 순서를 그대로 그리기 때문)
function applyVisibleTopicOrder(newVisibleIds) {
  const visibleSet = new Set(newVisibleIds);
  let qi = 0;
  return topics.map((t) => {
    if (visibleSet.has(t.id)) {
      const nextId = newVisibleIds[qi];
      qi += 1;
      return topics.find((x) => x.id === nextId) || t;
    }
    return t;
  });
}

async function reorderTopicsByDrag(draggedId, targetId) {
  const ids = visibleTopics().map((t) => t.id);
  const fromIdx = ids.indexOf(draggedId);
  const toIdx = ids.indexOf(targetId);
  if (fromIdx === -1 || toIdx === -1 || fromIdx === toIdx) return;
  ids.splice(fromIdx, 1);
  ids.splice(toIdx, 0, draggedId);
  topics = applyVisibleTopicOrder(ids);
  renderIconRow();
  renderCollapsedIcons();
  renderDashboard();
  await window.api.reorderTopics(ids);
}

function renderDashboard() {
  els.dashboard.innerHTML = '';
  const reorderable = visibleTopics().length > 1;

  visibleTopics().forEach((t) => {
    const list = memosOfTopic(t.id);
    const row = document.createElement('div');
    row.className = 'topic-row';
    if (t.hidden) row.style.opacity = '0.55';

    const head = document.createElement('div');
    head.className = 'topic-row-head';
    head.innerHTML = `
      ${reorderable ? `<span class="drag-grip" title="${LANG.widget.dragGripTitle}">⠿</span>` : ''}
      <span class="topic-dot" style="background:${t.color || '#8A8574'}"></span>
      <span class="topic-name">${escapeHtml(t.name)}</span>
      <span class="topic-count">${list.length}</span>
    `;

    // 주제가 2개 이상일 때만 드래그로 순서를 바꿀 수 있게 함
    // (수정) row 전체를 처음부터 draggable로 두면, 줄 아무데나 빠르게 두 번 클릭할 때
    // 두 번째 클릭이 "마이크로 드래그"로 인식돼서 더블클릭(메모 전체 열기/닫기)이 씹히는
    // 문제가 있었음. 그래서 평소엔 draggable을 꺼두고, ⠿ 손잡이를 누르는 순간에만 켜서
    // 손잡이로 끌 때만 드래그가 되고 줄의 클릭/더블클릭은 그대로 동작하게 함
    row.draggable = false;
    if (reorderable) {
      const grip = head.querySelector('.drag-grip');
      if (grip) {
        grip.addEventListener('mousedown', () => { row.draggable = true; });
        // 손잡이를 눌렀다가 끌지 않고 그냥 뗀 경우(dragstart가 아예 안 일어난 경우)를 대비한 안전장치
        grip.addEventListener('mouseup', () => { row.draggable = false; });
      }
      row.addEventListener('dragstart', (e) => {
        dragSourceTopicId = t.id;
        row.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', t.id);
      });
      row.addEventListener('dragend', () => {
        dragSourceTopicId = null;
        row.draggable = false;
        els.dashboard.querySelectorAll('.topic-row').forEach((r) => r.classList.remove('dragging', 'drag-over'));
      });
      row.addEventListener('dragover', (e) => {
        if (!dragSourceTopicId || dragSourceTopicId === t.id) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        row.classList.add('drag-over');
      });
      row.addEventListener('dragleave', () => row.classList.remove('drag-over'));
      row.addEventListener('drop', async (e) => {
        e.preventDefault();
        row.classList.remove('drag-over');
        if (!dragSourceTopicId || dragSourceTopicId === t.id) return;
        await reorderTopicsByDrag(dragSourceTopicId, t.id);
      });
    }
    // 클릭 동작은 없고, 이 주제가 지금 숨김 상태인지만 눈 아이콘으로 표시(감은눈=숨김, 뜬눈=보임)
    const hiddenIndicator = document.createElement('span');
    hiddenIndicator.className = 'topic-hidden-indicator' + (hiddenTopics.has(t.id) ? ' is-hidden' : '');
    hiddenIndicator.title = hiddenTopics.has(t.id) ? LANG.widget.topicHiddenOn : LANG.widget.topicHiddenOff;
    hiddenIndicator.innerHTML = eyeIconSvg(!hiddenTopics.has(t.id));
    head.appendChild(hiddenIndicator);

    const pinBtn = document.createElement('button');
    pinBtn.className = 'topic-vis-btn' + (pinnedTopics.has(t.id) ? ' active' : '');
    pinBtn.title = pinnedTopics.has(t.id) ? LANG.widget.topicPinOn : LANG.widget.topicPinOff;
    pinBtn.innerHTML = pinIconSvg(pinnedTopics.has(t.id));
    pinBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const nowPinned = await window.api.toggleTopicAlwaysOnTop(t.id);
      if (nowPinned) pinnedTopics.add(t.id);
      else pinnedTopics.delete(t.id);
      renderDashboard();
    });
    head.appendChild(pinBtn);

    if (t.hidden) {
      const unhideBtn = document.createElement('button');
      unhideBtn.className = 'unhide-btn';
      unhideBtn.textContent = LANG.widget.unhideButton;
      unhideBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        await window.api.updateTopic({ ...t, hidden: false });
        await loadAll();
      });
      head.appendChild(unhideBtn);
    }
    row.appendChild(head);

    if (t.description) {
      const desc = document.createElement('div');
      desc.className = 'topic-desc';
      desc.textContent = t.description;
      row.appendChild(desc);
    }

    const memoList = document.createElement('div');
    memoList.className = 'memo-list' + (expandedTopicIds.has(t.id) ? ' open' : '');
    list.forEach((m) => {
      const item = document.createElement('div');
      item.className = 'memo-list-item';

      const label = document.createElement('span');
      label.className = 'memo-list-item-title';
      label.textContent = m.title || LANG.widget.noTitle;
      // 주제 클릭 제스처와는 완전히 별개로 동작: 안 열려있으면 열고, 이미 열려있으면 닫음
      label.addEventListener('click', (e) => {
        e.stopPropagation();
        window.api.toggleMemoOpen(m.id);
      });
      item.appendChild(label);

      // 클릭 동작 없는 표시 전용 눈 아이콘: 이 메모가 지금 화면에 실제로 보이는 중인지 표시
      const memoIndicator = document.createElement('span');
      memoIndicator.className = 'memo-hidden-indicator' + (visibleMemoIds.has(m.id) ? '' : ' is-hidden');
      memoIndicator.title = visibleMemoIds.has(m.id) ? LANG.widget.memoVisibleOn : LANG.widget.memoVisibleOff;
      memoIndicator.innerHTML = eyeIconSvg(visibleMemoIds.has(m.id));
      item.appendChild(memoIndicator);

      const delBtn = document.createElement('button');
      delBtn.className = 'memo-list-item-del';
      delBtn.title = LANG.widget.deleteMemoTitle;
      delBtn.textContent = '×';
      delBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (settings.confirmMemoDelete !== false) {
          openConfirmModal(
            fmt(LANG.widget.deleteConfirmTitle, { title: m.title || LANG.widget.noTitle }),
            LANG.widget.deleteConfirmHint,
            () => window.api.deleteMemo(m.id),
            LANG.widget.deleteConfirmButton
          );
          return;
        }
        window.api.deleteMemo(m.id);
      });
      item.appendChild(delBtn);

      memoList.appendChild(item);
    });
    row.appendChild(memoList);

    row.addEventListener('click', (e) => {
      if (e.ctrlKey) {
        handleTopicFrontToggle(t.id);
        return;
      }
      handleTopicClick(t.id);
    });
    els.dashboard.appendChild(row);
  });
}

function renderHiddenToggle() {
  const hiddenCount = topics.filter((t) => t.hidden).length;
  // (수정) 예전엔 style.display를 직접 건드렸는데, 인라인 style은 스타일시트 규칙보다
  // 우선순위가 높아서 CSS로 정한 표시/숨김 규칙이 밀리는 문제가 있었음.
  // hidden 속성으로 바꾸면 그 문제 없이 스타일시트 규칙이 항상 정상적으로 적용됨
  els.btnToggleHidden.hidden = hiddenCount === 0;
  els.btnToggleHidden.classList.toggle('active', showHidden);
  els.btnToggleHidden.title = showHidden
    ? LANG.widget.hideToggleOn
    : fmt(LANG.widget.hideToggleOff, { count: hiddenCount });
}

// (추가) Ctrl+클릭 전용 동작: 클릭/더블클릭 제스처와는 완전히 별개로, 누를 때마다 그 주제의
// 지금 보이는 메모창들을 다른 프로그램보다 앞으로 가져옴(토글 아님, 뒤로 보내는 동작은 없음).
// 세 군데(펼침 아이콘줄/접힘 아이콘/대시보드 주제줄) 모두 이 함수 하나로 통일
async function handleTopicFrontToggle(topicId) {
  await window.api.toggleTopicFront(topicId);
}

// 단일/더블 클릭을 직접 구분해서 설정된 동작을 실행
function handleTopicClick(topicId) {
  if (clickTimers.has(topicId)) {
    clearTimeout(clickTimers.get(topicId));
    clickTimers.delete(topicId);
    runGestureAction(settings.clickGesture.double, topicId);
    return;
  }
  const timer = setTimeout(() => {
    clickTimers.delete(topicId);
    runGestureAction(settings.clickGesture.single, topicId);
  }, 250);
  clickTimers.set(topicId, timer);
}

async function runGestureAction(action, topicId) {
  switch (action) {
    case 'list':
      // 여러 주제를 동시에 펼칠 수 있게, 그 주제 하나만 토글(다른 주제의 펼침 상태는 안 건드림)
      if (expandedTopicIds.has(topicId)) expandedTopicIds.delete(topicId);
      else expandedTopicIds.add(topicId);
      renderDashboard();
      requestAnimationFrame(syncHeight);
      break;
    case 'expandAll':
      await window.api.toggleTopicOpen(topicId);
      break;
    case 'newMemo':
      if (!settingsOpen) await window.api.createNewMemo(topicId);
      break;
    // (정리) 예전에 있던 '위젯에서 숨기기(hideTopic)' 제스처는 설정 화면 선택지에서
    // 이미 빠졌는데(settings.js GESTURE_ACTIONS 참고) 여기 처리 코드만 남아있던 죽은 코드라 제거함
    case 'none':
    default:
      break;
  }
}

// 위젯 세로 크기는 사용자가 직접 드래그로 조절할 수 없고(main.js에서 막음), 항상 지금
// 화면에 보이는 내용(주제 수, 펼쳐진 메모 목록 등)에 맞춰 정확히 맞춤(늘어나기도, 줄어들기도 함)
// (수정) 예전엔 바깥 #widget의 scrollHeight를 쟀는데, 목록 영역(#dashboard)이 자체
// 스크롤(overflow-y:auto)을 가지고 있어서 내용이 넘칠 때 이게 바깥으로 안 알려지고
// 그냥 내부 스크롤만 생기는 문제가 있었음(그래서 "목록이 길어지면 창은 안 늘어나고
// 스크롤만 생기는" 현상이 있었음). 이제 각 영역 높이를 직접 더해서 정확한 "원하는 높이"를
// 계산하고, 그 높이가 화면보다 커질 것 같을 때만 안전장치로 내부 스크롤을 다시 켬
function syncHeight() {
  if (!settings.widget.autoResize || settings.widget.collapsed) return;
  // (수정) '숨긴 주제 보기'를 titlebar 안(always-actions)으로 옮기면서 더 이상 대시보드
  // 아래에 따로 한 줄을 차지하지 않게 됨 — 이제 titlebar.offsetHeight 안에 이미 포함돼
  // 있으므로, 예전처럼 따로 더하면 그만큼(약 18px) 창이 매번 더 크게 계산되는 문제가 생김
  const chromeHeight = els.titlebar.offsetHeight + els.iconRow.offsetHeight;
  const desired = chromeHeight + els.dashboard.scrollHeight;
  const maxHeight = Math.max(220, screenWorkArea.height - 60); // 화면 위아래 여백 정도 남김
  const height = Math.min(Math.max(desired, 220), maxHeight);
  els.dashboard.classList.toggle('scrollable', desired > maxHeight);
  if (height !== settings.widget.height) {
    window.api.resizeWidget(settings.widget.width, height);
  }
}

// 접힘 상태에서 주제 버튼 개수에 맞춰 위젯 폭을 자동으로 맞춤(늘어나기도, 줄어들기도 함).
// (수정) 처음엔 collapsed-icons를 잠깐 "안 잘리는 상태"로 바꿔서 titlebar.scrollWidth를 재는
// 방식으로 했는데, 실제로 재보니 1~2px 부족하게 계산돼서 collapsed-icons의 overflow-x:auto가
// 그 미세한 차이 때문에 계속 켜져서 가로 스크롤바가 남아있는 문제가 있었음. 그래서 titlebar 안의
// 각 조각(손잡이/주제버튼들/설정아이콘/눈아이콘)의 실제 렌더링된 크기(offsetWidth)를 그대로
// 더하고 padding/gap까지 정확히 계산하는 방식으로 바꾸고, 화면 배율(DPI) 차이로 인한 아주 작은
// 오차에 대비해 여유(SAFETY_BUFFER)도 몇 px 더해둠
const WIDGET_COLLAPSED_WIDTH_MIN = 180; // 설정 > 위젯 탭의 가로 입력칸 최소값과 맞춤
const WIDGET_COLLAPSED_WIDTH_BUFFER = 3; // DPI 배율 등으로 인한 오차 흡수용 여유
function syncCollapsedWidth() {
  if (!settings.widget.autoResize || !settings.widget.collapsed) return;
  const iconEls = Array.from(els.collapsedIcons.children);
  if (!iconEls.length) return; // 등록된 주제가 없으면 계산할 게 없으니 그대로 둠

  const iconsGap = parseFloat(getComputedStyle(els.collapsedIcons).columnGap) || 0;
  const iconsWidth = iconEls.reduce((sum, el) => sum + el.offsetWidth, 0) + iconsGap * (iconEls.length - 1);

  const titlebarStyle = getComputedStyle(els.titlebar);
  const titlebarGap = parseFloat(titlebarStyle.columnGap) || 0;
  const titlebarPadding = (parseFloat(titlebarStyle.paddingLeft) || 0) + (parseFloat(titlebarStyle.paddingRight) || 0);
  const dragHandleWidth = els.dragHandle ? els.dragHandle.offsetWidth : 0;
  const actionsWidth = els.titlebarActions ? els.titlebarActions.offsetWidth : 0;
  const alwaysActionsWidth = els.alwaysActions ? els.alwaysActions.offsetWidth : 0;

  // 타이틀바 안에 보이는 조각 4개(손잡이 / 주제버튼들 / 설정 관련 아이콘 / 눈 아이콘) 사이에 gap이 3번 들어감
  const desired = Math.ceil(
    titlebarPadding + dragHandleWidth + iconsWidth + actionsWidth + alwaysActionsWidth
    + titlebarGap * 3 + WIDGET_COLLAPSED_WIDTH_BUFFER
  );

  const maxWidth = Math.max(WIDGET_COLLAPSED_WIDTH_MIN, screenWorkArea.width - 40); // 화면 좌우 여백 정도 남김
  const width = Math.min(Math.max(desired, WIDGET_COLLAPSED_WIDTH_MIN), maxWidth);
  if (width !== settings.widget.width) {
    window.api.resizeWidget(width, settings.widget.height);
  }
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

els.btnSettings.addEventListener('click', () => window.api.openSettingsWindow());
// 검색 팝업은 위젯 옆에 따로 뜨는 작은 창이라, 여기선 열기만 하고 나머지는 그 팝업(search.js)이 다 처리함
els.btnSearch.addEventListener('click', () => window.api.openSearchWindow());
els.btnToggleHidden.addEventListener('click', () => {
  showHidden = !showHidden;
  render();
});

// 전체숨김 버튼은 누를 때마다 4단계로 순환함(다 숨기기→직전 상태로→다 보이기→직전 상태로).
// 다음에 누르면 뭐가 실행되는지 툴팁으로 알려주고, 전체숨김 중일 땐 버튼을 켜진 모양(active)으로 표시
function updateHideAllButton(state) {
  if (!state) return;
  memosHidden = !!state.allHidden;
  els.btnHideAll.classList.toggle('active', memosHidden);
  const nextLabel =
    state.nextAction === 'hideAll' ? LANG.widget.hideAllLabelHide
    : state.nextAction === 'showAll' ? LANG.widget.hideAllLabelShow
    : LANG.widget.hideAllLabelRevert;
  els.btnHideAll.title = fmt(LANG.widget.hideAllTitleTemplate, { label: nextLabel });
}

els.btnHideAll.addEventListener('click', async () => {
  const state = await window.api.toggleAllMemosVisibility();
  updateHideAllButton(state);
  // (수정) 전체숨기기를 누르면 실제로 모든 메모창의 보임/숨김 상태가 바뀌는데,
  // 대시보드의 눈 아이콘 표시는 loadAll로 다시 불러와야 최신 상태로 갱신됨
  await loadAll();
});

els.btnPinWidget.addEventListener('click', async () => {
  const nextValue = settings.widget.alwaysOnTop === false;
  const widgetSettings = await window.api.setWidgetAlwaysOnTop(nextValue);
  settings.widget = widgetSettings;
  applyWidgetState();
});

// 접기 버튼 대신 타이틀바를 더블클릭하면 접혔다 펼쳐졌다 하게 함(전체화면은 막아뒀으니
// 더블클릭을 이 용도로 대신 씀). 버튼/아이콘을 더블클릭한 경우는 무시해서 오작동 방지
// (수정) -webkit-app-region:drag 영역에서는 마우스를 누르는 순간 OS가 "창 이동"으로
// 먼저 가로채가서, 표준 dblclick 이벤트가 씹히고 안 뜨는 경우가 있음(특히 접힘 상태처럼
// 타이틀바 대부분이 드래그 영역일 때). dblclick 대신 mousedown 두 번의 시간 간격을
// 직접 재서 더블클릭을 판정하는 방식으로 바꿔서 더 확실하게 동작하게 함
let lastTitlebarMouseDownAt = 0;
els.titlebar.addEventListener('mousedown', async (e) => {
  if (e.target.closest('button, .topic-icon-btn, .drag-handle')) return;
  const now = Date.now();
  const isDoubleClick = now - lastTitlebarMouseDownAt < 400;
  lastTitlebarMouseDownAt = isDoubleClick ? 0 : now;
  if (!isDoubleClick) return;

  const nextValue = !settings.widget.collapsed;
  const widgetSettings = await window.api.setWidgetCollapsed(nextValue);
  settings.widget = widgetSettings;
  applyWidgetState();
  if (nextValue) {
    requestAnimationFrame(syncCollapsedWidth);
  } else {
    requestAnimationFrame(syncHeight);
  }
});

window.api.onTopicsUpdated(loadAll);
window.api.onMemosUpdated(loadAll);
window.api.onSettingsOpened(() => {
  settingsOpen = true;
  render();
});
window.api.onSettingsClosed(() => {
  settingsOpen = false;
  render();
});
// 최초 설치 직후 뜨는 웰컴창이 열려있는 동안 위젯의 모든 버튼/기능을 잠금(다 보이긴 하되 클릭 안 됨).
// 웰컴창을 다 넘기고 닫으면 자동으로 풀림. settingsOpen과는 별개 플래그로 관리함
let welcomeOpen = false;
window.api.onWelcomeOpened(() => {
  welcomeOpen = true;
  els.widget.classList.toggle('welcome-locked', welcomeOpen);
});
window.api.onWelcomeClosed(() => {
  welcomeOpen = false;
  els.widget.classList.toggle('welcome-locked', welcomeOpen);
});
window.api.onWidgetSizeChanged(({ width, height }) => {
  settings.widget.width = width;
  settings.widget.height = height;
  settings.widget.expandedHeight = height;
});
// 위젯을 다른 모니터로 옮기면 main.js가 그 모니터의 화면 크기를 즉시 보내줌 —
// 자동크기 한도를 새 모니터 기준으로 다시 계산해서, 옮긴 모니터가 더 작아도 그 범위 안에 맞춤
window.api.onScreenWorkAreaChanged((workArea) => {
  if (workArea && workArea.height) screenWorkArea = workArea;
  syncHeight();
  syncCollapsedWidth();
});
window.api.onSettingsUpdated(async () => {
  // 설정창에서 상단바 색상/투명도 등을 바꿨을 수 있으니 다시 불러와 반영
  settings = await window.api.getSettings();
  applyWidgetState();
});

loadAll();
