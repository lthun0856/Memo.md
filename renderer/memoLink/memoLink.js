const els = {
  searchInput: document.getElementById('searchInput'),
  list: document.getElementById('list'),
  btnCancel: document.getElementById('btnCancel'),
  popupTitle: document.getElementById('popupTitle'),
  popupHint: document.getElementById('popupHint')
};

let entries = [];

function applyLang() {
  document.title = LANG.memoLink.windowTitle;
  els.popupTitle.textContent = LANG.memoLink.popupTitle;
  els.popupHint.textContent = LANG.memoLink.popupHint;
  els.searchInput.placeholder = LANG.memoLink.searchPlaceholder;
  els.btnCancel.textContent = LANG.memoLink.cancelButton;
}

async function init() {
  applyLang();
  entries = await window.api.getExportLog();
  renderList('');
  els.searchInput.focus();
}

function renderList(query) {
  const q = query.trim().toLowerCase();
  const filtered = entries.filter((it) => {
    if (!q) return true;
    return (it.title || '').toLowerCase().includes(q) || (it.topicName || '').toLowerCase().includes(q);
  });

  els.list.innerHTML = '';
  if (!filtered.length) {
    const empty = document.createElement('div');
    empty.className = 'memo-link-empty';
    empty.textContent = entries.length ? LANG.memoLink.noSearchResult : LANG.memoLink.noExportedMemo;
    els.list.appendChild(empty);
    return;
  }

  // 주제별로 묶어서 보여줌(각 그룹 안에서는 이미 최근 내보낸 순으로 정렬돼있음)
  const groups = new Map();
  filtered.forEach((it) => {
    const key = it.topicName || LANG.memoLink.uncategorized;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(it);
  });

  groups.forEach((items, topicName) => {
    const groupTitle = document.createElement('div');
    groupTitle.className = 'memo-link-group-title';
    groupTitle.textContent = topicName;
    els.list.appendChild(groupTitle);

    items.forEach((it) => {
      const item = document.createElement('div');
      item.className = 'memo-link-item';
      const titleSpan = document.createElement('span');
      titleSpan.textContent = it.title || LANG.memoLink.noTitle;
      const fileSpan = document.createElement('span');
      fileSpan.className = 'memo-link-item-file';
      fileSpan.textContent = it.fileNameNoExt;
      item.appendChild(titleSpan);
      item.appendChild(fileSpan);
      // 고르면 메인 프로세스가 원래 메모창에 [[링크]]를 꽂아주고 이 팝업은 알아서 닫힘
      item.addEventListener('click', () => window.api.chooseMemoLink(it.fileNameNoExt));
      els.list.appendChild(item);
    });
  });
}

els.searchInput.addEventListener('input', () => renderList(els.searchInput.value));
els.searchInput.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') window.api.closeMemoLinkWindow();
});
els.btnCancel.addEventListener('click', () => window.api.closeMemoLinkWindow());

init();
