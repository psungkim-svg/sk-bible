import { useEffect, useState } from 'react';
import { BibleData, loadBible } from './bible';
import { BOOKS } from './books';
import BookmarksView from './components/BookmarksView';
import Reader from './components/Reader';
import SearchView from './components/SearchView';
import SettingsView from './components/SettingsView';
import { openTab, Tab, useStore } from './store';
import { registerToast, useWakeLock } from './utils';

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
  }, []);

  // 테마/글자 적용
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = settings.theme;
    root.style.setProperty('--fs', settings.fontSize + 'px');
    root.style.setProperty('--lh', String(settings.lineHeight));
    root.dataset.font = settings.fontFamily;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLORS[settings.theme]);
  }, [settings.theme, settings.fontSize, settings.lineHeight, settings.fontFamily]);

  // 페이지 개수를 줄였을 때
  useEffect(() => {
    if (typeof tab === 'number' && tab >= settings.pageCount) openTab(0);
  }, [settings.pageCount, tab]);

  useWakeLock(settings.keepAwake && typeof tab === 'number');

  if (error) return <div className="splash"><div>⚠️ {error}</div><button onClick={() => location.reload()}>다시 시도</button></div>;
  if (!data) return <div className="splash"><div className="spinner" /><div>성경을 불러오는 중…</div></div>;

  const pageIdx = Array.from({ length: settings.pageCount }, (_, i) => i);

  return (
    <div className="app">
      <main className="main">
        {pageIdx.map(i => <Reader key={i} index={i} data={data} active={tab === i} />)}
        {tab === 'bookmarks' && <BookmarksView data={data} />}
        {tab === 'search' && <SearchView data={data} />}
        {tab === 'settings' && <SettingsView />}
      </main>

      <nav className="bottom-nav">
        {pageIdx.map(i => (
          <NavBtn key={i} tab={i as Tab} cur={tab} cls="pg">
            <span className="pg-num">{i + 1}</span>
            <span className="pg-lbl">{BOOKS[pages[i].book].abbr}{pages[i].chapter}</span>
          </NavBtn>
        ))}
        <NavBtn tab="bookmarks" cur={tab}>
          <svg viewBox="0 0 24 24" width="22" height="22"><path d="M6 3h12v18l-6-5-6 5z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" /></svg>
          <span className="pg-lbl">북마크</span>
        </NavBtn>
        <NavBtn tab="search" cur={tab}>
          <svg viewBox="0 0 24 24" width="22" height="22"><circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" strokeWidth="2" /><path d="M16 16l5 5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" /></svg>
          <span className="pg-lbl">검색</span>
        </NavBtn>
        <NavBtn tab="settings" cur={tab}>
          <svg viewBox="0 0 24 24" width="22" height="22"><path d="M4 7h10M18 7h2M4 17h4M12 17h8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /><circle cx="16" cy="7" r="2.2" fill="none" stroke="currentColor" strokeWidth="2" /><circle cx="10" cy="17" r="2.2" fill="none" stroke="currentColor" strokeWidth="2" /></svg>
          <span className="pg-lbl">설정</span>
        </NavBtn>
      </nav>

      {toastMsg && <div className="toast">{toastMsg}</div>}
    </div>
  );
}

function NavBtn({ tab, cur, cls = '', children }: { tab: Tab; cur: Tab; cls?: string; children: React.ReactNode }) {
  return (
    <button className={'nav-btn ' + cls + (cur === tab ? ' on' : '')} onClick={() => openTab(tab)}>
      {children}
    </button>
  );
}
