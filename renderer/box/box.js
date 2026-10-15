// (2026-10-13) 바탕화면 정리 박스 창
// - 폴더 안 파일을 아이콘으로 보여주고, 더블클릭=열기 / 끌어넣기=폴더로 이동 / 끌어내기=꺼내기
// - 접어둔 박스는 제목줄에 마우스를 올리면 펼쳐짐(다시 접는 건 src/box.js 가 마우스 위치를 보고 처리)
// 전역 이름(api, LANG 등)과 안 부딪히게 파일 전체를 감쌈(인계서 주의사항)
(function () {
  'use strict';
  const B = window.boxApi;
  const L = (typeof LANG !== 'undefined' && LANG.box) || {}; // LANG 은 const 라 window.LANG 으로는 안 보임
  const $ = (id) => document.getElementById(id);
  const el = {
    box: $('box'), bar: $('bar'), name: $('boxName'), count: $('boxCount'),
    pin: $('btnPin'), menu: $('btnMenu'), close: $('btnClose'),
    body: $('body'), grid: $('grid'), empty: $('empty'),
    missing: $('missing'), missingText: $('missingText'), relink: $('btnRelink'), toast: $('toast'),
    grip: $('grip')
  };
  if (!B) return;

  let data = null;          // 마지막으로 받은 박스 정보
  let items = [];
  let selected = new Set(); // 선택된 파일 경로
  let anchorIdx = -1;       // Shift 선택 기준
  let expanded = true;
  let hoverTimer = null;
  let toastTimer = null;

  function fmt(s, v) { return String(s || '').replace(/\{(\w+)\}/g, (_, k) => (v && v[k] != null ? v[k] : '')); }

  el.menu.title = L.menuTitle || '';
  el.close.title = L.closeTitle || '';
  el.relink.textContent = L.relink || '';
  el.grip.title = L.gripTitle || '';

  // (2차) 배경색 + 투명도로 칠하고, 글씨색은 배경에 맞춰 자동으로 고름
  // - 배경이 많이 비치면(투명도 50% 이상) 바탕화면 아이콘처럼 흰 글씨 + 그림자
  // - 아니면 배경이 어두우면 흰 글씨, 밝으면 진한 글씨
  function hexRgb(hex) {
    const m = /^#([0-9a-f]{6})$/i.exec(hex || '');
    const n = parseInt(m ? m[1] : 'F7F4EC', 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function applyLook(box) {
    const rs = document.documentElement.style;
    const [r, g, b] = hexRgb(box.bgColor);
    const tr = Math.min(100, Math.max(0, Number(box.bgTransparency) || 0));
    // 완전 투명(0)이면 마우스·끌어넣기를 못 받을 수 있어서 아주 조금(1%)은 남겨 둠
    const alpha = Math.max(0.01, 1 - tr / 100);
    rs.setProperty('--bg', `rgba(${r}, ${g}, ${b}, ${alpha})`);
    const dark = (0.299 * r + 0.587 * g + 0.114 * b) / 255 < 0.55;
    const light = tr >= 50 || dark; // 흰 글씨를 쓸지
    rs.setProperty('--fg', light ? '#FFFFFF' : '#2B2820');
    rs.setProperty('--fg-sub', light ? 'rgba(255,255,255,0.85)' : '#8A8577');
    rs.setProperty('--shadow', tr >= 50 ? '0 1px 2px rgba(0,0,0,0.85), 0 0 4px rgba(0,0,0,0.6)' : 'none');
    rs.setProperty('--hover', light ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.05)');
    rs.setProperty('--sel', light ? 'rgba(255,255,255,0.24)' : 'rgba(43,40,32,0.12)');
    rs.setProperty('--sel-line', light ? 'rgba(255,255,255,0.45)' : 'rgba(43,40,32,0.25)');
  }

  function showToast(text) {
    if (!text) return;
    el.toast.textContent = text;
    el.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.toast.hidden = true; }, (data && data.toastMs) || 4000);
  }
  function setExpandedUi(v) {
    expanded = !!v;
    el.box.classList.toggle('collapsed', !expanded);
  }

  // ---- (6차) 묶음 탭 ----
  const tabsEl = document.getElementById('tabs');
  function renderTabs(res) {
    if (!tabsEl) return;
    const panel = res.panel || {};
    tabsEl.hidden = !panel.isGroup;
    tabsEl.innerHTML = '';
    if (!panel.isGroup) return;
    (res.tabs || []).forEach((t) => {
      const d = document.createElement('div');
      d.className = 'tab' + (t.id === res.activeId ? ' active' : '');
      d.dataset.boxId = t.id;
      d.textContent = (t.kind === 'folder' ? '🔗 ' : '') + t.name; // (7차) 폴더 창 표시
      if (t.isDefault) {
        const m = document.createElement('span');
        m.className = 'tab-dot';
        m.textContent = '●';
        m.title = L.defaultBadgeTitle || '';
        d.appendChild(m);
      }
      d.title = t.name;
      tabsEl.appendChild(d);
    });
  }
  function tabOf(e) {
    const t = e.target && e.target.closest ? e.target.closest('.tab') : null;
    return t && t.dataset.boxId ? t : null;
  }
  // (7차) 탭 끌기(포토샵식): 다른 창 제목줄에 놓으면 그 창으로 묶이고, 창 밖에 놓으면 따로 떨어져 나옴.
  // 조금만 움직이고 놓으면 그냥 클릭 = 탭 바꾸기. 판단은 src/box.js 가 마우스 위치로 함
  let tabDrag = null;          // { el, id, last, busy, order(11차: 놓으면 바뀔 탭 순서) }
  let pendingRefresh = false;  // 탭을 끄는 동안 화면을 새로 그리면 끌기가 끊겨서 → 끝난 뒤 한 번 새로 그림
  async function endTabDrag(cancel) {
    if (!tabDrag) return;
    const d = tabDrag;
    tabDrag = null;
    d.el.classList.remove('dragging', 'tearing');
    clearInsMark();
    let r = null;
    try { r = await B.tabDragEnd(cancel); } catch (err) { r = null; }
    // (11차) 같은 탭 줄 안에 놓았으면 탭 순서 바꾸기(놓은 자리 기준으로 한 번 더 계산)
    if (!cancel && r && r.moved && !r.done) { updateInsMark(d, true); clearInsMark(); }
    if (!cancel && r && r.moved && !r.done && d.order && B.reorderTabs) {
      try { await B.reorderTabs(d.order); } catch (err) { /* 무시 */ }
    }
    if (!cancel && r && !r.moved && !d.el.classList.contains('active')) {
      selected.clear();
      anchorIdx = -1;
      B.setActive(d.id);
    }
    if (pendingRefresh) { pendingRefresh = false; refresh(); }
  }
  // (11차) 탭 순서 바꾸기: 끄는 탭이 제목줄 높이 안에 있으면 놓일 자리에 세로선, 놓으면 그 순서로
  function clearInsMark() {
    if (!tabsEl) return;
    tabsEl.querySelectorAll('.tab.ins-before, .tab.ins-after').forEach((t) => t.classList.remove('ins-before', 'ins-after'));
  }
  function updateInsMark(d, can) {
    clearInsMark();
    d.order = null;
    if (!can || typeof d.px !== 'number') return;
    const br = el.bar.getBoundingClientRect();
    if (d.py < br.top || d.py > br.bottom) return; // 제목줄 위에 있을 때만
    const tabs = [...tabsEl.querySelectorAll('.tab')];
    if (tabs.length < 2) return;
    const ids = tabs.map((t) => t.dataset.boxId);
    let idx = tabs.findIndex((t) => { const r = t.getBoundingClientRect(); return d.px < r.left + r.width / 2; });
    if (idx < 0) idx = tabs.length;
    const from = ids.indexOf(d.id);
    if (from < 0) return;
    const rest = ids.filter((id) => id !== d.id);
    const at = idx > from ? idx - 1 : idx;
    rest.splice(at, 0, d.id);
    if (rest.join('|') === ids.join('|')) return; // 제자리면 표시 안 함
    d.order = rest;
    if (idx < tabs.length) tabs[idx].classList.add('ins-before');
    else tabs[tabs.length - 1].classList.add('ins-after');
  }
  if (tabsEl) {
    tabsEl.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || tabDrag) return;
      const t = tabOf(e);
      if (!t) return;
      e.preventDefault();
      clearTimeout(hoverTimer);
      tabDrag = { el: t, id: t.dataset.boxId, last: 0, busy: false };
      try { t.setPointerCapture(e.pointerId); } catch (err) { /* 무시 */ }
      B.tabDragStart(tabDrag.id);
    });
    tabsEl.addEventListener('pointermove', async (e) => {
      if (!tabDrag) return;
      tabDrag.px = e.clientX; // (11차) 탭 순서 바꾸기용 마우스 위치
      tabDrag.py = e.clientY;
      if (tabDrag.busy) return;
      const now = performance.now();
      if (now - tabDrag.last < 30) return;
      const d = tabDrag;
      d.last = now;
      d.busy = true;
      let r = null;
      try { r = await B.tabDragMove(); } catch (err) { r = null; }
      d.busy = false;
      if (tabDrag !== d) return;
      d.el.classList.toggle('dragging', !!(r && r.moved));
      d.el.classList.toggle('tearing', !!(r && r.out)); // 창 밖 = 놓으면 떨어져 나옴
      updateInsMark(d, !!(r && r.moved && !r.out && !r.target));
    });
    tabsEl.addEventListener('pointerup', (e) => {
      if (tabDrag) { tabDrag.px = e.clientX; tabDrag.py = e.clientY; } // (11차) 놓은 자리로 순서 계산
      endTabDrag(false);
    });
    tabsEl.addEventListener('pointercancel', () => endTabDrag(true));
    tabsEl.addEventListener('lostpointercapture', () => endTabDrag(false));
    tabsEl.addEventListener('contextmenu', (e) => {
      const t = tabOf(e);
      if (!t) return;
      e.preventDefault();
      e.stopPropagation();
      B.boxMenu(t.dataset.boxId);
    });
  }

  async function refresh() {
    if (tabDrag) { pendingRefresh = true; return; }
    let res;
    try { res = await B.list(); } catch (e) { return; }
    if (!res || res.reason === 'nobox' || !res.box) return;
    data = res;
    const box = res.box;
    const rs = document.documentElement.style;
    rs.setProperty('--title-h', res.titleHeight + 'px');
    rs.setProperty('--fade-ms', (Number(res.fadeMs) || 0) + 'ms');            // (9차) 사라지는 속도
    rs.setProperty('--fade-in-ms', (Number(res.fadeInMs) || 0) + 'ms');       // (11차) 나타나는 속도
    rs.setProperty('--faded-op', String((Number(res.fadedOpacity) || 0) / 100));
    rs.setProperty('--icon', res.iconSize + 'px');
    rs.setProperty('--bar', box.color || '#2B2820');
    applyLook(box);
    const panel = res.panel || {};
    document.title = panel.isGroup ? (panel.name || box.name) : box.name;
    // (6차) 묶음이면 제목 자리에 탭들, 아니면 정리함 이름
    renderTabs(res);
    el.name.hidden = !!panel.isGroup;
    el.name.textContent = (box.kind === 'folder' ? '🔗 ' : '') + box.name; // (7차) 폴더 창 표시
    const badge = document.getElementById('boxBadge');
    if (badge) { badge.hidden = !!panel.isGroup || !box.isDefault; badge.textContent = L.defaultBadge || ''; badge.title = L.defaultBadgeTitle || ''; }
    el.bar.title = panel.isGroup ? '' : box.folder;
    setExpandedUi(res.expanded);
    el.pin.hidden = !!res.popup;
    el.grip.hidden = !!panel.locked; // (13차) 위치 고정이면 크기 손잡이 숨김
    el.close.hidden = !res.popup;
    el.pin.textContent = panel.collapsed ? '▸' : '▾';
    el.pin.title = panel.collapsed ? (L.pinClosedTitle || '') : (L.pinOpenTitle || '');

    if (!res.ok) {
      items = [];
      el.grid.innerHTML = '';
      el.count.textContent = '';
      el.empty.hidden = true;
      el.missing.hidden = false;
      el.missingText.textContent = fmt(L.missing, { folder: box.folder });
      return;
    }
    el.missing.hidden = true;
    items = Array.isArray(res.items) ? res.items : [];
    const keep = new Set(items.map((i) => i.path));
    selected = new Set([...selected].filter((p) => keep.has(p)));
    render();
  }

  // (6차) 날짜순일 때 묶음 제목: 오늘 / 어제 / 이번 주 / 지난주 / 이번 달 / 지난달 / 더 이전
  function dateGroupOf(ms) {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const day = 86400000;
    const dow = (now.getDay() + 6) % 7; // 월요일 = 0
    const weekStart = today - dow * day;
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1).getTime();
    if (ms >= today) return 'today';
    if (ms >= today - day) return 'yesterday';
    if (ms >= weekStart) return 'thisWeek';
    if (ms >= weekStart - 7 * day) return 'lastWeek';
    if (ms >= monthStart) return 'thisMonth';
    if (ms >= lastMonthStart) return 'lastMonth';
    return 'older';
  }
  // (8차) 폴더 아이콘(고정 그림 — 윈도우가 가끔 드라이브 모양을 주던 문제 대신)
  const FOLDER_SVG = '<svg class="folder-svg" viewBox="0 0 48 48" aria-hidden="true">'
    + '<path d="M4 11a3 3 0 0 1 3-3h11.2l3.6 3.6H41a3 3 0 0 1 3 3V17H4z" fill="#D9A21E"/>'
    + '<path d="M4 16h40v21a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3z" fill="#F4C44C"/>'
    + '<path d="M4 16h40v2H4z" fill="#FBDA7E"/></svg>';
  function render() {
    el.grid.innerHTML = '';
    const byDate = data && data.box && data.box.sort === 'date';
    let lastGroup = null;
    items.forEach((it, idx) => {
      if (byDate) {
        const g = dateGroupOf(it.mtime || 0);
        if (g !== lastGroup) {
          lastGroup = g;
          const h = document.createElement('div');
          h.className = 'date-head';
          h.textContent = (L.dateGroups && L.dateGroups[g]) || g;
          el.grid.appendChild(h);
        }
      }
      const d = document.createElement('div');
      d.className = 'item' + (selected.has(it.path) ? ' sel' : '');
      d.draggable = true;
      d.dataset.tip = it.name; // (13차) 윈도우 기본 이름표(title) 대신 직접 그리는 이름표
      d.dataset.idx = String(idx);
      // (8차) 아이콘 칸: 폴더는 앱이 그린 폴더 그림, 바로가기는 왼쪽 아래 ↗ 화살표
      const ic = document.createElement('div');
      ic.className = 'ic';
      if (it.folderIcon || (it.isDir && !it.icon)) {
        ic.innerHTML = FOLDER_SVG;
      } else if (it.icon) {
        const img = document.createElement('img');
        img.src = it.icon;
        img.alt = '';
        img.draggable = false;
        ic.appendChild(img);
      } else {
        const ph = document.createElement('div');
        ph.className = 'ph';
        ph.textContent = '📄';
        ic.appendChild(ph);
      }
      if (it.isLink) {
        const ar = document.createElement('span');
        ar.className = 'lnk-arrow';
        ar.textContent = '↗';
        ic.appendChild(ar);
      }
      d.appendChild(ic);
      const lbl = document.createElement('div');
      lbl.className = 'lbl';
      lbl.textContent = it.label;
      d.appendChild(lbl);
      el.grid.appendChild(d);
    });
    // 너무 많아서 다 못 그릴 때 맨 아래 안내 줄 (11차: 폴더 창 "최근 것만" 기능은 삭제)
    const over = (data && data.overCount) || 0;
    if (over > 0) {
      const more = document.createElement('div');
      more.className = 'more-line';
      const t = document.createElement('span');
      t.textContent = fmt(L.overCount, { n: over, max: (data && data.maxItems) || '' });
      more.appendChild(t);
      const link = (text, fn) => {
        const a = document.createElement('button');
        a.type = 'button';
        a.className = 'more-link';
        a.textContent = text || '';
        a.addEventListener('click', (e) => { e.stopPropagation(); fn(); });
        a.addEventListener('dblclick', (e) => e.stopPropagation());
        more.appendChild(a);
      };
      link(L.openInExplorer, () => B.openFolderSelf());
      el.grid.appendChild(more);
    }
    el.count.textContent = items.length ? fmt(L.count, { n: items.length }) : '';
    const isFolder = data && data.box && data.box.kind === 'folder';
    el.empty.textContent = isFolder ? (L.emptyFolder || '') : (L.empty || '');
    el.empty.hidden = items.length > 0;
  }

  function hitOf(e) {
    const d = e.target && e.target.closest ? e.target.closest('.item') : null;
    if (!d) return null;
    const idx = Number(d.dataset.idx);
    return items[idx] ? { idx, item: items[idx] } : null;
  }
  function updateSel() {
    el.grid.querySelectorAll('.item').forEach((d) => {
      const it = items[Number(d.dataset.idx)];
      d.classList.toggle('sel', !!it && selected.has(it.path));
    });
  }
  function selectOnly(hit) {
    selected = new Set([hit.item.path]);
    anchorIdx = hit.idx;
    updateSel();
  }
  async function openPaths(paths) {
    for (const p of paths) {
      const err = await B.open(p);
      if (err) { showToast(fmt(L.openFailed, { msg: err })); break; }
    }
  }

  // ---- 선택 / 열기 / 메뉴 ----
  // (11차) 바탕화면에 깔린 정리함도 안을 누르면 앞으로 나오고 키보드를 받음(Delete 키 등). 위젯형은 원래 받음
  el.body.addEventListener('pointerdown', () => {
    if (B.activate && !(data && data.popup) && !document.hasFocus()) B.activate();
  }, true);
  el.body.addEventListener('click', (e) => {
    const hit = hitOf(e);
    if (!hit) { selected.clear(); updateSel(); return; }
    if (e.ctrlKey) {
      if (selected.has(hit.item.path)) selected.delete(hit.item.path); else selected.add(hit.item.path);
      anchorIdx = hit.idx;
      updateSel();
    } else if (e.shiftKey && anchorIdx >= 0) {
      selected = new Set();
      const a = Math.min(anchorIdx, hit.idx);
      const b = Math.max(anchorIdx, hit.idx);
      for (let i = a; i <= b; i++) selected.add(items[i].path);
      updateSel();
    } else {
      selectOnly(hit);
    }
  });
  el.body.addEventListener('dblclick', (e) => {
    const hit = hitOf(e);
    if (hit) openPaths([hit.item.path]);
  });
  el.body.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const hit = hitOf(e);
    if (!hit) { B.boxMenu(); return; }
    if (!selected.has(hit.item.path)) selectOnly(hit);
    B.itemMenu([...selected]);
  });
  el.bar.addEventListener('contextmenu', (e) => { e.preventDefault(); B.boxMenu(); });
  el.menu.addEventListener('click', () => B.boxMenu());
  el.pin.addEventListener('click', () => B.toggleCollapsed());
  el.close.addEventListener('click', () => B.closeSelf());
  el.relink.addEventListener('click', () => B.changeFolderSelf());
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && data && data.popup) B.closeSelf();
    else if (e.key === 'Enter' && selected.size) openPaths([...selected]);
    else if (e.key === 'Delete' && selected.size && B.trash) { // (11차) 휴지통으로(확인창 없음)
      const list = [...selected];
      selected.clear();
      anchorIdx = -1;
      B.trash(list);
    }
  });

  // ---- 접힌 박스: 제목줄에 마우스를 올리면 잠시 뒤 펼침 ----
  el.bar.addEventListener('mouseenter', () => {
    if (expanded || !data || data.popup || !(data.panel && data.panel.collapsed)) return;
    clearTimeout(hoverTimer);
    hoverTimer = setTimeout(() => { if (!expanded) B.setExpanded(true); }, data.hoverExpandMs || 0);
  });
  el.bar.addEventListener('mouseleave', () => clearTimeout(hoverTimer));
  el.bar.addEventListener('dblclick', (e) => {
    if (e.target.closest('button') || !data || data.popup) return;
    B.toggleCollapsed();
  });

  // ---- 제목줄 잡고 창 옮기기(실제 이동은 src/box.js 가 마우스 위치로 계산) ----
  let dragging = false;
  let movedEnough = false;
  let startX = 0;
  let startY = 0;
  let lastSend = 0;
  el.bar.addEventListener('mousedown', (e) => {
    if (e.button !== 0 || e.target.closest('button') || e.target.closest('.tab')) return; // 탭은 탭 끌기(위)
    clearTimeout(hoverTimer);
    dragging = true;
    movedEnough = false;
    startX = e.screenX;
    startY = e.screenY;
    B.dragStart();
  });
  window.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    if (e.buttons === 0) { dragging = false; B.dragEnd(); return; } // 버튼을 놓친 경우 정리
    if (!movedEnough && Math.abs(e.screenX - startX) + Math.abs(e.screenY - startY) < 3) return;
    movedEnough = true;
    const now = performance.now();
    if (now - lastSend < 15) return;
    lastSend = now;
    B.dragMove();
  });
  window.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false;
    B.dragEnd();
  });

  // ---- (3차) Ctrl + 마우스 휠로 아이콘 크기 바꾸기 ----
  // 화면은 바로 바꾸고, 저장은 휠을 멈춘 뒤 한 번만(저장되면 그 크기에 맞는 선명한 아이콘을 다시 받아 옴)
  let iconSaveTimer = null;
  window.addEventListener('wheel', (e) => {
    if (!e.ctrlKey) return;
    e.preventDefault(); // 창 전체 확대/축소 막기
    if (!data || !expanded) return;
    const r = data.iconRange || { min: 16, max: 128, step: 8 };
    const cur = Number(data.iconSize) || 40;
    const next = Math.min(r.max, Math.max(r.min, cur + (e.deltaY < 0 ? r.step : -r.step)));
    if (next === cur) return;
    data.iconSize = next;
    document.documentElement.style.setProperty('--icon', next + 'px');
    clearTimeout(iconSaveTimer);
    iconSaveTimer = setTimeout(() => B.setIconSize(next), 300);
  }, { passive: false });

  // ---- (2차) 오른쪽 아래 ◢ 손잡이로 크기 바꾸기 ----
  let resizing = false;
  let lastResize = 0;
  el.grip.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    resizing = true;
    try { el.grip.setPointerCapture(e.pointerId); } catch (err) { /* 무시 */ }
    B.resizeStart();
  });
  el.grip.addEventListener('pointermove', (e) => {
    if (!resizing) return;
    const now = performance.now();
    if (now - lastResize < 15) return;
    lastResize = now;
    B.resizeMove();
  });
  const endResize = () => {
    if (!resizing) return;
    resizing = false;
    B.resizeEnd();
  };
  el.grip.addEventListener('pointerup', endResize);
  el.grip.addEventListener('pointercancel', endResize);
  el.grip.addEventListener('lostpointercapture', endResize);

  // ---- 끌어내기: 박스 → 바탕화면/탐색기/다른 박스 ----
  el.grid.addEventListener('dragstart', (e) => {
    const hit = hitOf(e);
    if (!hit) return;
    e.preventDefault();
    if (!selected.has(hit.item.path)) selectOnly(hit);
    B.startDrag([...selected]);
  });

  // ---- 끌어넣기: 파일을 떨어뜨리면 박스 폴더로 이동 ----
  // (주의) dropEffect 를 'copy' 로 둠 — 'move' 로 하면 탐색기가 "옮겨졌다"고 보고 원본 정리를 시도할 수 있음.
  // 실제 이동은 src/box.js 가 하고, 실패하면 원본은 그대로 남음
  let dragDepth = 0;
  const hasFiles = (e) => !!(e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files'));
  document.addEventListener('dragenter', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth++;
    el.body.classList.add('drop-over');
    if (!expanded && data && !data.popup) B.setExpanded(true);
  });
  document.addEventListener('dragover', (e) => {
    // 파일이 아닌 것(휴지통이 섞인 선택 등)도 받아 줘야 drop 에서 안내를 띄울 수 있음
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    // (6차) 탭 위에 있으면 그 탭을 강조
    const tab = tabOf(e);
    document.querySelectorAll('.tab.drop-target').forEach((t) => { if (t !== tab) t.classList.remove('drop-target'); });
    if (tab) tab.classList.add('drop-target');
    // (10차) 직접 정렬: 놓일 자리에 세로선
    markInsert(tab ? null : insertAt(e));
  });
  // (10차) 직접 정렬일 때 놓을 자리 = { el(아이콘), path, after(오른쪽 반이면 뒤) } / 빈 곳이면 null(맨 뒤)
  function insertAt(e) {
    if (!data || !data.box || data.box.sort !== 'custom') return null;
    const d = e.target && e.target.closest ? e.target.closest('.item') : null;
    if (!d) return null;
    const it = items[Number(d.dataset.idx)];
    if (!it) return null;
    const r = d.getBoundingClientRect();
    return { el: d, path: it.path, after: e.clientX > r.left + r.width / 2 };
  }
  let insEl = null;
  function markInsert(ins) {
    if (insEl && (!ins || ins.el !== insEl)) insEl.classList.remove('ins-before', 'ins-after');
    insEl = ins ? ins.el : null;
    if (ins) {
      ins.el.classList.toggle('ins-after', ins.after);
      ins.el.classList.toggle('ins-before', !ins.after);
    }
  }
  document.addEventListener('dragleave', (e) => {
    if (!hasFiles(e)) return;
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) {
      markInsert(null);
      el.body.classList.remove('drop-over');
      document.querySelectorAll('.tab.drop-target').forEach((t) => t.classList.remove('drop-target'));
    }
  });
  document.addEventListener('drop', async (e) => {
    e.preventDefault();
    dragDepth = 0;
    el.body.classList.remove('drop-over');
    document.querySelectorAll('.tab.drop-target').forEach((t) => t.classList.remove('drop-target'));
    const ins = insertAt(e);
    markInsert(null);
    const files = Array.from((e.dataTransfer && e.dataTransfer.files) || []);
    const paths = files.map((f) => B.pathForFile(f)).filter(Boolean);
    if (!paths.length) { showToast(L.noFiles); return; }
    // (6차) 탭 위에 떨어뜨리면 그 탭의 정리함으로. (10차) 아니면 놓은 자리와 함께 보냄(직접 정렬이면 그 자리에 들어감)
    const tab = tabOf(e);
    const r = tab ? await B.moveInTo(tab.dataset.boxId, paths)
      : (B.dropAt ? await B.dropAt(paths, ins ? ins.path : null, ins ? ins.after : false) : await B.moveIn(paths));
    if (r && r.errors && r.errors.length) {
      showToast(fmt(L.failed, { n: r.errors.length }) + '\n' + r.errors.slice(0, 4).join('\n'));
    }
  });

  // ---- (13차) 직접 그리는 이름표 ----
  // 윈도우 기본 이름표(title)는 이 투명창에서 마우스가 나가도 안 사라지고 남는 문제가 있어서,
  // 창 안에 직접 그리고 마우스가 나가거나 누르거나 굴리면 확실히 지움. title 은 마우스가 올라올 때 data-tip 으로 옮김
  const tip = document.createElement('div');
  tip.className = 'tip';
  tip.hidden = true;
  document.body.appendChild(tip);
  let tipEl = null;
  let tipShowTimer = null;
  let tipHideTimer = null;
  let tipX = 0;
  let tipY = 0;
  function hideTip() {
    clearTimeout(tipShowTimer); clearTimeout(tipHideTimer);
    tipEl = null;
    tip.hidden = true;
  }
  function placeTip() {
    const w = tip.offsetWidth;
    const h = tip.offsetHeight;
    let x = tipX + 12;
    let y = tipY + 18;
    if (x + w > window.innerWidth - 2) x = Math.max(2, window.innerWidth - w - 2);
    if (y + h > window.innerHeight - 2) y = Math.max(2, tipY - h - 6);
    tip.style.left = x + 'px';
    tip.style.top = y + 'px';
  }
  document.addEventListener('mouseover', (e) => {
    const t = e.target && e.target.closest ? e.target.closest('[title],[data-tip]') : null;
    if (t && t.hasAttribute('title')) { // 기본 이름표가 안 뜨게 옮겨 둠
      const v = t.getAttribute('title');
      t.removeAttribute('title');
      if (v) t.dataset.tip = v; else delete t.dataset.tip;
    }
    if (t === tipEl) return;
    hideTip();
    if (!t || !t.dataset.tip || fadedNow) return;
    tipEl = t;
    const delay = (data && Number(data.tipDelayMs) >= 0) ? Number(data.tipDelayMs) : 600;
    tipShowTimer = setTimeout(() => {
      if (tipEl !== t || !t.isConnected) return;
      tip.textContent = t.dataset.tip;
      tip.hidden = false;
      placeTip();
      const maxMs = data ? Number(data.tipMaxMs) : 5000;
      if (maxMs > 0) tipHideTimer = setTimeout(hideTip, maxMs);
    }, delay);
  }, true);
  document.addEventListener('mousemove', (e) => { tipX = e.clientX; tipY = e.clientY; }, true);
  document.addEventListener('mouseout', (e) => { if (!e.relatedTarget) hideTip(); }, true); // 창 밖으로 나감
  document.documentElement.addEventListener('mouseleave', hideTip);
  window.addEventListener('blur', hideTip);
  document.addEventListener('pointerdown', hideTip, true);
  document.addEventListener('wheel', hideTip, { capture: true, passive: true });
  document.addEventListener('scroll', hideTip, true);
  document.addEventListener('dragstart', hideTip, true);
  document.addEventListener('keydown', hideTip, true);

  B.onChanged(() => { hideTip(); refresh(); });
  if (B.onMergeHint) B.onMergeHint((v) => el.bar.classList.toggle('merge-target', v)); // (7차) 놓으면 여기로 묶임
  B.onExpanded((v) => { if (!v) hideTip(); setExpandedUi(v); });
  let fadedNow = false;
  let wakeAt = 0; // (2026-10-15) 가려져서 무시될 수 있으니 한 번만이 아니라 간격을 두고 다시 요청
  if (B.onFaded) B.onFaded((v) => { fadedNow = v; wakeAt = 0; el.box.classList.toggle('faded', v); if (v) { clearTimeout(hoverTimer); hideTip(); } }); // (9차)
  // (11차) 숨은 동안에도 마우스 움직임은 들어옴(src/box.js setFaded 의 forward) → 올라오자마자 다시 보이게 요청
  const wakeUp = () => {
    if (!fadedNow || !B.wake) return;
    const now = Date.now();
    if (now - wakeAt < ((data && data.wakeRetryMs) || 150)) return;
    wakeAt = now;
    B.wake();
  };
  document.addEventListener('mousemove', wakeUp, true);
  document.addEventListener('mouseover', wakeUp, true);
  B.onToast((t) => showToast(t));
  refresh();
})();
