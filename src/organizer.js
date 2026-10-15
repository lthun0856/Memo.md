// ============================================================
// 자동 정리 (2단계, 2026-10-13)
// - "기본 정리함"을 정해 두면, 감시 폴더(기본: 바탕화면)에 새로 생긴 파일·폴더(복사·다운로드·새로 만든 것)를
//   전부 그 정리함으로 옮김(태훈님 결정 — 확장자 규칙은 복잡해서 화면에서 뺌. settings.json useRules=true 면 규칙 먼저)
// - 제외목록은 절대 안 건드림 / 삭제 없음(이동만) / 정리함 폴더 자체는 안 건드림
// - "새 폴더", "새 텍스트 문서.txt"처럼 이름을 아직 안 지은 것은 renameWaitSeconds 동안 기다렸다 옮김
// - 다운로드 중인 파일 보호: settleSeconds 동안 크기·수정시각이 안 바뀔 때만 옮김
// - "새 파일" 판단: 만든 시각이 newFileMinutes 안쪽인 파일만. 다른 폴더에서 옮겨 온 파일·정리함에서 꺼낸 파일은
//   만든 시각이 예전이라 안 건드림(정리함에서 꺼내자마자 다시 빨려 들어가는 일 방지)
// - 옮긴 기록은 data\boxMoves.json — 설정창에서 되돌리기
// 숫자 설정은 전부 settings.json 의 organizer 항목
// ============================================================
'use strict';
const { ipcMain, dialog, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const { randomUUID } = require('crypto');

// 기본 규칙(태훈님 요청: 문서/바로가기/이미지/압축파일). 확장자는 설정창에서 고칠 수 있음.
// 대상 정리함(boxId)은 처음엔 비어 있음 → 고르기 전까지 그 규칙은 아무것도 안 옮김
const DEFAULT_RULES = [
  { id: 'doc', name: '문서', exts: ['pdf', 'hwp', 'hwpx', 'doc', 'docx', 'xls', 'xlsx', 'xlsm', 'ppt', 'pptx', 'txt', 'csv', 'rtf', 'md'] },
  { id: 'shortcut', name: '바로가기', exts: ['lnk', 'url'] },
  { id: 'image', name: '이미지', exts: ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'svg', 'heic', 'tif', 'tiff'] },
  { id: 'archive', name: '압축파일', exts: ['zip', '7z', 'rar', 'alz', 'egg', 'tar', 'gz'] }
].map((r) => ({ ...r, boxId: null, enabled: true }));

// 다운로드·저장 중에 잠깐 생기는 임시 파일은 무조건 건너뜀
const TEMP_EXTS = new Set(['crdownload', 'part', 'partial', 'download', 'tmp', 'temp', 'opdownload']);
const SKIP_NAMES = new Set(['desktop.ini', 'thumbs.db']);

let ctx = null;   // { store, box(=src/box.js), getSettingsWindow }
const watchers = new Map(); // 폴더(소문자) -> fs.FSWatcher
const pending = new Map();  // 전체경로 -> { timer, firstSeen, size, mtime }

function num(v, def, min, max) {
  const n = Number(v);
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, n));
}

