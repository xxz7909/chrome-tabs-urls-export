import { MESSAGE_ACTIONS } from "./constants.js";
import { collectSessionUrls } from "./session.js";
import { urlsToText } from "./urls.js";

export async function sendMessage(action, payload = {}) {
  const response = await chrome.runtime.sendMessage({ action, payload });
  if (!response?.ok) {
    throw new Error(response?.error?.message || "扩展后台没有返回有效结果");
  }
  return response.data;
}

export function capturePreview(scope) {
  return sendMessage(MESSAGE_ACTIONS.CAPTURE_PREVIEW, { scope });
}

export function sessionToText(session) {
  return urlsToText(collectSessionUrls(session));
}

export function downloadText(content, filename, type = "text/plain;charset=utf-8") {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

export async function copyText(content) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(content);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = content;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.append(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  if (!copied) {
    throw new Error("剪贴板写入失败");
  }
}

export function formatDateTime(isoDate) {
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) {
    return "未知时间";
  }
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).format(date);
}

export function safeFilename(value) {
  return String(value || "session")
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 90) || "session";
}

export function makeExportFilename(prefix, extension) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `${safeFilename(prefix)}-${timestamp}.${extension}`;
}

export function openExtensionDetails() {
  return chrome.tabs.create({ url: `chrome://extensions/?id=${chrome.runtime.id}` });
}
