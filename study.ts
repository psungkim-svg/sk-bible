/* ================================================================
   말씀 공부 도구
   - 구절 AI 해설 · 낱말 풀이 · 인물/지명 · 장 배경 (AI, 인터넷 필요 · 한 번 본 것은 폰에 저장)
   - 관련 구절(관주): OpenBible.info 교차참조 (CC BY) · 처음 한 번 받으면 인터넷 없이
   ================================================================ */
import type { BibleData } from './bible';
import { BOOKS } from './books';
import { getHeads } from './headings';

/* ---------- 폰에 저장하는 AI 결과 → aicache.ts (v1.8: IndexedDB) ---------- */
export { cacheGet, cacheSet } from './aicache';
// v1.9: 근거 있는 해설(주석 원문 문장 + 번역)로 바뀌어 저장 이름도 새로
export const NS = { find: 'sk-ai-find-v2', chap: 'sk-ai-chap-v3', verse: 'sk-ai-verse-v6', lex: 'sk-ai-lex-v1', bg: 'sk-ai-bg-v3', term: 'sk-ai-term-v1', para: 'sk-ai-para-v1' };

/** 이 폰의 이름표 (아무 정보 없는 무작위 글자 — 하루 사용 횟수를 폰마다 세는 데만 씀) */
export function deviceId() {
  try {
    let id = localStorage.getItem('sk-dev');
    if (!id) { id = Math.random().toString(36).slice(2, 12) + Date.now().toString(36); localStorage.setItem('sk-dev', id); }
    return id;
  } catch { return ''; }
}

