/* 앱 업데이트 (새 버전이 있으면 버튼 표시 → 누르면 업데이트) + 버전 정보 */
import { registerSW } from 'virtual:pwa-register';

declare const __APP_VERSION__: string;
declare const __BUILD_TIME__: string;

export const APP_VERSION = __APP_VERSION__;
export const BUILD_TIME = __BUILD_TIME__; // ISO 시각

let reg: ServiceWorkerRegistration | undefined;
let updateSW: ((reload?: boolean) => Promise<void>) | undefined;

/* 새 버전 준비 상태 (화면에 버튼 표시용) */
let ready = false;
let readyVersion = '';
const subs = new Set<() => void>();
function setReady(v: boolean) { ready = v; subs.forEach(f => f()); }
export function subscribeUpdate(f: () => void) { subs.add(f); return () => { subs.delete(f); }; }
export function updateReady() { return ready; }
export function updateVersion() { return readyVersion; }

function check() {
  if (!navigator.onLine) return;
  reg?.update().catch(() => {});
  fetchLatest().then(l => { if (l && l.buildTime !== BUILD_TIME) { readyVersion = l.version; subs.forEach(f => f()); } });
}

export function startPwa() {
  // 새 서비스 워커가 "업데이트 버튼을 아는 앱이냐"고 물으면 대답 (대답이 있으면 저절로 바꾸지 않고 버튼을 기다림)
  try {
    navigator.serviceWorker?.addEventListener('message', (e: MessageEvent) => {
      if (e.data?.type === 'SK_PING') e.ports?.[0]?.postMessage('button');
    });
    navigator.serviceWorker?.startMessages();
  } catch { /* 무시 */ }
  // v1.6.3: 원어설명을 없앴으므로 폰에 받아 둔 원어 자료를 지워 공간 확보
  try { if ('caches' in window) caches.delete('sk-orig'); } catch { /* 무시 */ }
  updateSW = registerSW({
    immediate: true,
    // 새 버전을 다 받아 두면 → 화면에 "업데이트" 버튼 (자동으로 바꾸지 않음)
    onNeedRefresh() {
      fetchLatest().then(l => { if (l) readyVersion = l.version; setReady(true); });
    },
    onRegisteredSW(_url, r) {
      reg = r;
      // 앱을 다시 볼 때마다, 그리고 1시간마다 새 버전이 있는지 확인
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); });
      setInterval(check, 60 * 60 * 1000);
    },
  });
}

