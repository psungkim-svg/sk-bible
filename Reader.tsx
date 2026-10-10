import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { BibleData, buildCopyText, refLabel } from './bible';
import { BOOKS } from './books';
import {
  addBookmark, goBack, goTo, HlColor, setHighlight, updatePage, useStore,
} from './store';
import { copyText, shareText, toast, useBackClose } from './utils';
import BookPicker from './BookPicker';
import ToolIcons from './ToolIcons';

interface Props { index: number; data: BibleData; active: boolean; }

const HL_COLORS: HlColor[] = ['yellow', 'green', 'blue', 'pink'];

export default function Reader({ index, data, active }: Props) {
  const page = useStore(s => s.pages[index]);
  const settings = useStore(s => s.settings);
  const highlights = useStore(s => s.highlights);
  const bookmarks = useStore(s => s.bookmarks);

  const { book, chapter } = page;
  const verses = data[book]?.[chapter - 1] ?? [];
  const isPsalm = book === 18;

  const [selected, setSelected] = useState<number[]>([]);
  const [anchor, setAnchor] = useState<number | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [hlOpen, setHlOpen] = useState(false);
  const [flashV, setFlashV] = useState<number | undefined>();

  const scrollRef = useRef<HTMLDivElement>(null);

  // 북마크된 절 표시용
  const bookmarked = useMemo(() => {
    const set = new Set<number>();
    for (const b of bookmarks) if (b.book === book && b.chapter === chapter) b.verses.forEach(v => set.add(v));
    return set;
  }, [bookmarks, book, chapter]);

  /* ---------- 위치 복원 / 이동 시 스크롤 ---------- */
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const v = page.verse;
    if (!v || v <= 1) { el.scrollTop = 0; }
    else {
      const target = el.querySelector<HTMLElement>(`[data-v="${v}"]`);
      if (target) el.scrollTop = target.offsetTop - 12;
    }
    if (page.flash) {
      setFlashV(page.flash);
      const t = setTimeout(() => setFlashV(undefined), 2200);
      updatePage(index, { flash: undefined });
      return () => clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page.nav, book, chapter]);

  // 장이 바뀌면 선택 해제
  useEffect(() => { setSelected([]); setAnchor(null); setHlOpen(false); }, [book, chapter]);
  // 다른 페이지로 가면 선택 해제
  useEffect(() => { if (!active) { setSelected([]); setHlOpen(false); } }, [active]);

  /* ---------- 읽던 위치 자동 저장 ---------- */
  const saveTimer = useRef<number>();
  const onScroll = () => {
    clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      const el = scrollRef.current;
      if (!el) return;
      const items = el.querySelectorAll<HTMLElement>('[data-v]');
      const top = el.scrollTop + 16;
      let lo = 0, hi = items.length - 1, found = 1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        const it = items[mid];
        if (it.offsetTop + it.offsetHeight > top) { found = mid + 1; hi = mid - 1; } else lo = mid + 1;
      }
      if (el.scrollTop < 8) found = 1;
      if (found !== page.verse) updatePage(index, { verse: found });
    }, 300);
  };

  /* ---------- 장 이동 ---------- */
  const neighbor = (dir: 1 | -1, b0 = book, c0 = chapter): { book: number; chapter: number } | null => {
    let b = b0, c = c0 + dir;
    if (c < 1) { if (b === 0) return null; b -= 1; c = data[b].length; }
    else if (c > data[b].length) { if (b === 65) return null; b += 1; c = 1; }
    return { book: b, chapter: c };
  };
  const step = (dir: 1 | -1) => {
    const n = neighbor(dir);
    if (n) goTo(index, { ...n, verse: 1 }, { record: false, flash: false });
  };

  /* ---------- 좌우로 밀어서 장 넘기기 (손가락을 따라 부드럽게) ---------- */
  const pagerRef = useRef<HTMLDivElement>(null);
  const ghostRef = useRef<HTMLDivElement>(null);
  const [ghost, setGhost] = useState<{ dir: 1 | -1; book: number; chapter: number } | null>(null);
  const animating = useRef(false);
  const swipedAt = useRef(0);
  const live = useRef({ book, chapter, swipe: settings.swipe, hasSel: false, neighbor, step });
  live.current = { book, chapter, swipe: settings.swipe, hasSel: selected.length > 0, neighbor, step };

  const setX = (x: number, dir: number, withGhost: boolean, transition = '') => {
    const sc = scrollRef.current, gh = ghostRef.current, w = pagerRef.current?.clientWidth ?? 360;
    if (sc) { sc.style.transition = transition; sc.style.transform = x ? `translateX(${x}px)` : ''; }
    if (gh && withGhost) { gh.style.transition = transition; gh.style.transform = `translateX(${x + dir * w}px)`; }
  };
  const DUR = 240;
  const EASE = `transform ${DUR}ms cubic-bezier(.22,.8,.3,1)`;

  const commit = (dir: 1 | -1) => {
    const w = pagerRef.current?.clientWidth ?? 360;
    animating.current = true;
    setX(-dir * w, dir, true, EASE);
    window.setTimeout(() => {
      flushSync(() => { live.current.step(dir); setGhost(null); });
      setX(0, dir, false, 'none');
      animating.current = false;
    }, DUR + 10);
  };
  const cancel = (dir: number) => {
    animating.current = true;
    setX(0, dir, true, EASE);
    window.setTimeout(() => { setGhost(null); setX(0, dir, false, 'none'); animating.current = false; }, DUR + 10);
  };
  /** 버튼으로 장을 넘길 때도 같은 효과 */
  const animStep = (dir: 1 | -1) => {
    if (animating.current) return;
    const n = neighbor(dir);
    if (!n) return;
    if (!settings.swipe) { step(dir); return; }
    flushSync(() => setGhost({ dir, ...n }));
    setX(0, dir, true, 'none');
    void ghostRef.current?.offsetWidth; // 위치 적용 후 움직이기
    commit(dir);
  };

  useEffect(() => {
    const el = pagerRef.current;
    if (!el) return;
    let sx = 0, sy = 0, dx = 0, curDir = 0, lastX = 0, lastT = 0, vel = 0;
    let lock: 'h' | 'v' | null = null;
    let hasNb = false;
    const onStart = (e: TouchEvent) => {
      if (animating.current || e.touches.length > 1 || !live.current.swipe || live.current.hasSel) { lock = 'v'; return; }
      const t = e.touches[0];
      sx = lastX = t.clientX; sy = t.clientY; lastT = e.timeStamp;
      dx = 0; curDir = 0; vel = 0; lock = null;
    };
    const onMove = (e: TouchEvent) => {
      if (lock === 'v') return;
      const t = e.touches[0];
      const mx = t.clientX - sx, my = t.clientY - sy;
      if (!lock) {
        if (Math.abs(mx) < 10 && Math.abs(my) < 10) return;
        if (Math.abs(my) * 1.1 >= Math.abs(mx)) { lock = 'v'; return; }
        lock = 'h';
        sx = t.clientX - Math.sign(mx) * 2;
      }
      e.preventDefault();
      dx = t.clientX - sx;
      const dir: 1 | -1 = dx < 0 ? 1 : -1;
      if (dir !== curDir) {
        curDir = dir;
        const nb = live.current.neighbor(dir);
        hasNb = !!nb;
        flushSync(() => setGhost(nb ? { dir, ...nb } : null));
      }
      const dt = e.timeStamp - lastT;
      if (dt > 0) vel = 0.7 * ((t.clientX - lastX) / dt) + 0.3 * vel;
      lastX = t.clientX; lastT = e.timeStamp;
      setX(hasNb ? dx : dx * 0.25, dir, hasNb, 'none');
    };
    const onEnd = () => {
      if (lock !== 'h') { lock = null; return; }
      lock = null;
      swipedAt.current = Date.now();
      const w = el.clientWidth;
      const dir: 1 | -1 = dx < 0 ? 1 : -1;
      const fling = Math.abs(vel) > 0.35 && Math.abs(dx) > 30 && Math.sign(vel) === Math.sign(dx);
      if (hasNb && (Math.abs(dx) > w * 0.25 || fling)) commit(dir);
      else cancel(dir);
    };
    el.addEventListener('touchstart', onStart, { passive: true });
    el.addEventListener('touchmove', onMove, { passive: false });
    el.addEventListener('touchend', onEnd);
    el.addEventListener('touchcancel', onEnd);
    return () => {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', onEnd);
      el.removeEventListener('touchcancel', onEnd);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---------- 절 선택 (탭 = 선택/해제, 길게 누르기 = 범위 선택) ---------- */
  const lp = useRef<{ timer?: number; fired: boolean; x: number; y: number }>({ fired: false, x: 0, y: 0 });
  const onVerseTouchStart = (v: number, e: React.TouchEvent) => {
    const t = e.touches[0];
    lp.current.fired = false;
    lp.current.x = t.clientX; lp.current.y = t.clientY;
    clearTimeout(lp.current.timer);
    lp.current.timer = window.setTimeout(() => {
      lp.current.fired = true;
      selectRange(v);
      navigator.vibrate?.(25);
    }, 480);
  };
  const onVerseTouchMove = (e: React.TouchEvent) => {
    const t = e.touches[0];
    if (Math.abs(t.clientX - lp.current.x) > 10 || Math.abs(t.clientY - lp.current.y) > 10) clearTimeout(lp.current.timer);
  };
  const onVerseTouchEnd = () => clearTimeout(lp.current.timer);

  const toggle = (v: number) => {
    if (lp.current.fired) { lp.current.fired = false; return; }
    if (Date.now() - swipedAt.current < 350) return; // 밀어 넘기는 중 실수로 눌린 것
    setSelected(sel => (sel.includes(v) ? sel.filter(x => x !== v) : [...sel, v]));
    setAnchor(v);
  };
  const selectRange = (v: number) => {
    const a = anchor ?? v;
    const [s, e] = a < v ? [a, v] : [v, a];
    setSelected(sel => {
      const set = new Set(sel);
      for (let i = s; i <= e; i++) set.add(i);
      return [...set];
    });
    setAnchor(v);
  };

  const clearSel = () => { setSelected([]); setAnchor(null); setHlOpen(false); };
  useBackClose(active && selected.length > 0, clearSel);

  const copyOpts = { bookStyle: settings.copyBookStyle, refPosition: settings.copyRefPosition, verseNumbers: settings.copyVerseNumbers };
  const doCopy = async () => {
    const text = buildCopyText(data, book, chapter, selected, copyOpts);
    toast((await copyText(text)) ? '복사했습니다 📋' : '복사하지 못했습니다');
    clearSel();
  };
  const doShare = async () => {
    const text = buildCopyText(data, book, chapter, selected, copyOpts);
    const r = await shareText(text);
    if (r === 'copied') toast('복사했습니다 📋');
    clearSel();
  };
  const doBookmark = () => {
    const ok = addBookmark(book, chapter, selected);
    toast(ok ? `북마크 추가: ${refLabel(book, chapter, selected, true)}` : '이미 북마크에 있습니다');
    clearSel();
  };
  const doHighlight = (c: HlColor | null) => {
    setHighlight(book, chapter, selected, c);
    clearSel();
  };

  const sortedSel = [...selected].sort((a, b) => a - b);
  const chapUnit = isPsalm ? '편' : '장';

  return (
    <div className={'reader' + (active ? '' : ' inactive')}>
      <header className="rhead">
        <button className="icon-btn" disabled={!page.history.length} onClick={() => goBack(index)} aria-label="이전 위치">
          <svg viewBox="0 0 24 24" width="22" height="22"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
        <button className="title-btn" onClick={() => { clearSel(); setPickerOpen(true); }}>
          <span className="title-txt">{BOOKS[book].name} {chapter}{chapUnit}</span>
          <svg viewBox="0 0 24 24" width="16" height="16"><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" /></svg>
        </button>
        <ToolIcons />
      </header>

      <div className="pager" ref={pagerRef}>
        <div className="scroll" ref={scrollRef} onScroll={onScroll}>
          <ChapterBody
            data={data} book={book} chapter={chapter} highlights={highlights} bookmarked={bookmarked}
            selected={selected} flashV={flashV}
            handlers={{
              onClick: toggle,
              onTouchStart: onVerseTouchStart,
              onTouchMove: onVerseTouchMove,
              onTouchEnd: onVerseTouchEnd,
              onContext: selectRange,
            }}
          />
          <div className="chap-nav">
            <button onClick={() => animStep(-1)} disabled={book === 0 && chapter === 1}>‹ 이전 {chapUnit}</button>
            <button onClick={() => animStep(1)} disabled={book === 65 && chapter === data[65].length}>다음 {chapUnit} ›</button>
          </div>
        </div>
        {ghost && (
          <div className="scroll ghost" ref={ghostRef} style={{ transform: `translateX(${ghost.dir * 100}%)` }} aria-hidden>
            <ChapterBody data={data} book={ghost.book} chapter={ghost.chapter} highlights={highlights} limit={60} />
          </div>
        )}
      </div>

      {selected.length > 0 && (
        <div className="selbar">
          <div className="selbar-top">
            <span className="sel-label">{refLabel(book, chapter, sortedSel, true)}</span>
            <span className="sel-hint">길게 누르면 범위 선택</span>
            <button className="x-btn" onClick={clearSel} aria-label="선택 해제">✕</button>
          </div>
          {hlOpen ? (
            <div className="selbar-actions">
              {HL_COLORS.map(c => <button key={c} className={'hl-swatch hl-' + c} onClick={() => doHighlight(c)} aria-label={c} />)}
              <button onClick={() => doHighlight(null)}>지우기</button>
              <button onClick={() => setHlOpen(false)}>취소</button>
            </div>
          ) : (
            <div className="selbar-actions">
              <button onClick={doCopy}><Ico d="M8 8h11v13H8zM5 16V3h11" />복사</button>
              <button onClick={doShare}><Ico d="M12 3v13M7 8l5-5 5 5M5 14v7h14v-7" />공유</button>
              <button onClick={doBookmark}><Ico d="M6 3h12v18l-6-5-6 5z" />북마크</button>
              <button onClick={() => setHlOpen(true)}><Ico d="M4 20h7M14 4l6 6-9 9H5v-6z" />형광펜</button>
            </div>
          )}
        </div>
      )}

      {pickerOpen && (
        <BookPicker
          data={data}
          currentBook={book}
          onClose={() => setPickerOpen(false)}
          onSelect={ref => { setPickerOpen(false); goTo(index, { book: ref.book, chapter: ref.chapter, verse: ref.verse ?? 1 }); }}
        />
      )}
    </div>
  );
}

interface BodyProps {
  data: BibleData;
  book: number;
  chapter: number;
  highlights: Record<string, HlColor>;
  bookmarked?: Set<number>;
  selected?: number[];
  flashV?: number;
  limit?: number;
  handlers?: {
    onClick: (v: number) => void;
    onTouchStart: (v: number, e: React.TouchEvent) => void;
    onTouchMove: (e: React.TouchEvent) => void;
    onTouchEnd: () => void;
    onContext: (v: number) => void;
  };
}

/** 한 장의 본문 (지금 장 + 밀 때 옆에서 따라 들어오는 장) */
const ChapterBody = memo(function ChapterBody({ data, book, chapter, highlights, bookmarked, selected = [], flashV, limit, handlers: h }: BodyProps) {
  const all = data[book]?.[chapter - 1] ?? [];
  const verses = limit ? all.slice(0, limit) : all;
  return (
    <>
      <h2 className="chap-title">{BOOKS[book].name} {chapter}{book === 18 ? '편' : '장'}</h2>
      <div className="verses">
        {verses.map((t, i) => {
          const v = i + 1;
          const hl = highlights[`${book}:${chapter}:${v}`];
          const m = t.match(/^(\[[^\]]+\])\s*(.*)$/); // 시편 표제 등
          return (
            <p
              key={v}
              data-v={v}
              className={'verse' + (selected.includes(v) ? ' sel' : '') + (hl ? ' hl-' + hl : '') + (flashV === v ? ' flash' : '')}
              onClick={h && (() => h.onClick(v))}
              onTouchStart={h && (e => h.onTouchStart(v, e))}
              onTouchMove={h?.onTouchMove}
              onTouchEnd={h?.onTouchEnd}
              onContextMenu={h && (e => { e.preventDefault(); h.onContext(v); })}
            >
              <span className="vnum">{v}{bookmarked?.has(v) && <span className="bm-dot" />}</span>
              {m ? <><span className="vtitle">{m[1]}</span> {m[2]}</> : t}
            </p>
          );
        })}
      </div>
    </>
  );
});

function Ico({ d }: { d: string }) {
  return <svg viewBox="0 0 24 24" width="22" height="22"><path d={d} fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" /></svg>;
}
