import { useEffect, useState } from 'react';
import { BibleData, loadBible } from './bible';
import { BOOKS } from './books';
import BookmarksView from './BookmarksView';
import Reader from './Reader';
import SearchView from './SearchView';
import SettingsView from './SettingsView';
import { navBack, openTab, Tab, useStore } from './store';
import { initBackHandling, registerToast, setRootBack, useWakeLock } from './utils';

const THEME_COLORS = { light: '#7a2e2e', sepia: '#6b4a2b', dark: '#15171c' };

export default function App() {
  const [data, setData] = useState<BibleData | null>(null);
  const [error, setError] = useState('');
  const [toastMsg, setToastMsg] = useState('');
  const tab = useStore(s => s.tab);
  const settings = useStore(s => s.settings);
  const pages = useStore(s => s.pages);

  useEffect(() => { loadBible().then(setData).catch(e => setError(String(e.message || e))); }, []);

  useEffect(() => {
    let t: number;
    registerToast(msg => { setToastMsg(msg); clearTimeout(t); t = window.setTimeout(() => setToastMsg(''), 1800); });
    // 안드로이드 뒤로 버튼 → 이전 화면
    setRootBack(navBack);
    initBackHandling();
  }, []);

  // 테마/글자 적용
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = settings.theme;
    root.style.setProperty('--fs', settings.fontSize + 'px');
    root.style.setProperty('--lh', String(settings.lineHeight));
    root.style.setProperty('--vg', settings.verseGap + 'px');
    root.style.setProperty('--side', settings.sideMargin + 'px');
    root.dataset.font = settings.fontFamily;
    root.dataset.vnum = settings.verseNumStyle;
    root.dataset.wrap = settings.wrapMode;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLORS[settings.theme]);
  }, [settings.theme, settings.fontSize, settings.lineHeight, settings.fontFamily, settings.verseGap, settings.sideMargin, settings.verseNumStyle, settings.wrapMode]);

  // 페이지 개수를 줄였을 때
  useEffect(() => {
    if (typeof tab === 'number' && tab >= settings.pageCount) openTab(0, false);
  }, [settings.pageCount, tab]);

  useWakeLock(settings.keepAwake && typeof tab === 'number');

  // 페이지가 많을 때 지금 페이지 버튼이 보이도록
  useEffect(() => {
    if (typeof tab === 'number') document.querySelector('.bottom-nav .nav-btn.on')?.scrollIntoView({ inline: 'nearest', block: 'nearest', behavior: 'smooth' });
  }, [tab, settings.pageCount]);

  if (error) return <div className="splash"><div>⚠️ {error}</div><button onClick={() => location.reload()}>다시 시도</button></div>;
  if (!data) return <div className="splash"><div className="spinner" /><div>성경을 불러오는 중…</div></div>;

  const pageIdx = Array.from({ length: settings.pageCount }, (_, i) => i);

  return (
    <div className="app">
      <main className="main">
        {pageIdx.map(i => <Reader key={i} index={i} data={data} active={tab === i} />)}
        <BookmarksView data={data} active={tab === 'bookmarks'} />
        <SearchView data={data} active={tab === 'search'} />
        <SettingsView active={tab === 'settings'} />
      </main>

      {/* 하단: 페이지마다 지금 읽는 곳(책 · 장 · 절)을 보여 줍니다 */}
      <nav className={'bottom-nav' + (settings.pageCount > 5 ? ' many' : '')}>
        {pageIdx.map(i => {
          const p = pages[i];
          const name = BOOKS[p.book].name;
          const fs = name.length >= 7 ? 10.5 : name.length >= 6 ? 11.5 : name.length >= 5 ? 12.5 : 13.5;
          return (
            <button key={i} className={'nav-btn pg' + (tab === i ? ' on' : '')} onClick={() => openTab(i as Tab)}>
              <span className="pg-book" style={{ fontSize: fs }}>{name}</span>
              <span className="pg-cv">{p.chapter}{p.book === 18 ? '편' : '장'} {p.verse}절</span>
            </button>
          );
        })}
      </nav>

      {toastMsg && <div className="toast">{toastMsg}</div>}
    </div>
  );
}