/** 서버에 올라가 있는 최신 버전 */
export async function fetchLatest(): Promise<{ version: string; buildTime: string } | null> {
  try {
    const res = await fetch('/version.json?t=' + Date.now(), { cache: 'no-store' });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/** 새 버전으로 바꾸기 (버튼을 눌렀을 때) */
export async function applyUpdate() {
  if (ready && updateSW) {
    await updateSW(true);                 // 받아 둔 새 버전으로 바꾸고 새로 고침
    setTimeout(() => location.reload(), 3000);
    return;
  }
  // 아직 다 받지 않았으면: 받고 → 준비되면 바로 바꿈
  try { await reg?.update(); } catch { /* */ }
  const w = reg?.waiting;
  if (w) { w.postMessage({ type: 'SKIP_WAITING' }); setTimeout(() => location.reload(), 1500); return; }
  setTimeout(() => location.reload(), 4000);
}

export function formatBuildTime(iso: string) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export const CHANGELOG: [string, string[]][] = [
  ['1.7.0', [
    '🔍 관찰 돕기: 접속사 색 표시(그러므로 · 그러나 · 이는 · ~하려 함 · 만일), 많이 나오는 낱말(이 장 / 이 책), 대조되는 말(영↔육신 등) — 인터넷 없이',
    '✏️ 내 단락 제목: 단락마다 내가 먼저 제목을 붙이고 공식 소제목과 비교',
    '📘 장 깊은 해설: 먼저 생각해 보기(관찰 질문 — 적지 않아도 답 보기), 흐름, 열쇠 구절, 앞뒤 장, 주석가들, 어려운 곳, 성경 전체 속에서',
  ]],
  ['1.6.5', [
    '깊은 해설 더 빠르게: AI 요청을 중요한 순서대로 한 번에 4개까지만 (한꺼번에 보내면 줄을 서서 오히려 느려짐)',
    '요약 · 배경을 가장 먼저 짧게 → 처음 내용이 빨리 보임 · 낱말 풀이는 그 탭을 열 때만',
    '예전 버전(v1.6.4 이하)에서도 이번 한 번은 저절로 새 버전으로 넘어오게 (다음부터는 업데이트 버튼)',
  ]],
  ['1.6.4', [
    '업데이트: 저절로 바뀌지 않고, 새 버전이 있으면 아래에 "눌러서 업데이트" 버튼이 나옴',
    '펼치기 화살표를 꽉 찬 삼각형(▶ ▼)으로',
    '깊은 해설이 빨라짐: 요약 · 주석가별 · 궁금증 풀이를 동시에 써서, 끝난 부분부터 바로 보여 줌',
  ]],
  ['1.6.3', [
    '펼치기 화살표: 접혀 있으면 옆(▶), 누르면 아래(▼)로 돌며 펼쳐짐 (배경 보기 · 책 소개 · 주석 원문)',
    '아래 메뉴줄: 원어설명을 없애고 그 자리에 "관련 구절" — 누르면 바로 관련 구절 목록',
    '해설 화면 번역 비교: 새번역(표준새번역 개정판) + BSB(영어)로, 간격을 촘촘하게',
    '설정: 성경 본문 · 해설 · 메뉴를 각각 따로 상자로 나눔',
  ]],
  ['1.6.2', [
    '주석을 가장 중요하게: 주석가 견해를 의미 있는 주석은 모두(보통 4~7개), 각 4~8문장으로 근거와 함께 더 자세히',
    '"책 전체 흐름"과 "현대 학자들의 견해"는 따로 불러와서 주석 해설이 짧아지지 않게',
    '설정: 설명 줄 간격(해설·주석 등)을 따로 조절 — 기본 1.45로 좁힘',
  ]],
  ['1.6.1', [
    '해설 화면 맨 위에 새번역 · 쉬운성경을 개역개정과 나란히 (인터넷 될 때만, 폰에 저장 안 함)',
    '깊은 해설에 "책 전체 흐름 속에서"와 "현대 학자들의 견해"(AI가 기억으로 정리 · 참고용) 추가',
    'AI가 새번역 · 쉬운성경과의 번역 차이도 참고해서 설명 (예전 해설 저장분은 새로 만듦)',
  ]],
  ['1.6.0', [
    '해설을 깊은 해설로: 고전 주석 7종(칼빈·매튜 헨리·존 길·JFB·아담 클라크·카일·델리취·틴데일)을 근거로',
    '주석가들은 이렇게 봅니다 · 궁금증 풀이 · 해석이 갈리는 곳 · 성경 연결 (적용·기도는 뺌)',
    '이 구절에 대해 더 묻기 (묻고 답한 것은 저장됨) · 주석 원문 보기',
  ]],
  ['1.5.4', [
    '설정: 메뉴 글씨와 설명 글씨 크기를 따로 조절',
    '설정: 성경 제목(예: 전도서 8장) 크기를 따로 조절',
    '아래 페이지 버튼은 글씨 크기와 상관없이 항상 5개가 보이게 (긴 책 이름은 칸에 맞춰 작아짐)',
  ]],
  ['1.5.3', [
    '성경 본문이 아닌 모든 글씨(메뉴·버튼·설명·AI 해설 등)를 20으로 크게',
    '설정 → "메뉴 · 설명 글씨 크기" 슬라이더 추가 (기본 20)',
    '아래 페이지 버튼은 한 화면에 3개씩, 옆으로 밀어서 나머지',
    '절 선택 바는 4개씩 두 줄로',
  ]],
  ['1.5.2', [
    '앱 아이콘 바탕색을 #FFCB05 (밝은 노랑)으로',
    'AI 장 주제가 띄어쓰기 없이 붙어 나오던 문제 고침',
  ]],
  ['1.5.1', [
    '앱 아이콘 바탕색을 진한 노랑으로 (십자가는 갈색)',
  ]],
  ['1.5.0', [
    '해설: 절을 고르고 "해설" → AI 구절 해설 (문맥·배경·뜻·적용·기도)',
    '관련 구절(관주): 연결된 성경 구절을 바로 보고 이동 (인터넷 없이)',
    '낱말·인물: 어려운 낱말 풀이, 인물·지명 설명, 직접 물어보기',
    '장 배경 카드: 장 주제를 누르면 시대·장소·인물·흐름·핵심 구절',
    '성경 66권 소개: 책 선택 화면과 각 책 1장 맨 위',
    '암송 카드: 절을 고르고 "암송" → 북마크 화면의 암송 탭에서 연습',
  ]],
  ['1.4.1', [
    '단락 소제목을 개역개정 성경책의 소제목으로 바꿈: 모든 장에 바로 나오고 인터넷이 필요 없음',
    '장 주제: 만드는 중이면 "만드는 중…", 실패하면 "다시 시도" 버튼이 보임',
  ]],
  ['1.4.0', [
    '복사할 때 장절에 괄호: (마태복음 5:4)',
    '절 선택 메뉴 순서: 복사 · 북마크 · 형광펜 · 원어설명 · 공유',
    '원어설명: 히브리어·헬라어 원문, 단어별 뜻·발음·사전형·문법 분석 + AI 원어 해설',
    '페이지 최대 10개 (6개부터는 아래 버튼을 옆으로 밀기)',
    '앱을 켜면 항상 페이지 1',
    '장 주제와 단락 소제목',
  ]],
  ['1.3.0', [
    '말씀이 화면 좌우에 꽉 차게 (좌우 여백 · 절 번호 위치 설정)',
    '좌우로 밀 때 다음 장이 손가락을 따라 부드럽게 넘어옴',
    '아래 페이지 버튼에 "창세기 2장 10절"처럼 읽는 곳 표시',
    '줄 간격 1.0부터 · 절 간격 조절',
    '문장으로 찾기: AI가 구절을 찾아 설명 (인터넷 필요)',
    '뒤로 버튼 → 이전 화면으로 (처음 화면에서는 한 번 더 누르면 종료)',
    '설정에 현재 버전 · 최신 버전 표시, 자동 업데이트',
  ]],
  ['1.2.0', ['문장으로 찾기 (인터넷 없이)', '로그인 없이 폰마다 따로 저장']],
];
