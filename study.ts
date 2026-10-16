/* ================================================================
   말씀 공부 도구
   - 구절 AI 해설 · 낱말 풀이 · 인물/지명 · 장 배경 (AI, 인터넷 필요 · 한 번 본 것은 폰에 저장)
   - 관련 구절(관주): OpenBible.info 교차참조 (CC BY) · 처음 한 번 받으면 인터넷 없이
   ================================================================ */
import type { BibleData } from './bible';
import { BOOKS } from './books';
import { BOOK_INFO } from './bookinfo';
import { getTranslation, TRANSLATIONS } from './translations';

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
// v1.6: 깊은 해설로 바뀌어 예전 해설 저장분은 지움
try { ['sk-ai-verse-v1', 'sk-ai-verse-v2', 'sk-ai-verse-v3'].forEach(k => localStorage.removeItem(k)); } catch { /* 무시 */ }
export const NS = { verse: 'sk-ai-verse-v4', vextra: 'sk-ai-vextra-v1', lex: 'sk-ai-lex-v1', bg: 'sk-ai-bg-v1', term: 'sk-ai-term-v1' };

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

/* ---------- ① 구절 깊은 해설 (고전 주석 근거) ----------
   주석 자료: HelloAO Free Use Bible API (bible.helloao.org)
   - 칼빈 · 매튜 헨리 · 존 길 · JFB · 아담 클라크 · 카일·델리취: 공개 저작물
   - 틴데일 스터디 노트: CC BY-SA 4.0
   서버(Worker)는 CPU 시간이 짧아서, 큰 주석 파일은 폰에서 받아 필요한 부분만 잘라 보냅니다. */
export const USFM = ['GEN','EXO','LEV','NUM','DEU','JOS','JDG','RUT','1SA','2SA','1KI','2KI','1CH','2CH','EZR','NEH','EST','JOB','PSA','PRO','ECC','SNG','ISA','JER','LAM','EZK','DAN','HOS','JOL','AMO','OBA','JON','MIC','NAM','HAB','ZEP','HAG','ZEC','MAL',
  'MAT','MRK','LUK','JHN','ACT','ROM','1CO','2CO','GAL','EPH','PHP','COL','1TH','2TH','1TI','2TI','TIT','PHM','HEB','JAS','1PE','2PE','1JN','2JN','3JN','JUD','REV'];
export const COMMENTARIES: { id: string; name: string; max: number; ot?: boolean }[] = [
  { id: 'tyndale', name: '틴데일 스터디 노트', max: 1800 },
  { id: 'john-calvin', name: '칼빈 주석', max: 2200 },
  { id: 'matthew-henry', name: '매튜 헨리 주석', max: 2000 },
  { id: 'jamieson-fausset-brown', name: 'JFB 주석', max: 1700 },
  { id: 'john-gill', name: '존 길 주석', max: 1700 },
  { id: 'adam-clarke', name: '아담 클라크 주석', max: 1500 },
  { id: 'keil-delitzsch', name: '카일·델리취 주석', max: 2000, ot: true },
];
export const COMMENTARY_CREDIT = '주석 자료: 칼빈 · 매튜 헨리 · 존 길 · JFB · 아담 클라크 · 카일·델리취 (공개 저작물), 틴데일 스터디 노트 (CC BY-SA 4.0) — HelloAO Free Use Bible API 제공';

export interface Source { who: string; text: string }
interface CItem { type?: string; number?: number; content?: unknown[] }
const chapCache = new Map<string, Promise<CItem[] | null>>();

function fetchChapter(id: string, book: number, chapter: number): Promise<CItem[] | null> {
  const k = `${id}/${USFM[book]}/${chapter}`;
  let p = chapCache.get(k);
  if (!p) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 15000);
    p = fetch(`https://bible.helloao.org/api/c/${k}.json`, { signal: ctl.signal })
      .then(r => (r.ok ? r.json() : null))
      .then(j => (Array.isArray(j?.chapter?.content) ? j.chapter.content as CItem[] : null))
      .catch(() => null)
      .finally(() => clearTimeout(t));
    p.then(v => { if (!v) chapCache.delete(k); });
    chapCache.set(k, p);
  }
  return p;
}

