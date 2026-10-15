// ============================================================
// (10차, 2026-10-13) 실행파일(.exe/.dll) 안에 들어 있는 아이콘 그림을 직접 꺼냄
// - 바로가기는 "이 실행파일의 몇 번째 아이콘"으로 그림을 정해 두는데, 윈도우 미리보기 기능은
//   첫 번째 그림만 주거나(번호 무시) 오래된 그림을 줄 때가 있어서(Memo.md 바로가기가 빈 창 모양으로 나오던 문제) 직접 읽음
// - 파일 전체를 읽지 않고 필요한 부분만 읽음(180MB 실행파일도 빠르게)
// - 어떤 이유로든 실패하면 null → 부르는 쪽(src/box.js)이 예전 방식으로 그림을 구함. 파일은 절대 안 고침(읽기만)
// ============================================================
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const RT_ICON = 3;
const RT_GROUP_ICON = 14;

function readAt(fd, pos, len) {
  const b = Buffer.alloc(len);
  const n = fs.readSync(fd, b, 0, len, pos);
  if (n < len) throw new Error('짧게 읽힘');
  return b;
}

// 리소스 디렉터리 한 단계: [{ id(숫자) | name(문자), off(다음 단계 or 데이터 위치), isDir }]
function dirEntries(res, o) {
  const named = res.readUInt16LE(o + 12);
  const ids = res.readUInt16LE(o + 14);
  const list = [];
  for (let k = 0; k < named + ids; k++) {
    const e = o + 16 + k * 8;
    const nameField = res.readUInt32LE(e);
    const dataField = res.readUInt32LE(e + 4);
    list.push({
      isName: !!(nameField & 0x80000000),
      id: nameField & 0x80000000 ? null : nameField,
      off: dataField & 0x7fffffff,
      isDir: !!(dataField & 0x80000000)
    });
  }
  return list; // 윈도우 규칙대로 이름 있는 것 먼저, 그다음 번호 오름차순(파일에 그 순서로 들어 있음)
}

// 실행파일의 리소스 영역을 읽어서 { res(Buffer), rva(영역 시작 주소) } 로 돌려줌
function readResources(fd) {
  const mz = readAt(fd, 0, 64);
  if (mz.readUInt16LE(0) !== 0x5a4d) throw new Error('실행파일 아님');
  const pe = mz.readUInt32LE(0x3c);
  const hdr = readAt(fd, pe, 24);
  if (hdr.readUInt32LE(0) !== 0x00004550) throw new Error('PE 아님');
  const nsec = hdr.readUInt16LE(6);
  const optSize = hdr.readUInt16LE(20);
  const opt = readAt(fd, pe + 24, optSize);
  const magic = opt.readUInt16LE(0);
  const dd = magic === 0x20b ? 112 : 96; // 64비트 / 32비트
  if (dd + 8 * 3 > optSize) throw new Error('리소스 없음');
  const resRva = opt.readUInt32LE(dd + 16);
  const resSize = opt.readUInt32LE(dd + 20);
  if (!resRva || !resSize) throw new Error('리소스 없음');
  const secs = readAt(fd, pe + 24 + optSize, nsec * 40);
  for (let i = 0; i < nsec; i++) {
    const vs = secs.readUInt32LE(i * 40 + 8);
    const va = secs.readUInt32LE(i * 40 + 12);
    const rs = secs.readUInt32LE(i * 40 + 16);
    const ro = secs.readUInt32LE(i * 40 + 20);
    if (resRva >= va && resRva < va + Math.max(vs, rs)) {
      const len = Math.min(Math.max(vs, rs), 64 * 1024 * 1024); // 리소스 영역(보통 수 MB 이하)
      const start = ro + (resRva - va);
      const avail = Math.min(len - (resRva - va), fs.fstatSync(fd).size - start);
      return { res: readAt(fd, start, avail), rva: resRva };
    }
  }
  throw new Error('리소스 영역 못 찾음');
}

