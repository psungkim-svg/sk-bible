import { useEffect, useState } from 'react';
import { Chev } from './ToolIcons';
import { BibleData } from './bible';
import { BOOK_INFO } from './bookinfo';
import { BOOKS } from './books';
import { askBookBg, askChapBg, BgAi, cacheGet, NS } from './study';
import { PtList } from './Pt';

/* ---------- ② 배경 카드 (v1.9.1: 📍 지금 읽는 장 + 📜 책 전체 — 둘 다 틴데일 책 소개에서 골라 쉬운 말로 번역, 영어 원문 없음) ---------- */
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

export function BackgroundCard({ data, book, chapter }: { data?: BibleData; book: number; chapter: number; onVerse?: (v: number) => void }) {
  const name = BOOKS[book].name;
  const total = data?.[book]?.length;
  const unit = book === 18 ? '편' : '장';
  const [cp, reCp] = useBgPart((sig, f) => askChapBg(book, chapter, sig, f), cacheGet<BgAi>(NS.bg, `${book}:${chapter}`), [book, chapter]);
  const [bp, reBp] = useBgPart((sig, f) => askBookBg(book, sig, f), cacheGet<BgAi>(NS.bg, `${book}`), [book]);
  const busy = cp.state === 'loading' || bp.state === 'loading';
  const part = (p: Part, retry: () => void, what: string) => (
    <>
      {p.state === 'loading' && !p.bg && <div className="busy" style={{ padding: '4px 0' }}><div className="spinner small" /> {what} 찾아 번역하는 중… (10~30초)</div>}
      {p.state === 'error' && !p.bg && <div className="ai-err">⚠️ {p.err} <button className="link-btn" onClick={retry}>다시 시도</button></div>}
      {p.bg && (p.bg.pts.length > 0 ? <PtList pts={p.bg.pts} noOrig /> : <p className="desc muted">책 소개에 이 부분에 대한 글이 없습니다.</p>)}
    </>
  );
  const chapShown = !(cp.bg?.none && !cp.bg.pts.length);
  return (
    <div className="bg-card">
      {chapShown && (
        <div className="bg-part">
          <div className="bg-keys-h">📍 {chapter}{unit}이 속한 부분{cp.bg?.range && cp.bg.range !== `${chapter}장` ? <span className="bg-range">{cp.bg.range}</span> : null}</div>
          {part(cp, reCp, `${chapter}${unit} 부분을`)}
        </div>
      )}
      <div className="bg-part">
        <div className="bg-keys-h">📜 {name} 전체의 배경{total ? <span className="bg-range">1–{total}{unit} 공통</span> : null}</div>
        {part(bp, reBp, `${name}의 배경을`)}
      </div>
      <div className="ai-foot">
        <span className="muted small">틴데일 스터디 노트 책 소개에서 골라 쉬운 말로 번역 (CC BY-SA 4.0)</span>
        {busy ? <span className="muted">받는 중…</span> : <button onClick={() => { reCp(); reBp(); }}>↻ 다시</button>}
      </div>
    </div>
  );
}

/* ---------- ⑦ 성경 66권 소개 ---------- */
export function BookIntro({ data, book, compact, onGo }: { data: BibleData; book: number; compact?: boolean; onGo?: (chapter: number, verse?: number) => void }) {
  const info = BOOK_INFO[book];
  const [open, setOpen] = useState(!compact);
  if (!info) return null;
  const one = data[book].length === 1;
  const unit = book === 18 ? '편' : one ? '절' : '장';
  const [kc, kvs] = info.k.split(':');
  const kv1 = Number(kvs.split('-')[0]), kv2 = Number(kvs.split('-').pop());
  const keyText = Array.from({ length: kv2 - kv1 + 1 }, (_, i) => data[book][Number(kc) - 1]?.[kv1 - 1 + i]).filter(Boolean).join(' ');
  const parts = info.o.split('|').map(p => { const m = p.match(/^([\d-]+)\s+(.*)$/); return m ? { r: m[1], t: m[2] } : { r: '', t: p }; });

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
          <dl className="bg-grid">
            <dt>✍️ 저자</dt><dd>{info.a}</dd>
            <dt>🕰️ 시대</dt><dd>{info.d}</dd>
            <dt>📏 분량</dt><dd>{data[book].length}{book === 18 ? '편' : '장'} · {data[book].reduce((n, c) => n + c.length, 0).toLocaleString()}절</dd>
          </dl>
          <div className="bi-sec">🧭 한눈에 보는 구조</div>
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
          <div className="bi-sec">⭐ 핵심 구절 ({info.k})</div>
          <button className="bi-key" onClick={() => onGo?.(Number(kc), kv1)} disabled={!onGo}>{keyText}</button>
          <p className="desc small">저자·연대는 전통적 견해를 따랐습니다.</p>
        </div>
      )}
    </div>
  );
}
