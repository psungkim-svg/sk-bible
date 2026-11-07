import { useSyncExternalStore } from 'react';
import { openTab, Tab, useStore } from './store';

/* ---------- ⏬ 자동 스크롤 (켜짐/멈춤 — 앱을 다시 켜면 꺼진 상태) ---------- */
export interface AutoState { on: boolean; paused: boolean }
let auto: AutoState = { on: false, paused: false };
const autoL = new Set<() => void>();
export function setAuto(p: Partial<AutoState>) { auto = { ...auto, ...p }; autoL.forEach(l => l()); }
export function useAuto(): AutoState {
  return useSyncExternalStore(cb => { autoL.add(cb); return () => { autoL.delete(cb); }; }, () => auto);
}

/** 화면 오른쪽 위의 (자동 스크롤) · 북마크 · 검색 · 설정 버튼 */
export default function ToolIcons() {
  const tab = useStore(s => s.tab);
  const a = useAuto();
  return (
    <div className="tools">
      {typeof tab === 'number' && (
        <button className={'tool-btn' + (a.on ? ' on' : '')} aria-label="자동 스크롤"
          onClick={() => setAuto(a.on ? { on: false } : { on: true, paused: false })}>
          <svg viewBox="0 0 24 24" width="22" height="22">
            <path d="M6 5l6 6 6-6M6 12l6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span>자동</span>
        </button>
      )}
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

/** 펼치기 화살표 (꽉 찬 삼각형): 접혀 있으면 옆(▶), 펼치면 아래(▼) */
export function Chev({ open }: { open: boolean }) {
  return (
    <svg className={'chev' + (open ? ' open' : '')} viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true">
      <path d="M7 4.5L19 12L7 19.5Z" fill="currentColor" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}
