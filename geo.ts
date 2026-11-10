/* ================================================================
   v1.9.4 🗺️ 지도 · 👤 인물 자료 (geo.json — 앱 안에 들어 있어 인터넷 없이도)
   - 장소·인물·좌표: Theographic Bible Metadata (CC BY-SA 4.0)
   - 한글 이름: 개역개정 본문에 실제로 나오는 표기만 (그 장 본문에 없으면 넣지 않음)
   - 바탕 지도: Natural Earth (퍼블릭 도메인)
   - 인물 소개: Easton 성경사전(1897, 퍼블릭 도메인) 원문을 골라 쉬운 말로 번역
   ================================================================ */
import { ask, cacheGet, cacheSet, NS, Pt } from './study';

/** [한글 이름, 경도×100, 위도×100, 종류 첫 글자(C 도시, R 지역, W 물, M 산 …)] */
export type GeoPlace = [string, number, number, string];
export interface GeoData {
  v: number;
  pl: GeoPlace[];
  pe: [string, string][];                       // [한글 이름, theographic id]
  ch: Record<string, [[number, number][], [number, number][]]>; // "책.장" → [[장소, 처음 나오는 절]], [[인물, 처음 나오는 절]]
  bk: Record<string, [number, number][]>;       // 책 → [[장소, 나오는 횟수]]
  base: { land: number[][][]; lakes: number[][][]; rivers: number[][][] };
}

let geo: GeoData | null = null;
let loading: Promise<GeoData> | null = null;
export function loadGeo(): Promise<GeoData> {
  if (geo) return Promise.resolve(geo);
  if (!loading) {
    loading = fetch('/data/geo.json')
      .then(r => { if (!r.ok) throw new Error('지도 자료를 받지 못했습니다'); return r.json(); })
      .then(j => (geo = j as GeoData))
      .catch(e => { loading = null; throw e; });
  }
  return loading;
}

export interface MapPt { name: string; lon: number; lat: number; kind: string; v?: number }
export interface Person { name: string; id: string; v: number }

export function chapterPlaces(g: GeoData, book: number, chapter: number): MapPt[] {
  const c = g.ch[`${book}.${chapter}`];
  return (c?.[0] || []).map(([i, v]) => { const p = g.pl[i]; return { name: p[0], lon: p[1] / 100, lat: p[2] / 100, kind: p[3], v }; });
}
export function bookPlaces(g: GeoData, book: number): MapPt[] {
  return (g.bk[String(book)] || []).map(([i]) => { const p = g.pl[i]; return { name: p[0], lon: p[1] / 100, lat: p[2] / 100, kind: p[3] }; });
}
export function chapterPeople(g: GeoData, book: number, chapter: number): Person[] {
  const c = g.ch[`${book}.${chapter}`];
  return (c?.[1] || []).map(([i, v]) => ({ name: g.pe[i][0], id: g.pe[i][1], v }));
}

/** 👤 인물 소개 — Easton 성경사전 원문에서 2~3문장을 골라 쉬운 말로 번역 (한 번 받으면 폰과 함께 쓰는 저장소에 저장) */
export async function askPerson(p: Person, signal?: AbortSignal, force = false): Promise<{ pts: Pt[]; none?: boolean }> {
  const hit = !force && cacheGet<{ pts: Pt[]; none?: boolean }>(NS.who, p.id);
  if (hit) return hit;
  if (!navigator.onLine) throw new Error('인터넷에 연결되어 있지 않습니다');
  const r = await fetch(`https://bible.helloao.org/api/d/theographic/people/${encodeURIComponent(p.id)}.json`, { signal });
  if (!r.ok) throw new Error('인물 자료를 받지 못했습니다');
  const j = await r.json();
  const desc = (j?.person?.description || []).join('\n\n').replace(/\s+\n/g, '\n').trim();
  if (!desc) { const none = { pts: [], none: true }; cacheSet(NS.who, p.id, none); return none; }
  const out = await ask<{ items: Pt[] }>({
    step: 'extract', style: 'easy', q: `${p.name} 인물 소개`, who: 'Easton 성경사전', source: desc.slice(0, 4000),
    focus: `${p.name}(${j?.person?.name || ''})은(는) 누구인가 — 어떤 사람이고, 성경에서 무슨 일을 했는가. 처음 듣는 사람도 알 수 있는 가장 기본적인 사실`,
    n: '2~3', max: 3, ck: `w|${p.id}`,
  }, signal);
  const res = { pts: out.items || [], none: !(out.items || []).length };
  cacheSet(NS.who, p.id, res);
  return res;
}
