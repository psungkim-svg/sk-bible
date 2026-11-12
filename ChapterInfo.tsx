import { useEffect, useState } from 'react';
import { Chev } from './ToolIcons';
import { BibleData } from './bible';
import { BOOK_INFO } from './bookinfo';
import { BOOKS } from './books';
import { askBookBg, askBookIntro, askChapBg, BgAi, BiAi, BiPart, cacheGet, NS } from './study';
import { bookDict, DictData, isPlaceTerm, loadDictGeo } from './dict';
import { DictList } from './Words';
import type { GeoData } from './geo';
import { PtList } from './Pt';
import { GeoMapBox, PeopleBox } from './GeoView';

/* ---------- ② 배경 카드 (v1.9.2: 1장 = 📜 책 전체 배경 / 2장부터 = 📍 그 장의 배경 · 틴데일 책 소개에서 골라 쉬운 말로 번역 · 원문은 눌러서) ---------- */
type Part = { bg?: BgAi; state: 'idle' | 'loading' | 'error'; err: string };
function useBgPart(load: (sig: AbortSignal, force: boolean) => Promise<BgAi>, initial: BgAi | undefined, deps: unknown[]) {
  const [p, setP] = useState<Part>({ bg: initial, state: 'idle', err: '' });
  const [n, setN] = useState(0);
  useEffect(() => {
    if (initial && n === 0) { setP({ bg: initial, state: 'idle', err: '' }); return; }
    const ctl = new AbortController();
    setP(x => ({ ...x, state: 'loading' }));
    load(ctl.signal, n > 0)
      .then(r => setP({ bg: r, state: 'idle', err: '' }))
      .catch(e => { if (!ctl.signal.aborted) setP(x => ({ ...x, state: 'error', err: (e as Error).message })); });
    return () => ctl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [n, ...deps]);
  return [p, () => setN(x => x + 1)] as const;
}

export function BackgroundCard({ data, book, chapter, onVerse }: { data?: BibleData; book: number; chapter: number; onVerse?: (v: number) => void }) {
  const name = BOOKS[book].name;
  const total = data?.[book]?.length;
  const unit = book === 18 ? '편' : '장';
  const first = chapter === 1 || total === 1;
  // 2장부터: 그 장의 배경 / 책 소개에 그 장 글이 없으면 그때만 책 전체 배경
  const [cp, reCp] = useBgPart((sig, f) => (first ? Promise.resolve({ pts: [], none: true } as BgAi) : askChapBg(book, chapter, sig, f)),
    first ? { pts: [], none: true } : cacheGet<BgAi>(NS.bg, `${book}:${chapter}`), [book, chapter]);
  const needBook = first || !!(cp.bg?.none && !cp.bg.pts.length);
  const [bp, reBp] = useBgPart((sig, f) => (needBook ? askBookBg(book, sig, f) : Promise.resolve({ pts: [] } as BgAi)),
    needBook ? cacheGet<BgAi>(NS.bg, `${book}`) : { pts: [] }, [book, needBook]);
  const p = needBook ? bp : cp;
  const retry = needBook ? reBp : reCp;
  const busy = p.state === 'loading';
  return (
    <div className="bg-card">
      <div className="bg-keys-h">
        {needBook ? <>📜 {name} 전체의 배경{total ? <span className="bg-range">1–{total}{unit}</span> : null}</> : <>📍 {chapter}{unit}의 배경{cp.bg?.range && cp.bg.range !== `${chapter}장` ? <span className="bg-range">{cp.bg.range} 이야기</span> : null}</>}
      </div>
      {p.state === 'loading' && !p.bg && <div className="busy" style={{ padding: '4px 0' }}><div className="spinner small" /> 번역 중… (10~30초)</div>}
      {p.state === 'error' && !p.bg && <div className="ai-err">⚠️ {p.err} <button className="link-btn" onClick={retry}>다시 시도</button></div>}
      {p.bg && (p.bg.pts.length > 0 ? <PtList pts={p.bg.pts} /> : (needBook && !busy ? <p className="desc muted">배경 자료 없음</p> : null))}
      <GeoMapBox book={book} chapter={chapter} bookWide={first} bookName={name} onVerse={onVerse} />
      <PeopleBox book={book} chapter={chapter} />
      <div className="ai-foot">
        <span className="muted small">출처: 틴데일 · Theographic · Natural Earth</span>
        {busy ? <span className="muted">받는 중…</span> : <button onClick={retry}>↻ 다시</button>}
      </div>
    </div>
  );
}

/* ---------- ⑦ 성경 66권 소개 (v1.11: 중학생도 알 수 있게) ----------
   한 줄 요약 · 누가·언제·어디서·누구에게 · 왜 · 줄거리 · 구조 · 인물·장소 · 지도 · 기억할 구절
   (누가/왜/줄거리 = 틴데일 책 소개에서 골라 쉬운 말로 번역 · 원문은 눌러서) */
function useBi(book: number, part: BiPart, on: boolean) {
  const [st, setSt] = useState<{ v?: BiAi; state: 'idle' | 'loading' | 'error'; err: string }>({ v: cacheGet<BiAi>(NS.bi, `${book}|${part}`), state: 'idle', err: '' });
  const [n, setN] = useState(0);
  useEffect(() => {
    const hit = cacheGet<BiAi>(NS.bi, `${book}|${part}`);
    if (hit && n === 0) { setSt({ v: hit, state: 'idle', err: '' }); return; }
    if (!on) { setSt({ state: 'idle', err: '' }); return; }
    const ctl = new AbortController();
    setSt(x => ({ ...x, state: 'loading' }));
    askBookIntro(book, part, ctl.signal, n > 0)
      .then(v => setSt({ v, state: 'idle', err: '' }))
      .catch(e => { if (!ctl.signal.aborted) setSt(x => ({ ...x, state: 'error', err: (e as Error).message })); });
    return () => ctl.abort();
  }, [book, part, on, n]);
  return [st, () => setN(x => x + 1)] as const;
}
function BiPartView({ st, retry }: { st: { v?: BiAi; state: string; err: string }; retry: () => void }) {
  if (st.v?.pts.length) return <PtList pts={st.v.pts} />;
  if (st.state === 'loading') return <div className="busy" style={{ padding: '2px 0' }}><div className="spinner small" /> 번역 중…</div>;
  if (st.state === 'error') return <div className="ai-err">⚠️ {st.err} {navigator.onLine && <button className="link-btn" onClick={retry}>다시</button>}</div>;
  if (st.v?.none) return <p className="desc muted">자료 없음</p>;
  return null;
}
function bookPeople(g: GeoData, d: DictData, book: number, max = 10): string[] {
  const n = new Map<number, number>();
  for (const [k, v] of Object.entries(g.ch)) {
    if (!k.startsWith(`${book}.`)) continue;
    for (const [pi] of v[1]) n.set(pi, (n.get(pi) || 0) + 1);
  }
  const names: string[] = [];
  for (const [pi] of [...n.entries()].sort((a, b) => b[1] - a[1])) {
    const nm = g.pe[pi]?.[0];
    if (nm && !names.includes(nm) && !isPlaceTerm(d, nm)) names.push(nm);
    if (names.length >= max) break;
  }
  return names;
}

export function BookIntro({ data, book, compact, onGo }: { data: BibleData; book: number; compact?: boolean; onGo?: (chapter: number, verse?: number) => void }) {
  const info = BOOK_INFO[book];
  const [open, setOpen] = useState(!compact);
  const [mapOn, setMapOn] = useState(false);
  const [dg, setDg] = useState<{ d: DictData; g: GeoData | null } | null>(null);
  useEffect(() => { setMapOn(false); }, [book]);
  useEffect(() => { if (open && !dg) loadDictGeo().then(setDg).catch(() => {}); }, [open, dg]);
  const [w, reW] = useBi(book, 'w', open);
  const [y, reY] = useBi(book, 'y', open);
  const [sm, reS] = useBi(book, 's', open);
  if (!info) return null;
  const one = data[book].length === 1;
  const unit = book === 18 ? '편' : one ? '절' : '장';
  const [kc, kvs] = info.k.split(':');
  const kv1 = Number(kvs.split('-')[0]), kv2 = Number(kvs.split('-').pop());
  const keyText = Array.from({ length: kv2 - kv1 + 1 }, (_, i) => data[book][Number(kc) - 1]?.[kv1 - 1 + i]).filter(Boolean).join(' ');
  const parts = info.o.split('|').map(p => { const m = p.match(/^([\d-]+)\s+(.*)$/); return m ? { r: m[1], t: m[2] } : { r: '', t: p }; });
  const places = dg ? bookDict(dg.d, dg.g, book, 12) : [];
  const people = dg?.g ? bookPeople(dg.g, dg.d, book) : [];
  const who = w.v?.who || y.v?.who || sm.v?.who || '틴데일 스터디 노트 (책 소개)';

  return (
    <div className={'book-intro' + (open ? ' open' : '')}>
      <button className="bi-head" onClick={() => setOpen(o => !o)}>
        <span className="bi-icon">📘</span>
        <span className="bi-title"><b>{BOOKS[book].name}</b> 소개<span className="bi-theme">{info.t}</span></span>
        <span className="bi-arrow"><Chev open={open} /></span>
      </button>
      {open && (
        <div className="bi-body">
          <p className="bi-sum">{info.s}</p>

          <div className="bi-sec">🧑 누가 · 언제 · 어디서 · 누구에게</div>
          <dl className="bg-grid">
            <dt>✍️ 저자</dt><dd>{info.a}</dd>
            <dt>🕰️ 시대</dt><dd>{info.d}</dd>
            <dt>📏 분량</dt><dd>{data[book].length}{book === 18 ? '편' : '장'} · {data[book].reduce((n, c) => n + c.length, 0).toLocaleString()}절</dd>
          </dl>
          <BiPartView st={w} retry={reW} />

          <div className="bi-sec">❓ 왜 썼나</div>
          <BiPartView st={y} retry={reY} />

          <div className="bi-sec">📖 줄거리</div>
          <BiPartView st={sm} retry={reS} />

          <div className="bi-sec">🧭 구조</div>
          <div className="bi-outline">
            {parts.map((p, i) => {
              const start = Number(p.r.split('-')[0]) || 1;
              return (
                <button key={i} className="bi-part" onClick={() => onGo?.(one ? 1 : start, one ? start : undefined)} disabled={!onGo}>
                  <span className="bi-range">{p.r}{unit}</span><span>{p.t}</span>
                </button>
              );
            })}
          </div>

          {people.length > 0 && (<><div className="bi-sec">👤 주요 인물</div><p className="bi-people">{people.join(' · ')}</p></>)}
          {places.length > 0 && (<><div className="bi-sec">🗺️ 주요 장소 → 오늘날</div><DictList items={places} /></>)}
          {dg?.g && (mapOn
            ? <GeoMapBox book={book} chapter={1} bookWide bookName={BOOKS[book].name} />
            : <button className="link-btn bi-map" onClick={() => setMapOn(true)}>🗺️ 지도 보기</button>)}

          <div className="bi-sec">⭐ 기억할 구절 ({info.k})</div>
          <button className="bi-key" onClick={() => onGo?.(Number(kc), kv1)} disabled={!onGo}>{keyText}</button>
          <p className="desc small">저자·연대: 전통적 견해 · 설명: {who.replace(/ \(.*\)$/, '')} · 위치: 대략</p>
        </div>
      )}
    </div>
  );
}
