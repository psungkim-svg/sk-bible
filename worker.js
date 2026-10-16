/* ================================================================
   SK-성경 서버 (Cloudflare Worker)
   - 앱 화면/파일: 그대로 전달 (dist 폴더)
   - /api/ask : "문장으로 찾기" AI 설명 (Cloudflare Workers AI, 무료 사용량 안에서)
   ================================================================ */

// 위에서부터 차례로 시도합니다 (첫 번째가 안 되면 두 번째)
const MODELS = [
  '@cf/openai/gpt-oss-120b',
  '@cf/meta/llama-4-scout-17b-16e-instruct',
];

const FIND_PROMPT = `당신은 한국어 성경(개역개정) 구절 찾기 도우미입니다.
사용자의 질문은 휴대폰 음성 입력으로 쓴 것이라 소리가 비슷한 엉뚱한 단어가 섞여 있을 수 있습니다.
(예: 노화→노아, 달리→다니엘, 권원→구원, 성역구절→성경구절, 이따→있다, 요부→욥)
할 일:
1) 질문을 바르게 고쳐 씁니다.
2) 성경 지식을 사용해, 질문이 가리키는 성경 구절을 찾습니다.
   아래 "앱 검색 후보"는 글자 모양이 비슷한 구절일 뿐이라 정답이 아닐 수 있습니다.
반드시 아래 형식의 JSON 하나만 출력하세요. 다른 글은 절대 쓰지 마세요.
{"corrected":"바르게 고친 질문","refs":["겔 14:14","겔 14:20"]}
- refs: 가장 알맞은 순서로 1~6개, "책이름 장:절" 형식 (예: "요한복음 3:16", "시 23:1", "겔 14:14-20")`;

const EXPLAIN_PROMPT = `당신은 한국어 성경(개역개정) 해설 도우미입니다.
사용자는 휴대폰 음성 입력으로 질문해서 오타가 있을 수 있습니다.
아래 "확인된 구절"은 개역개정 실제 본문입니다. 이 중에서 질문에 해당하는 구절을 골라 설명하세요.
반드시 아래 형식의 JSON 하나만 출력하세요. 다른 글은 절대 쓰지 마세요.
{"matches":["에스겔 14:14","에스겔 14:20"],
 "intro":"질문하신 내용은 구약 성경 에스겔 14장 14절과 20절 말씀입니다.",
 "interpretation":"질문에서 '노화와 모세'라고 표현하신 부분은 성경의 대표적인 의인인 노아, 다니엘, 욥을 뜻하며, ... (질문의 표현이 무엇을 뜻하는지와 구절의 뜻을 2~3문장으로)",
 "points":[{"title":"구원의 개인성","body":"..."},{"title":"심판의 엄중함","body":"..."}]}
규칙:
- matches 에는 "확인된 구절" 목록에 있는 구절만, 관련이 큰 순서로 1~4개 넣습니다.
- 맞는 구절이 없으면 matches 는 [] 로 하고, intro 에 "정확히 일치하는 구절을 찾지 못했습니다"라고 쓴 뒤 다시 물어볼 방법을 짧게 안내합니다.
- points 는 "구절의 핵심 의미" 2~3개, 각 body 는 1~3문장.
- 존댓말(~입니다)로 쓰고, 성경 본문과 일반적인 해석에 없는 내용은 지어내지 마세요.`;

const TOPIC_PROMPT = `당신은 한국어 성경(개역개정) 편집자입니다.
주어진 장 전체의 주제를 한국어 한 문장(40자 이내)으로 쓰세요.
- 그 장의 핵심 내용이 한눈에 들어오게, 개역개정 낱말을 살려 자연스럽게 씁니다.
  예) 마태복음 5장 → "산상수훈: 천국 백성의 복과 더 나은 의"
- 단락 소제목이 주어지면 참고하세요.
- 한국어 맞춤법과 띄어쓰기를 반드시 지키세요. (낱말 사이를 붙여 쓰지 마세요)
반드시 아래 형식의 JSON 하나만 출력하세요. 다른 글은 절대 쓰지 마세요.
{"topic":"장 주제"}`;

