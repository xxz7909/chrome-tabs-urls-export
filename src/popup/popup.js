import { CAPTURE_SCOPES, MESSAGE_ACTIONS, SESSION_KIND_LABELS } from "../shared/constants.js";
import {
  capturePreview,
  copyText,
  downloadText,
  formatDateTime,
  makeExportFilename,
  openExtensionDetails,
  sendMessage,
  sessionToText
} from "../shared/ui.js";

const toast = document.querySelector("#toast");
const recentList = document.querySelector("#recent-list");
const sessionCount = document.querySelector("#session-count");
const permissionBar = document.querySelector("#permission-bar");

document.addEventListener("click", async (event) => {
  const commandButton = event.target.closest("[data-command]");
  if (commandButton) {
    await handleCommand(commandButton);
    return;
  }

  const restoreButton = event.target.closest("[data-restore-id]");
  if (restoreButton) {
    await withBusy(restoreButton, async () => {
      const result = await sendMessage(MESSAGE_ACTIONS.RESTORE_SESSION, { id: restoreButton.dataset.restoreId });
      showRestoreResult(result);
    });
    return;
  }

  if (event.target.closest("[data-open-permissions]")) {
    await openExtensionDetails();
  }
});

document.querySelector("#open-manager").addEventListener("click", openManager);
document.querySelector("#import-button").addEventListener("click", () => openManager("#import"));
document.querySelector("#manage-button").addEventListener("click", openManager);

void loadStatus();

async function handleCommand(button) {
  const scope = button.dataset.scope === CAPTURE_SCOPES.CURRENT ? CAPTURE_SCOPES.CURRENT : CAPTURE_SCOPES.ALL;
  const command = button.dataset.command;

  await withBusy(button, async () => {
    if (command === "save") {
      const saved = await sendMessage(MESSAGE_ACTIONS.SAVE_MANUAL, { scope });
      showToast(`已保存：${saved.tabs} 个标签页`);
      await loadStatus();
      return;
    }

    const session = await capturePreview(scope);
    const content = sessionToText(session);
    if (!content) {
      throw new Error("当前范围内没有可导出的 URL");
    }

    if (command === "copy") {
      await copyText(content);
      showToast(`已复制 ${content.split("\n").length} 个 URL`);
    } else if (command === "download") {
      downloadText(content, makeExportFilename(scope === "current" ? "当前窗口" : "全部窗口", "txt"));
      showToast("TXT 文件已开始下载");
    }
  });
}

async function loadStatus() {
  try {
    const status = await sendMessage(MESSAGE_ACTIONS.GET_STATUS);
    sessionCount.textContent = `${status.totalSessions} 份`;
    renderPermissions(status);
    renderRecent(status.recent);
  } catch (error) {
    recentList.innerHTML = "";
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = `读取失败：${error.message}`;
    recentList.append(empty);
  }
}

function renderPermissions(status) {
  permissionBar.innerHTML = "";
  const missing = [];
  if (!status.incognitoAccess) missing.push("无痕窗口");
  if (!status.fileAccess) missing.push("本地文件");
  if (!missing.length) return;

  const notice = document.createElement("div");
  notice.className = "permission-notice";
  const text = document.createElement("span");
  text.textContent = `${missing.join("、")}权限尚未开启`;
  const button = document.createElement("button");
  button.type = "button";
  button.dataset.openPermissions = "true";
  button.textContent = "去开启";
  notice.append(text, button);
  permissionBar.append(notice);
}

function renderRecent(items) {
  recentList.innerHTML = "";
  if (!items.length) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "还没有会话，先保存一次吧";
    recentList.append(empty);
    return;
  }

  for (const item of items.slice(0, 3)) {
    const row = document.createElement("div");
    row.className = "recent-item";
    const info = document.createElement("div");
    const name = document.createElement("div");
    name.className = "recent-name";
    name.textContent = item.name;
    name.title = item.name;
    const meta = document.createElement("div");
    meta.className = "recent-meta";
    meta.textContent = `${SESSION_KIND_LABELS[item.kind] || item.kind} · ${item.windows} 窗口 / ${item.tabs} 标签 · ${formatDateTime(item.createdAt)}`;
    info.append(name, meta);

    const button = document.createElement("button");
    button.type = "button";
    button.className = "restore-button";
    button.dataset.restoreId = item.id;
    button.textContent = "恢复";
    row.append(info, button);
    recentList.append(row);
  }
}

function openManager(hash = "") {
  chrome.tabs.create({ url: `${chrome.runtime.getURL("src/manager/manager.html")}${hash}` });
  window.close();
}

async function withBusy(button, task) {
  const previous = button.innerHTML;
  button.disabled = true;
  button.textContent = "处理中…";
  try {
    await task();
  } catch (error) {
    showToast(error.message, true);
  } finally {
    button.disabled = false;
    button.innerHTML = previous;
  }
}

function showRestoreResult(result) {
  const message = `已恢复 ${result.windowsCreated} 个窗口、${result.tabsCreated} 个标签`;
  showToast(result.errors.length ? `${message}，${result.errors.length} 项失败` : message, result.errors.length > 0);
}

function showToast(message, isError = false) {
  toast.textContent = message;
  toast.classList.toggle("error", isError);
}