export async function ask<T>(body: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
  if (!navigator.onLine) throw new Error('인터넷에 연결되어 있지 않습니다');
  const res = await fetch('/api/ask', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-sk-app': '1', 'x-sk-dev': deviceId() },
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
   v1.8: 겹치지 않는 3가지 시각만 (적게, 대신 더 길게 읽음)
   - 칼빈 (개혁주의 신학 주석) — 칼빈 주석이 없는 책(사사기~욥기, 잠언·전도서·아가, 요한2·3서, 계시록)은 매튜 헨리로
   - 틴데일 스터디 노트 (현대 복음주의 학계 · 배경과 구조) — CC BY-SA 4.0
   - 원문 주해: 구약 카일·델리취 (히브리어 문법·문맥) / 신약 JFB (간결한 비평 주해)
   서버(Worker)는 CPU 시간이 짧아서, 큰 주석 파일은 폰에서 받아 필요한 부분만 잘라 보냅니다. */
export const USFM = ['GEN','EXO','LEV','NUM','DEU','JOS','JDG','RUT','1SA','2SA','1KI','2KI','1CH','2CH','EZR','NEH','EST','JOB','PSA','PRO','ECC','SNG','ISA','JER','LAM','EZK','DAN','HOS','JOL','AMO','OBA','JON','MIC','NAM','HAB','ZEP','HAG','ZEC','MAL',
  'MAT','MRK','LUK','JHN','ACT','ROM','1CO','2CO','GAL','EPH','PHP','COL','1TH','2TH','1TI','2TI','TIT','PHM','HEB','JAS','1PE','2PE','1JN','2JN','3JN','JUD','REV'];
export interface Comm { id: string; name: string; max: number; ot?: boolean; nt?: boolean; fb?: { id: string; name: string } }
export const COMMENTARIES: Comm[] = [
  { id: 'john-calvin', name: '칼빈 주석', max: 3200, fb: { id: 'matthew-henry', name: '매튜 헨리 주석' } },
  { id: 'tyndale', name: '틴데일 스터디 노트', max: 2600 },
  { id: 'keil-delitzsch', name: '카일·델리취 주석', max: 3200, ot: true },
  { id: 'jamieson-fausset-brown', name: 'JFB 주석', max: 3000, nt: true },
];
export const COMMENTARY_CREDIT = '주석 자료: 칼빈 · 매튜 헨리(칼빈 주석이 없는 책) · 카일·델리취 · JFB (공개 저작물), 틴데일 스터디 노트 (CC BY-SA 4.0) — HelloAO Free Use Bible API 제공. AI는 원문 문장을 고르고 번역만 하며, 고른 문장이 원문에 있는지 서버가 확인합니다.';
/** 이 책에서 읽을 주석 3가지 (인터넷이 없으면 없음) */
export function commList(book: number): Comm[] {
  return navigator.onLine ? COMMENTARIES.filter(c => (!c.ot || book < 39) && (!c.nt || book >= 39)) : [];
}

export interface Source { who: string; text: string }
export interface CItem { type?: string; number?: number; content?: unknown[] }
const chapCache = new Map<string, Promise<CItem[] | null>>();

export function fetchChapter(id: string, book: number, chapter: number): Promise<CItem[] | null> {
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

export function itemText(it: CItem) {
  return (it.content || []).map(x => (typeof x === 'string' ? x : (x as { text?: string })?.text || '')).join('\n');
}

/** 주석 하나를 받아 필요한 부분만 (없으면 대신할 주석으로) */
async function fetchComm(c: Comm, book: number, chapter: number, pick: (items: CItem[]) => string, min = 40): Promise<Source | null> {
  for (const s of c.fb ? [c, c.fb] : [c]) {
    const items = await fetchChapter(s.id, book, chapter).catch(() => null);
    const text = items ? pick(items) : '';
    if (text.length > min) return { who: s.name, text };
  }
  return null;
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
  const res = await Promise.all(commList(book).map(c => fetchComm(c, book, chapter, items => excerpt(items, chapter, v, c.max))));
  return res.filter((x): x is Source => !!x);
}

/* ================================================================
   v1.9 근거 있는 해설
   AI는 주석 원문에서 중요한 문장을 "그대로" 고르고 한국어로 번역만 합니다.
   고른 문장이 원문에 정말 있는지 서버가 확인하고, 없으면 버립니다 (지어낸 말이 나올 수 없게).
   화면에는 한국어 번역만 보이고, 문장마다 "원문"을 누르면 영어가 펼쳐집니다.
   ================================================================ */
export interface Pt { en: string; ko: string }
export interface CommPts { who: string; pts: Pt[] }
export interface GQa { q: string; who: string; pts: Pt[] }
export interface GView { who: string; en: string; ko: string }
export interface GDebate { issue: string; views: GView[] }
export interface GAsk { q: string; quotes: GView[] }
export interface VerseAi {
  comm: CommPts[];          // 📚 주석가들은 이렇게 봅니다
  qa: GQa[];                // ❓ 궁금증 풀이 (주석이 실제로 답하는 것만)
  debates: GDebate[];       // ⚖️ 해석이 갈리는 곳 (주석끼리 다를 때만)
  asks?: GAsk[];            // 💬 내가 물어본 것
  sourceCount?: number;
  partial?: boolean;
}
type St = 'wait' | 'done' | 'fail';
export interface DeepProgress {
  ai: VerseAi;
  collecting: boolean;
  qa: St;
  comm: { who: string; state: St | 'none' }[];
}
const AI_SLOTS = 4;
function makePool(size: number) {
  let busy = 0;
  const q: { pri: number; run: () => void }[] = [];
  const next = () => {
    while (busy < size && q.length) {
      q.sort((a, b) => a.pri - b.pri);
      const job = q.shift()!;
      busy++;
      job.run();
    }
  };
  return function add<T>(pri: number, fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((res, rej) => {
      q.push({ pri, run: () => { fn().then(res, rej).finally(() => { busy--; next(); }); } });
      next();
    });
  };
}

function verseText(data: BibleData, book: number, chapter: number, verses: number[]) {
  const ch = data[book][chapter - 1];
  return verses.map(x => `${x} ${ch[x - 1]}`).join('\n');
}

/** 주석 하나에서 문장 고르기 + 번역 */
function extract(who: string, source: string, q: string, focus: string, n: string, max: number, ck: string, signal: AbortSignal) {
  return ask<{ who: string; items: Pt[] }>({ step: 'extract', q, who, source, focus, n, max, ck }, signal);
}

/** 깊은 해설을 받는 공통 순서: 주석 모으기 → 주석마다 문장 고르기(동시에) + 궁금증 풀이 */
async function runGrounded(
  kind: 'v' | 'c', book: number, chapter: number, label: string, text: string, ckBase: string,
  pick: (c: Comm) => (items: CItem[]) => string, min: number,
  focus: string, n: string, max: number, qn: string, qClip: number,
  signal: AbortSignal, onUpdate: (p: DeepProgress) => void,
): Promise<VerseAi> {
  const list = commList(book);
  if (!list.length) throw new Error('주석 자료는 인터넷이 있어야 받을 수 있습니다');
  const ai: VerseAi = { comm: [], qa: [], debates: [] };
  const got: (CommPts | null)[] = list.map(() => null);
  const p: DeepProgress = { ai, collecting: true, qa: 'wait', comm: list.map(c => ({ who: c.name, state: 'wait' })) };
  const emit = () => {
    if (signal.aborted) return;
    ai.comm = got.filter((x): x is CommPts => !!x && x.pts.length > 0);
    onUpdate({ ...p, ai: { ...ai }, comm: p.comm.map(c => ({ ...c })) });
  };
  const pool = makePool(AI_SLOTS);
  let lastErr = '';
  emit();
  const srcPs = list.map(async (c, i) => {
    const s = await fetchComm(c, book, chapter, pick(c), min);
    if (s) { p.comm[i].who = s.who; emit(); }
    return s;
  });
  const commP = Promise.all(list.map(async (_c, i) => {
    const src = await srcPs[i];
    if (!src) { p.comm[i].state = 'none'; emit(); return; }
    try {
      const r = await pool(1 + i, () => extract(src.who, src.text, label, focus, n, max, `${kind}|${ckBase}|${src.who}`, signal));
      got[i] = { who: src.who, pts: r.items || [] };
      p.comm[i].state = r.items?.length ? 'done' : 'none';
    } catch (e) { p.comm[i].state = 'fail'; lastErr = (e as Error).message; }
    emit();
  }));
  let count = 0;
  const qaP = Promise.all(srcPs).then(ss => {
    const sources = ss.filter((x): x is Source => !!x).map(x => ({ who: x.who, text: x.text.slice(0, qClip) }));
    count = sources.length;
    p.collecting = false; emit();
    if (!sources.length) return { qa: [], debates: [] };
    return pool(0, () => ask<{ qa: GQa[]; debates: GDebate[] }>({ step: 'gqa', q: label, text, n: qn, sources, ck: `${kind}|${ckBase}` }, signal));
  }).then(r => { ai.qa = r.qa || []; ai.debates = r.debates || []; p.qa = 'done'; emit(); })
    .catch(e => { p.qa = 'fail'; lastErr = (e as Error).message; emit(); });

  await Promise.all([commP, qaP]);
  if (signal.aborted) throw new Error('취소됨');
  ai.comm = got.filter((x): x is CommPts => !!x && x.pts.length > 0);
  const anyFail = p.qa === 'fail' || p.comm.some(c => c.state === 'fail');
  if (!ai.comm.length && !ai.qa.length && anyFail) throw new Error(lastErr || '해설을 받지 못했습니다. 잠시 뒤 다시 시도해 주세요');
  if (!count) throw new Error('주석 자료를 받지 못했습니다. 인터넷 연결을 확인하고 다시 시도해 주세요');
  return { ...ai, sourceCount: count, partial: anyFail };
}

/** 💡 구절 깊은 해설 */
export function runDeepVerse(data: BibleData, book: number, chapter: number, verses: number[], signal: AbortSignal, onUpdate: (p: DeepProgress) => void): Promise<VerseAi> {
  const v = [...verses].sort((a, b) => a - b);
  const label = passageLabel(book, chapter, v);
  return runGrounded('v', book, chapter, label, verseText(data, book, chapter, v), `${book}.${chapter}.${v.join(',')}`,
    c => items => excerpt(items, chapter, v, c.max), 40,
    `${label} — 이 구절의 뜻과 그렇게 읽는 근거`, '2~4', 5, '2~3', 3000, signal, onUpdate);
}

/** 💬 이 구절에 대해 묻기 — 주석 원문에서 답이 되는 문장만 찾아 번역 */
export async function askGrounded(data: BibleData, book: number, chapter: number, verses: number[], question: string, signal?: AbortSignal) {
  const v = [...verses].sort((a, b) => a - b);
  const sources = (await getSources(book, chapter, v)).map(x => ({ who: x.who, text: x.text.slice(0, 3500) }));
  if (!sources.length) throw new Error('주석 자료를 받지 못했습니다. 인터넷 연결을 확인해 주세요');
  return ask<{ quotes: GView[] }>({ step: 'gask', q: question, ref: passageLabel(book, chapter, v), text: verseText(data, book, chapter, v), sources }, signal);
}

/* ---------- 📘 장 깊은 해설 ----------
   🧭 흐름(개역개정 소제목) · 📚 주석가별 · ❓ 어려운 곳(주석이 답하는 것) · ⚖️ 해석이 갈리는 곳 · 🌏 이어지는 구절(관주 자료) */
export type ChapAi = VerseAi;
export type ChapProgress = DeepProgress;

/** 주석 한 장 전체에서 고르게 뽑아 max 글자 안으로 (칼빈의 라틴어 본문 등은 뺌) */
const LATIN = /\b(est|et|qui|quae|quod|non|sed|enim|nos|nobis|ut|per|autem|sunt|cum|ad|Dei|Christi|in|Deus|esse|nisi|vel|atque)\b/g;
function isLatin(p: string) { const w = p.split(/\s+/).length; return w > 8 && (p.match(LATIN)?.length || 0) / w > 0.18; }
export function chapterExcerpt(items: CItem[], max: number): string {
  const its = items.filter(i => typeof i.number === 'number').sort((a, b) => a.number! - b.number!);
  const texts = its.map(it => itemText(it).replace(/\[\d+\]/g, '').replace(/[ \t]+/g, ' ')
    .split(/\n\s*\n/).map(p => p.trim())
    .filter(p => p.length > 30 && !isLatin(p) && !(/^\d+\.\s/.test(p) && p.length < 350) && !/^[A-Z][a-z]+ \d+:\d+(-\d+)?$/.test(p))
    .join('\n'));
  const all = texts.map((t, i) => ({ n: its[i].number!, t })).filter(x => x.t.length > 30);
  if (!all.length) return '';
  const total = all.reduce((n, x) => n + x.t.length, 0);
  if (total <= max) return all.map(x => `(${x.n}절~) ${x.t}`).join('\n\n');
  const k = Math.max(1, Math.min(all.length, Math.floor(max / 350)));
  const pick = Array.from({ length: k }, (_, i) => all[Math.floor(i * all.length / k)]);
  const per = Math.floor(max / k);
  return pick.map(x => {
    let t = x.t.slice(0, per);
    const cut = Math.max(t.lastIndexOf('. '), t.lastIndexOf('; '));
    if (x.t.length > per && cut > per * 0.5) t = t.slice(0, cut + 1);
    return `(${x.n}절~) ${t}${x.t.length > t.length ? ' …' : ''}`;
  }).join('\n\n');
}

export function runDeepChapter(data: BibleData, book: number, chapter: number, signal: AbortSignal, onUpdate: (p: ChapProgress) => void): Promise<ChapAi> {
  const ch = data[book][chapter - 1];
  const label = `${short(book)} ${chapter}${book === 18 ? '편' : '장'}`;
  const heads = getHeads(book, chapter).map(h => `${h.v}절 ${h.title}`).join(' / ');
  const text = `(소제목: ${heads || '없음'})\n` + ch.map((t, i) => `${i + 1} ${t.slice(0, 90)}`).join('\n').slice(0, 4000);
  return runGrounded('c', book, chapter, label, text, `${book}.${chapter}`,
    () => items => chapterExcerpt(items, 6500), 80,
    `${label} 전체 — 이 장의 핵심 주제와 구조, 특히 중요한 절과 그 해석`, '3~5', 6, '3~4', 2600, signal, onUpdate);
}

/** 이 장 전체의 관주(관련 구절)를 모아, 많이 이어지는 구절부터 (다른 책 · 다른 장만) */
export async function chapterLinks(book: number, chapter: number, count: number, max = 8): Promise<(XRef & { from: number })[]> {
  const d = await loadXref();
  const tally = new Map<string, { x: XRef; from: number; n: number }>();
  for (let v = 1; v <= count; v++) {
    const s = d[`${book}.${chapter}.${v}`];
    if (!s) continue;
    s.split(' ').forEach((r, rank) => {
      const x = parseX(r);
      if (x.book === book && x.chapter === chapter) return;
      const k = `${x.book}.${x.chapter}.${x.verse}`;
      const t = tally.get(k);
      const w = rank < 3 ? 2 : 1;
      if (t) t.n += w; else tally.set(k, { x, from: v, n: w });
    });
  }
  return [...tally.values()].sort((a, b) => b.n - a.n).slice(0, max)
    .sort((a, b) => a.x.book - b.x.book || a.x.chapter - b.x.chapter || a.x.verse - b.x.verse)
    .map(t => ({ ...t.x, from: t.from }));
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

/* ---------- ② 배경 보기: 틴데일 스터디 노트의 "책 소개"에서 고른 문장 + 번역 (책마다 한 번) ---------- */
export interface BgAi { pts: Pt[]; none?: boolean }
const introCache = new Map<number, Promise<string>>();
function bookIntro(book: number): Promise<string> {
  let p = introCache.get(book);
  if (!p) {
    p = fetch(`https://bible.helloao.org/api/c/tyndale/${USFM[book]}/1.json`)
      .then(r => (r.ok ? r.json() : null))
      .then(j => String(j?.book?.introduction || '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim())
      .catch(() => '');
    p.then(t => { if (!t) introCache.delete(book); });
    introCache.set(book, p);
  }
  return p;
}
export async function askBackground(book: number, signal?: AbortSignal): Promise<BgAi> {
  if (!navigator.onLine) throw new Error('인터넷에 연결되어 있지 않습니다');
  const intro = await bookIntro(book);
  if (!intro) return { pts: [], none: true };
  const r = await ask<{ items: Pt[] }>({
    step: 'extract', q: `${BOOKS[book].name} 배경`, who: '틴데일 스터디 노트 (책 소개)', source: intro.slice(0, 7000),
    focus: `${BOOKS[book].name}의 배경 — 기록된 시대와 상황, 장소, 저자와 받는 사람, 기록 목적, 핵심 주제`, n: '5~7', max: 7, ck: `b|${book}`,
  }, signal);
  return { pts: r.items || [] };
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
  return s.split(' ').map(parseX);
}
function parseX(r: string): XRef {
  const [a, z] = r.split('-');
  const [b, c, v] = a.split('.').map(Number);
  let ec = c, ev = v;
  if (z) { const p = z.split('.').map(Number); if (p.length === 2) { ec = p[0]; ev = p[1]; } else ev = p[0]; }
  return { book: b, chapter: c, verse: v, endChapter: ec, endVerse: ev };
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
