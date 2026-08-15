const els = {
  list: document.getElementById('list'),
  btnCancel: document.getElementById('btnCancel'),
  popupTitle: document.getElementById('popupTitle')
};

function applyLang() {
  document.title = LANG.moveTopic.windowTitle;
  els.popupTitle.textContent = LANG.moveTopic.popupTitle;
  els.btnCancel.textContent = LANG.moveTopic.cancelButton;
}

// 이 파일엔 escapeHtml 헬퍼가 따로 없어서, 목록에 이름 그대로 넣지 않고 안전하게 이스케이프해줌
function escapeHtmlSafe(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}

async function init() {
  applyLang();
  const topics = await window.api.getMoveTopicData();
  renderList(topics);
}

function renderList(topics) {
  els.list.innerHTML = '';
  if (!topics.length) {
    const empty = document.createElement('div');
    empty.className = 'memo-link-empty';
    empty.textContent = LANG.moveTopic.emptyHint;
    els.list.appendChild(empty);
    return;
  }
  topics.forEach((t) => {
    const item = document.createElement('div');
    item.className = 'memo-link-item move-topic-item';
    item.innerHTML = `
      <span class="swatch" style="background:${t.color};color:${t.textColor || '#FFFFFF'}">${escapeHtmlSafe(t.iconChar || '')}</span>
      <span>${escapeHtmlSafe(t.name)}</span>
    `;
    // 고르면 메인 프로세스가 원래 메모창에 알려주고 이 팝업은 알아서 닫힘
    item.addEventListener('click', () => window.api.chooseMoveTopic(t.id));
    els.list.appendChild(item);
  });
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') window.api.closeMoveTopicWindow();
});
els.btnCancel.addEventListener('click', () => window.api.closeMoveTopicWindow());

init();
