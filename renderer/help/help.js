// 도움말 왼쪽 메뉴 (0.23.0)
// 메뉴를 누르면 오른쪽에 그 페이지만 보여줌. 주소 끝 #이름(예: #calendar)으로 바로 열 수 있고,
// 본문 안의 <a class="go" href="#이름"> 바로가기도 같은 방식으로 페이지를 바꿈.
(function () {
  var pages = Array.prototype.slice.call(document.querySelectorAll('.page'));
  var btns = Array.prototype.slice.call(document.querySelectorAll('.nav-btn'));
  var scroller = document.getElementById('mainScroll');
  var names = pages.map(function (p) { return p.getAttribute('data-page'); });

  function show(name) {
    if (names.indexOf(name) < 0) name = names[0];
    pages.forEach(function (p) { p.classList.toggle('active', p.getAttribute('data-page') === name); });
    btns.forEach(function (b) { b.classList.toggle('active', b.getAttribute('data-page') === name); });
    if (scroller) scroller.scrollTop = 0;
  }

  btns.forEach(function (b) {
    b.addEventListener('click', function () {
      var name = b.getAttribute('data-page');
      try { history.replaceState(null, '', '#' + name); } catch (e) { /* 무시 */ }
      show(name);
    });
  });
  // 본문 속 바로가기 링크(#이름)
  document.addEventListener('click', function (e) {
    var a = e.target.closest ? e.target.closest('a.go') : null;
    if (!a) return;
    var name = (a.getAttribute('href') || '').replace('#', '');
    if (names.indexOf(name) < 0) return;
    e.preventDefault();
    try { history.replaceState(null, '', '#' + name); } catch (err) { /* 무시 */ }
    show(name);
  });
  window.addEventListener('hashchange', function () { show(location.hash.replace('#', '')); });

  show((location.hash || '').replace('#', ''));
})();
