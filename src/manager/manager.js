import {
  CAPTURE_SCOPES,
  MESSAGE_ACTIONS,
  SESSION_KIND_LABELS
} from "../shared/constants.js";
import {
  collectSessionUrls,
  createSessionFromUrls,
  getSessionStats,
  validateSessionSnapshot
} from "../shared/session.js";
import {
  downloadText,
  formatDateTime,
  openExtensionDetails,
  safeFilename,
  sendMessage,
  sessionToText
} from "../shared/ui.js";
import { parseTextImport } from "../shared/urls.js";

const elements = {
  permissionNotices: document.querySelector("#permission-notices"),
  librarySummary: document.querySelector("#library-summary"),
  search: document.querySelector("#search-input"),
  kind: document.querySelector("#kind-filter"),
  deleteStart: document.querySelector("#delete-start"),
  deleteEnd: document.querySelector("#delete-end"),
  deleteRange: document.querySelector("#delete-range"),
  list: document.querySelector("#session-list"),
  sessionDialog: document.querySelector("#session-dialog"),
  sessionDialogTitle: document.querySelector("#session-dialog-title"),
  sessionDialogMeta: document.querySelector("#session-dialog-meta"),
  sessionTree: document.querySelector("#session-tree"),
  importDialog: document.querySelector("#import-dialog"),
  importFile: document.querySelector("#import-file"),
  importText: document.querySelector("#import-text"),
  importIncognitoRow: document.querySelector("#import-incognito-row"),
  importIncognito: document.querySelector("#import-incognito"),
  importPreview: document.querySelector("#import-preview"),
  resultDialog: document.querySelector("#result-dialog"),
  resultTitle: document.querySelector("#result-title"),
  resultContent: document.querySelector("#result-content"),
  toast: document.querySelector("#toast")
};

const state = {
  selectedSession: null,
  importPreview: null,
  searchTimer: null,
  loadSequence: 0,
  toastTimer: null
};

document.addEventListener("click", async (event) => {
  const closeButton = event.target.closest("[data-close-dialog]");
  if (closeButton) {
    closeButton.closest("dialog")?.close();
    return;
  }

  const permissionButton = event.target.closest("[data-open-permissions]");
  if (permissionButton) {
    await openExtensionDetails();
    return;
  }

  const saveButton = event.target.closest("[data-save-scope]");
  if (saveButton) {
    await saveCurrentState(saveButton);
    return;
  }

  const sessionButton = event.target.closest("[data-session-action]");
  if (sessionButton) {
    await handleSessionAction(sessionButton);
    return;
  }

  const detailButton = event.target.closest("[data-detail-action]");
  if (detailButton) {
    await handleDetailAction(detailButton);
    return;
  }

  const importButton = event.target.closest("[data-import-action]");
  if (importButton) {
    await handleImportAction(importButton);
  }
});

document.querySelector("#open-import").addEventListener("click", () => elements.importDialog.showModal());
document.querySelector("#parse-import").addEventListener("click", parseImport);
elements.search.addEventListener("input", () => {
  window.clearTimeout(state.searchTimer);
  state.searchTimer = window.setTimeout(loadSessions, 250);
});
elements.kind.addEventListener("change", loadSessions);
elements.importFile.addEventListener("change", loadImportFile);
elements.deleteRange.addEventListener("click", deleteSessionsByTimeRange);

void initialize();

async function initialize() {
  await Promise.all([loadStatus(), loadSessions()]);
  if (location.hash === "#import") {
    elements.importDialog.showModal();
  }
}

async function loadStatus() {
  try {
    const status = await sendMessage(MESSAGE_ACTIONS.GET_STATUS);
    renderPermissions(status);
  } catch (error) {
    showToast(`权限状态读取失败：${error.message}`, true);
  }
}

