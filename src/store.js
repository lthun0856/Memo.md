// 데이터 저장소: settings.json, topics.json, memos.json 을 읽고 쓰는 역할만 담당
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const DATA_DIR = path.join(app.getPath('userData'), 'data');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const FILES = {
  settings: path.join(DATA_DIR, 'settings.json'),
  topics: path.join(DATA_DIR, 'topics.json'),
  // 상위주제(카테고리) 이름 목록. 실제 메모가 딸린 주제와는 별개로, 그냥 "이름표" 역할만 함.
  // 주제 만들 때 "상위 주제" 드롭다운을 여기서 채움 — 그래서 실제 주제를 지워도 드롭다운 목록은 안 사라짐.
  categories: path.join(DATA_DIR, 'categories.json'),
  memos: path.join(DATA_DIR, 'memos.json'),
  // MD내보내기 할 때마다 기록 남기는 로그. "메모 연결" 기능에서 링크 대상을 고를 때 씀.
  // 메모 자체가 나중에 삭제되거나(전송 후 자동삭제 설정 등) 해도, 이미 만들어진 옵시디언
  // 파일은 그대로 남아있으니 이 로그도 별도로 계속 남겨서 링크 대상으로 계속 쓸 수 있게 함
  exportLog: path.join(DATA_DIR, 'exportLog.json'),
  // 휴지통: 삭제한 메모를 바로 지우지 않고 여기로 옮겨서 보관(설정 > 휴지통 탭에서 복구 가능).
  // 각 항목은 메모 원본 데이터 + deletedAt(삭제 시각). 보관기한 지난 항목은
  // main.js의 cleanupExpiredTrash()가 앱 시작할 때 자동으로 완전히 지움
  trash: path.join(DATA_DIR, 'trash.json')
};

const DEFAULT_SETTINGS = {
  vaultPath: '',
  autoLaunch: false,
  multiMode: true,
  defaultPostSaveAction: 'keep', // 'keep' | 'delete'
  confirmMemoDelete: true, // 메모 삭제시 확인창을 띄울지 여부
  hasSeenWelcome: false, // 최초 실행 환영 화면을 이미 봤는지 (한번 보면 자동으로는 다시 안 뜸)
  hasSeenImageResizeNotice: false, // 이미지 자동 리사이즈 안내를 이미 봤는지 (첫 이미지 삽입 때 한 번만 안내)
  seedDataCreated: false, // 최초 실행시 예시 주제/메모를 이미 만들어놨는지 (한번 만들면 다시 안 만듦)
  opacity: 100, // 위젯+모든 메모창 공통 투명도 (100 = 불투명)
  widget: {
    autoResize: true,
    width: 260,
    height: 360,
    alwaysOnTop: true,
    collapsed: false,
    // 펼친 상태의 "진짜" 가로 크기. 접힘 상태에서는 주제 버튼 개수에 맞춰 width가 자동으로
    // 늘고 줄어드는데(위젯 접힘/펼침 가로 자동확장 기능), 그 임시 값이 펼친 상태의 폭까지
    // 덮어써버리지 않도록 height/expandedHeight와 똑같은 방식으로 분리해서 따로 저장함
    expandedWidth: 260,
    expandedHeight: 360,
    titlebarColor: '#2B2820', // 위젯 상단바 색상
    x: null, // 마지막 위젯 위치 (null이면 최초 기본 위치 사용)
    y: null
  },
  clickGesture: {
    single: 'list',    // 'list' | 'expandAll'
    double: 'expandAll'
  },
  exportNameRule: {
    // 옵시디언 내보내기 파일명 규칙: 순서는 항상 주제_제목_날짜_번호로 고정, 포함여부/구분자만 조절
    includeTopic: true,
    includeTitle: true,
    includeDate: true,
    includeSeq: true,
    separator: '_'
  },
  autoExportObsidian: false, // true면 MD내보내기 누를 때 파일명 확인창 없이 설정값 그대로 바로 저장
  specialChars: ['※', '☆', '★', '●', '◆'], // 메모창 서식 툴바에 노출할 특수문자 목록(설정에서 지정, 기본값 5개 미리 채워둠)
  mdFeatureEnabled: true, // MD/옵시디언 관련 기능(서식버튼, 메모연결, MD내보내기, 상위주제 드롭다운) 전체 on/off 마스터 스위치
  // 전역 단축키(다른 프로그램 쓰다가도 눌림)로 "새 메모 만들기"를 바로 실행. Electron accelerator
  // 문자열. 빈 문자열이면 단축키 사용 안 함.
  // (변경) 기본값이 Ctrl+Shift+N이었는데 이건 크롬 시크릿창 단축키라, 전역 등록이 크롬보다
  // 먼저 가로채서 시크릿창 대신 메모가 튀어나오는 문제가 있었음 → 안 겹치는 Ctrl+Alt+N으로 변경
  // (이미 설치해서 설정이 저장된 사용자는 기존 값 유지 — 설정에서 직접 바꿔야 함)
  newMemoShortcut: 'Control+Alt+N',
  autoBackup: {
    enabled: false,
    folderPath: '', // 자동 백업 저장 폴더(항상 이 폴더에 덮어씀)
    intervalHours: 24, // 24=매일, 12=12시간마다, 6=6시간마다, 0=프로그램 켤 때마다
    lastRunAt: null // 마지막으로 자동 백업이 실행된 시각(ISO 문자열) — 다음 실행 시점 계산용
  }
};

