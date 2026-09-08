export async function restoreSessionSnapshot(snapshot, chromeApi = chrome) {
  const summary = {
    windowsRequested: snapshot.windows.length,
    windowsCreated: 0,
    tabsRequested: snapshot.windows.reduce((total, windowItem) => total + windowItem.tabs.length, 0),
    tabsCreated: 0,
    groupsCreated: 0,
    errors: []
  };
  const restoredWindows = [];

  for (const windowSnapshot of [...snapshot.windows].sort((a, b) => a.index - b.index)) {
    const restored = await restoreWindow(windowSnapshot, chromeApi, summary);
    if (restored) {
      restoredWindows.push(restored);
    }
  }

  const focused = restoredWindows.find((item) => item.source.focused) || restoredWindows.at(-1);
  if (focused) {
    try {
      await chromeApi.windows.update(focused.id, { focused: true });
    } catch (error) {
      summary.errors.push(makeError("window-focus", "", error));
    }
  }

  return summary;
}

async function restoreWindow(windowSnapshot, chromeApi, summary) {
  const createData = {
    url: "about:blank",
    focused: false,
    incognito: Boolean(windowSnapshot.incognito),
    type: windowSnapshot.type === "popup" ? "popup" : "normal"
  };

  if (windowSnapshot.state === "normal") {
    copyBounds(windowSnapshot, createData);
  }

  let createdWindow;
  try {
    createdWindow = await chromeApi.windows.create(createData);
    if (!createdWindow?.id) {
      throw new Error("Chrome 未返回新窗口 ID");
    }
    summary.windowsCreated += 1;
  } catch (error) {
    summary.errors.push(makeError("window-create", windowSnapshot.incognito ? "无痕窗口" : "普通窗口", error));
    return null;
  }

  const placeholder = createdWindow.tabs?.[0] || (await chromeApi.tabs.query({ windowId: createdWindow.id }))[0];
  let placeholderAvailable = Boolean(placeholder?.id);
  const createdTabs = [];
  const tabsInOrder = [...windowSnapshot.tabs].sort((a, b) => a.index - b.index);

  for (const tabSnapshot of tabsInOrder) {
    try {
      let createdTab;
      if (placeholderAvailable) {
        createdTab = await chromeApi.tabs.update(placeholder.id, {
          url: tabSnapshot.url,
          active: false,
          pinned: Boolean(tabSnapshot.pinned)
        });
        placeholderAvailable = false;
      } else {
        createdTab = await chromeApi.tabs.create({
          windowId: createdWindow.id,
          url: tabSnapshot.url,
          active: false,
          pinned: Boolean(tabSnapshot.pinned),
          index: createdTabs.length
        });
      }

      if (createdTab?.id) {
        createdTabs.push({ id: createdTab.id, source: tabSnapshot });
        summary.tabsCreated += 1;
      }
    } catch (error) {
      summary.errors.push(makeError("tab-create", tabSnapshot.url, error));
    }
  }

  if (placeholderAvailable && placeholder?.id && createdTabs.length > 0) {
    try {
      await chromeApi.tabs.remove(placeholder.id);
      placeholderAvailable = false;
    } catch (error) {
      summary.errors.push(makeError("placeholder-remove", "about:blank", error));
    }
  }

  await restoreGroups(windowSnapshot, createdWindow.id, createdTabs, chromeApi, summary);

  const activeTab = createdTabs.find((item) => item.source.active) || createdTabs[0];
  if (activeTab) {
    try {
      await chromeApi.tabs.update(activeTab.id, { active: true });
    } catch (error) {
      summary.errors.push(makeError("tab-activate", activeTab.source.url, error));
    }
  }

  await restoreWindowLayout(windowSnapshot, createdWindow.id, chromeApi, summary);
  return { id: createdWindow.id, source: windowSnapshot };
}

async function restoreGroups(windowSnapshot, windowId, createdTabs, chromeApi, summary) {
  const groups = [...windowSnapshot.groups].sort((a, b) => a.index - b.index);
  for (const groupSnapshot of groups) {
    const tabIds = createdTabs
      .filter((item) => item.source.groupKey === groupSnapshot.key)
      .map((item) => item.id);
    if (!tabIds.length) {
      continue;
    }

    try {
      const groupId = await chromeApi.tabs.group({ tabIds, createProperties: { windowId } });
      await chromeApi.tabGroups.update(groupId, {
        title: groupSnapshot.title || "",
        color: groupSnapshot.color || "grey",
        collapsed: Boolean(groupSnapshot.collapsed)
      });
      try {
        await chromeApi.tabGroups.move(groupId, { windowId, index: groupSnapshot.index });
      } catch {
        // 标签顺序已经保存；部分 Chrome 版本不允许在创建后立即移动分组。
      }
      summary.groupsCreated += 1;
    } catch (error) {
      summary.errors.push(makeError("group-create", groupSnapshot.title || groupSnapshot.key, error));
    }
  }
}

async function restoreWindowLayout(windowSnapshot, windowId, chromeApi, summary) {
  try {
    if (windowSnapshot.state && windowSnapshot.state !== "normal") {
      await chromeApi.windows.update(windowId, { state: windowSnapshot.state });
      return;
    }

    const updateInfo = { state: "normal" };
    copyBounds(windowSnapshot, updateInfo);
    await chromeApi.windows.update(windowId, updateInfo);
  } catch (error) {
    summary.errors.push(makeError("window-layout", String(windowId), error));
  }
}

function copyBounds(source, target) {
  for (const key of ["left", "top", "width", "height"]) {
    if (Number.isFinite(source[key])) {
      target[key] = source[key];
    }
  }
}

function makeError(stage, target, error) {
  return {
    stage,
    target,
    message: error instanceof Error ? error.message : String(error)
  };
}
