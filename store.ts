import { useSyncExternalStore } from 'react';

export type Theme = 'light' | 'sepia' | 'dark';
export type Tab = number | 'bookmarks' | 'search' | 'settings';
export const MAX_PAGES = 10;

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

/** 암송 카드 */
export interface MemCard {
  id: string;
  book: number;
  chapter: number;
  verses: number[];
  level: number;      // 0~5 (외운 정도)
  due: number;        // 다음 복습 날짜 (ms)
  reviews: number;    // 연습한 횟수
  createdAt: number;
}

export type HlColor = 'yellow' | 'green' | 'blue' | 'pink';

export interface Settings {
  fontSize: number;
  lineHeight: number;
  theme: Theme;
  fontFamily: 'sans' | 'serif';
  pageCount: number;          // 1~10
  keepAwake: boolean;
  swipe: boolean;
  copyBookStyle: 'full' | 'short';
  copyRefPosition: 'top' | 'bottom';
  copyVerseNumbers: 'auto' | 'always' | 'never';
  verseGap: number;           // 절 간격 (px)
  sideMargin: number;         // 좌우 여백 (px)
  verseNumStyle: 'inline' | 'hang'; // 절 번호: 글 안에 / 왼쪽 칸
  aiSearch: boolean;          // 문장 찾기에 AI 설명 사용
  wrapMode: 'char' | 'word';  // 줄바꿈: 글자 단위(꽉 차게) / 낱말 단위
  showHeadings: boolean;      // 단락 소제목
  showTopic: boolean;         // 장 주제
  uiFontSize: number;         // 성경 본문 말고 나머지 글씨 (메뉴·버튼·설명)
}

export type SearchMode = 'word' | 'sentence';

export interface AppState {
  tab: Tab;
  lastPage: number;
  pages: PageState[];
  bookmarks: Bookmark[];
  memory: MemCard[];
  highlights: Record<string, HlColor>; // key "b:c:v"
  settings: Settings;
  recentSearches: string[];
  searchMode: SearchMode;
  bmMode: 'bm' | 'mem';   // 북마크 화면: 북마크 / 암송
}

const DEFAULT_PAGES: PageState[] = [
  { book: 0, chapter: 1, verse: 1, history: [] },   // 창세기 1
  { book: 18, chapter: 23, verse: 1, history: [] }, // 시편 23
  { book: 42, chapter: 3, verse: 1, history: [] },  // 요한복음 3
  { book: 44, chapter: 8, verse: 1, history: [] },  // 로마서 8
  { book: 39, chapter: 5, verse: 1, history: [] },  // 마태복음 5
  { book: 22, chapter: 53, verse: 1, history: [] }, // 이사야 53
  { book: 19, chapter: 3, verse: 1, history: [] },  // 잠언 3
  { book: 43, chapter: 1, verse: 1, history: [] },  // 사도행전 1
  { book: 57, chapter: 11, verse: 1, history: [] }, // 히브리서 11
  { book: 65, chapter: 21, verse: 1, history: [] }, // 요한계시록 21
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
  verseGap: 6,
  sideMargin: 4,
  verseNumStyle: 'inline',
  aiSearch: true,
  wrapMode: 'char',
  showHeadings: true,
  showTopic: true,
  uiFontSize: 20,
};

const KEY = 'sk-bible-v1';

