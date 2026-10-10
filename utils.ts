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

/* ---------- 안드로이드 뒤로가기 버튼으로 창 닫기 ---------- */
export function useBackClose(open: boolean, close: () => void) {
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    if (!open) return;
    let popped = false;
    history.pushState({ overlay: Date.now() }, '');
    const onPop = () => { popped = true; closeRef.current(); };
    window.addEventListener('popstate', onPop);
    return () => {
      window.removeEventListener('popstate', onPop);
      if (!popped) history.back();
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
