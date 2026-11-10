import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { BibleData, buildCopyText, parseRef, refLabel, SearchHit, SearchScope, searchWords } from './bible';
import { AiAnswer, askAi } from './ai';
import ToolIcons from './ToolIcons';
import { copyText, toast } from './utils';
import { BOOKS } from './books';
import { matchSegments, searchSentence, SentenceHit } from './sentenceSearch';
import { addRecentSearch, goTo, openTab, setState, useStore } from './store';
import { PageChooser } from './BookmarksView';
import { findTopics, spanLabel, spanVerses, TopicHit } from './topics';
import { cacheGet, cacheSet, NS } from './study';
import ChapterStudy from './ChapterStudy';

/* ================================================================
   🔎 검색 (v1.8: 검색창 하나)
   - 장절(요3:16) → 바로 이동
   - 주제(팔복 · 주기도문 · 탕자 …) → 주제 사전 (인터넷 없이, 음성 오타도)
   - 낱말 → 단어 검색
   - 긴 문장이거나 결과가 없으면 → 비슷한 구절 + AI (한 번 받은 AI 답은 저장해 두고 바로)
   ================================================================ */
const qkey = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();

const PAGE = 100;

export default function SearchView({ data, active }: { data: BibleData; active: boolean }) {
  const lastPage = useStore(s => s.lastPage);
  const pageCount = useStore(s => s.settings.pageCount);
  const recent = useStore(s => s.recentSearches);
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
  const settings = useStore(s => s.settings);
  const [ai, setAi] = useState<{ stage?: string; answer?: AiAnswer; error?: string; saved?: boolean } | null>(null);
  const [topics, setTopics] = useState<TopicHit[]>([]);
  const [openTopic, setOpenTopic] = useState<string | null>(null);
  const [deep, setDeep] = useState<{ book: number; chapter: number } | null>(null);
  const [runRef, setRunRef] = useState<ReturnType<typeof parseRef>>(null);
  const aiCtl = useRef<AbortController | null>(null);
  useEffect(() => { if (active) setTarget(Math.min(lastPage, pageCount - 1)); }, [active, lastPage, pageCount]);

  const startAi = (s: string, fresh = false) => {
    aiCtl.current?.abort();
    if (!settings.aiSearch) { setAi(null); return; }
    const saved = !fresh && cacheGet<AiAnswer>(NS.find, qkey(s));
    if (saved) { setAi({ answer: saved, saved: true }); return; }
    if (!navigator.onLine) { setAi({ error: '인터넷에 연결되어 있지 않아 AI 설명은 건너뜁니다. 아래는 폰 안에서 찾은 결과입니다.' }); return; }
    const ctl = new AbortController();
    aiCtl.current = ctl;
    setAi({ stage: '질문을 이해하는 중…' });
    askAi(data, s, stage => { if (!ctl.signal.aborted) setAi({ stage }); }, ctl.signal)
      .then(answer => { if (!ctl.signal.aborted) { setAi({ answer }); if (answer.matches.length) cacheSet(NS.find, qkey(s), answer); } })
      .catch(e => { if (!ctl.signal.aborted) setAi({ error: (e as Error).message || 'AI 답변을 받지 못했습니다' }); });
  };
  const copyOpts = { bookStyle: settings.copyBookStyle, refPosition: settings.copyRefPosition, verseNumbers: settings.copyVerseNumbers };
  const copyVerse = async (b: number, c: number, v: number) => {
    toast((await copyText(buildCopyText(data, b, c, [v], copyOpts))) ? '복사했습니다 📋' : '복사하지 못했습니다');
  };

  /** 비슷한 구절(폰 안) + AI */
  const runSentence = (s: string, sc: SearchScope) => {
    startAi(s);
    setBusy(true);
    // 처음 한 번은 색인을 만드느라 1초 정도 걸릴 수 있어 화면을 먼저 그린 뒤 실행
    setTimeout(() => {
      setSHits(searchSentence(data, s, sc, 30));
      setSQuery(s);
      setBusy(false);
    }, 30);
  };

  const run = (query = q) => {
    const s = query.trim();
    if (!s) return;
    (document.activeElement as HTMLElement)?.blur();
    const sc: SearchScope = scope === 'book' ? curBook : scope;
    addRecentSearch(s);
    aiCtl.current?.abort(); setAi(null); setSHits(null); setOpenTopic(null);
    const r = parseRef(s, data);
    setRunRef(r);
    const t = findTopics(s);
    setTopics(t);
    const strong = t.some(h => h.score >= 80);
    const hasNum = /\d/.test(s);
    const words = r && hasNum ? [] : searchWords(data, s, sc);
    setHits(r && hasNum ? null : words);
    setTerms(s.split(/\s+/));
    setShown(PAGE);
    setBookFilter(null);
    if (r && hasNum) return;
    // 오타일지도 모르는 주제 하나만 비슷하면 그것을 펼쳐 보여 줌
    if (!strong && words.length < 5 && t.length) setOpenTopic(t[0].topic.name);
    const long = s.split(/\s+/).length >= 3 || s.replace(/\s/g, '').length >= 10;
    if (r || (strong && !long)) return;
    if (!words.length || (long && words.length < 5)) runSentence(s, sc);
  };

  const sentenceNow = () => {
    const s = q.trim();
    if (!s) return;
    runSentence(s, scope === 'book' ? curBook : scope);
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
  const nothingYet = hits === null && sHits === null && !busy && !ai && !topics.length && !runRef;
  const bigTopics = topics.filter(h => h.score >= 80 || h.topic.name === openTopic);
  const smallTopics = topics.filter(h => !bigTopics.includes(h));
  const copyTopic = async (h: TopicHit) => {
    const parts = h.topic.spans.flatMap(sp => {
      const out: string[] = [];
      for (let c = sp.c1; c <= sp.c2; c++) {
        const vs = spanVerses(data, { ...sp, c1: c, c2: c, v1: c === sp.c1 ? sp.v1 : 1, v2: c === sp.c2 ? sp.v2 : 999 }).map(x => x.v);
        if (vs.length) out.push(buildCopyText(data, sp.book, c, vs, copyOpts));
      }
      return out;
    });
    toast((await copyText(parts.join('\n\n'))) ? '복사했습니다 📋' : '복사하지 못했습니다');
  };

  return (
    <div className={'view' + (active ? '' : ' inactive')}>
      <header className="vhead"><h1>검색</h1><ToolIcons /></header>
      <div className="view-body">
        <div className="search-box">
          <input
            type="search"
            value={q}
            onChange={e => setQ(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && run()}
            placeholder="낱말 · 주제 · 장절 · 문장 무엇이든"
            enterKeyHint="search"
          />
          <button className="primary" onClick={() => run()} disabled={busy}>{busy ? '…' : '찾기'}</button>
        </div>

        {runRef && (
          <button className="ref-jump" onClick={() => open(runRef.book, runRef.chapter, runRef.verse)}>
            📖 <b>{refLabel(runRef.book, runRef.chapter, runRef.verse ? (runRef.verseEnd ? range(runRef.verse, runRef.verseEnd) : [runRef.verse]) : undefined)}</b> 으로 바로 이동 ›
          </button>
        )}

        {/* ----- 📖 주제 사전 ----- */}
        {bigTopics.map(h => (
          <TopicCard key={h.topic.name} h={h} data={data} guess={h.score < 65}
            onOpen={(b, c, v) => open(b, c, v)} onDeep={(b, c) => setDeep({ book: b, chapter: c })} onCopy={() => copyTopic(h)} />
        ))}
        {smallTopics.length > 0 && (
          <div className="topic-chips">
            <span className="muted">📖 관련 주제</span>
            {smallTopics.map(h => <button key={h.topic.name} className="chip" onClick={() => setOpenTopic(h.topic.name)}>{h.topic.name}</button>)}
          </div>
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

        {nothingYet && (
          <div className="tips">
            <b>검색창 하나로 무엇이든</b>
            <ul>
              <li><b>낱말</b>: <i>사랑</i>, <i>믿음 소망</i> (띄어 쓰면 모두 들어 있는 구절)</li>
              <li><b>장절</b>: <i>요3:16</i>, <i>시23</i>, <i>요한복음 3장 16절</i> → 바로 이동</li>
              <li><b>주제</b>: <i>팔복</i>, <i>주기도문</i>, <i>탕자</i>, <i>전신갑주</i>, <i>오병이어</i> … 약 280가지 (인터넷 없이 바로, 음성 입력 오타도 괜찮습니다)</li>
              <li><b>기억나는 문장</b>: <i>능력 주시는 분 안에서 모든 것을 할 수 있다</i> → 비슷한 구절을 찾고, 인터넷이 되면 AI가 설명합니다. 한 번 받은 AI 답은 저장되어 다음엔 바로 나옵니다.</li>
            </ul>
          </div>
        )}

        {busy && <div className="busy"><div className="spinner small" /> 찾는 중…</div>}

        {/* ----- AI 설명 ----- */}
        {ai && (
          <div className="ai-card">
            <div className="ai-head"><span className="ai-badge">AI</span> 구절 찾기</div>
            {ai.stage && <div className="busy" style={{ padding: '6px 0' }}><div className="spinner small" /> {ai.stage}</div>}
            {ai.error && <div className="ai-err">⚠️ {ai.error}</div>}
            {ai.answer && (() => {
              const a = ai.answer;
              return (
                <>
                  {a.corrected && a.corrected !== sQuery && <div className="ai-corrected">이렇게 이해했습니다: “{a.corrected}”</div>}
                  {a.intro && <p className="ai-intro">{a.intro}</p>}
                  {a.interpretation && <p className="ai-interp">{a.interpretation}</p>}
                  {a.matches.length === 0 && <p className="desc">질문에 맞는 구절을 찾지 못했습니다. 다른 말로 다시 물어 보세요.</p>}
                  {a.matches.length > 0 && (
                    <>
                      <div className="ai-sec">📖 해당 성경 구절 (개역개정)</div>
                      {a.matches.map(v => (
                        <div key={`${v.book}:${v.chapter}:${v.verse}`} className="ai-verse">
                          <div className="ref">{refLabel(v.book, v.chapter, [v.verse])}</div>
                          <div className="txt">{v.text}</div>
                          <div className="acts">
                            <button onClick={() => open(v.book, v.chapter, v.verse)}>📖 열기</button>
                            <button onClick={() => copyVerse(v.book, v.chapter, v.verse)}>📋 복사</button>
                          </div>
                        </div>
                      ))}
                    </>
                  )}
                  {a.points.length > 0 && (
                    <>
                      <div className="ai-sec">💡 구절의 핵심 의미</div>
                      <ol className="ai-points">
                        {a.points.map((p, i) => <li key={i}>{p.title && <b>{p.title}: </b>}{p.body}</li>)}
                      </ol>
                    </>
                  )}
                  <div className="ai-foot">
                    {ai.saved && <span className="muted">저장된 답 · </span>}
                    <button onClick={() => startAi(sQuery || q, true)}>↻ 다시 묻기</button>
                  </div>
                </>
              );
            })()}
          </div>
        )}

        {/* ----- 문장으로 찾기 결과 ----- */}
        {sHits !== null && !busy && (
          <>
            <div className="result-summary">
              {sHits.length ? <>{ai && <span className="muted">폰 안 검색 · </span>}글자가 비슷한 구절 <b>{sHits.length}</b>개 <span className="muted">(비슷한 순서)</span></> : '비슷한 구절을 찾지 못했습니다. 낱말을 조금 더 넣어 보세요.'}
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
        {hits !== null && (hits.length > 0 || (sHits === null && !busy && !bigTopics.length)) && (
          <>
            <div className="result-summary">
              총 <b>{hits.length.toLocaleString()}</b>절 {hits.length > 0 && <span className="muted">(구약 {ot} · 신약 {hits.length - ot})</span>}
            </div>
            {hits.length > 0 && sHits === null && !busy && (
              <button className="ref-jump sent-btn" onClick={sentenceNow}>
                💬 원하는 구절이 없나요? <b>비슷한 구절 · AI로 찾기</b> ›
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
      {deep && <ChapterStudy data={data} book={deep.book} chapter={deep.chapter} page={target} onClose={() => setDeep(null)} onAfterGo={() => openTab(target as 0)} />}
    </div>
  );
}

/** 📖 주제 카드: 범위 · 함께 볼 곳 · 본문 · [본문으로 가기] [📘 장 깊은 해설] [📋 복사] */
function TopicCard({ h, data, guess, onOpen, onDeep, onCopy }: {
  h: TopicHit; data: BibleData; guess: boolean;
  onOpen: (b: number, c: number, v: number) => void; onDeep: (b: number, c: number) => void; onCopy: () => void;
}) {
  const [all, setAll] = useState(false);
  const t = h.topic;
  const groups = t.spans.map(sp => ({ sp, vs: spanVerses(data, sp) }));
  const total = groups.reduce((n, g) => n + g.vs.length, 0);
  const LIMIT = 12;
  let left = all ? Infinity : LIMIT;
  const first = t.spans[0];
  return (
    <div className="topic-card">
      {guess && <div className="tc-guess">혹시 이것을 찾으셨나요?</div>}
      <div className="tc-head">
        <span className="tc-name">📖 {t.name}</span>
        <span className="tc-range">{t.spans.map(sp => spanLabel(sp, data)).join(' · ')}</span>
      </div>
      {h.via && <div className="tc-via">“{h.via}”</div>}
      {t.also.length > 0 && (
        <div className="tc-also">함께 보기 {t.also.map((sp, i) => (
          <button key={i} onClick={() => onOpen(sp.book, sp.c1, sp.v1)}>{spanLabel(sp, data)}</button>
        ))}</div>
      )}
      <div className="tc-verses">
        {groups.map((g, gi) => {
          if (left <= 0) return null;
          const show = g.vs.slice(0, left);
          left -= show.length;
          return (
            <div key={gi}>
              {groups.length > 1 && <div className="tc-sub">{spanLabel(g.sp, data)}</div>}
              {show.map(x => (
                <p key={x.c + ':' + x.v} onClick={() => onOpen(g.sp.book, x.c, x.v)}>
                  <b>{g.sp.c1 !== g.sp.c2 ? `${x.c}:${x.v}` : x.v}</b> {x.t}
                </p>
              ))}
            </div>
          );
        })}
      </div>
      {total > LIMIT && <button className="tc-more" onClick={() => setAll(a => !a)}>{all ? '접기' : `전체 ${total}절 보기`}</button>}
      <div className="tc-acts">
        <button className="primary" onClick={() => onOpen(first.book, first.c1, first.v1)}>본문으로 가기</button>
        <button onClick={() => onDeep(first.book, first.c1)}>📘 장 깊은 해설</button>
        <button onClick={onCopy}>📋 복사</button>
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
