/* ================================================================
   장 주제 + 단락 소제목
   - 처음 여는 장은 AI(Cloudflare Workers AI)가 개역개정 본문을 읽고 만들어 줍니다.
     (영어 BSB 성경의 소제목을 참고 · BSB는 퍼블릭 도메인)
   - 한 번 만든 것은 폰에 저장되어 인터넷 없이도 보입니다.
   ================================================================ */
import { useSyncExternalStore } from 'react';
import type { BibleData } from './bible';
import { BOOKS } from './books';

export interface ChapterHeads { topic: string; heads: [number, string][]; }

const KEY = 'sk-heads-v1';
let cache: Record<string, ChapterHeads> = {};
try { cache = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { cache = {}; }

const listeners = new Set<() => void>();
const inflight = new Set<string>();
const failedAt: Record<string, number> = {};
let bsb: Record<string, Record<string, [number, string][]>> | null = null;
let bsbLoading: Promise<void> | null = null;

function save() {
  try { localStorage.setItem(KEY, JSON.stringify(cache)); } catch { /* 저장 공간 부족 */ }
  listeners.forEach(l => l());
}

async function loadBsb() {
  if (bsb) return;
  if (!bsbLoading) {
    bsbLoading = fetch('/data/bsb-headings.json')
      .then(r => (r.ok ? r.json() : {}))
      .then(j => { bsb = j; })
      .catch(() => { bsb = {}; });
  }
  await bsbLoading;
}

/** 이 장의 소제목을 (없으면) 만들어 달라고 요청 */
export async function ensureHeads(data: BibleData, book: number, chapter: number) {
  const k = `${book}:${chapter}`;
  if (cache[k] || inflight.has(k) || !navigator.onLine) return;
  if (failedAt[k] && Date.now() - failedAt[k] < 10 * 60 * 1000) return;
  inflight.add(k);
  try {
    await loadBsb();
    const verses = data[book]?.[chapter - 1] ?? [];
    const res = await fetch('/api/ask', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-sk-app': '1' },
      body: JSON.stringify({
        step: 'headings',
        q: `${BOOKS[book].name} ${chapter}`,
        book: BOOKS[book].name,
        chapter,
        hints: bsb?.[String(book)]?.[String(chapter)] ?? [],
        verses,
      }),
    });
    const j = await res.json().catch(() => null);
    if (!res.ok || !j || j.error) throw new Error(j?.error || 'fail');
    const max = verses.length;
    const heads: [number, string][] = (Array.isArray(j.heads) ? j.heads : [])
      .map((h: unknown) => (Array.isArray(h) ? [Number(h[0]), String(h[1] ?? '').trim()] : [0, '']) as [number, string])
      .filter(([v, t]: [number, string]) => v >= 1 && v <= max && t)
      .sort((a: [number, string], b: [number, string]) => a[0] - b[0]);
    const uniq: [number, string][] = [];
    for (const h of heads) if (!uniq.some(u => u[0] === h[0])) uniq.push(h);
    cache[k] = { topic: String(j.topic ?? '').trim(), heads: uniq };
    save();
  } catch {
    failedAt[k] = Date.now();
  } finally {
    inflight.delete(k);
  }
}

export function useHeads(book: number, chapter: number): ChapterHeads | undefined {
  return useSyncExternalStore(
    cb => { listeners.add(cb); return () => listeners.delete(cb); },
    () => cache[`${book}:${chapter}`],
  );
}

/** 마음에 들지 않으면 지우고 다시 만들기 */
export function resetHeads(book: number, chapter: number) {
  delete cache[`${book}:${chapter}`];
  delete failedAt[`${book}:${chapter}`];
  save();
}

export function headsCount() { return Object.keys(cache).length; }
export function clearAllHeads() { cache = {}; save(); }
