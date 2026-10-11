/* ================================================================
   말씀 공부 도구
   - 구절 AI 해설 · 낱말 풀이 · 인물/지명 · 장 배경 (AI, 인터넷 필요 · 한 번 본 것은 폰에 저장)
   - 관련 구절(관주): OpenBible.info 교차참조 (CC BY) · 처음 한 번 받으면 인터넷 없이
   ================================================================ */
import type { BibleData } from './bible';
import { BOOKS } from './books';

/* ---------- 폰에 저장하는 AI 결과 (종류별 개수 제한) ---------- */
function cacheLoad<T>(ns: string): Record<string, T> {
  try { return JSON.parse(localStorage.getItem(ns) || '{}'); } catch { return {}; }
}
export function cacheGet<T>(ns: string, k: string): T | undefined { return cacheLoad<T>(ns)[k]; }
export function cacheSet<T>(ns: string, k: string, v: T, max: number) {
  const c = cacheLoad<T>(ns);
  delete c[k];
  c[k] = v;
  const keys = Object.keys(c);
  if (keys.length > max) keys.slice(0, keys.length - max).forEach(x => delete c[x]);
  try { localStorage.setItem(ns, JSON.stringify(c)); } catch {
    // 저장 공간이 부족하면 오래된 절반을 지우고 다시
    keys.slice(0, Math.floor(keys.length / 2)).forEach(x => delete c[x]);
    try { localStorage.setItem(ns, JSON.stringify(c)); } catch { /* 포기 */ }
  }
}
export const NS = { verse: 'sk-ai-verse-v1', lex: 'sk-ai-lex-v1', bg: 'sk-ai-bg-v1', term: 'sk-ai-term-v1' };

async function ask<T>(body: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
  if (!navigator.onLine) throw new Error('인터넷에 연결되어 있지 않습니다');
  const res = await fetch('/api/ask', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-sk-app': '1' },
    signal,
    body: JSON.stringify(body),
  });
  const j = await res.json().catch(() => null);
  if (!res.ok || !j || j.error) throw new Error(j?.error || `서버 응답 ${res.status}`);
  return j as T;
}

const short = (b: number) => BOOKS[b].name;
export function passageLabel(book: number, chapter: number, verses: number[]) {
  const v = [...verses].sort((a, b) => a - b);
  const contiguous = v.every((x, i) => i === 0 || x === v[i - 1] + 1);
  const vs = v.length === 1 ? `${v[0]}` : contiguous ? `${v[0]}-${v[v.length - 1]}` : v.join(',');
  return `${short(book)} ${chapter}:${vs}`;
}

/* ---------- ① 구절 해설 ---------- */
export interface VerseAi {
  summary: string;          // 한 줄 핵심
  context: string;          // 앞뒤 문맥
  background: string;       // 당시 배경
  meaning: string;          // 뜻 풀이
  apply: string[];          // 오늘의 적용
  pray?: string;            // 한 줄 기도
}
export function askVerse(data: BibleData, book: number, chapter: number, verses: number[], signal?: AbortSignal) {
  const ch = data[book][chapter - 1];
  const v = [...verses].sort((a, b) => a - b);
  const from = Math.max(1, v[0] - 4), to = Math.min(ch.length, v[v.length - 1] + 3);
  const around: string[] = [];
  for (let i = from; i <= to; i++) around.push(`${i} ${ch[i - 1]}`);
  return ask<VerseAi>({
    step: 'verse', q: passageLabel(book, chapter, v),
    text: v.map(x => `${x} ${ch[x - 1]}`).join('\n'),
    around: around.join('\n'),
  }, signal);
}

/* ---------- ④ 낱말 풀이 + ⑤ 인물·지명 ---------- */
export interface LexAi {
  words: { w: string; mean: string; note?: string }[];
  names: { name: string; kind: string; desc: string; refs?: string[] }[];
}
export function askLex(data: BibleData, book: number, chapter: number, verses: number[], signal?: AbortSignal) {
  const ch = data[book][chapter - 1];
  const v = [...verses].sort((a, b) => a - b);
  return ask<LexAi>({ step: 'lexicon', q: passageLabel(book, chapter, v), text: v.map(x => `${x} ${ch[x - 1]}`).join('\n') }, signal);
}

export interface TermAi { title: string; kind: string; desc: string; refs?: string[] }
export function askTerm(term: string, where: string, signal?: AbortSignal) {
  return ask<TermAi>({ step: 'term', q: term, where }, signal);
}

/* ---------- ② 장 배경 카드 ---------- */
export interface BgAi {
  era: string;              // 시대
  place: string;            // 장소
  people: string;           // 등장인물
  flow: string;             // 앞 장과의 연결 / 흐름
  summary: string;          // 이 장 요약
  key: { v: number; why: string }[]; // 핵심 구절
}
export function askBackground(data: BibleData, book: number, chapter: number, heads: [number, string][], signal?: AbortSignal) {
  const ch = data[book][chapter - 1];
  const per = ch.length > 60 ? 45 : 110;
  const prev = chapter > 1 ? data[book][chapter - 2] : null;
  return ask<BgAi>({
    step: 'background', q: `${short(book)} ${chapter}`,
    book: short(book), chapter,
    heads,
    prev: prev ? `${chapter - 1}장 마지막: ${prev.slice(-3).join(' ').slice(0, 300)}` : '',
    text: ch.map((t, i) => `${i + 1} ${t.slice(0, per)}`).join('\n').slice(0, 8000),
  }, signal);
}

/* ---------- ③ 관련 구절 (관주) ---------- */
export interface XRef { book: number; chapter: number; verse: number; endChapter: number; endVerse: number }
let xref: Record<string, string> | null = null;
let xrefLoading: Promise<Record<string, string>> | null = null;
export const XREF_MB = 0.6;

export function xrefReady() { return !!xref; }
export function loadXref(): Promise<Record<string, string>> {
  if (xref) return Promise.resolve(xref);
  if (!xrefLoading) {
    xrefLoading = fetch('/data/xref.json')
      .then(r => { if (!r.ok) throw new Error('관련 구절 자료를 받지 못했습니다'); return r.json(); })
      .then(j => (xref = j))
      .catch(e => { xrefLoading = null; throw e; });
  }
  return xrefLoading;
}
export async function getXrefs(book: number, chapter: number, verse: number): Promise<XRef[]> {
  const d = await loadXref();
  const s = d[`${book}.${chapter}.${verse}`];
  if (!s) return [];
  return s.split(' ').map(r => {
    const [a, z] = r.split('-');
    const [b, c, v] = a.split('.').map(Number);
    let ec = c, ev = v;
    if (z) { const p = z.split('.').map(Number); if (p.length === 2) { ec = p[0]; ev = p[1]; } else ev = p[0]; }
    return { book: b, chapter: c, verse: v, endChapter: ec, endVerse: ev };
  });
}
export function xrefLabel(x: XRef) {
  const base = `${short(x.book)} ${x.chapter}:${x.verse}`;
  if (x.endChapter !== x.chapter) return `${base}-${x.endChapter}:${x.endVerse}`;
  return x.endVerse !== x.verse ? `${base}-${x.endVerse}` : base;
}
export function xrefText(data: BibleData, x: XRef) {
  if (x.endChapter !== x.chapter) return data[x.book][x.chapter - 1][x.verse - 1] + ' …';
  const out: string[] = [];
  for (let v = x.verse; v <= Math.min(x.endVerse, x.verse + 3); v++) out.push(data[x.book][x.chapter - 1][v - 1]);
  return out.join(' ') + (x.endVerse > x.verse + 3 ? ' …' : '');
}