const VERSE_PROMPT = `당신은 신학대학원에서 성경 주해를 가르치는 교수입니다. 독자는 성경을 오래 읽어 온 성도이며, 뻔한 설교 요약이 아니라 "이 구절이 정확히 무슨 뜻이고, 왜 그렇게 읽는지"를 깊고 구체적으로 알고 싶어 합니다.
아래에 개역개정 구절, 앞뒤 본문, 그리고 고전 주석들의 영어 원문 발췌가 주어집니다.
반드시 아래 형식의 JSON 하나만 출력하세요. 다른 글은 절대 쓰지 마세요.
{"summary":"이 구절이 실제로 말하는 내용을 구체적으로 2~4문장 (누가, 누구에게, 무엇을, 어떤 흐름에서)",
 "background":"이 구절을 이해하는 데 꼭 필요한 구체적 사실 — 인물·장소·관습·제도·사건·연대 등 2~5문장. 꼭 필요한 것이 없으면 빈 문자열",
 "commentators":[{"who":"주석 이름 (주어진 이름 그대로)","point":"그 주석이 이 구절에서 실제로 말하는 구체적 논점과 그 근거 4~8문장"}],
 "questions":[{"q":"이 구절을 꼼꼼히 읽는 사람이 실제로 품을 만한 궁금증","a":"본문·다른 성경 구절·주석을 근거로 든 구체적인 답 3~7문장"}],
 "debates":[{"issue":"해석이 갈리는 지점","views":[{"view":"견해 내용","who":"주로 누구의 견해인지 (주석 이름, 또는 '일부 학자')","why":"그 근거 1~3문장"}]}],
 "links":[{"ref":"성경 구절 (예: 민 21:8-9)","why":"이 구절과 어떻게 이어지는지 — 구약 배경, 인용, 같은 낱말의 다른 용례, 예언과 성취 등 1~2문장"}]}
규칙:
- 적용, 교훈, 권면, 다짐, 기도, "우리는 ~해야 합니다", "오늘 우리에게" 같은 말은 절대 쓰지 마세요. 오직 본문의 뜻과 근거만 다룹니다.
- 어느 구절에나 할 수 있는 일반론은 쓰지 마세요. 이 구절에만 해당하는 구체적인 내용(낱말, 문법, 역사적 사실, 앞뒤 흐름, 다른 구절과의 관계)을 씁니다.
- commentators가 이 해설에서 가장 중요합니다. 주어진 주석 가운데 이 구절에 대해 의미 있는 말이 있는 것은 모두 (보통 4~7개) 다루세요. 각 주석이 이 구절에 대해 무엇을 주장하고 어떤 근거(원어 낱말, 문법, 다른 성경 구절, 역사적 사실, 논리)를 드는지 발췌 내용을 충실히 살려, 주석마다 서로 다른 특색이 드러나게 씁니다. 여러 주석이 같은 말을 하면 그 공통점을 밝히고 각자 더한 점을 쓰세요. 주석에 없는 말을 그 주석의 이름으로 지어내면 절대 안 됩니다. 주석 자료가 없으면 빈 배열.
- 영어 주석은 자연스러운 한국어로 옮기고, 성경 인용은 개역개정 표현을 따르세요. 인물 이름은 한국 교회에서 쓰는 표기(칼빈, 매튜 헨리 등)로.
- questions 3~5개. debates는 실제로 견해가 갈리는 곳만 0~3개 (각 2~3개 견해를 공정하게). links 3~6개.
- '다른 번역'(새번역·영어 BSB)이 주어지면, 개역개정과 뜻이 달라 보이는 곳이 있을 때 questions나 summary에서 그 차이와 이유를 설명하세요.
- 존댓말(~입니다)로 쓰고, 확실하지 않은 사실은 지어내지 마세요.`;

/* ---- v1.6.4: 깊은 해설을 여러 요청으로 나눠 동시에 (빨라짐) ---- */
const DEEP_ROLE = `당신은 신학대학원에서 성경 주해를 가르치는 교수입니다. 독자는 성경을 오래 읽어 온 성도이며, 뻔한 설교 요약이 아니라 "이 구절이 정확히 무슨 뜻이고, 왜 그렇게 읽는지"를 깊고 구체적으로 알고 싶어 합니다.`;
const DEEP_RULES = `- 적용, 교훈, 권면, 다짐, 기도, "우리는 ~해야 합니다", "오늘 우리에게" 같은 말은 절대 쓰지 마세요. 오직 본문의 뜻과 근거만 다룹니다.
- 어느 구절에나 할 수 있는 일반론은 쓰지 마세요. 이 구절에만 해당하는 구체적인 내용(낱말, 문법, 역사적 사실, 앞뒤 흐름, 다른 구절과의 관계)을 씁니다.
- 영어 자료는 자연스러운 한국어로 옮기고, 성경 인용은 개역개정 표현을 따르세요. 인물 이름은 한국 교회에서 쓰는 표기(칼빈, 매튜 헨리 등)로.
- 존댓말(~입니다)로 쓰고, 확실하지 않은 사실은 지어내지 마세요.`;

