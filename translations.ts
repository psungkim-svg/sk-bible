/* ================================================================
   번역 비교: 새번역(표준새번역 개정판) · BSB
   - 해설 화면 맨 위에 개역개정과 나란히 보여 줍니다.
   - 인터넷이 될 때만 받아 옵니다. 폰에 따로 저장하지 않습니다.
   - 새번역: 자료 파일 tr-new-1~6.json (책 묶음)
   - BSB (Berean Standard Bible, 2023년부터 공개 저작물): HelloAO Free Use Bible API에서 장 단위로
   ================================================================ */
import { USFM } from './study';

export type TrId = 'new' | 'bsb';
export const TRANSLATIONS: { id: TrId; name: string; note?: string }[] = [
  { id: 'new', name: '새번역', note: '표준새번역 개정판' },
  { id: 'bsb', name: 'BSB', note: '영어 · Berean Standard Bible' },
];

// 책 번호(0~65) → 파일 번호 (창~룻 / 삼상~에 / 욥~아 / 사~말 / 마~행 / 롬~계)
const CHUNKS: [number, number][] = [[0, 7], [8, 16], [17, 21], [22, 38], [39, 43], [44, 65]];
function chunkOf(book: number) { return CHUNKS.findIndex(([a, b]) => book >= a && book <= b) + 1; }

type Chunk = Record<string, string[][]>;
const mem = new Map<string, Promise<Chunk>>();

function loadChunk(id: TrId, n: number): Promise<Chunk> {
  const k = `${id}-${n}`;
  let p = mem.get(k);
  if (!p) {
    p = fetch(`/data/tr-${k}.json`).then(r => {
      if (!r.ok) throw new Error('번역을 받지 못했습니다');
      return r.json() as Promise<Chunk>;
    });
    p.catch(() => mem.delete(k));
    mem.set(k, p);
  }
  return p;
}

/* ---- BSB: 장 하나씩 (helloao) ---- */
type Part = string | { text?: string; noteId?: number; lineBreak?: boolean };
type HaoItem = { type: string; number?: number; content?: Part[] };
const bsbMem = new Map<string, Promise<string[]>>();
function partsText(c: Part[] | undefined) {
  return (c || []).map(x => typeof x === 'string' ? x : (x.text || '')).filter(Boolean).join(' ').replace(/\s+/g, ' ').replace(/\s+([,.;:!?”’])/g, '$1').trim();
}
function loadBsb(book: number, chapter: number): Promise<string[]> {
  const k = `${book}:${chapter}`;
  let p = bsbMem.get(k);
  if (!p) {
    p = fetch(`https://bible.helloao.org/api/BSB/${USFM[book]}/${chapter}.json`).then(r => {
      if (!r.ok) throw new Error('번역을 받지 못했습니다');
      return r.json();
    }).then((d: { chapter?: { content?: HaoItem[] } }) => {
      const out: string[] = [];
      let sub = '';
      for (const it of d.chapter?.content || []) {
        if (it.type === 'hebrew_subtitle') sub = partsText(it.content);
        if (it.type !== 'verse' || !it.number) continue;
        const t = partsText(it.content);
        const i = it.number - 1;
        out[i] = out[i] ? out[i] + ' ' + t : t;
        if (it.number === 1 && sub) out[0] = `[${sub}] ${out[0]}`;
      }
      return out;
    });
    p.catch(() => bsbMem.delete(k));
    bsbMem.set(k, p);
  }
  return p;
}

/** 고른 절들의 번역 (없는 절은 빈 문자열) */
export async function getTranslation(id: TrId, book: number, chapter: number, verses: number[]): Promise<string[]> {
  if (!navigator.onLine) throw new Error('인터넷 연결이 필요합니다');
  if (id === 'bsb') {
    const ch = await loadBsb(book, chapter);
    return verses.map(v => ch[v - 1] || '');
  }
  const c = await loadChunk(id, chunkOf(book));
  const ch = c[String(book)]?.[chapter - 1] || [];
  return verses.map(v => ch[v - 1] || '');
}
