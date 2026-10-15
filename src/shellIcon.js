// ============================================================
// (13차-3, 2026-10-14) 탐색기와 같은 방식(윈도우 셸 IShellItemImageFactory)으로 아이콘을 받는 "아이콘 도우미"
// - Electron 의 app.getFileIcon 은 엑셀·워드 등의 아이콘 도우미(icon handler)를 제대로 못 불러 빈 종이가 오는 경우가 있었음
//   → 윈도우에 기본으로 있는 PowerShell 을 하나 띄워 두고, 그 안에서 탐색기와 같은 윈도우 기능으로 아이콘을 받아 PNG 로 돌려받음
// - 별도 프로그램이라 메모앱 본체가 기다리며 멈추지 않음(예전 미리보기처럼 앱 전체가 굳는 일 없음)
// - 한 파일이 너무 오래 걸리면(box.shellIconTimeoutMs) 도우미를 껐다 다시 켜고, 그 확장자는 이번 실행 동안 옛 방식으로
// - 도우미가 아예 안 뜨는 컴퓨터(보안 정책 등)에서는 null → src/box.js 가 예전 방식으로 그림을 구함
// - 시험 결과(2026-10-14 icontest): 그림 줄이 아래→위로 들어 있어서 위아래를 뒤집어야 맞음
// ============================================================
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const readline = require('readline');

const CS = `
using System;
using System.IO;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
public static class MemoShellIcon {
  [StructLayout(LayoutKind.Sequential)] struct SIZE { public int cx; public int cy; }
  [ComImport, Guid("bcc18b79-ba16-442f-80c4-8a59c30c463b"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IShellItemImageFactory { [PreserveSig] int GetImage(SIZE size, int flags, out IntPtr phbm); }
  [DllImport("shell32.dll", CharSet = CharSet.Unicode, PreserveSig = false)]
  static extern void SHCreateItemFromParsingName(string path, IntPtr pbc, ref Guid riid,
    [MarshalAs(UnmanagedType.Interface)] out IShellItemImageFactory ppv);
  [StructLayout(LayoutKind.Sequential)]
  struct BITMAP { public int bmType; public int bmWidth; public int bmHeight; public int bmWidthBytes;
    public ushort bmPlanes; public ushort bmBitsPixel; public IntPtr bmBits; }
  [DllImport("gdi32.dll")] static extern int GetObject(IntPtr h, int c, ref BITMAP b);
  [DllImport("gdi32.dll")] static extern bool DeleteObject(IntPtr h);
  public static string Get(string path, int size, int flags) {
    Guid iid = new Guid("bcc18b79-ba16-442f-80c4-8a59c30c463b");
    IShellItemImageFactory f = null;
    IntPtr hbm = IntPtr.Zero;
    try {
      SHCreateItemFromParsingName(path, IntPtr.Zero, ref iid, out f);
      SIZE sz; sz.cx = size; sz.cy = size;
      if (f.GetImage(sz, flags, out hbm) != 0 || hbm == IntPtr.Zero) return null;
      BITMAP b = new BITMAP();
      GetObject(hbm, Marshal.SizeOf(b), ref b);
      if (b.bmBits == IntPtr.Zero || b.bmBitsPixel != 32) return null;
      int w = b.bmWidth, h = Math.Abs(b.bmHeight);
      using (Bitmap bmp = new Bitmap(w, h, PixelFormat.Format32bppPArgb)) {
        BitmapData d = bmp.LockBits(new Rectangle(0, 0, w, h), ImageLockMode.WriteOnly, PixelFormat.Format32bppPArgb);
        byte[] row = new byte[b.bmWidthBytes];
        for (int y = 0; y < h; y++) {
          Marshal.Copy(new IntPtr(b.bmBits.ToInt64() + (long)(h - 1 - y) * b.bmWidthBytes), row, 0, b.bmWidthBytes);
          Marshal.Copy(row, 0, new IntPtr(d.Scan0.ToInt64() + (long)y * d.Stride), Math.Min(d.Stride, b.bmWidthBytes));
        }
        bmp.UnlockBits(d);
        using (MemoryStream ms = new MemoryStream()) {
          bmp.Save(ms, ImageFormat.Png);
          return Convert.ToBase64String(ms.ToArray());
        }
      }
    } finally {
      if (hbm != IntPtr.Zero) DeleteObject(hbm);
      if (f != null) Marshal.ReleaseComObject(f);
    }
  }
}
`;
// PowerShell 쪽: 한 줄 받으면(번호, 크기, 방식, 경로[UTF-16 base64]) 한 줄 돌려줌(번호, OK + PNG base64 / NONE / ERR)
const PS = [
  "$ErrorActionPreference = 'Stop'",
  "$src = @'", CS, "'@",
  "try { Add-Type -TypeDefinition $src -ReferencedAssemblies System.Drawing } catch { [Console]::Out.WriteLine('FAIL ' + ($_.Exception.Message -replace '[\\r\\n]', ' ')); [Console]::Out.Flush(); exit 1 }",
  "[Console]::Out.WriteLine('READY'); [Console]::Out.Flush()",
  "while ($true) {",
  "  $line = [Console]::In.ReadLine()",
  "  if ($line -eq $null) { break }",
  "  $parts = $line.Split([char]9)",
  "  if ($parts.Length -lt 4) { continue }",
  "  $id = $parts[0]",
  "  try {",
  "    $p = [Text.Encoding]::Unicode.GetString([Convert]::FromBase64String($parts[3]))",
  "    $b64 = [MemoShellIcon]::Get($p, [int]$parts[1], [int]$parts[2])",
  "    if ($b64) { [Console]::Out.WriteLine($id + [char]9 + 'OK' + [char]9 + $b64) } else { [Console]::Out.WriteLine($id + [char]9 + 'NONE') }",
  "  } catch { [Console]::Out.WriteLine($id + [char]9 + 'ERR' + [char]9 + ($_.Exception.Message -replace '[\\r\\n\\t]', ' ')) }",
  "  [Console]::Out.Flush()",
  "}"
].join('\r\n');

