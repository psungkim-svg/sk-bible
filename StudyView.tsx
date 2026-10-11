import { useEffect, useState } from 'react';
import { BibleData } from './bible';
import { goTo } from './store';
import {
  askLex, askTerm, askVerse, cacheGet, cacheSet, getXrefs, LexAi, NS, passageLabel, TermAi, VerseAi,
  XRef, xrefLabel, XREF_MB, xrefReady, xrefText,
} from './study';
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
          {v.map(x => <div key={x}><b className="vref">{x}</b> {ch[x - 1]}</div>)}
        </div>
        {/* 세 탭을 모두 만들어 두고 보이는 것만 바꿈 (AI는 미리 함께 요청 → 기다림이 짧아짐) */}
        <div hidden={tab !== 'explain'}><ExplainTab data={data} book={book} chapter={chapter} verses={v} onOriginal={onOriginal} /></div>
        <div hidden={tab !== 'xref'}><XrefTab data={data} book={book} chapter={chapter} verses={v} onOpen={x => { onClose(); goTo(page, { book: x.book, chapter: x.chapter, verse: x.verse }); }} /></div>
        <div hidden={tab !== 'lex'}><LexTab data={data} book={book} chapter={chapter} verses={v} /></div>
      </div>
    </div>
  );
}

/* ---------- 공통: AI 요청 + 폰에 저장 ---------- */
function useAi<T>(ns: string, key: string, max: number, run: (s: AbortSignal) => Promise<T>) {
  const [val, setVal] = useState<T | undefined>(() => cacheGet<T>(ns, key));
  const [state, setState] = useState<'idle' | 'loading' | 'error'>('idle');
  const [err, setErr] = useState('');
  const [n, setN] = useState(0);
  useEffect(() => {
    if (val && n === 0) return;
    const ctl = new AbortController();
    setState('loading');
    run(ctl.signal)
      .then(r => { setVal(r); cacheSet(ns, key, r, max); setState('idle'); })
      .catch(e => { if (!ctl.signal.aborted) { setErr((e as Error).message); setState('error'); } });
    return () => ctl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [n, key]);
  return { val, state, err, again: () => setN(x => x + 1) };
}

function AiStatus({ state, err, has, again, wait }: { state: string; err: string; has: boolean; again: () => void; wait: string }) {
  if (state === 'loading' && !has) return <div className="busy" style={{ padding: '10px 0' }}><div className="spinner small" /> {wait}</div>;
  if (state === 'error' && !has) return <div className="ai-err">⚠️ {err} <button className="link-btn" onClick={again}>다시 시도</button></div>;
  return null;
}

/* ---------- ① AI 해설 ---------- */
function ExplainTab({ data, book, chapter, verses, onOriginal }: { data: BibleData; book: number; chapter: number; verses: number[]; onOriginal: () => void }) {
  const key = `${book}:${chapter}:${verses.join(',')}`;
  const { val: ai, state, err, again } = useAi<VerseAi>(NS.verse, key, 150, s => askVerse(data, book, chapter, verses, s));
  return (
    <div className="ai-card">
      <div className="ai-head"><span className="ai-badge">AI</span> 구절 해설</div>
      <AiStatus state={state} err={err} has={!!ai} again={again} wait="말씀을 살펴보는 중… (10~20초)" />
      {ai && (
        <>
          {ai.summary && <p className="ai-intro">{ai.summary}</p>}
          {ai.context && <><div className="ai-sec">📖 앞뒤 문맥</div><p className="ai-interp">{ai.context}</p></>}
          {ai.background && <><div className="ai-sec">🏛️ 당시 배경</div><p className="ai-interp">{ai.background}</p></>}
          {ai.meaning && <><div className="ai-sec">🔎 말씀의 뜻</div><p className="ai-interp">{ai.meaning}</p></>}
          {ai.apply?.length > 0 && (
            <><div className="ai-sec">🌱 오늘 나에게</div>
              <ol className="ai-points">{ai.apply.map((a, i) => <li key={i}>{a}</li>)}</ol></>
          )}
          {ai.pray && <div className="pray">🙏 {ai.pray}</div>}
          <div className="ai-foot">
            <button onClick={onOriginal}>א Ω 원어설명</button>
            {state === 'loading' ? <span className="muted">다시 쓰는 중…</span> : <button onClick={again}>↻ 다시 해설</button>}
          </div>
        </>
      )}
      <p className="desc small">AI 해설은 참고용입니다. 성경 본문과 함께 분별하며 읽어 주세요.</p>
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
