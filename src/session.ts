/** Token cihazda saklanır: "hatırla" seçiliyse localStorage, değilse sekme kapanınca silinen sessionStorage. */
const KEY = 'newspaper-of-us.session';
const DRAFT_PREFIX = 'newspaper-of-us.draft.';
const CACHE_DB = 'newspaper-of-us-cache';

export interface Session {
  token: string;
  name: string;
  remember: boolean;
}

export function loadSession(): Session | null {
  const raw = localStorage.getItem(KEY) ?? sessionStorage.getItem(KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Session;
  } catch {
    return null;
  }
}

export function saveSession(session: Session) {
  cacheClosed = false;
  clearStoredSession();
  (session.remember ? localStorage : sessionStorage).setItem(KEY, JSON.stringify(session));
}

function clearStoredSession() {
  localStorage.removeItem(KEY);
  sessionStorage.removeItem(KEY);
}

/** Çıkış yaparken token, taslaklar ve önbellekteki özel içerik cihazdan silinir. */
export function endSession() {
  cacheClosed = true;
  clearStoredSession();
  for (const store of [localStorage, sessionStorage]) {
    for (const key of Object.keys(store)) {
      if (key.startsWith(DRAFT_PREFIX)) store.removeItem(key);
    }
  }
  closeCache();
  indexedDB.deleteDatabase(CACHE_DB);
}

function draftStore(session: Session) {
  return session.remember ? localStorage : sessionStorage;
}

export function saveDraft(session: Session, key: string, draft: unknown) {
  try {
    draftStore(session).setItem(DRAFT_PREFIX + key, JSON.stringify(draft));
  } catch {
    // Depolama doluysa taslak tutulmaz; asıl kayıt yine de çalışır.
  }
}

export function loadDraft<T>(session: Session, key: string): T | null {
  const raw = draftStore(session).getItem(DRAFT_PREFIX + key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function clearDraft(session: Session, key: string) {
  draftStore(session).removeItem(DRAFT_PREFIX + key);
}

// --- Dosya önbelleği ---
// Git dosyaları içerik adresli: aynı sha her zaman aynı içerik, yani geçersiz kılma gerekmez.
// Yalnızca "cihazı hatırla" açıkken diske yazılır.

let db: Promise<IDBDatabase | null> | null = null;
/** Çıkıştan sonra hâlâ yolda olan indirmeler silinen önbelleği geri getirmesin. */
let cacheClosed = false;

function closeCache() {
  db?.then((d) => d?.close());
  db = null;
}

function openCache(): Promise<IDBDatabase | null> {
  if (cacheClosed) return Promise.resolve(null);
  db ??= new Promise((resolve) => {
    try {
      const req = indexedDB.open(CACHE_DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore('blobs');
      req.onsuccess = () => {
        // Başka sekme çıkış yapıp önbelleği silerken bu sekme silmeyi bekletmesin.
        req.result.onversionchange = () => {
          req.result.close();
          db = null;
        };
        resolve(req.result);
      };
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return db;
}

export async function cacheGet(sha: string): Promise<ArrayBuffer | null> {
  const d = await openCache();
  if (!d) return null;
  return new Promise((resolve) => {
    try {
      const req = d.transaction('blobs').objectStore('blobs').get(sha);
      req.onsuccess = () => resolve((req.result as ArrayBuffer) ?? null);
      req.onerror = () => resolve(null);
    } catch {
      // Bağlantı çıkış sırasında kapanmış olabilir.
      resolve(null);
    }
  });
}

export async function cachePut(sha: string, data: ArrayBuffer): Promise<void> {
  const d = await openCache();
  if (!d) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = d.transaction('blobs', 'readwrite');
      tx.objectStore('blobs').put(data, sha);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
}
