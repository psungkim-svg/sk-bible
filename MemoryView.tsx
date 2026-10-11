import { useMemo, useState } from 'react';
import { BibleData, refLabel } from './bible';
import { goTo, MemCard, openTab, rateMemory, removeMemory, useStore } from './store';
import { useBackClose } from './utils';

const LEVEL_NAME = ['새 카드', '1단계', '2단계', '3단계', '4단계', '다 외움'];
const cardText = (data: BibleData, m: MemCard) => m.verses.map(v => data[m.book][m.chapter - 1][v - 1]).join(' ');
const isDue = (m: MemCard) => m.due <= Date.now();

/** 북마크 화면 안의 "암송" 탭 */
export default function MemoryView({ data, target }: { data: BibleData; target: number }) {
  const memory = useStore(s => s.memory);
  const [practice, setPractice] = useState<MemCard[] | null>(null);
  const due = memory.filter(isDue);
  const sorted = useMemo(() => [...memory].sort((a, b) => Number(isDue(b)) - Number(isDue(a)) || a.due - b.due), [memory]);

  return (
    <>
      {memory.length === 0 ? (
        <div className="empty">
          <div className="empty-icon">🧠</div>
          아직 암송 카드가 없습니다.<br />
          본문에서 외우고 싶은 절을 <b>눌러 선택</b>한 뒤<br /><b>암송</b>을 누르세요.
        </div>
      ) : (
        <>
          <div className="mem-hero">
            <div className="mem-stat">
              <div><b>{due.length}</b><span>오늘 복습</span></div>
              <div><b>{memory.length}</b><span>전체 카드</span></div>
              <div><b>{memory.filter(m => m.level >= 5).length}</b><span>다 외움</span></div>
            </div>
            <div className="mem-start">
              <button className="primary" disabled={!due.length} onClick={() => setPractice(due)}>▶ 오늘 복습 {due.length}개</button>
              <button onClick={() => setPractice([...memory].sort(() => Math.random() - 0.5))}>전체 연습</button>
            </div>
            <p className="desc small">외웠어요를 누르면 1일 → 3일 → 7일 → 14일 → 30일 뒤에 다시 복습하도록 알려 드립니다.</p>
          </div>
          {sorted.map(m => (
            <div className="card" key={m.id}>
              <button className="card-main" onClick={() => setPractice([m])}>
                <div className="card-ref">{refLabel(m.book, m.chapter, m.verses)}
                  <span className={'mem-lv lv' + m.level}>{LEVEL_NAME[m.level]}</span>
                  {isDue(m) && <span className="mem-due">복습</span>}
                </div>
                <div className="card-text">{cardText(data, m)}</div>
              </button>
              <div className="card-actions">
                <span className="date">연습 {m.reviews}번</span>
                <button onClick={() => { goTo(target, { book: m.book, chapter: m.chapter, verse: m.verses[0] }); openTab(target as 0); }}>본문 보기</button>
                <button className="danger" onClick={() => { if (confirm('이 암송 카드를 지울까요?')) removeMemory(m.id); }}>삭제</button>
              </div>
            </div>
          ))}
        </>
      )}
      {practice && practice.length > 0 && <Practice data={data} cards={practice} onClose={() => setPractice(null)} />}
    </>
  );
}

type Mode = 'first' | 'blank' | 'hide' | 'full';
const MODES: [Mode, string][] = [['first', '첫 글자'], ['blank', '빈칸'], ['hide', '가리기'], ['full', '전체 보기']];

function Practice({ data, cards, onClose }: { data: BibleData; cards: MemCard[]; onClose: () => void }) {
  useBackClose(true, onClose);
  const [i, setI] = useState(0);
  const [mode, setMode] = useState<Mode>('first');
  const [shown, setShown] = useState<Set<number>>(new Set());
  const [all, setAll] = useState(false);
  const [done, setDone] = useState({ ok: 0, again: 0 });
  const card = cards[i];
  const words = useMemo(() => (card ? cardText(data, card).split(/\s+/) : []), [card, data]);
  // 빈칸: 단어 중 약 40%를 가림 (카드마다 같은 자리)
  const hidden = useMemo(() => {
    let seed = [...(card?.id ?? 'x')].reduce((a, c) => a * 31 + c.charCodeAt(0), 7) >>> 0;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296);
    return new Set(words.map((_, k) => k).filter(() => rnd() < 0.4));
  }, [card, words]);

  const next = (ok: boolean) => {
    rateMemory(card.id, ok);
    setDone(d => ({ ok: d.ok + (ok ? 1 : 0), again: d.again + (ok ? 0 : 1) }));
    setI(x => x + 1); setShown(new Set()); setAll(false);
  };

  return (
    <div className="overlay mem-practice">
      <div className="ov-head">
        <button className="icon-btn" onClick={onClose} aria-label="뒤로">
          <svg viewBox="0 0 24 24" width="22" height="22"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" /></svg>
        </button>
        <div className="ov-title">암송 연습 {card ? `${i + 1} / ${cards.length}` : ''}</div>
        <button className="icon-btn" onClick={onClose} aria-label="닫기">✕</button>
      </div>
      {!card ? (
        <div className="mem-done">
          <div className="empty-icon">🎉</div>
          <b>연습을 마쳤습니다!</b>
          <p>외웠어요 {done.ok}개 · 다시 외우기 {done.again}개</p>
          <button className="primary" onClick={onClose}>닫기</button>
        </div>
      ) : (
        <div className="mem-body">
          <div className="seg small mem-modes">
            {MODES.map(([m, l]) => <button key={m} className={mode === m ? 'on' : ''} onClick={() => { setMode(m); setShown(new Set()); setAll(false); }}>{l}</button>)}
          </div>
          <div className="mem-card">
            <div className="mem-ref">{refLabel(card.book, card.chapter, card.verses)}</div>
            {mode === 'hide' && !all ? (
              <button className="mem-cover" onClick={() => setAll(true)}>마음속으로 외워 보고<br />눌러서 확인하세요</button>
            ) : (
              <div className="mem-text">
                {words.map((w, k) => {
                  const open = all || mode === 'full' || shown.has(k);
                  if (mode === 'first' && !open) {
                    return <span key={k} className="mw first" onClick={() => setShown(s => new Set(s).add(k))}>{w[0]}<i>{'·'.repeat(Math.max(1, w.length - 1))}</i> </span>;
                  }
                  if (mode === 'blank' && hidden.has(k) && !open) {
                    return <span key={k} className="mw blank" onClick={() => setShown(s => new Set(s).add(k))}>{'\u3000'.repeat(Math.max(1, Math.ceil(w.length * 0.9)))}</span>;
                  }
                  return <span key={k} className={'mw' + (shown.has(k) ? ' opened' : '')}>{w} </span>;
                })}
              </div>
            )}
            {mode !== 'full' && !all && mode !== 'hide' && <button className="link-btn mem-showall" onClick={() => setAll(true)}>모두 보기</button>}
            <p className="desc small" style={{ textAlign: 'center' }}>
              {mode === 'first' && '첫 글자만 보입니다. 낱말을 누르면 하나씩 보입니다.'}
              {mode === 'blank' && '빈칸을 눌러 하나씩 확인하세요.'}
              {mode === 'hide' && '장절만 보고 소리 내어 외워 보세요.'}
              {mode === 'full' && '먼저 여러 번 소리 내어 읽어 보세요.'}
            </p>
          </div>
          <div className="mem-rate">
            <button onClick={() => next(false)}>😅 다시 외우기</button>
            <button className="primary" onClick={() => next(true)}>😊 외웠어요</button>
          </div>
        </div>
      )}
    </div>
  );
}
