import {
  ALARM_NAMES,
  CAPTURE_SCOPES,
  DEFAULT_SETTINGS,
  MESSAGE_ACTIONS,
  SESSION_KINDS,
  STORAGE_KEYS,
} from "../shared/constants.js";
import {
  cloneAsImported,
  createSessionFromUrls,
  createSessionSnapshot,
  getSessionStats,
  validateSessionSnapshot
} from "../shared/session.js";
import { captureBrowserState } from "./capture.js";
import { countSessions, deleteSession, deleteSessionsByTimeRange, getSession, listSessions, putSession } from "./db.js";
import { restoreSessionSnapshot } from "./restore.js";
import { createStateScheduler } from "./scheduler.js";

const {
  scheduleLiveCapture,
  scheduleStateChange
} = createStateScheduler(chrome, {
  onLiveCapture: () => void persistLiveSnapshot()
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  handleMessage(message)
    .then((data) => sendResponse({ ok: true, data }))
    .catch((error) => sendResponse({ ok: false, error: serializeError(error) }));
  return true;
});

chrome.runtime.onInstalled.addListener(() => {
  void ensureSettings().then(() => scheduleLiveCapture());
});

chrome.runtime.onStartup.addListener(() => {
  void archiveStoredLive(SESSION_KINDS.RECOVERY, true)
    .finally(() => scheduleLiveCapture());
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAMES.LIVE_CAPTURE) {
    void persistLiveSnapshot();
  }
});

chrome.tabs.onCreated.addListener(() => scheduleStateChange());
chrome.tabs.onActivated.addListener(() => scheduleStateChange());
chrome.tabs.onMoved.addListener(() => scheduleStateChange());
chrome.tabs.onAttached.addListener(() => scheduleStateChange());
chrome.tabs.onDetached.addListener(() => scheduleStateChange());
chrome.tabs.onUpdated.addListener((_tabId, changeInfo) => {
  if (changeInfo.url !== undefined || changeInfo.pinned !== undefined || changeInfo.groupId !== undefined) {
    scheduleStateChange();
  }
});
chrome.tabs.onRemoved.addListener((_tabId, removeInfo) => {
  if (removeInfo.isWindowClosing) {
    scheduleLiveCapture(3_000);
  } else {
    scheduleStateChange();
  }
});

chrome.windows.onCreated.addListener(() => scheduleStateChange());
chrome.windows.onRemoved.addListener(() => {
  scheduleLiveCapture(3_000);
});
chrome.windows.onFocusChanged.addListener(() => scheduleStateChange());
if (chrome.windows.onBoundsChanged) {
  chrome.windows.onBoundsChanged.addListener(() => scheduleStateChange());
}

chrome.tabGroups.onCreated.addListener(() => scheduleStateChange());
chrome.tabGroups.onMoved.addListener(() => scheduleStateChange());
chrome.tabGroups.onRemoved.addListener(() => scheduleStateChange());
chrome.tabGroups.onUpdated.addListener(() => scheduleStateChange());

void ensureSettings();

async function handleMessage(message) {
  const action = message?.action;
  const payload = message?.payload || {};

  switch (action) {
    case MESSAGE_ACTIONS.GET_STATUS:
      return getStatus();
    case MESSAGE_ACTIONS.CAPTURE_PREVIEW:
      return captureBrowserState({ scope: normalizeScope(payload.scope), kind: SESSION_KINDS.MANUAL });
    case MESSAGE_ACTIONS.SAVE_MANUAL:
      return saveManualSession(payload);
    case MESSAGE_ACTIONS.LIST_SESSIONS:
      return (await listSessions(payload)).map(toSummary);
    case MESSAGE_ACTIONS.GET_SESSION:
      return requireSession(payload.id);
    case MESSAGE_ACTIONS.RENAME_SESSION:
      return renameSession(payload.id, payload.name);
    case MESSAGE_ACTIONS.DELETE_SESSION:
      await deleteSession(payload.id);
      return { id: payload.id };
    case MESSAGE_ACTIONS.DELETE_SESSIONS_BY_TIME_RANGE:
      return { deleted: await deleteSessionsByTimeRange(payload.startAt, payload.endAt) };
    case MESSAGE_ACTIONS.RESTORE_SESSION:
      return restoreSessionSnapshot(await requireSession(payload.id));
    case MESSAGE_ACTIONS.RESTORE_SNAPSHOT:
      return restoreValidatedSnapshot(payload.snapshot);
    case MESSAGE_ACTIONS.RESTORE_URLS:
      return restoreUrls(payload.urls, payload.incognito);
    case MESSAGE_ACTIONS.IMPORT_SESSION:
      return importSession(payload.snapshot, payload.name);
    default:
      throw new Error(`未知消息操作：${String(action)}`);
  }
}

