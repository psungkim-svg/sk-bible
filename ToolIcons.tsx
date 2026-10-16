import { openTab, Tab, useStore } from './store';

/** 화면 오른쪽 위의 북마크 · 검색 · 설정 버튼 */
export default function ToolIcons() {
  const tab = useStore(s => s.tab);
  return (
    <div className="tools">
      <ToolBtn tab="bookmarks" cur={tab} label="북마크">
        <path d="M6 3h12v18l-6-5-6 5z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
      </ToolBtn>
      <ToolBtn tab="search" cur={tab} label="검색">
        <circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" strokeWidth="2" />
        <path d="M16 16l5 5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
      </ToolBtn>
      <ToolBtn tab="settings" cur={tab} label="설정">
        <path d="M4 7h10M18 7h2M4 17h4M12 17h8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        <circle cx="16" cy="7" r="2.2" fill="none" stroke="currentColor" strokeWidth="2" />
        <circle cx="10" cy="17" r="2.2" fill="none" stroke="currentColor" strokeWidth="2" />
      </ToolBtn>
    </div>
  );
}

function ToolBtn({ tab, cur, label, children }: { tab: Tab; cur: Tab; label: string; children: React.ReactNode }) {
  return (
    <button className={'tool-btn' + (cur === tab ? ' on' : '')} onClick={() => openTab(tab)} aria-label={label}>
      <svg viewBox="0 0 24 24" width="22" height="22">{children}</svg>
      <span>{label}</span>
    </button>
  );
}

/** 펼치기 화살표: 접혀 있으면 옆(▶), 펼치면 아래(▼) */
export function Chev({ open }: { open: boolean }) {
  return (
    <svg className={'chev' + (open ? ' open' : '')} viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true">
      <path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
