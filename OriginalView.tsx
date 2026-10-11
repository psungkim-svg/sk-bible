import { useEffect, useState } from 'react';
import { BibleData, refLabel } from './bible';
import { decodeMorph } from './morph';
import { askOrigAi, CHUNK_MB, chunkOf, getVerseWords, isGreek, OrigAi, OrigWord } from './orig';
import { useBackClose } from './utils';

interface Props { data: BibleData; book: number; chapter: number; verses: number[]; onClose: () => void; }

/* AI 해설은 폰에 저장해 두었다가 다시 보면 바로 보여 줍니다 */
const AI_KEY = 'sk-orig-ai-v1';
function loadAiCache(): Record<string, OrigAi> {
  try { return JSON.parse(localStorage.getItem(AI_KEY) || '{}'); } catch { return {}; }
}
function saveAi(k: string, v: OrigAi) {
  const c = loadAiCache();
  c[k] = v;
  const keys = Object.keys(c);
  if (keys.length > 300) keys.slice(0, keys.length - 300).forEach(x => delete c[x]);
  try { localStorage.setItem(AI_KEY, JSON.stringify(c)); } catch { /* */ }
}

export default function OriginalView({ data, book, chapter, verses, onClose }: Props) {
  const list = verses.slice(0, 10);
  const [cur, setCur] = useState(list[0]);
  useBackClose(true, onClose);

  return (
    <div className="overlay orig">
      <div className="ov-head">
        <button className="icon-btn" onClick={onClose} aria-label="뒤로">
          <svg viewBox="0 0 24 24" width="22" height="22"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" /></svg>
        </button>
        <div className="ov-title">원어 설명 · {refLabel(book, chapter, [cur])}</div>
        <button className="icon-btn" onClick={onClose} aria-label="닫기">✕</button>
      </div>
      {list.length > 1 && (
        <div className="chips scroll-x orig-tabs">
          {list.map(v => (
            <button key={v} className={'chip' + (v === cur ? ' on' : '')} onClick={() => setCur(v)}>{chapter}:{v}</button>
          ))}
        </div>
      )}
      <VerseOrig key={cur} data={data} book={book} chapter={chapter} verse={cur} />
    </div>
  );
}

