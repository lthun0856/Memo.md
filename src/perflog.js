// (2026-10-14) 버벅임 측정용 기록 — 앱이 켜져 있는 동안 1분마다 아래를 남김
//  - 앱 본체(메인)가 1분 동안 가장 길게 멈춘 시간
//  - 창별 CPU·메모리
//  - 박스가 반복하는 일 횟수(목록 다시 읽기, 폴더 변경 감지 등)
// 결과 파일: (앱 데이터 폴더)/perf-log.txt — 최신이 위, 최근 120분치만 보관
// 원인을 찾고 나면 지워도 되는 진단용. 여기서 나는 오류는 전부 무시(앱 동작엔 영향 없음)
const fs = require('fs');
const path = require('path');

const counters = new Map(); // 이름 -> { n, ms, bytes, maxMs }
let maxLag = 0;
let lagOver100 = 0;
let started = false;

function add(name, ms, bytes) {
  try {
    let c = counters.get(name);
    if (!c) { c = { n: 0, ms: 0, bytes: 0, maxMs: 0 }; counters.set(name, c); }
    c.n++;
    if (ms) { c.ms += ms; if (ms > c.maxMs) c.maxMs = ms; }
    if (bytes) c.bytes += bytes;
  } catch (e) { /* 무시 */ }
}

function windowName(url, title) {
  const u = String(url || '');
  const m = u.match(/renderer[\\/]+([^\\/]+)[\\/]/);
  const kind = m ? m[1] : (u ? 'etc' : '?');
  const names = { widget: '위젯', memo: '메모창', calendar: '달력', box: '박스', settings: '설정', calSettings: '달력설정', help: '도움말', search: '검색', welcome: '웰컴', memoLink: '메모링크', moveTopic: '주제이동' };
  return (names[kind] || kind) + (title && kind === 'box' ? '(' + title + ')' : '');
}

function snapshot(electron) {
  const { app, webContents } = electron;
  const lines = [];
  const t = new Date();
  lines.push('===== ' + t.toLocaleString('ko-KR') + ' =====');
  lines.push('앱 본체 가장 길게 멈춤: ' + maxLag + 'ms  (0.1초 넘게 멈춘 횟수 ' + lagOver100 + '번)');
  try {
    const pidName = new Map();
    webContents.getAllWebContents().forEach((wc) => {
      try { pidName.set(wc.getOSProcessId(), windowName(wc.getURL(), wc.getTitle())); } catch (e) { /* 무시 */ }
    });
    const rows = app.getAppMetrics().map((m) => {
      const name = m.type === 'Browser' ? '앱 본체' : (pidName.get(m.pid) || m.type);
      return { name, cpu: m.cpu ? m.cpu.percentCPUUsage : 0, mem: m.memory ? m.memory.workingSetSize : 0 };
    }).sort((a, b) => b.cpu - a.cpu);
    const totalCpu = rows.reduce((s, r) => s + r.cpu, 0);
    const totalMem = rows.reduce((s, r) => s + r.mem, 0);
    lines.push('전체 CPU ' + totalCpu.toFixed(1) + '%  메모리 ' + Math.round(totalMem / 1024) + 'MB');
    rows.slice(0, 8).forEach((r) => lines.push('  ' + r.name + ': CPU ' + r.cpu.toFixed(1) + '%, 메모리 ' + Math.round(r.mem / 1024) + 'MB'));
  } catch (e) { lines.push('  (창별 사용량 못 구함)'); }
  if (counters.size) {
    lines.push('지난 1분 박스 작업:');
    [...counters.entries()].sort((a, b) => b[1].ms - a[1].ms || b[1].n - a[1].n).forEach(([k, c]) => {
      let s = '  ' + k + ': ' + c.n + '번';
      if (c.ms) s += ', 합계 ' + Math.round(c.ms) + 'ms(가장 긴 것 ' + Math.round(c.maxMs) + 'ms)';
      if (c.bytes) s += ', 보낸 양 ' + (c.bytes / 1024 / 1024).toFixed(1) + 'MB';
      lines.push(s);
    });
  } else lines.push('지난 1분 박스 작업: 없음');
  counters.clear(); maxLag = 0; lagOver100 = 0;
  return lines.join('\r\n') + '\r\n\r\n';
}

function start(electron, userDataDir, everyMs) {
  if (started) return; started = true;
  const file = path.join(userDataDir, 'perf-log.txt');
  try { fs.writeFileSync(file, '', 'utf8'); } catch (e) { /* 무시 */ } // 앱 켤 때마다 새로 시작
  // 멈춤 재기: 0.25초마다 깨어나서, 늦게 깨어난 만큼 = 앱 본체가 바빠서 멈춰 있던 시간
  const STEP = 250;
  let last = Date.now();
  setInterval(() => {
    const now = Date.now();
    const lag = Math.max(0, now - last - STEP);
    last = now;
    if (lag > maxLag) maxLag = lag;
    if (lag > 100) lagOver100++;
  }, STEP);
  const blocks = [];
  setInterval(() => {
    try {
      blocks.unshift(snapshot(electron));
      if (blocks.length > 120) blocks.length = 120;
      fs.writeFileSync(file, blocks.join(''), 'utf8');
    } catch (e) { /* 무시 */ }
  }, everyMs || 60 * 1000);
}

module.exports = { add, start };
