/* ============================================================================
   migrate.js — 예전 메모를 새 구조로 바꾸는 변환 규칙 (위지윅 2단계)

   여기에는 "글자를 어떻게 바꾸는가"만 들어있고 파일 저장·백업은 main.js가 함.
   이렇게 나눠둔 이유: 이 부분만 따로 테스트할 수 있어야 하기 때문(되돌릴 수 없는 작업이라
   반드시 검증하고 내보내야 함).
   ========================================================================== */

// 이 메모가 체크리스트 변환 대상인가
function needsChecklistMigration(memo) {
  return !!(memo && Array.isArray(memo.checklist) && memo.checklist.length > 0);
}

// 체크리스트 항목들을 "- [ ] 할일" 줄로 만들어 본문 맨 앞에 붙인 새 본문을 돌려줌.
// 맨 앞에 붙이는 이유: 예전 화면에서도 체크리스트가 본문보다 위에 있었기 때문에
// 태훈님 눈에 익은 순서를 그대로 유지함(인계서 "합치는 순서" 참고).
function buildContentWithChecklist(memo) {
  const items = (memo && memo.checklist) || [];
  const lines = items
    .map((it) => {
      // 항목 안에 줄바꿈이 있으면 한 줄로 합침(체크박스 한 줄 = 항목 하나)
      const text = String((it && it.text) || '').replace(/\s*\r?\n\s*/g, ' ').trim();
      if (!text) return '';
      return `- [${it && it.checked ? 'x' : ' '}] ${text}`;
    })
    .filter(Boolean);

  const body = String((memo && memo.content) || '');
  if (!lines.length) return body;

  const block = lines.join('\n');
  return body.trim() ? `${block}\n\n${body}` : block;
}

/* ---- 위지윅 2-2단계: 표를 본문 안으로 ------------------------------------
   예전 메모는 표가 본문과 별개인 memo.tables 배열에 들어있었음(칸마다 <input>으로 그림).
   이제는 본문에 "| 가 | 나 |" 줄로 직접 들어간다.

   [태훈님 확정 2026-08-15] 붙이는 자리는 본문 맨 앞.
   예전 메모창에서 표가 본문 위에 있었기 때문에, 메모를 열었을 때 보이던 자리와 거의 같게 함
   (체크리스트를 맨 앞에 붙인 것과 같은 이유).
   [없앤 것] 열 폭(colWidths)은 마크다운에 저장할 방법이 없어서 버림 — 칸 너비는 자동.
   -------------------------------------------------------------------------- */

function needsTableMigration(memo) {
  return !!(memo && Array.isArray(memo.tables) && memo.tables.length > 0);
}

// 표 하나 → 마크다운 표 글자
function tableToMarkdown(table) {
  const rows = (table && table.rows) || [];
  if (!rows.length || !rows[0] || !rows[0].length) return '';
  // 칸 안의 | 는 칸 구분으로 읽히면 안 되므로 \| 로 바꾸고, 줄바꿈은 칸 하나 = 한 줄이라 공백으로 폄
  const esc = (s) => String(s == null ? '' : s).replace(/\|/g, '\\|').replace(/\s*\r?\n\s*/g, ' ').trim();
  const cols = rows[0].length;
  const line = (cells) => `| ${cells.join(' | ')} |`;
  const out = [line(rows[0].map(esc))];
  out.push(line(new Array(cols).fill('---')));
  for (let r = 1; r < rows.length; r += 1) {
    const cells = [];
    for (let c = 0; c < cols; c += 1) cells.push(esc(rows[r] && rows[r][c]));
    out.push(line(cells));
  }
  return out.join('\n');
}

function buildContentWithTables(memo) {
  const blocks = ((memo && memo.tables) || []).map(tableToMarkdown).filter(Boolean);
  const body = String((memo && memo.content) || '');
  if (!blocks.length) return body;
  const block = blocks.join('\n\n');
  return body.trim() ? `${block}\n\n${body}` : block;
}

/* ---- 위지윅 3단계: 이미지를 본문 안으로 --------------------------------
   예전 메모는 이미지가 본문과 완전히 별개였음 — canvas-layer 위에 절대좌표
   (displayX/displayY)로 얹혀 있어서 글을 써도 안 밀렸고 아무 데나 끌어다 놓을 수 있었음.
   이제는 본문에 "![[그림.png|400]]" 한 줄로 들어간다.

   [태훈님 확정 2026-08-15]
   - 붙이는 자리는 본문 맨 앞 (체크리스트·표와 같은 규칙. 예전 화면에서도 이미지가
     본문 위쪽에 떠 있었으므로 열었을 때 보이던 자리와 비슷하게 됨)
   - 크기는 옵시디언 문법 |폭 으로 저장. 이 앱은 원래부터 ![[파일]] 옵시디언 임베드로
     내보내고 있었으므로 새로 생기는 호환 부담이 없음
   - 캡션은 이미지 바로 아랫줄에 *기울임* 글자로. MD 내보내기(exporter.js)가 이미
     같은 모양으로 만들고 있었으므로 화면과 md 파일이 완전히 같아짐
   [없앤 것] 위치(displayX/Y)와 높이(displayHeight)는 마크다운에 저장할 방법이 없어서 버림.
   다만 attachments의 필드 자체는 지우지 않고 남겨둠 — 변환이 건너뛰어진 메모가 있을 수 있음.
   -------------------------------------------------------------------------- */

// 본문에 이미 참조된 이미지는 다시 붙이지 않음("![[이름" 으로 검사 — 뒤에 |폭 이 붙어도 잡힘)
function isImageReferenced(content, storedName) {
  return String(content || '').includes(`![[${storedName}`);
}

function needsImageMigration(memo) {
  if (!memo || !Array.isArray(memo.attachments)) return false;
  return memo.attachments.some(
    (a) => a && a.isImage && a.storedName && !isImageReferenced(memo.content, a.storedName)
  );
}

// 이미지 첨부 하나 → 본문 글자 (캡션이 있으면 바로 아랫줄까지)
function imageToMarkdown(a) {
  if (!a || !a.storedName) return '';
  const width = Number(a.displayWidth);
  const size = Number.isFinite(width) && width > 0 ? `|${Math.round(width)}` : '';
  const embed = `![[${a.storedName}${size}]]`;
  // 캡션 안 줄바꿈은 한 줄로 폄(한 줄 = 캡션 하나). * 는 기울임 기호와 부딪히므로 지움
  const caption = String(a.caption || '')
    .replace(/\s*\r?\n\s*/g, ' ')
    .replace(/\*/g, '')
    .trim();
  return caption ? `${embed}\n*${caption}*` : embed;
}

function buildContentWithImages(memo) {
  const body = String((memo && memo.content) || '');
  const blocks = ((memo && memo.attachments) || [])
    .filter((a) => a && a.isImage && a.storedName && !isImageReferenced(body, a.storedName))
    .map(imageToMarkdown)
    .filter(Boolean);
  if (!blocks.length) return body;
  const block = blocks.join('\n\n');
  return body.trim() ? `${block}\n\n${body}` : block;
}

module.exports = {
  needsChecklistMigration,
  buildContentWithChecklist,
  needsTableMigration,
  buildContentWithTables,
  tableToMarkdown,
  needsImageMigration,
  buildContentWithImages,
  imageToMarkdown,
};
