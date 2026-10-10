import { Fragment, useMemo, useState } from 'react';
import { BibleData, parseRef, refLabel, SearchHit, SearchScope, searchWords } from '../bible';
import { BOOKS } from '../books';
import { matchSegments, searchSentence, SentenceHit } from '../sentenceSearch';
import { addRecentSearch, goTo, openTab, SearchMode, setState, useStore } from '../store';
import { PageChooser } from './BookmarksView';

const PAGE = 100;

export default function SearchView({ data }: { data: BibleData }) {
  const lastPage = useStore(s => s.lastPage);
  const pageCount = useStore(s => s.settings.pageCount);
  const recent = useStore(s => s.recentSearches);
  const mode = useStore(s => s.searchMode);
  const curBook = useStore(s => s.pages[Math.min(s.lastPage, s.settings.pageCount - 1)].book);

  const [q, setQ] = useState('');
  const [scope, setScope] = useState<'all' | 'OT' | 'NT' | 'book'>('all');
  const [bookFilter, setBookFilter] = useState<number | null>(null);
  const [target, setTarget] = useState(Math.min(lastPage, pageCount - 1));
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [sHits, setSHits] = useState<SentenceHit[] | null>(null);
  const [terms, setTerms] = useState<string[]>([]);
  const [sQuery, setSQuery] = useState('');
  const [shown, setShown] = useState(PAGE);
  const [busy, setBusy] = useState(false);

  const ref = q.trim() ? parseRef(q, data) : null;

  const setMode = (m: SearchMode) => {
    setState(() => ({ searchMode: m }));
    setHits(null); setSHits(null);
  };

  const run = (query = q, m: SearchMode = mode) => {
    const s = query.trim();
    if (!s) return;
    (document.activeElement as HTMLElement)?.blur();
    const sc: SearchScope = scope === 'book' ? curBook : scope;
    addRecentSearch(s);
    if (m === 'word') {
      setHits(searchWords(data, s, sc));
      setSHits(null);
      setTerms(s.split(/\s+/));
      setShown(PAGE);
      setBookFilter(null);
    } else {
      setBusy(true);
      setHits(null);
      // 처음 한 번은 색인을 만드느라 1초 정도 걸릴 수 있어 화면을 먼저 그린 뒤 실행
      setTimeout(() => {
        setSHits(searchSentence(data, s, sc, 30));
        setSQuery(s);
        setBusy(false);
      }, 30);
    }
  };

  const open = (book: number, chapter: number, verse?: number) => {
    goTo(target, { book, chapter, verse });
    openTab(target as 0);
  };

  const perBook = useMemo(() => {
    const m = new Map<number, number>();
    hits?.forEach(h => m.set(h.book, (m.get(h.book) ?? 0) + 1));
    return [...m.entries()];
  }, [hits]);
  const filtered = hits ? (bookFilter === null ? hits : hits.filter(h => h.book === bookFilter)) : [];
  const ot = hits?.filter(h => h.book < 39).length ?? 0;
  const nothingYet = hits === null && sHits === null && !busy;

  return (
    <div className="view">
      <header className="vhead"><h1>검색</h1></header>
      <div className="view-body">
        <div className="seg mode-seg">
          <button className={mode === 'word' ? 'on' : ''} onClick={() => setMode('word')}>🔤 단어 검색</button>
          <button className={mode === 'sentence' ? 'on' : ''} onClick={() => setMode('sentence')}>💬 문장으로 찾기</button>
        </div>

        <div className="search-box">
          {mode === 'word' ? (
            <input
              type="search"
              value={q}
              onChange={e => setQ(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && run()}
              placeholder="단어 또는 장절  예) 사랑 · 믿음 소망 · 요3:16"
              enterKeyHint="search"
            />
          ) : (
            <textarea
              value={q}
              onChange={e => setQ(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); run(); } }}
              placeholder="기억나는 대로 문장을 쓰세요&#10;예) 여호와는 내 목자 부족함 없다"
              rows={2}
              enterKeyHint="search"
            />
          )}
          <button className="primary" onClick={() => run()} disabled={busy}>{busy ? '…' : '찾기'}</button>
        </div>

        {ref && mode === 'word' && (
          <button className="ref-jump" onClick={() => open(ref.book, ref.chapter, ref.verse)}>
            📖 <b>{refLabel(ref.book, ref.chapter, ref.verse ? (ref.verseEnd ? range(ref.verse, ref.verseEnd) : [ref.verse]) : undefined)}</b> 으로 바로 이동 ›
          </button>
        )}

        <div className="toolbar">
          <div className="seg small">
            <button className={scope === 'all' ? 'on' : ''} onClick={() => setScope('all')}>전체</button>
            <button className={scope === 'OT' ? 'on' : ''} onClick={() => setScope('OT')}>구약</button>
            <button className={scope === 'NT' ? 'on' : ''} onClick={() => setScope('NT')}>신약</button>
            <button className={scope === 'book' ? 'on' : ''} onClick={() => setScope('book')}>{BOOKS[curBook].abbr}</button>
          </div>
          <PageChooser value={target} count={pageCount} onChange={setTarget} />
        </div>

        {nothingYet && recent.length > 0 && (
          <div className="recent">
            <div className="recent-head">
              <span>최근 검색</span>
              <button onClick={() => setState(() => ({ recentSearches: [] }))}>지우기</button>
            </div>
            <div className="chips">
              {recent.map(r => <button key={r} className="chip" onClick={() => { setQ(r); run(r); }}>{r}</button>)}
            </div>
          </div>
        )}

        {nothingYet && (mode === 'word' ? (
          <div className="tips">
            <b>단어 검색 도움말</b>
            <ul>
              <li>여러 단어를 띄어 쓰면 <b>모두 들어 있는</b> 구절을 찾습니다. (예: <i>믿음 소망</i>)</li>
              <li><i>요3:16</i>, <i>시23</i>, <i>요한복음 3장 16절</i>처럼 쓰면 바로 이동할 수 있습니다.</li>
              <li>정확한 단어가 기억나지 않으면 <b>💬 문장으로 찾기</b>를 써 보세요.</li>
            </ul>
          </div>
        ) : (
          <div className="tips">
            <b>문장으로 찾기 도움말</b>
            <ul>
              <li>정확하지 않아도 <b>기억나는 대로</b> 쓰면 비슷한 구절을 찾습니다.</li>
              <li>예) <i>하나님이 세상을 너무 사랑해서 아들을 보내주셨다</i> → 요 3:16</li>
              <li>예) <i>능력 주시는 분 안에서 모든 것을 할수있다</i> → 빌 4:13</li>
              <li>띄어쓰기나 말끝(~다, ~라)이 달라도 괜찮습니다. 성경에 나오는 낱말이 많이 들어갈수록 더 잘 찾습니다.</li>
              <li>인터넷 없이 폰 안에서 찾습니다.</li>
            </ul>
          </div>
        ))}

        {busy && <div className="busy"><div className="spinner small" /> 찾는 중…</div>}

        {/* ----- 문장으로 찾기 결과 ----- */}
        {sHits !== null && !busy && (
          <>
            <div className="result-summary">
              {sHits.length ? <>비슷한 구절 <b>{sHits.length}</b>개 <span className="muted">(비슷한 순서)</span></> : '비슷한 구절을 찾지 못했습니다. 낱말을 조금 더 넣어 보세요.'}
            </div>
            {sHits.map((h, i) => (
              <button key={`${h.book}:${h.chapter}:${h.verse}`} className={'hit' + (i === 0 ? ' best' : '')} onClick={() => open(h.book, h.chapter, h.verse)}>
                <div className="hit-ref">
                  {i === 0 && <span className="best-badge">가장 비슷</span>}
                  {refLabel(h.book, h.chapter, [h.verse])}
                  <span className="sim"><span style={{ width: Math.round(h.score * 100) + '%' }} /></span>
                </div>
                <div className="hit-text">
                  {matchSegments(h.text, sQuery).map((sg, j) => (sg.m ? <mark key={j}>{sg.s}</mark> : <Fragment key={j}>{sg.s}</Fragment>))}
                </div>
              </button>
            ))}
          </>
        )}

        {/* ----- 단어 검색 결과 ----- */}
        {hits !== null && (
          <>
            <div className="result-summary">
              총 <b>{hits.length.toLocaleString()}</b>절 {hits.length > 0 && <span className="muted">(구약 {ot} · 신약 {hits.length - ot})</span>}
            </div>
            {hits.length === 0 && (
              <button className="ref-jump" onClick={() => { setMode('sentence'); run(q, 'sentence'); }}>
                💬 정확히 일치하는 구절이 없습니다. <b>문장으로 찾기</b>로 비슷한 구절을 찾아볼까요? ›
              </button>
            )}
            {perBook.length > 1 && (
              <div className="chips scroll-x">
                <button className={'chip' + (bookFilter === null ? ' on' : '')} onClick={() => { setBookFilter(null); setShown(PAGE); }}>전체</button>
                {perBook.map(([b, n]) => (
                  <button key={b} className={'chip' + (bookFilter === b ? ' on' : '')} onClick={() => { setBookFilter(b); setShown(PAGE); }}>
                    {BOOKS[b].abbr} {n}
                  </button>
                ))}
              </div>
            )}
            {filtered.slice(0, shown).map(h => (
              <button key={`${h.book}:${h.chapter}:${h.verse}`} className="hit" onClick={() => open(h.book, h.chapter, h.verse)}>
                <div className="hit-ref">{refLabel(h.book, h.chapter, [h.verse])}</div>
                <div className="hit-text"><Highlight text={h.text} terms={terms} /></div>
              </button>
            ))}
            {filtered.length > shown && (
              <button className="more" onClick={() => setShown(s => s + PAGE)}>더 보기 ({(filtered.length - shown).toLocaleString()}절 남음)</button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function range(a: number, b: number) { const r: number[] = []; for (let i = a; i <= b; i++) r.push(i); return r; }

function Highlight({ text, terms }: { text: string; terms: string[] }) {
  const esc = terms.filter(Boolean).map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (!esc.length) return <>{text}</>;
  const parts = text.split(new RegExp(`(${esc.join('|')})`, 'g'));
  return <>{parts.map((p, i) => (i % 2 ? <mark key={i}>{p}</mark> : <Fragment key={i}>{p}</Fragment>))}</>;
}