async function deleteSessionsByTimeRange() {
  const startAt = Date.parse(elements.deleteStart.value);
  const endAt = Date.parse(elements.deleteEnd.value);
  if (!Number.isFinite(startAt) || !Number.isFinite(endAt)) {
    showToast("请选择完整的开始和结束时间", true);
    return;
  }
  if (startAt > endAt) {
    showToast("开始时间不能晚于结束时间", true);
    return;
  }
  if (!window.confirm("确定删除该时间范围内的所有会话吗？此操作无法撤销。")) return;

  await withBusy(elements.deleteRange, async () => {
    const result = await sendMessage(MESSAGE_ACTIONS.DELETE_SESSIONS_BY_TIME_RANGE, { startAt, endAt });
    showToast(`已删除 ${result.deleted} 份会话`);
    await loadSessions();
  });
}

async function loadSessions() {
  const sequence = ++state.loadSequence;
  elements.list.innerHTML = '<div class="loading-card">正在加载会话…</div>';
  try {
    const sessions = await sendMessage(MESSAGE_ACTIONS.LIST_SESSIONS, {
      search: elements.search.value,
      kind: elements.kind.value,
      limit: 1000
    });
    if (sequence !== state.loadSequence) return;
    renderSessions(sessions);
  } catch (error) {
    if (sequence !== state.loadSequence) return;
    elements.list.innerHTML = "";
    elements.list.append(makeLoadingCard(`读取失败：${error.message}`));
  }
}

function renderPermissions(status) {
  elements.permissionNotices.innerHTML = "";
  const notices = [];
  if (!status.incognitoAccess) {
    notices.push(["无痕权限未开启", "无法捕获或恢复无痕窗口。"]);
  }
  if (!status.fileAccess) {
    notices.push(["本地文件权限未开启", "file:// URL 可能无法导出或重新打开。"]);
  }

  for (const [title, detail] of notices) {
    const card = document.createElement("div");
    card.className = "permission-card";
    const text = document.createElement("div");
    const strong = document.createElement("strong");
    strong.textContent = title;
    text.append(strong, document.createTextNode(detail));
    const button = document.createElement("button");
    button.className = "text-button";
    button.type = "button";
    button.dataset.openPermissions = "true";
    button.textContent = "打开扩展设置";
    card.append(text, button);
    elements.permissionNotices.append(card);
  }
}

function renderSessions(sessions) {
  elements.list.innerHTML = "";
  elements.librarySummary.textContent = `当前筛选显示 ${sessions.length} 份会话；自动历史不会被扩展清理。`;

  if (!sessions.length) {
    elements.list.append(makeLoadingCard("没有符合条件的会话"));
    return;
  }

  for (const session of sessions) {
    const card = document.createElement("article");
    card.className = "session-card";
    const top = document.createElement("div");
    top.className = "card-top";
    const badge = document.createElement("span");
    badge.className = "kind-badge";
    badge.dataset.kind = session.kind;
    badge.textContent = SESSION_KIND_LABELS[session.kind] || session.kind;
    const date = document.createElement("span");
    date.className = "session-date";
    date.textContent = formatDateTime(session.createdAt);
    top.append(badge, date);

    const title = document.createElement("h3");
    title.className = "session-name";
    title.textContent = session.name;

    const meta = document.createElement("div");
    meta.className = "card-meta";
    meta.textContent = `${session.windows} 个窗口 · ${session.tabs} 个标签${session.incognitoWindows ? ` · ${session.incognitoWindows} 个无痕窗口` : ""}`;

    const sample = document.createElement("p");
    sample.className = "sample-url";
    sample.textContent = session.sampleUrls[0] || "没有 URL";
    sample.title = sample.textContent;

    const actions = document.createElement("div");
    actions.className = "card-actions";
    actions.append(
      makeCardButton("查看", "preview", session.id),
      makeCardButton("恢复", "restore", session.id),
      makeCardButton("JSON", "json", session.id),
      makeCardButton("删除", "delete", session.id, "delete")
    );
    card.append(top, title, meta, sample, actions);
    elements.list.append(card);
  }
}

function makeCardButton(label, action, id, className = "") {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  button.dataset.sessionAction = action;
  button.dataset.sessionId = id;
  if (className) button.className = className;
  return button;
}

function makeLoadingCard(message) {
  const card = document.createElement("div");
  card.className = "loading-card";
  card.textContent = message;
  return card;
}