function load(): AppState {
  const base: AppState = {
    tab: 0, lastPage: 0, pages: DEFAULT_PAGES, bookmarks: [], memory: [], highlights: {},
    settings: DEFAULT_SETTINGS, recentSearches: [], searchMode: 'word', bmMode: 'bm',
  };
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return base;
    const s = JSON.parse(raw);
    return {
      ...base, ...s,
      tab: 0, lastPage: 0, // 앱을 켜면 항상 페이지 1
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
  if (record) pushUndo({ t: 'loc', page: i });
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

/* ---------- 뒤로 버튼용 '이전 화면' 기록 (앱을 다시 열면 비워짐) ---------- */
type Undo = { t: 'tab'; tab: Tab } | { t: 'loc'; page: number };
const undo: Undo[] = [];
function pushUndo(u: Undo) {
  undo.push(u);
  if (undo.length > 60) undo.shift();
}

export function openTab(tab: Tab, record = true) {
  if (tab === state.tab) return;
  if (record) pushUndo({ t: 'tab', tab: state.tab });
  setState(s => ({ tab, lastPage: typeof tab === 'number' ? tab : s.lastPage }));
}

/** 이전 화면으로. 돌아갈 곳이 없으면 false */
export function navBack(): boolean {
  while (undo.length) {
    const u = undo.pop()!;
    if (u.t === 'tab') {
      if (u.tab === state.tab || (typeof u.tab === 'number' && u.tab >= state.settings.pageCount)) continue;
      openTab(u.tab, false);
      return true;
    }
    if (u.page >= state.settings.pageCount || !state.pages[u.page].history.length) continue;
    goBack(u.page);
    openTab(u.page as Tab, false);
    return true;
  }
  return false;
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

export function setBmMode(bmMode: 'bm' | 'mem') { setState(() => ({ bmMode })); }

/* ---------- 암송 카드 ---------- */
const DAY = 86400000;
export const MEM_GAPS = [0, 1, 3, 7, 14, 30]; // 외운 정도별 다음 복습까지 (일)

export function addMemory(book: number, chapter: number, verses: number[]) {
  const v = [...new Set(verses)].sort((a, b) => a - b);
  if (state.memory.some(m => m.book === book && m.chapter === chapter && m.verses.join() === v.join())) return false;
  const now = Date.now();
  const card: MemCard = { id: now.toString(36) + Math.random().toString(36).slice(2, 8), book, chapter, verses: v, level: 0, due: now, reviews: 0, createdAt: now };
  setState(s => ({ memory: [card, ...s.memory] }));
  return true;
}
export function removeMemory(id: string) {
  setState(s => ({ memory: s.memory.filter(m => m.id !== id) }));
}
/** 연습 결과: ok=외웠어요 → 단계 올림, 아니면 처음부터 */
export function rateMemory(id: string, ok: boolean) {
  setState(s => ({
    memory: s.memory.map(m => {
      if (m.id !== id) return m;
      const level = ok ? Math.min(5, m.level + 1) : 0;
      const start = new Date(); start.setHours(4, 0, 0, 0);
      return { ...m, level, reviews: m.reviews + 1, due: ok ? start.getTime() + MEM_GAPS[level] * DAY : Date.now() };
    }),
  }));
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
  const { bookmarks, memory, highlights, settings, pages } = state;
  return JSON.stringify({ app: 'sk-bible', version: 1, exportedAt: new Date().toISOString(), bookmarks, memory, highlights, settings, pages }, null, 1);
}

export function importBackup(json: string, mode: 'merge' | 'replace') {
  const d = JSON.parse(json);
  if (d.app !== 'sk-bible' && d.app !== 'our-bible') throw new Error('SK-성경 백업 파일이 아닙니다');
  setState(s => {
    if (mode === 'replace') {
      return {
        bookmarks: d.bookmarks || [], memory: d.memory || [], highlights: d.highlights || {},
        settings: { ...DEFAULT_SETTINGS, ...(d.settings || {}) },
        pages: d.pages ? DEFAULT_PAGES.map((p, i) => ({ ...p, ...(d.pages[i] || {}) })) : s.pages,
      };
    }
    const ids = new Set(s.bookmarks.map(b => b.book + ':' + b.chapter + ':' + b.verses.join()));
    const add = (d.bookmarks || []).filter((b: Bookmark) => !ids.has(b.book + ':' + b.chapter + ':' + b.verses.join()));
    const mids = new Set(s.memory.map(m => m.book + ':' + m.chapter + ':' + m.verses.join()));
    const madd = (d.memory || []).filter((m: MemCard) => !mids.has(m.book + ':' + m.chapter + ':' + m.verses.join()));
    return {
      memory: [...s.memory, ...madd],
      bookmarks: [...s.bookmarks, ...add].sort((a, b) => b.createdAt - a.createdAt),
      highlights: { ...(d.highlights || {}), ...s.highlights },
    };
  });
}
