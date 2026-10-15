// (2026-10-13) 설정창 > 바탕화면 정리 — 박스 추가·삭제·폴더 연결·모양 선택.
// 여기서 바꾸는 건 바로 적용됨(아래 저장 버튼과 무관). 실제 처리는 src/box.js.
// settings.js 의 전역 이름(settings, els 등)과 안 부딪히게 파일 전체를 감쌈. 확인창은 settings.js 의 openConfirmModal 사용
(function () {
  'use strict';
  const B = window.boxApi;
  const L = (typeof LANG !== 'undefined' && LANG.boxSettings) || {}; // LANG 은 const 라 window.LANG 으로는 안 보임
  const $ = (id) => document.getElementById(id);
  if (!B || !$('boxList')) return;

  function fmt(s, v) { return String(s || '').replace(/\{(\w+)\}/g, (_, k) => (v && v[k] != null ? v[k] : '')); }
  function confirmBox(title, hint, onOk, label) {
    if (typeof openConfirmModal === 'function') openConfirmModal(title, hint, onOk, label);
  }

  // 문구
  $('tabBtnBox').textContent = (LANG.settings.tabs && LANG.settings.tabs.box) || '';
  $('boxPanelHint').textContent = L.panelHint || '';
  $('boxNewHeading').textContent = L.newHeading || '';
  $('boxNewLabel').textContent = L.newLabel || '';
  $('boxNewName').placeholder = L.newPlaceholder || '';
  $('btnBoxCreate').textContent = L.createButton || '';
  $('boxLinkLabel').textContent = L.linkLabel || '';
  $('boxLinkHint').textContent = L.linkHint || '';
  $('btnBoxLink').textContent = L.linkButton || '';
  $('boxListHeading').textContent = L.listHeading || '';
  $('boxKnownLabel').textContent = L.knownLabel || '';
  $('boxKnownHint').textContent = L.knownHint || '';

  const errEl = $('boxNewError');
  function showError(msg) {
    errEl.textContent = msg || '';
    errEl.hidden = !msg;
  }

  let iconMin = 16;
  let iconMax = 128;
  async function loadHint() {
    try {
      const o = await B.getOptions();
      if (o.iconMin) iconMin = o.iconMin;
      if (o.iconMax) iconMax = o.iconMax;
      $('boxNewHint').textContent = fmt(L.newHint, { root: o.root, hidden: o.hideFolder ? (L.hiddenWord || '') : '' });
    } catch (e) { /* 안내 문구만 안 나옴 */ }
  }

  function button(text, onClick, cls) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = cls || 'btn-light';
    b.textContent = text;
    b.addEventListener('click', onClick);
    return b;
  }

  function renderList(list) {
    const wrap = $('boxList');
    wrap.innerHTML = '';
    if (!list.length) {
      const p = document.createElement('p');
      p.className = 'hint';
      p.textContent = L.emptyList || '';
      wrap.appendChild(p);
      return;
    }
    list.forEach((b) => {
      const card = document.createElement('div');
      card.className = 'card box-card';

      // 1줄: 이름 / 색 / 모양
      const r1 = document.createElement('div');
      r1.className = 'row box-top';
      // (7차) 정리함 / 폴더 창 구분
      const kind = document.createElement('span');
      kind.className = 'box-kind' + (b.kind === 'folder' ? ' folder' : '');
      kind.textContent = b.kind === 'folder' ? (L.kindFolder || '') : (L.kindBox || '');
      const name = document.createElement('input');
      name.type = 'text';
      name.className = 'box-name';
      name.maxLength = 60;
      name.value = b.name;
      name.addEventListener('change', async () => {
        const v = name.value.trim();
        if (!v) { name.value = b.name; return; }
        await B.update(b.id, { name: v });
      });
      name.addEventListener('keydown', (e) => { if (e.key === 'Enter') name.blur(); });
      const ctrl1 = document.createElement('span');
      ctrl1.className = 'ctrl';
      const mode = document.createElement('select');
      [['desktop', L.modeDesktop], ['widget', L.modeWidget]].forEach(([v, t]) => {
        const o = document.createElement('option');
        o.value = v;
        o.textContent = t || v;
        mode.appendChild(o);
      });
      mode.value = b.mode;
      mode.addEventListener('change', () => B.update(b.id, { mode: mode.value }));
      if (b.groupId) mode.title = L.modeGroupTitle || '';
      // (6차) 정렬
      const sort = document.createElement('select');
      sort.title = L.sortTitle || '';
      [['name', L.sortName], ['date', L.sortDate], ['custom', L.sortCustom]].forEach(([v, t]) => {
        const o = document.createElement('option');
        o.value = v;
        o.textContent = t || v;
        sort.appendChild(o);
      });
      sort.value = b.sort === 'date' || b.sort === 'custom' ? b.sort : 'name';
      sort.addEventListener('change', () => B.update(b.id, { sort: sort.value }));
      ctrl1.append(sort, mode);
      r1.append(kind, name, ctrl1);

      // 2줄: 폴더 경로 / 버튼들
      const r2 = document.createElement('div');
      r2.className = 'row';
      const lab = document.createElement('span');
      lab.className = 'lab';
      const folder = document.createElement('small');
      folder.className = 'hint box-folder';
      folder.textContent = b.folder;
      lab.appendChild(folder);
      if (!b.exists) {
        const miss = document.createElement('small');
        miss.className = 'hint box-missing';
        miss.textContent = L.missingFolder || '';
        lab.appendChild(miss);
      }
      const ctrl2 = document.createElement('span');
      ctrl2.className = 'ctrl';
      ctrl2.append(
        button(L.showButton, () => B.openWindow(b.id)),
        button(L.openFolderButton, () => B.openFolder(b.id)),
        button(L.changeFolderButton, async () => {
          const r = await B.changeFolder(b.id);
          if (r && r.error) showError(r.error);
        }),
        button(L.removeButton, () => {
          const isFolder = b.kind === 'folder';
          confirmBox(
            fmt(isFolder ? L.removeTitleFolder : L.removeTitle, { name: b.name }),
            b.createdByApp ? L.removeHintApp : L.removeHintLinked,
            async () => { await B.remove(b.id); },
            isFolder ? L.removeConfirmFolder : L.removeConfirm
          );
        }, 'btn-light btn-danger-text')
      );
      r2.append(lab, ctrl2);

      // 4줄: 아이콘 크기 (3차)
      const r4 = document.createElement('div');
      r4.className = 'row';
      const lab4 = document.createElement('span');
      lab4.className = 'lab';
      const b4 = document.createElement('b');
      b4.textContent = L.iconLabel || '';
      const h4 = document.createElement('small');
      h4.className = 'hint';
      h4.textContent = L.iconHint || '';
      lab4.append(b4, h4);
      const ctrl4 = document.createElement('span');
      ctrl4.className = 'ctrl range';
      const ir = document.createElement('input');
      ir.type = 'range';
      ir.min = String(iconMin);
      ir.max = String(iconMax);
      ir.step = '4';
      ir.value = String(b.iconSize);
      const iv = document.createElement('span');
      iv.className = 'range-val';
      iv.textContent = b.iconSize + 'px';
      let it = null;
      ir.addEventListener('input', () => {
        iv.textContent = ir.value + 'px';
        clearTimeout(it);
        it = setTimeout(() => B.update(b.id, { iconSize: Number(ir.value) }), 200);
      });
      ctrl4.append(ir, iv);
      r4.append(lab4, ctrl4);

      // 5줄: 기본 정리함으로 사용 (5차)
      const r5 = document.createElement('label');
      r5.className = 'row';
      const lab5 = document.createElement('span');
      lab5.className = 'lab';
      const b5 = document.createElement('b');
      b5.textContent = L.defaultLabel || '';
      const h5 = document.createElement('small');
      h5.className = 'hint';
      h5.textContent = L.defaultHint || '';
      lab5.append(b5, h5);
      const sw5 = document.createElement('input');
      sw5.type = 'checkbox';
      sw5.className = 'sw';
      sw5.checked = !!b.isDefault;
      sw5.addEventListener('change', () => B.setDefault(b.id, sw5.checked));
      r5.append(lab5, sw5);

      // 6줄: 묶음 (6차)
      const r6 = document.createElement('div');
      r6.className = 'row';
      const lab6 = document.createElement('span');
      lab6.className = 'lab';
      const b6 = document.createElement('b');
      b6.textContent = L.groupLabel || '';
      const h6 = document.createElement('small');
      h6.className = 'hint';
      h6.textContent = L.groupHint || '';
      lab6.append(b6, h6);
      const ctrl6 = document.createElement('span');
      ctrl6.className = 'ctrl';
      const gsel = document.createElement('select');
      const addOpt = (v, t) => { const o = document.createElement('option'); o.value = v; o.textContent = t; gsel.appendChild(o); };
      addOpt('', L.groupNone || '');
      (b.groups || []).forEach((g) => addOpt(g.id, g.label));
      addOpt('new', L.groupNew || '');
      gsel.value = b.groupId && (b.groups || []).some((g) => g.id === b.groupId) ? b.groupId : '';
      gsel.addEventListener('change', () => B.setGroup(b.id, gsel.value || null));
      ctrl6.appendChild(gsel);
      r6.append(lab6, ctrl6);

      card.append(r1, r2, r6, r4, r5); // (11차) 폴더 창 "전부 보기" 줄 삭제
      wrap.appendChild(card);
    });
  }

  // (7차) 자주 쓰는 폴더 버튼(내 문서·다운로드·카카오톡 받은 파일·사진). 이미 가져온 건 ✓ 표시하고 못 누름
  async function renderKnown() {
    const wrap = $('boxKnownBtns');
    if (!wrap || !B.getKnown) return;
    let list = [];
    try { list = await B.getKnown(); } catch (e) { list = []; }
    wrap.innerHTML = '';
    list.forEach((k) => {
      const btn = button(k.linked ? fmt(L.knownLinked, { label: k.label }) : k.label, async () => {
        showError('');
        const r = await B.linkKnown(k.key);
        if (r && r.error) showError(r.error);
      });
      btn.title = k.linked ? (L.knownLinkedTitle || '') : k.folder;
      btn.disabled = !!k.linked;
      wrap.appendChild(btn);
    });
  }
  async function load() {
    try { renderList(await B.getAll()); } catch (e) { /* 목록을 못 읽으면 빈 화면 */ }
    renderKnown();
  }

  async function create() {
    showError('');
    const input = $('boxNewName');
    const v = input.value.trim();
    if (!v) { input.focus(); return; }
    const r = await B.create(v);
    if (r && r.ok) { input.value = ''; return; }
    // (7차) 같은 이름의 폴더가 이미 있으면(내 문서·다운로드 등) 폴더 창으로 가져올지 물어봄
    if (r && r.suggest) {
      confirmBox(
        fmt(L.suggestTitle, { name: r.suggest.name }),
        fmt(L.suggestHint, { folder: r.suggest.folder }),
        async () => {
          const r2 = await B.create(v, 'link');
          if (r2 && r2.ok) input.value = '';
          else showError((r2 && r2.error) || '');
        },
        L.suggestConfirm
      );
      return;
    }
    showError((r && r.error) || '');
  }
  $('btnBoxCreate').addEventListener('click', create);
  $('boxNewName').addEventListener('keydown', (e) => { if (e.key === 'Enter') create(); });
  $('boxNewName').addEventListener('input', () => showError(''));
  $('btnBoxLink').addEventListener('click', async () => {
    showError('');
    const r = await B.link();
    if (r && r.error) showError(r.error);
  });

  // ---- (4차) 공통 스타일: 모든 정리함이 같이 씀 ----
  $('boxStyleHeading').textContent = L.styleHeading || '';
  $('boxStyleBarLabel').textContent = L.styleBar || '';
  $('boxStyleBgLabel').textContent = L.styleBg || '';
  $('boxStyleTrLabel').textContent = L.styleTr || '';
  $('boxStyleTrHint').textContent = L.styleTrHint || '';
  const barIn = $('boxStyleBar');
  const bgIn = $('boxStyleBg');
  const trIn = $('boxStyleTr');
  const trVal = $('boxStyleTrVal');
  async function loadStyle() {
    try {
      const st = await B.getStyle();
      barIn.value = st.color;
      bgIn.value = st.bgColor;
      trIn.value = String(st.bgTransparency);
      trVal.textContent = st.bgTransparency + '%';
    } catch (e) { /* 못 읽으면 기본값 */ }
  }
  barIn.addEventListener('input', () => B.setStyle({ color: barIn.value }));
  bgIn.addEventListener('input', () => B.setStyle({ bgColor: bgIn.value }));
  let trTimer = null;
  trIn.addEventListener('input', () => {
    trVal.textContent = trIn.value + '%';
    clearTimeout(trTimer);
    trTimer = setTimeout(() => B.setStyle({ bgTransparency: Number(trIn.value) }), 120);
  });
  loadStyle();

  // (10차→13차) ⋯ 메뉴로 연 설정창은 바깥을 누르면 닫힘. 바탕화면 정리 메뉴는 바꾸는 즉시 저장되니 안을 눌렀어도 닫힘.
  // 다른 메뉴(저장 버튼을 눌러야 저장되는 곳)로 넘어가면 그때부터 안 닫힘(고치던 내용이 날아가지 않게) — 태훈님 결정
  if (B.settingsTouched) {
    const touched = (e) => {
      const btn = e.target && e.target.closest ? e.target.closest('.tab-btn') : null;
      if (!btn || btn.dataset.tab === 'box') return; // 바탕화면 정리 안에서 누른 건 상관없음
      B.settingsTouched();
      document.removeEventListener('pointerdown', touched, true);
    };
    document.addEventListener('pointerdown', touched, true);
  }
  B.onListChanged(() => load());
  // 박스 창 메뉴의 "박스 설정…"으로 열렸을 때 이 메뉴를 바로 보여줌
  B.onShowTab(() => { if (typeof switchTab === 'function') switchTab('box'); });

  loadHint().then(load); // 아이콘 크기 범위를 먼저 받아 와서 슬라이더에 씀
})();
