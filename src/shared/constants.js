export const SCHEMA_VERSION = 1;

export const SESSION_KINDS = Object.freeze({
  MANUAL: "manual",
  AUTOMATIC: "automatic",
  IMPORTED: "imported",
  RECOVERY: "recovery"
});

export const SESSION_KIND_LABELS = Object.freeze({
  manual: "手动保存",
  automatic: "自动快照",
  imported: "导入会话",
  recovery: "关闭前状态"
});

export const CAPTURE_SCOPES = Object.freeze({
  CURRENT: "current",
  ALL: "all"
});

export const MESSAGE_ACTIONS = Object.freeze({
  GET_STATUS: "GET_STATUS",
  CAPTURE_PREVIEW: "CAPTURE_PREVIEW",
  SAVE_MANUAL: "SAVE_MANUAL",
  LIST_SESSIONS: "LIST_SESSIONS",
  GET_SESSION: "GET_SESSION",
  RENAME_SESSION: "RENAME_SESSION",
  DELETE_SESSION: "DELETE_SESSION",
  DELETE_SESSIONS_BY_TIME_RANGE: "DELETE_SESSIONS_BY_TIME_RANGE",
  RESTORE_SESSION: "RESTORE_SESSION",
  RESTORE_SNAPSHOT: "RESTORE_SNAPSHOT",
  RESTORE_URLS: "RESTORE_URLS",
  IMPORT_SESSION: "IMPORT_SESSION"
});

export const STORAGE_KEYS = Object.freeze({
  LIVE_SNAPSHOT: "liveSnapshot",
  LAST_ARCHIVED_FINGERPRINT: "lastArchivedFingerprint",
  SETTINGS: "settings"
});

export const ALARM_NAMES = Object.freeze({
  LIVE_CAPTURE: "live-state-capture",
  STABLE_ARCHIVE: "stable-state-archive",
  WINDOW_CLOSE_ARCHIVE: "window-close-archive"
});

export const DEFAULT_SETTINGS = Object.freeze({
  autosaveEnabled: true,
  includeIncognito: true
});

export const LIVE_CAPTURE_DELAY_MS = 2_000;
export const STABLE_ARCHIVE_DELAY_MS = 30_000;
export const WINDOW_CLOSE_ARCHIVE_DELAY_MS = 250;
