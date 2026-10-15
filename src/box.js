// ============================================================
// 바탕화면 정리 박스 (1단계, 2026-10-13)
// - 박스 = 진짜 폴더. 박스에 끌어넣으면 그 폴더로 "이동"(삭제 없음), 앱을 지워도 파일은 폴더에 남음
// - 새 박스 폴더는 기본으로 바탕화면에 "숨김 폴더"로 만듦(태훈님 결정 2026-10-13)
// - 박스마다 "바탕화면에 깔림(desktop)" / "위젯에서 열기(widget)" 선택
// - 접어둔 박스는 제목줄에 마우스를 올리면 펼쳐지고, 벗어나면 다시 접힘
// - (6차) 정리함을 "묶음"에 넣으면 포토샵 패널처럼 창 하나에 탭으로 겹쳐 보임. 창(패널) 단위:
//     따로 띄운 정리함 = 'b:<정리함id>', 묶음 = 'g:<묶음id>'. 위치·크기·접힘·깔림/위젯은 패널 단위로 기억
// - (6차) 정리함마다 정렬: 날짜순(최신이 위, 오늘/어제/이번 주… 로 묶어 보여줌) / 이름순
// - (7차) "정리함" = 앱이 새로 만든 폴더(createdByApp), "폴더 창" = 이미 있는 폴더(내 문서·다운로드 등)를 그대로 보여주는 창.
//   폴더 창은 기본으로 최근(지난주까지) 바뀐 것만 보여줌. 정렬 기본은 이름순, 날짜순은 고른 곳만.
//   제목줄을 다른 창 제목줄 위로 끌어 놓으면 탭으로 묶이고, 탭을 창 밖으로 끌어내면 떨어짐(포토샵식)
// - 바뀔 수 있는 숫자(대기 시간, 아이콘 크기 등)는 전부 settings.json 의 box 항목에서 고침
// 설계·결정 배경: 인계서\인계서_바탕화면정리_설계_20261013.md
// ============================================================
'use strict';
const { app, BrowserWindow, Menu, ipcMain, shell, dialog, screen, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const { randomUUID } = require('crypto');
const { execFile } = require('child_process');
const peIcon = require('./peIcon'); // (10차) 실행파일 안 아이콘 그림 직접 꺼내기
const bootlog = require('./bootlog'); // (2026-10-13) 시작 속도 측정
const perflog = require('./perflog'); // (2026-10-14) 버벅임 측정
const shellIcon = require('./shellIcon'); // (13차-3) 탐색기와 같은 방식으로 아이콘 받는 도우미
const winCover = require('./winCover'); // (2026-10-15) 다른 창에 가려졌으면 마우스 올림 무시
const lnkRead = require('./lnkRead'); // (11차) 바로가기 파일 직접 읽기(readShortcutLink 가 실패하는 바로가기용)

let ctx = null;              // main.js 가 넘겨주는 것들(store, 경로, 설정창 열기 등)
let hooks = {};              // (5차) 자동 정리(src/organizer.js)가 연결: { getDefaultBoxId, setDefaultBox }
const wins = new Map();      // 패널키('b:id' | 'g:id') -> BrowserWindow
const states = new Map();    // webContents.id -> 창 상태 { key, activeId, popup, expanded, shift, drag, poll, ... }
const watchers = new Map();  // boxId -> { watcher, timer } (폴더가 바뀌면 박스 화면 새로고침)
const iconCache = new Map(); // 전체경로 -> { key, dataUrl, image }
const takenOut = new Map();  // (4차) 정리함에서 끌어낸 파일 이름(소문자) -> 시각. 자동 정리가 바로 다시 집어넣지 않게

const IS_WIN = process.platform === 'win32';
const SKIP_NAMES = new Set(['desktop.ini', 'thumbs.db']);

// ---------- 설정 읽기/쓰기 ----------
function defaults() { return (ctx && ctx.store.DEFAULT_BOX) || {}; }
function opts() {
  const s = ctx.store.getSettings();
  return { ...defaults(), ...(s.box || {}) };
}
function num(v, def, min, max) {
  const n = Number(v);
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, n));
}
function getBoxes() {
  const s = ctx.store.getSettings();
  return Array.isArray(s.boxes) ? s.boxes.slice() : [];
}
function saveBoxes(boxes) {
  const s = ctx.store.getSettings();
  s.boxes = boxes;
  // settings.json 에 box 항목(고칠 수 있는 숫자들)이 빠짐없이 적혀 있게 기본값과 합쳐 저장
  s.box = { ...defaults(), ...(s.box || {}) };
  ctx.store.saveSettings(s);
}
function getBox(id) { return getBoxes().find((b) => b.id === id) || null; }
function patchBox(id, patch) {
  const boxes = getBoxes();
  const i = boxes.findIndex((b) => b.id === id);
  if (i < 0) return null;
  boxes[i] = { ...boxes[i], ...patch };
  saveBoxes(boxes);
  return boxes[i];
}
// (7차) 기본은 이름순. 날짜순은 설정에서 고른 정리함·폴더 창만(태훈님 결정 2026-10-13). 예전 defaultSort('date')는 안 씀
function boxSort(b) {
  const s = b && b.sort ? b.sort : opts().sortDefault;
  return s === 'date' || s === 'custom' ? s : 'name'; // (10차) 'custom' = 직접 정렬
}
// (10차) 직접 정렬 순서: 저장된 순서(b.order, 파일 이름)대로, 순서에 없는 것(새로 들어온 것)은 뒤에 들어온 순서로
function customOrder(b, entries) {
  const pos = new Map();
  (Array.isArray(b && b.order) ? b.order : []).forEach((n, i) => { const k = String(n).toLowerCase(); if (!pos.has(k)) pos.set(k, i); });
  const key = (e) => e.name.toLowerCase();
  const known = entries.filter((e) => pos.has(key(e))).sort((a, c) => pos.get(key(a)) - pos.get(key(c)));
  const rest = entries.filter((e) => !pos.has(key(e)))
    .sort((a, c) => (a.mtime - c.mtime) || a.name.localeCompare(c.name, 'ko', { numeric: true }));
  return known.concat(rest);
}
function folderEntries(folder) {
  let names = [];
  try { names = fs.readdirSync(folder); } catch (e) { return []; }
  const out = [];
  names.forEach((name) => {
    if (SKIP_NAMES.has(name.toLowerCase()) || name.startsWith('~$')) return;
    try { const s = fs.statSync(path.join(folder, name)); out.push({ name, mtime: s.mtimeMs, isDir: s.isDirectory() }); } catch (e) { /* 무시 */ }
  });
  return out;
}
// 이름순 그대로의 순서(직접 정렬을 처음 켤 때 여기서 시작)
function nameOrder(folder) {
  const label = (e) => { const x = path.extname(e.name).toLowerCase(); return !e.isDir && (x === '.lnk' || x === '.url') ? e.name.slice(0, -x.length) : e.name; };
  return folderEntries(folder)
    .sort((a, c) => (a.isDir !== c.isDir ? (a.isDir ? -1 : 1) : label(a).localeCompare(label(c), 'ko', { numeric: true, sensitivity: 'base' })))
    .map((e) => e.name);
}
// names 를 anchorName 앞(after 면 뒤)에 끼워 넣고 저장. anchor 가 없으면 맨 뒤. 폴더에 없는 이름은 순서에서 정리
function placeInOrder(id, names, anchorName, after) {
  const b = getBox(id);
  if (!b || !names.length) return;
  const moving = new Set(names.map((n) => n.toLowerCase()));
  if (anchorName && moving.has(anchorName.toLowerCase())) return; // 자기 자신 위에 놓음 → 그대로
  const order = customOrder(b, folderEntries(b.folder)).map((e) => e.name).filter((n) => !moving.has(n.toLowerCase()));
  let at = order.length;
  if (anchorName && !moving.has(anchorName.toLowerCase())) {
    const i = order.findIndex((n) => n.toLowerCase() === anchorName.toLowerCase());
    if (i >= 0) at = after ? i + 1 : i;
  }
  order.splice(at, 0, ...names);
  patchBox(id, { order });
}
// (7차) 'box' = 정리함(앱이 만든 폴더), 'folder' = 폴더 창(이미 있던 폴더를 가져옴)
function boxKind(b) { return b && b.createdByApp ? 'box' : 'folder'; }
function kindMark(b) { return boxKind(b) === 'folder' ? '🔗 ' : ''; }
function publicBox(b) {
  return {
    sort: boxSort(b), groupId: b.groupId || null,
    kind: boxKind(b),
    id: b.id, name: b.name, folder: b.folder, mode: b.mode === 'widget' ? 'widget' : 'desktop',
    collapsed: !!b.collapsed, createdByApp: !!b.createdByApp,
    isDefault: !!(hooks.getDefaultBoxId && hooks.getDefaultBoxId() === b.id), // 기본 정리함(새로 생긴 건 여기로)
    // (4차) 제목줄 색·배경색·배경 투명도는 모든 정리함 공통(settings.json box.barColor/bgColor/bgTransparency)
    ...commonStyle(),
    iconSize: boxIconSize(b)
  };
}

function hexOr(v, def) { return /^#[0-9a-f]{6}$/i.test(v || '') ? v : def; }
function commonStyle() {
  const o = opts();
  return {
    color: hexOr(o.barColor, hexOr(o.defaultColor, '#2B2820')),
    bgColor: hexOr(o.bgColor, '#F7F4EC'),
    bgTransparency: Math.round(num(o.bgTransparency, 40, 0, 100))
  };
}
function setCommonStyle(patch) {
  if (!patch) return commonStyle();
  const s = ctx.store.getSettings();
  const b = { ...defaults(), ...(s.box || {}) };
  if (patch.color && hexOr(patch.color, '')) b.barColor = patch.color;
  if (patch.bgColor && hexOr(patch.bgColor, '')) b.bgColor = patch.bgColor;
  if (patch.bgTransparency != null && Number.isFinite(Number(patch.bgTransparency))) b.bgTransparency = Math.round(num(patch.bgTransparency, 40, 0, 100));
  s.box = b;
  ctx.store.saveSettings(s);
  wins.forEach((w) => { if (!w.isDestroyed()) w.webContents.send('box:changed'); }); // 열린 정리함 전부 새로 칠함
  return commonStyle();
}

// ---------- 경로 도우미 ----------
function norm(p) { const r = path.resolve(p); return IS_WIN ? r.toLowerCase() : r; }
function samePath(a, b) { return norm(a) === norm(b); }
function isInside(child, parent) {
  const rel = path.relative(norm(parent), norm(child));
  return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel);
}
function isDir(p) { try { return fs.statSync(p).isDirectory(); } catch (e) { return false; } }
function desktopDir() { return app.getPath('desktop'); }

// 윈도우 폴더 이름에 못 쓰는 글자를 바꿈
function cleanName(name) {
  let n = String(name || '').replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').trim().replace(/[. ]+$/, '');
  if (!n) n = '정리함';
  if (/^(con|prn|aux|nul|com\d|lpt\d)$/i.test(n)) n += '_';
  return n.slice(0, 80);
}
// 같은 이름이 있으면 "이름 (2)" 식으로 비는 이름을 찾음(덮어쓰기 절대 안 함)
function uniquePath(dir, baseName, isDirectory) {
  let target = path.join(dir, baseName);
  if (!fs.existsSync(target)) return target;
  const ext = isDirectory ? '' : path.extname(baseName);
  const stem = ext ? baseName.slice(0, -ext.length) : baseName;
  for (let i = 2; i < 10000; i++) {
    target = path.join(dir, `${stem} (${i})${ext}`);
    if (!fs.existsSync(target)) return target;
  }
  throw new Error('빈 이름을 찾지 못함');
}
function setHidden(folder, hidden) {
  if (!IS_WIN) return;
  try { execFile('attrib', [hidden ? '+h' : '-h', folder], { windowsHide: true }, () => {}); } catch (e) { /* 실패해도 박스는 동작 */ }
}
// 박스를 지우거나 폴더를 바꿀 때 옛 폴더 정리: 앱이 만든 폴더만 대상.
// 비어 있으면 빈 폴더만 지우고, 파일이 있으면 그대로 두고 숨김만 풂(파일은 절대 안 지움)
function releaseFolder(b) {
  if (!b || !b.createdByApp || !b.folder) return 'kept';
  try { fs.rmdirSync(b.folder); return 'removed'; } catch (e) { /* 안 비어 있음 → 그대로 둠 */ }
  if (b.hidden) setHidden(b.folder, false);
  return 'kept';
}
function checkFolderChoice(folder, exceptId) {
  if (!folder || !isDir(folder)) return '폴더를 찾을 수 없어요';
  if (samePath(folder, desktopDir())) return '바탕화면 자체는 정리함으로 쓸 수 없어요';
  if (samePath(folder, path.parse(path.resolve(folder)).root)) return '드라이브 전체는 정리함으로 쓸 수 없어요';
  // (7차) 바탕화면을 품은 폴더(사용자 폴더 등)는 안 됨 — 창에서 "Desktop" 폴더째 끌어낼 위험
  if (isInside(desktopDir(), folder)) return '바탕화면을 품고 있는 폴더는 쓸 수 없어요';
  if (getBoxes().some((b) => b.id !== exceptId && b.folder && samePath(b.folder, folder))) return '이미 다른 정리함이 쓰는 폴더예요';
  return '';
}

