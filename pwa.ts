/* 앱 자동 업데이트 + 버전 정보 */
import { registerSW } from 'virtual:pwa-register';

declare const __APP_VERSION__: string;
declare const __BUILD_TIME__: string;

export const APP_VERSION = __APP_VERSION__;
export const BUILD_TIME = __BUILD_TIME__; // ISO 시각

let reg: ServiceWorkerRegistration | undefined;

export function startPwa() {
  registerSW({
    immediate: true,
    onRegisteredSW(_url, r) {
      reg = r;
      // 앱을 다시 볼 때마다 새 버전이 있는지 확인 → 있으면 자동으로 바뀝니다
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && navigator.onLine) r?.update().catch(() => {});
      });
      setInterval(() => { if (navigator.onLine) r?.update().catch(() => {}); }, 60 * 60 * 1000);
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

/** 새 버전 받기 */
export async function applyUpdate() {
  try { await reg?.update(); } catch { /* */ }
  // 자동으로 새로 고쳐지지 않으면 직접 새로 고침
  setTimeout(() => location.reload(), 2500);
}

export function formatBuildTime(iso: string) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export const CHANGELOG: [string, string[]][] = [
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
