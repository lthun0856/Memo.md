// ============================================================
// (11차, 2026-10-13) 바로가기(.lnk) 파일을 앱이 직접 읽음 — 읽기만, 파일은 절대 안 고침
// 왜: Electron 의 shell.readShortcutLink 는 바로가기 안의 "앱 이름표(AppUserModelID)"가
//     특정 형식(VT_BSTR)으로 적혀 있으면 통째로 실패함. Tauri 로 만든 앱(ArtCraft, HOP 등) 설치 프로그램이
//     이 형식으로 바로가기를 만들어서, 대상도 아이콘도 못 찾고 흰 종이 그림이 나왔음
// 돌려줌: { iconLocation, iconIndex, targets:[가능한 대상 경로들], relPath, workDir } 또는 null
// 형식 근거: 마이크로소프트 [MS-SHLLINK] 문서
// ============================================================
'use strict';
const fs = require('fs');
const path = require('path').win32; // 바로가기는 윈도우 경로만 다룸

const MAX_SIZE = 1024 * 1024; // 바로가기는 보통 수 KB. 이보다 크면 안 읽음

// %ProgramFiles% 같은 환경변수를 실제 경로로
function expandEnv(p) {
  return String(p || '').trim().replace(/^"|"$/g, '').replace(/%([^%]+)%/g, (m, n) => (process.env[n] != null ? process.env[n] : m));
}

// 옛 방식(ANSI) 글자 → 한글 윈도우 기준(cp949)으로 풀기. 못 풀면 영문만 살림
let ansiDecoder = null;
function decodeAnsi(buf) {
  if (ansiDecoder === null) {
    try { ansiDecoder = new TextDecoder('euc-kr'); } catch (e) { ansiDecoder = false; }
  }
  if (ansiDecoder) { try { return ansiDecoder.decode(buf); } catch (e) { /* 아래 */ } }
  return buf.toString('latin1');
}
function zstrAnsi(b, o) {
  if (o < 0 || o >= b.length) return '';
  let e = o;
  while (e < b.length && b[e] !== 0) e++;
  return decodeAnsi(b.subarray(o, e));
}
function zstrUni(b, o) {
  if (o < 0 || o >= b.length) return '';
  let e = o;
  while (e + 1 < b.length && (b[e] !== 0 || b[e + 1] !== 0)) e += 2;
  return b.subarray(o, e).toString('utf16le');
}

// baseDirs: 상대 경로(..\AppData\…)를 풀어 볼 추가 기준 폴더들(예: 바탕화면 — 원래 바로가기가 있던 곳)
function parse(file, baseDirs) {
  let b;
  try {
    const st = fs.statSync(file);
    if (!st.isFile() || st.size < 0x4c || st.size > MAX_SIZE) return null;
    b = fs.readFileSync(file);
  } catch (e) { return null; }
  try {
    if (b.readUInt32LE(0) !== 0x4c) return null; // 바로가기 파일 표시
    const flags = b.readUInt32LE(0x14);
    const iconIndex = b.readInt32LE(0x38);
    const uni = !!(flags & 0x80);
    let o = 0x4c;
    if (flags & 0x01) o += 2 + b.readUInt16LE(o); // 대상 위치 목록(IDList) — 건너뜀
    let basePath = '';
    if (flags & 0x02) { // 대상 위치 정보(LinkInfo)
      const size = b.readUInt32LE(o);
      const li = b.subarray(o, o + size);
      const hsize = li.readUInt32LE(4);
      const lflags = li.readUInt32LE(8);
      if (lflags & 0x01) {
        let lbp = '';
        let suffix = '';
        if (hsize >= 0x24) { // 유니코드 경로가 있으면 그걸 씀
          lbp = zstrUni(li, li.readUInt32LE(0x1c));
          suffix = zstrUni(li, li.readUInt32LE(0x20));
        }
        if (!lbp) lbp = zstrAnsi(li, li.readUInt32LE(0x10));
        if (!suffix) suffix = zstrAnsi(li, li.readUInt32LE(0x18));
        basePath = suffix ? path.join(lbp, suffix) : lbp;
      }
      o += size;
    }
    const readStr = () => {
      const n = b.readUInt16LE(o);
      const len = uni ? n * 2 : n;
      const s = uni ? b.subarray(o + 2, o + 2 + len).toString('utf16le') : decodeAnsi(b.subarray(o + 2, o + 2 + len));
      o += 2 + len;
      return s;
    };
    const out = { name: '', relPath: '', workDir: '', args: '', iconLocation: '' };
    if (flags & 0x04) out.name = readStr();
    if (flags & 0x08) out.relPath = readStr();
    if (flags & 0x10) out.workDir = readStr();
    if (flags & 0x20) out.args = readStr();
    if (flags & 0x40) out.iconLocation = readStr();
    // 덧붙은 정보 블록: 환경변수로 적힌 대상(0xA0000001), 환경변수로 적힌 아이콘(0xA0000007)
    let envTarget = '';
    let envIcon = '';
    while (o + 8 <= b.length) {
      const sz = b.readUInt32LE(o);
      if (sz < 8 || o + sz > b.length) break;
      const sig = b.readUInt32LE(o + 4);
      if ((sig === 0xa0000001 || sig === 0xa0000007) && sz >= 788) {
        const u = zstrUni(b.subarray(o + 268, o + 788), 0);
        const a = zstrAnsi(b.subarray(o + 8, o + 268), 0);
        if (sig === 0xa0000001) envTarget = u || a;
        else envIcon = u || a;
      }
      o += sz;
    }
    // 대상 후보(앞에 있을수록 먼저 시도). 실제 있는지는 부르는 쪽이 확인
    const dir = path.dirname(file);
    const targets = [];
    const add = (p) => { const x = expandEnv(p); if (x && !targets.includes(x)) targets.push(x); };
    add(basePath);
    add(envTarget);
    if (out.relPath) {
      add(path.resolve(dir, expandEnv(out.relPath)));
      (Array.isArray(baseDirs) ? baseDirs : []).forEach((d) => { if (d) add(path.resolve(d, expandEnv(out.relPath))); });
      if (out.workDir) add(path.join(expandEnv(out.workDir), path.basename(out.relPath)));
    }
    return {
      iconLocation: expandEnv(envIcon || out.iconLocation),
      iconIndex,
      targets,
      relPath: out.relPath,
      workDir: expandEnv(out.workDir)
    };
  } catch (e) {
    return null;
  }
}

module.exports = { parse, expandEnv };