// ---------- 파일 옮기기 ----------
function errText(e) {
  const map = {
    EBUSY: '다른 프로그램이 쓰는 중이에요', EPERM: '권한이 없거나 사용 중이에요', EACCES: '권한이 없어요',
    ENOENT: '파일이 없어요', ENOSPC: '디스크 공간이 부족해요', EEXIST: '같은 이름이 있어요'
  };
  return map[e && e.code] || (e && e.message) || '알 수 없는 오류';
}
function statsOf(p) {
  const st = fs.lstatSync(p);
  if (!st.isDirectory()) return { files: 1, bytes: st.isFile() ? st.size : 0 };
  let files = 0; let bytes = 0;
  for (const name of fs.readdirSync(p)) {
    const s = statsOf(path.join(p, name));
    files += s.files; bytes += s.bytes;
  }
  return { files, bytes };
}
function moveOne(src, target) {
  try { fs.renameSync(src, target); return; } catch (e) { if (e.code !== 'EXDEV') throw e; }
  // 드라이브가 다르면 바로 옮길 수 없음 → 복사 후, 복사본이 원본과 같은지(개수·크기) 확인하고 나서만 원본 정리.
  // 확인이 안 되면 원본은 그대로 둠
  const before = statsOf(src);
  fs.cpSync(src, target, { recursive: true, errorOnExist: true, force: false, preserveTimestamps: true });
  const after = statsOf(target);
  if (after.files !== before.files || after.bytes !== before.bytes) throw new Error('복사 확인 실패(원본은 그대로 둠)');
  fs.rmSync(src, { recursive: true, force: false });
}
function moveInto(dest, paths) {
  const res = { moved: 0, skipped: 0, errors: [], moves: [] }; // moves = [{ from, to }] (자동 정리 기록용)
  if (!isDir(dest)) { res.errors.push('정리함 폴더를 찾을 수 없어요'); return res; }
  const boxFolders = getBoxes().map((b) => b.folder).filter(Boolean);
  for (const raw of (Array.isArray(paths) ? paths : [])) {
    if (typeof raw !== 'string' || !raw) continue;
    const src = path.resolve(raw);
    const name = path.basename(src);
    if (!fs.existsSync(src)) { res.skipped++; continue; }
    if (samePath(path.dirname(src), dest)) { res.skipped++; continue; } // 이미 이 폴더에 있음
    if (samePath(src, dest) || isInside(dest, src)) { res.errors.push(`${name}: 박스 폴더를 자기 안에 넣을 수 없어요`); continue; }
    if (boxFolders.some((f) => samePath(f, src))) { res.errors.push(`${name}: 다른 박스의 폴더라 넣을 수 없어요`); continue; }
    try {
      const to = uniquePath(dest, name, isDir(src));
      moveOne(src, to);
      res.moved++;
      res.moves.push({ from: src, to });
    } catch (e) {
      res.errors.push(`${name}: ${errText(e)}`);
    }
  }
  return res;
}

// ---------- 아이콘 ----------
// (3차) 아이콘 크기 범위 — settings.json box.iconSizeMin/Max/Step
function iconRange() {
  const o = opts();
  const min = num(o.iconSizeMin, 16, 8, 256);
  const max = Math.max(min, num(o.iconSizeMax, 128, 8, 256));
  return { min, max, step: num(o.iconSizeStep, 8, 1, 64) };
}
function boxIconSize(b) {
  const r = iconRange();
  return Math.round(num(b && b.iconSize, num(opts().iconSize, 40, r.min, r.max), r.min, r.max));
}
// size = 그 정리함의 아이콘 크기. 고해상도 화면용으로 2배를 64px 단위로 올려서 받아 둠
// (휠로 조금씩 바꿀 때마다 새로 받지 않게)
// 윈도우 탐색기와 같은 큰 아이콘/미리보기 그림, 안 되면 기본 아이콘
// (2026-10-13 시작속도) 미리보기를 받아도 되는 확장자인지 — box.thumbExts 목록에 있는 것만
// 윈도우 미리보기(createThumbnailFromPath)는 받는 동안 앱 전체가 멈춤. eps 하나에 25초 멈춘 기록이 있어 그림 파일만 허용
function thumbAllowed(p) {
  const ext = path.extname(p).toLowerCase().replace('.', '');
  if (!ext) return false;
  const list = String(opts().thumbExts || '').toLowerCase().split(/[\s,;]+/).map((x) => x.replace(/^\./, '')).filter(Boolean);
  return list.includes(ext);
}
async function thumbOrIcon(p, px) {
  let img = null;
  if (IS_WIN && typeof nativeImage.createThumbnailFromPath === 'function' && thumbAllowed(p)) {
    try {
      img = await nativeImage.createThumbnailFromPath(p, { width: px, height: px });
      if (img && img.isEmpty()) img = null;
    } catch (e) { img = null; }
  }
  if (!img) img = await fileTypeIcon(p, px);
  return img;
}
// ---------- (13차) 파일 종류 아이콘 ----------
// 윈도우에 아이콘을 한꺼번에 많이 달라고 하면 일부를 빈 종이(기본 아이콘)로 줌(같은 xlsx 인데 어떤 건 엑셀, 어떤 건 빈 종이)
//  → ① 한 번에 하나씩 순서대로 받음 ② 확장자별로 한 번만 받아 재사용 ③ 빈 종이가 오면 그 확장자를 여는 프로그램에서 직접 꺼냄
const PER_FILE_ICON_EXT = /\.(exe|dll|cpl|ocx|scr|icl|ico|cur|ani|lnk|url|msi|appref-ms)$/i; // 파일마다 그림이 다른 종류
const extIcons = new Map(); // 확장자 -> Promise<그림|null>
let iconChain = Promise.resolve();
function queuedFileIcon(p) {
  const run = () => app.getFileIcon(p, { size: 'large' }).then((im) => (im && !im.isEmpty() ? im : null), () => null);
  const pr = iconChain.then(run, run);
  iconChain = pr.catch(() => null);
  return pr;
}
let blankSig = null; // 윈도우의 "모르는 파일" 빈 종이 그림(비교용)
function blankIconSig() {
  if (blankSig) return blankSig;
  blankSig = (async () => {
    try {
      const f = path.join(require('os').tmpdir(), 'memo-box-blank-test.memoboxnoassoc');
      if (!fs.existsSync(f)) fs.writeFileSync(f, '');
      const im = await queuedFileIcon(f);
      return im ? im.toBitmap().toString('base64') : '';
    } catch (e) { return ''; }
  })();
  return blankSig;
}
async function isBlankIcon(im) {
  if (!im) return true;
  try { const sig = await blankIconSig(); return !!sig && im.toBitmap().toString('base64') === sig; } catch (e) { return false; }
}
// 레지스트리 한 값 읽기(reg.exe, 별도 프로그램이라 앱이 멈추지 않음). 없으면 ''
function regValue(key, name) {
  return new Promise((resolve) => {
    if (!IS_WIN) { resolve(''); return; }
    const args = ['query', key].concat(name ? ['/v', name] : ['/ve']);
    try {
      execFile('reg', args, { windowsHide: true, timeout: 3000 }, (err, out) => {
        if (err || !out) { resolve(''); return; }
        const line = String(out).split(/\r?\n/).find((l) => /\sREG_(EXPAND_)?SZ\s/.test(l));
        resolve(line ? line.split(/\sREG_(?:EXPAND_)?SZ\s+/)[1].trim() : '');
      });
    } catch (e) { resolve(''); }
  });
}
// ---------- (13차-2) 아이콘 기록: 확장자마다 어떻게 구했는지/어디서 실패했는지 → (앱 데이터 폴더)/icon-log.txt ----------
const iconLog = new Map(); // 확장자 -> 한 줄
let iconLogTimer = null;
function logIcon(ext, text) {
  try {
    iconLog.set(ext, text);
    clearTimeout(iconLogTimer);
    iconLogTimer = setTimeout(() => {
      try {
        const lines = [...iconLog.entries()].sort((x, y) => x[0].localeCompare(y[0])).map(([k, v]) => k + '  ' + v);
        fs.writeFileSync(path.join(app.getPath('userData'), 'icon-log.txt'),
          '아이콘 기록 (' + new Date().toLocaleString('ko-KR') + ')\r\n' + lines.join('\r\n') + '\r\n', 'utf8');
      } catch (e) { /* 무시 */ }
    }, 3000);
  } catch (e) { /* 무시 */ }
}
// 확장자를 여는 프로그램이 정해 둔 아이콘 위치("C:\...\xlicons.exe,1" 같은 것) 찾기. note 에 거쳐 간 곳을 적음
async function registryIconLocation(ext, note) {
  const progIds = [];
  const user = await regValue('HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\FileExts\\' + ext + '\\UserChoice', 'ProgId');
  if (user) progIds.push(user);
  const def = await regValue('HKCR\\' + ext, '');
  if (def && !progIds.includes(def)) progIds.push(def);
  note.push('여는 프로그램=' + (progIds.join(',') || '없음'));
  const keys = progIds.map((id) => 'HKCR\\' + id + '\\DefaultIcon').concat(['HKCR\\' + ext + '\\DefaultIcon']);
  for (const k of keys) {
    const v = await regValue(k, '');
    if (!v) continue;
    if (v.includes('%1') || v.startsWith('@')) { note.push('건너뜀(' + v + ')'); continue; }
    const m = /^\"?(.*?)\"?(?:\s*,\s*(-?\d+))?$/.exec(v.trim());
    if (!m) { note.push('못 읽음(' + v + ')'); continue; }
    const file = expandEnv(m[1]);
    if (file && fs.existsSync(file)) return { file, index: m[2] ? Number(m[2]) : 0 };
    note.push('파일 없음(' + file + ')');
  }
  return null;
}
async function iconFromProgram(ext, px, note) {
  try {
    const loc = await registryIconLocation(ext, note);
    if (!loc) return null;
    note.push('아이콘 위치=' + loc.file + ',' + loc.index);
    if (/\.ico$/i.test(loc.file)) { const im = nativeImage.createFromPath(loc.file); return im.isEmpty() ? null : im; }
    if (PE_EXT.test(loc.file)) return peIcon.toImage(nativeImage, loc.file, loc.index, px) || null;
    note.push('ico/exe/dll 아님');
  } catch (e) { note.push('오류 ' + (e && e.message)); }
  return null;
}
// (13차-2) 문서 파일(xlsx·pdf·zip 등)은 "여는 프로그램 안의 아이콘"을 먼저 직접 꺼냄 — 탐색기가 쓰는 것과 같은 출처.
// 윈도우에 부탁하는 방식(app.getFileIcon)은 엑셀·아크로뱃 등의 아이콘 도우미를 제대로 못 불러 빈 종이가 오는 경우가 있어 뒤로 미룸
async function fileTypeIcon(p, px) {
  const ext = path.extname(p).toLowerCase();
  if (!ext || PER_FILE_ICON_EXT.test(ext)) return queuedFileIcon(p); // 파일마다 다른 그림 → 그 파일 것
  const k = ext + '|' + px;
  if (extIcons.has(k)) {
    const im = await extIcons.get(k);
    if (im) return im;
  }
  const job = (async () => {
    const note = [];
    const prog = await iconFromProgram(ext, px, note);
    if (prog) { logIcon(ext, '성공: 프로그램에서 직접 | ' + note.join(' | ')); return prog; }
    let im = await queuedFileIcon(p);
    if (!(await isBlankIcon(im))) { logIcon(ext, '성공: 윈도우 아이콘 | ' + note.join(' | ')); return im; }
    const again = await queuedFileIcon(p); // 한 번 더(잠깐 실패였을 수 있음)
    if (!(await isBlankIcon(again))) { logIcon(ext, '성공: 윈도우 아이콘(두 번째) | ' + note.join(' | ')); return again; }
    logIcon(ext, '실패: 빈 종이 | ' + note.join(' | '));
    return again || im;
  })();
  extIcons.set(k, job);
  return job;
}
// %ProgramFiles% 같은 환경변수를 실제 경로로
function expandEnv(p) {
  return String(p || '').trim().replace(/^"|"$/g, '').replace(/%([^%]+)%/g, (m, n) => (process.env[n] != null ? process.env[n] : m));
}
const FOLDER_ICON = 'folder'; // 앱이 직접 그리는 폴더 아이콘을 쓰라는 표시
// (8차) 바로가기(.lnk): 바로가기 파일 그림(빈 종이)이 아니라 가리키는 대상·지정 아이콘의 그림을 씀
const PE_EXT = /\.(exe|dll|cpl|ocx|scr|icl)$/i;
// (10차) 아이콘 파일 + 번호로 그림 구하기: .ico 는 그대로, 실행파일·dll 은 안에서 그 번호 그림을 직접 꺼냄,
// 안 되면(번호 0일 때만) 윈도우 미리보기 그림
async function iconFromLocation(file, index, px) {
  if (!file || !fs.existsSync(file) || isDir(file)) return null;
  if (/\.ico$/i.test(file)) {
    try { const im = nativeImage.createFromPath(file); if (!im.isEmpty()) return im; } catch (e) { /* 아래 */ }
    return null;
  }
  if (PE_EXT.test(file)) {
    const im = peIcon.toImage(nativeImage, file, index || 0, px);
    if (im) return im;
    if (index) return null; // 번호가 지정됐는데 못 꺼냄 → 다른 그림을 보여주느니 다음 방법으로
  }
  return thumbOrIcon(file, px);
}
// (8차) 바로가기(.lnk): 바로가기 파일 그림(빈 종이)이 아니라 지정된 아이콘·가리키는 대상의 그림을 씀
// (11차) Electron 의 readShortcutLink 는 Tauri 앱(ArtCraft·HOP 등) 바로가기를 못 읽고 통째로 실패함
//        (안의 앱 이름표 형식 문제) → 앱이 바로가기 파일을 직접 읽은 결과(src/lnkRead.js)로 이어서 찾음
// (14차) 바로가기가 폴더를 가리키는지(가볍게 — 바로가기 파일만 읽음)
function shortcutIsFolder(lnk) {
  try {
    let info = null;
    try { info = shell.readShortcutLink(lnk); } catch (e) { info = null; }
    const raw = lnkRead.parse(lnk, [desktopDir()]) || { targets: [] };
    const tgts = [expandEnv(info && info.target)].concat(raw.targets || []).filter(Boolean);
    for (const t of tgts) { if (fs.existsSync(t)) return isDir(t); }
  } catch (e) { /* 무시 */ }
  return false;
}
async function shortcutIcon(lnk, px) {
  let info = null;
  try { info = shell.readShortcutLink(lnk); } catch (e) { info = null; }
  const raw = lnkRead.parse(lnk, [desktopDir()]) || { iconLocation: '', iconIndex: 0, targets: [] };
  // 1) 바로가기에 지정된 아이콘(파일 + 번호) — 바탕화면이 보여주는 것과 같은 그림
  const elIcon = expandEnv(info && info.icon);
  const ic = elIcon || raw.iconLocation;
  const icIndex = elIcon ? (Number(info.iconIndex) || 0) : (Number(raw.iconIndex) || 0);
  if (ic) {
    const im = await iconFromLocation(ic, icIndex, px);
    if (im) return im;
  }
  // 2) 가리키는 대상(폴더면 폴더 아이콘). 후보를 앞에서부터 실제로 있는 것까지
  const tgts = [];
  const add = (t) => { if (t && !tgts.includes(t)) tgts.push(t); };
  add(expandEnv(info && info.target));
  raw.targets.forEach(add);
  for (const t of tgts) {
    if (!fs.existsSync(t)) continue;
    if (isDir(t)) return FOLDER_ICON;
    const im = await iconFromLocation(t, 0, px);
    if (im) return im;
  }
  return null; // 못 찾음(스토어 앱, 대상이 지워진 바로가기 등) → 기본 그림
}
// (8차) 인터넷 바로가기(.url): 안에 적힌 IconFile 의 그림
async function urlIcon(file, px) {
  let text = '';
  try { text = fs.readFileSync(file, 'utf8'); } catch (e) { return null; }
  const m = /^\s*IconFile\s*=\s*(.+?)\s*$/im.exec(text);
  const n = /^\s*IconIndex\s*=\s*(-?\d+)\s*$/im.exec(text);
  const ic = m ? expandEnv(m[1]) : '';
  return ic ? iconFromLocation(ic, n ? Number(n[1]) : 0, px) : null;
}
const iconPending = new Map(); // (13차-3) 전체경로|key -> 만드는 중인 Promise(같은 파일을 동시에 두 번 만들지 않게)
async function iconFor(full, st, size) {
  const px = Math.max(64, Math.ceil((size * 2) / 64) * 64);
  const key = `${st.mtimeMs}|${st.size}|${px}`;
  const cached = iconCache.get(full);
  if (cached && cached.key === key) return cached;
  const pk = full + '|' + key;
  if (iconPending.has(pk)) return iconPending.get(pk);
  const pr = makeIcon(full, st, px, key).finally(() => iconPending.delete(pk));
  iconPending.set(pk, pr);
  return pr;
}
async function makeIcon(full, st, px, key) {
  const tIcon = Date.now(); // 시작 속도 측정용
  let entry;
  // (8차) 폴더는 윈도우에 묻지 않고 앱이 직접 그린 폴더 아이콘(막 만든 폴더가 드라이브 모양으로 나오던 문제)
  if (st.isDirectory()) {
    entry = { key, dataUrl: '', image: null, folder: true };
  } else {
    const ext = path.extname(full).toLowerCase();
    let img = null;
    // (13차-3) 탐색기와 같은 방식(아이콘 도우미)을 먼저 — 그림 파일(box.thumbExts)은 미리보기, 나머지는 아이콘만
    // (14차) 바로가기도 도우미 먼저(옛 방식은 앱 본체가 실행파일을 직접 읽어서 켤 때 1.7초 멈춘 기록). 단, 폴더 바로가기는 앱이 그린 폴더 아이콘
    const isShortcut = ext === '.lnk' || ext === '.url';
    if (IS_WIN && ext === '.lnk' && shortcutIsFolder(full)) img = FOLDER_ICON;
    else if (IS_WIN && shellIcon.enabled()) img = await shellIcon.get(full, px, !thumbAllowed(full));
    if (img) { /* 도우미 성공 또는 폴더 바로가기 */ }
    else if (IS_WIN && ext === '.lnk') img = await shortcutIcon(full, px);
    else if (IS_WIN && ext === '.url') img = await urlIcon(full, px);
    else if (IS_WIN && PE_EXT.test(ext)) img = peIcon.toImage(nativeImage, full, 0, px); // (10차) 실행파일은 안의 그림 직접
    if (img === FOLDER_ICON) entry = { key, dataUrl: '', image: null, folder: true };
    else {
      if (!img) img = await thumbOrIcon(full, px);
      entry = { key, dataUrl: img && !img.isEmpty() ? img.toDataURL() : '', image: img };
    }
  }
  iconCache.set(full, entry);
  bootlog.iconDone(full, Date.now() - tIcon);
  perflog.add('아이콘 새로 만들기', Date.now() - tIcon);
  return entry;
}