// type → (id 또는 순번) → 첫 언어의 데이터 [시작, 길이] (res 기준)
function findData(r, type, pick) {
  const top = dirEntries(r.res, 0).find((e) => !e.isName && e.id === type && e.isDir);
  if (!top) return null;
  const items = dirEntries(r.res, top.off).filter((e) => e.isDir);
  const item = pick(items);
  if (!item) return null;
  const lang = dirEntries(r.res, item.off)[0];
  if (!lang || lang.isDir) return null;
  const dataRva = r.res.readUInt32LE(lang.off);
  const size = r.res.readUInt32LE(lang.off + 4);
  const at = dataRva - r.rva;
  if (at < 0 || at + size > r.res.length) return null;
  return r.res.subarray(at, at + size);
}

// index: 바로가기의 아이콘 번호. 0 이상 = 몇 번째 아이콘 묶음, 음수 = 그 번호(ID)의 아이콘 묶음
// want: 원하는 크기(px). 그보다 크거나 같은 것 중 가장 작은 것, 없으면 가장 큰 것
// 돌려줌: { png: Buffer } 또는 { ico: Buffer } 또는 null
function extract(file, index, want) {
  let fd = null;
  try {
    fd = fs.openSync(file, 'r');
    const r = readResources(fd);
    const idx = Number(index) || 0;
    const grp = findData(r, RT_GROUP_ICON, (items) => (idx >= 0 ? items[idx] : items.find((e) => e.id === -idx)));
    if (!grp || grp.length < 6) return null;
    const count = grp.readUInt16LE(4);
    const ents = [];
    for (let i = 0; i < count; i++) {
      const o = 6 + i * 14;
      if (o + 14 > grp.length) break;
      ents.push({ w: grp[o] || 256, h: grp[o + 1] || 256, colors: grp[o + 2], planes: grp.readUInt16LE(o + 4), bits: grp.readUInt16LE(o + 6), id: grp.readUInt16LE(o + 12) });
    }
    if (!ents.length) return null;
    ents.sort((a, c) => (a.w - c.w) || (c.bits - a.bits));
    const best = ents.find((e) => e.w >= want && e.bits >= 32) || ents.find((e) => e.w >= want)
      || ents.slice().sort((a, c) => (c.w - a.w) || (c.bits - a.bits))[0];
    const img = findData(r, RT_ICON, (items) => items.find((e) => e.id === best.id));
    if (!img || img.length < 8) return null;
    if (img.readUInt32BE(0) === 0x89504e47) return { png: Buffer.from(img) }; // PNG 로 들어 있음(256px 는 보통 이것)
    // 옛 방식(BMP) 그림 → 아이콘 파일(.ico) 모양으로 감싸서 돌려줌
    const head = Buffer.alloc(22);
    head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(1, 4);
    head[6] = best.w >= 256 ? 0 : best.w; head[7] = best.h >= 256 ? 0 : best.h; head[8] = best.colors; head[9] = 0;
    head.writeUInt16LE(best.planes || 1, 10); head.writeUInt16LE(best.bits || 32, 12);
    head.writeUInt32LE(img.length, 14); head.writeUInt32LE(22, 18);
    return { ico: Buffer.concat([head, img]) };
  } catch (e) {
    return null;
  } finally {
    if (fd != null) { try { fs.closeSync(fd); } catch (e) { /* 무시 */ } }
  }
}

// Electron 그림(nativeImage)으로. ICO 는 파일 경로로만 읽을 수 있어서 임시 폴더에 써서 읽음
function toImage(nativeImage, file, index, want) {
  const x = extract(file, index, want);
  if (!x) return null;
  try {
    if (x.png) {
      const im = nativeImage.createFromBuffer(x.png);
      return im && !im.isEmpty() ? im : null;
    }
    const dir = path.join(os.tmpdir(), 'memo-md-icons');
    fs.mkdirSync(dir, { recursive: true });
    const name = crypto.createHash('md5').update(x.ico).digest('hex') + '.ico';
    const p = path.join(dir, name);
    if (!fs.existsSync(p)) fs.writeFileSync(p, x.ico);
    const im = nativeImage.createFromPath(p);
    return im && !im.isEmpty() ? im : null;
  } catch (e) {
    return null;
  }
}

module.exports = { extract, toImage };