async function saveCurrentState(button) {
  await withBusy(button, async () => {
    const scope = button.dataset.saveScope === CAPTURE_SCOPES.CURRENT ? CAPTURE_SCOPES.CURRENT : CAPTURE_SCOPES.ALL;
    const saved = await sendMessage(MESSAGE_ACTIONS.SAVE_MANUAL, { scope });
    showToast(`已保存 ${saved.windows} 个窗口、${saved.tabs} 个标签`);
    await loadSessions();
  });
}

async function handleSessionAction(button) {
  const { sessionAction: action, sessionId: id } = button.dataset;
  if (action === "delete") {
    if (!window.confirm("确定永久删除这份会话吗？此操作无法撤销。")) return;
    await withBusy(button, async () => {
      await sendMessage(MESSAGE_ACTIONS.DELETE_SESSION, { id });
      showToast("会话已删除");
      await loadSessions();
    });
    return;
  }

  await withBusy(button, async () => {
    if (action === "restore") {
      const result = await sendMessage(MESSAGE_ACTIONS.RESTORE_SESSION, { id });
      showRestoreResult(result);
    } else {
      const session = await sendMessage(MESSAGE_ACTIONS.GET_SESSION, { id });
      if (action === "preview") {
        showSession(session);
      } else if (action === "json") {
        downloadSession(session, "json");
      }
    }
  });
}

function showSession(session) {
  state.selectedSession = session;
  elements.sessionDialogTitle.textContent = session.name;
  const stats = getSessionStats(session);
  elements.sessionDialogMeta.innerHTML = "";
  for (const text of [
    SESSION_KIND_LABELS[session.kind] || session.kind,
    formatDateTime(session.createdAt),
    `${stats.windows} 个窗口`,
    `${stats.tabs} 个标签`,
    stats.incognitoWindows ? `${stats.incognitoWindows} 个无痕窗口` : null
  ].filter(Boolean)) {
    const badge = document.createElement("span");
    badge.className = "mini-badge";
    badge.textContent = text;
    elements.sessionDialogMeta.append(badge);
  }
  renderSessionTree(session);
  elements.sessionDialog.showModal();
}

function renderSessionTree(session) {
  elements.sessionTree.innerHTML = "";
  for (const [windowIndex, windowItem] of session.windows.entries()) {
    const block = document.createElement("section");
    block.className = "window-block";
    const heading = document.createElement("div");
    heading.className = "window-heading";
    const title = document.createElement("strong");
    title.textContent = `窗口 ${windowIndex + 1} · ${windowItem.incognito ? "无痕" : "普通"} · ${windowItem.type === "popup" ? "弹出式" : "标准"}`;
    const count = document.createElement("span");
    count.className = "session-date";
    count.textContent = `${windowItem.tabs.length} 个标签`;
    heading.append(title, count);

    const groupMap = new Map(windowItem.groups.map((group) => [group.key, group]));
    const list = document.createElement("ol");
    list.className = "tab-list";
    for (const [tabIndex, tab] of windowItem.tabs.entries()) {
      const row = document.createElement("li");
      row.className = "tab-row";
      const index = document.createElement("span");
      index.className = "tab-index";
      index.textContent = String(tabIndex + 1).padStart(2, "0");
      const group = groupMap.get(tab.groupKey);
      if (group) {
        const dot = document.createElement("span");
        dot.className = "group-dot";
        dot.style.setProperty("--group-color", chromeGroupColor(group.color));
        dot.title = `分组：${group.title || group.color}`;
        row.append(dot);
      }
      const copy = document.createElement("div");
      copy.className = "tab-copy";
      const tabTitle = document.createElement("div");
      tabTitle.className = "tab-title";
      tabTitle.textContent = `${tab.pinned ? "📌 " : ""}${tab.title || tab.url}`;
      const url = document.createElement("div");
      url.className = "tab-url";
      url.textContent = tab.url;
      url.title = tab.url;
      copy.append(tabTitle, url);
      row.append(index, copy);
      list.append(row);
    }
    block.append(heading, list);
    elements.sessionTree.append(block);
  }
}