// ---------- (6차) 묶음(탭으로 겹친 창) ----------
function getGroups() {
  const s = ctx.store.getSettings();
  return Array.isArray(s.boxGroups) ? s.boxGroups.slice() : [];
}
function saveGroups(groups) {
  const s = ctx.store.getSettings();
  s.boxGroups = groups;
  ctx.store.saveSettings(s);
}
function getGroup(id) { return getGroups().find((g) => g.id === id) || null; }
function patchGroup(id, patch) {
  const groups = getGroups();
  const i = groups.findIndex((g) => g.id === id);
  if (i < 0) return null;
  groups[i] = { ...groups[i], ...patch };
  saveGroups(groups);
  return groups[i];
}
// (11차) 묶음 안 탭 순서: 묶음의 tabOrder(정리함 id 목록) 순서대로, 거기 없는 것(새로 들어온 것)은 뒤에
function groupMembers(gid) {
  const list = getBoxes().filter((b) => b.groupId === gid);
  const g = getGroup(gid);
  const ord = g && Array.isArray(g.tabOrder) ? g.tabOrder : [];
  if (!ord.length || list.length < 2) return list;
  const pos = new Map();
  ord.forEach((id, i) => { if (!pos.has(id)) pos.set(id, i); });
  const big = ord.length + 1;
  return list
    .map((b, i) => ({ b, k: pos.has(b.id) ? pos.get(b.id) : big + i }))
    .sort((x, y) => x.k - y.k)
    .map((x) => x.b);
}
// 정리함이 들어 있는 패널 키
function panelKeyOf(boxId) {
  const b = getBox(boxId);
  if (!b) return null;
  if (b.groupId && getGroup(b.groupId)) return `g:${b.groupId}`;
  return `b:${b.id}`;
}
// 패널 정보: { key, isGroup, rec(위치·크기 등이 저장된 객체), ids(들어 있는 정리함 id 들) }
function panelInfo(key) {
  if (!key) return null;
  if (key.startsWith('g:')) {
    const g = getGroup(key.slice(2));
    if (!g) return null;
    const ids = groupMembers(g.id).map((b) => b.id);
    if (!ids.length) return null;
    return { key, isGroup: true, rec: g, ids };
  }
  const b = getBox(key.slice(2));
  if (!b) return null;
  if (b.groupId && getGroup(b.groupId)) return null; // 묶음에 들어간 정리함은 따로 창이 없음
  return { key, isGroup: false, rec: b, ids: [b.id] };
}
function patchPanel(key, patch) {
  if (!key) return null;
  return key.startsWith('g:') ? patchGroup(key.slice(2), patch) : patchBox(key.slice(2), patch);
}
function panelMode(rec) { return rec && rec.mode === 'widget' ? 'widget' : 'desktop'; }
// 이 창에서 지금 보이는 정리함 id
function activeOf(st) {
  const info = panelInfo(st.key);
  if (!info) return null;
  if (st.activeId && info.ids.includes(st.activeId)) return st.activeId;
  const saved = info.rec.activeId;
  st.activeId = saved && info.ids.includes(saved) ? saved : info.ids[0];
  return st.activeId;
}
function groupLabel(g, members) {
  const names = (members || groupMembers(g.id)).map((b) => b.name);
  return `${g.name}${names.length ? ` (${names.join(', ')})` : ''}`;
}
function newGroupName() {
  const used = new Set(getGroups().map((g) => g.name));
  for (let i = 1; i < 1000; i++) { const n = `묶음 ${i}`; if (!used.has(n)) return n; }
  return '묶음';
}

// ---------- 정리함 내용 목록 ----------
async function listPanel(st) {
  const info = panelInfo(st.key);
  if (!info) return { ok: false, reason: 'nobox' };
  const activeId = activeOf(st);
  const b = getBox(activeId);
  if (!b) return { ok: false, reason: 'nobox' };
  const o = opts();
  const defId = hooks.getDefaultBoxId ? hooks.getDefaultBoxId() : null;
  const base = {
    box: publicBox(b),
    panel: { key: info.key, isGroup: info.isGroup, name: info.rec.name, collapsed: !!info.rec.collapsed, mode: panelMode(info.rec), locked: !!info.rec.locked },
    tabs: info.isGroup ? info.ids.map((id) => { const x = getBox(id); return { id, name: x.name, kind: boxKind(x), isDefault: defId === id }; }) : [],
    activeId,
    popup: st.popup,
    expanded: st.expanded,
    iconSize: boxIconSize(b),
    iconRange: iconRange(),
    titleHeight: num(o.titleHeight, 30, 22, 60),
    hoverExpandMs: num(o.hoverExpandMs, 250, 0, 10000),
    wakeRetryMs: num(o.wakeRetryMs, 150, 30, 5000), // (2026-10-15) 가려져서 무시된 뒤 다시 물어보는 간격
    fadeMs: num(o.fadeMs, 400, 0, 10000),           // (9차) 사라지는 속도
    fadeInMs: num(o.fadeInMs, 80, 0, 10000),        // (11차) 다시 나타나는 속도
    fadedOpacity: num(o.fadedOpacity, 0, 0, 100),   // (9차) 사라졌을 때 진하기 %
    toastMs: num(o.toastSeconds, 4, 1, 60) * 1000,
    tipDelayMs: num(o.tipDelayMs, 600, 0, 10000),   // (13차) 이름표가 뜨기까지
    tipMaxMs: num(o.tipMaxMs, 5000, 0, 60000)       // (13차) 이름표가 저절로 사라지기까지(0 = 마우스가 나갈 때만)
  };
  if (!isDir(b.folder)) return { ...base, ok: false, reason: 'missing' };
  // (13차) 목록을 읽은 시점의 폴더 수정시각 — 펼칠 때 바뀌었으면 다시 읽음(지워진 항목이 남아 보이던 문제)
  try { st.listedFolder = b.folder; st.listedMtime = fs.statSync(b.folder).mtimeMs; } catch (e) { /* 무시 */ }
  let names = [];
  try { names = fs.readdirSync(b.folder); } catch (e) { return { ...base, ok: false, reason: 'missing' }; }
  const isFolder = base.box.kind === 'folder';
  let raw = [];
  for (const name of names) {
    if (SKIP_NAMES.has(name.toLowerCase()) || name.startsWith('~$')) continue;
    const full = path.join(b.folder, name);
    let s;
    try { s = fs.statSync(full); } catch (e) { continue; }
    // (7차) 내 문서 안의 "My Music" 같은 연결 지점(숨은 바로가기 폴더)은 탐색기처럼 안 보여줌
    // (13차) 폴더 창만이 아니라 모든 정리함에서 숨김
    try { if (fs.lstatSync(full).isSymbolicLink()) continue; } catch (e) { continue; }
    raw.push({ name, full, s });
  }
  // (11차) 폴더 창 "최근 것만 보기(지난주까지)"는 태훈님 결정으로 삭제 — 늘 전부 보여줌
  // 너무 많으면 최근 것부터 maxItems 개까지만 그림(나머지는 탐색기에서)
  const maxItems = Math.round(num(o.maxItems, 1000, 50, 20000));
  let overCount = 0;
  if (raw.length > maxItems) {
    raw = raw.slice().sort((a, c) => c.s.mtimeMs - a.s.mtimeMs);
    overCount = raw.length - maxItems;
    raw = raw.slice(0, maxItems);
  }
  // (13차-3) 아이콘을 box.listIconWaitMs 까지만 기다리고 먼저 그림. 늦은 아이콘은 다 만들어지면 한 번 더 그려서 채움
  const iconJobs = raw.map(({ full, s }) => {
    const job = { done: false, ic: null };
    job.p = iconFor(full, s, base.iconSize).then((ic) => { job.done = true; job.ic = ic; }, () => { job.done = true; });
    return job;
  });
  const waitMs = num(o.listIconWaitMs, 500, 0, 60000);
  await Promise.race([Promise.all(iconJobs.map((j) => j.p)), new Promise((r) => setTimeout(r, waitMs))]);
  if (iconJobs.some((j) => !j.done)) {
    const boxId = b.id;
    Promise.all(iconJobs.map((j) => j.p)).then(() => sendToBox(boxId, 'box:changed'));
  }
  const items = await Promise.all(raw.map(async ({ name, full, s }, i) => {
    const ic = iconJobs[i].ic || { dataUrl: '', folder: s.isDirectory() };
    const isDirectory = s.isDirectory();
    const ext = path.extname(name).toLowerCase();
    // 바로가기(.lnk/.url)는 바탕화면처럼 확장자를 숨겨서 보여줌
    const label = !isDirectory && (ext === '.lnk' || ext === '.url') ? name.slice(0, -ext.length) : name;
    // (8차) folderIcon = 앱이 그린 폴더 아이콘으로 보여줌, isLink = 바로가기 화살표 붙임
    return { name, label, path: full, isDir: isDirectory, icon: ic.dataUrl, folderIcon: !!ic.folder, isLink: !isDirectory && (ext === '.lnk' || ext === '.url'), mtime: s.mtimeMs };
  }));
  const byName = (a, c) => a.label.localeCompare(c.label, 'ko', { numeric: true, sensitivity: 'base' });
  if (base.box.sort === 'name') {
    items.sort((a, c) => (a.isDir !== c.isDir ? (a.isDir ? -1 : 1) : byName(a, c)));
  } else if (base.box.sort === 'custom') {
    const sorted = customOrder(b, items);
    items.length = 0;
    items.push(...sorted);
  } else {
    // 날짜순: 수정한 날짜가 최신인 것이 위(탐색기 "다운로드" 폴더와 같은 기준)
    items.sort((a, c) => (c.mtime - a.mtime) || byName(a, c));
  }
  return { ...base, ok: true, items, overCount, maxItems };
}