// ---------- 설정 ----------
function cleanExts(list) {
  const out = [];
  (Array.isArray(list) ? list : String(list || '').split(/[\s,;]+/)).forEach((x) => {
    const e = String(x || '').trim().toLowerCase().replace(/^\*?\./, '').replace(/[^0-9a-z가-힣_-]/g, '');
    if (e && !out.includes(e)) out.push(e);
  });
  return out.slice(0, 100);
}
function cleanRule(r) {
  return {
    id: typeof r.id === 'string' && r.id ? r.id.slice(0, 60) : randomUUID(),
    name: String(r.name || '').trim().slice(0, 40) || '규칙',
    exts: cleanExts(r.exts),
    boxId: typeof r.boxId === 'string' && r.boxId ? r.boxId : null,
    enabled: r.enabled !== false
  };
}
function cfg() {
  const d = ctx.store.DEFAULT_ORGANIZER || {};
  const raw = ctx.store.getSettings().organizer || {};
  const c = { ...d, ...raw };
  c.rules = Array.isArray(raw.rules) ? raw.rules.map(cleanRule) : DEFAULT_RULES.map((r) => ({ ...r, exts: r.exts.slice() }));
  c.exclude = Array.isArray(raw.exclude) ? raw.exclude.map((x) => String(x).trim()).filter(Boolean) : [];
  c.watchFolders = Array.isArray(raw.watchFolders) ? raw.watchFolders.filter((x) => typeof x === 'string' && x) : [];
  return c;
}
function saveCfg(patch) {
  const s = ctx.store.getSettings();
  const cur = cfg();
  const next = { ...cur, ...patch };
  next.rules = (next.rules || []).map(cleanRule);
  next.exclude = (next.exclude || []).map((x) => String(x).trim()).filter(Boolean).slice(0, 500);
  next.watchFolders = (next.watchFolders || []).filter((x) => typeof x === 'string' && x);
  next.enabled = !!next.enabled;
  next.defaultBoxId = typeof next.defaultBoxId === 'string' && next.defaultBoxId ? next.defaultBoxId : null;
  s.organizer = next;
  ctx.store.saveSettings(s);
  restartWatch();
  return publicCfg();
}
function watchList(c) {
  const list = c.watchFolders.length ? c.watchFolders : [ctx.box.desktopDir()];
  const seen = new Set();
  return list.filter((f) => { const k = path.resolve(f).toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
}
function publicCfg() {
  const c = cfg();
  return {
    enabled: !!c.enabled,
    rules: c.rules,
    exclude: c.exclude,
    watchFolders: watchList(c),
    usingDesktopDefault: !c.watchFolders.length,
    defaultBoxId: c.defaultBoxId && ctx.box.getBox(c.defaultBoxId) ? c.defaultBoxId : null,
    boxes: ctx.box.getBoxes().map((b) => ({ id: b.id, name: b.name }))
  };
}
function getDefaultBoxId() {
  const c = cfg();
  return c.enabled && c.defaultBoxId && ctx.box.getBox(c.defaultBoxId) ? c.defaultBoxId : null;
}
// 기본 정리함 정하기/풀기(id 가 null 이면 풂). 정하면 자동 정리가 켜지고, 풀면 꺼짐
function setDefaultBox(id) {
  const valid = id && ctx.box.getBox(id) ? id : null;
  const r = saveCfg({ defaultBoxId: valid, enabled: !!valid });
  ctx.box.getBoxes().forEach((b) => ctx.box.refreshBox(b.id)); // 정리함 창의 "기본" 표시 갱신
  const sw = ctx.getSettingsWindow && ctx.getSettingsWindow();
  if (sw && !sw.isDestroyed()) sw.webContents.send('box:listChanged');
  return r;
}

// ---------- 판단 ----------
function wildToRe(p) {
  const esc = p.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp(`^${esc}$`, 'i');
}
function isExcluded(name, c) {
  return c.exclude.some((p) => { try { return wildToRe(p).test(name); } catch (e) { return false; } });
}
function extOf(name) { return path.extname(name).slice(1).toLowerCase(); }
// 이 파일이 갈 정리함(없으면 null). 위 규칙부터 먼저 봄
function targetFor(name, c, isDirectory) {
  if (SKIP_NAMES.has(name.toLowerCase()) || name.startsWith('~$') || name.startsWith('.')) return null;
  const ext = extOf(name);
  if (!isDirectory && TEMP_EXTS.has(ext)) return null;
  if (isExcluded(name, c)) return null;
  if (c.useRules && !isDirectory && ext) {
    for (const r of c.rules) {
      if (!r.enabled || !r.boxId || !r.exts.includes(ext)) continue;
      const b = ctx.box.getBox(r.boxId);
      if (b && ctx.box.isDir(b.folder)) return { box: b, rule: r };
    }
  }
  if (c.defaultBoxId) {
    const b = ctx.box.getBox(c.defaultBoxId);
    if (b && ctx.box.isDir(b.folder)) return { box: b, rule: { name: '기본 정리함' } };
  }
  return null;
}
// "새 폴더", "새 텍스트 문서.txt", "New folder" 처럼 탐색기가 붙인 이름 그대로인지
function looksUnnamed(name) {
  return /^(새 |새로운 |new )/i.test(name);
}
// 바뀌고 있는지 보려고 쓰는 값: 파일은 크기+수정시각, 폴더는 안의 개수+총크기+가장 늦은 수정시각
function signature(full, st) {
  if (!st.isDirectory()) return `${st.size}|${st.mtimeMs}`;
  let n = 0; let bytes = 0; let latest = st.mtimeMs;
  const walk = (dir, depth) => {
    if (n > 20000 || depth > 30) return;
    let names = [];
    try { names = fs.readdirSync(dir); } catch (e) { return; }
    for (const name of names) {
      const p = path.join(dir, name);
      let s;
      try { s = fs.lstatSync(p); } catch (e) { continue; }
      n++;
      if (s.mtimeMs > latest) latest = s.mtimeMs;
      if (s.isDirectory()) walk(p, depth + 1);
      else bytes += s.size;
    }
  };
  walk(full, 0);
  return `${n}|${bytes}|${latest}`;
}
function isBoxFolderPath(full) {
  return ctx.box.getBoxes().some((b) => b.folder && ctx.box.samePath(b.folder, full));
}

// ---------- 기록(되돌리기) ----------
function addLog(entries) {
  if (!entries.length) return;
  const max = num(cfg().logMax, 300, 10, 5000);
  const log = ctx.store.getBoxMoves();
  log.unshift(...entries);
  ctx.store.saveBoxMoves(log.slice(0, max));
  const sw = ctx.getSettingsWindow && ctx.getSettingsWindow();
  if (sw && !sw.isDestroyed()) sw.webContents.send('organizer:logChanged');
}
function moveWithLog(full, t, how) {
  const r = ctx.box.moveInto(t.box.folder, [full]);
  if (r.moves.length) {
    addLog(r.moves.map((m) => ({
      id: randomUUID(), at: new Date().toISOString(), from: m.from, to: m.to,
      boxId: t.box.id, boxName: t.box.name, rule: t.rule.name, how
    })));
    ctx.box.refreshBox(t.box.id);
  }
  return r;
}

// ---------- 자동(새 파일 감시) ----------
function schedule(full) {
  const c = cfg();
  const settleMs = num(c.settleSeconds, 5, 1, 600) * 1000;
  const p = pending.get(full) || { firstSeen: Date.now(), sig: null, lastChange: Date.now() };
  clearTimeout(p.timer);
  p.timer = setTimeout(() => check(full), settleMs);
  pending.set(full, p);
}
function check(full) {
  const p = pending.get(full);
  if (!p) return;
  const c = cfg();
  const done = () => { clearTimeout(p.timer); pending.delete(full); };
  if (!c.enabled) return done();
  let st;
  try { st = fs.statSync(full); } catch (e) { return done(); } // 그새 사라짐(이름 바뀜 등 — 새 이름으로 다시 들어옴)
  const isDirectory = st.isDirectory();
  if (!isDirectory && !st.isFile()) return done();
  if (isDirectory && isBoxFolderPath(full)) return done(); // 정리함 폴더 자체는 절대 안 건드림
  const name = path.basename(full);
  const t = targetFor(name, c, isDirectory);
  if (!t) return done();
  // 새로 생긴 것인지: 만든 시각 기준. 다른 데서 옮겨 온 것·정리함에서 꺼낸 것은 만든 시각이 예전이라 여기서 걸러짐
  const born = st.birthtimeMs || st.ctimeMs;
  const newMs = num(c.newFileMinutes, 10, 1, 1440) * 60000;
  if (Date.now() - born > newMs) return done();
  if (ctx.box.wasTakenOut(name, num(c.takenOutIgnoreMinutes, 3, 0, 1440) * 60000)) return done();
  const settleMs = num(c.settleSeconds, 5, 1, 600) * 1000;
  // 다운로드·복사 중 보호: 마지막으로 바뀐 뒤 충분히 조용해야 옮김
  const sig = signature(full, st);
  if (sig !== p.sig) {
    p.sig = sig;
    p.lastChange = Date.now();
    if (Date.now() - p.firstSeen > num(c.maxWaitMinutes, 30, 1, 1440) * 60000) return done();
    p.timer = setTimeout(() => check(full), settleMs);
    return;
  }
  // 이름을 아직 안 지은 것("새 폴더" 등)은 더 오래 기다림
  const needMs = looksUnnamed(name) ? num(c.renameWaitSeconds, 60, 5, 3600) * 1000 : settleMs;
  const quietMs = Date.now() - p.lastChange;
  if (quietMs < needMs) {
    p.timer = setTimeout(() => check(full), Math.min(settleMs, needMs - quietMs + 50));
    return;
  }
  done();
  moveWithLog(full, t, 'auto'); // 실패(사용 중 등)하면 조용히 둠
}
function stopWatch() {
  watchers.forEach((w) => { try { w.close(); } catch (e) { /* 무시 */ } });
  watchers.clear();
  pending.forEach((p) => clearTimeout(p.timer));
  pending.clear();
}
function restartWatch() {
  stopWatch();
  const c = cfg();
  if (!c.enabled) return;
  watchList(c).forEach((folder) => {
    if (!ctx.box.isDir(folder)) return;
    try {
      const w = fs.watch(folder, { persistent: false }, (type, fname) => {
        if (!fname) return;
        const full = path.join(folder, String(fname));
        if (isBoxFolderPath(full)) return;
        schedule(full);
      });
      w.on('error', () => { /* 폴더가 사라지면 그냥 멈춤 */ });
      watchers.set(path.resolve(folder).toLowerCase(), w);
    } catch (e) { /* 감시 실패해도 앱은 동작 */ }
  });
}

// ---------- 지금 정리(이미 있는 파일까지) ----------
function scanNow() {
  const c = cfg();
  const list = [];
  watchList(c).forEach((folder) => {
    let names = [];
    try { names = fs.readdirSync(folder); } catch (e) { return; }
    names.forEach((name) => {
      const full = path.join(folder, name);
      let st;
      try { st = fs.statSync(full); } catch (e) { return; }
      const isDirectory = st.isDirectory();
      if (!isDirectory && !st.isFile()) return;
      if (isDirectory && isBoxFolderPath(full)) return;
      const t = targetFor(name, c, isDirectory);
      if (t) list.push({ full, name, t });
    });
  });
  return list;
}
function runNow() {
  const list = scanNow();
  const res = { moved: 0, errors: [] };
  list.forEach(({ full, t }) => {
    const r = moveWithLog(full, t, 'manual');
    res.moved += r.moved;
    res.errors.push(...r.errors);
  });
  return res;
}

// ---------- 되돌리기 ----------
function undo(ids) {
  const log = ctx.store.getBoxMoves();
  const want = new Set(Array.isArray(ids) ? ids : [ids]);
  const res = { restored: 0, errors: [] };
  const keep = [];
  log.forEach((e) => {
    if (!want.has(e.id)) { keep.push(e); return; }
    try {
      if (!fs.existsSync(e.to)) throw Object.assign(new Error('정리함에 그 파일이 없어요(이미 옮겼거나 지움)'), { code: 'GONE' });
      const dir = path.dirname(e.from);
      fs.mkdirSync(dir, { recursive: true });
      ctx.box.moveOne(e.to, ctx.box.uniquePath(dir, path.basename(e.from), ctx.box.isDir(e.to)));
      res.restored++;
      if (e.boxId) ctx.box.refreshBox(e.boxId);
    } catch (err) {
      if (err.code === 'GONE') { res.errors.push(`${path.basename(e.from)}: ${err.message}`); return; } // 기록만 지움
      res.errors.push(`${path.basename(e.from)}: ${ctx.box.errText(err)}`);
      keep.push(e); // 실패하면 기록은 남겨 둠
    }
  });
  ctx.store.saveBoxMoves(keep);
  return res;
}

// ---------- IPC ----------
function registerIpc() {
  ipcMain.handle('organizer:get', () => publicCfg());
  ipcMain.handle('organizer:setDefaultBox', (e, id) => setDefaultBox(id));
  ipcMain.handle('organizer:save', (e, patch) => saveCfg(patch && typeof patch === 'object' ? patch : {}));
  ipcMain.handle('organizer:resetRules', () => saveCfg({ rules: DEFAULT_RULES.map((r) => ({ ...r, exts: r.exts.slice() })) }));
  ipcMain.handle('organizer:addFolder', async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    const r = await dialog.showOpenDialog(win || undefined, { properties: ['openDirectory'] });
    if (r.canceled || !r.filePaths || !r.filePaths[0]) return publicCfg();
    const f = r.filePaths[0];
    if (isBoxFolderPath(f)) return { ...publicCfg(), error: '정리함 폴더는 감시 폴더로 쓸 수 없어요' };
    const c = cfg();
    const list = c.watchFolders.length ? c.watchFolders.slice() : [ctx.box.desktopDir()];
    if (!list.some((x) => ctx.box.samePath(x, f))) list.push(f);
    return saveCfg({ watchFolders: list });
  });
  ipcMain.handle('organizer:removeFolder', (e, folder) => {
    const c = cfg();
    const list = (c.watchFolders.length ? c.watchFolders : [ctx.box.desktopDir()]).filter((x) => !ctx.box.samePath(x, folder));
    return saveCfg({ watchFolders: list.length ? list : [] }); // 다 빼면 다시 바탕화면(기본)
  });
  ipcMain.handle('organizer:preview', () => scanNow().length);
  ipcMain.handle('organizer:runNow', () => runNow());
  ipcMain.handle('organizer:getLog', () => ctx.store.getBoxMoves());
  ipcMain.handle('organizer:undo', (e, ids) => undo(ids));
}

function init(c) {
  ctx = c;
  registerIpc();
  // 정리함 창 메뉴·정리함 삭제 때 쓰도록 연결
  ctx.box.setHooks({ getDefaultBoxId, setDefaultBox });
}
module.exports = { init, start: restartWatch, DEFAULT_RULES };
