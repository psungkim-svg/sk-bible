import { useSyncExternalStore } from 'react';

export type Theme = 'light' | 'sepia' | 'dark';
export type Tab = 0 | 1 | 2 | 3 | 4 | 'bookmarks' | 'search' | 'settings';

export interface Loc { book: number; chapter: number; verse: number; }

export interface PageState extends Loc {
  history: Loc[];          // 뒤로가기용 이전 위치
  flash?: number;          // 이동 직후 강조할 절
  nav?: number;            // 이동 요청 번호(스크롤 트리거)
}

export interface Bookmark {
  id: string;
  book: number;
  chapter: number;
  verses: number[];
  memo: string;
  createdAt: number;
}

export type HlColor = 'yellow' | 'green' | 'blue' | 'pink';

export interface Settings {
  fontSize: number;
  lineHeight: number;
  theme: Theme;
  fontFamily: 'sans' | 'serif';
  pageCount: number;          // 1~5
  keepAwake: boolean;
  swipe: boolean;
  copyBookStyle: 'full' | 'short';
  copyRefPosition: 'top' | 'bottom';
  copyVerseNumbers: 'auto' | 'always' | 'never';
}

export type SearchMode = 'word' | 'sentence';

export interface AppState {
  tab: Tab;
  lastPage: number;
  pages: PageState[];
  bookmarks: Bookmark[];
  highlights: Record<string, HlColor>; // key "b:c:v"
  settings: Settings;
  recentSearches: string[];
  searchMode: SearchMode;
}

const DEFAULT_PAGES: PageState[] = [
  { book: 0, chapter: 1, verse: 1, history: [] },   // 창세기 1
  { book: 18, chapter: 23, verse: 1, history: [] }, // 시편 23
  { book: 42, chapter: 3, verse: 1, history: [] },  // 요한복음 3
  { book: 44, chapter: 8, verse: 1, history: [] },  // 로마서 8
  { book: 39, chapter: 5, verse: 1, history: [] },  // 마태복음 5
];

export const DEFAULT_SETTINGS: Settings = {
  fontSize: 19,
  lineHeight: 1.75,
  theme: 'light',
  fontFamily: 'sans',
  pageCount: 5,
  keepAwake: true,
  swipe: true,
  copyBookStyle: 'full',
  copyRefPosition: 'top',
  copyVerseNumbers: 'auto',
};

const KEY = 'sk-bible-v1';

function load(): AppState {
  const base: AppState = {
    tab: 0, lastPage: 0, pages: DEFAULT_PAGES, bookmarks: [], highlights: {},
    settings: DEFAULT_SETTINGS, recentSearches: [], searchMode: 'word',
  };
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return base;
    const s = JSON.parse(raw);
    return {
      ...base, ...s,
      settings: { ...DEFAULT_SETTINGS, ...(s.settings || {}) },
      pages: DEFAULT_PAGES.map((d, i) => ({ ...d, ...(s.pages?.[i] || {}), flash: undefined })),
    };
  } catch {
    return base;
  }
}

let state: AppState = load();
const listeners = new Set<() => void>();
let saveTimer: number | undefined;

function persist() {
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* 저장 공간 부족 */ }
  }, 250);
}
window.addEventListener('pagehide', () => {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* */ }
});

export function getState() { return state; }

export function setState(fn: (s: AppState) => Partial<AppState>) {
  state = { ...state, ...fn(state) };
  persist();
  listeners.forEach(l => l());
}

export function useStore<T>(sel: (s: AppState) => T): T {
  return useSyncExternalStore(
    cb => { listeners.add(cb); return () => listeners.delete(cb); },
    () => sel(state),
  );
}

/* ---------- 동작들 ---------- */

export function updatePage(i: number, patch: Partial<PageState>) {
  setState(s => ({ pages: s.pages.map((p, j) => (j === i ? { ...p, ...patch } : p)) }));
}

