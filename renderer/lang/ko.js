// 한국어 언어 파일
// 화면에 보이는 한글 문구를 코드에서 분리해 이 파일에 모아둠(다국어 지원을 위한 준비 작업).
// 나중에 다른 언어를 추가하려면 이 파일과 같은 형식으로 새 파일(예: en.js)을 하나 더 만들면 됨.
// 지금은 한국어 파일만 있고, 실제로 다른 언어를 쓰는 기능은 아직 없음 — 화면은 이전과 동일하게 한글로 보임.

const LANG = {
  // 메모 연결 팝업(renderer/memoLink)
  memoLink: {
    windowTitle: '메모 연결',
    popupTitle: '연결할 메모를 고르세요',
    popupHint: '이미 옵시디언으로 내보낸 메모만 나와요(아직 안 내보낸 메모는 정확한 파일명을 몰라서 목록에 없어요).',
    searchPlaceholder: '제목/주제로 검색',
    cancelButton: '취소',
    noSearchResult: '검색 결과가 없어요.',
    noExportedMemo: '아직 옵시디언으로 내보낸 메모가 없어요.',
    uncategorized: '미분류',
    noTitle: '(제목없음)'
  },

  // 검색 팝업(renderer/search)
  search: {
    windowTitle: '검색',
    popupTitle: '메모 검색',
    popupHint: '제목과 본문 내용에서 찾아요.',
    searchPlaceholder: '검색어를 입력하세요',
    closeButton: '닫기',
    noSearchResult: '검색 결과가 없어요.',
    noMemos: '작성된 메모가 없어요.',
    uncategorized: '미분류',
    noTitle: '제목없음'
  },

  // 환영 화면(renderer/welcome) — 최초 실행 시(또는 트레이 메뉴 "환영 화면 다시 보기")에만 뜨는 안내 화면
  welcome: {
    windowTitle: '환영합니다',
    page0: {
      title: 'Memo.md에 오신 걸<br />환영해요',
      desc: '바탕화면에 항상 떠있는 메모장이에요. 몇 장만 넘기면<br />핵심 기능을 바로 알 수 있어요.'
    },
    page1: {
      mockWidgetTitle: '위젯',
      mockTopic1: '일',
      mockTopic2: '업',
      mockTopic3: '아',
      mockListItem1: '📄 오늘 할 일',
      mockListItem2: '📄 회의 메모',
      title: '주제별로 정리되는 위젯',
      desc: '화면 한쪽에 늘 떠있는 위젯에서 주제 아이콘을 클릭해<br />새 메모를 만들고, 목록을 펼쳐 메모를 바로 열고 닫을 수 있어요.',
      note: '💡 <b>메모를 쓰려면 먼저 주제가 있어야 해요.</b> 위젯에 아직 주제 아이콘이 없다면, <b>설정</b> → <b>주제관리</b>에서 먼저<br />주제를 하나 만들어주세요.'
    },
    page2: {
      mockChip: '업무',
      mockMemoTitle: '회의 메모',
      checklistItem1: '우유 사기',
      checklistItem2: '병원 예약',
      title: '마크다운 서식 &amp; 체크리스트',
      desc: '굵게·기울임 버튼을 누르면 마크다운 기호(<b>**</b>, <b>*</b> 등)가 붙어요. 이미지는 그림판처럼 자유롭게 배치할 수 있고요.<br />체크리스트 버튼을 누르면 적어둔 줄들이 진짜 체크박스 목록으로 바뀌어서, 체크하면 취소선이 그어져요.'
    },
    page3: {
      mockFilename: '업무_회의메모_20260710_001.md',
      mockExportBtn: 'MD내보내기',
      title: 'MD 파일로 내보내기',
      desc: '메모를 마크다운(.md) 파일로 저장해요. 옵시디언 없이도<br />쓸 수 있고, Vault 폴더로 지정하면 옵시디언과 바로 연동돼요. txt 파일로 저장하거나, txt·md 파일을 불러와<br />메모에 넣을 수도 있어요.'
    },
    page4: {
      title: '마크다운 기능을 사용할까요?',
      desc: '서식 도구, 메모 연결, MD내보내기, 상위 주제 같은 기능이에요. 꺼두면 심플한 메모장으로만 쓸 수 있어요. <b>나중에 설정 &gt; MD설정 탭에서 언제든 바꿀 수 있어요.</b>',
      btnOn: '사용할게요',
      btnOff: '그냥 메모장으로만'
    },
    page5: {
      title: '이제 설정에서<br />더 다듬어보세요',
      desc: '트레이 메뉴의 <b>도움말</b>과 <b>설정</b>에서 더 많은 기능을 확인할 수 있고, <b>환영 화면 다시 보기</b>로 이 화면도 언제든 다시 볼 수 있어요.'
    },
    navPrev: '이전',
    navNext: '다음',
    navStart: '시작하기'
  },

  // 위젯(renderer/widget) — 항상 화면에 떠있는 메인 창
  // {name}/{title}/{count}/{label} 같은 { } 표시는 실제 값으로 바뀌는 자리표시자
  widget: {
    windowTitle: '위젯',
    titleText: '메모 위젯',
    dragHandleTitle: '드래그해서 위젯 이동',
    handleOnlyToggleOn: '손잡이만 남기고 더 축소',
    handleOnlyToggleOff: '원래 접힘 상태로 되돌리기',
    settingsTitle: '설정',
    searchTitle: '메모 검색',
    hideAllTitle: '모든 메모 숨기기/보이기',
    confirmCancel: '취소',
    confirmConfirm: '확인',

    titlebarTitleCollapsed: '더블클릭하면 펼쳐져요',
    titlebarTitleExpanded: '더블클릭하면 접혀요',
    pinTitleOn: '위젯 항상 위에 표시 중 (클릭하면 해제)',
    pinTitleOff: '위젯 항상 위에 표시 (클릭하면 고정)',
    emptyTopicsHint: '설정에서 주제를 등록해보세요',
    dragGripTitle: '드래그해서 순서 바꾸기',
    iconBtnTitle: '{name} - 새 메모 / Ctrl+클릭: 보이는 메모 앞으로 가져오기',
    iconBtnTitleCollapsed: '{name} - 클릭: 새 메모 / 더블클릭: 이 주제 메모 숨기기·보이기 / Ctrl+클릭: 보이는 메모 앞으로 가져오기',
    topicHiddenOn: '이 주제 메모 숨김',
    topicHiddenOff: '이 주제 메모 보임',
    topicPinOn: '이 주제 항상위 해제',
    topicPinOff: '이 주제 메모 항상 위에 표시',
    unhideButton: '숨김해제',
    noTitle: '제목없음',
    memoVisibleOn: '이 메모 보임',
    memoVisibleOff: '이 메모 안 열려있음/숨김',
    memoLinkOutgoing: '이 메모가 다른 메모를 링크함',
    memoLinkIncoming: '다른 메모가 이 메모를 링크함',
    deleteMemoTitle: '메모 삭제',
    deleteConfirmTitle: '"{title}" 메모를 삭제할까요?',
    deleteConfirmHint: '휴지통으로 이동하며, 60일 안에는 설정 > 휴지통에서 복구할 수 있어요.',
    deleteConfirmButton: '삭제',
    hideToggleOn: '숨긴 주제 감추기',
    hideToggleOff: '숨긴 주제 보기 ({count}개)',
    hideAllLabelHide: '모든 메모 숨기기',
    hideAllLabelShow: '모든 메모 보이기',
    hideAllLabelRevert: '누르기 전 상태로 되돌리기',
    hideAllTitleTemplate: '누르면: {label}'
  },

  // 설정창(renderer/settings) — 탭이 여러 개인 큰 창. 탭별로 묶어서 정리함
  settings: {
    windowTitle: '설정',
    tabs: {
      topics: '주제관리',
      general: '일반',
      widget: '위젯',
      md: 'MD설정',
      edit: '편집바 특수문자',
      trash: '휴지통',
      help: '도움말'
    },
    common: {
      delete: '삭제',
      confirmCancel: '취소',
      confirmConfirm: '확인'
    },
    saveBar: {
      cancel: '취소',
      apply: '적용',
      save: '저장',
      savedStatus: '저장되었습니다',
      appliedStatus: '적용되었습니다'
    },

    // 주제관리 탭
    topics: {
      heading: '주제 관리',
      mainHint: '<b>먼저 주제를 작성해야 메모를 할 수 있어요.</b> 주제를 정한 후, 그 주제에 맞는 메모를 작성하세요. 주제별로 색상과 텍스트를 정할 수 있고, 위젯에 생기는 주제 버튼으로 바로바로 메모할 수 있어요. 메모를 주제별로 관리할 수 있어 메모 관리가 수월해요.',
      mdTipHint: 'MD 기능이 켜져 있으면, 주제 이름에 <code>/</code>를 넣어 옵시디언에서 중첩 폴더·중첩 태그로 나뉘게 만들 수 있어요. 예: <code>회사/프로젝트A</code>',
      categoryFieldLabel: '카테고리(상위주제) — 주제를 묶을 이름표. 실제 메모를 쓰는 곳은 아니에요.',
      newCategoryPlaceholder: '새 카테고리 이름',
      addCategoryButton: '카테고리 추가',
      categoryEmptyHint: '등록된 카테고리가 없습니다.',
      categoryNameRequiredError: '카테고리 이름을 입력하세요.',
      deleteCategoryConfirmTitle: '"{name}" 카테고리를 삭제할까요?',
      deleteCategoryConfirmHint: '이미 이 이름으로 만들어진 주제/메모는 그대로 유지됩니다.',
      editNameHint: '이름을 클릭하면 수정할 수 있습니다.',
      noParentOption: '(없음 - 최상위 주제)',
      parentFieldLabel: '상위 주제',
      nameFieldLabel: '주제 이름',
      namePlaceholder: '주제 이름',
      descFieldLabel: '짧은 설명',
      descPlaceholder: '짧은 설명',
      defaultTitleFieldLabel: '기본 제목',
      defaultTitlePlaceholder: '선택, 새 메모에 자동으로 채워짐',
      charFieldLabel: '글자(1~2)',
      charPlaceholder: '예: 업무',
      iconBgLabel: '아이콘배경',
      iconTextLabel: '아이콘글자',
      memoBgLabel: '메모배경',
      addTopicButton: '추가',
      topicNameRequiredError: '주제 이름을 입력하세요.',
      topicEmptyHint: '등록된 주제가 없습니다.',
      hiddenSuffix: ' (숨김)',
      deleteTopicConfirmTitle: '"{name}" 주제를 삭제할까요?',
      deleteTopicConfirmHint: '기존 메모는 유지됩니다.',
      editDescPlaceholder: '설명',
      editDefaultTitlePlaceholder: '기본 제목(선택, 새 메모에 자동으로 채워짐)',
      editHiddenLabel: '위젯에서 숨김',
      editCancelButton: '취소',
      editSaveButton: '저장'
    },

    // 일반 탭
    general: {
      heading: '일반',
      autoLaunchLabel: '윈도우 시작 시 자동 실행',
      multiModeLabel: '메모 여러 개 동시에 띄우기 (끄면 1개만)',
      confirmMemoDeleteLabel: '메모 삭제할 때 확인창 표시',
      shortcutHeading: '단축키',
      shortcutHint: '다른 프로그램을 쓰는 중에도 눌러서 새 메모를 바로 만들 수 있어요. "직전에 작업하던 주제"에 만들어져요. 입력칸을 클릭한 뒤 원하는 키 조합을 누르면 자동으로 채워져요.',
      shortcutPlaceholder: '입력칸을 클릭하고 키를 눌러주세요',
      shortcutClearButton: '끄기',
      opacityHeading: '화면 투명도',
      opacityHint: '위젯과 모든 메모창에 동일하게 적용됩니다.',
      backupHeading: '백업 / 전체 내보내기',
      backupHint1: '작성한 모든 메모를 원하는 폴더에 원하는 형식(txt/md)으로 한꺼번에 저장해요.',
      exportAllButton: '전체 메모 내보내기',
      backupHint2: '주제별로 하위폴더가 자동으로 나뉘어요.',
      restoreButton: '백업에서 복구하기',
      backupHint3: '백업 폴더를 골라서 그 안의 메모들을 새 주제/메모로 다시 만들어와요. 항상 "추가"만 되고, 기존 주제/메모는 지우거나 덮어쓰지 않아요.',
      exportAllDone: '{count}개 메모를 저장했어요.',
      restoreConfirmTitle: '백업 폴더를 골라서 그 안의 메모들을 새 주제/메모로 불러올까요?',
      restoreConfirmHint: '기존 주제/메모는 지워지거나 바뀌지 않고, 항상 "추가"만 됩니다.',
      restoreDone: '메모 {count}개 복구됨 (새 주제 {topicCount}개 포함)',
      storageHeading: '저장공간 정리',
      storageHint: '메모나 템플릿에서 지운 이미지/첨부파일은 대부분 그때 같이 지워지지만, 예전 버전에서 쌓였거나 놓친 파일이 남아있을 수 있어요. 지금 어떤 메모/템플릿에서도 안 쓰이는 파일만 골라서 정리해요(쓰이고 있는 파일은 안전하게 그대로 둬요).',
      sweepButton: '안 쓰는 첨부파일 정리',
      sweepInProgress: '정리 중...',
      sweepFailed: '정리 실패',
      sweepDone: '{removed}개 정리했어요 (전체 {total}개 중)',
      sweepNone: '정리할 파일이 없어요',
      autoBackupHeading: '자동 백업',
      autoBackupHint: 'md(마크다운) 형식으로, 지정한 폴더에 주제별 하위폴더로 나눠서 항상 같은 파일에 덮어써져요(예전 백업이 계속 쌓이지 않음).',
      autoBackupEnabledLabel: '자동 백업 사용',
      autoBackupFolderPlaceholder: '자동 백업할 폴더를 선택하세요',
      chooseFolderButton: '폴더 선택',
      intervalLabel: '주기',
      intervalDaily: '매일',
      interval12h: '12시간마다',
      interval6h: '6시간마다',
      intervalEveryLaunch: '프로그램 켤 때마다'
    },

    // 위젯 탭 (설정창 안의 탭 — 위젯 자체 문구는 LANG.widget에 따로 있음)
    widgetTab: {
      heading: '위젯',
      colorGroupLabel: '색상',
      titlebarColorLabel: '위젯 상단바 색상',
      sizeGroupLabel: '크기·위치',
      autoResizeLabel: '주제 늘어나면 위젯 자동 확장',
      widthLabel: '가로',
      heightLabel: '세로',
      gestureGroupLabel: '동작(클릭 제스처)',
      singleClickLabel: '한 번 클릭',
      doubleClickLabel: '두 번 클릭',
      gestureHint: '이 클릭 동작은 위젯의 <b>주제칸</b>을 클릭할 때만 적용돼요. 펼쳐진 목록 안의 개별 메모를 클릭하면, 이 설정과 상관없이 항상 "안 열려있으면 열고 열려있으면 닫기"로 동작해요.',
      gestureNone: '아무 동작 안함',
      gestureList: '목록 펼치기',
      gestureExpandAll: '메모 전체 열기/숨기기',
      gestureNewMemo: '새 메모 생성'
    },

    // MD설정 탭
    mdTab: {
      heading: 'MD 기능',
      mdFeatureLabel: 'MD 기능 사용',
      mdFeatureHint: '끄면 메모창의 서식 도구, 메모 연결, MD내보내기 버튼, 처리방식 버튼, 주제관리의 "상위 주제" 선택이 전부 숨겨져요. 순수한 메모장으로만 쓰고 싶을 때 꺼두세요.',
      vaultHeading: '저장 폴더',
      vaultPlaceholder: '볼트 폴더를 지정하세요',
      chooseVaultButton: '폴더 선택',
      postSaveHeading: 'MD내보내기 후 동작 (기본값)',
      postSaveKeepLabel: '바탕화면에 유지',
      postSaveDeleteLabel: '자동 닫기(삭제)',
      postSaveHint: '메모창에서 개별적으로 다르게 설정하면 그게 우선 적용됩니다.',
      exportModeHeading: 'MD내보내기 방식',
      autoExportLabel: '파일명 확인 없이 자동으로 내보내기',
      autoExportHint: '체크하면 MD내보내기를 눌렀을 때 파일명 확인창 없이 아래 규칙대로 바로 저장돼요. 체크 해제하면 지금처럼 저장 전에 파일명을 확인/수정할 수 있는 창이 떠요.',
      ruleHeading: 'MD내보내기 파일명 규칙',
      ruleHint1: '순서는 항상 주제 → 제목 → 날짜 → 번호로 고정이고, 아래에서 포함 여부와 구분자만 바꿀 수 있어요.',
      ruleHint2: '※ 이 규칙은 저장되는 <b>파일 이름 표기</b>만 바꿔요. 옵시디언 폴더/태그 정리(주제·카테고리 구조)는 이 설정과 상관없이 항상 자동으로 처리돼요.',
      includeTopicLabel: '주제 포함',
      includeTitleLabel: '제목 포함',
      includeDateLabel: '날짜 포함 (YYYYMMDD)',
      includeSeqLabel: '번호 포함 (001부터, 날짜를 포함하면 날짜 바뀔 때 리셋)',
      separatorLabel: '구분자',
      separatorUnderscore: '_ (밑줄)',
      separatorHyphen: '- (하이픈)',
      separatorSpace: '(공백)',
      exampleLabel: '예시:',
      exampleTopic: '일상',
      exampleTitle: '제목없음',
      exampleFallback: '메모'
    },

    // 편집바 특수문자 탭
    editTab: {
      heading: '편집바 특수문자',
      hint: '메모창 서식 툴바에 바로 눌러 넣을 수 있는 특수문자 버튼을 만들 수 있어요. 사용하고 싶은 특수문자를 직접 넣어주세요.',
      countLabel: '개수',
      charInputPlaceholder: '문자{n}',
      refHeading: '자주 쓰는 특수문자 모음',
      refHint: '여기서 원하는 문자를 마우스로 선택해서 복사(Ctrl+C)한 다음, 위 입력칸에 붙여넣어 등록하세요.',
      refShapes: '도형',
      refArrows: '화살표',
      refPunctuation: '문장부호',
      refBrackets: '괄호',
      refMath: '수학기호',
      refNumbers: '번호/숫자'
    },

    // 휴지통 탭
    trashTab: {
      heading: '휴지통',
      hint: '삭제한 메모가 60일간 여기 보관돼요. 그 안에는 복구할 수 있고, 60일이 지나면 자동으로 완전히 지워져요(복구 불가).',
      emptyButton: '휴지통 비우기',
      emptyListHint: '휴지통이 비어있습니다.',
      deletedTopicFallback: '(삭제된 주제)',
      noTitle: '제목없음',
      itemTooltip: '{title} — {topic} · 삭제일 {date} · {daysLeft}일 후 완전삭제',
      itemDesc: '{topic} · {date} 삭제 · {daysLeft}일 남음',
      restoreButton: '복구',
      permanentDeleteTitle: '완전삭제',
      permanentDeleteConfirmTitle: '"{title}" 메모를 완전히 삭제할까요?',
      permanentDeleteConfirmHint: '복구할 수 없습니다.',
      emptyConfirmTitle: '휴지통을 비울까요?',
      emptyConfirmHint: '메모 {count}개가 전부 복구할 수 없이 완전히 삭제됩니다.',
      emptyConfirmButton: '비우기'
    }
  },

  // 메모창(renderer/memo) — 실제로 글을 쓰는 창. 이 앱에서 가장 크고 문구가 많은 창
  // {name}/{fileName}/{message}/{ch}/{state} 같은 { } 표시는 실제 값으로 바뀌는 자리표시자
  memo: {
    windowTitle: '메모',
    topicChipTitle: '더블클릭해서 제목 입력',
    topicChipPlaceholder: '제목을 입력하세요',
    titlePlaceholder: '제목 입력',
    newMemoTitle: '같은 주제로 새 메모',
    colorPickerTitle: '메모 색상 변경',
    pinTitle: '항상 위에 표시 (이 메모만)',
    keepToggleBaseTitle: 'MD내보내기 후 이 메모를 어떻게 할지',
    deleteTitle: '메모 삭제',
    collapseTitle: '접기',
    expandTitle: '펼치기',
    closeTitle: '닫기',

    checklistAddButton: '+ 항목 추가',
    checklistRevertButton: '본문으로 되돌리기',
    checklistRevertButtonTitle: '체크리스트 전체를 본문 글자로 되돌려요(체크 표시는 사라져요)',
    checklistItemDeleteTitle: '항목 삭제',

    contentPlaceholder: '메모를 입력하세요...',
    checklistItemPlaceholder: '내용을 입력하세요',

    undoTitle: '실행 취소',
    redoTitle: '다시 실행',
    checklistCmdTitle: '선택한 줄들을 체크리스트로 만들기 (선택 안 하면 전체)',
    attachTitle: '파일/이미지 첨부',

    headingNormal: '본문',
    heading1: '제목1',
    heading2: '제목2',
    heading3: '제목3',
    listTitle: '글머리 목록',
    indentTitle: '들여쓰기',
    boldTitle: '굵게',
    italicTitle: '기울임',
    strikeTitle: '취소선',
    underlineTitle: '밑줄',
    highlightTitle: '형광펜',
    codeTitle: '코드',
    linkTitle: '링크(웹 주소)',
    supTitle: '위 첨자',
    subTitle: '아래 첨자',

    moveTopicTitle: '다른 주제로 이동',
    saveTemplateTitle: '템플릿으로 저장',
    copyTitle: '전체 내용 복사',
    importTitle: 'txt/md 파일 불러오기',
    exportTxtTitle: 'txt로 저장',
    memoLinkTitle: '메모 연결 (이미 내보낸 다른 메모와 링크)',
    exportButtonText: 'MD내보내기',

    exportModalTitle: '저장할 파일명을 확인/수정하세요',
    linkModalTitle: '연결할 주소(URL)를 입력하세요',
    moveTopicModalTitle: '이동할 주제를 고르세요',
    checklistRevertModalTitle: '체크리스트를 본문 글자로 되돌릴까요?',
    checklistRevertModalHint: '체크 표시는 사라져요.',
    checklistRevertConfirmButton: '되돌리기',
    templateModalTitle: '템플릿을 저장할 주제를 고르세요',
    templateModalHint: '본문+이미지+체크리스트+메모창 크기가 저장돼요(제목/일반 첨부파일은 제외). 그 주제로 새 메모를 만들면 자동으로 채워져요. 기존 템플릿이 있으면 덮어써요.',
    imageResizeNoticeTitle: '이미지는 자동으로 크기가 조정돼요',
    imageResizeNoticeHint: '가로가 1500px보다 큰 이미지는 저장할 때 자동으로 줄어들어요. 화질 차이는 거의 없고, 저장 공간과 메모리를 아낄 수 있어요. (gif·webp·svg는 그대로 저장돼요)',

    common: { cancel: '취소', confirm: '확인', delete: '삭제' },

    keepOverrideTitle: 'MD내보내기 후 "{state}"로 이 메모만 고정됨 (클릭하면 기본값을 따르도록 해제)',
    keepDefaultTitle: 'MD내보내기 후 기본값({state})을 따르는 중 (클릭하면 이 메모만 반대로 고정)',
    keepStateDelete: '전송후삭제',
    keepStateKeep: '유지',

    specialCharInsertTitle: '"{ch}" 삽입',

    imageDeleteTitle: '이미지 삭제',
    captionPlaceholder: '설명(선택)',
    captionTitle: '이 이미지에 대한 설명 (모서리를 드래그하면 크기, ⠿ 손잡이를 드래그하면 위치를 바꿀 수 있어요)',
    captionMoveHandleTitle: '설명칸 위치 옮기기 (드래그)',
    fileAttachDeleteTitle: '첨부 삭제',

    removeAttachmentConfirmTitle: '이 첨부를 삭제할까요?',

    copiedStatus: '복사됨',
    copyFailedStatus: '복사 실패',

    deleteConfirmTitle: '이 메모를 삭제할까요?',
    deleteConfirmHint: '휴지통으로 이동하며, 60일 안에는 설정 > 휴지통에서 복구할 수 있어요.',

    exportDoneOverwrite: 'MD내보내기 완료(덮어씀): {fileName}',
    exportDone: 'MD내보내기 완료: {fileName}',
    saveFailed: '저장 실패: {message}',

    moveTopicEmpty: '옮길 수 있는 다른 주제가 없어요.',
    templateEmpty: '저장할 수 있는 주제가 없어요.',
    templateSaved: '템플릿 저장됨',
    templateSaveFailed: '템플릿 저장 실패',

    untitledFallback: '메모',
    txtExportDone: 'txt 저장 완료: {fileName}',
    importDone: '{fileName} 불러옴',
    importOverwriteConfirmTitle: '현재 메모 내용을 불러온 파일 내용으로 덮어쓸까요?',
    importOverwriteButton: '덮어쓰기'
  }
};
