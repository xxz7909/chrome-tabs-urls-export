import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

test("Manifest V3 引用的后台和弹窗文件存在", () => {
  const manifest = JSON.parse(readFileSync("manifest.json", "utf8"));
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.incognito, "spanning");
  assert.ok(manifest.permissions.includes("tabs"));
  assert.ok(manifest.permissions.includes("tabGroups"));
  assert.ok(manifest.permissions.includes("unlimitedStorage"));
  assert.ok(manifest.host_permissions.includes("file:///*"));
  assert.ok(existsSync(manifest.background.service_worker));
  assert.ok(existsSync(manifest.action.default_popup));
});

test("说明和进度文档只放在 docs 目录", () => {
  for (const file of ["docs/README.md", "docs/ARCHITECTURE.md", "docs/PROGRESS.md"]) {
    assert.ok(existsSync(file), `${file} 应存在`);
  }
  assert.equal(existsSync("README.md"), false);
});

test("扩展页面仅引用存在的本地资源", () => {
  for (const htmlFile of ["src/popup/popup.html", "src/manager/manager.html"]) {
    const html = readFileSync(htmlFile, "utf8");
    assert.doesNotMatch(html, /<(?:script|link)[^>]+(?:src|href)=["']https?:\/\//i);
    const references = [...html.matchAll(/<(?:script|link)[^>]+(?:src|href)=["']([^"']+)["']/gi)]
      .map((match) => match[1]);
    for (const reference of references) {
      const target = path.resolve(path.dirname(htmlFile), reference);
      assert.ok(existsSync(target), `${htmlFile} 引用的 ${reference} 应存在`);
    }
  }
});