/** 페이지 i에서 새 위치로 이동 (이전 위치는 history에 저장) */
export function goTo(i: number, loc: { book: number; chapter: number; verse?: number }, opts: { record?: boolean; flash?: boolean } = {}) {
  const { record = true, flash = true } = opts;
  setState(s => ({
    pages: s.pages.map((p, j) => {
      if (j !== i) return p;
      const history = record ? [...p.history, { book: p.book, chapter: p.chapter, verse: p.verse }].slice(-30) : p.history;
      return {
        ...p, book: loc.book, chapter: loc.chapter, verse: loc.verse ?? 1, history,
        flash: flash && loc.verse ? loc.verse : undefined, nav: (p.nav ?? 0) + 1,
      };
    }),
  }));
}

export function goBack(i: number) {
  const p = state.pages[i];
  const prev = p.history[p.history.length - 1];
  if (!prev) return;
  updatePage(i, { ...prev, history: p.history.slice(0, -1), flash: undefined, nav: (p.nav ?? 0) + 1 });
}

export function openTab(tab: Tab) {
  setState(s => ({ tab, lastPage: typeof tab === 'number' ? tab : s.lastPage }));
}

export function addBookmark(book: number, chapter: number, verses: number[]) {
  const v = [...new Set(verses)].sort((a, b) => a - b);
  const exists = state.bookmarks.find(b => b.book === book && b.chapter === chapter && b.verses.join() === v.join());
  if (exists) return false;
  const now = Date.now();
  const bm: Bookmark = { id: now.toString(36) + Math.random().toString(36).slice(2, 8), book, chapter, verses: v, memo: '', createdAt: now };
  setState(s => ({ bookmarks: [bm, ...s.bookmarks] }));
  return true;
}

export function removeBookmark(id: string) {
  setState(s => ({ bookmarks: s.bookmarks.filter(b => b.id !== id) }));
}

export function updateBookmark(id: string, patch: Partial<Bookmark>) {
  setState(s => ({ bookmarks: s.bookmarks.map(b => (b.id === id ? { ...b, ...patch } : b)) }));
}

export function setHighlight(book: number, chapter: number, verses: number[], color: HlColor | null) {
  setState(s => {
    const h = { ...s.highlights };
    for (const v of verses) {
      const k = `${book}:${chapter}:${v}`;
      if (color) h[k] = color; else delete h[k];
    }
    return { highlights: h };
  });
}

export function setSettings(patch: Partial<Settings>) {
  setState(s => ({ settings: { ...s.settings, ...patch } }));
}

export function addRecentSearch(q: string) {
  setState(s => ({ recentSearches: [q, ...s.recentSearches.filter(x => x !== q)].slice(0, 12) }));
}

/* ---------- 백업 (폰 바꿀 때) ---------- */
export function exportBackup(): string {
  const { bookmarks, highlights, settings, pages } = state;
  return JSON.stringify({ app: 'sk-bible', version: 1, exportedAt: new Date().toISOString(), bookmarks, highlights, settings, pages }, null, 1);
}

export function importBackup(json: string, mode: 'merge' | 'replace') {
  const d = JSON.parse(json);
  if (d.app !== 'sk-bible' && d.app !== 'our-bible') throw new Error('SK-성경 백업 파일이 아닙니다');
  setState(s => {
    if (mode === 'replace') {
      return {
        bookmarks: d.bookmarks || [], highlights: d.highlights || {},
        settings: { ...DEFAULT_SETTINGS, ...(d.settings || {}) },
        pages: d.pages ? DEFAULT_PAGES.map((p, i) => ({ ...p, ...(d.pages[i] || {}) })) : s.pages,
      };
    }
    const ids = new Set(s.bookmarks.map(b => b.book + ':' + b.chapter + ':' + b.verses.join()));
    const add = (d.bookmarks || []).filter((b: Bookmark) => !ids.has(b.book + ':' + b.chapter + ':' + b.verses.join()));
    return {
      bookmarks: [...s.bookmarks, ...add].sort((a, b) => b.createdAt - a.createdAt),
      highlights: { ...(d.highlights || {}), ...s.highlights },
    };
  });
}
