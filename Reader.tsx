import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { BibleData, buildCopyText, refLabel } from '../bible';
import { BOOKS } from '../books';
import {
  addBookmark, goBack, goTo, HlColor, setHighlight, updatePage, useStore,
} from '../store';
import { copyText, shareText, toast, useBackClose } from '../utils';
import BookPicker from './BookPicker';

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
  const step = (dir: 1 | -1) => {
    let b = book, c = chapter + dir;
    if (c < 1) { if (b === 0) return; b -= 1; c = data[b].length; }
    else if (c > data[b].length) { if (b === 65) return; b += 1; c = 1; }
    goTo(index, { book: b, chapter: c, verse: 1 }, { record: false, flash: false });
  };

  /* ---------- 스와이프 ---------- */
  const touch = useRef<{ x: number; y: number; t: number } | null>(null);
  const onTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0];
    touch.current = { x: t.clientX, y: t.clientY, t: Date.now() };
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    const s = touch.current;
    touch.current = null;
    if (!s || !settings.swipe || selected.length) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - s.x, dy = t.clientY - s.y;
    if (Math.abs(dx) > 80 && Math.abs(dx) > Math.abs(dy) * 2 && Date.now() - s.t < 700) step(dx < 0 ? 1 : -1);
  };

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
          <span className="pg-badge">{index + 1}</span>
          {BOOKS[book].name} {chapter}{chapUnit}
          <svg viewBox="0 0 24 24" width="16" height="16"><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" /></svg>
        </button>
        <button className="icon-btn" onClick={() => step(-1)} aria-label="이전 장">
          <svg viewBox="0 0 24 24" width="22" height="22"><path d="M14 6l-6 6 6 6" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" /></svg>
        </button>
        <button className="icon-btn" onClick={() => step(1)} aria-label="다음 장">
          <svg viewBox="0 0 24 24" width="22" height="22"><path d="M10 6l6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" /></svg>
        </button>
      </header>

      <div className="scroll" ref={scrollRef} onScroll={onScroll} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
        <h2 className="chap-title">{BOOKS[book].name} {chapter}{chapUnit}</h2>
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
                onClick={() => toggle(v)}
                onTouchStart={e => onVerseTouchStart(v, e)}
                onTouchMove={onVerseTouchMove}
                onTouchEnd={onVerseTouchEnd}
                onContextMenu={e => { e.preventDefault(); selectRange(v); }}
              >
                <span className="vnum">{v}{bookmarked.has(v) && <span className="bm-dot" />}</span>
                {m ? <><span className="vtitle">{m[1]}</span> {m[2]}</> : t}
              </p>
            );
          })}
        </div>
        <div className="chap-nav">
          <button onClick={() => step(-1)} disabled={book === 0 && chapter === 1}>‹ 이전 {chapUnit}</button>
          <button onClick={() => step(1)} disabled={book === 65 && chapter === data[65].length}>다음 {chapUnit} ›</button>
        </div>
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

function Ico({ d }: { d: string }) {
  return <svg viewBox="0 0 24 24" width="22" height="22"><path d={d} fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" /></svg>;
}
