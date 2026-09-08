import test from "node:test";
import assert from "node:assert/strict";
import { createSessionSnapshot } from "../src/shared/session.js";
import { restoreSessionSnapshot } from "../src/background/restore.js";

function makeChromeMock() {
  let nextWindowId = 1;
  let nextTabId = 100;
  let nextGroupId = 50;
  const tabs = new Map();
  const windows = new Map();
  const calls = { windowCreate: [], windowUpdate: [], tabUpdate: [], tabCreate: [], tabRemove: [], group: [], groupUpdate: [], groupMove: [] };

  const api = {
    windows: {
      async create(data) {
        calls.windowCreate.push({ ...data });
        const id = nextWindowId++;
        const tab = { id: nextTabId++, windowId: id, index: 0, url: data.url };
        tabs.set(tab.id, tab);
        windows.set(id, { id, tabs: [tab.id] });
        return { id, tabs: [{ ...tab }] };
      },
      async update(id, data) {
        calls.windowUpdate.push([id, { ...data }]);
        return { id, ...data };
      }
    },
    tabs: {
      async query({ windowId }) {
        return windows.get(windowId).tabs.map((id) => ({ ...tabs.get(id) }));
      },
      async update(id, data) {
        calls.tabUpdate.push([id, { ...data }]);
        if (data.url === "bad://blocked/") throw new Error("blocked by browser");
        Object.assign(tabs.get(id), data);
        return { ...tabs.get(id) };
      },
      async create(data) {
        calls.tabCreate.push({ ...data });
        if (data.url === "bad://blocked/") throw new Error("blocked by browser");
        const tab = { id: nextTabId++, ...data };
        tabs.set(tab.id, tab);
        windows.get(data.windowId).tabs.push(tab.id);
        return { ...tab };
      },
      async remove(id) {
        calls.tabRemove.push(id);
        tabs.delete(id);
      },
      async group(data) {
        calls.group.push(data);
        return nextGroupId++;
      }
    },
    tabGroups: {
      async update(id, data) { calls.groupUpdate.push([id, { ...data }]); return { id, ...data }; },
      async move(id, data) { calls.groupMove.push([id, { ...data }]); return { id, ...data }; }
    }
  };
  return { api, calls };
}

function makeSnapshot() {
  return createSessionSnapshot([{
    index: 0,
    incognito: false,
    focused: true,
    type: "normal",
    state: "normal",
    left: 10,
    top: 20,
    width: 900,
    height: 700,
    tabs: [
      { url: "bad://blocked/", title: "Bad", index: 0, active: false, pinned: false, groupKey: null },
      { url: "https://one.test/", title: "One", index: 1, active: true, pinned: true, groupKey: "g1" },
      { url: "file:///C:/two.html", title: "Two", index: 2, active: false, pinned: false, groupKey: "g1" }
    ],
    groups: [{ key: "g1", title: "恢复组", color: "blue", collapsed: true, index: 0 }]
  }, {
    index: 1,
    incognito: true,
    focused: false,
    type: "normal",
    state: "maximized",
    left: 99,
    top: 88,
    width: 700,
    height: 500,
    tabs: [{ url: "chrome://extensions/", title: "Extensions", index: 0, active: true, pinned: false, groupKey: null }],
    groups: []
  }]);
}

test("恢复引擎隔离失败 URL 并继续恢复窗口、标签和分组", async () => {
  const { api, calls } = makeChromeMock();
  const result = await restoreSessionSnapshot(makeSnapshot(), api);
  assert.equal(result.windowsCreated, 2);
  assert.equal(result.tabsRequested, 4);
  assert.equal(result.tabsCreated, 3);
  assert.equal(result.groupsCreated, 1);
  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0].target, "bad://blocked/");
  assert.equal(calls.group.length, 1);
  assert.deepEqual(calls.groupUpdate[0][1], { title: "恢复组", color: "blue", collapsed: true });
});

test("普通窗口创建时带边界，最大化窗口创建时不混用边界", async () => {
  const { api, calls } = makeChromeMock();
  await restoreSessionSnapshot(makeSnapshot(), api);
  assert.equal(calls.windowCreate[0].left, 10);
  assert.equal(calls.windowCreate[0].width, 900);
  assert.equal("left" in calls.windowCreate[1], false);
  assert.ok(calls.windowUpdate.some(([, update]) => update.state === "maximized"));
  assert.ok(calls.windowUpdate.some(([, update]) => update.focused === true));
});