const VERSE_CORE_PROMPT = `${DEEP_ROLE}
아래에 개역개정 구절, 다른 번역, 앞뒤 본문이 주어집니다.
반드시 아래 형식의 JSON 하나만 출력하세요. 다른 글은 절대 쓰지 마세요.
{"summary":"이 구절이 실제로 말하는 내용을 구체적으로 2~4문장 (누가, 누구에게, 무엇을, 어떤 흐름에서)",
 "background":"이 구절을 이해하는 데 꼭 필요한 구체적 사실 — 인물·장소·관습·제도·사건·연대 등 2~5문장. 꼭 필요한 것이 없으면 빈 문자열",
 "links":[{"ref":"성경 구절 (예: 민 21:8-9)","why":"이 구절과 어떻게 이어지는지 — 구약 배경, 인용, 같은 낱말의 다른 용례, 예언과 성취 등 1~2문장"}]}
규칙:
${DEEP_RULES}
- links 3~6개.`;

const VERSE_QA_PROMPT = `${DEEP_ROLE}
아래에 개역개정 구절, 다른 번역(새번역·영어 BSB), 앞뒤 본문, 고전 주석들의 영어 원문 발췌가 주어집니다.
반드시 아래 형식의 JSON 하나만 출력하세요. 다른 글은 절대 쓰지 마세요.
{"questions":[{"q":"이 구절을 꼼꼼히 읽는 사람이 실제로 품을 만한 궁금증","a":"본문·다른 성경 구절·주석을 근거로 든 구체적인 답 3~6문장"}],
 "debates":[{"issue":"해석이 갈리는 지점","views":[{"view":"견해 내용","who":"주로 누구의 견해인지 (주석 이름, 또는 '일부 학자')","why":"그 근거 1~3문장"}]}]}
규칙:
${DEEP_RULES}
- questions 3~5개. debates는 실제로 견해가 갈리는 곳만 0~3개 (각 2~3개 견해를 공정하게).
- 주석에 없는 말을 그 주석의 이름으로 지어내면 절대 안 됩니다.
- 다른 번역이 개역개정과 뜻이 달라 보이는 곳이 있으면, 그 차이와 이유를 questions에서 설명하세요.`;

const VERSE_COMM_PROMPT = `${DEEP_ROLE}
아래에 개역개정 구절과, 고전 주석 하나의 영어 원문 발췌가 주어집니다.
이 주석이 이 구절에 대해 실제로 말하는 내용을 한국어로 정리하세요.
반드시 아래 형식의 JSON 하나만 출력하세요. 다른 글은 절대 쓰지 마세요.
{"point":"이 주석이 이 구절에서 주장하는 구체적 논점과 그 근거(원어 낱말, 문법, 다른 성경 구절, 역사적 사실, 논리) 4~8문장. 발췌 내용을 충실히 살려 이 주석만의 특색이 드러나게"}
규칙:
${DEEP_RULES}
- 발췌에 없는 말을 이 주석의 이름으로 지어내면 절대 안 됩니다.
- 발췌가 이 구절과 상관없는 내용뿐이면 {"point":""} 를 출력하세요.`;

