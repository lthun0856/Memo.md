const pages = Array.from(document.querySelectorAll('.page'));
const dotsWrap = document.getElementById('dots');
const btnPrev = document.getElementById('btnPrev');
const btnNext = document.getElementById('btnNext');
const btnMdOn = document.getElementById('btnMdOn');
const btnMdOff = document.getElementById('btnMdOff');

// MD 기능 사용 여부를 묻는 페이지의 위치(어떤 페이지에 .welcome-choice가 들어있는지로 찾음).
// 이 페이지에서 버튼을 직접 눌러 선택하기 전까지는(mdChoiceMade가 true가 되기 전까지는)
// "다음"/점(dot) 클릭으로 이 페이지를 건너뛸 수 없게 막음
const mdQuestionIndex = pages.findIndex((p) => p.querySelector('.welcome-choice'));
let mdChoiceMade = false;

// 현재 설정값으로 선택 표시를 미리 맞춰두는 용도(자동으로 맞춰두는 것 자체는 "선택함"으로 안 침 —
// 실제로 버튼을 눌러야만 mdChoiceMade가 true가 됨)
function markMdChoice(enabled) {
  btnMdOn.classList.toggle('selected', enabled);
  btnMdOff.classList.toggle('selected', !enabled);
}
if (window.api && btnMdOn && btnMdOff) {
  window.api.getSettings().then((settings) => {
    markMdChoice(settings.mdFeatureEnabled !== false);
  });
  btnMdOn.addEventListener('click', async () => {
    markMdChoice(true);
    mdChoiceMade = true;
    await window.api.saveSettings({ mdFeatureEnabled: true });
    goTo(current + 1);
  });
  btnMdOff.addEventListener('click', async () => {
    markMdChoice(false);
    mdChoiceMade = true;
    await window.api.saveSettings({ mdFeatureEnabled: false });
    goTo(current + 1);
  });
}

function applyLang() {
  const L = LANG.welcome;
  document.title = L.windowTitle;

  document.getElementById('p0Title').innerHTML = L.page0.title;
  document.getElementById('p0Desc').innerHTML = L.page0.desc;

  document.getElementById('p1MockWidgetTitle').textContent = L.page1.mockWidgetTitle;
  document.getElementById('p1MockTopic1').textContent = L.page1.mockTopic1;
  document.getElementById('p1MockTopic2').textContent = L.page1.mockTopic2;
  document.getElementById('p1MockTopic3').textContent = L.page1.mockTopic3;
  document.getElementById('p1MockList1').textContent = L.page1.mockListItem1;
  document.getElementById('p1MockList2').textContent = L.page1.mockListItem2;
  document.getElementById('p1Title').innerHTML = L.page1.title;
  document.getElementById('p1Desc').innerHTML = L.page1.desc;
  document.getElementById('p1Note').innerHTML = L.page1.note;

  document.getElementById('p2MockChip').textContent = L.page2.mockChip;
  document.getElementById('p2MockMemoTitle').textContent = L.page2.mockMemoTitle;
  document.getElementById('p2Check1').textContent = L.page2.checklistItem1;
  document.getElementById('p2Check2').textContent = L.page2.checklistItem2;
  document.getElementById('p2Title').innerHTML = L.page2.title;
  document.getElementById('p2Desc').innerHTML = L.page2.desc;

  document.getElementById('p3MockFilename').textContent = L.page3.mockFilename;
  document.getElementById('p3MockExportBtn').textContent = L.page3.mockExportBtn;
  document.getElementById('p3Title').innerHTML = L.page3.title;
  document.getElementById('p3Desc').innerHTML = L.page3.desc;

  document.getElementById('p4Title').innerHTML = L.page4.title;
  document.getElementById('p4Desc').innerHTML = L.page4.desc;
  btnMdOn.textContent = L.page4.btnOn;
  btnMdOff.textContent = L.page4.btnOff;

  document.getElementById('p5Title').innerHTML = L.page5.title;
  document.getElementById('p5Desc').innerHTML = L.page5.desc;

  btnPrev.textContent = L.navPrev;
  btnNext.textContent = L.navNext;
}
applyLang();

let current = 0;

// 페이지 수만큼 점(dot) 표시를 만들어둠 — 클릭하면 그 페이지로 바로 이동
pages.forEach((_, i) => {
  const dot = document.createElement('span');
  dot.className = 'dot';
  dot.addEventListener('click', () => goTo(i));
  dotsWrap.appendChild(dot);
});
const dots = Array.from(dotsWrap.querySelectorAll('.dot'));

function render() {
  pages.forEach((p, i) => p.classList.toggle('active', i === current));
  dots.forEach((d, i) => d.classList.toggle('active', i === current));
  btnPrev.disabled = current === 0;
  btnNext.textContent = current === pages.length - 1 ? LANG.welcome.navStart : LANG.welcome.navNext;
  btnNext.disabled = mdQuestionIndex !== -1 && current === mdQuestionIndex && !mdChoiceMade;
}

function goTo(index) {
  let target = Math.max(0, Math.min(pages.length - 1, index));
  // MD 질문 페이지에서 아직 선택을 안 했으면, 그 뒤 페이지로는(점 클릭으로도) 못 넘어가게 막음
  if (mdQuestionIndex !== -1 && !mdChoiceMade && target > mdQuestionIndex) {
    target = mdQuestionIndex;
  }
  current = target;
  render();
}

btnPrev.addEventListener('click', () => goTo(current - 1));

btnNext.addEventListener('click', () => {
  if (current === pages.length - 1) {
    window.close(); // 마지막 페이지에서는 창을 닫음(메인 프로세스가 "봤음" 상태로 저장함)
  } else {
    goTo(current + 1);
  }
});

render();
