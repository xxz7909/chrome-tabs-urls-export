import test from "node:test";
import assert from "node:assert/strict";
import {
  cloneAsImported,
  collectSessionUrls,
  createSessionFromUrls,
  createSessionSnapshot,
  fingerprintWindows,
  validateSessionSnapshot
} from "../src/shared/session.js";

function sampleWindows(title = "示例") {
  return [{
    index: 0,
    incognito: false,
    focused: true,
    type: "normal",
    state: "normal",
    left: 10,
    top: 20,
    width: 1000,
    height: 700,
    tabs: [
      { url: "https://example.com/", title, index: 0, active: true, pinned: true, groupKey: "g1" },
      { url: "chrome://extensions/", title: "扩展", index: 1, active: false, pinned: false, groupKey: "g1" }
    ],
    groups: [{ key: "g1", title: "工作", color: "blue", collapsed: false, index: 0 }]
  }];
}

test("会话指纹忽略页面标题和会话元数据", () => {
  assert.equal(fingerprintWindows(sampleWindows("标题 A")), fingerprintWindows(sampleWindows("标题 B")));
  const first = createSessionSnapshot(sampleWindows(), { name: "A", createdAt: "2026-01-01T00:00:00.000Z" });
  const second = createSessionSnapshot(sampleWindows(), { name: "B", createdAt: "2026-02-01T00:00:00.000Z" });
  assert.equal(first.fingerprint, second.fingerprint);
});

test("结构变化会改变会话指纹", () => {
  const changed = sampleWindows();
  changed[0].tabs[0].pinned = false;
  assert.notEqual(fingerprintWindows(sampleWindows()), fingerprintWindows(changed));
});

test("URL 列表会话保留顺序和重复项", () => {
  const snapshot = createSessionFromUrls(["https://a.test/", "https://a.test/", "file:///C:/a.html"], { incognito: true });
  assert.equal(snapshot.windows[0].incognito, true);
  assert.deepEqual(collectSessionUrls(snapshot), ["https://a.test/", "https://a.test/", "file:///C:/a.html"]);
  assert.equal(snapshot.windows[0].tabs[0].active, true);
});

test("JSON 会话校验并规范化可恢复字段", () => {
  const source = createSessionSnapshot(sampleWindows(), { createdAt: "2026-08-27T00:00:00.000Z" });
  source.untrusted = "ignored";
  const result = validateSessionSnapshot(source);
  assert.equal(result.valid, true);
  assert.equal(result.snapshot.createdAt, source.createdAt);
  assert.equal(result.snapshot.windows[0].groups[0].title, "工作");
  assert.equal("untrusted" in result.snapshot, false);
});

test("JSON 校验拒绝缺失 URL 和未知版本", () => {
  const result = validateSessionSnapshot({ schemaVersion: 99, windows: [{ tabs: [{ title: "missing" }] }] });
  assert.equal(result.valid, false);
  assert.match(result.errors.join("\n"), /schemaVersion/);
  assert.match(result.errors.join("\n"), /有效 URL/);
});

test("导入会话获得新 ID 并保留原始创建时间", () => {
  const original = createSessionSnapshot(sampleWindows(), { createdAt: "2026-08-01T00:00:00.000Z" });
  const imported = cloneAsImported(original);
  assert.equal(imported.valid, true);
  assert.notEqual(imported.snapshot.id, original.id);
  assert.equal(imported.snapshot.createdAt, original.createdAt);
  assert.equal(imported.snapshot.kind, "imported");
  assert.ok(imported.snapshot.importedAt);
});
