import { useEffect, useRef } from 'react';

/* ---------- 토스트 메시지 ---------- */
type ToastFn = (msg: string) => void;
let toastFn: ToastFn = () => {};
export function registerToast(fn: ToastFn) { toastFn = fn; }
export function toast(msg: string) { toastFn(msg); }

/* ---------- 클립보드 ---------- */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* 아래 방법으로 */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

export async function shareText(text: string): Promise<'shared' | 'copied' | 'failed'> {
  if (navigator.share) {
    try { await navigator.share({ text }); return 'shared'; }
    catch (e) { if ((e as Error).name === 'AbortError') return 'shared'; }
  }
  return (await copyText(text)) ? 'copied' : 'failed';
}

/* ---------- 안드로이드 뒤로가기 버튼 ----------
   앱이 꺼지지 않도록 "보초" 기록을 하나 쌓아 두고, 뒤로 버튼을 누르면
   ① 열린 창(책 선택, 절 선택 등) 닫기 → ② 이전 화면으로 → ③ 처음 화면이면 "한 번 더 누르면 종료" */
const overlayStack: { close: () => void }[] = [];
let rootBack: () => boolean = () => false;
let guard = false;
let exitArmed = false;
let exitTimer: number | undefined;

function pushGuard() {
  if (guard) return;
  try { history.pushState({ skGuard: Date.now() }, ''); guard = true; } catch { /* */ }
}

export function setRootBack(fn: () => boolean) { rootBack = fn; }

let backInit = false;
export function initBackHandling() {
  if (backInit) return;
  backInit = true;
  try { history.replaceState({ skBase: 1 }, ''); } catch { /* */ }
  pushGuard();
  // 크롬은 사용자가 화면을 만진 뒤에 쌓은 기록만 인정하므로, 터치할 때마다 보초가 있는지 확인
  window.addEventListener('pointerdown', () => { if (!exitArmed) pushGuard(); }, { capture: true });
  window.addEventListener('popstate', () => {
    guard = false;
    if (exitArmed) { clearTimeout(exitTimer); exitArmed = false; history.back(); return; }
    const top = overlayStack[overlayStack.length - 1];
    if (top) { top.close(); pushGuard(); return; }
    if (rootBack()) { pushGuard(); return; }
    exitArmed = true;
    toast('뒤로 버튼을 한 번 더 누르면 종료됩니다');
    exitTimer = window.setTimeout(() => { exitArmed = false; pushGuard(); }, 2000);
  });
}

/** open 인 동안 뒤로 버튼을 누르면 close 를 부릅니다 */
export function useBackClose(open: boolean, close: () => void) {
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    if (!open) return;
    const entry = { close: () => closeRef.current() };
    overlayStack.push(entry);
    return () => {
      const i = overlayStack.indexOf(entry);
      if (i >= 0) overlayStack.splice(i, 1);
    };
  }, [open]);
}

/* ---------- 화면 꺼짐 방지 ---------- */
export function useWakeLock(enabled: boolean) {
  useEffect(() => {
    if (!enabled || !('wakeLock' in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    let cancelled = false;
    const request = async () => {
      try {
        if (document.visibilityState === 'visible') {
          lock = await navigator.wakeLock.request('screen');
          if (cancelled) lock.release();
        }
      } catch { /* 지원 안 함 */ }
    };
    request();
    const onVis = () => { if (document.visibilityState === 'visible') request(); };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVis);
      lock?.release().catch(() => {});
    };
  }, [enabled]);
}

export function formatDate(ts: number) {
  const d = new Date(ts);
  return `${d.getFullYear()}.${d.getMonth() + 1}.${d.getDate()}`;
}
