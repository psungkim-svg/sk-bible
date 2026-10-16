/* SK-성경 서비스 워커 덧붙임 (v1.6.5)
   새 버전을 받았을 때:
   - 열려 있는 앱이 "업데이트 버튼"을 아는 새 버전이면 → 기다림 (사용자가 버튼을 눌러야 바뀜)
   - 버튼을 모르는 예전 버전(v1.6.4 이하)이면 → 예전처럼 바로 바꿈 (한 번만 이렇게 넘어감) */
self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (!list.length) return;
    const answers = await Promise.all(list.map((c) => new Promise((resolve) => {
      try {
        const ch = new MessageChannel();
        const t = setTimeout(() => resolve(false), 3000);
        ch.port1.onmessage = () => { clearTimeout(t); resolve(true); };
        c.postMessage({ type: 'SK_PING' }, [ch.port2]);
      } catch (e) { resolve(false); }
    })));
    if (answers.some((a) => !a)) await self.skipWaiting();
  })());
});
