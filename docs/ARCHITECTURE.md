# 架构说明

## 目标和边界

扩展在 Chrome Manifest V3 下运行，以当前 Chrome 用户配置文件为边界。普通和无痕上下文使用 `spanning` 模式共享后台和本地数据。扩展不包含内容脚本、远程 API、云同步或原生辅助程序。

## 组件

### 后台 Service Worker

`src/background/service-worker.js` 是唯一的写入协调者，负责：

- 注册 Chrome 标签、窗口、标签组、启动和闹钟事件。
- 响应弹窗与管理页的消息。
- 调用捕获、存储和恢复模块。
- 更新最新非空状态并归档自动历史。

监听器在模块顶层同步注册，避免 Service Worker 被重新唤醒时漏接事件。持久化状态不依赖全局变量。

### 捕获模块

`capture.js` 使用 `windows.getAll({ populate: true })` 或 `windows.getLastFocused()` 获取窗口与标签，再查询标签组元数据。捕获过程会：

- 按标签索引保存顺序。
- 优先使用正在导航的 `pendingUrl`，否则使用 `url`。
- 排除本扩展自身的 `chrome-extension://` 页面。
- 把运行期标签组 ID 映射为会话内部稳定键。
- 同时保存普通/无痕类型、焦点、窗口状态与可用边界。

### 会话仓库

- `chrome.storage.local` 保存设置、最新非空快照和最近归档指纹。
- IndexedDB 数据库 `tab-session-manager` 保存永久会话历史。
- `sessions` 对象仓库以 `id` 为主键，并按 `createdAt`、`kind` 和 `fingerprint` 建立索引。
- 实时状态用规范化 FNV-1a 指纹维护；手动保存和强制启动恢复点不会因重复而丢弃。

所有历史没有自动淘汰规则。删除只能由用户在管理页确认后触发。

### 恢复模块

恢复引擎按窗口顺序串行工作：

1. 使用 `about:blank` 创建目标普通或无痕窗口。
2. 逐个更新/创建标签，以便单个 URL 失败时继续后续项目。
3. 恢复置顶状态并记录源标签到新标签 ID 的映射。
4. 按内部分组键重新建立标签组，写回标题、颜色和折叠状态。
5. 激活原活动标签。
6. 根据 Chrome 规则分别恢复窗口边界或最大化、最小化、全屏状态。
7. 最后恢复原焦点窗口。

恢复返回结构化结果，包含请求数、成功数和按阶段归类的失败项。现有窗口不会被关闭。

## 会话数据结构

当前公开交换格式为 `SessionSnapshotV1`：

```text
SessionSnapshotV1
  schemaVersion: 1
  id: string
  name: string
  kind: manual | automatic | imported | recovery
  createdAt: ISO-8601 UTC string
  importedAt?: ISO-8601 UTC string
  scope: current | all | import
  fingerprint: string
  windows: WindowSnapshot[]

WindowSnapshot
  index, incognito, focused, type, state
  left?, top?, width?, height?
  tabs: TabSnapshot[]
  groups: GroupSnapshot[]

TabSnapshot
  url, title, index, active, pinned, groupKey

GroupSnapshot
  key, title, color, collapsed, index
```

导入 JSON 时只复制上述白名单字段。文件中的未知字段、原始浏览器运行期 ID 和可执行内容不会进入内部对象。

## 状态捕获状态机

Chrome 事件触发进程内防抖计时器和可重置的一次性闹钟：

- 进程内计时器：约 2 秒后覆盖 `liveSnapshot`；Service Worker 的通常空闲终止窗口长于该延迟。
- `live-state-capture`：至少 30 秒后再次覆盖 `liveSnapshot`，在进程内计时器丢失时兜底。
- 不再安排稳定归档，实时状态只写入 `chrome.storage.local`。

窗口关闭时仍会延迟捕获剩余窗口；若所有窗口已经关闭，空捕获不会覆盖旧的有效状态。浏览器启动事件会把遗留状态强制归档为 `recovery` 类型。

## TXT 解析规则

解析顺序是：UNC 路径、Windows 盘符路径、显式 URL 协议、`localhost`、IPv4/裸域名。显式协议不按 HTTP 白名单过滤。无法识别的非空行被列为错误，不会作为浏览器搜索词打开。重复地址不去重。

## 内部消息接口

界面通过 `chrome.runtime.sendMessage` 调用后台，统一获得 `{ ok, data }` 或 `{ ok: false, error }`：

| 操作 | 输入 | 输出 |
| --- | --- | --- |
| `GET_STATUS` | 无 | 权限、设置、总数和最近会话 |
| `CAPTURE_PREVIEW` | `scope` | 不落库的当前快照 |
| `SAVE_MANUAL` | `scope`, `name?` | 新会话摘要 |
| `LIST_SESSIONS` | `search`, `kind`, `limit` | 按时间倒序的摘要 |
| `GET_SESSION` | `id` | 完整会话 |
| `RENAME_SESSION` | `id`, `name` | 更新后的摘要 |
| `DELETE_SESSION` | `id` | 已删除 ID |
| `RESTORE_SESSION` | `id` | 恢复结果 |
| `RESTORE_SNAPSHOT` | `snapshot` | 校验后的恢复结果 |
| `RESTORE_URLS` | `urls`, `incognito` | 单窗口恢复结果 |
| `IMPORT_SESSION` | `snapshot`, `name?` | 新导入会话摘要 |

## 安全策略

- 没有外部脚本、远程字体或运行期代码生成。
- 界面渲染导入内容、标题和 URL 时使用 `textContent`，不插入来源不可信的 HTML。
- JSON 在后台和管理页各验证一次。
- 失败 URL 只作为 Chrome API 参数使用，不会在扩展页面内执行。
- 删除操作需要用户确认；恢复只新建窗口，不执行覆盖式关闭。