const VERSE_EXTRA_PROMPT = `당신은 신학대학원에서 성경 주해를 가르치는 교수입니다. 독자는 성경을 오래 읽어 온 성도입니다.
아래에 개역개정 구절, 앞뒤 본문, 그 책의 소개(주제·구조)가 주어집니다.
반드시 아래 형식의 JSON 하나만 출력하세요. 다른 글은 절대 쓰지 마세요.
{"bookflow":"이 구절이 그 책 전체의 구조와 주제 안에서 어떤 자리에 있고 어떤 역할을 하는지, 앞뒤 단락·책의 목적과 어떻게 이어지는지 3~5문장",
 "modern":[{"who":"현대 학자 이름 (예: D. A. 카슨)","point":"그 학자가 이 구절에 대해 펼친 것으로 잘 알려진 해석 2~4문장"}]}
규칙:
- bookflow: 주어진 '책 소개'(주제·구조)를 참고해, 이 구절이 책 전체에서 맡은 역할을 구체적으로 씁니다.
- modern: 20세기 이후 이 책의 대표적인 현대 주석가·학자(예: D. A. 카슨, 더글러스 무, 크레이그 키너, 고든 웬함, 브루스 월키, 리처드 보컴, N. T. 라이트, 레온 모리스, F. F. 브루스 등 그 책을 실제로 연구한 학자) 가운데, 이 구절에 대한 견해를 확실히 아는 학자만 2~4명. 확실하지 않으면 학자 이름을 지어내지 말고 '현대 학자들 다수' 또는 '일부 현대 학자'로 쓰세요. 고전 주석 발췌와 같은 내용을 되풀이하지 말고 현대 연구(고고학, 고대 근동·제2성전기 유대교 배경, 원문 연구, 문학 구조)가 더해 준 통찰을 담으세요.
- 적용·교훈·기도는 쓰지 마세요. 존댓말(~입니다)로 쓰고, 확실하지 않은 사실은 지어내지 마세요.`;

const VERSE_ASK_PROMPT = `당신은 신학대학원에서 성경 주해를 가르치는 교수입니다. 성도가 특정 성경 구절에 대해 질문합니다.
주어진 구절, 앞뒤 본문, 고전 주석 발췌, 앞서 나눈 내용을 참고해 질문에 깊고 구체적으로 답하세요.
반드시 아래 형식의 JSON 하나만 출력하세요. 다른 글은 절대 쓰지 마세요.
{"answer":"질문에 대한 답 4~10문장. 근거(본문, 다른 성경 구절, 주석 이름)를 밝히며 구체적으로","refs":["근거로 든 성경 구절 (예: 롬 5:8)"]}
규칙: 적용·교훈·기도는 쓰지 말고 질문에 대한 답만 합니다. 견해가 갈리면 여러 견해를 공정하게 소개합니다. 주석에 없는 말을 주석 이름으로 지어내지 말고, 모르는 것은 모른다고 하세요. 존댓말로 씁니다.`;

/** 폰이 보내 준 주석 발췌를 정리 (최대 8개, 합계 약 14000자) */
function sourcesText(list) {
  let total = 0;
  const out = [];
  for (const s of (Array.isArray(list) ? list : []).slice(0, 8)) {
    const who = clip(s?.who, 40).trim();
    const text = clip(s?.text, 2400).trim();
    if (!who || !text || total + text.length > 14000) continue;
    total += text.length;
    out.push(`[${who}]\n${text}`);
  }
  return out.length ? out.join('\n\n') : '(주석 자료 없음)';
}

const LEX_PROMPT = `당신은 한국어 성경(개역개정) 교사입니다.
주어진 구절에서
1) 요즘 사람이 이해하기 어려운 낱말(옛말, 한자어, 성경 특유의 말: 예 궁창, 긍휼, 기업, 화목제, 할례, 장자권)을 골라 쉬운 말로 풀고,
2) 등장하는 인물·지명·민족·절기 등 고유명사를 설명하세요.
반드시 아래 형식의 JSON 하나만 출력하세요. 다른 글은 절대 쓰지 마세요.
{"words":[{"w":"낱말 (본문에 나온 그대로)","mean":"쉬운 뜻 (짧게)","note":"필요하면 한두 문장 보충 (없으면 빈 문자열)"}],
 "names":[{"name":"이름","kind":"인물|지명|민족|절기|기타","desc":"누구/어디인지, 성경에서의 중요성 2~3문장","refs":["관련 대표 구절 (예: 창 12:1)"]}]}
규칙: 어려운 낱말은 0~8개, 고유명사는 본문에 나온 것만. 존댓말로 쓰고 지어내지 마세요.`;

const TERM_PROMPT = `당신은 성경 사전 편집자입니다. 사용자가 묻는 성경 낱말·인물·지명·개념을 한국어로 쉽게 설명하세요.
반드시 아래 형식의 JSON 하나만 출력하세요. 다른 글은 절대 쓰지 마세요.
{"title":"표제어 (개역개정 표기)","kind":"인물|지명|낱말|개념|절기|기타","desc":"뜻과 성경에서의 의미·주요 사건 3~6문장","refs":["대표 구절 2~5개 (예: 창 12:1)"]}
규칙: 존댓말로 쓰고, 성경에 없는 내용이나 확실하지 않은 내용은 지어내지 마세요.`;

