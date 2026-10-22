import { useEffect, useState } from 'react';
import { BibleData } from './bible';
import { BOOKS } from './books';
import { goTo, setObsNote, useStore } from './store';
import { cacheGet, cacheSet, ChapAi, ChapProgress, COMMENTARY_CREDIT, NS, runDeepChapter } from './study';
import { Go, RefLink, Waiting } from './StudyView';
import { useBackClose } from './utils';
import { Chev } from './ToolIcons';

/* ================================================================
   📘 장 깊은 해설 (v1.7)
   🔎 먼저 생각해 보기 (관찰 질문 — 적지 않아도 "답 보기"로 바로 볼 수 있음)
   🧭 흐름 · ⭐ 핵심 절 · ↩️ 앞뒤 장 · 📚 주석가들 · ❓ 어려운 곳 · 🌏 성경 전체 속에서
   ================================================================ */
interface Props { data: BibleData; book: number; chapter: number; page: number; onClose: () => void }

function useDeepChapter(key: string, run: (s: AbortSignal, on: (p: ChapProgress) => void) => Promise<ChapAi>) {
  const [val, setVal] = useState<ChapAi | undefined>(() => cacheGet<ChapAi>(NS.chap, key));
  const [prog, setProg] = useState<ChapProgress | null>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'error'>('idle');
  const [err, setErr] = useState('');
  const [n, setN] = useState(0);
  useEffect(() => {
    if (val && n === 0) return;
    const ctl = new AbortController();
    setState('loading'); setProg(null); setErr('');
    run(ctl.signal, p => { if (!ctl.signal.aborted) setProg(p); })
      .then(r => { if (ctl.signal.aborted) return; setVal(r); if (!r.partial) cacheSet(NS.chap, key, r, 60); setState('idle'); setProg(null); })
      .catch(e => { if (!ctl.signal.aborted) { setErr((e as Error).message); setState('error'); setProg(null); } });
    return () => ctl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [n, key]);
  return { val, prog, state, err, again: () => setN(x => x + 1) };
}

export default function ChapterStudy({ data, book, chapter, page, onClose }: Props) {
  useBackClose(true, onClose);
  const key = `${book}:${chapter}`;
  const unit = book === 18 ? '편' : '장';
  const max = data[book][chapter - 1].length;
  const { val, prog, state, err, again } = useDeepChapter(key, (s, on) => runDeepChapter(data, book, chapter, s, on));
  const ai = prog ? prog.ai : val;
  const busy = state === 'loading';
  const go: Go = r => { onClose(); goTo(page, { book: r.book, chapter: r.chapter, verse: r.verse ?? 1 }); };
  const goV = (v: number) => go({ book, chapter, verse: Math.min(Math.max(1, v), max) });
  const commWait = prog ? prog.comm.filter(c => c.state === 'wait').map(c => c.who) : [];
  const failed = prog ? prog.comm.filter(c => c.state === 'fail').length + (['obs', 'flow', 'hard'] as const).filter(k => prog[k] === 'fail').length : 0;
  const [allOpen, setAllOpen] = useState(false);
  const [openSet, setOpenSet] = useState<Record<number, boolean>>({});
  const isOpen = (i: number) => openSet[i] ?? allOpen;

  return (
    <div className="overlay study chap-study">
      <div className="ov-head">
        <button className="icon-btn" onClick={onClose} aria-label="뒤로">
          <svg viewBox="0 0 24 24" width="22" height="22"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" /></svg>
        </button>
        <div className="ov-title">장 깊은 해설 · {BOOKS[book].name} {chapter}{unit}</div>
        <button className="icon-btn" onClick={onClose} aria-label="닫기">✕</button>
      </div>
      <div className="study-body">
        {state === 'error' && !val && <div className="ai-err">⚠️ {err} <button className="link-btn" onClick={again}>다시 시도</button></div>}
        {busy && !prog && !val && <Waiting text="준비 중…" />}

        {/* 🔎 먼저 생각해 보기 */}
        {ai && (
          <div className="ai-card deep obs-card">
            <div className="ai-head obs-head">
              <span>🔎 먼저 생각해 보기</span>
              {ai.questions.length > 0 && (
                <button className="obs-all" onClick={() => { setAllOpen(o => !o); setOpenSet({}); }}>{allOpen ? '답 모두 접기' : '답 모두 보기'}</button>
              )}
            </div>
            {prog && prog.obs === 'wait' && <Waiting text="관찰 질문을 만드는 중…" />}
            {ai.questions.length > 0 && <p className="obs-tip">본문을 다시 보며 생각해 보세요. 적지 않아도 <b>💡 답 보기</b>를 누르면 바로 보입니다.</p>}
            {ai.questions.map((x, i) => (
              <ObsQuestion key={i} n={i + 1} q={x} noteKey={`${key}:${x.q.slice(0, 40)}`} open={isOpen(i)}
                onToggle={() => setOpenSet(o => ({ ...o, [i]: !isOpen(i) }))} verses={data[book][chapter - 1]} />
            ))}
            {prog?.obs === 'fail' && <div className="ai-err">관찰 질문을 받지 못했습니다.</div>}
          </div>
        )}

        {/* 📘 장 깊은 해설 */}
        {ai && (
          <div className="ai-card deep">
            <div className="ai-head"><span className="ai-badge">AI</span> {BOOKS[book].name} {chapter}{unit} 깊은 해설</div>

            {prog && prog.flow === 'wait' && <><div className="ai-sec">🧭 이 장의 흐름</div><Waiting text="이 장의 흐름을 정리하는 중…" /></>}
            {ai.flow.length > 0 && (
              <><div className="ai-sec">🧭 이 장의 흐름</div>
                <div className="flow-list">
                  {ai.flow.map((f, i) => (
                    <div key={i} className="flow-item">
                      <button className="flow-range" onClick={() => goV(f.from)}>{f.from === f.to || !f.to ? `${f.from}절` : `${f.from}–${f.to}절`}</button>
                      <div className="flow-body"><div className="flow-title">{f.title}</div><div className="flow-gist">{f.gist}</div></div>
                    </div>
                  ))}
                </div></>
            )}
            {ai.key.filter(k => k.v >= 1 && k.v <= max).length > 0 && (
              <><div className="ai-sec">⭐ 이 장을 여는 열쇠 구절</div>
                {ai.key.filter(k => k.v >= 1 && k.v <= max).map((k, i) => (
                  <div key={i} className="deep-box">
                    <button className="key-verse" onClick={() => goV(k.v)}><b>{k.v}절</b> {data[book][chapter - 1][k.v - 1]}</button>
                    <div className="key-why">{k.why}</div>
                  </div>
                ))}</>
            )}
            {(ai.prev || ai.next) && (
              <><div className="ai-sec">↔️ 앞뒤 장과의 연결</div>
                {ai.prev && <p className="ai-interp"><b className="pn">↩️ 앞에서</b> {ai.prev}</p>}
                {ai.next && <p className="ai-interp"><b className="pn">↪️ 다음으로</b> {ai.next}</p>}</>
            )}

            {(ai.commentators.length > 0 || commWait.length > 0) && (
              <><div className="ai-sec">📚 주석가들은 이 장을 이렇게 봅니다</div>
                {ai.commentators.map((c, i) => (
                  <div key={i} className="deep-box"><div className="deep-who">{c.who}</div><div>{c.point}</div></div>
                ))}
                {commWait.length > 0 && <Waiting text={prog?.collecting && commWait.length === prog.comm.length ? '주석 자료를 모으는 중…' : `${commWait.join(' · ')} 읽는 중…`} />}</>
            )}

            {prog && prog.hard === 'wait' && <><div className="ai-sec">❓ 어려운 곳 풀이</div><Waiting text={prog.collecting ? '주석 자료를 모은 뒤 씁니다…' : '어려운 곳 풀이와 성경 전체 속 자리를 쓰는 중…'} /></>}
            {ai.hard.length > 0 && (
              <><div className="ai-sec">❓ 어려운 곳 풀이</div>
                {ai.hard.map((x, i) => (
                  <div key={i} className="deep-qa"><div className="deep-q">Q. {x.q}</div><div className="deep-a">{x.a}</div></div>
                ))}</>
            )}
            {ai.canon.length > 0 && (
              <><div className="ai-sec">🌏 성경 전체 이야기 속에서</div>
                {ai.canon.map((l, i) => (
                  <div key={i} className="deep-link"><RefLink text={l.ref} data={data} onGo={go} /> <span>{l.why}</span></div>
                ))}</>
            )}

            {(failed > 0 || (!prog && val?.partial)) && <div className="ai-err">일부를 받지 못했습니다. 아래 "다시 해설"을 눌러 주세요.</div>}
            <div className="ai-foot">
              {busy ? <span className="muted">{val && !prog ? '다시 쓰는 중…' : '끝난 부분부터 보여 드립니다'}</span> : <button onClick={again}>↻ 다시 해설</button>}
            </div>
          </div>
        )}
        <p className="desc small">AI 해설은 참고용입니다. 성경 본문과 함께 분별하며 읽어 주세요.<br />{COMMENTARY_CREDIT}</p>
      </div>
    </div>
  );
}

/** 관찰 질문 하나: ✏️ 내 생각 적기(선택) · 💡 답 보기(언제든) */
function ObsQuestion({ n, q, noteKey, open, onToggle, verses }: {
  n: number; q: ChapAi['questions'][number]; noteKey: string; open: boolean; onToggle: () => void; verses: string[];
}) {
  const max = verses.length;
  const [showV, setShowV] = useState<number | null>(null);
  const saved = useStore(s => s.obsNotes[noteKey] || '');
  const [writing, setWriting] = useState(false);
  const [text, setText] = useState(saved);
  useEffect(() => { setText(saved); }, [saved]);
  const vs = (q.v || []).filter(v => v >= 1 && v <= max);
  return (
    <div className="obs-q">
      <div className="deep-q">Q{n}. {q.q}</div>
      {vs.length > 0 && <div className="obs-vs">{vs.map(v => <button key={v} className={'obs-v' + (showV === v ? ' on' : '')} onClick={() => setShowV(x => (x === v ? null : v))}>{v}절</button>)}</div>}
      {showV && <div className="obs-vtext"><b>{showV}</b> {verses[showV - 1]}</div>}
      {writing ? (
        <textarea className="obs-note" autoFocus value={text} placeholder="생각나는 대로 짧게 적어 보세요" rows={3}
          onChange={e => setText(e.target.value)} onBlur={() => { setObsNote(noteKey, text); setWriting(false); }} />
      ) : saved ? (
        <button className="obs-mine" onClick={() => setWriting(true)}><b>✏️ 내 생각</b> {saved}</button>
      ) : null}
      <div className="obs-btns">
        {!writing && !saved && <button onClick={() => setWriting(true)}>✏️ 내 생각 적기</button>}
        <button className={'obs-ans' + (open ? ' on' : '')} onClick={onToggle}>💡 {open ? '답 접기' : '답 보기'} <Chev open={open} /></button>
      </div>
      {open && <div className="deep-a obs-a">{q.a}</div>}
    </div>
  );
}