async function handleDetailAction(button) {
  if (!state.selectedSession) return;
  const action = button.dataset.detailAction;
  if (action === "rename") {
    const name = window.prompt("输入新的会话名称：", state.selectedSession.name);
    if (name === null) return;
    await withBusy(button, async () => {
      await sendMessage(MESSAGE_ACTIONS.RENAME_SESSION, { id: state.selectedSession.id, name });
      state.selectedSession.name = name.trim();
      elements.sessionDialogTitle.textContent = state.selectedSession.name;
      showToast("会话已重命名");
      await loadSessions();
    });
    return;
  }

  await withBusy(button, async () => {
    if (action === "restore") {
      showRestoreResult(await sendMessage(MESSAGE_ACTIONS.RESTORE_SESSION, { id: state.selectedSession.id }));
    } else {
      downloadSession(state.selectedSession, action);
    }
  });
}

function downloadSession(session, format) {
  const basename = safeFilename(session.name);
  if (format === "txt") {
    downloadText(sessionToText(session), `${basename}.txt`);
  } else {
    downloadText(JSON.stringify(session, null, 2), `${basename}.json`, "application/json;charset=utf-8");
  }
  showToast(`${format.toUpperCase()} 文件已开始下载`);
}

async function loadImportFile() {
  const file = elements.importFile.files?.[0];
  if (!file) return;
  try {
    elements.importText.value = await file.text();
    parseImport();
  } catch (error) {
    showToast(`文件读取失败：${error.message}`, true);
  }
}

function parseImport() {
  const source = elements.importText.value.replace(/^\uFEFF/, "").trim();
  setImportButtons(false);
  state.importPreview = null;
  if (!source) {
    renderImportError(["请先粘贴内容或选择文件"]);
    return;
  }

  if (source.startsWith("{") || source.startsWith("[")) {
    try {
      const parsed = JSON.parse(source);
      const validated = validateSessionSnapshot(parsed);
      if (!validated.valid) {
        renderImportError(validated.errors);
        return;
      }
      state.importPreview = { type: "json", snapshot: validated.snapshot };
      renderJsonImportPreview(validated.snapshot);
      elements.importIncognitoRow.hidden = true;
      setImportButtons(true);
    } catch (error) {
      renderImportError([`JSON 解析失败：${error.message}`]);
    }
    return;
  }

  const parsed = parseTextImport(source);
  state.importPreview = {
    type: "txt",
    urls: parsed.validEntries.map((entry) => entry.url),
    parsed
  };
  elements.importIncognitoRow.hidden = false;
  renderTextImportPreview(parsed);
  setImportButtons(parsed.validEntries.length > 0);
}

function renderJsonImportPreview(snapshot) {
  const stats = getSessionStats(snapshot);
  elements.importPreview.innerHTML = "";
  const summary = document.createElement("p");
  summary.className = "preview-summary";
  summary.textContent = `完整 JSON 会话：${stats.windows} 个窗口、${stats.tabs} 个标签`;
  elements.importPreview.append(summary);
  const urls = collectSessionUrls(snapshot);
  appendImportEntries(urls.slice(0, 50).map((url, index) => ({ line: index + 1, valid: true, input: url, url })));
  if (urls.length > 50) appendMoreEntries(urls.length - 50);
}

function renderTextImportPreview(parsed) {
  elements.importPreview.innerHTML = "";
  const summary = document.createElement("p");
  summary.className = "preview-summary";
  summary.textContent = `识别 ${parsed.validEntries.length} 个 URL；${parsed.invalidEntries.length} 行无效；保留重复项`;
  elements.importPreview.append(summary);
  appendImportEntries(parsed.entries.slice(0, 80));
  if (parsed.entries.length > 80) appendMoreEntries(parsed.entries.length - 80);
}

function appendImportEntries(entries) {
  for (const entry of entries) {
    const row = document.createElement("div");
    row.className = `import-entry${entry.valid ? "" : " invalid"}`;
    const line = document.createElement("span");
    line.className = "line";
    line.textContent = `L${entry.line}`;
    const value = document.createElement("span");
    value.textContent = entry.valid ? entry.url : `${entry.input} — ${entry.error}`;
    row.append(line, value);
    elements.importPreview.append(row);
  }
}

