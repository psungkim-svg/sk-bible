/* ================================================================
   단락 소제목 + 장 주제
   - 단락 소제목: 개역개정 성경책에 있는 소제목 (kheads.json, 앱 안에 들어 있음)
     → 모든 장에서 바로, 인터넷 없이도 보입니다.
   - 장 주제: 장 맨 위 한 줄. 처음 여는 장은 AI가 만들어 폰에 저장합니다. (인터넷 필요)
   ================================================================ */
import { useSyncExternalStore } from 'react';
import type { BibleData } from './bible';
import { BOOKS } from './books';
import KH from './kheads.json';

export interface Head { v: number; title: string; refs?: string }

const OFFICIAL = KH as unknown as Record<string, Record<string, (number | string)[][]>>;

/** 이 장의 단락 소제목 (개역개정) */
export function getHeads(book: number, chapter: number): Head[] {
  const list = OFFICIAL[String(book)]?.[String(chapter)] ?? [];
  return list.map(h => ({ v: Number(h[0]), title: String(h[1]), refs: h[2] ? String(h[2]) : undefined }));
}

/* ---------------- 장 주제 (AI) ---------------- */
export type TopicStatus = 'ready' | 'loading' | 'fail' | 'none';
export interface TopicState { status: TopicStatus; topic?: string; error?: string }

const KEY = 'sk-topic-v1';
let cache: Record<string, string> = {};
try { cache = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { cache = {}; }
// 띄어쓰기 없이 붙어 버린 예전 장 주제는 버리고 새로 받기
const squashed = (t: string) => t.replace(/[^가-힣]/g, '').length > 12 && !/\s/.test(t);
for (const [k, v] of Object.entries(cache)) if (typeof v !== 'string' || squashed(v)) delete cache[k];
// 예전 버전(1.4.0)에서 만든 장 주제는 그대로 가져오기
try {
  const old = JSON.parse(localStorage.getItem('sk-heads-v1') || 'null') as Record<string, { topic?: string }> | null;
  if (old) {
    for (const [k, v] of Object.entries(old)) if (v?.topic && !cache[k]) cache[k] = v.topic;
    localStorage.removeItem('sk-heads-v1');
    localStorage.setItem(KEY, JSON.stringify(cache));
  }
} catch { /* 무시 */ }

const listeners = new Set<() => void>();
const status: Record<string, TopicState> = {};
const NONE: TopicState = { status: 'none' };

function emit() { listeners.forEach(l => l()); }
function setStatus(k: string, s: TopicState) { status[k] = s; emit(); }

/** 이 장의 주제가 없으면 AI에게 만들어 달라고 요청 (force: 실패 후 다시 시도) */
export async function ensureTopic(data: BibleData, book: number, chapter: number, force = false) {
  const k = `${book}:${chapter}`;
  if (cache[k]) return;
  const st = status[k]?.status;
  if (st === 'loading' || (st === 'fail' && !force)) return;
  if (!navigator.onLine) return;
  setStatus(k, { status: 'loading' });
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 60000);
  try {
    const verses = data[book]?.[chapter - 1] ?? [];
    const res = await fetch('/api/ask', {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'content-type': 'application/json', 'x-sk-app': '1' },
      body: JSON.stringify({
        step: 'topic',
        q: `${BOOKS[book].name} ${chapter}`,
        book: BOOKS[book].name,
        chapter,
        heads: getHeads(book, chapter).map(h => [h.v, h.title]),
        verses,
      }),
    });
    const j = await res.json().catch(() => null);
    if (!res.ok || !j || j.error || !j.topic) throw new Error(j?.error || `서버 응답 ${res.status}`);
    if (squashed(String(j.topic))) throw new Error('주제 띄어쓰기 오류 — 다시 시도해 주세요');
    cache[k] = String(j.topic).trim();
    try { localStorage.setItem(KEY, JSON.stringify(cache)); } catch { /* 저장 공간 부족 */ }
    setStatus(k, { status: 'ready', topic: cache[k] });
  } catch (e) {
    const msg = e instanceof Error ? (e.name === 'AbortError' ? '시간 초과' : e.message) : String(e);
    setStatus(k, { status: 'fail', error: msg });
  } finally {
    clearTimeout(timer);
  }
}

export function useTopic(book: number, chapter: number): TopicState {
  const k = `${book}:${chapter}`;
  return useSyncExternalStore(
    cb => { listeners.add(cb); return () => listeners.delete(cb); },
    () => (cache[k] ? (status[k]?.status === 'ready' ? status[k] : (status[k] = { status: 'ready', topic: cache[k] })) : status[k] ?? NONE),
  );
}

export function topicCount() { return Object.keys(cache).length; }
export function clearAllTopics() {
  cache = {};
  for (const k of Object.keys(status)) delete status[k];
  try { localStorage.setItem(KEY, '{}'); } catch { /* 무시 */ }
  emit();
}
