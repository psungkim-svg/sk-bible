import { useEffect, useState } from 'react';
import { BibleData } from './bible';
import { goTo } from './store';
import { parseRef } from './bible';
import {
  askLex, askTerm, runDeepVerse, type DeepProgress, askVerseExtra, type VerseExtra, askVerseMore, cacheGet, cacheSet, COMMENTARY_CREDIT, getSources, getXrefs, LexAi, NS, passageLabel, Source, TermAi, VerseAi,
  XRef, xrefLabel, XREF_MB, xrefReady, xrefText,
} from './study';
import { getTranslation, TRANSLATIONS } from './translations';
import { useBackClose } from './utils';
import { Chev } from './ToolIcons';

type TabId = 'explain' | 'xref' | 'lex';
interface Props {
  data: BibleData; book: number; chapter: number; verses: number[]; page: number;
  onClose: () => void; initialTab?: TabId;
}

/** 절을 고르고 "해설"을 누르면 나오는 화면: AI 해설 · 관련 구절 · 낱말과 인물 */
export default function StudyView({ data, book, chapter, verses, page, onClose, initialTab }: Props) {
  const v = [...verses].sort((a, b) => a - b).slice(0, 12);
  const [tab, setTab] = useState<TabId>(initialTab || 'explain');
  // 낱말·인물은 그 탭을 처음 열 때 요청 (해설 AI와 자리 다툼을 줄여 해설이 빨라짐)
  const [seen, setSeen] = useState<Record<string, boolean>>({ [initialTab || 'explain']: true });
  useEffect(() => { setSeen(o => (o[tab] ? o : { ...o, [tab]: true })); }, [tab]);
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
        {/* 번역 비교(새번역 · BSB)는 해설 탭에서만, 관련 구절 · 낱말 탭은 개역개정만 짧게 */}
        <div className="orig-kor">
          <TrRow name="개역개정" verses={v} texts={v.map(x => ch[x - 1])} />
          {tab === 'explain' && <TrCompare book={book} chapter={chapter} verses={v} />}
        </div>
        {/* 해설 · 관련 구절은 미리 만들어 두고, 낱말 탭은 처음 열 때 만듦 */}
        <div hidden={tab !== 'explain'}><ExplainTab data={data} book={book} chapter={chapter} verses={v}
          onGo={r => { onClose(); goTo(page, { book: r.book, chapter: r.chapter, verse: r.verse ?? 1 }); }} /></div>
        <div hidden={tab !== 'xref'}><XrefTab data={data} book={book} chapter={chapter} verses={v} onOpen={x => { onClose(); goTo(page, { book: x.book, chapter: x.chapter, verse: x.verse }); }} /></div>
        <div hidden={tab !== 'lex'}>{seen.lex && <LexTab data={data} book={book} chapter={chapter} verses={v} />}</div>
      </div>
    </div>
  );
}

/* ---------- 번역 비교: 새번역(표준새번역 개정판) · BSB (인터넷 될 때만) ---------- */
const TR_OFF = '인터넷이 연결되면 새번역 · BSB가 함께 보입니다';

/** 번역 한 줄: 이름표를 첫 줄 앞에 붙여서 자리를 줄임 */
function TrRow({ name, note, verses, texts }: { name: string; note?: string; verses: number[]; texts: string[] | undefined }) {
  const one = verses.length === 1;
  return (
    <div className="tr-row">
      <span className="tr-name" title={note}>{name}</span>
      {!texts
        ? <span className="muted"> 불러오는 중…</span>
        : verses.map((x, i) => texts[i]
          ? <span key={x} className={one ? '' : 'tr-v'}>{!one && <b className="vref">{x}</b>}{!one && ' '}{texts[i]} </span>
          : null)}
    </div>
  );
}

