/* ================================================================
   문장으로 찾기 (인터넷 없이 폰 안에서 동작)
   - 기억나는 대로 대충 쓴 문장과 "글자 모양이 가장 비슷한" 구절을 찾습니다.
   - 방법: 글자 2개씩 묶은 조각(예: "사랑" "랑하" "하사")이 얼마나 겹치는지 점수(BM25)를 매깁니다.
     띄어쓰기·문장부호는 무시하므로 "할수있다" ≈ "할 수 있느니라" 도 찾습니다.
   ================================================================ */
import type { BibleData, SearchScope } from './bible';

interface Index {
  N: number;
  book: Uint8Array;
  chapter: Uint16Array;
  verse: Uint16Array;
  len: Float32Array;
  avgLen: number;
  postings: Map<string, Int32Array>; // 조각 → 그 조각이 나오는 절 번호들 (같은 절이 여러 번 = 여러 번 나옴)
}

let index: Index | null = null;

const KEEP = /[가-힣a-zA-Z0-9]/;

function strip(s: string) {
  let out = '';
  for (const ch of s) if (KEEP.test(ch)) out += ch;
  return out;
}

function grams(s: string): string[] {
  const t = strip(s);
  const g: string[] = [];
  for (let i = 0; i < t.length - 1; i++) g.push(t.slice(i, i + 2));
  return g;
}

/** 처음 한 번만 색인을 만듭니다 (휴대폰에서 약 0.3~1초) */
export function buildIndex(data: BibleData): Index {
  if (index) return index;
  let N = 0;
  for (const b of data) for (const c of b) N += c.length;
  const book = new Uint8Array(N), chapter = new Uint16Array(N), verse = new Uint16Array(N), len = new Float32Array(N);
  const tmp = new Map<string, number[]>();
  let i = 0, total = 0;
  data.forEach((b, bi) => b.forEach((c, ci) => c.forEach((text, vi) => {
    book[i] = bi; chapter[i] = ci + 1; verse[i] = vi + 1;
    const g = grams(text.replace(/^\[[^\]]*\]/, '')); // 시편 표제는 제외
    len[i] = g.length; total += g.length;
    for (const x of g) {
      let arr = tmp.get(x);
      if (!arr) { arr = []; tmp.set(x, arr); }
      arr.push(i);
    }
    i++;
  })));
  const postings = new Map<string, Int32Array>();
  tmp.forEach((arr, k) => postings.set(k, Int32Array.from(arr)));
  index = { N, book, chapter, verse, len, avgLen: total / N, postings };
  return index;
}

export function isIndexReady() { return index !== null; }

export interface SentenceHit { book: number; chapter: number; verse: number; text: string; score: number; }

export function searchSentence(data: BibleData, query: string, scope: SearchScope, limit = 50): SentenceHit[] {
  const idx = buildIndex(data);
  const qg = [...new Set(grams(query))];
  if (qg.length === 0) return [];
  const { N, len, avgLen, postings } = idx;
  const k1 = 1.2, b = 0.75;
  const score = new Float32Array(N);
  const touched: number[] = [];

  for (const g of qg) {
    const p = postings.get(g);
    if (!p) continue;
    // 문서 빈도(df) 계산: 연속된 같은 번호는 한 절
    let df = 0;
    for (let j = 0; j < p.length; j++) if (j === 0 || p[j] !== p[j - 1]) df++;
    const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
    for (let j = 0; j < p.length;) {
      const d = p[j];
      let tf = 0;
      while (j < p.length && p[j] === d) { tf++; j++; }
      if (score[d] === 0) touched.push(d);
      score[d] += idf * (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * len[d] / avgLen));
    }
  }

  // 범위 적용
  const ok = (d: number) => {
    const bk = idx.book[d];
    if (scope === 'all') return true;
    if (scope === 'OT') return bk < 39;
    if (scope === 'NT') return bk >= 39;
    return bk === scope;
  };
  const cand = touched.filter(ok).sort((a, c) => score[c] - score[a]);
  if (!cand.length) return [];
  const top = score[cand[0]];
  const out: SentenceHit[] = [];
  for (const d of cand) {
    if (out.length >= limit || score[d] < top * 0.3) break;
    out.push({
      book: idx.book[d], chapter: idx.chapter[d], verse: idx.verse[d],
      text: data[idx.book[d]][idx.chapter[d] - 1][idx.verse[d] - 1],
      score: score[d] / top,
    });
  }
  return out;
}

/** 결과 문장에서 입력과 겹치는 글자 위치를 표시하기 위한 조각 나누기 */
export function matchSegments(text: string, query: string): { s: string; m: boolean }[] {
  const qset = new Set(grams(query));
  const chars = [...text];
  const keptIdx: number[] = [];
  chars.forEach((ch, i) => { if (KEEP.test(ch)) keptIdx.push(i); });
  const mark = new Array(chars.length).fill(false);
  for (let k = 0; k < keptIdx.length - 1; k++) {
    const a = keptIdx[k], c = keptIdx[k + 1];
    if (qset.has(chars[a] + chars[c])) { mark[a] = true; mark[c] = true; }
  }
  const segs: { s: string; m: boolean }[] = [];
  chars.forEach((ch, i) => {
    const m = mark[i] || (!KEEP.test(ch) && mark[i - 1] && mark[i + 1]); // 단어 사이 빈칸도 이어서 표시
    const last = segs[segs.length - 1];
    if (last && last.m === m) last.s += ch; else segs.push({ s: ch, m });
  });
  return segs;
}