async function getStatus() {
  const [fileAccess, incognitoAccess, totalSessions, recent, stored] = await Promise.all([
    chrome.extension.isAllowedFileSchemeAccess(),
    chrome.extension.isAllowedIncognitoAccess(),
    countSessions(),
    listSessions({ limit: 5 }),
    chrome.storage.local.get(STORAGE_KEYS.SETTINGS)
  ]);

  return {
    fileAccess,
    incognitoAccess,
    totalSessions,
    settings: { ...DEFAULT_SETTINGS, ...(stored[STORAGE_KEYS.SETTINGS] || {}) },
    recent: recent.map(toSummary)
  };
}

async function saveManualSession({ scope, name }) {
  const snapshot = await captureBrowserState({
    scope: normalizeScope(scope),
    kind: SESSION_KINDS.MANUAL,
    name: typeof name === "string" ? name.trim() : undefined
  });
  if (!snapshot.windows.length) {
    throw new Error("没有可保存的浏览器标签页");
  }
  await putSession(snapshot);
  return toSummary(snapshot);
}

async function renameSession(id, name) {
  const session = await requireSession(id);
  const normalizedName = String(name || "").trim();
  if (!normalizedName) {
    throw new Error("会话名称不能为空");
  }
  session.name = normalizedName;
  await putSession(session);
  return toSummary(session);
}

async function importSession(input, name) {
  const result = cloneAsImported(input, name);
  if (!result.valid) {
    throw new Error(result.errors.join("；"));
  }
  await putSession(result.snapshot);
  return toSummary(result.snapshot);
}

async function restoreValidatedSnapshot(input) {
  const result = validateSessionSnapshot(input);
  if (!result.valid) {
    throw new Error(result.errors.join("；"));
  }
  return restoreSessionSnapshot(result.snapshot);
}

async function restoreUrls(urls, incognito) {
  if (!Array.isArray(urls) || !urls.length) {
    throw new Error("没有可打开的 URL");
  }
  const snapshot = createSessionFromUrls(urls, { incognito: Boolean(incognito) });
  return restoreSessionSnapshot(snapshot);
}

async function requireSession(id) {
  if (!id) {
    throw new Error("缺少会话 ID");
  }
  const session = await getSession(id);
  if (!session) {
    throw new Error("找不到该会话，可能已被删除");
  }
  return session;
}

async function ensureSettings() {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.SETTINGS);
  if (!stored[STORAGE_KEYS.SETTINGS]) {
    await chrome.storage.local.set({ [STORAGE_KEYS.SETTINGS]: { ...DEFAULT_SETTINGS } });
  }
}

async function autosaveEnabled() {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.SETTINGS);
  return { ...DEFAULT_SETTINGS, ...(stored[STORAGE_KEYS.SETTINGS] || {}) }.autosaveEnabled;
}

async function persistLiveSnapshot() {
  if (!(await autosaveEnabled())) {
    return null;
  }
  const snapshot = await captureBrowserState({ scope: CAPTURE_SCOPES.ALL, kind: SESSION_KINDS.RECOVERY });
  if (!snapshot.windows.length) {
    return null;
  }
  await chrome.storage.local.set({ [STORAGE_KEYS.LIVE_SNAPSHOT]: snapshot });
  return snapshot;
}

async function archiveStoredLive(kind, force) {
  if (!(await autosaveEnabled())) {
    return null;
  }
  const stored = await chrome.storage.local.get(STORAGE_KEYS.LIVE_SNAPSHOT);
  const live = stored[STORAGE_KEYS.LIVE_SNAPSHOT];
  if (!live?.windows?.length) {
    return null;
  }
  const archived = createSessionSnapshot(live.windows, { kind, scope: "all" });
  return archiveSnapshot(archived, force);
}

async function archiveSnapshot(snapshot, force) {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.LAST_ARCHIVED_FINGERPRINT);
  if (!force && stored[STORAGE_KEYS.LAST_ARCHIVED_FINGERPRINT] === snapshot.fingerprint) {
    return null;
  }
  await putSession(snapshot);
  await chrome.storage.local.set({ [STORAGE_KEYS.LAST_ARCHIVED_FINGERPRINT]: snapshot.fingerprint });
  return snapshot;
}

function normalizeScope(scope) {
  return scope === CAPTURE_SCOPES.CURRENT ? CAPTURE_SCOPES.CURRENT : CAPTURE_SCOPES.ALL;
}

function toSummary(session) {
  const stats = getSessionStats(session);
  return {
    id: session.id,
    name: session.name,
    kind: session.kind,
    createdAt: session.createdAt,
    importedAt: session.importedAt,
    fingerprint: session.fingerprint,
    ...stats,
    sampleUrls: session.windows.flatMap((windowItem) => windowItem.tabs.map((tab) => tab.url)).slice(0, 3)
  };
}

function serializeError(error) {
  return {
    name: error?.name || "Error",
    message: error instanceof Error ? error.message : String(error)
  };
}
