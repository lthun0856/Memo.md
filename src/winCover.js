// ============================================================
// (2026-10-15) "정리함이 다른 창에 가려져 있나?" 확인 도우미
// - 숨은 정리함은 마우스를 통과시키면서도 "마우스 올라옴" 신호를 받는데(setIgnoreMouseEvents forward),
//   윈도우는 이 신호를 가려졌는지 따지지 않고 보냄 → 다른 창 위에서 마우스를 움직이면 아래 숨은 정리함이 튀어나왔음
// - 그래서 마우스 자리에서 정리함보다 "위에 있는" 보이는 창이 있는지 윈도우(user32/dwmapi)에 직접 물어봄
// - koffi(작은 부품)로 윈도우 기능을 부름. 부품을 못 불러오거나 오류가 나면 false(= 안 가려짐, 예전과 같은 동작)
// ============================================================
'use strict';

let api = null;      // 불러온 윈도우 기능들
let failed = false;  // 한 번 실패하면 다시 시도 안 함(매번 느려지지 않게)

const GW_HWNDPREV = 3;            // 바로 위(앞) 창
const GWL_EXSTYLE = -20;
const WS_EX_TRANSPARENT = 0x20;   // 마우스가 통과하는 창(숨은 정리함, 화면 위 효과 창 등) → 가리는 창으로 안 침
const DWMWA_EXTENDED_FRAME_BOUNDS = 9; // 눈에 보이는 창 테두리(보이지 않는 크기조절 여백 제외)
const DWMWA_CLOAKED = 14;         // 다른 가상 데스크톱·숨겨진 앱 창

function load() {
  if (api || failed) return api;
  if (process.platform !== 'win32') { failed = true; return null; }
  try {
    const koffi = require('koffi');
    const user32 = koffi.load('user32.dll');
    const dwm = koffi.load('dwmapi.dll');
    const POINT = koffi.struct('WC_POINT', { x: 'int32_t', y: 'int32_t' });
    const RECT = koffi.struct('WC_RECT', { left: 'int32_t', top: 'int32_t', right: 'int32_t', bottom: 'int32_t' });
    api = {
      GetCursorPos: user32.func('__stdcall', 'GetCursorPos', 'int', [koffi.out(koffi.pointer(POINT))]),
      GetWindow: user32.func('__stdcall', 'GetWindow', 'uintptr_t', ['uintptr_t', 'uint32_t']),
      IsWindowVisible: user32.func('__stdcall', 'IsWindowVisible', 'int', ['uintptr_t']),
      IsIconic: user32.func('__stdcall', 'IsIconic', 'int', ['uintptr_t']),
      GetWindowRect: user32.func('__stdcall', 'GetWindowRect', 'int', ['uintptr_t', koffi.out(koffi.pointer(RECT))]),
      GetWindowLongPtrW: user32.func('__stdcall', 'GetWindowLongPtrW', 'intptr_t', ['uintptr_t', 'int']),
      DwmRect: dwm.func('__stdcall', 'DwmGetWindowAttribute', 'int32_t', ['uintptr_t', 'uint32_t', koffi.out(koffi.pointer(RECT)), 'uint32_t']),
      DwmInt: dwm.func('__stdcall', 'DwmGetWindowAttribute', 'int32_t', ['uintptr_t', 'uint32_t', koffi.out(koffi.pointer('int32_t')), 'uint32_t'])
    };
  } catch (e) {
    failed = true;
    api = null;
  }
  return api;
}

function hwndOf(win) {
  const b = win.getNativeWindowHandle();
  return b.length >= 8 ? Number(b.readBigUInt64LE(0)) : b.readUInt32LE(0);
}

function rectOf(a, h) {
  const r = {};
  if (a.DwmRect(h, DWMWA_EXTENDED_FRAME_BOUNDS, r, 16) === 0 && r.right > r.left) return r;
  const r2 = {};
  return a.GetWindowRect(h, r2) ? r2 : null;
}

// 마우스 자리에서 win 보다 위에 있는 보이는 창이 있으면 true
// maxWalk: 위로 몇 개 창까지 살펴볼지(settings.json box.coverMaxWalk)
function isCovered(win, maxWalk) {
  try {
    if (!win || win.isDestroyed()) return false;
    const a = load();
    if (!a) return false;
    const p = {};
    if (!a.GetCursorPos(p)) return false;
    let h = hwndOf(win);
    const limit = Math.max(10, Number(maxWalk) || 3000);
    for (let i = 0; i < limit; i++) {
      h = a.GetWindow(h, GW_HWNDPREV);
      if (!h) return false; // 맨 위까지 봤는데 가리는 창 없음
      if (!a.IsWindowVisible(h) || a.IsIconic(h)) continue;
      const ex = Number(BigInt.asUintN(32, BigInt(a.GetWindowLongPtrW(h, GWL_EXSTYLE))));
      if (ex & WS_EX_TRANSPARENT) continue;
      const c = [0];
      if (a.DwmInt(h, DWMWA_CLOAKED, c, 4) === 0 && c[0]) continue;
      const r = rectOf(a, h);
      if (!r || r.right <= r.left || r.bottom <= r.top) continue;
      if (p.x >= r.left && p.x < r.right && p.y >= r.top && p.y < r.bottom) return true;
    }
    return false;
  } catch (e) {
    return false;
  }
}

module.exports = { isCovered };
