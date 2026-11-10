/* ================================================================
   AI 결과 저장소 (v1.8)
   - 예전: localStorage (폰마다 5MB 정도라서 구절 80개 · 장 60개만 저장)
   - 지금: IndexedDB (수백 MB까지) → 한 번 본 AI 해설은 거의 다 남아
     인터넷 · AI 없이 바로 다시 보입니다.
   - 앱이 켜질 때 한 번 전부 메모리로 읽어 두므로, 쓰는 쪽(cacheGet/cacheSet)은 예전과 똑같이 바로 동작합니다.
   - IndexedDB를 쓸 수 없는 경우에는 예전처럼 localStorage에 저장합니다.
   ================================================================ */

const DB = 'sk-bible-ai';
const STORE = 'kv';
/** 예전 localStorage 이름 → 처음 한 번 옮겨 옴 */
const OLD_NS = ['sk-ai-verse-v4', 'sk-ai-vextra-v1', 'sk-ai-lex-v1', 'sk-ai-bg-v1', 'sk-ai-term-v1', 'sk-ai-chap-v1'];
/** 종류별 최대 개수 (넉넉하게 — 다 차면 가장 오래 안 본 것부터 지움) */
const LIMIT: Record<string, number> = {
  'sk-ai-verse-v4': 3000, 'sk-ai-vextra-v1': 3000, 'sk-ai-chap-v1': 1300, 'sk-topic-v2': 1300,
  'sk-ai-lex-v1': 3000, 'sk-ai-bg-v1': 1300, 'sk-ai-term-v1': 2000, 'sk-ai-find-v1': 500,
  // v1.8.3: 해설을 절반 길이로 간추린 새 저장소
  'sk-ai-verse-v5': 3000, 'sk-ai-vextra-v2': 3000, 'sk-ai-chap-v2': 1300, 'sk-topic-v3': 1300, 'sk-ai-bg-v2': 1300,
  // v1.9: 근거 있는 해설 (주석 원문 문장 + 번역)
  'sk-ai-verse-v6': 5000, 'sk-ai-chap-v3': 1300, 'sk-ai-bg-v4': 1500, 'sk-ai-para-v1': 1300, 'sk-ai-find-v2': 500,
  // v1.9.4: 인물 소개 (Easton 성경사전 원문 + 쉬운 번역)
  'sk-ai-who-v1': 3000,
};
/** v1.8.3: 길고 장황했던 예전 해설 — 앱이 켜질 때 지워서 공간 확보 (새로 열면 짧은 해설을 다시 받음) */
const RETIRED = ['sk-ai-verse-v4', 'sk-ai-vextra-v1', 'sk-ai-chap-v1', 'sk-topic-v2', 'sk-ai-bg-v1',
  // v1.9: AI가 지어 쓰던 해설·장 주제·단락 요약은 지우고, 주석 원문 번역으로 새로 받음
  'sk-ai-verse-v5', 'sk-ai-vextra-v2', 'sk-ai-chap-v2', 'sk-topic-v3', 'sk-ai-bg-v2', 'sk-ai-find-v1', 'sk-ai-bg-v3'];

interface Row { k: string; v: unknown; t: number }
const mem = new Map<string, Map<string, Row>>();
let db: IDBDatabase | null = null;
let useLocal = false;

function bucket(ns: string) {
  let m = mem.get(ns);
  if (!m) { m = new Map(); mem.set(ns, m); }
  return m;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => { r.result.createObjectStore(STORE); };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
    r.onblocked = () => rej(new Error('blocked'));
  });
}

function put(ns: string, row: Row) {
  if (!db) return;
  try { db.transaction(STORE, 'readwrite').objectStore(STORE).put(row, ns + '|' + row.k); } catch { /* 무시 */ }
}
function del(ns: string, k: string) {
  if (!db) return;
  try { db.transaction(STORE, 'readwrite').objectStore(STORE).delete(ns + '|' + k); } catch { /* 무시 */ }
}

