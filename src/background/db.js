const DB_NAME = "tab-session-manager";
const DB_VERSION = 1;
const SESSION_STORE = "sessions";

let databasePromise;

export function openDatabase() {
  if (!databasePromise) {
    databasePromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onerror = () => reject(request.error);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(SESSION_STORE)) {
          const store = database.createObjectStore(SESSION_STORE, { keyPath: "id" });
          store.createIndex("createdAt", "createdAt", { unique: false });
          store.createIndex("kind", "kind", { unique: false });
          store.createIndex("fingerprint", "fingerprint", { unique: false });
        }
      };
      request.onsuccess = () => resolve(request.result);
    });
  }
  return databasePromise;
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error || new Error("数据库事务已中止"));
  });
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function putSession(snapshot) {
  const database = await openDatabase();
  const transaction = database.transaction(SESSION_STORE, "readwrite");
  transaction.objectStore(SESSION_STORE).put(snapshot);
  await transactionDone(transaction);
  return snapshot;
}

export async function getSession(id) {
  const database = await openDatabase();
  const transaction = database.transaction(SESSION_STORE, "readonly");
  return requestResult(transaction.objectStore(SESSION_STORE).get(id));
}

export async function deleteSession(id) {
  const database = await openDatabase();
  const transaction = database.transaction(SESSION_STORE, "readwrite");
  transaction.objectStore(SESSION_STORE).delete(id);
  await transactionDone(transaction);
}

export async function deleteSessionsByTimeRange(startAt, endAt) {
  if (!Number.isFinite(startAt) || !Number.isFinite(endAt) || startAt > endAt) {
    throw new Error("时间范围无效");
  }

  const database = await openDatabase();
  const transaction = database.transaction(SESSION_STORE, "readwrite");
  const range = IDBKeyRange.bound(new Date(startAt).toISOString(), new Date(endAt).toISOString());
  const request = transaction.objectStore(SESSION_STORE).index("createdAt").openCursor(range);
  let deleted = 0;
  request.onsuccess = () => {
    const cursor = request.result;
    if (!cursor) return;
    cursor.delete();
    deleted += 1;
    cursor.continue();
  };
  await transactionDone(transaction);
  return deleted;
}

export async function countSessions() {
  const database = await openDatabase();
  const transaction = database.transaction(SESSION_STORE, "readonly");
  return requestResult(transaction.objectStore(SESSION_STORE).count());
}

export async function listSessions({ search = "", kind = "all", limit = 500 } = {}) {
  const database = await openDatabase();
  const transaction = database.transaction(SESSION_STORE, "readonly");
  const index = transaction.objectStore(SESSION_STORE).index("createdAt");
  const normalizedSearch = search.trim().toLocaleLowerCase("zh-CN");

  return new Promise((resolve, reject) => {
    const matches = [];
    const cursorRequest = index.openCursor(null, "prev");
    cursorRequest.onerror = () => reject(cursorRequest.error);
    cursorRequest.onsuccess = () => {
      const cursor = cursorRequest.result;
      if (!cursor || matches.length >= limit) {
        resolve(matches);
        return;
      }

      const session = cursor.value;
      const kindMatches = kind === "all" || session.kind === kind;
      const searchMatches = !normalizedSearch || sessionMatchesSearch(session, normalizedSearch);
      if (kindMatches && searchMatches) {
        matches.push(session);
      }
      cursor.continue();
    };
  });
}

function sessionMatchesSearch(session, normalizedSearch) {
  if (String(session.name || "").toLocaleLowerCase("zh-CN").includes(normalizedSearch)) {
    return true;
  }

  return session.windows.some((windowSnapshot) => windowSnapshot.tabs.some((tab) => {
    const searchable = `${tab.title || ""}\n${tab.url || ""}`.toLocaleLowerCase("zh-CN");
    return searchable.includes(normalizedSearch);
  }));
}