const BG_PROMPT = `당신은 성경 배경을 잘 아는 성경 교사입니다. 주어진 성경 한 장의 배경 카드를 한국어로 만드세요.
반드시 아래 형식의 JSON 하나만 출력하세요. 다른 글은 절대 쓰지 마세요.
{"summary":"이 장의 내용 요약 2~3문장",
 "era":"시대 (예: 주전 1000년경 다윗 왕 시대 / 주후 30년경 예수님 공생애)",
 "place":"주요 장소",
 "people":"주요 등장인물 (쉼표로)",
 "flow":"앞 장과의 연결과 성경 전체 흐름 속 의미 1~2문장",
 "key":[{"v":절번호,"why":"이 절이 중요한 이유 한 문장"}]}
규칙: key 는 1~3개. 존댓말로 쓰고, 확실하지 않은 연대는 '~경' 또는 '전통적으로'라고 쓰세요. 지어내지 마세요.`;

const ORIGINAL_PROMPT = `당신은 성경 원어(히브리어·아람어·헬라어) 전문가이자 친절한 목회자입니다.
주어진 구절의 원문 단어 분석 자료(STEPBible: 원어, 음역, 영어 직역, 스트롱 번호, 문법, 사전형)를 바탕으로
성경을 사랑하는 일반 성도가 이해할 수 있게 한국어로 원어 설명과 분석을 쓰세요.
반드시 아래 형식의 JSON 하나만 출력하세요. 다른 글은 절대 쓰지 마세요.
{"summary":"이 구절을 원문으로 볼 때의 핵심을 2~4문장",
 "words":[{"i":0,"ko":"한국어 뜻(짧게)","pron":"한글 발음","note":"중요한 단어만: 어원·쓰임·다른 구절 용례·신학적 의미 1~3문장"}],
 "points":[{"title":"짧은 제목","body":"2~4문장"}]}
규칙:
- words: 모든 단어(i = 0부터 차례대로)에 대해 ko 와 pron 을 씁니다. note 는 뜻이 깊은 핵심 단어 2~5개에만 씁니다.
- pron: 원어를 한글로 읽는 소리 (예: 마카리오이, 베레쉬트, 엘로힘).
- points: 2~4개. 핵심 단어의 깊은 뜻, 문법(시제·태·어순 등)이 주는 의미, 개역개정 번역에서 잘 드러나지 않는 뉘앙스 등.
- 존댓말(~입니다)로 쓰고, 확실하지 않은 내용은 지어내지 마세요.`;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

function clip(s, n) { return String(s ?? '').slice(0, n); }

/** 모델마다 답 모양이 조금씩 달라서 글자만 꺼냅니다 */
function extractText(r) {
  if (!r) return '';
  if (typeof r === 'string') return r;
  if (typeof r.response === 'string') return r.response;
  if (r.response && typeof r.response === 'object') return JSON.stringify(r.response);
  const c = r.choices?.[0]?.message?.content;
  if (typeof c === 'string') return c;
  if (typeof r.output_text === 'string') return r.output_text;
  if (Array.isArray(r.output)) {
    for (const o of r.output) {
      if (o?.type === 'message' && Array.isArray(o.content)) {
        for (const p of o.content) if (typeof p?.text === 'string') return p.text;
      }
    }
  }
  return '';
}

