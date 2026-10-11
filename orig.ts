/* ================================================================
   원어(히브리어 · 아람어 · 헬라어) 자료
   - 단어 자료: STEPBible.org TAHOT / TAGNT (CC BY 4.0)
     구약 = 히브리어 레닌그라드 사본, 신약 = 헬라어 NA28 본문
   - 처음 한 번 인터넷으로 받은 뒤에는 폰에 저장되어 인터넷 없이도 보입니다.
   - AI 원어 해설은 인터넷이 필요합니다 (Cloudflare Workers AI).
   ================================================================ */
import { BOOKS } from './books';
import { decodeMorph } from './morph';

/** [원어, 음역, 영어 직역, 스트롱 번호, 문법 코드, 사전형, 사전 뜻] */
export type OrigWord = [string, string, string, string, string, string?, string?];

// 책 번호 → 자료 파일 (orig-1.json ~ orig-9.json)
const GROUPS: [number, number][] = [[0, 4], [5, 11], [12, 18], [19, 22], [23, 26], [27, 38], [39, 42], [43, 47], [48, 65]];
export function chunkOf(book: number) { return GROUPS.findIndex(([a, b]) => book >= a && book <= b) + 1; }
export const CHUNK_MB = [0, 1.3, 1.2, 1.3, 0.6, 0.9, 0.3, 0.9, 0.6, 0.5];

const chunks = new Map<number, Promise<Record<string, OrigWord[]>>>();

export function loadChunk(n: number) {
  let p = chunks.get(n);
  if (!p) {
    p = fetch(`/data/orig-${n}.json`).then(r => {
      if (!r.ok) throw new Error('원어 자료를 받지 못했습니다');
      return r.json();
    });
    p.catch(() => chunks.delete(n));
    chunks.set(n, p);
  }
  return p;
}

export async function getVerseWords(book: number, chapter: number, verse: number): Promise<OrigWord[]> {
  const d = await loadChunk(chunkOf(book));
  return d[`${book}.${chapter}.${verse}`] ?? [];
}

export const isGreek = (book: number) => book >= 39;

export interface OrigAi {
  summary: string;
  words: { i: number; ko: string; pron?: string; note?: string }[];
  points: { title: string; body: string }[];
}

export async function askOrigAi(
  book: number, chapter: number, verse: number, korean: string, words: OrigWord[], signal?: AbortSignal,
): Promise<OrigAi> {
  const greek = isGreek(book);
  const res = await fetch('/api/ask', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-sk-app': '1' },
    signal,
    body: JSON.stringify({
      step: 'original',
      q: `${BOOKS[book].name} ${chapter}:${verse}`,
      lang: greek ? '헬라어' : '히브리어',
      korean,
      words: words.map((w, i) => ({
        i, w: w[0], tr: w[1], en: w[2], s: w[3], g: decodeMorph(w[4], greek), lemma: w[5] || '', lg: w[6] || '',
      })),
    }),
  });
  const j = await res.json().catch(() => null);
  if (!res.ok || !j || j.error) throw new Error(j?.error || `서버 오류 (${res.status})`);
  return {
    summary: String(j.summary ?? ''),
    words: Array.isArray(j.words) ? j.words : [],
    points: Array.isArray(j.points) ? j.points : [],
  };
}
