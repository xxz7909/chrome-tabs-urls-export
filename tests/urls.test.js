import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeAddress,
  parseTextImport,
  uncPathToFileUrl,
  windowsPathToFileUrl
} from "../src/shared/urls.js";

test("Windows 本地路径转换为编码后的 file URL", () => {
  assert.equal(
    windowsPathToFileUrl("C:\\Users\\测试 User\\page #1.html"),
    "file:///C:/Users/%E6%B5%8B%E8%AF%95%20User/page%20%231.html"
  );
});

test("UNC 路径转换为带主机名的 file URL", () => {
  assert.equal(
    uncPathToFileUrl("\\\\server\\share name\\folder\\a.html"),
    "file://server/share%20name/folder/a.html"
  );
});

test("显式特殊协议保持为完整 URL", () => {
  assert.deepEqual(normalizeAddress("chrome://extensions/"), {
    valid: true,
    url: "chrome://extensions/",
    kind: "explicit-url"
  });
  assert.equal(normalizeAddress("about:blank").url, "about:blank");
  assert.equal(normalizeAddress("data:text/plain,hello").url, "data:text/plain,hello");
});

test("裸域名使用 HTTPS，localhost 使用 HTTP", () => {
  assert.equal(normalizeAddress("example.com/path").url, "https://example.com/path");
  assert.equal(normalizeAddress("localhost:8080/test").url, "http://localhost:8080/test");
  assert.equal(normalizeAddress("127.0.0.1:3000").url, "https://127.0.0.1:3000/");
});

test("TXT 解析忽略空行、保留重复项并单独报告错误", () => {
  const parsed = parseTextImport("\uFEFFhttps://example.com\r\n\r\nexample.com\nhttps://example.com\nnot a url");
  assert.equal(parsed.validEntries.length, 3);
  assert.equal(parsed.invalidEntries.length, 1);
  assert.deepEqual(parsed.validEntries.map((entry) => entry.url), [
    "https://example.com/",
    "https://example.com/",
    "https://example.com/"
  ]);
  assert.equal(parsed.invalidEntries[0].line, 5);
  assert.deepEqual(parsed.ignoredLines, [2]);
});
