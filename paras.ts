/* ================================================================
   🌙 읽은 장 알리기 (v1.9.5)
   한 장을 5초 넘게 펴 두면 장 번호만 서버에 알립니다 (사람 정보 없음).
   → 저녁에 서버가 "다음 장"의 해설을 미리 만들어 둡니다.
   ※ v1.9.6: 📝 단락 요약은 없앴습니다 (이 파일 이름은 GitHub에 남은 옛 파일과 맞추려고 그대로 둠)
   ================================================================ */
const pinged = new Set<string>();
export function pingRead(book: number, chapter: number) {
  const ck = `${book}.${chapter}`;
  if (pinged.has(ck) || !navigator.onLine) return;
  pinged.add(ck);
  fetch('/api/read', { method: 'POST', headers: { 'content-type': 'application/json', 'x-sk-app': '1' }, body: JSON.stringify({ ck }), keepalive: true }).catch(() => {});
}
