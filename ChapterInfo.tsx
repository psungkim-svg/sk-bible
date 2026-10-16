import { useEffect, useState } from 'react';
import { Chev } from './ToolIcons';
import { BibleData } from './bible';
import { BOOK_INFO } from './bookinfo';
import { BOOKS } from './books';
import { getHeads } from './headings';
import { askBackground, BgAi, cacheGet, cacheSet, NS } from './study';

/* ---------- ② 장 배경 카드 (장 주제를 누르면 펼쳐짐) ---------- */
export function BackgroundCard({ data, book, chapter, onVerse }: { data: BibleData; book: number; chapter: number; onVerse: (v: number) => void }) {
  const key = `${book}:${chapter}`;
  const [bg, setBg] = useState<BgAi | undefined>(() => cacheGet<BgAi>(NS.bg, key));
  const [state, setState] = useState<'idle' | 'loading' | 'error'>('idle');
  const [err, setErr] = useState('');
  const [n, setN] = useState(0);
  useEffect(() => {
    if (bg && n === 0) return;
    const ctl = new AbortController();
    setState('loading');
    askBackground(data, book, chapter, getHeads(book, chapter).map(h => [h.v, h.title]), ctl.signal)
      .then(r => { setBg(r); cacheSet(NS.bg, key, r, 300); setState('idle'); })
      .catch(e => { if (!ctl.signal.aborted) { setErr((e as Error).message); setState('error'); } });
    return () => ctl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [n]);

  const max = data[book][chapter - 1].length;
  return (
    <div className="bg-card">
      {state === 'loading' && !bg && <div className="busy" style={{ padding: '6px 0' }}><div className="spinner small" /> 이 장의 배경을 정리하는 중… (10~20초)</div>}
      {state === 'error' && !bg && <div className="ai-err">⚠️ {err} <button className="link-btn" onClick={() => setN(x => x + 1)}>다시 시도</button></div>}
      {bg && (
        <>
          {bg.summary && <p className="bg-sum">{bg.summary}</p>}
          <dl className="bg-grid">
            {bg.era && <><dt>🕰️ 시대</dt><dd>{bg.era}</dd></>}
            {bg.place && <><dt>📍 장소</dt><dd>{bg.place}</dd></>}
            {bg.people && <><dt>👥 인물</dt><dd>{bg.people}</dd></>}
            {bg.flow && <><dt>🔗 흐름</dt><dd>{bg.flow}</dd></>}
          </dl>
          {bg.key?.filter(k => k.v >= 1 && k.v <= max).length > 0 && (
            <div className="bg-keys">
              <div className="bg-keys-h">⭐ 핵심 구절</div>
              {bg.key.filter(k => k.v >= 1 && k.v <= max).map((k, i) => (
                <button key={i} className="bg-key" onClick={() => onVerse(k.v)}>
                  <b>{k.v}절</b> {data[book][chapter - 1][k.v - 1].slice(0, 60)}{data[book][chapter - 1][k.v - 1].length > 60 ? '…' : ''}
                  {k.why && <span className="why">{k.why}</span>}
                </button>
              ))}
            </div>
          )}
          <div className="ai-foot">
            <span className="muted small">AI · 참고용</span>
            {state === 'loading' ? <span className="muted">다시 쓰는 중…</span> : <button onClick={() => setN(x => x + 1)}>↻ 다시 만들기</button>}
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
