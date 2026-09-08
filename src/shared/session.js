import { SCHEMA_VERSION, SESSION_KINDS } from "./constants.js";

const TAB_GROUP_COLORS = new Set(["grey", "blue", "red", "yellow", "green", "pink", "purple", "cyan", "orange"]);

function makeId() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function fnv1a(value) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function fingerprintWindows(windows) {
  const restorableState = windows.map((windowSnapshot) => ({
    incognito: Boolean(windowSnapshot.incognito),
    type: windowSnapshot.type,
    state: windowSnapshot.state,
    left: windowSnapshot.left,
    top: windowSnapshot.top,
    width: windowSnapshot.width,
    height: windowSnapshot.height,
    tabs: windowSnapshot.tabs.map((tab) => ({
      url: tab.url,
      index: tab.index,
      active: Boolean(tab.active),
      pinned: Boolean(tab.pinned),
      groupKey: tab.groupKey ?? null
    })),
    groups: windowSnapshot.groups.map((group) => ({
      key: group.key,
      title: group.title ?? "",
      color: group.color,
      collapsed: Boolean(group.collapsed),
      index: group.index
    }))
  }));

  return fnv1a(JSON.stringify(restorableState));
}

export function createSessionSnapshot(windows, options = {}) {
  const now = options.createdAt || new Date().toISOString();
  const kind = options.kind || SESSION_KINDS.MANUAL;
  const snapshot = {
    schemaVersion: SCHEMA_VERSION,
    id: options.id || makeId(),
    name: options.name || defaultSessionName(kind, now),
    kind,
    createdAt: now,
    scope: options.scope || "all",
    fingerprint: fingerprintWindows(windows),
    windows
  };

  if (options.importedAt) {
    snapshot.importedAt = options.importedAt;
  }

  return snapshot;
}

export function createSessionFromUrls(urls, { incognito = false, name, kind = SESSION_KINDS.IMPORTED } = {}) {
  const tabs = urls.map((url, index) => ({
    url,
    title: url,
    index,
    active: index === 0,
    pinned: false,
    groupKey: null
  }));

  return createSessionSnapshot([
    {
      index: 0,
      incognito,
      focused: true,
      type: "normal",
      state: "normal",
      tabs,
      groups: []
    }
  ], { kind, name, scope: "import" });
}

export function defaultSessionName(kind, isoDate = new Date().toISOString()) {
  const date = new Date(isoDate);
  const formatted = new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).format(date);

  const prefix = {
    manual: "手动会话",
    automatic: "自动快照",
    imported: "导入会话",
    recovery: "关闭前状态"
  }[kind] || "浏览器会话";

  return `${prefix} · ${formatted}`;
}

export function collectSessionUrls(snapshot) {
  return snapshot.windows.flatMap((windowSnapshot) => windowSnapshot.tabs.map((tab) => tab.url).filter(Boolean));
}

export function getSessionStats(snapshot) {
  const windows = snapshot.windows.length;
  const tabs = snapshot.windows.reduce((total, item) => total + item.tabs.length, 0);
  const incognitoWindows = snapshot.windows.filter((item) => item.incognito).length;
  return { windows, tabs, incognitoWindows };
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function validateSessionSnapshot(input) {
  const errors = [];

  if (!isPlainObject(input)) {
    return { valid: false, errors: ["JSON 根节点必须是对象"] };
  }
  if (input.schemaVersion !== SCHEMA_VERSION) {
    errors.push(`不支持的 schemaVersion：${String(input.schemaVersion)}`);
  }
  if (!Array.isArray(input.windows) || input.windows.length === 0) {
    errors.push("会话必须至少包含一个窗口");
  }

  const windows = Array.isArray(input.windows)
    ? input.windows.map((windowInput, windowIndex) => {
        if (!isPlainObject(windowInput)) {
          errors.push(`窗口 ${windowIndex + 1} 必须是对象`);
          return null;
        }
        if (!Array.isArray(windowInput.tabs)) {
          errors.push(`窗口 ${windowIndex + 1} 缺少 tabs 数组`);
          return null;
        }

        const tabs = windowInput.tabs.map((tabInput, tabIndex) => {
          if (!isPlainObject(tabInput) || typeof tabInput.url !== "string" || !tabInput.url.trim()) {
            errors.push(`窗口 ${windowIndex + 1} 的标签 ${tabIndex + 1} 缺少有效 URL`);
            return null;
          }
          return {
            url: tabInput.url.trim(),
            title: typeof tabInput.title === "string" ? tabInput.title : tabInput.url.trim(),
            index: Number.isInteger(tabInput.index) ? tabInput.index : tabIndex,
            active: Boolean(tabInput.active),
            pinned: Boolean(tabInput.pinned),
            groupKey: typeof tabInput.groupKey === "string" ? tabInput.groupKey : null
          };
        }).filter(Boolean);

        const groups = Array.isArray(windowInput.groups)
          ? windowInput.groups.filter(isPlainObject).map((group, groupIndex) => ({
              key: typeof group.key === "string" ? group.key : `group-${windowIndex}-${groupIndex}`,
              title: typeof group.title === "string" ? group.title : "",
              color: TAB_GROUP_COLORS.has(group.color) ? group.color : "grey",
              collapsed: Boolean(group.collapsed),
              index: Number.isInteger(group.index) ? group.index : 0
            }))
          : [];

        return {
          index: Number.isInteger(windowInput.index) ? windowInput.index : windowIndex,
          incognito: Boolean(windowInput.incognito),
          focused: Boolean(windowInput.focused),
          type: windowInput.type === "popup" ? "popup" : "normal",
          state: ["normal", "minimized", "maximized", "fullscreen"].includes(windowInput.state)
            ? windowInput.state
            : "normal",
          left: Number.isFinite(windowInput.left) ? windowInput.left : undefined,
          top: Number.isFinite(windowInput.top) ? windowInput.top : undefined,
          width: Number.isFinite(windowInput.width) ? windowInput.width : undefined,
          height: Number.isFinite(windowInput.height) ? windowInput.height : undefined,
          tabs,
          groups
        };
      }).filter(Boolean)
    : [];

  if (errors.length) {
    return { valid: false, errors };
  }

  const createdAt = Number.isNaN(Date.parse(input.createdAt)) ? new Date().toISOString() : input.createdAt;
  const kind = Object.values(SESSION_KINDS).includes(input.kind) ? input.kind : SESSION_KINDS.IMPORTED;
  const snapshot = createSessionSnapshot(windows, {
    id: typeof input.id === "string" ? input.id : undefined,
    name: typeof input.name === "string" && input.name.trim() ? input.name.trim() : undefined,
    kind,
    createdAt,
    scope: typeof input.scope === "string" ? input.scope : "all",
    importedAt: typeof input.importedAt === "string" ? input.importedAt : undefined
  });

  return { valid: true, errors: [], snapshot };
}

export function cloneAsImported(snapshot, name) {
  const validated = validateSessionSnapshot(snapshot);
  if (!validated.valid) {
    return validated;
  }

  const importedAt = new Date().toISOString();
  return {
    valid: true,
    errors: [],
    snapshot: createSessionSnapshot(validated.snapshot.windows, {
      name: name?.trim() || validated.snapshot.name,
      kind: SESSION_KINDS.IMPORTED,
      createdAt: validated.snapshot.createdAt,
      importedAt,
      scope: validated.snapshot.scope
    })
  };
}
