// 메모를 옵시디언 Vault 에 Markdown(.md) 파일로 저장하는 역할만 담당
const fs = require('fs');
const path = require('path');

// 파일명으로 못쓰는 문자 제거
function sanitizeFileName(name) {
  const cleaned = name.replace(/[\\/:*?"<>|\n\r]/g, ' ').trim();
  return cleaned.length ? cleaned.slice(0, 80) : '제목없음';
}

// 첫 줄을 제목으로 추출
function extractTitle(content) {
  const firstLine = (content || '').split('\n')[0] || '';
  return sanitizeFileName(firstLine || '메모');
}

// 같은 이름 있으면 (2), (3) ... 붙이기
function getUniqueFilePath(folder, baseName) {
  let candidate = path.join(folder, `${baseName}.md`);
  let counter = 2;
  while (fs.existsSync(candidate)) {
    candidate = path.join(folder, `${baseName} (${counter}).md`);
    counter += 1;
  }
  return candidate;
}

function pad3(n) {
  return String(n).padStart(3, '0');
}

function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// 주제 이름에 "/"가 있으면 옵시디언에서 중첩 폴더/중첩 태그로 인식되게 세그먼트별로만
// 정리하고 "/"는 구분자로 그대로 살려둠 (파일명 자체에는 "/"를 못 쓰므로 이건 폴더/태그 전용)
function sanitizeFolderPath(name) {
  return name
    .split('/')
    .map((seg) => sanitizeFileName(seg))
    .filter(Boolean)
    .join('/');
}

// 옵시디언 태그는 공백을 못 쓰므로 세그먼트 안의 공백만 하이픈으로 바꾸고, "/"는 그대로 둬서
// 옵시디언이 중첩 태그(예: #업무/마케팅)로 인식하게 함
function sanitizeTagPath(name) {
  return name
    .split('/')
    .map((seg) => sanitizeFileName(seg).replace(/\s+/g, '-'))
    .filter(Boolean)
    .join('/');
}

// 체크리스트 항목 배열을 옵시디언(및 일반 마크다운 뷰어)이 그대로 인식하는
// GFM 체크리스트 문법(- [ ] / - [x])으로 변환
function serializeChecklist(items) {
  if (!items || !items.length) return '';
  return items
    .filter((it) => it && it.text && it.text.trim())
    .map((it) => `- [${it.checked ? 'x' : ' '}] ${it.text.trim()}`)
    .join('\n');
}

// 표 칸 글자 안의 "|"(칸 구분자)와 줄바꿈은 마크다운 표 문법을 깨뜨리므로 이스케이프/치환함
function serializeTableCell(text) {
  return (text || '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

// 표 데이터(rows[0]=머리글 줄) 하나를 표준 마크다운 표 문법(머리글+구분줄(필수)+데이터줄)으로 변환
function serializeTable(table) {
  const rows = table && Array.isArray(table.rows) ? table.rows : [];
  if (!rows.length || !rows[0].length) return '';
  const cols = rows[0].length;
  const headerLine = `|${rows[0].map(serializeTableCell).join('|')}|`;
  const dividerLine = `|${Array(cols).fill('---').join('|')}|`;
  const dataLines = rows.slice(1).map((r) => `|${r.map(serializeTableCell).join('|')}|`);
  return [headerLine, dividerLine, ...dataLines].join('\n');
}

// (0.19.1 안내) 체크리스트·표는 이제 본문 안에 글자로 들어가므로 memo.checklist / memo.tables는
// 항상 빈 배열이고, 아래 코드는 평소엔 아무 일도 하지 않는다.
// 그래도 지우지 않고 남겨둠 — 변환(main.js)은 백업을 못 뜨면 안전을 위해 건너뛰는데, 그 경우
// 예전 구조가 그대로 남아있게 된다. 그때 이 코드가 없으면 내보낸 md에서 표가 통째로 빠진다.
// 표 목록 전체를 변환. 표가 여러 개면 표 사이는 빈 줄로 구분(serializeChecklist와 같은 자리에 씀)
function serializeTables(tables) {
  if (!tables || !tables.length) return '';
  return tables.map(serializeTable).filter(Boolean).join('\n\n');
}

function todayDateStr() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

// 일정 날짜("YYYY-MM-DDTHH:mm")를 파일명용 "YYYYMMDD"로. 값이 없거나 형식이 이상하면 null.
function scheduleDateStr(scheduleAt) {
  const d = (scheduleAt || '').slice(0, 10).replace(/-/g, '');
  return /^\d{8}$/.test(d) ? d : null;
}

// 일정 날짜를 옵시디언 "date" 속성값으로. 시간이 00:00이면 날짜만(2026-05-06),
// 시간이 있으면 옵시디언 날짜&시간 형식(2026-05-06T12:30:00)으로. 값이 없으면 null.
function scheduleDateProp(scheduleAt) {
  if (!scheduleAt || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(scheduleAt)) return null;
  const [d, t] = scheduleAt.split('T');
  return (!t || t === '00:00') ? d : `${d}T${t}:00`;
}

/**
 * 파일명 규칙(기본값): 주제_제목(없으면 제목없음)_YYYYMMDD_001
 * 순서는 항상 주제 → 제목 → 날짜 → 번호로 고정되며, rule로 각 항목의 포함 여부와 구분자만 조절 가능.
 * 채번(001, 002...)은 같은 조합의 파일이 이미 있으면 다음 번호로, 날짜를 포함하는 경우
 * 날짜가 바뀌면 그 날짜의 파일이 아직 없으니 자동으로 001부터 다시 시작됨
 */
function suggestFileName({ vaultPath, topic, title, rule, scheduleAt }) {
  const r = rule || {};
  const sep = typeof r.separator === 'string' ? r.separator : '_';
  const topicPart = sanitizeFileName(topic ? topic.name : '미분류');

  const parts = [];
  if (r.includeTopic !== false) parts.push(topicPart);
  if (r.includeTitle !== false) {
    parts.push(sanitizeFileName(title && title.trim() ? title.trim() : '제목없음'));
  }
  // 날짜 부분: 일정 날짜를 정해둔 메모면 저장날짜 대신 그 일정 날짜(YYYYMMDD)를 씀
  if (r.includeDate !== false) parts.push(scheduleDateStr(scheduleAt) || todayDateStr());

  const base = parts.length ? parts.join(sep) : '메모';

  if (r.includeSeq === false) return base;

  const prefix = `${base}${sep}`;
  let seq = 1;
  if (vaultPath) {
    // 채번을 셀 때도 실제 저장되는 폴더(주제 이름에 "/"가 있으면 중첩 폴더)를 그대로 봐야 함
    const folder = topic ? path.join(vaultPath, sanitizeFolderPath(topic.name)) : vaultPath;
    if (fs.existsSync(folder)) {
      const re = new RegExp(`^${escapeRegExp(prefix)}(\\d{3})\\.md$`);
      let maxSeq = 0;
      fs.readdirSync(folder).forEach((name) => {
        const m = name.match(re);
        if (m) maxSeq = Math.max(maxSeq, parseInt(m[1], 10));
      });
      seq = maxSeq + 1;
    }
  }
  return `${prefix}${pad3(seq)}`;
}

// 본문에 아직 없는 첨부 이미지를 "![[파일명]]" 임베드 구문으로, 캡션(설명)을 달아둔 이미지는
// 그 바로 아래 줄에 기울임체로 캡션을 붙여서 돌려줌. 단일 옵시디언 내보내기와 전체
// 백업(exportAllMemos/exportAllMemosOverwrite) 양쪽에서 공용으로 씀
// (0.19.2) 이미 본문에 있는지 검사할 때 "![[파일명]]" 로 딱 맞춰 보면 안 됨 —
// 3단계부터 크기가 붙은 "![[파일명|400]]" 형태가 생겨서, 그대로 두면 본문에 멀쩡히 있는
// 그림을 "없다"고 보고 md 맨 뒤에 한 번 더 붙여버림. 그래서 여는 부분까지만 검사함
function buildMissingEmbedBlocks(content, attachments) {
  return (attachments || [])
    .filter((a) => !(content || '').includes(`![[${a.storedName}`))
    .map((a) => {
      const embed = `![[${a.storedName}]]`;
      return a.caption && a.caption.trim() ? `${embed}\n*${a.caption.trim()}*` : embed;
    });
}

// 첨부파일 원본을 목적지 폴더 안 "첨부" 하위폴더로 복사. 옵시디언 단일 내보내기뿐 아니라
// 전체 백업/자동 백업에서도 이미지가 같이 빠지지 않고 백업되도록 공용으로 씀
function copyAttachmentsTo(destBaseDir, attachments, attachDir) {
  if (!attachments || !attachments.length || !attachDir) return;
  const attachFolder = path.join(destBaseDir, '첨부');
  if (!fs.existsSync(attachFolder)) fs.mkdirSync(attachFolder, { recursive: true });
  attachments.forEach((a) => {
    const src = path.join(attachDir, a.storedName);
    const dest = path.join(attachFolder, a.storedName);
    if (fs.existsSync(src)) {
      try {
        fs.copyFileSync(src, dest);
      } catch (err) {
        // 파일 하나 복사 실패했다고 전체 백업을 멈추지 않고 조용히 건너뜀
        console.error('첨부 복사 실패:', a.storedName, err);
      }
    }
  });
}

/**
 * 메모를 옵시디언 vault 에 저장
 * @param {object} params
 * @param {string} params.vaultPath - Vault 루트 경로
 * @param {string} params.content - 메모 본문
 * @param {object|null} params.topic - { name, description } 또는 null(미분류)
 * @param {string[]} params.extraTags - 추가 태그 목록
 * @param {string} [params.customFileName] - 사용자가 직접 지정한 파일명(선택)
 * @param {Array<{storedName:string}>} [params.attachments] - 첨부파일 목록
 * @param {string} [params.attachDir] - 첨부파일 임시 저장 폴더 경로
 * @returns {{filePath: string, fileName: string}}
 */
function exportMemoToObsidian({
  vaultPath,
  content,
  topic,
  extraTags = [],
  customFileName,
  attachments = [],
  checklist = [],
  tables = [],
  attachDir,
  overwritePath,
  scheduleAt
}) {
  if (!vaultPath) {
    throw new Error('Vault 경로가 설정되지 않았습니다.');
  }

  // 0. 첨부파일을 Vault 안 "첨부" 폴더로 복사
  copyAttachmentsTo(vaultPath, attachments, attachDir);

  // 1. 저장 위치 결정
  // - 이 메모를 예전에 이미 한 번 내보낸 적 있으면(overwritePath) 새 파일을 만들지 않고
  //   그 파일에 그대로 덮어씀 — 같은 메모를 다시 내보낼 때마다 (2), (3)... 파일이 계속
  //   쌓이던 문제를 없애기 위함
  // - 처음 내보내는 메모면 기존 방식대로 주제별 폴더 + 겹치지 않는 파일명을 새로 정함
  let filePath;
  if (overwritePath) {
    filePath = overwritePath;
    const overwriteFolder = path.dirname(filePath);
    if (!fs.existsSync(overwriteFolder)) {
      fs.mkdirSync(overwriteFolder, { recursive: true });
    }
  } else {
    const folder = topic
      ? path.join(vaultPath, sanitizeFolderPath(topic.name))
      : vaultPath;
    if (!fs.existsSync(folder)) {
      fs.mkdirSync(folder, { recursive: true });
    }
    const baseName = customFileName
      ? sanitizeFileName(customFileName)
      : extractTitle(content);
    filePath = getUniqueFilePath(folder, baseName);
  }
  const fileName = path.basename(filePath);

  // 3. 태그 목록 구성 (주제 태그 + 추가 태그, 중복 제거) — 주제 이름에 "/"가 있으면
  // 옵시디언이 중첩 태그(예: #업무/마케팅)로 인식하도록 그대로 살려서 태그로 씀
  const tags = [];
  if (topic) tags.push(sanitizeTagPath(topic.name));
  extraTags.forEach((t) => {
    const clean = t.trim().replace(/\s+/g, '-');
    if (clean && !tags.includes(clean)) tags.push(clean);
  });

  // 4. frontmatter + 본문 조립
  const frontmatterLines = ['---'];
  if (tags.length) {
    frontmatterLines.push('tags:');
    tags.forEach((t) => frontmatterLines.push(`  - ${t}`));
  }
  frontmatterLines.push(`created: ${new Date().toISOString()}`);
  // 일정 날짜를 정해둔 메모면 옵시디언 "date" 속성으로 넣어줌(속성 패널/달력 플러그인이 인식)
  const dateProp = scheduleDateProp(scheduleAt);
  if (dateProp) frontmatterLines.push(`date: ${dateProp}`);
  frontmatterLines.push('---', '');

  const inlineTags = tags.map((t) => `#${t}`).join(' ');
  const bodyParts = [frontmatterLines.join('\n')];
  if (inlineTags) bodyParts.push(inlineTags, '');
  bodyParts.push(content || '');

  // 체크리스트 항목은 본문 뒤에 옵시디언이 그대로 체크박스로 인식하는 마크다운 문법으로 붙여줌
  const checklistText = serializeChecklist(checklist);
  if (checklistText) bodyParts.push('', checklistText);

  // 표도 체크리스트와 같은 자리에, 옵시디언이 그대로 표로 인식하는 마크다운 문법으로 붙여줌
  const tablesText = serializeTables(tables);
  if (tablesText) bodyParts.push('', tablesText);

  // 본문 텍스트에 아직 참조되지 않은 첨부파일은 자동으로 임베드 구문(+캡션이 있으면 그 아래에)을 덧붙임
  // (앱 안에서는 텍스트에 마크다운 구문을 넣지 않고 화면에 이미지로만 배치하므로,
  //  실제 옵시디언 노트에 보이려면 내보낼 때 여기서 채워줘야 함)
  const missingEmbedBlocks = buildMissingEmbedBlocks(content, attachments);
  if (missingEmbedBlocks.length) {
    bodyParts.push('', missingEmbedBlocks.join('\n\n'));
  }

  fs.writeFileSync(filePath, bodyParts.join('\n'), 'utf-8');

  return { filePath, fileName };
}

function exportAsTxt(filePath, content) {
  fs.writeFileSync(filePath, content || '', 'utf-8');
  return { filePath, fileName: path.basename(filePath) };
}

// getUniqueFilePath와 같은 규칙(이미 있으면 (2), (3)...)이지만 확장자를 골라 쓸 수 있게 한 버전
function getUniqueFilePathWithExt(folder, baseName, ext) {
  let candidate = path.join(folder, `${baseName}.${ext}`);
  let counter = 2;
  while (fs.existsSync(candidate)) {
    candidate = path.join(folder, `${baseName} (${counter}).${ext}`);
    counter += 1;
  }
  return candidate;
}

/**
 * 작성된 모든 메모를 사용자가 고른 폴더에 주제별 하위폴더로 나눠서 한꺼번에 저장(백업/전체 내보내기).
 * 첨부 이미지도 "첨부" 폴더로 같이 복사되고, 캡션(설명)을 달아둔 이미지는 임베드 구문 아래에
 * 캡션이 같이 붙어서 저장됨(이미지+설명이 백업에서 빠지지 않게)
 * @param {object} params
 * @param {string} params.baseDir - 사용자가 고른 저장 폴더
 * @param {Array} params.memos - 전체 메모 목록
 * @param {Array} params.topics - 전체 주제 목록
 * @param {string[]} params.formats - ['txt'] | ['md'] | ['txt','md']
 * @param {string} [params.attachDir] - 첨부파일 원본이 실제로 저장된 폴더 경로
 * @returns {{count: number, folder: string}}
 */
function exportAllMemos({ baseDir, memos, topics, formats, attachDir }) {
  let count = 0;
  memos.forEach((memo) => {
    const topic = topics.find((t) => t.id === memo.topicId);
    const topicName = topic ? topic.name : '미분류';
    // 주제 이름에 "/"가 있으면 옵시디언 내보내기와 똑같이 중첩 폴더로 나눠 저장
    const folder = path.join(baseDir, sanitizeFolderPath(topicName));
    if (!fs.existsSync(folder)) fs.mkdirSync(folder, { recursive: true });

    const checklistText = serializeChecklist(memo.checklist);
    const tablesText = serializeTables(memo.tables);
    const extraText = [checklistText, tablesText].filter(Boolean).join('\n\n');
    const content = (memo.content || '');
    let fullContent = extraText
      ? `${content.replace(/\s+$/, '')}\n\n${extraText}`
      : content;

    const embedBlocks = buildMissingEmbedBlocks(fullContent, memo.attachments);
    if (embedBlocks.length) {
      fullContent = `${fullContent.replace(/\s+$/, '')}\n\n${embedBlocks.join('\n\n')}`;
    }
    copyAttachmentsTo(baseDir, memo.attachments, attachDir);

    const baseName = memo.title && memo.title.trim()
      ? sanitizeFileName(memo.title.trim())
      : extractTitle(memo.content);

    formats.forEach((ext) => {
      const filePath = getUniqueFilePathWithExt(folder, baseName, ext);
      fs.writeFileSync(filePath, fullContent, 'utf-8');
    });
    count += 1;
  });
  return { count, folder: baseDir };
}

// 메모 id 앞 8자리만 잘라 파일명 뒤에 붙이는 짧은 식별코드. 제목이 같은 메모가 여러 개 있어도
// 서로 다른 파일로 안전하게 구분되고, 같은 메모는 항상 같은 파일명이라 다음 백업 때 정확히 덮어써짐
function shortMemoId(id) {
  return (id || '').replace(/-/g, '').slice(0, 8) || 'noid';
}

/**
 * 자동 백업 전용: exportAllMemos와 달리 "항상 같은 파일에 덮어쓰기" 방식.
 * (2), (3) 처럼 번호를 새로 붙이지 않고, 메모마다 고정된 파일명을 써서 반복 실행해도 그 파일 그대로 덮어씀.
 * 첨부 이미지/캡션도 exportAllMemos와 똑같이 같이 백업됨
 * @param {object} params
 * @param {string} params.baseDir
 * @param {Array} params.memos
 * @param {Array} params.topics
 * @param {string} params.format - 'txt' | 'md'
 * @param {string} [params.attachDir] - 첨부파일 원본이 실제로 저장된 폴더 경로
 * @returns {{count: number, folder: string}}
 */
function exportAllMemosOverwrite({ baseDir, memos, topics, format, attachDir }) {
  let count = 0;
  memos.forEach((memo) => {
    const topic = topics.find((t) => t.id === memo.topicId);
    const topicName = topic ? topic.name : '미분류';
    const folder = path.join(baseDir, sanitizeFolderPath(topicName));
    if (!fs.existsSync(folder)) fs.mkdirSync(folder, { recursive: true });

    const checklistText = serializeChecklist(memo.checklist);
    const tablesText = serializeTables(memo.tables);
    const extraText = [checklistText, tablesText].filter(Boolean).join('\n\n');
    const content = memo.content || '';
    let fullContent = extraText
      ? `${content.replace(/\s+$/, '')}\n\n${extraText}`
      : content;

    const embedBlocks = buildMissingEmbedBlocks(fullContent, memo.attachments);
    if (embedBlocks.length) {
      fullContent = `${fullContent.replace(/\s+$/, '')}\n\n${embedBlocks.join('\n\n')}`;
    }
    copyAttachmentsTo(baseDir, memo.attachments, attachDir);

    const titlePart = memo.title && memo.title.trim()
      ? sanitizeFileName(memo.title.trim())
      : extractTitle(memo.content);
    const baseName = `${titlePart}_${shortMemoId(memo.id)}`;
    const filePath = path.join(folder, `${baseName}.${format}`);
    fs.writeFileSync(filePath, fullContent, 'utf-8');
    count += 1;
  });
  return { count, folder: baseDir };
}

module.exports = {
  exportMemoToObsidian,
  exportAsTxt,
  extractTitle,
  sanitizeFileName,
  suggestFileName,
  exportAllMemos,
  exportAllMemosOverwrite
};
