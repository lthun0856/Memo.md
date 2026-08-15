// 앱 전체 글씨체 적용기 (모든 창이 공통으로 불러 씀)
//
// 하는 일: 설정(settings.fontFamily)에 저장된 글씨체 이름을 읽어서 --app-font 라는 css 변수에
// 넣어줌. 각 창의 css는 font-family를 var(--app-font, 원래글씨체) 로 적어놨기 때문에,
// 이 변수만 바꾸면 그 창의 글씨체가 통째로 바뀜. 설정이 비어있으면 변수를 안 넣고
// 원래(기본) 글씨체가 그대로 쓰임 — 즉 글씨체를 안 고른 사용자는 지금까지와 100% 동일.
//
// 실패해도 절대 창이 안 뜨거나 멈추면 안 되므로, 어떤 오류가 나도 조용히 넘어가고
// 기본 글씨체로 그냥 동작함(이 앱의 기존 원칙과 동일).
(function () {
  var FALLBACK = '-apple-system, "Malgun Gothic", "Noto Sans KR", sans-serif';

  function applyAppFont(fontName) {
    var root = document.documentElement;
    var name = (fontName || '').trim();
    if (!name) {
      root.style.removeProperty('--app-font');
      return;
    }
    // 글씨체 이름에 따옴표가 섞여 들어오면 css가 깨지므로 제거하고 우리가 다시 감쌈
    name = name.replace(/["']/g, '');
    root.style.setProperty('--app-font', '"' + name + '", ' + FALLBACK);
  }

  function loadAndApply() {
    try {
      if (!window.api || typeof window.api.getSettings !== 'function') return;
      Promise.resolve(window.api.getSettings())
        .then(function (s) { applyAppFont(s && s.fontFamily); })
        .catch(function () { /* 설정을 못 읽어도 기본 글씨체로 그냥 동작 */ });
    } catch (err) {
      /* 무시 */
    }
  }

  window.applyAppFont = applyAppFont; // 설정창에서 미리보기용으로 직접 부를 수 있게 열어둠
  loadAndApply();

  // 설정에서 글씨체를 바꾸면 열려있는 창들도 다시 켜지 않고 바로 반영됨
  try {
    if (window.api && typeof window.api.onSettingsUpdated === 'function') {
      window.api.onSettingsUpdated(loadAndApply);
    }
  } catch (err) {
    /* 무시 */
  }
})();