const FLAG_BIGGER = 0x1;   // 원하는 크기보다 큰 그림도 됨
const FLAG_ICONONLY = 0x4; // 미리보기(그림 내용) 말고 아이콘만

let proc = null;
let ready = false;
let starting = null;
let disabled = false;
let failures = 0;
let seq = 0;
const waiting = new Map(); // 번호 -> { resolve, timer, ext }
let queue = Promise.resolve();
const slowExt = new Set(); // 너무 오래 걸렸던 확장자(이번 실행 동안 도우미 안 씀)
let opts = () => ({});
let nativeImageRef = null;
let logFn = () => {};

function scriptPath() {
  const p = path.join(os.tmpdir(), 'memo-md-shellicon-v1.ps1');
  try {
    const want = '﻿' + PS;
    let cur = null;
    try { cur = fs.readFileSync(p, 'utf8'); } catch (e) { /* 처음 */ }
    if (cur !== want) fs.writeFileSync(p, want, 'utf8');
  } catch (e) { return null; }
  return p;
}

function stop() {
  ready = false;
  starting = null;
  if (proc) { try { proc.kill(); } catch (e) { /* 무시 */ } }
  proc = null;
  waiting.forEach((w) => { clearTimeout(w.timer); w.resolve(null); });
  waiting.clear();
}

function start() {
  if (disabled) return Promise.resolve(false);
  if (ready && proc) return Promise.resolve(true);
  if (starting) return starting;
  starting = new Promise((resolve) => {
    const sp = scriptPath();
    if (!sp) { disabled = true; resolve(false); return; }
    let p;
    try {
      p = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-STA', '-File', sp],
        { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
    } catch (e) { failures++; if (failures >= 3) disabled = true; resolve(false); return; }
    proc = p;
    const startTimer = setTimeout(() => { logFn('도우미 시작 시간 초과'); failures++; if (failures >= 3) disabled = true; stop(); resolve(false); }, 20000);
    const rl = readline.createInterface({ input: p.stdout });
    rl.on('line', (line) => {
      if (!ready) {
        if (line === 'READY') { ready = true; clearTimeout(startTimer); resolve(true); }
        else if (line.startsWith('FAIL')) { clearTimeout(startTimer); logFn('도우미 준비 실패: ' + line); disabled = true; stop(); resolve(false); }
        return;
      }
      const tab = line.indexOf('\t');
      if (tab < 0) return;
      const id = line.slice(0, tab);
      const w = waiting.get(id);
      if (!w) return;
      waiting.delete(id);
      clearTimeout(w.timer);
      const rest = line.slice(tab + 1);
      if (rest.startsWith('OK\t')) {
        try {
          const im = nativeImageRef.createFromBuffer(Buffer.from(rest.slice(3), 'base64'));
          w.resolve(im && !im.isEmpty() ? im : null);
        } catch (e) { w.resolve(null); }
      } else {
        if (rest.startsWith('ERR')) logFn(w.ext + ' 도우미 오류: ' + rest.slice(4));
        w.resolve(null);
      }
    });
    p.on('error', () => { clearTimeout(startTimer); failures++; if (failures >= 3) disabled = true; stop(); resolve(false); });
    p.on('exit', () => { clearTimeout(startTimer); if (proc === p) stop(); resolve(false); });
  });
  return starting;
}

function num(v, def, min, max) {
  const n = Number(v);
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, n));
}

// 한 번에 하나씩(도우미는 하나라서). 실패하면 null
function request(file, size, iconOnly) {
  const ext = path.extname(file).toLowerCase();
  const job = async () => {
    if (disabled || slowExt.has(ext)) return null;
    const ok = await start();
    if (!ok || !proc) return null;
    const id = String(++seq);
    const timeoutMs = num(opts().shellIconTimeoutMs, 8000, 1000, 120000);
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        // 너무 오래 걸림(무거운 미리보기 등) → 도우미를 다시 시작하고, 이 확장자는 이번 실행 동안 옛 방식으로
        waiting.delete(id);
        slowExt.add(ext);
        logFn(ext + ' 도우미 시간 초과(' + timeoutMs + 'ms) → 이번 실행 동안 옛 방식');
        stop();
        resolve(null);
      }, timeoutMs);
      waiting.set(id, { resolve, timer, ext });
      const b64 = Buffer.from(file, 'utf16le').toString('base64');
      const flags = FLAG_BIGGER | (iconOnly ? FLAG_ICONONLY : 0);
      try { proc.stdin.write(id + '\t' + Math.round(size) + '\t' + flags + '\t' + b64 + '\n'); } catch (e) { clearTimeout(timer); waiting.delete(id); resolve(null); }
    });
  };
  const pr = queue.then(job, job);
  queue = pr.catch(() => null);
  return pr;
}

module.exports = {
  init(o) {
    nativeImageRef = o.nativeImage;
    if (o.opts) opts = o.opts;
    if (o.log) logFn = o.log;
  },
  enabled() { return process.platform === 'win32' && !disabled && opts().shellIcon !== false; },
  get: request,
  stop,
  _script: PS // 시험용(icontest)
};