// ---- 데이터 안전장치 ----
// 예전엔 원본 파일에 바로 덮어썼기 때문에, 저장 도중 정전/강제종료가 나면 파일이 반쯤 깨질 수
// 있었고, 깨진 파일을 읽으면 "빈 데이터"로 취급한 채 다음 저장 때 빈 내용으로 덮어써서
// 메모 전체가 소리 없이 사라질 수 있는 경로가 있었음. 그래서:
// 1) 쓸 때: 임시파일(.tmp)에 전부 쓴 뒤 원본과 바꿔치기(rename) — 쓰다 죽어도 원본은 무사
// 2) 바꿔치기 직전: 직전 정상본을 .bak으로 한 부 보관
// 3) 읽을 때: 원본이 깨져 있으면 .bak에서 자동 복구하고, 깨진 원본은 .corrupt 파일로
//    보존해둠(그냥 버리지 않음 — 만약을 위한 수동 복구용)

function restoreFromBackup(filePath) {
  const bakPath = filePath + '.bak';
  try {
    if (!fs.existsSync(bakPath)) return null;
    const parsed = JSON.parse(fs.readFileSync(bakPath, 'utf-8'));
    // 깨진 원본을 지우지 않고 이름을 바꿔 보존한 뒤, 백업본을 원본 자리로 복구
    try {
      if (fs.existsSync(filePath)) {
        fs.renameSync(filePath, `${filePath}.corrupt-${Date.now()}`);
      }
      fs.copyFileSync(bakPath, filePath);
    } catch (err) {
      console.error('백업 복구 중 파일 교체 실패(데이터는 메모리로 복구됨):', filePath, err);
    }
    console.error('파일이 깨져 있어 백업본(.bak)에서 복구함:', filePath);
    return parsed;
  } catch (err) {
    console.error('백업본 읽기도 실패:', bakPath, err);
    return null;
  }
}

function readJson(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    console.error('읽기 실패:', filePath, err);
    const recovered = restoreFromBackup(filePath);
    if (recovered !== null) return recovered;
    // 백업본도 없으면 어쩔 수 없이 기본값 — 단, 깨진 원본은 .corrupt로 보존해서
    // 다음 저장이 일어나도 원래 내용이 완전히 사라지지는 않게 함
    try {
      if (fs.existsSync(filePath)) {
        fs.renameSync(filePath, `${filePath}.corrupt-${Date.now()}`);
      }
    } catch (renameErr) {
      console.error('깨진 파일 보존 실패:', filePath, renameErr);
    }
    return fallback;
  }
}

function writeJson(filePath, data) {
  const tmpPath = filePath + '.tmp';
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf-8');
  // 새 저장 방식에서 원본은 항상 "끝까지 다 써진 파일"이므로 안심하고 백업본으로 보관 가능
  try {
    if (fs.existsSync(filePath)) fs.copyFileSync(filePath, filePath + '.bak');
  } catch (err) {
    console.error('백업본 보관 실패(저장은 계속 진행):', filePath, err);
  }
  fs.renameSync(tmpPath, filePath);
}

module.exports = {
  getSettings() {
    return { ...DEFAULT_SETTINGS, ...readJson(FILES.settings, {}) };
  },
  saveSettings(settings) {
    writeJson(FILES.settings, settings);
    return settings;
  },
  getTopics() {
    return readJson(FILES.topics, []);
  },
  saveTopics(topics) {
    writeJson(FILES.topics, topics);
    return topics;
  },
  getCategories() {
    return readJson(FILES.categories, []);
  },
  saveCategories(categories) {
    writeJson(FILES.categories, categories);
    return categories;
  },
  getMemos() {
    return readJson(FILES.memos, []);
  },
  saveMemos(memos) {
    writeJson(FILES.memos, memos);
    return memos;
  },
  getTrash() {
    return readJson(FILES.trash, []);
  },
  saveTrash(trash) {
    writeJson(FILES.trash, trash);
    return trash;
  },
  getExportLog() {
    const log = readJson(FILES.exportLog, []);
    // (수정) 예전엔 같은 메모를 여러 번 내보낼 때마다 기록이 계속 새로 쌓였음(지금은 아래
    // addExportLogEntry에서 메모당 기록을 하나로 유지하도록 고쳤지만, 그 전에 이미 쌓인 중복은
    // 여기서 한 번 정리함 — 같은 memoId면 가장 최근(exportedAt) 것만 남김). memoId가 없는
    // 아주 예전 기록은 구분할 방법이 없어 손대지 않고 그대로 둠
    const latestByMemoId = new Map();
    const noMemoId = [];
    log.forEach((entry) => {
      if (!entry.memoId) {
        noMemoId.push(entry);
        return;
      }
      const existing = latestByMemoId.get(entry.memoId);
      if (!existing || new Date(entry.exportedAt) >= new Date(existing.exportedAt)) {
        latestByMemoId.set(entry.memoId, entry);
      }
    });
    const deduped = [...noMemoId, ...latestByMemoId.values()];
    if (deduped.length !== log.length) {
      writeJson(FILES.exportLog, deduped);
    }
    return deduped;
  },
  addExportLogEntry(entry) {
    const log = readJson(FILES.exportLog, []);
    // 같은 메모를 다시 내보낸 거면 새 줄로 쌓지 않고 기존 기록을 그 자리에서 갱신함
    // (메모당 "마지막으로 내보낸 파일"만 하나 남도록)
    const idx = entry.memoId ? log.findIndex((e) => e.memoId === entry.memoId) : -1;
    if (idx !== -1) {
      log[idx] = entry;
    } else {
      log.push(entry);
    }
    writeJson(FILES.exportLog, log);
    return log;
  }
};
