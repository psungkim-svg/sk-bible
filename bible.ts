import { BOOKS, findBook } from './books';

/** data[book][chapter][verse] = 본문 (모두 0부터 시작) */
export type BibleData = string[][][];

let cache: BibleData | null = null;

export async function loadBible(): Promise<BibleData> {
  if (cache) return cache;
  const res = await fetch('/data/nkrv.json');
  if (!res.ok) throw new Error('성경 데이터를 불러오지 못했습니다');
  cache = (await res.json()) as BibleData;
  return cache;
}

export function chapterCount(data: BibleData, book: number) {
  return data[book]?.length ?? 0;
}

export interface Ref {
  book: number;     // 0..65
  chapter: number;  // 1부터
  verse?: number;   // 1부터
  verseEnd?: number;
}

/**
 * "요3:16", "요 3 16", "요한복음 3장 16절", "시23", "창세기", "1요 1:9", "요3:16-18"
 */
export function parseRef(input: string, data?: BibleData): Ref | null {
  const s = input.trim().replace(/[.．]/g, ':');
  if (!s) return null;
  const m = s.match(/^([123]?\s*[가-힣]+)\s*(?:(\d+)\s*(?:장|편)?\s*(?:[:\s]\s*(\d+)\s*(?:절)?\s*(?:[-~]\s*(\d+)\s*(?:절)?)?)?)?$/);
  if (!m) return null;
  const book = findBook(m[1]);
  if (book < 0) return null;
  let chapter = m[2] ? parseInt(m[2], 10) : 1;
  let verse = m[3] ? parseInt(m[3], 10) : undefined;
  let verseEnd = m[4] ? parseInt(m[4], 10) : undefined;
  if (data) {
    const cc = data[book].length;
    if (chapter < 1 || chapter > cc) return null;
    const vc = data[book][chapter - 1].length;
    if (verse !== undefined) verse = Math.min(Math.max(1, verse), vc);
    if (verseEnd !== undefined) verseEnd = Math.min(Math.max(verse ?? 1, verseEnd), vc);
  }
  return { book, chapter, verse, verseEnd };
}

/** [16,17,18,20] → "16-18, 20" */
export function verseRanges(verses: number[]): string {
  const v = [...new Set(verses)].sort((a, b) => a - b);
  const parts: string[] = [];
  let start = v[0], prev = v[0];
  for (let i = 1; i <= v.length; i++) {
    const cur = v[i];
    if (cur === prev + 1) { prev = cur; continue; }
    parts.push(start === prev ? `${start}` : `${start}-${prev}`);
    start = prev = cur;
  }
  return parts.join(', ');
}

export function refLabel(book: number, chapter: number, verses?: number[], short = false) {
  const name = short ? BOOKS[book].abbr : BOOKS[book].name;
  if (!verses || verses.length === 0) return `${name} ${chapter}${book === 18 ? '편' : '장'}`;
  return `${name} ${chapter}:${verseRanges(verses)}`;
}

export interface CopyOptions {
  bookStyle: 'full' | 'short';
  refPosition: 'top' | 'bottom';
  verseNumbers: 'auto' | 'always' | 'never';
}

export function buildCopyText(data: BibleData, book: number, chapter: number, verses: number[], opt: CopyOptions) {
  const v = [...new Set(verses)].sort((a, b) => a - b);
  const label = refLabel(book, chapter, v, opt.bookStyle === 'short');
  const showNum = opt.verseNumbers === 'always' || (opt.verseNumbers === 'auto' && v.length > 1);
  const body = v.map(n => {
    const t = data[book][chapter - 1][n - 1] ?? '';
    return showNum ? `${n} ${t}` : t;
  }).join('\n');
  return opt.refPosition === 'top' ? `(${label})\n${body}` : `${body}\n(${label})`;
}

export interface SearchHit { book: number; chapter: number; verse: number; text: string; }
export type SearchScope = 'all' | 'OT' | 'NT' | number; // number = 특정 책

export function searchWords(data: BibleData, query: string, scope: SearchScope): SearchHit[] {
  const terms = query.trim().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [];
  const hits: SearchHit[] = [];
  for (let b = 0; b < data.length; b++) {
    if (scope === 'OT' && b > 38) break;
    if (scope === 'NT' && b < 39) continue;
    if (typeof scope === 'number' && b !== scope) continue;
    const book = data[b];
    for (let c = 0; c < book.length; c++) {
      const ch = book[c];
      for (let v = 0; v < ch.length; v++) {
        const t = ch[v];
        let ok = true;
        for (const term of terms) { if (!t.includes(term)) { ok = false; break; } }
        if (ok) hits.push({ book: b, chapter: c + 1, verse: v + 1, text: t });
      }
    }
  }
  return hits;
}
