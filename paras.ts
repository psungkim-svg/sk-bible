/* ================================================================
   📝 단락 요약 (v1.9)
   예전: AI가 단락마다 요약을 지어 씀
   지금: 틴데일 스터디 노트에 있는 "단락 노트"(예: 5:13-16 …)에서
         요약 문장 1~2개를 그대로 골라 번역만 합니다. (원문에 있는지 서버가 확인)
   - 노트가 있는 단락에만 나옵니다. 노트가 없는 장은 AI를 부르지 않습니다.
   - 한 번 받은 것은 폰에 저장 → 인터넷 없이도 바로
   ================================================================ */
import { useSyncExternalStore } from 'react';
import { BOOKS } from './books';
import { ask, cacheGet, cacheSet, fetchChapter, itemText, NS, Pt } from './study';
import { cacheClearNs } from './aicache';

export interface ParaPt extends Pt { v: number }
export interface ParaState { status: 'none' | 'loading' | 'ready' | 'fail'; paras?: ParaPt[]; error?: string }

const listeners = new Set<() => void>();
const fetching: Record<string, ParaState> = {};
const snaps: Record<string, ParaState> = {};
const NONE: ParaState = { status: 'none' };

function emit(k: string) { delete snaps[k]; listeners.forEach(l => l()); }
function snapshot(k: string): ParaState {
  if (snaps[k]) return snaps[k];
  const saved = cacheGet<ParaPt[]>(NS.para, k);
  return (snaps[k] = saved ? { status: 'ready', paras: saved } : fetching[k] || NONE);
}

/** 틴데일 노트 가운데 3절 이상을 묶어 설명하는 "단락 노트"만 */
function rangeNotes(items: { number?: number; content?: unknown[] }[], chapter: number) {
  const out: { v: number; text: string }[] = [];
  for (const it of items) {
    for (const para of itemText(it).split('\n')) {
      const t = para.trim();
      const m = t.match(/^(\d+):(\d+)\s*[–-]\s*(?:(\d+):)?(\d+)\b/);
      if (!m || Number(m[1]) !== chapter) continue;
      const v = Number(m[2]);
      const endCh = m[3] ? Number(m[3]) : chapter;
      const endV = Number(m[4]);
      if (endCh === chapter && endV - v < 2) continue;
      if (out.some(x => x.v === v)) continue;
      out.push({ v, text: t.slice(0, 1500) });
    }
  }
  return out.sort((a, b) => a.v - b.v).slice(0, 14);
}

export async function ensureParas(book: number, chapter: number, force = false) {
  const k = `${book}:${chapter}`;
  if (cacheGet(NS.para, k)) return;
  const st = fetching[k]?.status;
  if (st === 'loading' || (st === 'fail' && !force)) return;
  if (!navigator.onLine) return;
  fetching[k] = { status: 'loading' };
  emit(k);
  try {
    const items = await fetchChapter('tyndale', book, chapter);
    if (!items) throw new Error('틴데일 노트를 받지 못했습니다');
    const notes = rangeNotes(items, chapter);
    let paras: ParaPt[] = [];
    if (notes.length) {
      const r = await ask<{ paras: ParaPt[] }>({ step: 'paras', q: `${BOOKS[book].name} ${chapter}장`, notes, ck: `${book}.${chapter}` });
      paras = (r.paras || []).filter(p => p.v >= 1 && p.ko);
      if (!paras.length) throw new Error('단락 요약을 받지 못했습니다');
    }
    cacheSet(NS.para, k, paras);   // 노트가 없는 장은 빈 목록으로 저장 (다시 묻지 않음)
    delete fetching[k];
  } catch (e) {
    fetching[k] = { status: 'fail', error: (e as Error).message };
  }
  emit(k);
}

/** 🌙 이 장을 읽었다고 서버에 알림 (장 번호만 · 사람 정보 없음)
    → 저녁에 서버가 "다음 장"의 해설을 미리 만들어 둠. 같은 장은 앱을 켤 때마다 한 번만. */
const pinged = new Set<string>();
export function pingRead(book: number, chapter: number) {
  const ck = `${book}.${chapter}`;
  if (pinged.has(ck) || !navigator.onLine) return;
  pinged.add(ck);
  fetch('/api/read', { method: 'POST', headers: { 'content-type': 'application/json', 'x-sk-app': '1' }, body: JSON.stringify({ ck }), keepalive: true }).catch(() => {});
}

export function useParas(book: number, chapter: number): ParaState {
  const k = `${book}:${chapter}`;
  return useSyncExternalStore(
    cb => { listeners.add(cb); return () => listeners.delete(cb); },
    () => snapshot(k),
  );
}

export function clearAllParas() {
  cacheClearNs(NS.para);
  for (const k of Object.keys(fetching)) delete fetching[k];
  for (const k of Object.keys(snaps)) delete snaps[k];
  listeners.forEach(l => l());
}
