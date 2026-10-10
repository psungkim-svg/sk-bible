/* ================================================================
   AI로 문장 찾기 (인터넷 필요)
   1) 폰 안의 검색으로 비슷한 구절 후보를 뽑고
   2) AI가 질문(음성 입력 오타 포함)을 이해해 구절을 고르고
   3) 실제 개역개정 본문을 확인한 뒤 설명을 씁니다.
   AI는 Cloudflare Workers AI (worker.js) 를 사용합니다.
   ================================================================ */
import { BibleData, parseRef, refLabel } from './bible';
import { searchSentence } from './sentenceSearch';

export interface AiVerse { book: number; chapter: number; verse: number; text: string; }
export interface AiAnswer {
  corrected: string;
  intro: string;
  interpretation: string;
  matches: AiVerse[];
  points: { title: string; body: string }[];
}

async function call(step: 'find' | 'explain', payload: object, signal?: AbortSignal) {
  const res = await fetch('/api/ask', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-sk-app': '1' },
    body: JSON.stringify({ step, ...payload }),
    signal,
  });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body || body.error) throw new Error(body?.error || `서버 오류 (${res.status})`);
  return body;
}

/** "겔 14:14", "에스겔 14장 14절", "겔 14:14-20" → 절 목록 */
function refToVerses(data: BibleData, ref: string, max = 6): AiVerse[] {
  const r = parseRef(String(ref).replace(/[()「」"'“”]/g, '').trim(), data);
  if (!r) return [];
  const first = r.verse ?? 1;
  const last = Math.min(r.verseEnd ?? first, first + max - 1);
  const out: AiVerse[] = [];
  for (let v = first; v <= last; v++) {
    const text = data[r.book]?.[r.chapter - 1]?.[v - 1];
    if (text) out.push({ book: r.book, chapter: r.chapter, verse: v, text });
  }
  return out;
}

const key = (v: AiVerse) => `${v.book}:${v.chapter}:${v.verse}`;
const label = (v: AiVerse) => refLabel(v.book, v.chapter, [v.verse]);

export async function askAi(data: BibleData, q: string, onStage: (s: string) => void, signal?: AbortSignal): Promise<AiAnswer> {
  onStage('질문을 이해하는 중…');
  const local = searchSentence(data, q, 'all', 8);
  const found = await call('find', {
    q,
    candidates: local.map(h => ({ ref: label(h), text: h.text })),
  }, signal);

  onStage('성경 본문을 확인하는 중…');
  const corrected: string = typeof found.corrected === 'string' && found.corrected.trim() ? found.corrected.trim() : q;
  const pool: AiVerse[] = [];
  const seen = new Set<string>();
  const add = (v: AiVerse) => { if (!seen.has(key(v)) && pool.length < 14) { seen.add(key(v)); pool.push(v); } };
  for (const r of (Array.isArray(found.refs) ? found.refs : []).slice(0, 6)) refToVerses(data, r).forEach(add);
  if (corrected !== q) searchSentence(data, corrected, 'all', 4).forEach(add);
  local.slice(0, 4).forEach(add);

  onStage('설명을 쓰는 중…');
  const ans = await call('explain', {
    q, corrected,
    verses: pool.map(v => ({ ref: label(v), text: v.text })),
  }, signal);

  const matches: AiVerse[] = [];
  const mseen = new Set<string>();
  for (const r of (Array.isArray(ans.matches) ? ans.matches : []).slice(0, 5)) {
    for (const v of refToVerses(data, r, 3)) if (!mseen.has(key(v))) { mseen.add(key(v)); matches.push(v); }
  }
  return {
    corrected,
    intro: String(ans.intro ?? ''),
    interpretation: String(ans.interpretation ?? ''),
    matches,
    points: (Array.isArray(ans.points) ? ans.points : [])
      .filter((p: { title?: string; body?: string }) => p && (p.title || p.body))
      .slice(0, 4)
      .map((p: { title?: string; body?: string }) => ({ title: String(p.title ?? ''), body: String(p.body ?? '') })),
  };
}