/** 앱 시작 때 한 번: IndexedDB → 메모리, 예전 localStorage 자료 옮기기 */
export async function initAiCache(): Promise<void> {
  try {
    if (!('indexedDB' in window)) throw new Error('no idb');
    db = await openDb();
    const rows = await new Promise<{ key: string; val: Row }[]>((res, rej) => {
      const out: { key: string; val: Row }[] = [];
      const req = db!.transaction(STORE, 'readonly').objectStore(STORE).openCursor();
      req.onsuccess = () => {
        const c = req.result;
        if (!c) { res(out); return; }
        out.push({ key: String(c.key), val: c.value as Row });
        c.continue();
      };
      req.onerror = () => rej(req.error);
    });
    for (const { key, val } of rows) {
      const i = key.indexOf('|');
      if (i > 0 && val && typeof val === 'object') bucket(key.slice(0, i)).set(val.k, val);
    }
    // 예전 localStorage 저장분 옮기기 (옮긴 뒤에는 지워서 공간 확보)
    let t = Date.now() - 1e7;
    for (const ns of OLD_NS) {
      const raw = localStorage.getItem(ns);
      if (!raw) continue;
      try {
        const obj = JSON.parse(raw) as Record<string, unknown>;
        const b = bucket(ns);
        for (const [k, v] of Object.entries(obj)) {
          if (b.has(k)) continue;
          const row = { k, v, t: t++ };
          b.set(k, row);
          put(ns, row);
        }
        localStorage.removeItem(ns);
      } catch { /* 망가진 자료는 무시 */ }
    }
    for (const ns of RETIRED) {
      const b = mem.get(ns);
      if (b) { for (const k of b.keys()) del(ns, k); mem.delete(ns); }
    }
    // 폰이 공간이 부족할 때 마음대로 지우지 않도록 요청
    try { await navigator.storage?.persist?.(); } catch { /* 무시 */ }
  } catch {
    db = null;
    useLocal = true;
  }
}

function localLoad(ns: string): Record<string, unknown> {
  try { return JSON.parse(localStorage.getItem(ns) || '{}'); } catch { return {}; }
}

export function cacheGet<T>(ns: string, k: string): T | undefined {
  if (useLocal) return localLoad(ns)[k] as T | undefined;
  const row = bucket(ns).get(k);
  return row ? (row.v as T) : undefined;
}

/** max: 예전 값(무시하고 넉넉한 한도를 씀) */
export function cacheSet<T>(ns: string, k: string, v: T, max?: number) {
  if (useLocal) {
    const c = localLoad(ns);
    delete c[k]; c[k] = v;
    const keys = Object.keys(c);
    const lim = max ?? 80;
    if (keys.length > lim) keys.slice(0, keys.length - lim).forEach(x => delete c[x]);
    try { localStorage.setItem(ns, JSON.stringify(c)); } catch {
      keys.slice(0, Math.floor(keys.length / 2)).forEach(x => delete c[x]);
      try { localStorage.setItem(ns, JSON.stringify(c)); } catch { /* 포기 */ }
    }
    return;
  }
  const b = bucket(ns);
  const row = { k, v, t: Date.now() };
  b.set(k, row);
  put(ns, row);
  const lim = Math.max(LIMIT[ns] ?? 1000, max ?? 0);
  if (b.size > lim) {
    const old = [...b.values()].sort((x, y) => x.t - y.t).slice(0, b.size - lim);
    for (const r of old) { b.delete(r.k); del(ns, r.k); }
  }
}

export function cacheDelete(ns: string, k: string) {
  if (useLocal) { const c = localLoad(ns); delete c[k]; try { localStorage.setItem(ns, JSON.stringify(c)); } catch { /* 무시 */ } return; }
  bucket(ns).delete(k); del(ns, k);
}

export function cacheClearNs(ns: string) {
  if (useLocal) { localStorage.removeItem(ns); return; }
  for (const k of [...bucket(ns).keys()]) del(ns, k);
  mem.delete(ns);
}

export function cacheCount(ns?: string) {
  if (useLocal) return ns ? Object.keys(localLoad(ns)).length : 0;
  if (ns) return bucket(ns).size;
  let n = 0; mem.forEach(m => { n += m.size; }); return n;
}
