// (2026-10-13) 시작 속도 측정용 기록 — 앱이 켜질 때 단계별로 몇 초 걸렸는지 남김
// 결과 파일: (앱 데이터 폴더)/startup-log.txt  — 최근 기록이 위에 쌓임(최대 20회분)
// 원인을 찾고 나면 지워도 되는 진단용. 여기서 나는 오류는 전부 무시(앱 동작엔 영향 없음)
const fs = require('fs');
const path = require('path');
const os = require('os');

const T0 = Date.now();
const procAgeMs = Math.round(process.uptime() * 1000); // 프로그램이 실행된 뒤 이 파일까지 오는 데 걸린 시간
const bootAgeSec = Math.round(os.uptime());            // 윈도우가 켜진 지 몇 초 뒤에 앱이 실행됐는지
const marks = [];
const icon = { count: 0, totalMs: 0, slowMs: 0, slowFile: '', firstAt: 0, lastAt: 0 };
let written = false;

function now() { return Date.now() - T0; }
function mark(label) { try { marks.push([now(), label]); } catch (e) { /* 무시 */ } }
function iconDone(file, ms) {
  try {
    const t = now();
    if (!icon.count) icon.firstAt = Math.max(0, t - ms);
    icon.count++; icon.totalMs += ms; icon.lastAt = t;
    if (ms > icon.slowMs) { icon.slowMs = ms; icon.slowFile = path.basename(file); }
  } catch (e) { /* 무시 */ }
}
function sec(ms) { return (ms / 1000).toFixed(2) + '초'; }

function write(userDataDir) {
  if (written) return; written = true;
  try {
    const lines = [];
    lines.push('===== ' + new Date(T0).toLocaleString('ko-KR') + ' =====');
    lines.push('윈도우 켜진 뒤 앱 실행까지: ' + bootAgeSec + '초' + (bootAgeSec < 300 ? '  (재부팅 직후 실행)' : '  (평소 실행)'));
    lines.push('프로그램 기본 로딩(Electron 자체): ' + sec(procAgeMs));
    marks.forEach(([t, label]) => lines.push('  ' + sec(t).padStart(9) + '  ' + label));
    if (icon.count) {
      lines.push('  아이콘 ' + icon.count + '개 만들기: ' + sec(icon.firstAt) + ' ~ ' + sec(icon.lastAt)
        + ' (합계 ' + sec(icon.totalMs) + ', 가장 느린 것 ' + icon.slowFile + ' ' + sec(icon.slowMs) + ')');
    }
    const file = path.join(userDataDir, 'startup-log.txt');
    let old = '';
    try { old = fs.readFileSync(file, 'utf8'); } catch (e) { /* 처음 */ }
    const runs = old.split(/(?=^===== )/m).filter((s) => s.trim()).slice(0, 19);
    fs.writeFileSync(file, lines.join('\r\n') + '\r\n\r\n' + runs.join(''), 'utf8');
  } catch (e) { /* 무시 */ }
}

module.exports = { mark, iconDone, write, now };