function TrCompare({ book, chapter, verses }: { book: number; chapter: number; verses: number[] }) {
  const [rows, setRows] = useState<Record<string, string[] | null>>({});
  const [err, setErr] = useState('');
  useEffect(() => {
    let alive = true;
    setRows({}); setErr('');
    if (!navigator.onLine) { setRows(Object.fromEntries(TRANSLATIONS.map(t => [t.id, null]))); setErr(TR_OFF); return; }
    TRANSLATIONS.forEach(t => {
      getTranslation(t.id, book, chapter, verses)
        .then(r => { if (alive) setRows(o => ({ ...o, [t.id]: r })); })
        .catch(() => { if (alive) { setRows(o => ({ ...o, [t.id]: null })); setErr(TR_OFF); } });
    });
    return () => { alive = false; };
  }, [book, chapter, verses.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <>
      {TRANSLATIONS.map(t => rows[t.id] === null ? null
        : <TrRow key={t.id} name={t.name} note={t.note} verses={verses} texts={rows[t.id] || undefined} />)}
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

/** 깊은 해설: 여러 부분을 동시에 요청하고, 끝난 부분부터 바로 보여 줌 */
function useDeep(key: string, run: (s: AbortSignal, on: (p: DeepProgress) => void) => Promise<VerseAi>) {
  const [val, setVal] = useState<VerseAi | undefined>(() => cacheGet<VerseAi>(NS.verse, key));
  const [prog, setProg] = useState<DeepProgress | null>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'error'>('idle');
  const [err, setErr] = useState('');
  const [n, setN] = useState(0);
  useEffect(() => {
    if (val && n === 0) return;
    const ctl = new AbortController();
    setState('loading'); setProg(null); setErr('');
    run(ctl.signal, p => { if (!ctl.signal.aborted) setProg(p); })
      .then(r => { if (ctl.signal.aborted) return; setVal(r); if (!r.partial) cacheSet(NS.verse, key, r, 80); setState('idle'); setProg(null); })
      .catch(e => { if (!ctl.signal.aborted) { setErr((e as Error).message); setState('error'); setProg(null); } });
    return () => ctl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [n, key]);
  const update = (v: VerseAi) => { setVal(v); cacheSet(NS.verse, key, v, 80); };
  return { val, prog, state, err, update, again: () => setN(x => x + 1) };
}

function Waiting({ text }: { text: string }) {
  return <div className="deep-wait"><div className="spinner small" /> {text}</div>;
}

function ExplainTab({ data, book, chapter, verses, onGo }: { data: BibleData; book: number; chapter: number; verses: number[]; onGo: Go }) {
  const key = `${book}:${chapter}:${verses.join(',')}`;
  const { val, prog, state, err, update, again } = useDeep(key, (s, on) => runDeepVerse(data, book, chapter, verses, s, on));
  const ai = prog ? prog.ai : val;
  const busy = state === 'loading';
  const commWait = prog ? prog.comm.filter(c => c.state === 'wait').map(c => c.who) : [];
  const failed = prog ? prog.comm.filter(c => c.state === 'fail').length + (prog.core === 'fail' ? 1 : 0) + (prog.qa === 'fail' ? 1 : 0) + (prog.links === 'fail' ? 1 : 0) : 0;
  return (
    <>
      <div className="ai-card deep">
        <div className="ai-head"><span className="ai-badge">AI</span> 깊은 해설</div>
        {state === 'error' && !val && <div className="ai-err">⚠️ {err} <button className="link-btn" onClick={again}>다시 시도</button></div>}
        {busy && !prog && !val && <Waiting text="준비 중…" />}
        {ai && (
          <>
            {prog && prog.core === 'wait' && <Waiting text="요약과 배경을 쓰는 중…" />}
            {ai.summary && <p className="ai-intro">{ai.summary}</p>}
            {ai.background && <><div className="ai-sec">🏛️ 꼭 알아야 할 배경</div><p className="ai-interp">{ai.background}</p></>}

            {(ai.commentators?.length > 0 || commWait.length > 0) && (
              <><div className="ai-sec">📚 주석가들은 이렇게 봅니다</div>
                {ai.commentators.map((c, i) => (
                  <div key={i} className="deep-box"><div className="deep-who">{c.who}</div><div>{c.point}</div></div>
                ))}
                {commWait.length > 0 && <Waiting text={prog?.collecting && commWait.length === prog.comm.length ? '주석 자료를 모으는 중…' : `${commWait.join(' · ')} 읽는 중…`} />}</>
            )}

            {prog && prog.qa === 'wait' && <><div className="ai-sec">❓ 궁금증 풀이</div><Waiting text={prog.collecting ? '주석 자료를 모은 뒤 씁니다…' : '궁금증 풀이와 해석이 갈리는 곳을 쓰는 중…'} /></>}
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

            {prog && prog.links === 'wait' && <><div className="ai-sec">🔗 성경 연결</div><Waiting text="이어지는 성경 구절을 찾는 중…" /></>}
            {ai.links?.length > 0 && (
              <><div className="ai-sec">🔗 성경 연결</div>
                {ai.links.map((l, i) => (
                  <div key={i} className="deep-link"><RefLink text={l.ref} data={data} onGo={onGo} /> <span>{l.why}</span></div>
                ))}</>
            )}

            {(failed > 0 || (!prog && val?.partial)) && <div className="ai-err">일부를 받지 못했습니다. 아래 "다시 해설"을 눌러 주세요.</div>}
            <div className="ai-foot">
              {busy ? <span className="muted">{val && !prog ? '다시 쓰는 중…' : '끝난 부분부터 보여 드립니다'}</span> : <button onClick={again}>↻ 다시 해설</button>}
            </div>
          </>
        )}
      </div>

      {val && !busy && <VerseExtraCard data={data} book={book} chapter={chapter} verses={verses} />}
      {val && !busy && <AskMore data={data} book={book} chapter={chapter} verses={verses} ai={val} update={update} onGo={onGo} />}
      {(val || prog) && <SourceView book={book} chapter={chapter} verses={verses} />}

      <p className="desc small">AI 해설은 참고용입니다. 성경 본문과 함께 분별하며 읽어 주세요.{val?.sourceCount === 0 && !busy ? ' (이번 해설은 주석 자료를 받지 못해 AI 지식으로만 썼습니다)' : ''}<br />{COMMENTARY_CREDIT}</p>
    </>
  );
}

/** 🧭 책 전체 흐름 + 🎓 현대 학자들의 견해 (주석 해설과 따로 불러옴) */
function VerseExtraCard({ data, book, chapter, verses }: { data: BibleData; book: number; chapter: number; verses: number[] }) {
  const key = `${book}:${chapter}:${verses.join(',')}`;
  const { val: x, state, err, again } = useAi<VerseExtra>(NS.vextra, key, 80, s => askVerseExtra(data, book, chapter, verses, s));
  return (
    <div className="ai-card deep extra">
      <AiStatus state={state} err={err} has={!!x} again={again} wait="책 흐름과 현대 학자들의 견해를 쓰는 중…" />
      {x && <>
        {x.bookflow && <><div className="ai-sec first">🧭 책 전체 흐름 속에서</div><p className="ai-interp">{x.bookflow}</p></>}
        {x.modern?.length > 0 && (
          <><div className="ai-sec">🎓 현대 학자들의 견해 <span className="ai-note">AI가 기억으로 정리 · 참고용</span></div>
            {x.modern.map((c, i) => (
              <div key={i} className="deep-box modern"><div className="deep-who">{c.who}</div><div>{c.point}</div></div>
            ))}</>
        )}
      </>}
    </div>
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
      <button className="src-toggle" onClick={() => setOpen(o => !o)}>📜 주석 원문 보기 (영어 발췌) <Chev open={open} /></button>
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
