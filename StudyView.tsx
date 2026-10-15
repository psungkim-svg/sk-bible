import { useEffect, useState } from 'react';
import { BibleData } from './bible';
import { goTo } from './store';
import { parseRef } from './bible';
import {
  askLex, askTerm, askVerse, askVerseMore, cacheGet, cacheSet, COMMENTARY_CREDIT, getSources, getXrefs, LexAi, NS, passageLabel, Source, TermAi, VerseAi,
  XRef, xrefLabel, XREF_MB, xrefReady, xrefText,
} from './study';
import { getTranslation, TRANSLATIONS } from './translations';
import { useBackClose } from './utils';

type TabId = 'explain' | 'xref' | 'lex';
interface Props {
  data: BibleData; book: number; chapter: number; verses: number[]; page: number;
  onClose: () => void; onOriginal: () => void;
}

/** 절을 고르고 "해설"을 누르면 나오는 화면: AI 해설 · 관련 구절 · 낱말과 인물 */
export default function StudyView({ data, book, chapter, verses, page, onClose, onOriginal }: Props) {
  const v = [...verses].sort((a, b) => a - b).slice(0, 12);
  const [tab, setTab] = useState<TabId>('explain');
  useBackClose(true, onClose);
  const label = passageLabel(book, chapter, v);
  const ch = data[book][chapter - 1];

  return (
    <div className="overlay study">
      <div className="ov-head">
        <button className="icon-btn" onClick={onClose} aria-label="뒤로">
          <svg viewBox="0 0 24 24" width="22" height="22"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" /></svg>
        </button>
        <div className="ov-title">해설 · {label}</div>
        <button className="icon-btn" onClick={onClose} aria-label="닫기">✕</button>
      </div>
      <div className="seg study-tabs">
        <button className={tab === 'explain' ? 'on' : ''} onClick={() => setTab('explain')}>💡 해설</button>
        <button className={tab === 'xref' ? 'on' : ''} onClick={() => setTab('xref')}>🔗 관련 구절</button>
        <button className={tab === 'lex' ? 'on' : ''} onClick={() => setTab('lex')}>📚 낱말·인물</button>
      </div>
      <div className="study-body">
        <div className="orig-kor">
          <div className="tr-name">개역개정</div>
          {v.map(x => <div key={x}><b className="vref">{x}</b> {ch[x - 1]}</div>)}
          <TrCompare book={book} chapter={chapter} verses={v} />
        </div>
        {/* 세 탭을 모두 만들어 두고 보이는 것만 바꿈 (AI는 미리 함께 요청 → 기다림이 짧아짐) */}
        <div hidden={tab !== 'explain'}><ExplainTab data={data} book={book} chapter={chapter} verses={v} onOriginal={onOriginal}
          onGo={r => { onClose(); goTo(page, { book: r.book, chapter: r.chapter, verse: r.verse ?? 1 }); }} /></div>
        <div hidden={tab !== 'xref'}><XrefTab data={data} book={book} chapter={chapter} verses={v} onOpen={x => { onClose(); goTo(page, { book: x.book, chapter: x.chapter, verse: x.verse }); }} /></div>
        <div hidden={tab !== 'lex'}><LexTab data={data} book={book} chapter={chapter} verses={v} /></div>
      </div>
    </div>
  );
}

