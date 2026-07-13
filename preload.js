const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // 설정
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (settings) => ipcRenderer.invoke('settings:save', settings),
  chooseVaultFolder: () => ipcRenderer.invoke('settings:chooseVaultFolder'),
  chooseBackupFolder: () => ipcRenderer.invoke('settings:chooseBackupFolder'),
  getScreenWorkArea: () => ipcRenderer.invoke('screen:getWorkArea'),

  // 주제
  getTopics: () => ipcRenderer.invoke('topics:getAll'),
  addTopic: (topic) => ipcRenderer.invoke('topics:add', topic),
  updateTopic: (topic) => ipcRenderer.invoke('topics:update', topic),
  deleteTopic: (topicId) => ipcRenderer.invoke('topics:delete', topicId),
  reorderTopics: (orderedIds) => ipcRenderer.invoke('topics:reorder', orderedIds),

  // 카테고리(상위주제) — 실제 메모가 딸린 주제와 별개인 이름표 목록
  getCategories: () => ipcRenderer.invoke('categories:getAll'),
  addCategory: (category) => ipcRenderer.invoke('categories:add', category),
  deleteCategory: (categoryId) => ipcRenderer.invoke('categories:delete', categoryId),

  // 메모
  getAllMemos: () => ipcRenderer.invoke('memos:getAll'),
  getMemosByTopic: (topicId) => ipcRenderer.invoke('memos:getByTopic', topicId),
  createNewMemo: (topicId) => ipcRenderer.invoke('memos:createNew', topicId),
  updateMemoContent: (memoId, content) =>
    ipcRenderer.invoke('memos:updateContent', { memoId, content }),
  setPostSaveAction: (memoId, action) =>
    ipcRenderer.invoke('memos:setPostSaveAction', { memoId, action }),
  setMemoTitle: (memoId, title) => ipcRenderer.invoke('memos:setTitle', { memoId, title }),
  setAlwaysOnTop: (memoId, value) =>
    ipcRenderer.invoke('memos:setAlwaysOnTop', { memoId, value }),
  setMemoCollapsed: (memoId, value) =>
    ipcRenderer.invoke('memos:setCollapsed', { memoId, value }),
  setMemoColor: (memoId, color) => ipcRenderer.invoke('memos:setColor', { memoId, color }),
  moveMemoToTopic: (memoId, topicId) => ipcRenderer.invoke('memos:setTopic', { memoId, topicId }),
  saveMemoAsTemplate: (memoId, topicId) =>
    ipcRenderer.invoke('memos:saveAsTemplate', { memoId, topicId }),
  setMemoChecklist: (memoId, checklist) =>
    ipcRenderer.invoke('memos:setChecklist', { memoId, checklist }),
  addAttachment: (memoId, attachment) =>
    ipcRenderer.invoke('memos:addAttachment', { memoId, attachment }),
  pickAttachments: () => ipcRenderer.invoke('attachments:pick'),
  getAttachmentPath: (storedName) => ipcRenderer.invoke('attachments:getPath', storedName),
  exportTxt: (content, suggestedName) =>
    ipcRenderer.invoke('files:exportTxt', { content, suggestedName }),
  importTextFile: () => ipcRenderer.invoke('files:importTextFile'),
  deleteMemo: (memoId) => ipcRenderer.invoke('memos:delete', memoId),
  openExistingMemo: (memoId) => ipcRenderer.invoke('memos:openExisting', memoId),
  toggleMemoOpen: (memoId) => ipcRenderer.invoke('memos:toggleOpen', memoId),
  toggleTopicOpen: (topicId) => ipcRenderer.invoke('memos:toggleTopicOpen', topicId),
  removeAttachment: (memoId, storedName) =>
    ipcRenderer.invoke('memos:removeAttachment', { memoId, storedName }),
  updateAttachmentSize: (memoId, storedName, width, height) =>
    ipcRenderer.invoke('memos:updateAttachmentSize', { memoId, storedName, width, height }),
  updateAttachmentPosition: (memoId, storedName, x, y) =>
    ipcRenderer.invoke('memos:updateAttachmentPosition', { memoId, storedName, x, y }),
  updateAttachmentCaption: (memoId, storedName, caption) =>
    ipcRenderer.invoke('memos:updateAttachmentCaption', { memoId, storedName, caption }),
  updateAttachmentCaptionSize: (memoId, storedName, width, height) =>
    ipcRenderer.invoke('memos:updateAttachmentCaptionSize', { memoId, storedName, width, height }),
  updateAttachmentCaptionOffset: (memoId, storedName, offsetX, offsetY) =>
    ipcRenderer.invoke('memos:updateAttachmentCaptionOffset', { memoId, storedName, offsetX, offsetY }),
  saveClipboardImage: (base64, ext) =>
    ipcRenderer.invoke('attachments:saveFromClipboard', { base64, ext }),
  toggleAllMemosVisibility: () => ipcRenderer.invoke('memos:toggleVisibility'),
  getVisibilityState: () => ipcRenderer.invoke('memos:getVisibilityState'),
  getHiddenTopics: () => ipcRenderer.invoke('memos:getHiddenTopics'),
  getVisibleMemoIds: () => ipcRenderer.invoke('memos:getVisibleMemoIds'),
  toggleTopicAlwaysOnTop: (topicId) => ipcRenderer.invoke('memos:toggleTopicAlwaysOnTop', topicId),
  getPinnedTopics: () => ipcRenderer.invoke('memos:getPinnedTopics'),
  toggleTopicFront: (topicId) => ipcRenderer.invoke('memos:toggleTopicFront', topicId),
  addAttachmentsFromPaths: (paths) => ipcRenderer.invoke('attachments:addFromPaths', paths),
  copyText: (text) => ipcRenderer.invoke('app:copyText', text),
  exportAllMemos: () => ipcRenderer.invoke('memos:exportAll'),
  restoreFromBackup: () => ipcRenderer.invoke('memos:restoreFromBackup'),
  sweepOrphanAttachments: () => ipcRenderer.invoke('attachments:sweepOrphans'),

  // 휴지통
  getTrash: () => ipcRenderer.invoke('trash:list'),
  restoreFromTrash: (memoId) => ipcRenderer.invoke('trash:restore', memoId),
  permanentlyDeleteFromTrash: (memoId) => ipcRenderer.invoke('trash:permanentDelete', memoId),
  emptyTrash: () => ipcRenderer.invoke('trash:empty'),

  // 옵시디언
  exportToObsidian: (memoId, customFileName, extraTags) =>
    ipcRenderer.invoke('obsidian:export', { memoId, customFileName, extraTags }),
  suggestObsidianFileName: (memoId) => ipcRenderer.invoke('obsidian:suggestFileName', memoId),
  getExportLog: () => ipcRenderer.invoke('obsidian:getExportLog'),

  // 창 제어
  closeMemoWindow: (memoId) => ipcRenderer.invoke('window:closeMemo', memoId),
  openSettingsWindow: () => ipcRenderer.invoke('window:openSettings'),
  openWidgetWindow: () => ipcRenderer.invoke('window:openWidget'),
  openHelpWindow: () => ipcRenderer.invoke('window:openHelp'),
  refocusSelf: () => ipcRenderer.invoke('window:refocusSelf'),
  resizeWidget: (width, height) => ipcRenderer.invoke('widget:resize', { width, height }),
  setWidgetAlwaysOnTop: (value) => ipcRenderer.invoke('widget:setAlwaysOnTop', value),
  setWidgetCollapsed: (value) => ipcRenderer.invoke('widget:setCollapsed', value),
  openMemoLinkWindow: (memoId) => ipcRenderer.invoke('window:openMemoLink', memoId),
  closeMemoLinkWindow: () => ipcRenderer.invoke('window:closeMemoLink'),
  chooseMemoLink: (fileNameNoExt) => ipcRenderer.invoke('memoLink:choose', fileNameNoExt),
  openSearchWindow: () => ipcRenderer.invoke('window:openSearch'),
  closeSearchWindow: () => ipcRenderer.invoke('window:closeSearch'),
  chooseSearchResult: (memoId) => ipcRenderer.invoke('search:choose', memoId),

  // 메인 -> 렌더러 이벤트 구독
  onMemoInit: (callback) => ipcRenderer.on('memo:init', (e, memo) => callback(memo)),
  onTopicsUpdated: (callback) => ipcRenderer.on('topics:updated', () => callback()),
  onMemosUpdated: (callback) => ipcRenderer.on('memos:updated', () => callback()),
  onSettingsOpened: (callback) => ipcRenderer.on('app:settingsOpened', () => callback()),
  onSettingsClosed: (callback) => ipcRenderer.on('app:settingsClosed', () => callback()),
  onWelcomeOpened: (callback) => ipcRenderer.on('app:welcomeOpened', () => callback()),
  onWelcomeClosed: (callback) => ipcRenderer.on('app:welcomeClosed', () => callback()),
  onSettingsUpdated: (callback) => ipcRenderer.on('settings:updated', () => callback()),
  onWidgetSizeChanged: (callback) =>
    ipcRenderer.on('widget:sizeChanged', (e, data) => callback(data)),
  onScreenWorkAreaChanged: (callback) =>
    ipcRenderer.on('screen:workAreaChanged', (e, workArea) => callback(workArea)),
  onForceBlur: (callback) => ipcRenderer.on('memo:forceBlur', () => callback()),
  onMemoColorSync: (callback) => ipcRenderer.on('memo:colorSync', (e, color) => callback(color)),
  onMemoLinkSelected: (callback) =>
    ipcRenderer.on('memoLink:selected', (e, fileNameNoExt) => callback(fileNameNoExt))
});
