import { useEffect, useState } from 'react';
import { BibleData } from './bible';
import { BOOKS } from './books';
import { getHeads } from './headings';
import { goTo } from './store';
import { chapterLinks, COMMENTARY_CREDIT, NS, runDeepChapter, XRef, xrefLabel, xrefText } from './study';
import { Go, GroundedBody, useDeep, Waiting } from './StudyView';
import { useBackClose } from './utils';

/* ================================================================
   📘 장 깊은 해설 (v1.9: AI가 지어 쓰는 글 없이, 실제 자료만)
   🧭 이 장의 흐름 — 개역개정 단락 소제목
   📚 주석가들은 이 장을 이렇게 봅니다 — 주석 원문에서 고른 문장 + 번역
   ❓ 어려운 곳 풀이 — 주석이 직접 답하는 곳만
   ⚖️ 해석이 갈리는 곳 — 주석끼리 다르게 볼 때만
   🌏 성경 전체 이야기 속에서 — 관주 자료(OpenBible)로 이어지는 구절과 그 본문
   ================================================================ */
interface Props { data: BibleData; book: number; chapter: number; page: number; onClose: () => void; onAfterGo?: () => void }

export default function ChapterStudy({ data, book, chapter, page, onClose, onAfterGo }: Props) {
  useBackClose(true, onClose);
  const key = `${book}:${chapter}`;
  const unit = book === 18 ? '편' : '장';
  const max = data[book][chapter - 1].length;
  const { val, prog, state, err, again } = useDeep(NS.chap, key, (s, on) => runDeepChapter(data, book, chapter, s, on));
  const ai = prog ? prog.ai : val;
  const busy = state === 'loading';
  const go: Go = r => { onClose(); goTo(page, { book: r.book, chapter: r.chapter, verse: r.verse ?? 1 }); onAfterGo?.(); };
  const goV = (v: number) => go({ book, chapter, verse: Math.min(Math.max(1, v), max) });
  const failed = prog ? prog.comm.filter(c => c.state === 'fail').length + (prog.qa === 'fail' ? 1 : 0) : 0;

  // 🧭 흐름: 개역개정 소제목 (앱 안에 들어 있음 · 인터넷 필요 없음)
  const heads = getHeads(book, chapter);
  const flow = heads.map((h, i) => ({ from: h.v, to: (heads[i + 1]?.v ?? max + 1) - 1, title: h.title }))
    .filter((f, i, a) => i === a.length - 1 || f.from !== a[i + 1].from);

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
        <div className="ai-card deep">
          <div className="ai-head">📘 {BOOKS[book].name} {chapter}{unit} 깊은 해설</div>

          {flow.length > 0 && (
            <><div className="ai-sec">🧭 이 장의 흐름 <span className="ai-note">개역개정 소제목</span></div>
              <div className="flow-list">
                {flow.map((f, i) => (
                  <div key={i} className="flow-item">
                    <button className="flow-range" onClick={() => goV(f.from)}>{f.from >= f.to ? `${f.from}절` : `${f.from}–${f.to}절`}</button>
                    <div className="flow-body"><div className="flow-title solo">{f.title}</div></div>
                  </div>
                ))}
              </div></>
          )}

          {state === 'error' && !val && <div className="ai-err">⚠️ {err} <button className="link-btn" onClick={again}>다시 시도</button></div>}
          {busy && !prog && !val && <Waiting text="준비 중…" />}
          {ai && <GroundedBody ai={ai} prog={prog} titles={{ comm: '📚 주석가들은 이 장을 이렇게 봅니다', qa: '❓ 어려운 곳 풀이' }} />}

          <ChapterLinks data={data} book={book} chapter={chapter} count={max} onGo={go} />

          {ai && (failed > 0 || (!prog && val?.partial)) && <div className="ai-err">일부를 받지 못했습니다. 아래 "다시 해설"을 눌러 주세요.</div>}
          {ai && (
            <div className="ai-foot">
              {busy ? <span className="muted">{val && !prog ? '다시 받는 중…' : '끝난 부분부터 보여 드립니다'}</span> : <button onClick={again}>↻ 다시 해설</button>}
            </div>
          )}
        </div>
        <p className="desc small">주석에 실제로 있는 문장만 골라 번역해 보여 드립니다. 문장 끝 "원문"을 누르면 영어 원문을 볼 수 있습니다. 이어지는 구절은 OpenBible.info 관주 자료(CC BY)입니다.<br />{COMMENTARY_CREDIT}</p>
      </div>
    </div>
  );
}

/** 🌏 성경 전체 이야기 속에서 — 관주 자료로 이 장과 가장 많이 이어지는 구절 (본문과 함께) */
function ChapterLinks({ data, book, chapter, count, onGo }: { data: BibleData; book: number; chapter: number; count: number; onGo: Go }) {
  const [list, setList] = useState<(XRef & { from: number })[] | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    let alive = true;
    chapterLinks(book, chapter, count).then(l => { if (alive) setList(l); }).catch(e => { if (alive) setErr((e as Error).message); });
    return () => { alive = false; };
  }, [book, chapter, count]);
  if (err) return null;
  return (
    <>
      <div className="ai-sec">🌏 성경 전체 이야기 속에서 <span className="ai-note">관주 자료</span></div>
      {!list && <Waiting text="이어지는 구절을 찾는 중…" />}
      {list && list.length === 0 && <p className="desc">이 장과 이어지는 구절 자료가 없습니다.</p>}
      {list?.map((x, i) => (
        <div key={i} className="deep-link">
          <button className="ref-link" onClick={() => onGo({ book: x.book, chapter: x.chapter, verse: x.verse })}>{xrefLabel(x)}</button>
          <span className="muted small"> ← {x.from}절</span>
          <div className="link-text">{xrefText(data, x)}</div>
        </div>
      ))}
    </>
  );
}
