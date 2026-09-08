import test from "node:test";
import assert from "node:assert/strict";
import { captureBrowserState } from "../src/background/capture.js";

function makeChromeMock() {
  const windows = [{
    id: 1,
    incognito: false,
    focused: true,
    type: "normal",
    state: "normal",
    left: 0,
    top: 0,
    width: 1200,
    height: 800,
    tabs: [
      { id: 10, index: 0, url: "https://example.com/", title: "Example", active: true, pinned: true, groupId: 7 },
      { id: 11, index: 1, url: "chrome-extension://self/src/manager/manager.html", title: "Manager", active: false, pinned: false, groupId: -1 }
    ]
  }, {
    id: 2,
    incognito: true,
    focused: false,
    type: "normal",
    state: "maximized",
    tabs: [{ id: 20, index: 0, pendingUrl: "file:///C:/test.html", title: "Local", active: true, pinned: false, groupId: -1 }]
  }];
  return {
    runtime: { getURL: () => "chrome-extension://self/" },
    windows: {
      getAll: async () => windows,
      getLastFocused: async () => windows[0]
    },
    tabGroups: {
      query: async () => [{ id: 7, windowId: 1, title: "工作", color: "green", collapsed: true }]
    }
  };
}

test("全部捕获包含普通和无痕窗口并排除扩展自己的页面", async () => {
  const snapshot = await captureBrowserState({ scope: "all", chromeApi: makeChromeMock() });
  assert.equal(snapshot.windows.length, 2);
  assert.equal(snapshot.windows[0].tabs.length, 1);
  assert.equal(snapshot.windows[0].tabs[0].pinned, true);
  assert.equal(snapshot.windows[0].groups[0].title, "工作");
  assert.equal(snapshot.windows[1].incognito, true);
  assert.equal(snapshot.windows[1].tabs[0].url, "file:///C:/test.html");
});

test("当前窗口捕获只调用最近聚焦窗口", async () => {
  const snapshot = await captureBrowserState({ scope: "current", chromeApi: makeChromeMock() });
  assert.equal(snapshot.windows.length, 1);
  assert.equal(snapshot.windows[0].incognito, false);
});
