import { useEffect, useState } from 'react';
import { Chev } from './ToolIcons';
import { BibleData } from './bible';
import { BOOK_INFO } from './bookinfo';
import { BOOKS } from './books';
import { askBackground, BgAi, cacheGet, cacheSet, NS } from './study';
import { PtList } from './Pt';

/* ---------- ② 배경 보기 (v1.9: 틴데일 스터디 노트의 책 소개에서 고른 문장 + 번역 · 책마다 한 번) ---------- */
export function BackgroundCard({ book }: { data?: BibleData; book: number; chapter?: number; onVerse?: (v: number) => void }) {
  const key = `${book}`;
  const [bg, setBg] = useState<BgAi | undefined>(() => cacheGet<BgAi>(NS.bg, key));
  const [state, setState] = useState<'idle' | 'loading' | 'error'>('idle');
  const [err, setErr] = useState('');
  const [n, setN] = useState(0);
  useEffect(() => {
    if (bg && n === 0) return;
    const ctl = new AbortController();
    setState('loading');
    askBackground(book, ctl.signal)
      .then(r => { setBg(r); if (r.pts.length || r.none) cacheSet(NS.bg, key, r); setState('idle'); })
      .catch(e => { if (!ctl.signal.aborted) { setErr((e as Error).message); setState('error'); } });
    return () => ctl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [n, book]);

  return (
    <div className="bg-card">
      {state === 'loading' && !bg && <div className="busy" style={{ padding: '6px 0' }}><div className="spinner small" /> {BOOKS[book].name}의 배경을 찾아 번역하는 중… (10~30초)</div>}
      {state === 'error' && !bg && <div className="ai-err">⚠️ {err} <button className="link-btn" onClick={() => setN(x => x + 1)}>다시 시도</button></div>}
      {bg && (
        <>
          <div className="bg-keys-h">📜 {BOOKS[book].name}의 배경</div>
          {bg.pts.length > 0 ? <PtList pts={bg.pts} /> : <p className="desc">이 책의 배경 자료를 찾지 못했습니다.</p>}
          <div className="ai-foot">
            <span className="muted small">틴데일 스터디 노트 (CC BY-SA 4.0) · 원문 번역</span>
            {state === 'loading' ? <span className="muted">다시 받는 중…</span> : <button onClick={() => setN(x => x + 1)}>↻ 다시</button>}
          </div>
        </>
      )}
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