function appendMoreEntries(count) {
  const more = document.createElement("p");
  more.className = "more-entries";
  more.textContent = `另有 ${count} 项未在预览中展开`;
  elements.importPreview.append(more);
}

function renderImportError(errors) {
  elements.importPreview.innerHTML = "";
  const list = document.createElement("ul");
  list.className = "error-list";
  for (const error of errors) {
    const item = document.createElement("li");
    item.textContent = error;
    list.append(item);
  }
  elements.importPreview.append(list);
}

function setImportButtons(enabled) {
  document.querySelectorAll("[data-import-action]").forEach((button) => {
    button.disabled = !enabled;
  });
}

async function handleImportAction(button) {
  if (!state.importPreview) return;
  await withBusy(button, async () => {
    const action = button.dataset.importAction;
    let saved;
    let result;

    if (state.importPreview.type === "json") {
      if (action === "save" || action === "both") {
        saved = await sendMessage(MESSAGE_ACTIONS.IMPORT_SESSION, { snapshot: state.importPreview.snapshot });
      }
      if (action === "open") {
        result = await sendMessage(MESSAGE_ACTIONS.RESTORE_SNAPSHOT, { snapshot: state.importPreview.snapshot });
      } else if (action === "both") {
        result = await sendMessage(MESSAGE_ACTIONS.RESTORE_SESSION, { id: saved.id });
      }
    } else {
      const { urls } = state.importPreview;
      const incognito = elements.importIncognito.checked;
      if (action === "save" || action === "both") {
        const snapshot = createSessionFromUrls(urls, { incognito });
        saved = await sendMessage(MESSAGE_ACTIONS.IMPORT_SESSION, { snapshot });
      }
      if (action === "open") {
        result = await sendMessage(MESSAGE_ACTIONS.RESTORE_URLS, { urls, incognito });
      } else if (action === "both") {
        result = await sendMessage(MESSAGE_ACTIONS.RESTORE_SESSION, { id: saved.id });
      }
    }

    if (saved) {
      showToast(`会话已保存：${saved.tabs} 个标签`);
      await loadSessions();
    }
    if (result) showRestoreResult(result);
  });
}

function showRestoreResult(result) {
  elements.resultTitle.textContent = result.errors.length ? "恢复完成，但有部分失败" : "恢复完成";
  elements.resultContent.innerHTML = "";
  const summary = document.createElement("p");
  summary.textContent = `已创建 ${result.windowsCreated}/${result.windowsRequested} 个窗口，打开 ${result.tabsCreated}/${result.tabsRequested} 个标签，恢复 ${result.groupsCreated} 个分组。`;
  elements.resultContent.append(summary);
  if (result.errors.length) {
    const list = document.createElement("ul");
    list.className = "error-list";
    for (const error of result.errors) {
      const item = document.createElement("li");
      item.textContent = `${error.target || error.stage}：${error.message}`;
      list.append(item);
    }
    elements.resultContent.append(list);
  }
  if (!elements.resultDialog.open) elements.resultDialog.showModal();
}

async function withBusy(button, task) {
  const original = button.textContent;
  button.disabled = true;
  button.textContent = "处理中…";
  try {
    await task();
  } catch (error) {
    showToast(error.message, true);
  } finally {
    button.disabled = false;
    button.textContent = original;
  }
}

function showToast(message, error = false) {
  window.clearTimeout(state.toastTimer);
  elements.toast.textContent = message;
  elements.toast.classList.toggle("error", error);
  elements.toast.classList.add("visible");
  state.toastTimer = window.setTimeout(() => elements.toast.classList.remove("visible"), 3_500);
}

function chromeGroupColor(color) {
  return {
    grey: "#87938b",
    blue: "#4d8fd8",
    red: "#d85a55",
    yellow: "#d8a82f",
    green: "#4b9d6c",
    pink: "#d46f9f",
    purple: "#8c6bc3",
    cyan: "#40a7ae",
    orange: "#d9853d"
  }[color] || "#87938b";
}