/** 글 속에서 JSON 부분만 찾아 읽기 */
function parseJson(text) {
  if (!text) return null;
  const t = text.replace(/```(?:json)?/gi, '');
  const a = t.indexOf('{');
  const b = t.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  try { return JSON.parse(t.slice(a, b + 1)); } catch { return null; }
}

/** 띄어쓰기 없이 길게 붙은 문장인지 (예: "하나님이일곱날안식...") */
function isSquashed(t) {
  return t.replace(/[^가-힣]/g, '').length > 12 && !/\s/.test(t);
}

async function runLLM(env, system, user, opt = {}) {
  let lastErr = new Error('AI를 사용할 수 없습니다');
  for (const model of MODELS) {
    try {
      const r = await env.AI.run(model, {
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        max_tokens: opt.max_tokens || 6000,
        temperature: 0.2,
      });
      const out = parseJson(extractText(r));
      if (out) return out;
      lastErr = new Error('AI 답을 읽지 못했습니다');
    } catch (e) {
      lastErr = e instanceof Error ? e : new Error(String(e));
    }
  }
  throw lastErr;
}

async function handleAsk(request, env) {
  if (request.headers.get('x-sk-app') !== '1') return json({ error: 'forbidden' }, 403);
  if (!env.AI) return json({ error: 'AI 연결(binding)이 없습니다. wrangler.jsonc 를 확인하세요.' }, 500);
  let body;
  try { body = await request.json(); } catch { return json({ error: '잘못된 요청' }, 400); }
  const q = clip(body.q, 400).trim();
  if (!q) return json({ error: '질문이 비어 있습니다' }, 400);

  try {
    if (body.step === 'topic') {
      const verses = (Array.isArray(body.verses) ? body.verses : []).slice(0, 200);
      const per = verses.length > 60 ? 50 : 120;
      const text = verses.map((t, i) => `${i + 1} ${clip(t, per)}`).join('\n').slice(0, 9000);
      const heads = (Array.isArray(body.heads) ? body.heads : []).slice(0, 30)
        .map(h => `${Number(h?.[0]) || 1}절 ${clip(h?.[1], 80)}`).join(' / ');
      const ask = `${clip(body.book, 20)} ${Number(body.chapter) || 1}장 (모두 ${verses.length}절)\n단락 소제목: ${heads || '(없음)'}\n\n본문:\n${text}`;
      // 가끔 AI가 띄어쓰기 없이 붙여 쓰는 경우가 있어, 그러면 한 번 더 요청
      let topic = '';
      for (let tries = 0; tries < 2; tries++) {
        const out = await runLLM(env, TOPIC_PROMPT, ask);
        topic = clip(out.topic, 120).trim();
        if (!topic || !isSquashed(topic)) break;
        if (tries === 1) topic = '';
      }
      if (!topic) return json({ error: 'AI가 주제를 쓰지 않았습니다' }, 502);
      return json({ topic });
    }
    if (body.step === 'verse') {
      const out = await runLLM(env, VERSE_PROMPT,
        `구절: ${q}\n${clip(body.text, 3000)}\n\n다른 번역:\n${clip(body.others, 3000) || '(없음)'}\n\n앞뒤 본문(참고):\n${clip(body.around, 3000)}\n\n고전 주석 발췌(영어 원문):\n${sourcesText(body.sources)}`,
        { max_tokens: 12000 });
      const arr = (x, n) => (Array.isArray(x) ? x : []).slice(0, n);
      const res = {
        summary: clip(out.summary, 1200),
        background: clip(out.background, 1500),
        commentators: arr(out.commentators, 8).map(c => ({ who: clip(c?.who, 40), point: clip(c?.point, 2500) })).filter(c => c.who && c.point),
        questions: arr(out.questions, 6).map(x => ({ q: clip(x?.q, 300), a: clip(x?.a, 2000) })).filter(x => x.q && x.a),
        debates: arr(out.debates, 4).map(d => ({
          issue: clip(d?.issue, 300),
          views: arr(d?.views, 4).map(v => ({ view: clip(v?.view, 800), who: clip(v?.who, 80), why: clip(v?.why, 800) })).filter(v => v.view),
        })).filter(d => d.issue && d.views.length),
        links: arr(out.links, 8).map(l => ({ ref: clip(l?.ref, 40), why: clip(l?.why, 600) })).filter(l => l.ref),
      };
      if (!res.summary && !res.questions.length) return json({ error: 'AI가 해설을 쓰지 못했습니다. 다시 시도해 주세요' }, 502);
      return json(res);
    }
    if (body.step === 'verse-core') {
      const out = await runLLM(env, VERSE_CORE_PROMPT,
        `구절: ${q}\n${clip(body.text, 3000)}\n\n다른 번역:\n${clip(body.others, 3000) || '(없음)'}\n\n앞뒤 본문(참고):\n${clip(body.around, 3000)}`,
        { max_tokens: 5000 });
      const res = {
        summary: clip(out.summary, 1200),
        background: clip(out.background, 1500),
        links: (Array.isArray(out.links) ? out.links : []).slice(0, 8).map(l => ({ ref: clip(l?.ref, 40), why: clip(l?.why, 600) })).filter(l => l.ref),
      };
      if (!res.summary) return json({ error: 'AI가 해설을 쓰지 못했습니다. 다시 시도해 주세요' }, 502);
      return json(res);
    }
    if (body.step === 'verse-qa') {
      const out = await runLLM(env, VERSE_QA_PROMPT,
        `구절: ${q}\n${clip(body.text, 3000)}\n\n다른 번역:\n${clip(body.others, 3000) || '(없음)'}\n\n앞뒤 본문(참고):\n${clip(body.around, 3000)}\n\n고전 주석 발췌(영어 원문):\n${sourcesText(body.sources)}`,
        { max_tokens: 8000 });
      const arr = (x, n) => (Array.isArray(x) ? x : []).slice(0, n);
      const res = {
        questions: arr(out.questions, 6).map(x => ({ q: clip(x?.q, 300), a: clip(x?.a, 2000) })).filter(x => x.q && x.a),
        debates: arr(out.debates, 4).map(d => ({
          issue: clip(d?.issue, 300),
          views: arr(d?.views, 4).map(v => ({ view: clip(v?.view, 800), who: clip(v?.who, 80), why: clip(v?.why, 800) })).filter(v => v.view),
        })).filter(d => d.issue && d.views.length),
      };
      if (!res.questions.length) return json({ error: 'AI가 궁금증 풀이를 쓰지 못했습니다' }, 502);
      return json(res);
    }
    if (body.step === 'verse-comm') {
      const who = clip(body.who, 40);
      const out = await runLLM(env, VERSE_COMM_PROMPT,
        `구절: ${q}\n${clip(body.text, 2000)}\n\n앞뒤 본문(참고):\n${clip(body.around, 1500)}\n\n주석: ${who}\n발췌(영어 원문):\n${clip(body.source, 4000)}`,
        { max_tokens: 4000 });
      return json({ who, point: clip(out.point, 2500) });
    }
    if (body.step === 'verse-extra') {
      const out = await runLLM(env, VERSE_EXTRA_PROMPT,
        `구절: ${q}\n${clip(body.text, 3000)}\n\n앞뒤 본문(참고):\n${clip(body.around, 3000)}\n\n책 소개:\n${clip(body.bookinfo, 1200) || '(없음)'}`,
        { max_tokens: 5000 });
      const res = {
        bookflow: clip(out.bookflow, 1500),
        modern: (Array.isArray(out.modern) ? out.modern : []).slice(0, 5).map(c => ({ who: clip(c?.who, 40), point: clip(c?.point, 1200) })).filter(c => c.who && c.point),
      };
      if (!res.bookflow && !res.modern.length) return json({ error: 'AI가 내용을 쓰지 못했습니다' }, 502);
      return json(res);
    }
    if (body.step === 'verse-ask') {
      const question = clip(body.question, 500).trim();
      if (!question) return json({ error: '질문이 비어 있습니다' }, 400);
      const out = await runLLM(env, VERSE_ASK_PROMPT,
        `구절: ${q}\n${clip(body.text, 3000)}\n\n앞뒤 본문(참고):\n${clip(body.around, 3000)}\n\n앞서 나눈 내용:\n${clip(body.brief, 2500) || '(없음)'}\n\n고전 주석 발췌(영어 원문):\n${sourcesText(body.sources)}\n\n질문: ${question}`,
        { max_tokens: 6000 });
      const answer = clip(out.answer, 4000).trim();
      if (!answer) return json({ error: 'AI가 답을 쓰지 못했습니다' }, 502);
      return json({ answer, refs: (Array.isArray(out.refs) ? out.refs : []).slice(0, 8).map(r => clip(r, 40)).filter(Boolean) });
    }
    if (body.step === 'lexicon') {
      const out = await runLLM(env, LEX_PROMPT, `구절: ${q}\n${clip(body.text, 3000)}`);
      return json({
        words: (Array.isArray(out.words) ? out.words : []).slice(0, 10)
          .map(w => ({ w: clip(w?.w, 40), mean: clip(w?.mean, 200), note: clip(w?.note, 400) })).filter(w => w.w && w.mean),
        names: (Array.isArray(out.names) ? out.names : []).slice(0, 10)
          .map(n => ({ name: clip(n?.name, 40), kind: clip(n?.kind, 10), desc: clip(n?.desc, 800), refs: (Array.isArray(n?.refs) ? n.refs : []).slice(0, 5).map(r => clip(r, 30)) }))
          .filter(n => n.name && n.desc),
      });
    }
    if (body.step === 'term') {
      const out = await runLLM(env, TERM_PROMPT, `물어본 말: ${q}\n(읽던 본문: ${clip(body.where, 40)})`);
      return json({
        title: clip(out.title, 40) || q, kind: clip(out.kind, 10), desc: clip(out.desc, 1500),
        refs: (Array.isArray(out.refs) ? out.refs : []).slice(0, 6).map(r => clip(r, 30)),
      });
    }
    if (body.step === 'background') {
      const heads = (Array.isArray(body.heads) ? body.heads : []).slice(0, 30)
        .map(h => `${Number(h?.[0]) || 1}절 ${clip(h?.[1], 80)}`).join(' / ');
      const out = await runLLM(env, BG_PROMPT,
        `${clip(body.book, 20)} ${Number(body.chapter) || 1}장\n단락 소제목: ${heads || '(없음)'}\n${clip(body.prev, 400)}\n\n본문:\n${clip(body.text, 8000)}`);
      return json({
        summary: clip(out.summary, 800), era: clip(out.era, 200), place: clip(out.place, 200),
        people: clip(out.people, 300), flow: clip(out.flow, 600),
        key: (Array.isArray(out.key) ? out.key : []).slice(0, 3).map(k => ({ v: Number(k?.v) || 0, why: clip(k?.why, 300) })),
      });
    }
    if (body.step === 'original') {
      const words = (Array.isArray(body.words) ? body.words : []).slice(0, 120);
      const list = words.map(w =>
        `${Number(w.i)}. ${clip(w.w, 40)} [${clip(w.tr, 40)}] "${clip(w.en, 60)}" ${clip(w.s, 12)} / ${clip(w.g, 80)}${w.lemma ? ` / 사전형 ${clip(w.lemma, 40)}=${clip(w.lg, 60)}` : ''}`,
      ).join('\n');
      const out = await runLLM(env, ORIGINAL_PROMPT,
        `구절: ${q} (${clip(body.lang, 10)})\n개역개정: ${clip(body.korean, 600)}\n\n원문 단어:\n${list}`);
      return json({
        summary: clip(out.summary, 1500),
        words: (Array.isArray(out.words) ? out.words : []).slice(0, 120).map(w => ({
          i: Number(w?.i), ko: clip(w?.ko, 80), pron: clip(w?.pron, 40), note: clip(w?.note, 500),
        })),
        points: (Array.isArray(out.points) ? out.points : []).slice(0, 5)
          .map(p => ({ title: clip(p?.title, 80), body: clip(p?.body, 900) })),
      });
    }
    if (body.step === 'find') {
      const cands = (Array.isArray(body.candidates) ? body.candidates : []).slice(0, 10)
        .map(c => `- ${clip(c.ref, 30)} ${clip(c.text, 300)}`).join('\n');
      const out = await runLLM(env, FIND_PROMPT, `질문: ${q}\n\n앱 검색 후보:\n${cands || '(없음)'}`);
      return json({
        corrected: clip(out.corrected, 400),
        refs: (Array.isArray(out.refs) ? out.refs : []).slice(0, 6).map(r => clip(r, 40)),
      });
    }
    if (body.step === 'explain') {
      const verses = (Array.isArray(body.verses) ? body.verses : []).slice(0, 16)
        .map(v => `- ${clip(v.ref, 30)}: ${clip(v.text, 400)}`).join('\n');
      const corrected = clip(body.corrected, 400);
      const out = await runLLM(env, EXPLAIN_PROMPT,
        `원래 질문(음성 입력): ${q}\n고친 질문: ${corrected || q}\n\n확인된 구절:\n${verses || '(없음)'}`);
      return json({
        matches: (Array.isArray(out.matches) ? out.matches : []).slice(0, 5).map(r => clip(r, 40)),
        intro: clip(out.intro, 600),
        interpretation: clip(out.interpretation, 1500),
        points: (Array.isArray(out.points) ? out.points : []).slice(0, 4)
          .map(p => ({ title: clip(p?.title, 80), body: clip(p?.body, 800) })),
      });
    }
    return json({ error: '알 수 없는 요청' }, 400);
  } catch (e) {
    const msg = String(e?.message || e);
    if (/neuron|quota|limit|4006|exceeded/i.test(msg)) {
      return json({ error: '오늘 무료 AI 사용량을 다 썼습니다. 내일 다시 쓰거나, 아래의 폰 안 검색 결과를 보세요.' }, 429);
    }
    return json({ error: 'AI 답변 실패: ' + msg.slice(0, 200) }, 502);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/ask') {
      if (request.method !== 'POST') return json({ error: 'POST only' }, 405);
      return handleAsk(request, env);
    }
    if (url.pathname === '/api/health') return json({ ok: true, ai: !!env.AI });
    return env.ASSETS.fetch(request);
  },
};