function VerseOrig({ data, book, chapter, verse }: { data: BibleData; book: number; chapter: number; verse: number }) {
  const greek = isGreek(book);
  const korean = data[book]?.[chapter - 1]?.[verse - 1] ?? '';
  const aiKey = `${book}:${chapter}:${verse}`;
  const [words, setWords] = useState<OrigWord[] | null>(null);
  const [wErr, setWErr] = useState('');
  const [ai, setAi] = useState<OrigAi | null>(() => loadAiCache()[aiKey] ?? null);
  const [aiState, setAiState] = useState<'idle' | 'loading' | 'error' | 'offline'>('idle');
  const [aiErr, setAiErr] = useState('');
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let alive = true;
    getVerseWords(book, chapter, verse)
      .then(w => { if (alive) setWords(w); })
      .catch(() => { if (alive) setWErr(navigator.onLine ? '원어 자료를 받지 못했습니다. 잠시 뒤 다시 열어 주세요.' : '처음 한 번은 인터넷이 필요합니다. (이 부분 원어 자료를 받은 뒤에는 인터넷 없이도 보입니다)'); });
    return () => { alive = false; };
  }, [book, chapter, verse]);

  useEffect(() => {
    if (!words || !words.length || (ai && retry === 0)) return;
    if (!navigator.onLine) { setAiState('offline'); return; }
    const ctl = new AbortController();
    setAiState('loading');
    askOrigAi(book, chapter, verse, korean, words, ctl.signal)
      .then(r => { setAi(r); saveAi(aiKey, r); setAiState('idle'); })
      .catch(e => { if (!ctl.signal.aborted) { setAiErr((e as Error).message); setAiState('error'); } });
    return () => ctl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [words, retry]);

  const wInfo = (i: number) => ai?.words?.find(w => Number(w.i) === i);

  return (
    <div className="orig-body">
      <div className="orig-kor">
        <div className="orig-ref">{refLabel(book, chapter, [verse])} <span className="muted">개역개정</span></div>
        {korean}
      </div>

      {!words && !wErr && (
        <div className="busy"><div className="spinner small" /> 원어 자료를 여는 중… <span className="muted">(처음 한 번 약 {CHUNK_MB[chunkOf(book)]}MB)</span></div>
      )}
      {wErr && <div className="ai-err">⚠️ {wErr}</div>}
      {words && words.length === 0 && <div className="ai-err">이 절의 원어 자료가 없습니다.</div>}

      {words && words.length > 0 && (
        <>
          <div className={'orig-line' + (greek ? ' grk' : ' heb')} dir={greek ? 'ltr' : 'rtl'}>
            {words.map(w => w[0]).join(' ')}
          </div>
          <div className="orig-lang muted">{greek ? '헬라어 신약 (NA28)' : (words.some(w => w[4]?.startsWith('A')) ? '아람어 · 히브리어 구약' : '히브리어 구약 (레닌그라드 사본)')}</div>

          {/* AI 해설 */}
          <div className="ai-card orig-ai">
            <div className="ai-head"><span className="ai-badge">AI</span> 원어 해설</div>
            {aiState === 'loading' && !ai && <div className="busy" style={{ padding: '6px 0' }}><div className="spinner small" /> 원어를 분석하는 중… (10~20초)</div>}
            {aiState === 'offline' && !ai && <div className="ai-err">인터넷에 연결되면 AI 해설이 나옵니다. 아래 단어 분석은 그대로 볼 수 있습니다.</div>}
            {aiState === 'error' && !ai && (
              <div className="ai-err">⚠️ {aiErr} <button className="link-btn" onClick={() => setRetry(r => r + 1)}>다시 시도</button></div>
            )}
            {ai && (
              <>
                {ai.summary && <p className="ai-interp">{ai.summary}</p>}
                {ai.points?.length > 0 && (
                  <ol className="ai-points">
                    {ai.points.map((p, i) => <li key={i}>{p.title && <b>{p.title}: </b>}{p.body}</li>)}
                  </ol>
                )}
                <div className="ai-foot">
                  {aiState === 'loading'
                    ? <span className="muted">다시 쓰는 중…</span>
                    : <button onClick={() => setRetry(r => r + 1)}>↻ 다시 해설</button>}
                </div>
              </>
            )}
          </div>

          {/* 단어별 분석 */}
          <div className="ai-sec">🔍 단어별 분석 ({words.length}단어)</div>
          {words.map((w, i) => {
            const info = wInfo(i);
            return (
              <div key={i} className="wcard">
                <div className="wtop">
                  <span className={'wword' + (greek ? ' grk' : ' heb')} dir={greek ? 'ltr' : 'rtl'}>{w[0]}</span>
                  <span className="wpron">{info?.pron && <b>{info.pron}</b>} <span className="muted">{w[1]}</span></span>
                </div>
                <div className="wmean">
                  {info?.ko ? <><b>{info.ko}</b> <span className="muted">({w[2]})</span></> : <span>{w[2]}</span>}
                </div>
                <div className="wmeta">
                  {w[5] && <span>사전형 <b className={greek ? 'grk' : 'heb'}>{w[5]}</b>{w[6] ? ` (${w[6]})` : ''}</span>}
                  <span className="strong">{w[3]}</span>
                </div>
                <div className="wgram">{decodeMorph(w[4], greek)}</div>
                {info?.note && <div className="wnote">💡 {info.note}</div>}
              </div>
            );
          })}
          <p className="desc small">원어 자료: STEPBible.org (TAHOT · TAGNT, CC BY 4.0) · AI 해설은 참고용입니다.</p>
        </>
      )}
    </div>
  );
}
