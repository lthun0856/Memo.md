// (2026-10-13) 설정창 > 바탕화면 정리 > 자동 정리
// (5차) 확장자 규칙 화면은 뺌(태훈님 결정 — 복잡함). 남은 것: 기본 정리함 표시 / 제외목록 / 최근 기록·되돌리기.
// 기본 정리함은 정리함 카드의 "기본 정리함으로 사용" 스위치나 정리함 창 ⋯ 메뉴에서 정함.
// 바꾸면 바로 저장·적용(아래 저장 버튼과 무관). 실제 처리는 src/organizer.js
(function () {
  'use strict';
  const O = window.orgApi;
  const L = (typeof LANG !== 'undefined' && LANG.organizer) || {}; // LANG 은 const 라 window.LANG 으로는 안 보임
  const $ = (id) => document.getElementById(id);
  if (!O || !$('orgExclude')) return;

  function fmt(s, v) { return String(s || '').replace(/\{(\w+)\}/g, (_, k) => (v && v[k] != null ? v[k] : '')); }

  $('orgHeading').textContent = L.heading || '';
  $('orgDefaultLabel').textContent = L.defaultLabel || '';
  $('orgDefaultHint').textContent = L.defaultHint || '';
  $('orgExcludeHeading').textContent = L.excludeHeading || '';
  $('orgExcludeHint').textContent = L.excludeHint || '';
  $('orgLogHeading').textContent = L.logHeading || '';

  function render(c) {
    if (!c) return;
    const b = c.defaultBoxId ? (c.boxes || []).find((x) => x.id === c.defaultBoxId) : null;
    const nameEl = $('orgDefaultName');
    nameEl.textContent = b ? b.name : (L.defaultNone || '');
    nameEl.style.opacity = b ? '1' : '0.5';
    if (document.activeElement !== $('orgExclude')) $('orgExclude').value = (c.exclude || []).join('\n');
  }

  $('orgExclude').addEventListener('change', async () => {
    const list = $('orgExclude').value.split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
    render(await O.save({ exclude: list }));
  });

  // ---- 기록 / 되돌리기 ----
  function timeText(iso) {
    const d = new Date(iso);
    if (isNaN(d)) return '';
    const p = (x) => String(x).padStart(2, '0');
    return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }
  function baseName(p) { return String(p || '').split(/[\\/]/).pop(); }
  async function loadLog() {
    let log = [];
    try { log = await O.getLog(); } catch (e) { /* 빈 목록 */ }
    const wrap = $('orgLog');
    wrap.innerHTML = '';
    if (!log.length) {
      const p = document.createElement('p');
      p.className = 'hint';
      p.textContent = L.logEmpty || '';
      wrap.appendChild(p);
      return;
    }
    log.slice(0, 50).forEach((e) => {
      const item = document.createElement('div');
      item.className = 'org-log-item';
      item.title = `${e.from}\n→ ${e.to}`;
      const info = document.createElement('div');
      info.className = 'info';
      const n1 = document.createElement('div');
      n1.textContent = baseName(e.from);
      const n2 = document.createElement('div');
      n2.className = 'sub';
      n2.textContent = fmt(L.logSub, { time: timeText(e.at), box: e.boxName || '' });
      const n3 = document.createElement('div');
      n3.className = 'sub';
      n3.hidden = true;
      info.append(n1, n2, n3);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn-light';
      btn.textContent = L.undo || '';
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        const r = await O.undo([e.id]);
        if (r.errors && r.errors.length) {
          n3.textContent = fmt(L.undoFailed, { msg: r.errors[0] });
          n3.hidden = false;
          btn.disabled = false;
          return;
        }
        loadLog();
      });
      item.append(info, btn);
      wrap.appendChild(item);
    });
  }

  async function load() {
    try { render(await O.get()); } catch (e) { /* 못 읽으면 빈 화면 */ }
  }
  O.onLogChanged(() => loadLog());
  // 기본 정리함을 바꾸거나 정리함을 만들고 지우면 표시도 새로
  if (window.boxApi) window.boxApi.onListChanged(() => load());
  load();
  loadLog();
})();