// ---------- 폴더 감시 ----------
function sendToPanel(key, channel, payload) {
  const w = wins.get(key);
  if (w && !w.isDestroyed()) w.webContents.send(channel, payload);
  if (channel === 'box:changed') perflog.add('새로 그리기 신호'); // (2026-10-14) 버벅임 측정
}
function sendToBox(boxId, channel, payload) { sendToPanel(panelKeyOf(boxId), channel, payload); }
function startWatch(id) {
  stopWatch(id);
  const b = getBox(id);
  if (!b || !isDir(b.folder)) return;
  const delay = num(opts().watchDebounceMs, 400, 50, 10000);
  const entry = { watcher: null, timer: null };
  try {
    entry.watcher = fs.watch(b.folder, { persistent: false }, () => {
      perflog.add('폴더 변경 감지: ' + (b.name || id)); // (2026-10-14) 버벅임 측정
      clearTimeout(entry.timer);
      entry.timer = setTimeout(() => sendToBox(id, 'box:changed'), delay);
    });
    entry.watcher.on('error', () => { /* 폴더가 사라지면 다음 새로고침 때 "폴더 없음"으로 보임 */ });
  } catch (e) { return; }
  watchers.set(id, entry);
}
function stopWatch(id) {
  const w = watchers.get(id);
  if (!w) return;
  clearTimeout(w.timer);
  try { if (w.watcher) w.watcher.close(); } catch (e) { /* 무시 */ }
  watchers.delete(id);
}
// 열려 있는 패널에 들어 있는 정리함만 감시
function syncWatchers() {
  const need = new Set();
  wins.forEach((w, key) => { const info = panelInfo(key); if (info) info.ids.forEach((id) => need.add(id)); });
  [...watchers.keys()].forEach((id) => { if (!need.has(id)) stopWatch(id); });
  need.forEach((id) => { if (!watchers.has(id)) startWatch(id); });
}

// ---------- 창 ----------
function defaultPos() {
  const wa = screen.getPrimaryDisplay().workArea;
  const n = wins.size % 8;
  return { x: wa.x + 40 + n * 30, y: wa.y + 40 + n * 30 };
}
// 위젯형은 위젯 옆(왼쪽, 자리가 없으면 오른쪽)에 뜸
function popupPos(w, h) {
  const ww = ctx.getWidgetWindow && ctx.getWidgetWindow();
  let a = null;
  if (ww && !ww.isDestroyed() && ww.isVisible()) a = ww.getBounds();
  if (!a) { const p = screen.getCursorScreenPoint(); a = { x: p.x, y: p.y, width: 0, height: 0 }; }
  const wa = screen.getDisplayMatching(a).workArea;
  let x = a.x - w - 6;
  if (x < wa.x) x = a.x + a.width + 6;
  if (x + w > wa.x + wa.width) x = wa.x + wa.width - w;
  let y = Math.min(a.y, wa.y + wa.height - h);
  y = Math.max(wa.y, y);
  return { x: Math.round(Math.max(wa.x, x)), y: Math.round(y) };
}

function openPanel(key) {
  const info = panelInfo(key);
  if (!info) return null;
  const rec = info.rec;
  const popup = panelMode(rec) === 'widget';
  const old = wins.get(key);
  if (old && !old.isDestroyed()) {
    if (popup) { old.show(); old.focus(); } else old.showInactive();
    return old;
  }
  const o = opts();
  const titleH = num(o.titleHeight, 30, 22, 60);
  const w = Math.round(num(rec.width, num(o.defaultWidth, 340, 160, 4000), 160, 4000));
  const h = Math.round(num(rec.height, num(o.defaultHeight, 240, 100, 4000), titleH + 40, 4000));
  const startCollapsed = !popup && !!rec.collapsed;
  let pos;
  if (popup) pos = popupPos(w, h);
  else if (typeof rec.x === 'number' && typeof rec.y === 'number' && ctx.isPosVisible(rec.x, rec.y, w, h)) pos = { x: rec.x, y: rec.y };
  else pos = defaultPos();

  const win = new BrowserWindow({
    width: w,
    height: startCollapsed ? titleH : h,
    x: pos.x,
    y: pos.y,
    minWidth: 160,
    minHeight: startCollapsed ? titleH : titleH + 40,
    frame: false,
    // (2차) 배경을 비치게 하려고 투명창 사용. 배경색·투명도는 화면(box.css)에서 칠함.
    // 투명창은 윈도우에서 가장자리 끌기로 크기를 못 바꿔서 → 오른쪽 아래 ◢ 손잡이로 직접 바꿈(box:resize*)
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    roundedCorners: false,
    alwaysOnTop: popup,            // 깔림형은 달력처럼 뒤에 깔림, 위젯형은 위에 뜸
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    focusable: popup,              // 깔림형은 클릭해도 앞으로 튀어나오지 않게(달력 잠금 상태와 같음)
    show: false,
    opacity: num(o.opacity, 100, 20, 100) / 100,
    icon: ctx.iconPath,
    title: rec.name || '정리함',
    webPreferences: { preload: ctx.preloadPath, contextIsolation: true }
  });
  const wcId = win.webContents.id;
  states.set(wcId, {
    key, activeId: null, popup, expanded: !startCollapsed, shift: 0, drag: null, resize: null, poll: null,
    tabDrag: null, hintKey: null, // (7차) 탭 끌기 중 / 강조 중인 받는 쪽 창
    faded: false, lastHover: 0,   // (9차) 접힌 제목줄 숨김 상태 / 마지막으로 마우스가 올라온 시각
    lastInside: 0, menuOpen: false, collapseMs: 700
  });
  wins.set(key, win);
  win.loadFile(path.join(ctx.rendererDir, 'box', 'index.html'));
  win.webContents.once('did-finish-load', () => bootlog.mark('박스 화면 그리기 끝: ' + (rec.name || key)));
  win.webContents.on('will-navigate', (e) => e.preventDefault()); // 링크 같은 걸 떨어뜨려도 창이 다른 페이지로 안 바뀌게
  win.once('ready-to-show', () => {
    if (win.isDestroyed()) return;
    if (popup) { win.show(); win.focus(); } else win.showInactive();
  });
  // (11차) 깔림형: 안을 눌러 키보드를 받았다가(activateBox) 다른 곳을 누르면 다시 깔림 상태로(달력 잠금과 같은 방식)
  if (!popup) win.on('blur', () => { if (!win.isDestroyed()) { try { win.setFocusable(false); win.setSkipTaskbar(true); } catch (e) { /* 무시 */ } } });
  win.on('closed', () => {
    const st = states.get(wcId);
    if (st && st.poll) clearInterval(st.poll);
    if (st && st.hintKey) sendToPanel(st.hintKey, 'box:mergeHint', false); // 끌던 창이 닫히면 강조도 지움
    if (st && st.tabDrag) hideGhost(); // (11차) 탭 끌던 중에 창이 닫히면 점선 상자도 치움
    states.delete(wcId);
    if (wins.get(key) === win) wins.delete(key);
    syncWatchers();
  });
  syncWatchers();
  return win;
}
function closePanel(key) {
  const w = wins.get(key);
  if (w && !w.isDestroyed()) w.close();
}
function openBox(id) { return openPanel(panelKeyOf(id)); }
// 패널 구성이 바뀌었을 때(묶음 넣기/빼기 등): 없어진 패널은 닫고, 깔림형 패널은 열고, 열린 건 새로 그림
function reconcilePanels() {
  [...wins.keys()].forEach((key) => { if (!panelInfo(key)) closePanel(key); });
  const keys = new Set(getBoxes().map((b) => panelKeyOf(b.id)));
  keys.forEach((key) => {
    const info = panelInfo(key);
    if (!info) return;
    if (wins.get(key)) sendToPanel(key, 'box:changed');
    else if (panelMode(info.rec) === 'desktop') openPanel(key);
  });
  syncWatchers();
}

// (11차) 정리함 위계(태훈님 결정 2026-10-13)
//  ① 접힌 제목줄: 바탕화면에 깔림(다른 창 뒤)   ② 펼치면(마우스 올림·📌): 다른 창들 앞으로 — 키보드는 안 가져옴
//  ③ 펼쳐 둔 정리함: 평소 깔림, 안을 누르면 앞으로 + 키보드(Delete 키 등)   ④ 위젯형: 원래대로 늘 위
// 앞으로만 올림(키보드 안 가져옴 → 다른 창에서 치던 글자가 안 끊김). 맨 위 고정을 켰다 끄면 "보통 창들 중 맨 앞"에 놓임
function raiseBox(win) {
  if (!win || win.isDestroyed()) return;
  try { win.setAlwaysOnTop(true); win.setAlwaysOnTop(false); } catch (e) { /* 무시 */ }
}
// 안을 눌렀을 때: 앞으로 + 키보드 받기. 다른 곳을 누르면 blur 에서 다시 깔림(openPanel)
function activateBox(win) {
  if (!win || win.isDestroyed()) return;
  const st = states.get(win.webContents.id);
  if (!st || st.popup || win.isFocused()) return;
  // (2026-10-13) 윈도우에선 setFocusable(true)가 작업표시줄 숨김을 풀어버려서 바로 다시 걺
  try { win.setFocusable(true); win.setSkipTaskbar(true); win.focus(); win.moveTop(); } catch (e) { /* 무시 */ }
}
// 접힘/펼침. 화면 아래쪽이 모자라면 위로 펼치고(shift), 접을 때 원래 자리로 돌아옴
function setExpanded(win, expanded) {
  if (!win || win.isDestroyed()) return;
  const st = states.get(win.webContents.id);
  if (!st || st.popup || st.expanded === expanded) return;
  const info = panelInfo(st.key);
  if (!info) return;
  const o = opts();
  const titleH = num(o.titleHeight, 30, 22, 60);
  const r = win.getBounds();
  if (expanded) {
    const h = Math.round(num(info.rec.height, num(o.defaultHeight, 240, 100, 4000), titleH + 40, 4000));
    const wa = screen.getDisplayMatching({ ...r, height: h }).workArea;
    const overflow = r.y + h - (wa.y + wa.height);
    st.shift = overflow > 0 ? Math.min(overflow, Math.max(0, r.y - wa.y)) : 0;
    st.expanded = true;
    setFaded(win, st, false); // (9차) 펼칠 땐 항상 보이게
    win.setMinimumSize(160, titleH + 40);
    win.setBounds({ x: r.x, y: r.y - st.shift, width: r.width, height: h });
    raiseBox(win); // (11차) 일부러 펼친 것 → 다른 창들 앞으로
    // (13차) 지난번 목록 이후 폴더 안이 바뀌었으면(감시가 놓친 경우) 새로 읽음
    try {
      const cur = getBox(activeOf(st));
      if (cur && st.listedFolder === cur.folder && fs.statSync(cur.folder).mtimeMs !== st.listedMtime) {
        win.webContents.send('box:changed');
      }
    } catch (e) { /* 무시 */ }
  } else {
    st.expanded = false;
    win.setMinimumSize(160, titleH);
    win.setBounds({ x: r.x, y: r.y + st.shift, width: r.width, height: titleH });
    st.shift = 0;
  }
  win.webContents.send('box:expanded', st.expanded);
  updatePoll(win);
}
// 접어둔 패널이 잠깐 펼쳐져 있는 동안: 마우스가 밖으로 나가고 hoverCollapseMs 가 지나면 다시 접음
function updatePoll(win) {
  const st = states.get(win.webContents.id);
  if (!st) return;
  const info = panelInfo(st.key);
  const need = !!(st.expanded && info && info.rec.collapsed && !st.popup);
  if (need && !st.poll) {
    const o = opts();
    st.collapseMs = num(o.hoverCollapseMs, 700, 0, 60000);
    st.lastInside = Date.now();
    st.poll = setInterval(() => pollTick(win), num(o.hoverCheckMs, 150, 30, 2000));
  } else if (!need && st.poll) {
    clearInterval(st.poll);
    st.poll = null;
  }
}
function pollTick(win) {
  if (!win || win.isDestroyed()) return;
  const st = states.get(win.webContents.id);
  if (!st) return;
  if (st.drag || st.resize || st.menuOpen || st.tabDrag) { st.lastInside = Date.now(); return; }
  const p = screen.getCursorScreenPoint();
  const r = win.getBounds();
  const inside = p.x >= r.x && p.x < r.x + r.width && p.y >= r.y && p.y < r.y + r.height;
  if (inside) { st.lastInside = Date.now(); return; }
  if (Date.now() - st.lastInside >= st.collapseMs) setExpanded(win, false);
}
function toggleCollapsed(win) {
  if (!win || win.isDestroyed()) return;
  const st = states.get(win.webContents.id);
  if (!st || st.popup) return;
  const info = panelInfo(st.key);
  if (!info) return;
  const rec = patchPanel(st.key, { collapsed: !info.rec.collapsed });
  if (rec.collapsed) {
    setExpanded(win, false);
  } else {
    if (!st.expanded) setExpanded(win, true);
    if (st.shift) { // 위로 펼쳐진 채로 "펼쳐두기"가 되면 지금 자리를 진짜 자리로 저장
      st.shift = 0;
      const [x, y] = win.getPosition();
      patchPanel(st.key, { x, y });
    }
    updatePoll(win);
  }
  sendToPanel(st.key, 'box:changed');
}
// 깔림형/위젯형 바꾸기(패널 단위 — 묶음이면 묶음 전체)
function setPanelMode(key, mode) {
  const rec = patchPanel(key, { mode: mode === 'widget' ? 'widget' : 'desktop' });
  if (!rec) return;
  closePanel(key);
  if (panelMode(rec) === 'desktop') openPanel(key);
  notifySettings();
}

