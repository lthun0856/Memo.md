/* ============================================================================
   mdeditor.js — 본문 실시간 서식 편집기 (위지윅 1단계, 2026-08-14)

   [무엇을 하는 파일인가]
   원래 본문은 <textarea> 라서 글자만 담겼고 서식은 `**굵게**` 처럼 기호가 그대로
   보였음. 이 파일은 <div contenteditable> 을 textarea 처럼 쓸 수 있게 감싸주는
   껍데기(Proxy)를 만들어서, memo.js 의 기존 코드(.value / .selectionStart /
   .setRangeText ...)를 한 줄도 안 고치고 그대로 쓰면서 화면에만 서식을 그려줌.

   [가장 중요한 원칙]
   - 저장되는 값은 언제나 "마크다운 원문 그대로"다. 화면에 굵게 보여도 실제 내용은
     `**굵게**` 문자열이다. 기호(마커)는 지우는 게 아니라 CSS로 숨길 뿐이라서,
     화면 → 마크다운 되읽기는 그냥 textContent 를 읽는 것과 같다. 변환 실패로
     내용이 날아갈 수 있는 구조 자체를 만들지 않았음.
   - 커서가 있는 줄(.cur)은 기호를 다시 보여준다(옵시디언 방식). 그래야 그 줄을
     고칠 때 기호가 어디 있는지 알 수 있고, 커서가 숨은 기호 속으로 들어가서
     사라지는 문제도 안 생김.

   [주의]
   - 한글 입력(IME) 중에는 절대 다시 그리지 않는다(조합이 깨짐).
   - DOM을 다시 만들면 브라우저 기본 실행취소가 깨지므로 자체 실행취소를 넣었음.
   ========================================================================== */
