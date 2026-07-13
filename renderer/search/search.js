const els = {
  searchInput: document.getElementById('searchInput'),
  list: document.getElementById('list'),
  btnCancel: document.getElementById('btnCancel'),
  popupTitle: document.getElementById('popupTitle'),
  popupHint: document.getElementById('popupHint')
};

let memos = [];
let topics = [];

function applyLang() {
  document.title = LANG.search.windowTitle;
  els.popupTitle.textContent = LANG.search.popupTitle;
  els.popupHint.textContent = LANG.search.popupHint;
  els.searchInput.placeholder = LANG.search.searchPlaceholder;
  els.btnCancel.textContent = LANG.search.closeButton;
}

async function init() {
  applyLang();
  [memos, topics] = await Promise.all([window.api.getAllMemos(), window.api.getTopics()]);
  renderList('');
  els.searchInput.focus();
}

// 본문에서 검색어가 매칭된 부분 앞뒤를 짧게 잘라서 보여줌(제목엔 없고 본문에만 있을 때만 씀 —
// 제목에 이미 검색어가 보이면 스니펫 없이도 왜 걸렸는지 충분히 알 수 있어서)
function makeSnippet(content, q) {
  const lower = content.toLowerCase();
  const idx = lower.indexOf(q);
  if (idx === -1) return '';
  const start = Math.max(0, idx - 15);
  const end = Math.min(content.length, idx + q.length + 30);
  let snippet = content.slice(start, end).replace(/\s+/g, ' ').trim();
  if (start > 0) snippet = '…' + snippet;
  if (end < content.length) snippet += '…';
  return snippet;
}

function renderList(query) {
  const q = query.trim().toLowerCase();
  const filtered = memos
    .map((m) => {
      if (!q) return { memo: m, snippet: '' };
      const titleHit = (m.title || '').toLowerCase().includes(q);
      const contentHit = (m.content || '').toLowerCase().includes(q);
      if (!titleHit && !contentHit) return null;
      return { memo: m, snippet: !titleHit && contentHit ? makeSnippet(m.content, q) : '' };
    })
    .filter(Boolean);

  els.list.innerHTML = '';
  if (!filtered.length) {
    const empty = document.createElement('div');
    empty.className = 'search-empty';
    empty.textContent = memos.length ? LANG.search.noSearchResult : LANG.search.noMemos;
    els.list.appendChild(empty);
    return;
  }

  // 주제별로 묶어서 보여줌(주제가 없거나 이미 삭제됐으면 "미분류")
  const groups = new Map();
  filtered.forEach((f) => {
    const topic = topics.find((t) => t.id === f.memo.topicId);
    const key = topic ? topic.name : LANG.search.uncategorized;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(f);
  });

  groups.forEach((items, topicName) => {
    const groupTitle = document.createElement('div');
    groupTitle.className = 'search-group-title';
    groupTitle.textContent = topicName;
    els.list.appendChild(groupTitle);

    items.forEach(({ memo, snippet }) => {
      const item = document.createElement('div');
      item.className = 'search-item';
      const titleSpan = document.createElement('span');
      titleSpan.textContent = memo.title || LANG.search.noTitle;
      item.appendChild(titleSpan);
      if (snippet) {
        const snippetSpan = document.createElement('span');
        snippetSpan.className = 'search-item-snippet';
        snippetSpan.textContent = snippet;
        item.appendChild(snippetSpan);
      }
      // 고르면 메인 프로세스가 그 메모창을 열어주고 이 팝업은 알아서 닫힘(메모 연결 팝업과 동일한 방식)
      item.addEventListener('click', () => window.api.chooseSearchResult(memo.id));
      els.list.appendChild(item);
    });
  });
}

els.searchInput.addEventListener('input', () => renderList(els.searchInput.value));
els.searchInput.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') window.api.closeSearchWindow();
});
els.btnCancel.addEventListener('click', () => window.api.closeSearchWindow());

init();