// ---------- (6차) 묶음 넣기/빼기 ----------
// groupId: 묶음 id / 'new'(새 묶음) / null(따로 띄우기)
function setGroup(boxId, groupId) {
  const b = getBox(boxId);
  if (!b) return { ok: false };
  const oldGid = b.groupId && getGroup(b.groupId) ? b.groupId : null;
  let target = groupId === 'new' ? 'new' : (groupId && getGroup(groupId) ? groupId : null);
  if (target === oldGid && target !== 'new') return { ok: true };
  const oldKey = panelKeyOf(boxId);
  const oldWin = wins.get(oldKey);
  const oldBounds = oldWin && !oldWin.isDestroyed() ? oldWin.getBounds() : null;
  if (target === 'new') {
    // 새 묶음은 이 정리함이 있던 자리·크기·모양을 이어받음
    const src = oldGid ? getGroup(oldGid) : b;
    const g = {
      id: randomUUID(), name: newGroupName(), activeId: b.id,
      x: oldBounds ? oldBounds.x : src.x, y: oldBounds ? oldBounds.y : src.y,
      width: src.width, height: src.height, collapsed: !!src.collapsed, mode: panelMode(src)
    };
    saveGroups([...getGroups(), g]);
    target = g.id;
  }
  if (target) {
    patchBox(boxId, { groupId: target });
    patchGroup(target, { activeId: boxId }); // 방금 넣은 탭을 보여줌
  } else {
    // 묶음에서 빼면 따로 창으로: 묶음 창 바로 옆에 뜸
    const g = oldGid ? getGroup(oldGid) : null;
    const patch = { groupId: null };
    if (g) {
      patch.mode = panelMode(g);
      patch.collapsed = false;
      if (oldBounds) { patch.x = oldBounds.x + 30; patch.y = oldBounds.y + 30; }
    }
    patchBox(boxId, patch);
  }
  // 빈 묶음은 지움
  if (oldGid && !groupMembers(oldGid).length) saveGroups(getGroups().filter((g) => g.id !== oldGid));
  // 열린 창의 "보고 있던 탭" 정리
  states.forEach((st) => { if (st.activeId === boxId && st.key !== panelKeyOf(boxId)) st.activeId = null; });
  const newKey = panelKeyOf(boxId);
  states.forEach((st) => { if (st.key === newKey) st.activeId = boxId; });
  reconcilePanels();
  notifySettings();
  return { ok: true };
}
function groupMenuItems(b) {
  const groups = getGroups();
  const cur = b.groupId && getGroup(b.groupId) ? b.groupId : null;
  return [
    { label: '따로 띄우기', type: 'radio', checked: !cur, click: () => setGroup(b.id, null) },
    ...groups.map((g) => ({ label: groupLabel(g), type: 'radio', checked: cur === g.id, click: () => setGroup(b.id, g.id) })),
    { type: 'separator' },
    { label: '새 묶음 만들기', click: () => setGroup(b.id, 'new') }
  ];
}

