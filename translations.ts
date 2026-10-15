/* ================================================================
   번역 비교: 새번역 · 쉬운성경
   - 해설 화면 맨 위에 개역개정과 나란히 보여 줍니다.
   - 인터넷이 될 때만 필요한 부분(책 묶음)을 받아 옵니다. 폰에 따로 저장하지 않습니다.
   - 자료 파일: tr-new-1~6.json (새번역), tr-easy-1~6.json (쉬운성경)
   ================================================================ */
export type TrId = 'new' | 'easy';
export const TRANSLATIONS: { id: TrId; name: string }[] = [
  { id: 'new', name: '새번역' },
  { id: 'easy', name: '쉬운성경' },
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

/** 고른 절들의 번역 (없는 절은 빈 문자열) */
export async function getTranslation(id: TrId, book: number, chapter: number, verses: number[]): Promise<string[]> {
  if (!navigator.onLine) throw new Error('인터넷 연결이 필요합니다');
  const c = await loadChunk(id, chunkOf(book));
  const ch = c[String(book)]?.[chapter - 1] || [];
  return verses.map(v => ch[v - 1] || '');
}
