/* ================================================================
   v1.10 📖 지명·낱말 사전 (dict.json — 앱 안에 들어 있어 인터넷 없이)
   - 나라·민족·땅: 그때 이름 → 오늘날 어디 (표준 성경 사전 · 지도 기준 · 갈리는 곳은 "학자마다 다름")
   - 장소: 지도 자료(Theographic) 좌표 → 오늘날 나라 · 가까운 도시 (Natural Earth)
   - 단위·돈·시간: 표준 환산값 (세겔 ≈ 11.4g, 규빗 ≈ 45cm …)
   - 옛 말: 개역개정에 나오는 낯선 말을 쉬운 말로
   ================================================================ */
import { GeoData, loadGeo } from './geo';

export type DictCat = 'N' | 'U' | 'W';
export interface DictData {
  v: number;
  t: [string, DictCat, string][];   // [이름, 분류, 풀이]
  pm: string[];                     // 지도 장소 번호 → 오늘날 위치 ('' = 없음)
  ch: Record<string, number[]>;     // "책.장" → [낱말 번호, 처음 나오는 절, …]
  bk: Record<string, number[]>;     // 책 → 많이 나오는 나라·땅 낱말 번호
}
/** 화면에 보이는 한 항목 (P = 지도 장소) */
export interface DictItem { name: string; cat: DictCat | 'P'; text: string; v?: number }

let dict: DictData | null = null;
let loading: Promise<DictData> | null = null;
export function loadDict(): Promise<DictData> {
  if (dict) return Promise.resolve(dict);
  if (!loading) {
    loading = fetch('/data/dict.json')
      .then(r => { if (!r.ok) throw new Error('사전 자료를 받지 못했습니다'); return r.json(); })
      .then(j => (dict = j as DictData))
      .catch(e => { loading = null; throw e; });
  }
  return loading;
}
export function getDictNow() { return dict; }
/** 나라·땅 이름이면 true (인물 목록에서 "가나안" 같은 이름을 빼는 데) */
export function isPlaceTerm(d: DictData, name: string) { const i = termByName(d).get(name); return i !== undefined && d.t[i][1] === 'N'; }

/** 사전과 지도 자료를 함께 (지도 자료가 없어도 사전은 보여 줌) */
export async function loadDictGeo(): Promise<{ d: DictData; g: GeoData | null }> {
  const [d, g] = await Promise.all([loadDict(), loadGeo().catch(() => null)]);
  return { d, g };
}

const nameIndex = new WeakMap<DictData, Map<string, number>>();
function termByName(d: DictData) {
  let m = nameIndex.get(d);
  if (!m) {
    m = new Map();
    d.t.forEach((t, i) => { m!.set(t[0], i); m!.set(t[0].replace(/\s/g, ''), i); });   // "밧단아람" = "밧단 아람"
    nameIndex.set(d, m);
  }
  return m;
}
const placeText = (s: string) => `오늘날 ${s}`;

/** 이 장에 나오는 것만 (나오는 절 순서) */
export function chapterDict(d: DictData, g: GeoData | null, book: number, chapter: number): DictItem[] {
  const out: DictItem[] = [];
  const seen = new Set<string>();
  const c = d.ch[`${book}.${chapter}`] || [];
  for (let i = 0; i < c.length; i += 2) {
    const t = d.t[c[i]];
    if (!t || seen.has(t[0])) continue;
    seen.add(t[0]);
    out.push({ name: t[0], cat: t[1], text: t[2], v: c[i + 1] });
  }
  const byName = termByName(d);
  for (const t of out) seen.add(t.name.replace(/\s/g, ''));
  for (const [pi, v] of g?.ch[`${book}.${chapter}`]?.[0] || []) {
    const p = g!.pl[pi];
    if (!p || seen.has(p[0]) || seen.has(p[0].replace(/\s/g, ''))) continue;
    const ti = byName.get(p[0]) ?? byName.get(p[0].replace(/\s/g, ''));
    if (ti !== undefined && d.t[ti][1] === 'N') { const nm = d.t[ti][0]; if (seen.has(nm)) continue; seen.add(p[0]); seen.add(nm); out.push({ name: nm, cat: 'N', text: d.t[ti][2], v }); continue; }
    if (!d.pm[pi]) continue;
    seen.add(p[0]);
    out.push({ name: p[0], cat: 'P', text: placeText(d.pm[pi]), v });
  }
  return out;
}

/** 책 소개용: 이 책의 주요 나라·땅 + 많이 나오는 장소 */
export function bookDict(d: DictData, g: GeoData | null, book: number, max = 14): DictItem[] {
  const out: DictItem[] = [];
  const seen = new Set<string>();
  const byName = termByName(d);
  // 지도 자료의 많이 나오는 장소 순서를 먼저 (그 책에서 실제로 자주 나오는 곳)
  for (const [pi] of g?.bk[String(book)] || []) {
    if (out.length >= max) break;
    const p = g!.pl[pi];
    if (!p || seen.has(p[0]) || seen.has(p[0].replace(/\s/g, ''))) continue;
    const ti = byName.get(p[0]) ?? byName.get(p[0].replace(/\s/g, ''));
    if (ti !== undefined && d.t[ti][1] === 'N') { const nm = d.t[ti][0]; if (seen.has(nm)) continue; seen.add(p[0]); seen.add(nm); out.push({ name: nm, cat: 'N', text: d.t[ti][2] }); continue; }
    if (!d.pm[pi]) continue;
    seen.add(p[0]);
    out.push({ name: p[0], cat: 'P', text: placeText(d.pm[pi]) });
  }
  for (const ti of d.bk[String(book)] || []) {
    if (out.length >= max) break;
    const t = d.t[ti];
    if (seen.has(t[0])) continue;
    seen.add(t[0]);
    out.push({ name: t[0], cat: t[1], text: t[2] });
  }
  return out;
}

/** 검색어가 사전에 있으면 (이름이 같거나, 검색어가 "갈대아인"처럼 이름 + 한두 글자일 때) */
export function lookupDict(d: DictData, g: GeoData | null, q: string): DictItem[] {
  const s = q.replace(/\s+/g, ' ').trim();
  if (s.length < 1 || s.length > 14) return [];
  const hit = (name: string) => name === s || (s.length >= 2 && s.startsWith(name) && s.length - name.length <= 2 && name.length >= 2)
    || (s.length >= 2 && name.replace(/\s/g, '') === s.replace(/\s/g, ''));
  const out: DictItem[] = [];
  const seen = new Set<string>();
  d.t.forEach(t => { if (hit(t[0]) && !seen.has(t[0])) { seen.add(t[0]); out.push({ name: t[0], cat: t[1], text: t[2] }); } });
  if (g) {
    const texts = new Map<string, Set<string>>();
    g.pl.forEach((p, i) => {
      if (!hit(p[0]) || seen.has(p[0]) || !d.pm[i]) return;
      const set = texts.get(p[0]) || new Set<string>();
      set.add(d.pm[i]);
      texts.set(p[0], set);
    });
    for (const [name, set] of texts) {
      const list = [...set];
      out.push({ name, cat: 'P', text: list.length === 1 ? placeText(list[0]) : `같은 이름의 곳이 ${list.length}군데 · ` + list.slice(0, 3).map(placeText).join(' / ') });
    }
  }
  return out.slice(0, 4);
}

export const CAT_LABEL: Record<DictItem['cat'], string> = { N: '🗺️ 나라·땅', P: '🗺️ 나라·땅', U: '📏 단위·돈·시간', W: '📖 옛 말·낯선 말' };
