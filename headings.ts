/* ================================================================
   단락 소제목 + 장 주제
   - 단락 소제목: 개역개정 성경책에 있는 소제목 (kheads.json, 앱 안에 들어 있음)
     → 모든 장에서 바로, 인터넷 없이도 보입니다.
   - 장 주제 + 📝 단락 요약: 처음 여는 장은 AI가 만들어 폰에 저장합니다. (인터넷 필요)
   ================================================================ */
import { useSyncExternalStore } from 'react';
import type { BibleData } from './bible';
import { BOOKS } from './books';
import KH from './kheads.json';
import { cacheClearNs, cacheGet, cacheSet } from './aicache';

export interface Head { v: number; title: string; refs?: string }

const OFFICIAL = KH as unknown as Record<string, Record<string, (number | string)[][]>>;

/** 이 장의 단락 소제목 (개역개정) */
export function getHeads(book: number, chapter: number): Head[] {
  const list = OFFICIAL[String(book)]?.[String(chapter)] ?? [];
  return list.map(h => ({ v: Number(h[0]), title: String(h[1]), refs: h[2] ? String(h[2]) : undefined }));
}

/* ---------------- 장 주제 + 📝 단락 요약 (AI, 한 번에) ----------------
   v1.8: 장 주제를 만들 때 단락마다 3~4문장 요약도 같이 만들어 저장 (IndexedDB)
   예전(v1.7까지) 장 주제만 있는 장은 주제는 그대로 보여 주고, 단락 요약이 켜져 있으면 다시 받아 옵니다. */
export type TopicStatus = 'ready' | 'loading' | 'fail' | 'none';
export interface ParaSum { v: number; sum: string }
export interface TopicState { status: TopicStatus; topic?: string; paras?: ParaSum[]; error?: string; parasPending?: boolean; parasError?: string }
interface Entry { topic: string; paras?: ParaSum[] }

const NS2 = 'sk-topic-v3'; // v1.8.3: 단락 요약을 절반 길이로
const KEY = 'sk-topic-v1';
let v1: Record<string, string> = {};
try { v1 = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { v1 = {}; }
// 띄어쓰기 없이 붙어 버린 예전 장 주제는 버리고 새로 받기
const squashed = (t: string) => t.replace(/[^가-힣]/g, '').length > 12 && !/\s/.test(t);
for (const [k, v] of Object.entries(v1)) if (typeof v !== 'string' || squashed(v)) delete v1[k];

function entry(k: string): Entry | undefined {
  const e = cacheGet<Entry>(NS2, k);
  if (e?.topic) return e;
  return v1[k] ? { topic: v1[k] } : undefined;
}

const listeners = new Set<() => void>();
const fetching: Record<string, { s: 'loading' | 'fail'; error?: string; paras: boolean }> = {};
const snaps: Record<string, TopicState> = {};
const NONE: TopicState = { status: 'none' };

function emit(k: string) { delete snaps[k]; listeners.forEach(l => l()); }

function snapshot(k: string): TopicState {
  if (snaps[k]) return snaps[k];
  const e = entry(k), f = fetching[k];
  let st: TopicState;
  if (e) st = { status: 'ready', topic: e.topic, paras: e.paras, parasPending: f?.s === 'loading', parasError: f?.s === 'fail' ? f.error : undefined };
  else if (f) st = f.s === 'loading' ? { status: 'loading', parasPending: f.paras } : { status: 'fail', error: f.error, parasError: f.paras ? f.error : undefined };
  else st = NONE;
  return (snaps[k] = st);
}

/** 이 장의 주제(와 단락 요약)가 없으면 AI에게 요청 (force: 실패 후 다시 시도) */
export async function ensureTopic(data: BibleData, book: number, chapter: number, force = false, wantParas = false) {
  const k = `${book}:${chapter}`;
  const e = entry(k);
  if (e && (!wantParas || e.paras)) return;
  const st = fetching[k]?.s;
  if (st === 'loading' || (st === 'fail' && !force)) return;
  if (!navigator.onLine) return;
  fetching[k] = { s: 'loading', paras: wantParas };
  emit(k);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 75000);
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
        paras: wantParas,
      }),
    });
    const j = await res.json().catch(() => null);
    if (!res.ok || !j || j.error || !j.topic) throw new Error(j?.error || `서버 응답 ${res.status}`);
    if (squashed(String(j.topic))) throw new Error('주제 띄어쓰기 오류 — 다시 시도해 주세요');
    const n = verses.length;
    const paras: ParaSum[] | undefined = wantParas && Array.isArray(j.paras)
      ? (j.paras as { v?: unknown; sum?: unknown }[])
        .map(x => ({ v: Math.round(Number(x?.v)), sum: String(x?.sum ?? '').trim() }))
        .filter(x => x.v >= 1 && x.v <= n && x.sum.length > 10)
        .sort((a, b) => a.v - b.v)
        .filter((x, i, a) => i === 0 || x.v !== a[i - 1].v)
      : undefined;
    if (wantParas && !paras?.length) throw new Error('단락 요약을 받지 못했습니다');
    const keepTopic = e?.topic && !squashed(e.topic) ? e.topic : String(j.topic).trim();
    cacheSet<Entry>(NS2, k, { topic: keepTopic, paras: paras ?? e?.paras });
    delete fetching[k];
    emit(k);
  } catch (err) {
    const msg = err instanceof Error ? (err.name === 'AbortError' ? '시간 초과' : err.message) : String(err);
    fetching[k] = { s: 'fail', error: msg, paras: wantParas };
    emit(k);
  } finally {
    clearTimeout(timer);
  }
}

export function useTopic(book: number, chapter: number): TopicState {
  const k = `${book}:${chapter}`;
  return useSyncExternalStore(
    cb => { listeners.add(cb); return () => listeners.delete(cb); },
    () => snapshot(k),
  );
}

export function clearAllTopics() {
  v1 = {};
  cacheClearNs(NS2);
  for (const k of Object.keys(fetching)) delete fetching[k];
  for (const k of Object.keys(snaps)) delete snaps[k];
  try { localStorage.removeItem(KEY); localStorage.removeItem('sk-heads-v1'); } catch { /* 무시 */ }
  listeners.forEach(l => l());
}
