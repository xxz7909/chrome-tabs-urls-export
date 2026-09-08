const WINDOWS_DRIVE_PATH = /^[a-zA-Z]:[\\/]/;
const WINDOWS_UNC_PATH = /^\\\\[^\\]+\\[^\\]+/;
const EXPLICIT_SCHEME = /^[a-zA-Z][a-zA-Z\d+.-]*:/;
const LOCALHOST_ADDRESS = /^localhost(?::\d+)?(?:[/?#].*)?$/i;
const IPV4_ADDRESS = /^(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?(?:[/?#].*)?$/;
const BARE_DOMAIN = /^(?:[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?\.)+[a-z]{2,63}(?::\d+)?(?:[/?#].*)?$/i;

function encodePathSegments(path) {
  return path
    .split("/")
    .map((segment, index) => {
      if (index === 0 && /^[a-zA-Z]:$/.test(segment)) {
        return segment;
      }
      return encodeURIComponent(segment);
    })
    .join("/");
}

export function windowsPathToFileUrl(value) {
  const normalized = value.replace(/\\/g, "/");
  return `file:///${encodePathSegments(normalized)}`;
}

export function uncPathToFileUrl(value) {
  const normalized = value.replace(/^\\\\/, "").replace(/\\/g, "/");
  const [host, ...segments] = normalized.split("/");
  return `file://${host}/${segments.map(encodeURIComponent).join("/")}`;
}

export function normalizeAddress(rawValue) {
  const value = String(rawValue ?? "").trim();

  if (!value) {
    return { valid: false, error: "空白行" };
  }

  try {
    if (WINDOWS_UNC_PATH.test(value)) {
      return { valid: true, url: uncPathToFileUrl(value), kind: "unc-path" };
    }

    if (WINDOWS_DRIVE_PATH.test(value)) {
      return { valid: true, url: windowsPathToFileUrl(value), kind: "windows-path" };
    }

    if (LOCALHOST_ADDRESS.test(value)) {
      return { valid: true, url: new URL(`http://${value}`).href, kind: "localhost" };
    }

    if (IPV4_ADDRESS.test(value) || BARE_DOMAIN.test(value)) {
      return { valid: true, url: new URL(`https://${value}`).href, kind: "bare-host" };
    }

    if (EXPLICIT_SCHEME.test(value)) {
      return { valid: true, url: new URL(value).href, kind: "explicit-url" };
    }
  } catch (error) {
    return { valid: false, error: `地址格式错误：${error.message}` };
  }

  return { valid: false, error: "无法识别为 URL、本地路径或域名" };
}

export function parseTextImport(text) {
  const source = String(text ?? "").replace(/^\uFEFF/, "");
  const entries = [];
  const ignoredLines = [];

  source.split(/\r\n?|\n/).forEach((raw, index) => {
    const input = raw.trim();
    if (!input) {
      ignoredLines.push(index + 1);
      return;
    }

    const normalized = normalizeAddress(input);
    entries.push({
      line: index + 1,
      input,
      ...normalized
    });
  });

  return {
    entries,
    validEntries: entries.filter((entry) => entry.valid),
    invalidEntries: entries.filter((entry) => !entry.valid),
    ignoredLines
  };
}

export function urlsToText(urls) {
  return urls.filter(Boolean).join("\n");
}