function itemText(it: CItem) {
  return (it.content || []).map(x => (typeof x === 'string' ? x : (x as { text?: string })?.text || '')).join('\n');
}

/** 주석 한 장에서 고른 절에 해당하는 부분만 잘라 냄 */
export function excerpt(items: CItem[], chapter: number, verses: number[], max: number): string {
  const vs = items.filter(i => typeof i.number === 'number').sort((a, b) => a.number! - b.number!);
  if (!vs.length) return '';
  const a = verses[0], b = verses[verses.length - 1];
  // 이 절을 덮는 단락(시작 절 ≤ a 중 가장 뒤) + 범위 안에서 시작하는 단락
  let cover = -1;
  vs.forEach((it, i) => { if (it.number! <= a) cover = i; });
  const picked = vs.filter((it, i) => i === cover || (it.number! > a && it.number! <= b));
  let text = picked.map(itemText).join('\n\n')
    .replace(/\[\d+\]/g, '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  if (text.length <= max) return text;
  // 긴 단락이면 그 절을 다루는 곳을 찾아 그 주변만
  // ① "16. For God so loved…"처럼 절 번호로 시작하는 줄 — 본문 나열이 아닌 해설(다음 번호까지 가장 긴 것)
  const lines = [...text.matchAll(/(?:^|\n)\s*(\d{1,3})\.\s/g)].map(m => ({ n: +m[1], i: m.index! }));
  // (칼빈은 라틴어 본문 → 영어 본문 → 해설 순서라서, 충분히 긴 것 중 마지막을 고름)
  let best = -1, gap = 0, lastLong = -1;
  lines.forEach((l, k) => {
    if (l.n !== a) return;
    const g = (lines[k + 1]?.i ?? text.length) - l.i;
    if (g > gap) { gap = g; best = l.i; }
    if (g >= 400) lastLong = l.i;
  });
  if (lastLong >= 0) best = lastLong;
  let start = best;
  // 이 절에서 바로 시작하는 해설이면 앞부분 그대로
  if (start < 0 && cover >= 0 && vs[cover].number === a) start = 0;
  // ② "v. 16", "Joh 3:16" 같은 표시
  if (start < 0) {
    const m2 = new RegExp(`(?:\\bv\\.|\\bver\\.|\\bverse)\\s*${a}\\b|\\b${chapter}:${a}\\b`, 'i').exec(text);
    if (m2) start = Math.max(0, m2.index - 100);
  }
  // ③ 가장 가까운 앞 절 표시 (3절 이내) — 없으면 이 주석은 이 절을 다루지 않는 것으로 보고 뺌
  if (start < 0) {
    let near = -1, at = -1;
    for (const m of text.matchAll(new RegExp(`\\b${chapter}:(\\d+)\\b|\\bv(?:er)?\\.\\s*(\\d+)\\b`, 'g'))) {
      const n = +(m[1] || m[2]);
      if (n <= a && n >= near) { near = n; at = m.index!; }
    }
    if (near < 0 || a - near > 3) return '';
    start = Math.max(0, at - 100);
  }
  return (start > 0 ? '… ' : '') + text.slice(start, start + max).trim() + ' …';
}

/** 고른 절에 대한 고전 주석 발췌 (받을 수 있는 것만) */
export async function getSources(book: number, chapter: number, verses: number[]): Promise<Source[]> {
  if (!navigator.onLine) return [];
  const v = [...verses].sort((x, y) => x - y);
  const list = COMMENTARIES.filter(c => !c.ot || book < 39);
  const res = await Promise.all(list.map(async c => {
    const items = await fetchChapter(c.id, book, chapter);
    const text = items ? excerpt(items, chapter, v, c.max) : '';
    return text.length > 40 ? { who: c.name, text } : null;
  }));
  return res.filter((x): x is Source => !!x);
}

export interface VerseAi {
  summary: string;                                   // 핵심
  background?: string;                               // 꼭 필요한 구체적 배경
  commentators: { who: string; point: string }[];    // 주석가들은 이렇게 봅니다
  questions: { q: string; a: string }[];             // 궁금증 풀이
  debates: { issue: string; views: { view: string; who?: string; why?: string }[] }[]; // 해석이 갈리는 곳
  links: { ref: string; why: string }[];             // 성경 연결
  asks?: { q: string; a: string; refs?: string[] }[]; // 내가 더 물어본 것
  sourceCount?: number;
  partial?: boolean;                                 // 일부를 받지 못함 (다시 해설로 채움)
}

function verseInput(data: BibleData, book: number, chapter: number, verses: number[]) {
  const ch = data[book][chapter - 1];
  const v = [...verses].sort((a, b) => a - b);
  const from = Math.max(1, v[0] - 5), to = Math.min(ch.length, v[v.length - 1] + 4);
  const around: string[] = [];
  for (let i = from; i <= to; i++) around.push(`${i} ${ch[i - 1]}`);
  const bi = BOOK_INFO[book];
  const bookinfo = bi ? `${BOOKS[book].name} — 주제: ${bi.t}\n요약: ${bi.s}\n구조: ${bi.o.split('|').join(' / ')}` : '';
  return { q: passageLabel(book, chapter, v), text: v.map(x => `${x} ${ch[x - 1]}`).join('\n'), around: around.join('\n'), bookinfo };
}

export async function askVerse(data: BibleData, book: number, chapter: number, verses: number[], signal?: AbortSignal, onPhase?: (p: string) => void) {
  onPhase?.('주석 자료를 모으는 중…');
  const [sources, others] = await Promise.all([getSources(book, chapter, verses), otherTranslations(book, chapter, verses)]);
  if (signal?.aborted) throw new Error('취소됨');
  onPhase?.(sources.length ? `주석 ${sources.length}권을 읽고 해설을 쓰는 중… (30초~1분)` : '해설을 쓰는 중… (주석 자료를 받지 못해 AI 지식으로만)');
  const r = await ask<VerseAi>({ step: 'verse', ...verseInput(data, book, chapter, verses), sources, others }, signal);
  return { ...r, sourceCount: sources.length };
}

/* ---- v1.6.4: 깊은 해설을 나눠서 동시에 요청 → 먼저 끝난 부분부터 화면에 ---- */
export interface DeepProgress {
  ai: VerseAi;
  collecting: boolean;          // 주석 자료를 모으는 중
  core: 'wait' | 'done' | 'fail';
  qa: 'wait' | 'done' | 'fail';
  comm: { who: string; state: 'wait' | 'done' | 'fail' | 'none' }[];
}
export async function runDeepVerse(data: BibleData, book: number, chapter: number, verses: number[], signal: AbortSignal, onUpdate: (p: DeepProgress) => void): Promise<VerseAi> {
  const v = [...verses].sort((a, b) => a - b);
  const input = verseInput(data, book, chapter, v);
  const list = navigator.onLine ? COMMENTARIES.filter(c => !c.ot || book < 39) : [];
  const ai: VerseAi = { summary: '', background: '', commentators: [], questions: [], debates: [], links: [] };
  const points: Record<string, string> = {};
  const p: DeepProgress = { ai, collecting: list.length > 0, core: 'wait', qa: 'wait', comm: list.map(c => ({ who: c.name, state: 'wait' })) };
  const emit = () => {
    if (signal.aborted) return;
    ai.commentators = list.map(c => ({ who: c.name, point: points[c.name] || '' })).filter(c => c.point);
    onUpdate({ ...p, ai: { ...ai }, comm: p.comm.map(c => ({ ...c })) });
  };
  const setComm = (who: string, state: DeepProgress['comm'][number]['state']) => { const c = p.comm.find(x => x.who === who); if (c) c.state = state; };
  emit();
  const othersP = otherTranslations(book, chapter, v);

  // ① 요약 · 배경 · 성경 연결 (주석 없이 바로 시작)
  const coreP = ask<Pick<VerseAi, 'summary' | 'background' | 'links'>>({ step: 'verse-core', ...input }, signal)
    .then(r => { ai.summary = r.summary; ai.background = r.background; ai.links = r.links || []; p.core = 'done'; emit(); })
    .catch(() => { p.core = 'fail'; emit(); });

  // ② 주석마다 따로: 자료가 오는 대로 바로 요청
  const sources: Source[] = [];
  const srcPs = list.map(async c => {
    const items = await fetchChapter(c.id, book, chapter).catch(() => null);
    const text = items ? excerpt(items, chapter, v, c.max) : '';
    if (text.length > 40) sources.push({ who: c.name, text });
    return text.length > 40 ? text : '';
  });
  const commP = Promise.all(list.map(async (c, i) => {
    const text = await srcPs[i];
    if (!text) { setComm(c.name, 'none'); emit(); return; }
    try {
      const r = await ask<{ point: string }>({ step: 'verse-comm', ...input, who: c.name, source: text }, signal);
      if (r.point) { points[c.name] = r.point; setComm(c.name, 'done'); } else setComm(c.name, 'none');
    } catch { setComm(c.name, 'fail'); }
    emit();
  }));

  // ③ 궁금증 풀이 · 해석이 갈리는 곳 (주석 자료를 다 모은 뒤)
  const qaP = Promise.all([othersP, Promise.all(srcPs)])
    .then(([others]) => {
      p.collecting = false; emit();
      const ordered = list.map(c => sources.find(x => x.who === c.name)).filter((x): x is Source => !!x);
      return ask<Pick<VerseAi, 'questions' | 'debates'>>({ step: 'verse-qa', ...input, others, sources: ordered }, signal);
    })
    .then(r => { ai.questions = r.questions || []; ai.debates = r.debates || []; p.qa = 'done'; emit(); })
    .catch(() => { p.qa = 'fail'; emit(); });

  await Promise.all([coreP, commP, qaP]);
  if (signal.aborted) throw new Error('취소됨');
  ai.commentators = list.map(c => ({ who: c.name, point: points[c.name] || '' })).filter(c => c.point);
  if (p.core === 'fail' && p.qa === 'fail' && !ai.commentators.length) throw new Error('AI가 해설을 쓰지 못했습니다. 잠시 뒤 다시 시도해 주세요');
  return { ...ai, sourceCount: sources.length, partial: p.core === 'fail' || p.qa === 'fail' || p.comm.some(c => c.state === 'fail') };
}

/** 🧭 책 전체 흐름 + 🎓 현대 학자들의 견해 — 주석 해설과 따로 (주석 해설이 짧아지지 않게) */
export interface VerseExtra { bookflow: string; modern: { who: string; point: string }[] }
export function askVerseExtra(data: BibleData, book: number, chapter: number, verses: number[], signal?: AbortSignal) {
  return ask<VerseExtra>({ step: 'verse-extra', ...verseInput(data, book, chapter, verses) }, signal);
}

/** 새번역 · 쉬운성경 본문 (AI가 번역 차이를 참고하도록, 못 받으면 빈 문자열) */
async function otherTranslations(book: number, chapter: number, verses: number[]) {
  const v = [...verses].sort((a, b) => a - b);
  const timeout = new Promise<null>(r => setTimeout(() => r(null), 6000));
  const parts = await Promise.all(TRANSLATIONS.map(async t => {
    const r = await Promise.race([getTranslation(t.id, book, chapter, v).catch(() => null), timeout]);
    return r ? `[${t.name}] ` + v.map((x, i) => `${x} ${r[i]}`).join(' ') : '';
  }));
  return parts.filter(Boolean).join('\n');
}

/** 해설을 본 뒤 그 구절에 대해 더 묻기 */
export async function askVerseMore(data: BibleData, book: number, chapter: number, verses: number[], question: string, prev: VerseAi | undefined, signal?: AbortSignal) {
  const sources = await getSources(book, chapter, verses);
  const brief = prev ? [prev.summary, ...(prev.asks || []).slice(-3).map(x => `Q: ${x.q}\nA: ${x.a}`)].join('\n').slice(0, 2500) : '';
  return ask<{ answer: string; refs: string[] }>({ step: 'verse-ask', ...verseInput(data, book, chapter, verses), question, brief, sources }, signal);
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