(function (global) {
  'use strict';

  var BLOCK_TAGS = /^(DIV|P|H[1-6]|LI|UL|OL|BLOCKQUOTE|PRE|SECTION|ARTICLE|TABLE|TR)$/;

  /* ------------------------------------------------------------------
     1. DOM → 마크다운 문자열 (되읽기)
     어떤 모양의 DOM이든(브라우저가 제멋대로 만든 구조 포함) 안전하게 글자로 바꿈.
     marks 로 커서 위치도 같이 계산해서 다시 그린 뒤 커서를 제자리에 돌려놓음.
     ------------------------------------------------------------------ */
  function serialize(root, marks) {
    marks = marks || [];
    var text = '';
    var pos = marks.map(function () { return -1; });
    var emitted = false;

    function markElem(node, offset) {
      for (var i = 0; i < marks.length; i++) {
        var m = marks[i];
        if (pos[i] === -1 && m && m.node === node && m.offset === offset) pos[i] = text.length;
      }
    }

    function visit(node) {
      if (node.nodeType === 3) {
        var d = node.data;
        for (var i = 0; i < marks.length; i++) {
          var m = marks[i];
          if (pos[i] === -1 && m && m.node === node) {
            pos[i] = text.length + Math.min(m.offset, d.length);
          }
        }
        if (d) { text += d; emitted = true; }
        return;
      }
      if (node.nodeType !== 1) return;

      var tag = node.tagName;
      if (tag === 'BR') {
        // 줄 맨 끝의 <br>은 빈 줄을 유지하려고 브라우저가 넣는 자리채움이라 글자로 세지 않음
        if (node.parentNode && node.parentNode.lastChild === node) return;
        text += '\n';
        emitted = true;
        return;
      }
      // INPUT = 체크리스트 체크박스. 글자가 아니라 그림이므로 마크다운에 포함하지 않음
      // (체크 상태는 줄 앞의 "- [ ] / - [x]" 글자가 가지고 있음)
      if (tag === 'IMG' || tag === 'HR' || tag === 'INPUT') return;
      // md-skip = 글자가 아니라 "그림으로만 얹은 부품"(3단계: 본문 안 이미지 상자와 크기 손잡이).
      // 마크다운 원문은 바로 옆의 숨긴 .mk 글자가 그대로 가지고 있으므로 여기서는 세지 않음
      if (node.classList && node.classList.contains('md-skip')) return;

      var isBlock = BLOCK_TAGS.test(tag);
      if (isBlock) {
        if (emitted) text += '\n';
        emitted = true;
      }
      var kids = node.childNodes;
      for (var k = 0; k < kids.length; k++) {
        markElem(node, k);
        visit(kids[k]);
      }
      markElem(node, kids.length);
    }

    var top = root.childNodes;
    for (var i = 0; i < top.length; i++) {
      markElem(root, i);
      visit(top[i]);
    }
    markElem(root, top.length);

    for (var j = 0; j < pos.length; j++) if (pos[j] === -1) pos[j] = text.length;
    return { text: text, pos: pos };
  }

  /* ------------------------------------------------------------------
     2. 마크다운 한 줄 → 화면용 DOM
     ------------------------------------------------------------------ */

  // 마크다운 기호는 기본적으로 화면에서 항상 숨김(태훈님 확정 2026-08-14).
  // 예외는 링크 주소뿐 — 나중에 주소를 확인·수정할 방법이 있어야 해서 커서가 닿은 줄에서만 보임.
  // 기호가 안 보이는 대신, 지우기로 기호가 반쪽만 깨지는 건 handleDeleteKey가 막아줌
  function mk(s, showOnCurrentLine) {
    var el = document.createElement('span');
    el.className = showOnCurrentLine ? 'mk mk-show' : 'mk';
    el.textContent = s;
    return el;
  }
  function txt(s) { return document.createTextNode(s); }

  /* ---- 표 (2-2단계) ------------------------------------------------
     "| 가 | 나 |" 줄을 진짜 표처럼 보이게 그림.

     [설계 원칙 — 인계서의 data-md 위젯 안(案)을 버린 이유]
     data-md 안은 표를 "글자가 아닌 부품"으로 만드는 방식이었는데, 그러면 이 편집기의
     대전제인 "화면의 글자 = 마크다운 원문"이 표에서만 깨진다(커서 위치 계산·실행취소·
     되읽기를 표 전용으로 따로 만들어야 하고, 변환 실패 시 표가 날아갈 수 있음).
     대신 세로줄(|)을 다른 기호처럼 .mk 로 숨기고, 칸을 display:table-cell 로 만들었다.
     브라우저가 이어진 table-row 들을 자동으로 한 표로 묶어주므로(익명 표 상자) 칸이
     세로로 딱 맞고, 글자는 여전히 마크다운 원문 그대로다. 즉 표에서도 대전제가 안 깨짐.
     ------------------------------------------------------------------ */

  // "| a | b |" 를 칸으로 쪼갬. \| 는 칸 구분이 아니라 글자 |.
  // 실패하면 null(= 표 줄이 아님). 반환 위치는 줄 안에서의 글자 번호.
  function parseTableRow(text) {
    var m = /^(\s*)(\|[\s\S]*\|)(\s*)$/.exec(text);
    if (!m) return null;
    var lead = m[1], body = m[2], trail = m[3];
    if (body.length < 2) return null;
    var cells = [];
    var cur = '';
    var curStart = lead.length + 1;
    var i = 1;
    while (i < body.length) {
      var ch = body.charAt(i);
      if (ch === '\\' && body.charAt(i + 1) === '|') { cur += '\\|'; i += 2; continue; }
      if (ch === '|') {
        cells.push({ text: cur, start: curStart, end: curStart + cur.length });
        i += 1;
        cur = '';
        curStart = lead.length + i;
        continue;
      }
      cur += ch;
      i += 1;
    }
    if (cur !== '') return null;   // 마지막 | 뒤에 글자가 남음 → 표 줄이 아님
    if (!cells.length) return null;
    return { lead: lead, trail: trail, cells: cells };
  }

  // "| --- | :--: |" 처럼 구분선만 든 줄인가
  function isSepCells(cells) {
    for (var i = 0; i < cells.length; i++) {
      if (!/^\s*:?-+:?\s*$/.test(cells[i].text)) return false;
    }
    return true;
  }

  // 칸 하나의 속 내용. \| 는 백슬래시를 숨기고 | 만 보여줌
  function buildCellInline(text) {
    var frag = document.createDocumentFragment();
    var parts = text.split('\\|');
    for (var i = 0; i < parts.length; i++) {
      if (i > 0) { frag.appendChild(mk('\\')); frag.appendChild(txt('|')); }
      frag.appendChild(parseInline(parts[i]));
    }
    return frag;
  }

  function buildTableRow(parsed) {
    var frag = document.createDocumentFragment();
    frag.appendChild(mk(parsed.lead + '|'));
    for (var i = 0; i < parsed.cells.length; i++) {
      var cell = document.createElement('span');
      cell.className = 'md-cell';
      cell.appendChild(buildCellInline(parsed.cells[i].text));
      // 빈 칸이면 커서를 놓을 자리가 없어지므로 길이 0짜리 글자 자리를 하나 넣어둠
      // (길이가 0이라 저장되는 글자에는 아무 영향이 없음)
      if (!cell.firstChild) cell.appendChild(txt(''));
      frag.appendChild(cell);
      frag.appendChild(mk(i === parsed.cells.length - 1 ? '|' + parsed.trail : '|'));
    }
    return frag;
  }

  /* ---- 이미지 (3단계) ---------------------------------------------
     "![[그림.png]]" 또는 "![[그림.png|400]]" 만 있는 줄을 진짜 그림으로 보여줌.

     [설계] 표와 완전히 같은 결이다 — 글자(![[...]])는 지우지 않고 .mk로 숨기기만 하고,
     그 옆에 그림을 얹는다. serialize가 .md-skip 상자를 건너뛰므로 저장되는 값은
     여전히 마크다운 원문 그대로다. "화면의 글자 = 마크다운 원문" 대전제가 안 깨진다.

     [크기] 마크다운 표준에는 크기 문법이 없어서 옵시디언 문법(|400)을 쓴다.
     이 앱은 원래부터 ![[파일]] 옵시디언 임베드 문법으로 내보내고 있었으므로
     새로 생기는 호환 부담이 없다(태훈님 확정 2026-08-15).
     [높이] 저장하지 않는다 — 원본 비율로 자동. 그래서 찌그러질 수가 없음.
     ------------------------------------------------------------------ */
  var IMAGE_LINE_RE = /^(\s*)(!\[\[([^\[\]|\n]+?)(?:\|(\d+))?\]\])(\s*)$/;

  function parseImageLine(text) {
    var m = IMAGE_LINE_RE.exec(text);
    if (!m) return null;
    var name = m[3].trim();
    if (!name) return null;
    return {
      lead: m[1], raw: m[2], name: name,
      width: m[4] ? parseInt(m[4], 10) : 0,
      trail: m[5],
    };
  }

  // 파일 이름 → 화면에 띄울 주소. memo.js가 채워줌(첨부 폴더 경로를 아는 건 그쪽뿐).
  // 없는 파일이면 빈 값을 돌려주도록 해서, 그때는 그림 대신 글자 그대로 보이게 함
  // (파일이 사라졌는데 화면에서도 사라지면 태훈님이 뭘 잃었는지 알 수 없기 때문)
  var imageSrcOf = null;

  function buildImageLine(im, frag) {
    var src = imageSrcOf ? imageSrcOf(im.name) : '';
    if (!src) return false;
    if (im.lead) frag.appendChild(txt(im.lead));
    frag.appendChild(mk(im.raw));

    var box = document.createElement('span');
    box.className = 'md-imgbox md-skip';
    box.setAttribute('contenteditable', 'false');

    var img = document.createElement('img');
    img.className = 'md-img';
    img.src = src;
    img.alt = im.name;
    img.title = im.name;
    if (im.width > 0) img.style.width = im.width + 'px';
    box.appendChild(img);

    var handle = document.createElement('span');
    handle.className = 'md-img-resize';
    // 문구는 ko.js 것을 그대로 씀(없으면 툴팁만 안 뜨고 동작은 그대로)
    try { handle.title = global.LANG.memo.imageResizeTitle; } catch (err) { /* 문구 없음 */ }
    box.appendChild(handle);

    frag.appendChild(box);
    if (im.trail) frag.appendChild(txt(im.trail));
    return true;
  }

  // 여는기호 + (안쪽 재귀) + 닫는기호 를 하나의 서식 덩어리로 묶음
  // md-fmt = "지울 때 통째로 다뤄야 하는 덩어리" 표시
  function wrapNode(tag, cls, open, inner, close, style) {
    var el = document.createElement(tag);
    el.className = ((cls || '') + ' md-fmt').trim();
    if (style) el.setAttribute('style', style);
    if (open) el.appendChild(mk(open));
    el.appendChild(parseInline(inner));
    if (close) el.appendChild(mk(close));
    return el;
  }

  // 인라인 서식 규칙 — 위에서부터 먼저 검사함(순서 중요: `코드`가 가장 먼저)
  var INLINE_RULES = [
    // 인라인 코드: 안쪽은 서식을 더 해석하지 않음
    { re: /^`([^`\n]+)`/, make: function (m) {
        var el = document.createElement('code');
        el.className = 'md-code md-fmt';
        el.appendChild(mk('`')); el.appendChild(txt(m[1])); el.appendChild(mk('`'));
        return el;
      } },
    // <mark style="background:#xxx">색 형광펜</mark>
    { re: /^<mark(\s+style="[^"]*")?\s*>([\s\S]*?)<\/mark>/i, make: function (m) {
        var style = '';
        var hit = /background\s*:\s*([^;"]+)/i.exec(m[1] || '');
        if (hit) style = 'background:' + hit[1].trim();
        return wrapNode('mark', 'md-hl', '<mark' + (m[1] || '') + '>', m[2], '</mark>', style);
      } },
    { re: /^==([^\n]+?)==/, make: function (m) {
        return wrapNode('mark', 'md-hl md-hl-y', '==', m[1], '==');
      } },
    { re: /^\*\*([^\n]+?)\*\*/, make: function (m) { return wrapNode('strong', '', '**', m[1], '**'); } },
    { re: /^__([^\n]+?)__/, make: function (m) { return wrapNode('strong', '', '__', m[1], '__'); } },
    { re: /^~~([^\n]+?)~~/, make: function (m) { return wrapNode('s', '', '~~', m[1], '~~'); } },
    { re: /^<u>([\s\S]*?)<\/u>/i, make: function (m) { return wrapNode('u', '', '<u>', m[1], '</u>'); } },
    { re: /^<sup>([\s\S]*?)<\/sup>/i, make: function (m) { return wrapNode('sup', '', '<sup>', m[1], '</sup>'); } },
    { re: /^<sub>([\s\S]*?)<\/sub>/i, make: function (m) { return wrapNode('sub', '', '<sub>', m[1], '</sub>'); } },
    { re: /^\*([^\s*][^\n]*?)\*/, make: function (m) { return wrapNode('em', '', '*', m[1], '*'); } },
    { re: /^_([^\s_][^\n]*?)_/, make: function (m) { return wrapNode('em', '', '_', m[1], '_'); } },
    // 옵시디언 메모 연결 [[파일명]]
    { re: /^\[\[([^\]\n]+)\]\]/, make: function (m) {
        var el = document.createElement('span');
        el.className = 'md-wikilink md-fmt';
        el.appendChild(mk('[[')); el.appendChild(txt(m[1])); el.appendChild(mk(']]'));
        return el;
      } },
    // 링크 [글자](주소)
    { re: /^\[([^\]\n]*)\]\(([^)\s]*)\)/, make: function (m) {
        var el = document.createElement('span');
        el.className = 'md-link md-fmt';
        el.appendChild(mk('[', true));
        el.appendChild(parseInline(m[1]));
        el.appendChild(mk('](' + m[2] + ')', true));
        return el;
      } },
  ];

  function parseInline(text) {
    var frag = document.createDocumentFragment();
    var buf = '';
    var i = 0;
    function flush() { if (buf) { frag.appendChild(txt(buf)); buf = ''; } }

    while (i < text.length) {
      var rest = text.slice(i);
      var matched = false;
      for (var r = 0; r < INLINE_RULES.length; r++) {
        var m = INLINE_RULES[r].re.exec(rest);
        if (m) {
          flush();
          frag.appendChild(INLINE_RULES[r].make(m));
          i += m[0].length;
          matched = true;
          break;
        }
      }
      if (!matched) { buf += text[i]; i += 1; }
    }
    flush();
    return frag;
  }

  // 한 줄 전체(제목/인용/구분선 등 줄 단위 서식 포함)
  function buildLine(text, plain) {
    var cls = 'ln';
    var frag = document.createDocumentFragment();

    if (text === '') {
      frag.appendChild(document.createElement('br'));
      return { cls: 'ln ln-empty', frag: frag };
    }
    if (plain) {
      frag.appendChild(txt(text));
      return { cls: cls, frag: frag };
    }

    // 표 줄은 다른 줄 서식보다 먼저 본다("| # 가 |" 도 표로 읽혀야 하므로)
    var tr = parseTableRow(text);
    if (tr) {
      // 구분선 줄("| --- |")은 숨길지 말지를 CSS가 정함 — 바로 위가 표 줄일 때만 숨김.
      // 위에 표가 없는 홀로 있는 구분선까지 숨기면 글자가 사라진 것처럼 보이기 때문
      cls += ' md-trow' + (isSepCells(tr.cells) ? ' md-trow-sep' : '');
      frag.appendChild(buildTableRow(tr));
      return { cls: cls, frag: frag };
    }

    // 이미지 줄("![[그림.png|400]]")은 다른 줄 서식보다 먼저 본다.
    // 안 그러면 뒤쪽 [[...]] 규칙이 먼저 걸려서 메모연결처럼 그려짐
    var im = parseImageLine(text);
    if (im && buildImageLine(im, frag)) {
      return { cls: cls + ' md-image', frag: frag };
    }
    if (im) frag.textContent = '';   // 파일을 못 찾음 → 아래에서 보통 글자로 다시 그림

    var m;
    if ((m = /^(#{1,6})\s+([\s\S]*)$/.exec(text))) {
      cls += ' md-h' + Math.min(m[1].length, 3);
      frag.appendChild(mk(m[1] + text.slice(m[1].length, text.length - m[2].length)));
      frag.appendChild(parseInline(m[2]));
      return { cls: cls, frag: frag };
    }
    if (/^\s*(---|\*\*\*|___)\s*$/.test(text)) {
      cls += ' md-hr';
      frag.appendChild(txt(text));
      return { cls: cls, frag: frag };
    }
    if ((m = /^(\s*)>\s?([\s\S]*)$/.exec(text))) {
      cls += ' md-quote';
      frag.appendChild(txt(m[1]));
      frag.appendChild(mk(text.slice(m[1].length, text.length - m[2].length)));
      frag.appendChild(parseInline(m[2]));
      return { cls: cls, frag: frag };
    }
    // 체크리스트 줄: "- [ ] 할일" → 진짜 체크박스로 그림. 기호는 숨기고 체크박스를 대신 넣음
    if ((m = /^(\s*)([-*+][ \t]+\[([ xX])\][ \t])([\s\S]*)$/.exec(text))) {
      var done = m[3] !== ' ';
      cls += ' md-li md-task' + (done ? ' md-task-done' : '');
      if (m[1]) frag.appendChild(txt(m[1]));
      frag.appendChild(mk(m[2]));
      var box = document.createElement('input');
      box.type = 'checkbox';
      box.className = 'md-checkbox';
      box.checked = done;
      box.setAttribute('contenteditable', 'false');
      frag.appendChild(box);
      frag.appendChild(parseInline(m[4]));
      return { cls: cls, frag: frag };
    }
    // 목록(- , * , 1. )은 기호를 숨기지 않음 — 기호 자체가 이미 글머리표처럼 보이고,
    // 숨기면 들여쓰기가 흔들려서 오히려 읽기 나빠짐
    if (/^\s*([-*+]|\d+\.)\s+/.test(text)) cls += ' md-li';
    if (/^```/.test(text)) cls += ' md-fence';

    frag.appendChild(parseInline(text));
    return { cls: cls, frag: frag };
  }

  /* ------------------------------------------------------------------
     3. 편집기 본체
     ------------------------------------------------------------------ */
  function createMdEditor(root) {
    var composing = false;   // 한글 조합 중인가
    var busy = false;        // 우리가 DOM을 건드리는 중인가(이벤트 되먹임 방지)
    var renderTimer = null;
    var curLine = null;
    var placeholder = '';

    // 자체 실행취소
    var undoStack = [], redoStack = [];
    var committed = '';
    var commitTimer = null;
    var selBeforeChange = { start: 0, end: 0 };

    function plainMode() { return document.body.classList.contains('md-off'); }

    // ---- 값 읽기/쓰기 ----
    function getValue() { return serialize(root, []).text; }

    function renderAll(text) {
      busy = true;
      root.textContent = '';
      var lines = text.split('\n');
      var plain = plainMode();
      for (var i = 0; i < lines.length; i++) {
        var div = document.createElement('div');
        var built = buildLine(lines[i], plain);
        div.className = built.cls;
        // 이미지 줄은 "지금 그려진 글자"를 적어둠 — 글자가 안 바뀌었으면 다시 그리지 않아서
        // 커서를 옮길 때마다 그림이 깜빡이는 걸 막음 (renderLine 참고)
        if (built.cls.indexOf('md-image') !== -1) div.setAttribute('data-md-raw', lines[i]);
        div.appendChild(built.frag);
        root.appendChild(div);
      }
      curLine = null;
      root.classList.toggle('is-empty', text === '');
      busy = false;
    }

    function setValue(text) {
      text = String(text == null ? '' : text);
      renderAll(text);
      committed = text;
      undoStack.length = 0;
      redoStack.length = 0;
    }

    // ---- 커서 위치 ----
    function getSel() {
      var sel = global.getSelection();
      if (!sel || sel.rangeCount === 0 || !root.contains(sel.anchorNode)) {
        return { start: selBeforeChange.start, end: selBeforeChange.end };
      }
      var r = sel.getRangeAt(0);
      var out = serialize(root, [
        { node: r.startContainer, offset: r.startOffset },
        { node: r.endContainer, offset: r.endOffset },
      ]);
      var a = out.pos[0], b = out.pos[1];
      return { start: Math.min(a, b), end: Math.max(a, b) };
    }

    function locate(target) {
      var lines = root.children;
      var acc = 0;
      for (var i = 0; i < lines.length; i++) {
        var len = lines[i].textContent.length;
        if (target <= acc + len) return locateInLine(lines[i], target - acc);
        acc += len + 1;
      }
      var last = lines[lines.length - 1];
      return last ? locateInLine(last, last.textContent.length) : { node: root, offset: 0 };
    }

    // 커서를 놓을 자리를 찾음. 화면에 안 보이는 기호(.mk) 속에 커서가 들어가면
    // 커서가 사라진 것처럼 보이므로, 같은 위치라면 보이는 글자 쪽을 먼저 고름
    function locateInLine(line, off) {
      var walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT, null);
      var nodes = [], n, acc = 0;
      while ((n = walker.nextNode())) {
        nodes.push({ n: n, s: acc, e: acc + n.data.length });
        acc += n.data.length;
      }
      if (!nodes.length) return { node: line, offset: 0 };

      var lineIsCur = line.classList.contains('cur');
      function isHidden(node) {
        var p = node.parentNode;
        while (p && p !== line) {
          if (p.nodeType === 1 && p.classList && p.classList.contains('mk')) {
            return !(p.classList.contains('mk-show') && lineIsCur);
          }
          p = p.parentNode;
        }
        return false;
      }

      for (var pass = 0; pass < 2; pass++) {
        for (var i = 0; i < nodes.length; i++) {
          var it = nodes[i];
          if (pass === 0 && isHidden(it.n)) continue;
          if (off >= it.s && off <= it.e) return { node: it.n, offset: off - it.s };
        }
      }
      var last = nodes[nodes.length - 1];
      return { node: last.n, offset: last.n.data.length };
    }

    // 화면에서 숨긴 HTML 태그(<mark style>, <u> 등)가 지우기 때문에 반쪽만 깨지는 걸 막음.
    // 태그는 "글자 뭉치"가 아니라 하나의 덩어리로 취급해서, 커서가 태그 바로 옆에 있을 때
    // 백스페이스/딜리트를 누르면 태그 글자가 아니라 "눈에 보이는 그 글자"를 지움
    function htmlFmtRanges() {
      var out = [];
      var list = root.querySelectorAll('.md-fmt');
      for (var i = 0; i < list.length; i++) {
        var E = list[i];
        var open = null, close = null;
        for (var k = 0; k < E.childNodes.length; k++) {
          var ch = E.childNodes[k];
          if (ch.nodeType === 1 && ch.classList && ch.classList.contains('mk')) {
            if (!open) open = ch;
            close = ch;
          }
        }
        if (!open || !close || open === close) continue;
        var parent = E.parentNode;
        var idx = Array.prototype.indexOf.call(parent.childNodes, E);
        var r = serialize(root, [{ node: parent, offset: idx }, { node: parent, offset: idx + 1 }]);
        out.push({
          start: r.pos[0],
          end: r.pos[1],
          openLen: open.textContent.length,
          closeLen: close.textContent.length,
        });
      }
      return out;
    }

    // 줄머리 기호(제목 "# ", 인용 "> ")도 숨겨져 있으므로 같은 보호가 필요함.
    // 글 맨 앞에서 백스페이스를 누르면 기호 한 글자가 아니라 줄머리 기호 전체가 사라져서
    // 그냥 보통 글줄로 바뀜(= 눈에 보이는 대로의 동작)
    function linePrefixRanges() {
      var out = [];
      var lines = root.children;
      for (var i = 0; i < lines.length; i++) {
        var line = lines[i];
        if (!/\bmd-h[123]\b|\bmd-quote\b|\bmd-task\b/.test(line.className)) continue;
        var mkEl = null;
        for (var k = 0; k < line.childNodes.length; k++) {
          var ch = line.childNodes[k];
          if (ch.nodeType === 1 && ch.classList && ch.classList.contains('mk')) { mkEl = ch; break; }
          if (ch.nodeType === 3 && ch.data.trim() !== '') break;
          if (ch.nodeType === 1) break;
        }
        if (!mkEl) continue;
        var idx = Array.prototype.indexOf.call(line.childNodes, mkEl);
        var r = serialize(root, [{ node: line, offset: idx }, { node: line, offset: idx + 1 }]);
        out.push({ start: r.pos[0], end: r.pos[1] });
      }
      return out;
    }

    function handleDeleteKey(isBack) {
      var sel = global.getSelection();
      if (!sel || sel.rangeCount === 0 || !root.contains(sel.anchorNode)) return false;
      var ranges = htmlFmtRanges();
      var prefixes = linePrefixRanges();
      if (!ranges.length && !prefixes.length) return false;
      var s = getSel();
      var v = getValue();

      // 줄머리 기호: 커서가 기호 바로 앞/뒤면 기호 전체를 없앰(보통 글줄로 바뀜)
      if (s.start === s.end) {
        for (var q = 0; q < prefixes.length; q++) {
          var pf = prefixes[q];
          if ((isBack && s.start === pf.end) || (!isBack && s.start === pf.start)) {
            replaceRange(pf.start, pf.end, '');
            setSel(pf.start);
            return true;
          }
        }
      }
      if (!ranges.length) return false;

      // (1) 글자를 여러 개 선택한 상태 — 태그가 반만 걸쳐 있으면 통째로 포함시켜서 지움
      if (s.start !== s.end) {
        var a = s.start, b = s.end, changed = false;
        for (var i = 0; i < ranges.length; i++) {
          var g = ranges[i];
          if (a < g.end && b > g.start) {
            if (a > g.start) { a = g.start; changed = true; }
            if (b < g.end) { b = g.end; changed = true; }
          }
        }
        if (!changed) return false;
        replaceRange(a, b, '');
        return true;
      }

      // (2) 커서 하나 — 숨은 태그 바로 옆이면 보이는 글자를 대신 지움
      var c = s.start;
      for (var j = 0; j < ranges.length; j++) {
        var t = ranges[j];
        var inS = t.start + t.openLen;
        var inE = t.end - t.closeLen;
        if (inE < inS) continue;

        var innerLen = inE - inS;

        // 기호가 숨겨져 있으면 브라우저 기본 지우기가 기호까지 같이 먹어버림
        // (실제로 확인함: 굵은 글자 끝에서 백스페이스 → 글자와 닫는 ** 가 함께 사라졌음)
        // 그래서 기호 바로 옆 4개 자리는 전부 직접 처리해서 "보이는 글자"만 지움
        if (isBack && (c === inE || c === t.end)) {
          if (innerLen <= 1) { replaceRange(t.start, t.end, ''); setSel(t.start); }
          else { replaceRange(inE - 1, inE, ''); setSel(c - 1); }
          return true;
        }
        if (isBack && (c === inS || c === t.start)) {
          if (t.start > 0) { replaceRange(t.start - 1, t.start, ''); setSel(c - 1); }
          return true;
        }
        if (!isBack && (c === t.start || c === inS)) {
          if (innerLen <= 1) { replaceRange(t.start, t.end, ''); setSel(t.start); }
          else { replaceRange(inS, inS + 1, ''); setSel(c); }
          return true;
        }
        if (!isBack && (c === inE || c === t.end)) {
          if (t.end < v.length) { replaceRange(t.end, t.end + 1, ''); setSel(c); }
          return true;
        }
      }
      return false;
    }

    /* ---- 표 다루기 (2-2단계) ----------------------------------------
       표 줄은 세로줄(|)이 숨겨져 있어서, 브라우저 기본 지우기에 맡기면 칸 구분이
       깨진다(굵게 기호가 반쪽 나던 것과 같은 문제). 그래서 표 안에서는 지우기·엔터·
       탭을 전부 직접 처리한다.
       ------------------------------------------------------------------ */

    // 지금 값 전체를 줄 단위로 훑어서 각 줄의 위치·표 여부를 뽑음
    function scanLines(v) {
      var lines = v.split('\n');
      var out = [];
      var off = 0;
      for (var i = 0; i < lines.length; i++) {
        var p = parseTableRow(lines[i]);
        out.push({
          text: lines[i],
          s: off,
          e: off + lines[i].length,
          row: p,
          sep: p ? isSepCells(p.cells) : false,
          img: p ? null : parseImageLine(lines[i]),
        });
        off += lines[i].length + 1;
      }
      return out;
    }

    function lineIndexAt(info, offset) {
      for (var i = 0; i < info.length; i++) {
        if (offset >= info[i].s && offset <= info[i].e) return i;
      }
      return info.length - 1;
    }

    // 커서가 어느 칸에 있는가. 칸 사이(숨은 | 자리)면 가까운 쪽 칸으로 붙임
    function cellIndexAt(item, offset) {
      var cells = item.row.cells;
      for (var i = 0; i < cells.length; i++) {
        var s = item.s + cells[i].start, e = item.s + cells[i].end;
        if (offset >= s && offset <= e) return i;
      }
      for (var j = cells.length - 1; j >= 0; j--) {
        if (offset > item.s + cells[j].end) return j;
      }
      return 0;
    }

    function cellAbs(item, idx) {
      return { s: item.s + item.row.cells[idx].start, e: item.s + item.row.cells[idx].end };
    }

    // 값을 통째로 갈아끼움(실행취소·저장 신호 포함). replaceRange와 같은 절차
    function setWholeText(next, caret) {
      commit();
      var before = getValue();
      if (next === before) { setSel(caret, caret); return; }
      pushUndo(before, caret, caret);
      renderAll(next);
      setSel(caret, caret);
      committed = next;
      root.dispatchEvent(new Event('input', { bubbles: true }));
    }

    // 표를 안 깨뜨리면서 [a,b)를 지움.
    // - 표 줄이 통째로 선택되면 그 줄은 사라짐(행 삭제)
    // - 일부만 걸친 표 줄은 칸 글자만 지우고 세로줄(|)은 남김(표 모양 유지)
    // - 숨은 구분선 줄은 바로 위 줄과 운명을 같이 함(머리줄이 남으면 구분선도 남음)
    function deleteRangeSafely(a, b, insert) {
      var v = getValue();
      var info = scanLines(v);
      var i;
      var full = [];
      for (i = 0; i < info.length; i++) full.push(a <= info[i].s && b >= info[i].e);
      for (i = 1; i < info.length; i++) {
        if (info[i].row && info[i].sep && info[i - 1].row) {
          var touched = b > info[i].s && a < info[i].e;
          full[i] = full[i - 1] && (touched || full[i]);
        }
      }

      // 살아남는 표 줄의 구조용 세로줄 위치 모으기
      var pipes = {};
      for (i = 0; i < info.length; i++) {
        if (!info[i].row || full[i]) continue;
        var cells = info[i].row.cells;
        pipes[info[i].s + cells[0].start - 1] = true;
        for (var k = 0; k < cells.length; k++) pipes[info[i].s + cells[k].end] = true;
      }

      var next = '';
      var caret = 0;
      for (i = 0; i < v.length; i++) {
        var keep;
        if (i < a || i >= b) keep = true;
        else if (v.charAt(i) === '\n') {
          // 줄바꿈: 양옆 중 하나라도 살아남는 표 줄이면 지우지 않음(표가 다른 줄과 붙어버림 방지)
          var L = lineIndexAt(info, i);
          if (info[L].e !== i) L = L - 1;
          var leftAlive = L >= 0 && info[L] && info[L].row && !full[L];
          var rightAlive = info[L + 1] && info[L + 1].row && !full[L + 1];
          keep = !!(leftAlive || rightAlive);
        } else {
          keep = !!pipes[i];
        }
        if (i === a) caret = next.length;
        if (keep) next += v.charAt(i);
      }
      if (a >= v.length) caret = next.length;
      if (insert) {
        next = next.slice(0, caret) + insert + next.slice(caret);
        caret += insert.length;
      }
      setWholeText(next, caret);
    }

    function selectionTouchesTable(a, b) {
      var info = scanLines(getValue());
      for (var i = 0; i < info.length; i++) {
        if (!info[i].row) continue;
        if (b > info[i].s && a < info[i].e) return true;
      }
      return false;
    }

    // 표 안에서의 백스페이스/딜리트
    function handleTableDelete(isBack) {
      var s = getSel();
      if (s.start !== s.end) {
        if (!selectionTouchesTable(s.start, s.end)) return false;
        deleteRangeSafely(s.start, s.end);
        return true;
      }
      var info = scanLines(getValue());
      var li = lineIndexAt(info, s.start);
      var item = info[li];
      if (!item.row) return false;
      var ci = cellIndexAt(item, s.start);
      var cur = cellAbs(item, ci);
      // 커서가 숨은 세로줄 자리에 있으면 칸 안으로 끌어당김(세로줄이 지워지는 걸 막음)
      s = { start: Math.max(cur.s, Math.min(s.start, cur.e)), end: 0 };
      s.end = s.start;

      if (isBack) {
        if (s.start > cur.s) {
          replaceRange(s.start - 1, s.start, '');
          setSel(s.start - 1);
          return true;
        }
        // 칸 맨 앞 — 앞 칸 끝으로 커서만 옮김(세로줄을 지우지 않게)
        if (ci > 0) setSel(cellAbs(item, ci - 1).e);
        return true;   // 첫 칸이면 아무 일도 안 함(표가 윗줄과 합쳐지는 걸 막음)
      }
      if (s.start < cur.e) {
        replaceRange(s.start, s.start + 1, '');
        setSel(s.start);
        return true;
      }
      if (ci < item.row.cells.length - 1) setSel(cellAbs(item, ci + 1).s);
      return true;
    }

    // 같은 칸 수의 빈 줄 만들기 ("|  |  |")
    function emptyRowText(cols) {
      var t = '|';
      for (var i = 0; i < cols; i++) t += '  |';
      return t;
    }

    // 표 줄에서 엔터 = 아래에 같은 칸 수의 새 행. 빈 마지막 행에서 엔터면 표를 빠져나감
    function handleTableEnter() {
      var s = getSel();
      if (s.start !== s.end) return false;
      var info = scanLines(getValue());
      var li = lineIndexAt(info, s.start);
      var item = info[li];
      if (!item.row) return false;

      var cols = item.row.cells.length;
      var isEmptyRow = item.row.cells.every(function (c) { return c.text.trim() === ''; });
      var nextIsRow = info[li + 1] && info[li + 1].row;

      if (isEmptyRow && !item.sep && !nextIsRow) {
        // 빈 행에서 엔터 → 그 행을 없애고 표 밖 새 줄로 나감
        var delStart = li > 0 ? info[li - 1].e : item.s;
        replaceRange(delStart, item.e, '\n');
        return true;
      }

      // 머리줄 바로 아래 숨은 구분선이 있으면 그 아래에 넣음
      var at = item.e;
      if (info[li + 1] && info[li + 1].row && info[li + 1].sep) at = info[li + 1].e;
      var newRow = emptyRowText(cols);
      replaceRange(at, at, '\n' + newRow);
      setSel(at + 1 + 2);   // 새 행 첫 칸의 가운데(| + 공백 다음)
      return true;
    }

    // 탭 = 다음 칸. 마지막 칸에서 탭이면 새 행
    function handleTableTab(back) {
      var s = getSel();
      var info = scanLines(getValue());
      var li = lineIndexAt(info, s.start);
      var item = info[li];
      if (!item.row) return false;
      var ci = cellIndexAt(item, s.start);

      if (!back && ci < item.row.cells.length - 1) { selectCell(item, ci + 1); return true; }
      if (back && ci > 0) { selectCell(item, ci - 1); return true; }

      var step = back ? -1 : 1;
      var j = li + step;
      while (info[j] && info[j].row && info[j].sep) j += step;   // 숨은 구분선은 건너뜀
      if (info[j] && info[j].row) {
        selectCell(info[j], back ? info[j].row.cells.length - 1 : 0);
        return true;
      }
      if (back) return true;
      return handleTableEnter();
    }

    // 칸 하나를 통째로 선택(글자가 있으면 선택, 없으면 커서만)
    function selectCell(item, idx) {
      var c = cellAbs(item, idx);
      var t = item.row.cells[idx].text;
      var lead = t.length - t.replace(/^\s+/, '').length;
      var tail = t.length - t.replace(/\s+$/, '').length;
      if (t.trim() === '') setSel(c.s + Math.min(1, t.length));
      else setSel(c.s + lead, c.e - tail);
    }

    /* ---- 표 만들기·행열 고치기 (memo.js 툴바에서 부름) ---- */

    // 이어진 표 줄 덩어리(= 표 하나)의 범위
    function tableExtent(info, li) {
      if (!info[li] || !info[li].row) return null;
      var a = li, b = li;
      while (a > 0 && info[a - 1].row) a -= 1;
      while (b < info.length - 1 && info[b + 1].row) b += 1;
      return { a: a, b: b };
    }

    function cellsToLine(cells) { return '|' + cells.join('|') + '|'; }
    function escCell(s) { return String(s == null ? '' : s).replace(/\|/g, '\\|').replace(/\r?\n/g, ' '); }

    // 표 전체를 새 줄들로 갈아끼움
    function rewriteTable(info, ext, newLines, caret) {
      var v = getValue();
      var next = v.slice(0, info[ext.a].s) + newLines.join('\n') + v.slice(info[ext.b].e);
      setWholeText(next, caret);
    }

    function tableCtx() {
      var s = getSel();
      var info = scanLines(getValue());
      var li = lineIndexAt(info, s.start);
      var ext = tableExtent(info, li);
      if (!ext) return null;
      return { s: s, info: info, li: li, ext: ext, item: info[li], ci: cellIndexAt(info[li], s.start) };
    }

    function tableOps(kind) {
      var c = tableCtx();
      if (!c) return false;
      var lines = [];
      var i;
      for (i = c.ext.a; i <= c.ext.b; i++) lines.push(c.info[i]);
      var rel = c.li - c.ext.a;

      if (kind === 'deleteTable') {
        var v = getValue();
        var from = c.info[c.ext.a].s;
        var to = c.info[c.ext.b].e;
        if (to < v.length) to += 1;             // 표 뒤 줄바꿈까지
        else if (from > 0) from -= 1;           // 표가 맨 끝이면 앞 줄바꿈을 지움
        replaceRange(from, to, '');
        return true;
      }

      var cols = lines[0].row.cells.length;

      if (kind === 'addRow' || kind === 'deleteRow') {
        var texts = lines.map(function (L) { return L.text; });
        if (kind === 'addRow') {
          var at = rel;
          if (lines[rel + 1] && lines[rel + 1].sep) at = rel + 1;   // 머리줄 다음이면 구분선 아래
          texts.splice(at + 1, 0, emptyRowText(cols));
          rewriteTable(c.info, c.ext, texts, c.info[c.ext.a].s + texts.slice(0, at + 1).join('\n').length + 2 + 1);
          return true;
        }
        if (lines[rel].sep) return false;                    // 숨은 구분선은 지울 수 없음
        var dataCount = lines.filter(function (L) { return !L.sep; }).length;
        if (dataCount <= 1) return tableOps('deleteTable');   // 마지막 한 줄이면 표를 없앰
        texts.splice(rel, 1);
        if (rel === 0 && lines[1] && lines[1].sep) texts.splice(0, 1);  // 머리줄을 지우면 구분선도 같이
        rewriteTable(c.info, c.ext, texts, c.info[c.ext.a].s);
        return true;
      }

      if (kind === 'addCol' || kind === 'deleteCol') {
        if (kind === 'deleteCol' && cols <= 1) return tableOps('deleteTable');
        var out = lines.map(function (L) {
          var cs = L.row.cells.map(function (x) { return x.text; });
          if (kind === 'addCol') cs.splice(c.ci + 1, 0, L.sep ? '---' : '  ');
          else cs.splice(c.ci, 1);
          return cellsToLine(cs);
        });
        rewriteTable(c.info, c.ext, out, c.s.start);
        return true;
      }
      return false;
    }

    // 새 표 넣기. rows2d가 있으면 그 내용으로, 없으면 빈 표
    function insertTable(rowCount, colCount, rows2d) {
      var body = [];
      if (rows2d && rows2d.length) {
        colCount = rows2d[0].length;
        body.push(cellsToLine(rows2d[0].map(function (x) { return ' ' + escCell(x) + ' '; })));
        body.push(cellsToLine(new Array(colCount).fill(' --- ')));
        for (var r = 1; r < rows2d.length; r++) {
          var row = [];
          for (var cc = 0; cc < colCount; cc++) row.push(' ' + escCell(rows2d[r][cc]) + ' ');
          body.push(cellsToLine(row));
        }
      } else {
        body.push(emptyRowText(colCount));
        body.push(cellsToLine(new Array(colCount).fill('---')));
        for (var k = 1; k < rowCount; k++) body.push(emptyRowText(colCount));
      }
      var block = body.join('\n');

      var s = getSel();
      var info = scanLines(getValue());
      var li = lineIndexAt(info, s.start);
      var at = info[li].e;
      var prefix = info[li].text.trim() === '' ? '' : '\n\n';
      if (prefix === '' && info[li].text !== '') prefix = '\n';
      var suffix = info[li + 1] ? '' : '\n';
      replaceRange(at, at, prefix + block + suffix);
      setSel(at + prefix.length + 2);   // 첫 칸 안
      return true;
    }

    /* ---- 이미지 다루기 (3단계) ---------------------------------------
       이미지 줄도 표와 같은 이유로 지우기·엔터·타이핑을 직접 처리한다.
       "![[그림.png]]" 글자가 화면에서 숨겨져 있어서, 브라우저 기본 동작에 맡기면
       글자가 반쪽만 지워지고 그림이 사라진 자리에 깨진 글자가 튀어나온다.
       원칙: 이미지 줄은 "글자 뭉치"가 아니라 그림 한 덩어리로 취급한다.
       ------------------------------------------------------------------ */

    // 이미지 줄 하나를 통째로 없앨 범위(뒤따르는 줄바꿈까지 — 빈 줄이 남지 않게)
    function imageLineRange(info, i) {
      var from = info[i].s, to = info[i].e;
      if (i < info.length - 1) to += 1;
      else if (i > 0) from -= 1;
      return { from: from, to: to };
    }

    // 선택 범위가 이미지 줄에 반쯤 걸쳐 있으면 그 줄 전체를 포함하도록 넓힘
    function expandOverImages(info, a, b) {
      var changed = false;
      for (var i = 0; i < info.length; i++) {
        if (!info[i].img) continue;
        if (b > info[i].s && a < info[i].e) {
          if (a > info[i].s) { a = info[i].s; changed = true; }
          if (b < info[i].e) { b = info[i].e; changed = true; }
        }
      }
      return changed ? { a: a, b: b } : null;
    }

    // 선택 범위가 이미지 줄에 조금이라도 닿는가
    function selectionTouchesImage(info, a, b) {
      for (var i = 0; i < info.length; i++) {
        if (info[i].img && b > info[i].s && a < info[i].e) return true;
      }
      return false;
    }

    // 커서가 이미지 줄 안에 있으면 그 줄 정보를 돌려줌
    function caretImageLine(info, offset) {
      var li = lineIndexAt(info, offset);
      return info[li] && info[li].img ? li : -1;
    }

    // 이미지 줄에서의 백스페이스/딜리트 = 그림을 통째로 지움
    function handleImageDelete(isBack) {
      var s = getSel();
      var info = scanLines(getValue());

      if (s.start !== s.end) {
        // 그림에 조금이라도 닿는 선택은 브라우저에 맡기지 않고 직접 지운다.
        // 맡기면 그림 상자(contenteditable=false)만 남기고 글자만 지워지는 등 구조가 깨짐
        if (!selectionTouchesImage(info, s.start, s.end)) return false;
        var ex = expandOverImages(info, s.start, s.end) || { a: s.start, b: s.end };
        deleteRangeSafely(ex.a, ex.b);   // 같은 선택에 표가 섞여 있어도 안전하게 처리됨
        return true;
      }

      var li = lineIndexAt(info, s.start);
      var target = -1;
      if (info[li].img) target = li;
      else if (isBack && s.start === info[li].s && li > 0 && info[li - 1].img) target = li - 1;
      else if (!isBack && s.start === info[li].e && info[li + 1] && info[li + 1].img) target = li + 1;
      if (target === -1) return false;

      var r = imageLineRange(info, target);
      replaceRange(r.from, r.to, '');
      return true;
    }

    // 이미지 줄에서 엔터 = 줄을 쪼개지 않고 그림 아래에 새 줄을 만듦
    function handleImageEnter() {
      var s = getSel();
      if (s.start !== s.end) return false;
      var info = scanLines(getValue());
      var li = caretImageLine(info, s.start);
      if (li === -1) return false;
      replaceRange(info[li].e, info[li].e, '\n');
      return true;
    }

    // 커서가 이미지 줄 안에 있는 채로 글자를 치려 할 때, 먼저 그림 아래에 빈 줄을 만들고
    // 커서를 그리로 옮김. 그 다음에 눌린 글자가 그 줄에 들어감(한글 조합도 그대로 됨).
    // preventDefault를 쓰지 않는 이유: 한글 조합을 가로채면 글자가 깨지기 때문
    function escapeImageLineForTyping() {
      var s = getSel();
      if (s.start !== s.end) return false;
      var info = scanLines(getValue());
      var li = caretImageLine(info, s.start);
      if (li === -1) return false;
      replaceRange(info[li].e, info[li].e, '\n');
      return true;
    }

    function setSel(start, end) {
      if (end == null) end = start;
      var sel = global.getSelection();
      if (!sel) return;
      var a = locate(start), b = locate(end);
      var range = document.createRange();
      try {
        range.setStart(a.node, a.offset);
        range.setEnd(b.node, b.offset);
      } catch (err) { return; }
      busy = true;
      sel.removeAllRanges();
      sel.addRange(range);
      busy = false;
      selBeforeChange = { start: start, end: end };
    }

    // ---- 구조 복구 ----
    // 백스페이스로 두 줄이 합쳐질 때처럼 브라우저가 만든 이상한 구조를 정상 모양으로 되돌림
    function isCanonical() {
      var kids = root.childNodes;
      if (kids.length === 0) return false;
      for (var i = 0; i < kids.length; i++) {
        var k = kids[i];
        if (k.nodeType !== 1 || k.tagName !== 'DIV' || !k.classList.contains('ln')) return false;
        if (k.querySelector('div,p,h1,h2,h3,h4,h5,h6,li,ul,ol,blockquote,pre,table')) return false;
      }
      return true;
    }

    function normalize() {
      if (isCanonical()) return false;
      var sel = global.getSelection();
      var marks = [];
      if (sel && sel.rangeCount && root.contains(sel.anchorNode)) {
        var r = sel.getRangeAt(0);
        marks = [{ node: r.startContainer, offset: r.startOffset }, { node: r.endContainer, offset: r.endOffset }];
      }
      var out = serialize(root, marks);
      renderAll(out.text);
      if (marks.length) setSel(out.pos[0], out.pos[1]);
      return true;
    }

    // ---- 현재 줄만 다시 그리기 ----
    function lineOf(node) {
      while (node && node !== root) {
        if (node.nodeType === 1 && node.parentNode === root) return node;
        node = node.parentNode;
      }
      return null;
    }

    function currentLineEl() {
      var sel = global.getSelection();
      if (!sel || sel.rangeCount === 0 || !root.contains(sel.anchorNode)) return null;
      return lineOf(sel.anchorNode);
    }

    function offsetInLine(line) {
      var sel = global.getSelection();
      if (!sel || sel.rangeCount === 0 || !line.contains(sel.anchorNode)) return null;
      var r = sel.getRangeAt(0);
      var out = serialize(line, [{ node: r.startContainer, offset: r.startOffset }]);
      return out.pos[0];
    }

    function renderLine(line, caretOff) {
      if (!line || line.parentNode !== root) return;
      var text = serialize(line, []).text;
      // 글자가 그대로인 이미지 줄은 손대지 않음(다시 그리면 그림을 새로 읽어와 깜빡임)
      if (line.classList.contains('md-image') && line.getAttribute('data-md-raw') === text) return;
      var built = buildLine(text, plainMode());
      busy = true;
      line.textContent = '';
      line.className = built.cls;
      if (built.cls.indexOf('md-image') !== -1) line.setAttribute('data-md-raw', text);
      else line.removeAttribute('data-md-raw');
      line.appendChild(built.frag);
      busy = false;
      if (caretOff != null) {
        var p = locateInLine(line, caretOff);
        var sel = global.getSelection();
        var range = document.createRange();
        try {
          range.setStart(p.node, p.offset);
          range.collapse(true);
          busy = true;
          sel.removeAllRanges();
          sel.addRange(range);
          busy = false;
        } catch (err) { busy = false; }
      }
    }

    function scheduleRender() {
      clearTimeout(renderTimer);
      renderTimer = setTimeout(function () {
        if (composing) return;
        var line = currentLineEl();
        if (!line) return;
        var off = offsetInLine(line);
        // 선택 영역이 있으면(드래그 중) 다시 그리지 않음 — 선택이 풀려버림
        var sel = global.getSelection();
        if (sel && !sel.isCollapsed) return;
        renderLine(line, off);
        if (curLine === line) line.classList.add('cur');
      }, 200);
    }

    // ---- 실행취소 ----
    function commit() {
      clearTimeout(commitTimer);
      var now = getValue();
      if (now === committed) return;
      undoStack.push({ text: committed, start: selBeforeChange.start, end: selBeforeChange.end });
      if (undoStack.length > 120) undoStack.shift();
      redoStack.length = 0;
      committed = now;
    }
    // 우리가 직접 글자를 바꾸기(툴바·표 명령·지우기 보호) 직전 상태를 실행취소 목록에 넣음.
    // commit()만으로는 안 됨 — commit()은 "지금 DOM과 committed가 다를 때"만 넣는데,
    // 바꾸기 직전에는 둘이 같아서 아무것도 안 쌓였고, 그래서 0.19.0까지는 툴바로 굵게를
    // 넣은 뒤 Ctrl+Z를 눌러도 되돌아가지 않았음 (2026-08-15 발견·수정)
    function pushUndo(oldText, start, end) {
      if (undoStack.length && undoStack[undoStack.length - 1].text === oldText) return;
      undoStack.push({ text: oldText, start: start, end: end });
      if (undoStack.length > 120) undoStack.shift();
      redoStack.length = 0;
    }
    function scheduleCommit() {
      clearTimeout(commitTimer);
      commitTimer = setTimeout(commit, 600);
    }
    function restore(entry) {
      renderAll(entry.text);
      committed = entry.text;
      setSel(entry.start, entry.end);
      root.dispatchEvent(new Event('input', { bubbles: true }));
    }
    function undo() {
      commit();
      if (!undoStack.length) return;
      var cur = getSel();
      redoStack.push({ text: committed, start: cur.start, end: cur.end });
      restore(undoStack.pop());
    }
    function redo() {
      commit();
      if (!redoStack.length) return;
      var cur = getSel();
      undoStack.push({ text: committed, start: cur.start, end: cur.end });
      restore(redoStack.pop());
    }

    // ---- 글자 바꿔치기 (textarea.setRangeText 대체) ----
    function replaceRange(start, end, text, mode) {
      commit();
      var v = getValue();
      start = Math.max(0, Math.min(start, v.length));
      end = Math.max(start, Math.min(end, v.length));
      var next = v.slice(0, start) + text + v.slice(end);
      if (next === v) return;
      pushUndo(v, start, end);
      renderAll(next);
      if (mode === 'start') setSel(start, start);
      else if (mode === 'select') setSel(start, start + text.length);
      else setSel(start + text.length, start + text.length);
      committed = next;
      root.dispatchEvent(new Event('input', { bubbles: true }));
    }

    // ---- 이벤트 ----
    root.addEventListener('compositionstart', function () { composing = true; });
    root.addEventListener('compositionend', function () {
      composing = false;
      scheduleRender();
      scheduleCommit();
    });

    root.addEventListener('input', function () {
      if (busy) return;
      normalize();
      root.classList.toggle('is-empty', getValue() === '');
      if (composing) return;
      scheduleRender();
      scheduleCommit();
    });

    root.addEventListener('keydown', function (e) {
      if (e.isComposing) return;
      var ctrl = e.ctrlKey || e.metaKey;
      if (ctrl && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault();
        if (e.shiftKey) redo(); else undo();
        return;
      }
      if (ctrl && (e.key === 'y' || e.key === 'Y')) { e.preventDefault(); redo(); return; }
      // 브라우저 기본 굵게/기울임/밑줄은 <b> 태그를 심어버리므로 막음(툴바 명령으로 대체됨)
      if (ctrl && 'biu'.indexOf(String(e.key).toLowerCase()) !== -1) { e.preventDefault(); return; }
      if (e.key === 'Tab' && !plainMode()) {
        // 표 안에서만 탭이 "다음 칸". 표 밖에서는 원래대로 두어 다른 기능을 안 건드림
        if (handleTableTab(e.shiftKey)) { e.preventDefault(); return; }
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        if (!plainMode() && handleImageEnter()) return;
        if (!plainMode() && handleTableEnter()) return;
        var s = getSel();
        replaceRange(s.start, s.end, '\n');
        return;
      }
      if (e.key === 'Backspace' || e.key === 'Delete') {
        // 이미지가 표보다 먼저 — 선택이 둘 다 걸쳐 있어도 이미지 쪽이 줄 전체를 챙긴 뒤
        // 표를 아는 지우기(deleteRangeSafely)로 넘기기 때문에 순서가 이래야 안전함
        if (!plainMode() && handleImageDelete(e.key === 'Backspace')) { e.preventDefault(); return; }
        if (!plainMode() && handleTableDelete(e.key === 'Backspace')) { e.preventDefault(); return; }
        if (handleDeleteKey(e.key === 'Backspace')) e.preventDefault();
        return;
      }
      // 그림 위에서 글자를 치면 그림 아래 새 줄로 빠져나감 (한글 조합 첫 키도 여기서 걸림)
      if (!plainMode() && !ctrl && !e.altKey) {
        var k = e.key;
        if ((k && k.length === 1) || k === 'Process' || e.keyCode === 229) escapeImageLineForTyping();
      }
    });

    // 표를 가로질러 선택한 상태에서 글자를 치면 브라우저가 세로줄(|)까지 지워버림.
    // 그래서 그 경우만 직접 지우고 넣음(표 밖은 원래 동작 그대로)
    root.addEventListener('beforeinput', function (e) {
      if (busy || plainMode()) return;
      if (e.inputType !== 'insertText' || e.data == null) return;
      var s = getSel();
      if (s.start === s.end) return;
      // 이미지 줄에 걸친 선택 위에 글자를 치면 그 줄 전체가 함께 사라지도록 넓혀줌
      var iinfo = scanLines(getValue());
      if (selectionTouchesImage(iinfo, s.start, s.end)) {
        var ex = expandOverImages(iinfo, s.start, s.end) || { a: s.start, b: s.end };
        e.preventDefault();
        deleteRangeSafely(ex.a, ex.b, e.data);
        return;
      }
      if (!selectionTouchesTable(s.start, s.end)) return;
      e.preventDefault();
      deleteRangeSafely(s.start, s.end, e.data);
    });

    // 붙여넣기: 서식이 딸려 들어오면 DOM이 오염되므로 항상 글자만 넣음
    // (이미지/표 붙여넣기는 memo.js 쪽에서 먼저 처리하고 preventDefault 함)
    root.addEventListener('paste', function (e) {
      if (e.defaultPrevented) return;
      // 이미지·표 붙여넣기는 memo.js 쪽 처리(별도 첨부/표로 들어감)에 넘김
      if (e.clipboardData) {
        var html = e.clipboardData.getData('text/html') || '';
        if (/<table/i.test(html)) return;
        var items = Array.prototype.slice.call(e.clipboardData.items || []);
        if (items.some(function (it) { return it.type && it.type.indexOf('image/') === 0; })) return;
      }
      var text = e.clipboardData ? e.clipboardData.getData('text/plain') : '';
      if (!text) return;
      e.preventDefault();
      var s = getSel();
      text = text.replace(/\r\n?/g, '\n');
      if (!plainMode()) {
        // 커서가 그림 위에 있으면 그림 글자 사이에 끼워넣지 않고 그림 아래 줄에 붙임
        var pinfo = scanLines(getValue());
        var pli = caretImageLine(pinfo, s.start);
        if (pli !== -1 && s.start === s.end) {
          replaceRange(pinfo[pli].e, pinfo[pli].e, '\n' + text);
          return;
        }
        if (s.start !== s.end && selectionTouchesImage(pinfo, s.start, s.end)) {
          var pex = expandOverImages(pinfo, s.start, s.end) || { a: s.start, b: s.end };
          deleteRangeSafely(pex.a, pex.b, text);
          return;
        }
      }
      replaceRange(s.start, s.end, text);
    });

    root.addEventListener('drop', function (e) { e.preventDefault(); });

    // ---- 체크리스트 체크박스 켜고 끄기 ----
    // 체크박스는 그림일 뿐이고 진짜 상태는 줄 앞의 "- [ ] / - [x]" 글자가 가지고 있음.
    // 그래서 누르면 그 글자를 바꿔치기하고 줄을 다시 그림(저장은 input 이벤트로 이어짐)
    function lineStartOffset(line) {
      var acc = 0;
      for (var i = 0; i < root.children.length; i++) {
        if (root.children[i] === line) return acc;
        acc += root.children[i].textContent.length + 1;
      }
      return 0;
    }

    function toggleTaskLine(line) {
      var t = serialize(line, []).text;
      var m = /^(\s*[-*+][ \t]+\[)([ xX])(\])/.exec(t);
      if (!m) return;
      var next = m[1] + (m[2] === ' ' ? 'x' : ' ') + m[3] + t.slice(m[0].length);
      var keep = getSel();
      var s = lineStartOffset(line);
      replaceRange(s, s + t.length, next);
      setSel(keep.start, keep.end);   // 줄 길이가 그대로라 커서 자리도 그대로 유지됨
    }

    // 누를 때 포커스가 튀지 않게 mousedown 기본동작을 막고, click에서 처리
    root.addEventListener('mousedown', function (e) {
      if (e.target && e.target.classList && e.target.classList.contains('md-checkbox')) e.preventDefault();
    });
    root.addEventListener('click', function (e) {
      var el = e.target;
      if (!el || !el.classList) return;
      // 그림을 누르면 그림그리기 창을 염 (memo.js가 넘겨준 함수)
      if (el.classList.contains('md-img')) {
        e.preventDefault();
        if (imageClick) imageClick(el.alt, el);
        return;
      }
      if (!el.classList.contains('md-checkbox')) return;
      e.preventDefault();
      var line = lineOf(el);
      if (line) toggleTaskLine(line);
    });

    /* ---- 그림 크기 손잡이 ----
       끄는 동안에는 화면에서만 폭을 바꾸고, 손을 떼는 순간 줄 글자를 "![[이름|폭]]"로
       다시 씀. 높이는 저장하지 않음(원본 비율 자동) — 찌그러질 수가 없음.
       mousedown 기본동작을 막는 이유: contenteditable은 누르는 순간 선택이 풀림 */
    var imageClick = null;
    root.addEventListener('mousedown', function (e) {
      var h = e.target;
      if (!h || !h.classList || !h.classList.contains('md-img-resize')) return;
      e.preventDefault();
      e.stopPropagation();
      var box = h.parentNode;
      var img = box ? box.querySelector('img') : null;
      var line = lineOf(box);
      if (!img || !line) return;

      var startX = e.clientX;
      var startW = img.offsetWidth;
      var maxW = Math.max(60, root.clientWidth - 8);
      var curW = startW;

      function onMove(ev) {
        curW = Math.max(40, Math.min(Math.round(startW + (ev.clientX - startX)), maxW));
        img.style.width = curW + 'px';
      }
      function onUp() {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        var t = serialize(line, []).text;
        var im = parseImageLine(t);
        if (!im) return;
        var next = im.lead + '![[' + im.name + '|' + curW + ']]' + im.trail;
        if (next === t) return;
        var st = lineStartOffset(line);
        replaceRange(st, st + t.length, next);
      }
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });

    // 본문에서 커서가 빠져나가면 기호를 다시 숨김(편집 중이 아닐 땐 깔끔하게 보이게)
    root.addEventListener('blur', function () {
      if (composing || !curLine) return;
      var prev = curLine;
      curLine = null;
      if (prev.parentNode === root) {
        prev.classList.remove('cur');
        renderLine(prev, null);
      }
    });

    document.addEventListener('selectionchange', function () {
      if (busy) return;
      var sel = global.getSelection();
      if (!sel || sel.rangeCount === 0 || !root.contains(sel.anchorNode)) return;
      selBeforeChange = getSel();
      var line = currentLineEl();
      if (line === curLine) return;
      var prev = curLine;
      curLine = line;
      if (prev && prev.parentNode === root) {
        prev.classList.remove('cur');
        if (!composing) renderLine(prev, null);
      }
      if (line) line.classList.add('cur');
    });

    // ---- textarea 흉내내기 껍데기 ----
    var api = {};
    Object.defineProperty(api, 'value', {
      get: function () { return getValue(); },
      set: function (v) { setValue(v); root.classList.toggle('is-empty', getValue() === ''); },
    });
    Object.defineProperty(api, 'selectionStart', { get: function () { return getSel().start; } });
    Object.defineProperty(api, 'selectionEnd', { get: function () { return getSel().end; } });
    Object.defineProperty(api, 'placeholder', {
      get: function () { return placeholder; },
      set: function (v) { placeholder = v || ''; root.setAttribute('data-placeholder', placeholder); },
    });
    Object.defineProperty(api, 'readOnly', {
      get: function () { return root.getAttribute('contenteditable') !== 'true'; },
      set: function (v) { root.setAttribute('contenteditable', v ? 'false' : 'true'); },
    });
    api.setRangeText = function (text, start, end, mode) {
      if (start == null) { var s = getSel(); start = s.start; end = s.end; }
      replaceRange(start, end, text, mode);
    };
    api.setSelectionRange = function (start, end) { setSel(start, end); };
    api.select = function () { setSel(0, getValue().length); };
    api.undo = undo;
    api.redo = redo;
    api.refresh = function () { var v = getValue(); renderAll(v); committed = v; };
    api.isMdEditor = true;
    // ---- 표 (memo.js 툴바가 씀) ----
    api.insertTable = insertTable;
    api.tableCommand = tableOps;
    api.tableAtCaret = function () {
      if (plainMode()) return null;   // MD 기능을 꺼두면 표도 글자로만 보이므로 버튼을 띄우지 않음
      var c = tableCtx();
      if (!c) return null;
      var rowEls = [];
      for (var i = c.ext.a; i <= c.ext.b; i++) if (!c.info[i].sep) rowEls.push(i);
      var lineEl = root.children[c.li] || null;
      var cellEl = lineEl ? lineEl.querySelectorAll('.md-cell')[c.ci] || null : null;
      return {
        cols: c.info[c.ext.a].row.cells.length,
        rows: rowEls.length,
        onSepRow: !!c.item.sep,
        firstLineEl: root.children[c.ext.a] || null,
        lastLineEl: root.children[c.ext.b] || null,
        lineEl: lineEl,     // 커서가 있는 줄(행 버튼을 이 줄 높이에 맞춤)
        cellEl: cellEl,     // 커서가 있는 칸(열 버튼을 이 칸 가로 위치에 맞춤)
      };
    };
    // ---- 이미지 (memo.js가 씀) ----
    // 그림을 눌렀을 때 할 일(그림그리기 창 열기)을 memo.js가 넘겨줌
    api.setImageClick = function (fn) { imageClick = fn; };
    // 커서 자리에 그림 한 줄을 넣음. 그림 줄 위에 있으면 그 아래에 넣음
    api.insertImage = function (name, width) {
      var s = getSel();
      var info = scanLines(getValue());
      var li = lineIndexAt(info, s.start);
      var block = '![[' + name + (width > 0 ? '|' + Math.round(width) : '') + ']]';
      if (!info[li].img && info[li].text.trim() === '') {
        // 빈 줄이면 그 줄을 그림으로 바꾸고, 마지막 줄이면 아래에 쓸 자리를 하나 만들어줌
        var tail = li >= info.length - 1 ? '\n' : '';
        replaceRange(info[li].s, info[li].e, block + tail);
        return true;
      }
      var at = info[li].e;
      var tail2 = li >= info.length - 1 ? '\n' : '';
      replaceRange(at, at, '\n' + block + tail2);
      return true;
    };
    api.tableTextAtCaret = function () {
      var c = tableCtx();
      if (!c) return null;
      var out = [];
      for (var i = c.ext.a; i <= c.ext.b; i++) {
        if (c.info[i].sep) continue;
        out.push(c.info[i].row.cells.map(function (x) {
          return x.text.replace(/\\\|/g, '|').trim();
        }));
      }
      return out;
    };

    setValue('');

    return new Proxy(root, {
      get: function (target, prop) {
        if (prop in api) return api[prop];
        var v = target[prop];
        return typeof v === 'function' ? v.bind(target) : v;
      },
      set: function (target, prop, value) {
        if (prop in api) { api[prop] = value; return true; }
        target[prop] = value;
        return true;
      },
      has: function (target, prop) { return (prop in api) || (prop in target); },
    });
  }

  // 파일 이름 → 화면 주소를 찾아주는 함수를 memo.js가 등록함.
  // 편집기를 만들기 전에 등록해야 첫 그리기부터 그림이 보임
  createMdEditor.setImageResolver = function (fn) { imageSrcOf = fn; };

  global.createMdEditor = createMdEditor;
})(window);
