import { CAPTURE_SCOPES, SESSION_KINDS } from "../shared/constants.js";
import { createSessionSnapshot } from "../shared/session.js";

export async function captureBrowserState({
  scope = CAPTURE_SCOPES.ALL,
  kind = SESSION_KINDS.MANUAL,
  name,
  chromeApi = chrome
} = {}) {
  const queriedWindows = scope === CAPTURE_SCOPES.CURRENT
    ? [await chromeApi.windows.getLastFocused({ populate: true, windowTypes: ["normal", "popup"] })]
    : await chromeApi.windows.getAll({ populate: true, windowTypes: ["normal", "popup"] });

  const allGroups = await queryGroupsSafely(chromeApi);
  const ownOrigin = chromeApi.runtime.getURL("");
  const windows = queriedWindows
    .map((windowItem, windowIndex) => normalizeWindow(windowItem, windowIndex, allGroups, ownOrigin))
    .filter((windowItem) => windowItem.tabs.length > 0);

  return createSessionSnapshot(windows, { scope, kind, name });
}

async function queryGroupsSafely(chromeApi) {
  try {
    return await chromeApi.tabGroups.query({});
  } catch {
    return [];
  }
}

function normalizeWindow(windowItem, windowIndex, allGroups, ownOrigin) {
  const sourceTabs = Array.isArray(windowItem.tabs) ? [...windowItem.tabs].sort((a, b) => a.index - b.index) : [];
  const usableTabs = sourceTabs.filter((tab) => {
    const url = tab.pendingUrl || tab.url;
    return typeof url === "string" && url && !url.startsWith(ownOrigin);
  });
  const usedGroupIds = new Set(usableTabs.filter((tab) => Number.isInteger(tab.groupId) && tab.groupId >= 0).map((tab) => tab.groupId));
  const windowGroups = allGroups
    .filter((group) => group.windowId === windowItem.id && usedGroupIds.has(group.id))
    .map((group) => ({
      sourceId: group.id,
      title: group.title || "",
      color: group.color || "grey",
      collapsed: Boolean(group.collapsed),
      index: Math.min(...usableTabs.filter((tab) => tab.groupId === group.id).map((tab) => tab.index))
    }))
    .sort((a, b) => a.index - b.index);

  const groupKeyById = new Map(windowGroups.map((group, groupIndex) => [group.sourceId, `w${windowIndex}-g${groupIndex}`]));
  const groups = windowGroups.map(({ sourceId, ...group }) => ({
    ...group,
    key: groupKeyById.get(sourceId)
  }));
  const tabs = usableTabs.map((tab, tabIndex) => ({
    url: tab.pendingUrl || tab.url,
    title: tab.title || tab.pendingUrl || tab.url,
    index: tabIndex,
    active: Boolean(tab.active),
    pinned: Boolean(tab.pinned),
    groupKey: groupKeyById.get(tab.groupId) || null
  }));

  return {
    index: windowIndex,
    incognito: Boolean(windowItem.incognito),
    focused: Boolean(windowItem.focused),
    type: windowItem.type === "popup" ? "popup" : "normal",
    state: windowItem.state || "normal",
    left: windowItem.left,
    top: windowItem.top,
    width: windowItem.width,
    height: windowItem.height,
    tabs,
    groups
  };
}