/* ---------- 번역 비교: 새번역 · 쉬운성경 (인터넷 될 때만) ---------- */
function TrCompare({ book, chapter, verses }: { book: number; chapter: number; verses: number[] }) {
  const [rows, setRows] = useState<Record<string, string[] | null>>({});
  const [err, setErr] = useState('');
  useEffect(() => {
    let alive = true;
    setRows({}); setErr('');
    if (!navigator.onLine) { setRows(Object.fromEntries(TRANSLATIONS.map(t => [t.id, null]))); setErr('인터넷이 연결되면 새번역 · 쉬운성경이 함께 보입니다'); return; }
    TRANSLATIONS.forEach(t => {
      getTranslation(t.id, book, chapter, verses)
        .then(r => { if (alive) setRows(o => ({ ...o, [t.id]: r })); })
        .catch(() => { if (alive) { setRows(o => ({ ...o, [t.id]: null })); setErr('인터넷이 연결되면 새번역 · 쉬운성경이 함께 보입니다'); } });
    });
    return () => { alive = false; };
  }, [book, chapter, verses.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <>
      {TRANSLATIONS.map(t => {
        const r = rows[t.id];
        if (r === null) return null;
        return (
          <div key={t.id} className="tr-block">
            <div className="tr-name">{t.name}</div>
            {r === undefined
              ? <div className="muted">불러오는 중…</div>
              : verses.map((x, i) => r[i] ? <div key={x}><b className="vref">{x}</b> {r[i]}</div> : null)}
          </div>
        );
      })}
      {err && <div className="muted tr-err">{err}</div>}
    </>
  );
}

/* ---------- 공통: AI 요청 + 폰에 저장 ---------- */
function useAi<T>(ns: string, key: string, max: number, run: (s: AbortSignal, phase: (p: string) => void) => Promise<T>) {
  const [val, setVal] = useState<T | undefined>(() => cacheGet<T>(ns, key));
  const [state, setState] = useState<'idle' | 'loading' | 'error'>('idle');
  const [err, setErr] = useState('');
  const [n, setN] = useState(0);
  const [phase, setPhase] = useState('');
  useEffect(() => {
    if (val && n === 0) return;
    const ctl = new AbortController();
    setState('loading'); setPhase('');
    run(ctl.signal, p => { if (!ctl.signal.aborted) setPhase(p); })
      .then(r => { setVal(r); cacheSet(ns, key, r, max); setState('idle'); })
      .catch(e => { if (!ctl.signal.aborted) { setErr((e as Error).message); setState('error'); } });
    return () => ctl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [n, key]);
  const update = (v: T) => { setVal(v); cacheSet(ns, key, v, max); };
  return { val, state, err, phase, update, again: () => setN(x => x + 1) };
}

function AiStatus({ state, err, has, again, wait }: { state: string; err: string; has: boolean; again: () => void; wait: string }) {
  if (state === 'loading' && !has) return <div className="busy" style={{ padding: '10px 0' }}><div className="spinner small" /> {wait}</div>;
  if (state === 'error' && !has) return <div className="ai-err">⚠️ {err} <button className="link-btn" onClick={again}>다시 시도</button></div>;
  return null;
}

/* ---------- ① 깊은 해설 (고전 주석 근거 · 궁금증 · 견해 비교 · 성경 연결) ---------- */
type Go = (r: { book: number; chapter: number; verse?: number }) => void;

function RefLink({ text, data, onGo }: { text: string; data: BibleData; onGo: Go }) {
  const r = parseRef(text.replace(/\s*\(.*\)\s*$/, ''), data);
  return r ? <button className="ref-link" onClick={() => onGo(r)}>{text}</button> : <b className="ref-plain">{text}</b>;
}

function ExplainTab({ data, book, chapter, verses, onOriginal, onGo }: { data: BibleData; book: number; chapter: number; verses: number[]; onOriginal: () => void; onGo: Go }) {
  const key = `${book}:${chapter}:${verses.join(',')}`;
  const { val: ai, state, err, phase, update, again } = useAi<VerseAi>(NS.verse, key, 80, (s, ph) => askVerse(data, book, chapter, verses, s, ph));
  return (
    <>
      <div className="ai-card deep">
        <div className="ai-head"><span className="ai-badge">AI</span> 깊은 해설</div>
        <AiStatus state={state} err={err} has={!!ai} again={again} wait={phase || '준비 중…'} />
        {ai && (
          <>
            {ai.summary && <p className="ai-intro">{ai.summary}</p>}
            {ai.background && <><div className="ai-sec">🏛️ 꼭 알아야 할 배경</div><p className="ai-interp">{ai.background}</p></>}

            {ai.commentators?.length > 0 && (
              <><div className="ai-sec">📚 주석가들은 이렇게 봅니다</div>
                {ai.commentators.map((c, i) => (
                  <div key={i} className="deep-box"><div className="deep-who">{c.who}</div><div>{c.point}</div></div>
                ))}</>
            )}

            {ai.questions?.length > 0 && (
              <><div className="ai-sec">❓ 궁금증 풀이</div>
                {ai.questions.map((x, i) => (
                  <div key={i} className="deep-qa"><div className="deep-q">Q. {x.q}</div><div className="deep-a">{x.a}</div></div>
                ))}</>
            )}

            {ai.debates?.length > 0 && (
              <><div className="ai-sec">⚖️ 해석이 갈리는 곳</div>
                {ai.debates.map((d, i) => (
                  <div key={i} className="deep-box">
                    <div className="deep-issue">{d.issue}</div>
                    {d.views.map((v, j) => (
                      <div key={j} className="deep-view">
                        <div><b>{String.fromCharCode(65 + j)}.</b> {v.view}{v.who && <span className="deep-holder"> — {v.who}</span>}</div>
                        {v.why && <div className="deep-why">근거: {v.why}</div>}
                      </div>
                    ))}
                  </div>
                ))}</>
            )}

            {ai.bookflow && <><div className="ai-sec">🧭 책 전체 흐름 속에서</div><p className="ai-interp">{ai.bookflow}</p></>}

            {ai.modern && ai.modern.length > 0 && (
              <><div className="ai-sec">🎓 현대 학자들의 견해 <span className="ai-note">AI가 기억으로 정리 · 참고용</span></div>
                {ai.modern.map((c, i) => (
                  <div key={i} className="deep-box modern"><div className="deep-who">{c.who}</div><div>{c.point}</div></div>
                ))}</>
            )}

            {ai.links?.length > 0 && (
              <><div className="ai-sec">🔗 성경 연결</div>
                {ai.links.map((l, i) => (
                  <div key={i} className="deep-link"><RefLink text={l.ref} data={data} onGo={onGo} /> <span>{l.why}</span></div>
                ))}</>
            )}

            <div className="ai-foot">
              <button onClick={onOriginal}>א Ω 원어설명</button>
              {state === 'loading' ? <span className="muted">{phase || '다시 쓰는 중…'}</span> : <button onClick={again}>↻ 다시 해설</button>}
            </div>
          </>
        )}
      </div>

      {ai && <AskMore data={data} book={book} chapter={chapter} verses={verses} ai={ai} update={update} onGo={onGo} />}
      {ai && <SourceView book={book} chapter={chapter} verses={verses} />}

      <p className="desc small">AI 해설은 참고용입니다. 성경 본문과 함께 분별하며 읽어 주세요.{ai?.sourceCount === 0 ? ' (이번 해설은 주석 자료를 받지 못해 AI 지식으로만 썼습니다)' : ''}<br />{COMMENTARY_CREDIT}</p>
    </>
  );
}

/** 💬 이 구절에 대해 더 묻기 (묻고 답한 것은 해설과 함께 폰에 저장) */
function AskMore({ data, book, chapter, verses, ai, update, onGo }: { data: BibleData; book: number; chapter: number; verses: number[]; ai: VerseAi; update: (v: VerseAi) => void; onGo: Go }) {
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const send = async () => {
    const question = q.trim();
    if (!question || busy) return;
    setBusy(true); setErr('');
    try {
      const r = await askVerseMore(data, book, chapter, verses, question, ai);
      update({ ...ai, asks: [...(ai.asks || []), { q: question, a: r.answer, refs: r.refs }] });
      setQ('');
    } catch (e) { setErr((e as Error).message); }
    setBusy(false);
  };
  return (
    <div className="ai-card">
      <div className="ai-head"><span className="ai-badge">AI</span> 이 구절에 대해 더 묻기</div>
      {(ai.asks || []).map((x, i) => (
        <div key={i} className="deep-qa">
          <div className="deep-q">Q. {x.q}</div>
          <div className="deep-a">{x.a}</div>
          {x.refs && x.refs.length > 0 && <div className="deep-refs">📖 {x.refs.map((r, j) => <RefLink key={j} text={r} data={data} onGo={onGo} />)}</div>}
        </div>
      ))}
      <div className="term-ask ask-more">
        <textarea value={q} onChange={e => setQ(e.target.value)} rows={3} placeholder="궁금한 점을 적어 주세요 (예: 여기서 '세상'은 누구를 말하나요?)" />
        <button className="primary" disabled={!q.trim() || busy} onClick={send}>{busy ? '…' : '묻기'}</button>
      </div>
      {busy && <div className="busy" style={{ padding: '8px 0' }}><div className="spinner small" /> 주석을 살펴보며 답을 쓰는 중… (20~40초)</div>}
      {err && <div className="ai-err">⚠️ {err}</div>}
    </div>
  );
}

/** 📜 주석 원문 보기 (영어) — 눌렀을 때만 받아 옴 */
function SourceView({ book, chapter, verses }: { book: number; chapter: number; verses: number[] }) {
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<Source[] | null>(null);
  useEffect(() => {
    if (!open || list) return;
    getSources(book, chapter, verses).then(setList).catch(() => setList([]));
  }, [open, list, book, chapter, verses]);
  return (
    <div className="ai-card src-card">
      <button className="src-toggle" onClick={() => setOpen(o => !o)}>📜 주석 원문 보기 (영어 발췌) {open ? '▲' : '▼'}</button>
      {open && !list && <div className="busy" style={{ padding: '8px 0' }}><div className="spinner small" /> 받는 중…</div>}
      {open && list && list.length === 0 && <div className="ai-err">주석 자료를 받지 못했습니다.</div>}
      {open && list?.map((s, i) => (
        <div key={i} className="deep-box src"><div className="deep-who">{s.who}</div><div className="src-text">{s.text}</div></div>
      ))}
    </div>
  );
}

/* ---------- ③ 관련 구절 ---------- */
function XrefTab({ data, book, chapter, verses, onOpen }: { data: BibleData; book: number; chapter: number; verses: number[]; onOpen: (x: XRef) => void }) {
  const [cur, setCur] = useState(verses[0]);
  const [list, setList] = useState<XRef[] | null>(null);
  const [err, setErr] = useState('');
  const [open, setOpen] = useState<number | null>(null);
  useEffect(() => {
    let alive = true;
    setList(null); setErr(''); setOpen(null);
    getXrefs(book, chapter, cur)
      .then(l => { if (alive) setList(l); })
      .catch(() => { if (alive) setErr(navigator.onLine ? '관련 구절 자료를 받지 못했습니다. 잠시 뒤 다시 열어 주세요.' : '처음 한 번은 인터넷이 필요합니다. (받은 뒤에는 인터넷 없이도 보입니다)'); });
    return () => { alive = false; };
  }, [book, chapter, cur]);

  return (
    <div>
      {verses.length > 1 && (
        <div className="chips scroll-x">
          {verses.map(x => <button key={x} className={'chip' + (x === cur ? ' on' : '')} onClick={() => setCur(x)}>{chapter}:{x}</button>)}
        </div>
      )}
      {!list && !err && <div className="busy"><div className="spinner small" /> 관련 구절을 찾는 중… {!xrefReady() && <span className="muted">(처음 한 번 약 {XREF_MB}MB)</span>}</div>}
      {err && <div className="ai-err">⚠️ {err}</div>}
      {list && list.length === 0 && <div className="ai-err">이 절에는 등록된 관련 구절이 없습니다.</div>}
      {list && list.length > 0 && <div className="local-head">{chapter}:{cur}절과 연결된 말씀 {list.length}곳 (많이 연결된 순서)</div>}
      {list?.map((x, i) => (
        <div key={i} className="ai-verse xref" onClick={() => setOpen(open === i ? null : i)}>
          <div className="ref">{xrefLabel(x)}</div>
          <div className={'txt' + (open === i ? '' : ' clamp')}>{xrefText(data, x)}</div>
          {open === i && (
            <div className="acts">
              <button onClick={e => { e.stopPropagation(); onOpen(x); }}>이 말씀으로 가기 →</button>
            </div>
          )}
        </div>
      ))}
      <p className="desc small">관련 구절 자료: OpenBible.info 교차참조 (CC BY). 구절을 누르면 펼쳐지고, "이 말씀으로 가기"로 이동합니다. 뒤로 버튼을 누르면 다시 돌아옵니다.</p>
    </div>
  );
}

/* ---------- ④ 낱말 풀이 + ⑤ 인물·지명 ---------- */
function LexTab({ data, book, chapter, verses }: { data: BibleData; book: number; chapter: number; verses: number[] }) {
  const key = `${book}:${chapter}:${verses.join(',')}`;
  const { val: ai, state, err, again } = useAi<LexAi>(NS.lex, key, 150, s => askLex(data, book, chapter, verses, s));
  const [q, setQ] = useState('');
  const [term, setTerm] = useState<string | null>(null);
  return (
    <div>
      <div className="ai-card">
        <div className="ai-head"><span className="ai-badge">AI</span> 어려운 낱말 풀이</div>
        <AiStatus state={state} err={err} has={!!ai} again={again} wait="낱말과 이름을 찾는 중… (10~20초)" />
        {ai && ai.words.length === 0 && <div className="ai-err">풀이가 필요한 어려운 낱말이 없습니다.</div>}
        {ai?.words.map((w, i) => (
          <div key={i} className="lex-row">
            <b className="lex-w">{w.w}</b> <span className="lex-arrow">→</span> <span>{w.mean}</span>
            {w.note && <div className="lex-note">{w.note}</div>}
          </div>
        ))}
      </div>

      {ai && ai.names.length > 0 && (
        <div className="ai-card">
          <div className="ai-head"><span className="ai-badge">AI</span> 인물 · 지명</div>
          {ai.names.map((n, i) => (
            <div key={i} className="name-card">
              <div className="name-top"><b>{n.name}</b> <span className="kind">{n.kind}</span></div>
              <div className="name-desc">{n.desc}</div>
              {n.refs && n.refs.length > 0 && <div className="name-refs">📖 {n.refs.join(' · ')}</div>}
            </div>
          ))}
        </div>
      )}
      {ai && state !== 'loading' && <div className="ai-foot" style={{ marginTop: -8, marginBottom: 12 }}><button onClick={again}>↻ 다시 찾기</button></div>}

      <div className="ai-card">
        <div className="ai-head"><span className="ai-badge">AI</span> 직접 물어보기</div>
        <div className="term-ask">
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="낱말·인물·지명 (예: 궁창, 아브라함, 가버나움)"
            onKeyDown={e => { if (e.key === 'Enter' && q.trim()) setTerm(q.trim()); }} enterKeyHint="search" />
          <button className="primary" disabled={!q.trim()} onClick={() => setTerm(q.trim())}>찾기</button>
        </div>
        {term && <TermAnswer key={term} term={term} where={passageLabel(book, chapter, verses)} />}
      </div>
    </div>
  );
}

function TermAnswer({ term, where }: { term: string; where: string }) {
  const { val, state, err, again } = useAi<TermAi>(NS.term, term, 100, s => askTerm(term, where, s));
  return (
    <div className="name-card" style={{ marginTop: 10 }}>
      <AiStatus state={state} err={err} has={!!val} again={again} wait={`"${term}" 찾는 중…`} />
      {val && (
        <>
          <div className="name-top"><b>{val.title || term}</b> {val.kind && <span className="kind">{val.kind}</span>}</div>
          <div className="name-desc">{val.desc}</div>
          {val.refs && val.refs.length > 0 && <div className="name-refs">📖 {val.refs.join(' · ')}</div>}
        </>
      )}
    </div>
  );
}