// ---------- (7차) 끌어서 묶기·빼기 (포토샵식) ----------
// 커서가 다른 창(패널)의 제목줄 위에 있으면 그 패널 키
function barTargetAt(pt, exceptKey) {
  const titleH = num(opts().titleHeight, 30, 22, 60);
  for (const [key, w] of wins) {
    if (key === exceptKey || !w || w.isDestroyed() || !w.isVisible() || !panelInfo(key)) continue;
    const r = w.getBounds();
    if (pt.x >= r.x && pt.x < r.x + r.width && pt.y >= r.y && pt.y < r.y + titleH) return key;
  }
  return null;
}
// 받는 쪽 창 제목줄을 강조(놓으면 여기로 묶인다는 표시)
function setMergeHint(st, key) {
  if (!st || st.hintKey === (key || null)) return;
  if (st.hintKey) sendToPanel(st.hintKey, 'box:mergeHint', false);
  st.hintKey = key || null;
  if (key) sendToPanel(key, 'box:mergeHint', true);
}
// 끌어서 빼고 나서 묶음에 하나만 남으면 묶음을 풀어 보통 창으로(그 자리 그대로)
function dissolveIfSingle(gid) {
  const g = getGroup(gid);
  if (!g) return;
  const m = groupMembers(gid);
  if (m.length > 1) return;
  if (m.length === 1) {
    const w = wins.get(`g:${gid}`);
    const r = w && !w.isDestroyed() ? w.getBounds() : null;
    patchBox(m[0].id, {
      groupId: null, mode: panelMode(g), collapsed: !!g.collapsed,
      x: typeof g.x === 'number' ? g.x : (r ? r.x : null),
      y: typeof g.y === 'number' ? g.y : (r ? r.y : null),
      width: g.width || m[0].width, height: g.height || m[0].height
    });
  }
  saveGroups(getGroups().filter((x) => x.id !== gid));
}
// 묶음 구성이 바뀐 뒤: 창 정리 + 보고 있던 탭 정리 + 설정창 목록 새로
function afterRegroup(showId) {
  const key = panelKeyOf(showId);
  states.forEach((st) => {
    if (st.activeId && panelKeyOf(st.activeId) !== st.key) st.activeId = null;
    if (st.key === key) st.activeId = showId;
  });
  reconcilePanels();
  notifySettings();
}
// boxIds 를 targetKey 창에 탭으로 넣음. 받는 쪽이 따로 띄운 창이면 그 자리에 새 묶음을 만듦
function joinPanel(boxIds, targetKey) {
  const t = panelInfo(targetKey);
  if (!t) return false;
  const ids = (boxIds || []).filter((id) => getBox(id) && !t.ids.includes(id));
  if (!ids.length) return false;
  const oldGids = new Set(ids.map((id) => getBox(id).groupId).filter(Boolean));
  let gid;
  if (t.isGroup) {
    gid = t.rec.id;
  } else {
    const tb = t.rec;
    const tw = wins.get(targetKey);
    const r = tw && !tw.isDestroyed() ? tw.getBounds() : null;
    const g = {
      id: randomUUID(), name: newGroupName(), activeId: ids[0],
      x: typeof tb.x === 'number' ? tb.x : (r ? r.x : null),
      y: typeof tb.y === 'number' ? tb.y : (r ? r.y : null),
      width: tb.width, height: tb.height, collapsed: !!tb.collapsed, mode: panelMode(tb)
    };
    saveGroups([...getGroups(), g]);
    gid = g.id;
    patchBox(tb.id, { groupId: gid });
  }
  ids.forEach((id) => patchBox(id, { groupId: gid }));
  patchGroup(gid, { activeId: ids[0] });
  oldGids.forEach((og) => { if (og !== gid) dissolveIfSingle(og); });
  afterRegroup(ids[0]);
  return true;
}
// (11차) 탭을 창 밖으로 끄는 동안 "놓으면 여기 창이 생김" 점선 상자를 마우스 따라 보여줌
// (전엔 끄는 탭만 흐려져서, 창 밖 마우스 쪽을 보고 있으면 아무 반응이 없는 것처럼 보였음)
let ghostWin = null;
let ghostFor = null; // 지금 상자에 적힌 정리함 id
function detachRect(boxId, pt) {
  const b = getBox(boxId);
  const g = b && b.groupId ? getGroup(b.groupId) : null;
  const o = opts();
  const w = Math.round(num((b && b.width) || (g && g.width), num(o.defaultWidth, 340, 160, 4000), 160, 4000));
  const h = Math.round(num((b && b.height) || (g && g.height), num(o.defaultHeight, 240, 60, 4000), 60, 4000));
  return { x: Math.round(pt.x - 40), y: Math.round(pt.y - 10), width: w, height: h };
}
function escHtml(t) { return String(t || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function showGhost(boxId, pt) {
  const r = detachRect(boxId, pt);
  try {
    if (!ghostWin || ghostWin.isDestroyed()) {
      ghostWin = new BrowserWindow({
        ...r, frame: false, transparent: true, backgroundColor: '#00000000', hasShadow: false, roundedCorners: false,
        resizable: false, movable: false, minimizable: false, maximizable: false, fullscreenable: false,
        skipTaskbar: true, focusable: false, alwaysOnTop: true, show: false,
        webPreferences: { contextIsolation: true, javascript: false }
      });
      ghostWin.setIgnoreMouseEvents(true); // 마우스는 그대로 아래로(끄는 데 방해 안 되게)
      ghostWin.on('closed', () => { ghostWin = null; ghostFor = null; });
      ghostFor = null;
    }
    if (ghostFor !== boxId) {
      ghostFor = boxId;
      const b = getBox(boxId);
      const bar = escHtml(opts().barColor || '#2B2820');
      const html = `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;height:100%;background:transparent;overflow:hidden;font:600 12px 'Malgun Gothic',sans-serif}
.g{box-sizing:border-box;height:100%;border:2px dashed #fff;outline:1px solid rgba(0,0,0,.45);outline-offset:-4px;border-radius:6px;background:rgba(255,255,255,.12)}
.t{height:26px;line-height:26px;padding:0 10px;background:${bar};opacity:.85;color:#fff;border-radius:4px 4px 0 0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}</style>
<div class="g"><div class="t">${escHtml(b ? b.name : '')}</div></div>`;
      ghostWin.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    }
    ghostWin.setBounds(r);
    if (!ghostWin.isVisible()) ghostWin.showInactive();
  } catch (e) { /* 표시는 못 해도 끌기 자체는 그대로 */ }
}
function hideGhost() {
  if (ghostWin && !ghostWin.isDestroyed() && ghostWin.isVisible()) { try { ghostWin.hide(); } catch (e) { /* 무시 */ } }
}
// (11차) 묶음 안 탭 순서 바꾸기: ids = 새 순서(그 묶음에 든 정리함 전부)
function reorderTabs(key, ids) {
  const info = panelInfo(key);
  if (!info || !info.isGroup || !Array.isArray(ids)) return false;
  const want = ids.filter((id) => typeof id === 'string');
  if (want.length !== info.ids.length || new Set(want).size !== want.length || !want.every((id) => info.ids.includes(id))) return false;
  patchGroup(info.rec.id, { tabOrder: want });
  sendToPanel(key, 'box:changed');
  notifySettings();
  return true;
}
// 탭을 창 밖에 놓으면: 묶음에서 빠져 놓은 자리에 따로 창으로
function detachBox(boxId, pt) {
  const b = getBox(boxId);
  if (!b || !b.groupId) return false;
  const gid = b.groupId;
  const g = getGroup(gid);
  const patch = { groupId: null, collapsed: false };
  if (g) {
    patch.mode = panelMode(g);
    if (!b.width) patch.width = g.width;
    if (!b.height) patch.height = g.height;
  }
  if (pt) { patch.x = Math.round(pt.x - 40); patch.y = Math.round(pt.y - 10); }
  patchBox(boxId, patch);
  dissolveIfSingle(gid);
  afterRegroup(boxId);
  openPanel(panelKeyOf(boxId)); // 위젯형 묶음에서 뺀 것도 바로 보이게
  return true;
}

// ---------- 메뉴 ----------
function popupMenu(win, template) {
  const st = states.get(win.webContents.id);
  if (st) st.menuOpen = true;
  // (13차) 윈도우 메뉴는 띄운 창이 "선택된 창"이어야 바깥을 눌렀을 때 닫힘.
  // 바탕화면에 깔린 정리함은 평소 "선택 안 되는 창"이라 메뉴가 안 닫히고 남았음 → 띄우기 직전에만 선택된 창으로
  // (다른 곳을 누르면 blur 처리로 다시 선택 안 되는 창으로 돌아감 — openPanel 참고)
  if (st && !st.popup && !win.isDestroyed() && !win.isFocused()) {
    try { win.setFocusable(true); win.setSkipTaskbar(true); win.focus(); } catch (e) { /* 무시 */ }
  }
  Menu.buildFromTemplate(template).popup({
    window: win,
    callback: () => { if (st) { st.menuOpen = false; st.lastInside = Date.now(); } }
  });
}
// (11차) 정리함 안 파일을 휴지통으로(태훈님 결정: 확인창 없이 바로 — 윈도우 바탕화면과 같음).
// 완전 삭제는 안 함. 그 정리함 폴더 "안"의 것만, 폴더 자체는 절대 안 지움(폴더 창의 내 문서 등 보호)
async function trashPaths(b, paths) {
  const list = (Array.isArray(paths) ? paths : []).filter((p) => typeof p === 'string' && isInside(p, b.folder) && !samePath(p, b.folder));
  const errors = [];
  for (const p of list) {
    try { await shell.trashItem(p); } catch (e) { errors.push(`${path.basename(p)} — ${e && e.message ? e.message : e}`); }
  }
  if (errors.length) sendToBox(b.id, 'box:toast', `휴지통으로 못 보낸 것 ${errors.length}개\n${errors.slice(0, 4).join('\n')}`);
  sendToBox(b.id, 'box:changed');
  return { ok: !errors.length, count: list.length - errors.length };
}
function reportMove(boxId, res) {
  if (res && res.errors && res.errors.length) {
    sendToBox(boxId, 'box:toast', `못 옮긴 것 ${res.errors.length}개\n${res.errors.slice(0, 4).join('\n')}`);
  }
}
function markTakenOut(list) {
  const now = Date.now();
  list.forEach((p) => takenOut.set(path.basename(p).toLowerCase(), now));
}
function wasTakenOut(name, withinMs) {
  const t = takenOut.get(String(name).toLowerCase());
  if (!t) return false;
  if (Date.now() - t > withinMs) { takenOut.delete(String(name).toLowerCase()); return false; }
  return true;
}
function settingsWin() { return ctx.getSettingsWindow ? ctx.getSettingsWindow() : null; }
function notifySettings() {
  const sw = settingsWin();
  if (sw && !sw.isDestroyed()) sw.webContents.send('box:listChanged');
}
// (10차) ⋯ 메뉴로 "새로" 연 설정창은, 안을 한 번도 누르거나 입력하지 않은 채 바깥을 누르면(다른 창으로 가면) 닫힘.
// 안에서 뭔가 한 번이라도 누르면(settingsBox.js 가 box:settingsTouched 보냄) 평소 설정창처럼 안 닫힘.
// 이미 열려 있던 설정창(작업 중일 수 있음)이나 위젯에서 연 설정창은 해당 없음
let settingsAutoClose = null; // { wcId, armed }
function armSettingsAutoClose(sw) {
  const ac = { wcId: sw.webContents.id, armed: true };
  settingsAutoClose = ac;
  const delay = num(opts().settingsAutoCloseMs, 150, 0, 5000);
  // 막 연 직후엔 메뉴가 닫히면서 포커스가 잠깐 정리함 창으로 돌아갈 수 있어서, 처음 잠깐은 바깥으로 가도 안 닫음
  const graceUntil = Date.now() + num(opts().settingsAutoCloseGraceMs, 800, 0, 10000);
  sw.on('blur', () => {
    if (!ac.armed || sw.isDestroyed() || Date.now() < graceUntil) return;
    setTimeout(() => {
      if (!ac.armed || sw.isDestroyed() || sw.isFocused()) return;
      // (13차) 이름 칸 등에 쓰던 글이 확정(저장)되도록 입력칸을 먼저 놓게 한 뒤 닫음
      sw.webContents.executeJavaScript('try{document.activeElement&&document.activeElement.blur()}catch(e){}', true)
        .catch(() => {})
        .then(() => setTimeout(() => { if (ac.armed && !sw.isDestroyed() && !sw.isFocused()) sw.close(); }, 120));
    }, delay);
  });
  sw.on('closed', () => { if (settingsAutoClose === ac) settingsAutoClose = null; });
  // (11차) 바깥을 눌러도 안 닫히던 문제: 메뉴로 연 설정창이 처음에 "선택된 창(포커스)"이 아니면
  //        바깥을 눌러도 "벗어남" 신호가 안 옴(설정창 제목줄을 한 번 눌러야 그때부터 됐음)
  //        → 열 때와 기다림이 끝날 때 확실히 앞으로 가져와 선택된 창으로 만듦
  const bring = () => {
    if (!ac.armed || sw.isDestroyed() || sw.isFocused()) return;
    try { if (sw.isMinimized()) sw.restore(); sw.show(); sw.moveTop(); sw.focus(); } catch (e) { /* 무시 */ }
  };
  setTimeout(bring, 50);
  if (sw.webContents.isLoading()) sw.webContents.once('did-finish-load', bring);
  setTimeout(bring, Math.max(0, graceUntil - Date.now()) + 20);
}
function openBoxSettings() {
  const before = settingsWin();
  const existed = !!(before && !before.isDestroyed());
  ctx.openSettings();
  const sw = settingsWin();
  if (!sw || sw.isDestroyed()) return;
  if (!existed) armSettingsAutoClose(sw);
  const send = () => { if (!sw.isDestroyed()) sw.webContents.send('box:showTab'); };
  if (sw.webContents.isLoading()) sw.webContents.once('did-finish-load', send);
  else send();
}
function togglePopup(key) {
  const w = wins.get(key);
  if (w && !w.isDestroyed()) w.close();
  else openPanel(key);
}

// ---------- 정리함 만들기/지우기/고치기 (설정창) ----------
// (7차) 자주 쓰는 폴더 — 설정창 빠른 가져오기 버튼, 새 정리함 이름이 이것과 같으면 "폴더 창으로 가져올까요?" 물어봄
function knownFolders() {
  const get = (n) => { try { return app.getPath(n); } catch (e) { return ''; } };
  const docs = get('documents');
  const kakao = opts().kakaoFolder || (docs ? path.join(docs, '카카오톡 받은 파일') : '');
  return [
    { key: 'documents', label: '내 문서', folder: docs, aliases: ['내문서', '문서', 'documents', 'mydocuments'] },
    { key: 'downloads', label: '다운로드', folder: get('downloads'), aliases: ['다운로드', 'downloads', '내다운로드'] },
    { key: 'kakao', label: '카카오톡 받은 파일', folder: kakao, aliases: ['카카오톡받은파일', '카톡받은파일', '카카오톡', '카톡'] },
    { key: 'pictures', label: '사진', folder: get('pictures'), aliases: ['사진', '내사진', 'pictures'] }
  ].filter((k) => k.folder && isDir(k.folder));
}
function aliasKey(s) { return String(s || '').trim().toLowerCase().replace(/\s+/g, ''); }
// 폴더에 붙일 이름: 자주 쓰는 폴더면 한글 이름, 아니면 폴더 이름
function niceName(folder) {
  const k = knownFolders().find((f) => samePath(f.folder, folder));
  return k ? k.label : (path.basename(folder) || '폴더');
}
function boxRoot() {
  const o = opts();
  if (o.defaultRoot) {
    try { fs.mkdirSync(o.defaultRoot, { recursive: true }); if (isDir(o.defaultRoot)) return o.defaultRoot; } catch (e) { /* 못 쓰면 바탕화면 */ }
  }
  return desktopDir();
}
// 새 정리함 이름과 같은 "이미 있는 폴더"를 찾음: { folder } / { error } / null(없음 → 새로 만듦)
function existingFolderFor(name, root) {
  const k = aliasKey(name);
  if (!k) return null;
  const known = knownFolders().find((f) => aliasKey(f.label) === k || f.aliases.some((a) => aliasKey(a) === k));
  const cand = known ? known.folder : path.join(root, cleanName(name));
  if (!isDir(cand)) return null;
  if (getBoxes().some((b) => b.folder && samePath(b.folder, cand))) {
    return known ? { error: `"${known.label}" 폴더는 이미 폴더 창으로 있어요` } : null; // 같은 이름 정리함 폴더면 그냥 "이름 (2)"로 새로 만듦
  }
  return checkFolderChoice(cand, null) ? null : { folder: cand };
}
// how: 'link' = 같은 이름의 있는 폴더를 폴더 창으로 가져옴(설정창에서 "가져올까요?"에 확인했을 때)
function createBox(name, how) {
  const display = String(name || '').trim().slice(0, 60);
  if (!display) return { ok: false, error: '정리함 이름을 적어주세요' };
  const o = opts();
  const root = boxRoot();
  const ex = existingFolderFor(display, root);
  if (ex && ex.error) return { ok: false, error: ex.error };
  if (ex) {
    if (how === 'link') return linkFolder(ex.folder, display);
    return { ok: false, suggest: { folder: ex.folder, name: display } };
  }
  if (how === 'link') return { ok: false, error: '가져올 폴더를 찾지 못했어요' };
  let folder;
  try {
    folder = uniquePath(root, cleanName(display), true); // 이미 같은 이름 폴더가 있으면 새 이름으로(남의 폴더를 숨기지 않게)
    fs.mkdirSync(folder, { recursive: true });
  } catch (e) {
    return { ok: false, error: `폴더를 만들 수 없어요: ${errText(e)}` };
  }
  const hidden = o.hideFolder !== false;
  if (hidden) setHidden(folder, true);
  const box = {
    id: randomUUID(), name: display, folder, createdByApp: true, hidden,
    mode: 'desktop', collapsed: false, x: null, y: null, groupId: null,
    width: num(o.defaultWidth, 340, 160, 4000), height: num(o.defaultHeight, 240, 100, 4000)
  };
  saveBoxes([...getBoxes(), box]);
  openBox(box.id);
  notifySettings();
  return { ok: true, box: publicBox(box) };
}
async function pickFolder(parentWin) {
  const r = await dialog.showOpenDialog(parentWin || undefined, { properties: ['openDirectory'] });
  if (r.canceled || !r.filePaths || !r.filePaths[0]) return '';
  return r.filePaths[0];
}
async function linkBox(parentWin) {
  const folder = await pickFolder(parentWin);
  if (!folder) return { ok: false, canceled: true };
  return linkFolder(folder, null);
}
// (7차) 폴더 창 만들기 — 폴더는 숨기지도 지우지도 않음(createdByApp:false)
function linkFolder(folder, name) {
  const err = checkFolderChoice(folder, null);
  if (err) return { ok: false, error: err };
  const o = opts();
  const box = {
    id: randomUUID(), name: String(name || niceName(folder)).slice(0, 60), folder, createdByApp: false, hidden: false,
    mode: 'desktop', collapsed: false, x: null, y: null, groupId: null,
    width: num(o.defaultWidth, 340, 160, 4000), height: num(o.defaultHeight, 240, 100, 4000)
  };
  saveBoxes([...getBoxes(), box]);
  openBox(box.id);
  notifySettings();
  return { ok: true, box: publicBox(box) };
}
function removeBox(id) {
  const b = getBox(id);
  if (!b) return { ok: false };
  const gid = b.groupId && getGroup(b.groupId) ? b.groupId : null;
  if (!gid) closePanel(`b:${id}`);
  stopWatch(id);
  saveBoxes(getBoxes().filter((x) => x.id !== id));
  if (gid && !groupMembers(gid).length) saveGroups(getGroups().filter((g) => g.id !== gid));
  states.forEach((st) => { if (st.activeId === id) st.activeId = null; });
  // 기본 정리함이었으면 풀어 줌(자동 정리도 꺼짐)
  try { const s = ctx.store.getSettings(); if (s.organizer && s.organizer.defaultBoxId === id && hooks.setDefaultBox) hooks.setDefaultBox(null); } catch (e) { /* 무시 */ }
  const r = releaseFolder(b);
  reconcilePanels();
  notifySettings();
  return { ok: true, folder: b.folder, removedFolder: r === 'removed' };
}
async function changeFolder(id, parentWin) {
  const b = getBox(id);
  if (!b) return { ok: false };
  const folder = await pickFolder(parentWin);
  if (!folder) return { ok: false, canceled: true };
  if (samePath(folder, b.folder)) return { ok: true };
  const err = checkFolderChoice(folder, id);
  if (err) return { ok: false, error: err };
  releaseFolder(b);
  patchBox(id, { folder, createdByApp: false, hidden: false });
  stopWatch(id);
  reconcilePanels();
  notifySettings();
  return { ok: true };
}
function updateBox(id, patch) {
  const b = getBox(id);
  if (!b || !patch) return { ok: false };
  const p = {};
  if (typeof patch.name === 'string' && patch.name.trim()) p.name = patch.name.trim().slice(0, 60);
  if (patch.iconSize != null && Number.isFinite(Number(patch.iconSize))) {
    const r = iconRange();
    p.iconSize = Math.round(num(patch.iconSize, 40, r.min, r.max));
  }
  if (patch.sort === 'name' || patch.sort === 'date' || patch.sort === 'custom') p.sort = patch.sort;
  // (10차) 직접 정렬을 처음 켜면 지금 이름순 그대로에서 시작
  if (p.sort === 'custom' && !(Array.isArray(b.order) && b.order.length)) p.order = nameOrder(b.folder);
  patchBox(id, p);
  // 깔림/위젯은 패널 단위(묶음이면 묶음 전체)
  if (patch.mode) {
    const key = panelKeyOf(id);
    const info = panelInfo(key);
    if (info && patch.mode !== panelMode(info.rec)) setPanelMode(key, patch.mode);
  }
  sendToBox(id, 'box:changed');
  // 아이콘 크기만 바꿀 땐 설정창 목록을 다시 그리지 않음(끄는 중인 슬라이더가 끊기지 않게)
  if (p.name || p.sort) notifySettings();
  return { ok: true };
}

// ---------- IPC ----------
function fromEvent(e) {
  const st = states.get(e.sender.id);
  const win = BrowserWindow.fromWebContents(e.sender);
  if (!st || !win || win.isDestroyed()) return null;
  return { st, win };
}
// 이 창에서 지금 보이는 정리함
function activeBox(f) { return f ? getBox(activeOf(f.st)) : null; }
// 이 창(패널)에 들어 있는 정리함인지 확인하고 돌려줌
function boxInPanel(f, boxId) {
  if (!f) return null;
  const info = panelInfo(f.st.key);
  return info && info.ids.includes(boxId) ? getBox(boxId) : null;
}
function boxMenuTemplate(f, b) {
  const info = panelInfo(f.st.key);
  const isWidget = info ? panelMode(info.rec) === 'widget' : false;
  const collapsed = info ? !!info.rec.collapsed : false;
  const sort = boxSort(b);
  return [
    { label: `${b.name} — 폴더 열기`, click: () => shell.openPath(b.folder) },
    { label: '새로고침', click: () => sendToBox(b.id, 'box:changed') },
    {
      label: '정렬',
      submenu: [
        { label: '날짜순 (최신이 위, 오늘·어제… 로 묶음)', type: 'radio', checked: sort === 'date', click: () => updateBox(b.id, { sort: 'date' }) },
        { label: '이름순', type: 'radio', checked: sort === 'name', click: () => updateBox(b.id, { sort: 'name' }) },
        { label: '직접 정렬 (아이콘을 끌어서 순서 바꾸기)', type: 'radio', checked: sort === 'custom', click: () => updateBox(b.id, { sort: 'custom' }) }
      ]
    },
    { label: '묶음 (탭으로 겹치기 — 제목줄을 다른 창 제목줄로 끌어도 됨)', submenu: groupMenuItems(b) },
    { type: 'separator' },
    {
      label: '기본 정리함으로 사용 (바탕화면에 새로 생긴 건 여기로)', type: 'checkbox',
      checked: !!(hooks.getDefaultBoxId && hooks.getDefaultBoxId() === b.id),
      enabled: !!hooks.setDefaultBox,
      click: (item) => hooks.setDefaultBox(item.checked ? b.id : null)
    },
    { type: 'separator' },
    { label: '접어두기 (제목줄에 마우스를 올리면 펼쳐짐)', type: 'checkbox', checked: collapsed, visible: !isWidget, click: () => toggleCollapsed(f.win) },
    // (13차) 위치 고정: 제목줄 끌기·크기 조절을 막음(펼치기·접기·탭·파일 넣고 빼기는 그대로) — 정리함(또는 묶음)마다 따로
    { label: '위치 고정 (끌어서 옮기기·크기 바꾸기 막기)', type: 'checkbox', checked: !!(info && info.rec.locked), click: () => { patchPanel(f.st.key, { locked: !(info && info.rec.locked) }); sendToPanel(f.st.key, 'box:changed'); } },
    { type: 'separator', visible: !isWidget },
    { label: '바탕화면에 깔기', type: 'radio', checked: !isWidget, click: () => { if (isWidget) setPanelMode(f.st.key, 'desktop'); } },
    { label: '위젯에서 열기', type: 'radio', checked: isWidget, click: () => { if (!isWidget) setPanelMode(f.st.key, 'widget'); } },
    { type: 'separator' },
    { label: '정리함 설정…', click: openBoxSettings }
  ];
}
function registerIpc() {
  // 정리함 창이 쓰는 것
  ipcMain.handle('box:list', async (e) => {
    const f = fromEvent(e);
    if (!f) return { ok: false, reason: 'nobox' };
    // (2026-10-14) 버벅임 측정: 목록 다시 읽기 1번에 걸린 시간과 보낸 아이콘 그림 양
    const t = Date.now();
    const res = await listPanel(f.st);
    try {
      const bytes = (res && Array.isArray(res.items)) ? res.items.reduce((s, it) => s + (it.icon ? it.icon.length : 0), 0) : 0;
      const nm = (res && res.box && res.box.name) || f.st.key;
      perflog.add('목록 다시 읽기: ' + nm + ' (' + ((res && res.items && res.items.length) || 0) + '개)', Date.now() - t, bytes);
    } catch (err) { /* 무시 */ }
    return res;
  });
  ipcMain.handle('box:setActive', (e, boxId) => {
    const f = fromEvent(e);
    if (!f || !boxInPanel(f, boxId)) return;
    f.st.activeId = boxId;
    if (f.st.key.startsWith('g:')) patchGroup(f.st.key.slice(2), { activeId: boxId });
    sendToPanel(f.st.key, 'box:changed');
  });
  ipcMain.handle('box:open', async (e, p) => {
    const b = activeBox(fromEvent(e));
    if (!b || typeof p !== 'string' || !isInside(p, b.folder)) return '정리함 안의 파일이 아니에요';
    // (13차) 이미 지워진 항목(목록에만 남아 있던 것) → 안내하고 목록 새로 읽기
    if (!fs.existsSync(p)) { sendToBox(b.id, 'box:changed'); return '이미 없는 항목이에요. 목록을 새로 고쳤어요'; }
    return shell.openPath(p); // 성공하면 '' , 실패하면 오류 문구
  });
  // (10차) 놓은 자리까지 알려 주는 끌어넣기: 밖에서 온 건 폴더로 옮기고, 직접 정렬이면 놓은 자리(anchor 앞/뒤)에 끼움.
  // 같은 정리함 안에서 끌어 놓은 건 옮기지 않고 순서만 바꿈
  ipcMain.handle('box:dropAt', (e, { paths, anchor, after } = {}) => {
    const b = activeBox(fromEvent(e));
    if (!b) return { moved: 0, skipped: 0, errors: ['정리함을 찾을 수 없어요'] };
    const list = (Array.isArray(paths) ? paths : []).filter((p) => typeof p === 'string' && p);
    const inside = list.filter((p) => samePath(path.dirname(path.resolve(p)), b.folder) && fs.existsSync(p));
    const r = moveInto(b.folder, list); // 안에 있던 건 "이미 있음"으로 건너뜀
    if (boxSort(b) === 'custom') {
      const names = [...inside.map((p) => path.basename(p)), ...r.moves.map((m) => path.basename(m.to))];
      placeInOrder(b.id, names, typeof anchor === 'string' && anchor ? path.basename(anchor) : null, !!after);
      sendToBox(b.id, 'box:changed');
    }
    return r;
  });
  ipcMain.handle('box:moveIn', (e, paths) => {
    const b = activeBox(fromEvent(e));
    if (!b) return { moved: 0, skipped: 0, errors: ['정리함을 찾을 수 없어요'] };
    return moveInto(b.folder, paths);
  });
  // (6차) 탭 위에 떨어뜨리면 그 탭의 정리함으로
  ipcMain.handle('box:moveInTo', (e, { boxId, paths } = {}) => {
    const b = boxInPanel(fromEvent(e), boxId);
    if (!b) return { moved: 0, skipped: 0, errors: ['정리함을 찾을 수 없어요'] };
    const r = moveInto(b.folder, paths);
    sendToBox(boxId, 'box:changed');
    return r;
  });
  // (3차) 정리함 창에서 Ctrl+휠로 바꾼 아이콘 크기 저장(지금 보이는 정리함)
  ipcMain.handle('box:setIconSize', (e, size) => {
    const b = activeBox(fromEvent(e));
    if (!b) return;
    updateBox(b.id, { iconSize: size });
    notifySettings(); // 설정창이 열려 있으면 슬라이더도 맞춰 줌
  });
  ipcMain.handle('box:setExpanded', (e, v) => {
    const f = fromEvent(e);
    if (!f) return;
    if (v && covered(f.win)) return; // (2026-10-15) 다른 창에 가려진 채 마우스가 지나간 것 → 안 펼침
    setExpanded(f.win, !!v);
  });
  ipcMain.handle('box:toggleCollapsed', (e) => { const f = fromEvent(e); if (f) toggleCollapsed(f.win); });
  ipcMain.handle('box:closeSelf', (e) => { const f = fromEvent(e); if (f) f.win.close(); });
  ipcMain.handle('box:changeFolderSelf', async (e) => {
    const f = fromEvent(e);
    const b = activeBox(f);
    if (!b) return { ok: false };
    const r = await changeFolder(b.id, f.win);
    if (r && r.error) sendToBox(b.id, 'box:toast', r.error);
    return r;
  });
  ipcMain.handle('box:itemMenu', (e, paths) => {
    const f = fromEvent(e);
    const b = activeBox(f);
    if (!b) return;
    const list = (Array.isArray(paths) ? paths : []).filter((p) => typeof p === 'string' && isInside(p, b.folder));
    if (!list.length) return;
    const others = getBoxes().filter((x) => x.id !== b.id);
    popupMenu(f.win, [
      { label: list.length > 1 ? `열기 (${list.length}개)` : '열기', click: () => list.forEach((p) => shell.openPath(p)) },
      { label: '탐색기에서 위치 보기', click: () => shell.showItemInFolder(list[0]) },
      { type: 'separator' },
      { label: '바탕화면으로 꺼내기', click: () => { markTakenOut(list); reportMove(b.id, moveInto(desktopDir(), list)); } },
      {
        label: '다른 정리함으로 옮기기',
        submenu: others.length
          ? others.map((o) => ({ label: o.name, click: () => { reportMove(b.id, moveInto(o.folder, list)); sendToBox(o.id, 'box:changed'); } }))
          : [{ label: '(다른 정리함이 없어요)', enabled: false }]
      },
      { type: 'separator' },
      { label: list.length > 1 ? `삭제 (${list.length}개, 휴지통으로)` : '삭제 (휴지통으로)', click: () => trashPaths(b, list) } // (11차)
    ]);
  });
  ipcMain.on('box:wake', (e) => wakeFaded(BrowserWindow.fromWebContents(e.sender))); // (11차)
  ipcMain.on('box:activate', (e) => activateBox(BrowserWindow.fromWebContents(e.sender))); // (11차) 안을 누름 → 앞으로 + 키보드
  // (11차) 묶음 안 탭 순서 바꾸기(탭을 같은 줄 안에서 끌어 놓음)
  ipcMain.handle('box:reorderTabs', (e, ids) => { const f = fromEvent(e); return f ? reorderTabs(f.st.key, ids) : false; });
  // (11차) Delete 키: 고른 것을 휴지통으로
  ipcMain.handle('box:trash', (e, paths) => {
    const b = activeBox(fromEvent(e));
    return b ? trashPaths(b, paths) : { ok: false };
  });
  // boxId 를 주면(탭 우클릭) 그 정리함 메뉴, 없으면 지금 보이는 정리함 메뉴
  ipcMain.handle('box:boxMenu', (e, boxId) => {
    const f = fromEvent(e);
    const b = (boxId && boxInPanel(f, boxId)) || activeBox(f);
    if (!b) return;
    popupMenu(f.win, boxMenuTemplate(f, b));
  });
  // 창 옮기기: 제목줄을 잡고 끌면 마우스가 움직인 만큼 창을 옮김
  // (제목줄을 윈도우 기본 "끌기 영역"으로 만들면 마우스 올림을 못 알아채서 펼침 기능이 안 됨 → 직접 옮김)
  ipcMain.on('box:dragStart', (e) => {
    const f = fromEvent(e);
    if (!f) return;
    { const pi = panelInfo(f.st.key); if (pi && pi.rec.locked) return; } // (13차) 위치 고정
    f.st.drag = { c: screen.getCursorScreenPoint(), p: f.win.getPosition() };
    setMergeHint(f.st, null);
  });
  const dragTo = (f) => {
    const c = screen.getCursorScreenPoint();
    f.win.setPosition(Math.round(f.st.drag.p[0] + c.x - f.st.drag.c.x), Math.round(f.st.drag.p[1] + c.y - f.st.drag.c.y));
  };
  ipcMain.on('box:dragMove', (e) => {
    const f = fromEvent(e);
    if (!f || !f.st.drag) return;
    dragTo(f);
    setMergeHint(f.st, barTargetAt(screen.getCursorScreenPoint(), f.st.key)); // (7차) 놓으면 묶일 창 강조
  });
  ipcMain.on('box:dragEnd', (e) => {
    const f = fromEvent(e);
    if (!f || !f.st.drag) return;
    dragTo(f);
    f.st.drag = null;
    // (7차) 다른 창 제목줄 위에 놓으면 그 창에 탭으로 묶음(묶음 창이면 들어 있는 것 전부)
    const target = barTargetAt(screen.getCursorScreenPoint(), f.st.key);
    setMergeHint(f.st, null);
    if (target) {
      const info = panelInfo(f.st.key);
      if (info && joinPanel(info.ids, target)) return;
    }
    if (f.st.popup) return; // 위젯형은 위치 안 기억(늘 위젯 옆에 뜸)
    const [x, y] = f.win.getPosition();
    patchPanel(f.st.key, { x, y: y + f.st.shift });
  });
  // (7차) 탭 끌기: 다른 창 제목줄에 놓으면 그 창으로, 창 밖에 놓으면 따로 떨어져 나옴, 조금만 움직이면 클릭(탭 바꾸기)
  ipcMain.on('box:tabDragStart', (e, boxId) => {
    const f = fromEvent(e);
    if (!f || !boxInPanel(f, boxId)) return;
    f.st.tabDrag = { boxId, c: screen.getCursorScreenPoint(), moved: false };
    setMergeHint(f.st, null);
  });
  const tabDragState = (f) => {
    const td = f.st.tabDrag;
    const c = screen.getCursorScreenPoint();
    if (!td.moved && Math.abs(c.x - td.c.x) + Math.abs(c.y - td.c.y) >= num(opts().tabDragPx, 8, 2, 100)) td.moved = true;
    const r = f.win.getBounds();
    const inside = c.x >= r.x && c.x < r.x + r.width && c.y >= r.y && c.y < r.y + r.height;
    const target = td.moved ? barTargetAt(c, f.st.key) : null;
    return { c, inside, target, moved: td.moved };
  };
  ipcMain.handle('box:tabDragMove', (e) => {
    const f = fromEvent(e);
    if (!f || !f.st.tabDrag) return null;
    const s = tabDragState(f);
    setMergeHint(f.st, s.target);
    const out = s.moved && !s.inside && !s.target;
    if (out) showGhost(f.st.tabDrag.boxId, s.c); else hideGhost(); // (11차) 놓을 자리 점선 상자
    return { moved: s.moved, out, target: !!s.target };
  });
  ipcMain.handle('box:tabDragEnd', (e, cancel) => {
    const f = fromEvent(e);
    if (!f || !f.st.tabDrag) return { moved: false };
    const s = tabDragState(f);
    const boxId = f.st.tabDrag.boxId;
    f.st.tabDrag = null;
    setMergeHint(f.st, null);
    hideGhost(); // (11차)
    if (cancel || !s.moved) return { moved: s.moved };
    if (s.target) { joinPanel([boxId], s.target); return { moved: true, done: 'join' }; }
    if (!s.inside) { detachBox(boxId, s.c); return { moved: true, done: 'detach' }; }
    return { moved: true };
  });
  // (7차) 창 맨 아래 "탐색기에서 보기"
  ipcMain.handle('box:openFolderSelf', (e) => { const b = activeBox(fromEvent(e)); return b ? shell.openPath(b.folder) : ''; });
  // 크기 바꾸기: 오른쪽 아래 ◢ 손잡이를 끌면 마우스가 움직인 만큼 크기를 바꿈(투명창이라 직접 처리)
  ipcMain.on('box:resizeStart', (e) => {
    const f = fromEvent(e);
    if (!f || !f.st.expanded) return;
    { const pi = panelInfo(f.st.key); if (pi && pi.rec.locked) return; } // (13차) 위치 고정
    f.st.resize = { c: screen.getCursorScreenPoint(), s: f.win.getSize() };
  });
  const resizeTo = (f) => {
    const titleH = num(opts().titleHeight, 30, 22, 60);
    const c = screen.getCursorScreenPoint();
    const r = f.win.getBounds();
    const wa = screen.getDisplayMatching(r).workArea;
    const w = Math.round(Math.min(Math.max(160, f.st.resize.s[0] + c.x - f.st.resize.c.x), wa.x + wa.width - r.x));
    const h = Math.round(Math.min(Math.max(titleH + 40, f.st.resize.s[1] + c.y - f.st.resize.c.y), wa.y + wa.height - r.y));
    f.win.setBounds({ x: r.x, y: r.y, width: Math.max(160, w), height: Math.max(titleH + 40, h) });
  };
  ipcMain.on('box:resizeMove', (e) => {
    const f = fromEvent(e);
    if (f && f.st.resize) resizeTo(f);
  });
  ipcMain.on('box:resizeEnd', (e) => {
    const f = fromEvent(e);
    if (!f || !f.st.resize) return;
    resizeTo(f);
    f.st.resize = null;
    const [width, height] = f.win.getSize();
    patchPanel(f.st.key, { width, height });
  });
  // 끌어내기: 정리함 안 파일을 바탕화면·탐색기·다른 정리함(탭)으로 끌어감
  ipcMain.on('box:startDrag', (e, paths) => {
    const b = activeBox(fromEvent(e));
    if (!b) return;
    const list = (Array.isArray(paths) ? paths : []).filter((p) => typeof p === 'string' && isInside(p, b.folder) && fs.existsSync(p));
    if (!list.length) return;
    const c = iconCache.get(list[0]);
    let icon = c && c.image && !c.image.isEmpty() ? c.image.resize({ width: 32, height: 32 }) : null;
    if (!icon) icon = nativeImage.createFromPath(ctx.iconPath).resize({ width: 32, height: 32 });
    markTakenOut(list);
    try { e.sender.startDrag({ file: list[0], files: list, icon }); } catch (err) { /* 무시 */ }
  });

  // (10차) 설정창 안을 누르거나 입력함 → 바깥 눌러도 안 닫히게
  ipcMain.on('box:settingsTouched', (e) => {
    if (settingsAutoClose && settingsAutoClose.wcId === e.sender.id) settingsAutoClose.armed = false;
  });
  // 설정창 "바탕화면 정리" 메뉴가 쓰는 것
  ipcMain.handle('box:getAll', () => {
    const groups = getGroups();
    return getBoxes().map((b) => {
      const key = panelKeyOf(b.id);
      const info = panelInfo(key);
      return {
        ...publicBox(b),
        mode: info ? panelMode(info.rec) : 'desktop', // 묶음이면 묶음의 깔림/위젯
        exists: isDir(b.folder),
        open: !!(wins.get(key) && !wins.get(key).isDestroyed()),
        groups: groups.map((g) => ({ id: g.id, label: groupLabel(g) }))
      };
    });
  });
  ipcMain.handle('box:getOptions', () => {
    const o = opts();
    const r = iconRange();
    return { root: o.defaultRoot || desktopDir(), hideFolder: o.hideFolder !== false, iconMin: r.min, iconMax: r.max };
  });
  ipcMain.handle('box:setGroup', (e, { id, groupId } = {}) => setGroup(id, groupId));
  ipcMain.handle('box:setDefault', (e, { id, on } = {}) => (hooks.setDefaultBox ? hooks.setDefaultBox(on ? id : null) : null));
  ipcMain.handle('box:getStyle', () => commonStyle());
  ipcMain.handle('box:setStyle', (e, patch) => setCommonStyle(patch));
  ipcMain.handle('box:create', (e, name, how) => createBox(name, how === 'link' ? 'link' : null));
  // (7차) 자주 쓰는 폴더(내 문서·다운로드·카카오톡 받은 파일·사진) — 설정창 빠른 가져오기 버튼
  ipcMain.handle('box:getKnown', () => knownFolders().map((k) => ({
    key: k.key, label: k.label, folder: k.folder, linked: getBoxes().some((b) => b.folder && samePath(b.folder, k.folder))
  })));
  ipcMain.handle('box:linkKnown', (e, key) => {
    const k = knownFolders().find((x) => x.key === key);
    return k ? linkFolder(k.folder, k.label) : { ok: false, error: '폴더를 찾을 수 없어요' };
  });
  ipcMain.handle('box:link', (e) => linkBox(BrowserWindow.fromWebContents(e.sender)));
  ipcMain.handle('box:remove', (e, id) => removeBox(id));
  ipcMain.handle('box:update', (e, { id, patch } = {}) => updateBox(id, patch));
  ipcMain.handle('box:changeFolder', (e, id) => changeFolder(id, BrowserWindow.fromWebContents(e.sender)));
  ipcMain.handle('box:openFolder', (e, id) => { const b = getBox(id); return b ? shell.openPath(b.folder) : ''; });
  ipcMain.handle('box:openWindow', (e, id) => {
    const key = panelKeyOf(id);
    if (key && key.startsWith('g:')) { patchGroup(key.slice(2), { activeId: id }); states.forEach((st) => { if (st.key === key) st.activeId = id; }); }
    openPanel(key);
    sendToPanel(key, 'box:changed');
    notifySettings();
  });
  // 위젯 ▣ 버튼: 위젯형 정리함(묶음) 목록
  ipcMain.handle('box:widgetMenu', (e) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    const keys = [...new Set(getBoxes().map((b) => panelKeyOf(b.id)))];
    const list = keys.map((k) => panelInfo(k)).filter((info) => info && panelMode(info.rec) === 'widget');
    const t = list.length
      ? list.map((info) => ({
        label: info.isGroup ? groupLabel(info.rec) : kindMark(info.rec) + info.rec.name,
        type: 'checkbox',
        checked: !!(wins.get(info.key) && !wins.get(info.key).isDestroyed()),
        click: () => togglePopup(info.key)
      }))
      : [{ label: '위젯에서 여는 정리함이 없어요', enabled: false }];
    t.push({ type: 'separator' }, { label: '정리함 설정…', click: openBoxSettings });
    Menu.buildFromTemplate(t).popup({ window: win || undefined });
  });
}

// ---------- 밖으로 내보내는 것 ----------
// ---------- (9차) 접어둔 제목줄 자동 숨김 ----------
// 바탕화면에 깔린 접힌 창(위젯형·펼친 창 제외)은 마우스가 안 올라간 채 box.collapsedHideSeconds(기본 8초)가 지나면
// 서서히 사라지고(box.fadedOpacity, 기본 0%), 그 자리에 마우스를 올리면(파일을 끌고 와도) 다시 나타남.
// 투명해진 자리는 윈도우가 클릭을 안 넘겨줄 수 있어서, 마우스 위치는 앱이 box.fadeCheckMs 마다 직접 확인함
let fadeTimer = null;
let fadeConf = null; // { at, hideMs, collapsed:Set(패널키) } — 설정파일을 매번 읽지 않게 1초씩 기억
function getFadeConf() {
  const now = Date.now();
  if (fadeConf && now - fadeConf.at < 1000) return fadeConf;
  const s = ctx.store.getSettings();
  const o = { ...defaults(), ...(s.box || {}) };
  const gids = new Set((Array.isArray(s.boxGroups) ? s.boxGroups : []).filter((g) => g.collapsed).map((g) => `g:${g.id}`));
  (Array.isArray(s.boxes) ? s.boxes : []).forEach((b) => { if (b.collapsed && !b.groupId) gids.add(`b:${b.id}`); });
  fadeConf = { at: now, hideMs: num(o.collapsedHideSeconds, 8, 0, 3600) * 1000, collapsed: gids };
  return fadeConf;
}
function setFaded(win, st, v) {
  if (!!st.faded === v) return;
  st.faded = v;
  // 사라진 동안은 클릭이 바탕화면으로 가게. 다시 나타나면 원래대로
  // (11차) forward: 클릭은 넘기되 "마우스가 올라왔다"는 신호는 창이 받음 → 확인 주기를 안 기다리고 바로 나타남
  try { if (v) win.setIgnoreMouseEvents(true, { forward: true }); else win.setIgnoreMouseEvents(false); } catch (e) { /* 무시 */ }
  win.webContents.send('box:faded', v);
}
function fadeTick() {
  if (!wins.size) return;
  const c = getFadeConf();
  const p = screen.getCursorScreenPoint();
  const now = Date.now();
  wins.forEach((w, key) => {
    if (!w || w.isDestroyed()) return;
    const st = states.get(w.webContents.id);
    if (!st) return;
    const can = c.hideMs > 0 && !st.popup && !st.expanded && c.collapsed.has(key)
      && !st.drag && !st.tabDrag && !st.resize && !st.menuOpen;
    const r = w.getBounds();
    const inside = p.x >= r.x && p.x < r.x + r.width && p.y >= r.y && p.y < r.y + r.height
      && !(can && covered(w)); // (2026-10-15) 가려진 채 마우스가 위에 있으면 "올라옴"으로 안 침
    if (inside || !can || !st.lastHover) st.lastHover = now;
    if (st.faded && can && inside) { showFromHidden(w, st); return; } // (2026-10-15) 마우스 올라옴 → 제목줄+내용 함께
    setFaded(w, st, can && !inside && now - st.lastHover >= c.hideMs);
  });
}
// (11차) 숨은 창 위에 마우스가 올라왔다고 창이 알려 옴 → 바로 다시 보이게
// (2026-10-15) 마우스 자리에서 이 정리함 위에 다른 창이 덮여 있나(settings.json box.coverCheck 로 끌 수 있음)
function covered(win) {
  const o = opts();
  if (o.coverCheck === false) return false;
  return winCover.isCovered(win, num(o.coverMaxWalk, 3000, 10, 100000));
}
function wakeFaded(win) {
  if (!win || win.isDestroyed()) return;
  const st = states.get(win.webContents.id);
  if (!st || !st.faded) return;
  if (covered(win)) return; // (2026-10-15) 다른 창 아래에 있으면 안 나타남
  st.lastHover = Date.now();
  showFromHidden(win, st);
}
// (2026-10-15) 숨어 있다 나타날 때: 제목줄과 내용을 함께(펼친 채로) 보여줌. settings.json box.wakeExpand=false 면 예전처럼 제목줄만
function showFromHidden(win, st) {
  const info = panelInfo(st.key);
  if (opts().wakeExpand !== false && info && info.rec.collapsed && !st.popup && !st.expanded) {
    setExpanded(win, true); // 안에서 숨김도 풀고(setFaded false) 앞으로 올림
  } else {
    setFaded(win, st, false);
  }
}
function startFadeTimer() {
  if (fadeTimer) return;
  fadeTimer = setInterval(() => { try { fadeTick(); } catch (e) { /* 다음 번에 다시 */ } }, num(opts().fadeCheckMs, 200, 50, 2000));
}

function init(c) {
  ctx = c;
  // (13차-3) 아이콘 도우미 준비(실제로는 첫 아이콘을 받을 때 켜짐). 앱이 꺼지면 같이 끔
  shellIcon.init({ nativeImage, opts, log: (t) => logIcon('(도우미)', t) });
  app.on('will-quit', () => { try { shellIcon.stop(); } catch (e) { /* 무시 */ } });
  registerIpc();
  startFadeTimer();
}
// 앱을 켤 때: 바탕화면에 깔리는 정리함(묶음)들을 엶(위젯형은 위젯 ▣ 버튼으로 엶)
function openDesktopBoxes() {
  // 지워진 묶음을 가리키는 정리함은 따로 띄우기로 되돌림
  const gids = new Set(getGroups().map((g) => g.id));
  const boxes = getBoxes();
  if (boxes.some((b) => b.groupId && !gids.has(b.groupId))) {
    saveBoxes(boxes.map((b) => (b.groupId && !gids.has(b.groupId) ? { ...b, groupId: null } : b)));
  }
  const keys = [...new Set(getBoxes().map((b) => panelKeyOf(b.id)))];
  keys.forEach((key) => {
    const info = panelInfo(key);
    if (!info || panelMode(info.rec) !== 'desktop') return;
    try { openPanel(key); } catch (e) { /* 하나가 안 열려도 나머지는 엶 */ }
  });
}
// (4차) 자동 정리(src/organizer.js)가 쓰는 것
module.exports = {
  init, openDesktopBoxes, setHooks: (h) => { hooks = h || {}; },
  getBoxes, getBox, moveInto, wasTakenOut, desktopDir, isDir, samePath, uniquePath, moveOne, errText,
  refreshBox: (id) => sendToBox(id, 'box:changed')
};
