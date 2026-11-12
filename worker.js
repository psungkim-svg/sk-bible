/* ================================================================
   SK-성경 서버 (Cloudflare Worker)
   - 앱 화면/파일: 그대로 전달 (dist 폴더)
   - /api/ask : AI (Cloudflare Workers AI, 무료 사용량 안에서)
   - v1.9: 해설은 주석 원문에서 문장을 골라 번역만 (서버가 원문에 있는지 확인)
   - DB(D1)가 연결되어 있으면 한 번 만든 해설을 모두가 함께 씀
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

const EXPLAIN_PROMPT = `Reasoning: low
당신은 한국어 성경(개역개정) 구절 찾기 도우미입니다.
사용자는 휴대폰 음성 입력으로 질문해서 오타가 있을 수 있습니다.
아래 "확인된 구절"은 개역개정 실제 본문입니다. 이 중에서 질문이 가리키는 구절만 고르세요. 설명은 쓰지 않습니다.
반드시 아래 형식의 JSON 하나만 출력하세요. 다른 글은 절대 쓰지 마세요.
{"matches":["에스겔 14:14","에스겔 14:20"]}
규칙: matches 에는 "확인된 구절" 목록에 있는 구절만, 관련이 큰 순서로 1~4개. 맞는 구절이 없으면 [].`;

const TOPIC_PROMPT = `당신은 한국어 성경(개역개정) 편집자입니다.
주어진 장 전체의 주제를 한국어 한 문장(40자 이내)으로 쓰세요.
- 그 장의 핵심 내용이 한눈에 들어오게, 개역개정 낱말을 살려 자연스럽게 씁니다.
  예) 마태복음 5장 → "산상수훈: 천국 백성의 복과 더 나은 의"
- 단락 소제목이 주어지면 참고하세요.
- 한국어 맞춤법과 띄어쓰기를 반드시 지키세요. (낱말 사이를 붙여 쓰지 마세요)
반드시 아래 형식의 JSON 하나만 출력하세요. 다른 글은 절대 쓰지 마세요.
{"topic":"장 주제"}`;

const TOPIC_PARA_PROMPT = `Reasoning: low
당신은 한국어 성경(개역개정) 편집자입니다. 성경을 오래 읽어 온 성도가 한 장을 읽기 전에 내용을 미리 파악하도록 돕습니다.
주어진 장의 주제 한 문장과, 단락마다 짧은 내용 요약을 쓰세요.
반드시 아래 형식의 JSON 하나만 출력하세요. 다른 글은 절대 쓰지 마세요.
{"topic":"장 전체 주제 한 문장 (40자 이내)","paras":[{"v":1,"sum":"이 단락의 내용 요약"}]}
규칙:
- topic: 그 장의 핵심 내용이 한눈에 들어오게, 개역개정 낱말을 살려 씁니다. 예) 마태복음 5장 → "산상수훈: 천국 백성의 복과 더 나은 의"
- paras: "단락 시작 절"이 주어지면 그 단락마다 정확히 하나씩, v에는 주어진 시작 절 번호를 그대로 씁니다.
  단락 시작 절이 "(없음)"이면 내용의 흐름에 따라 2~6단락으로 나누고 v에 각 단락의 시작 절을 씁니다 (첫 단락은 1절).
- sum: 그 단락에서 실제로 일어나는 일·말하는 내용을 1~2문장(50~100자)으로 핵심만 간추립니다. 누가, 무엇을 하는지가 드러나게. 단락이 8개보다 많으면 한 문장(60자 이내)으로.
- 간결하게: 핵심만 짧게, 군더더기 없이.
- 내용 요약만 씁니다. 교훈·적용·기도·"우리도 ~해야 합니다" 같은 말은 절대 쓰지 마세요.
- 존댓말(~합니다)로, 한국어 맞춤법과 띄어쓰기를 지키세요. 본문에 없는 내용은 지어내지 마세요.`;

const VERSE_PROMPT = `당신은 신학대학원에서 성경 주해를 가르치는 교수입니다. 독자는 성경을 오래 읽어 온 성도이며, 뻔한 설교 요약이 아니라 "이 구절이 정확히 무슨 뜻이고, 왜 그렇게 읽는지"를 깊고 구체적으로 알고 싶어 합니다.
아래에 개역개정 구절, 앞뒤 본문, 그리고 고전 주석들의 영어 원문 발췌가 주어집니다.
반드시 아래 형식의 JSON 하나만 출력하세요. 다른 글은 절대 쓰지 마세요.
{"summary":"이 구절이 실제로 말하는 내용을 핵심만 1~2문장 (누가, 누구에게, 무엇을)",
 "background":"이 구절을 이해하는 데 꼭 필요한 구체적 사실 — 인물·장소·관습·제도·사건·연대 가운데 가장 중요한 것만 1~3문장. 꼭 필요한 것이 없으면 빈 문자열",
 "commentators":[{"who":"주석 이름 (주어진 이름 그대로)","point":"그 주석이 이 구절에서 실제로 말하는 핵심 논점과 근거 2~4문장"}],
 "questions":[{"q":"이 구절을 꼼꼼히 읽는 사람이 실제로 품을 만한 궁금증","a":"본문·다른 성경 구절·주석을 근거로 든 핵심만 담은 답 2~3문장"}],
 "debates":[{"issue":"해석이 갈리는 지점","views":[{"view":"견해 내용","who":"주로 누구의 견해인지 (주석 이름, 또는 '일부 학자')","why":"그 근거 한 문장"}]}],
 "links":[{"ref":"성경 구절 (예: 민 21:8-9)","why":"이 구절과 어떻게 이어지는지 — 구약 배경, 인용, 같은 낱말의 다른 용례, 예언과 성취 등 한 문장"}]}
규칙:
- 적용, 교훈, 권면, 다짐, 기도, "우리는 ~해야 합니다", "오늘 우리에게" 같은 말은 절대 쓰지 마세요. 오직 본문의 뜻과 근거만 다룹니다.
- 어느 구절에나 할 수 있는 일반론은 쓰지 마세요. 이 구절에만 해당하는 구체적인 내용(낱말, 문법, 역사적 사실, 앞뒤 흐름, 다른 구절과의 관계)을 씁니다.
- commentators가 이 해설에서 가장 중요합니다. 주어진 주석 가운데 이 구절에 대해 의미 있는 말이 있는 것은 모두 (보통 4~7개) 다루세요. 각 주석이 이 구절에 대해 무엇을 주장하고 어떤 근거(원어 낱말, 문법, 다른 성경 구절, 역사적 사실, 논리)를 드는지 발췌 내용을 충실히 살려, 주석마다 서로 다른 특색이 드러나게 씁니다. 여러 주석이 같은 말을 하면 그 공통점을 밝히고 각자 더한 점을 쓰세요. 주석에 없는 말을 그 주석의 이름으로 지어내면 절대 안 됩니다. 주석 자료가 없으면 빈 배열.
- 영어 주석은 자연스러운 한국어로 옮기고, 성경 인용은 개역개정 표현을 따르세요. 인물 이름은 한국 교회에서 쓰는 표기(칼빈, 매튜 헨리 등)로.
- questions 2~3개. debates는 실제로 견해가 갈리는 곳만 0~2개 (각 2~3개 견해를 공정하게). links 3~5개.
- '다른 번역'(새번역·영어 BSB)이 주어지면, 개역개정과 뜻이 달라 보이는 곳이 있을 때 questions나 summary에서 그 차이와 이유를 설명하세요.
- 간결하게: 핵심 요점만 짧게, 서론·되풀이·군더더기 없이 씁니다.
- 존댓말(~입니다)로 쓰고, 확실하지 않은 사실은 지어내지 마세요.`;

/* ---- v1.6.4: 깊은 해설을 여러 요청으로 나눠 동시에 (빨라짐) ---- */
const DEEP_ROLE = `당신은 신학대학원에서 성경 주해를 가르치는 교수입니다. 독자는 성경을 오래 읽어 온 성도이며, 뻔한 설교 요약이 아니라 "이 구절이 정확히 무슨 뜻이고, 왜 그렇게 읽는지"를 깊고 구체적으로 알고 싶어 합니다.`;
const DEEP_RULES = `- 간결하게: 핵심 요점만 짧게 씁니다. 서론, 같은 말 되풀이, 꾸밈말, "~라고 할 수 있습니다" 같은 군더더기는 빼고, 한 문장에 한 가지만 담습니다.
- 적용, 교훈, 권면, 다짐, 기도, "우리는 ~해야 합니다", "오늘 우리에게" 같은 말은 절대 쓰지 마세요. 오직 본문의 뜻과 근거만 다룹니다.
- 어느 구절에나 할 수 있는 일반론은 쓰지 마세요. 이 구절에만 해당하는 구체적인 내용(낱말, 문법, 역사적 사실, 앞뒤 흐름, 다른 구절과의 관계)을 씁니다.
- 영어 자료는 자연스러운 한국어로 옮기고, 성경 인용은 개역개정 표현을 따르세요. 인물 이름은 한국 교회에서 쓰는 표기(칼빈, 매튜 헨리 등)로.
- 존댓말(~입니다)로 쓰고, 확실하지 않은 사실은 지어내지 마세요.`;

const VERSE_CORE_PROMPT = `Reasoning: low
${DEEP_ROLE}
아래에 개역개정 구절과 앞뒤 본문이 주어집니다.
반드시 아래 형식의 JSON 하나만 출력하세요. 다른 글은 절대 쓰지 마세요.
{"summary":"이 구절이 실제로 말하는 내용을 핵심만 1~2문장 (누가, 누구에게, 무엇을)",
 "background":"이 구절을 이해하는 데 꼭 필요한 구체적 사실 — 인물·장소·관습·제도·사건·연대 가운데 가장 중요한 것만 1~3문장. 꼭 필요한 것이 없으면 빈 문자열"}
규칙:
${DEEP_RULES}`;

const VERSE_LINKS_PROMPT = `Reasoning: low
${DEEP_ROLE}
아래에 개역개정 구절과 앞뒤 본문이 주어집니다. 이 구절과 깊이 이어지는 다른 성경 구절을 고르세요.
반드시 아래 형식의 JSON 하나만 출력하세요. 다른 글은 절대 쓰지 마세요.
{"links":[{"ref":"성경 구절 (예: 민 21:8-9)","why":"이 구절과 어떻게 이어지는지 — 구약 배경, 인용, 같은 낱말의 다른 용례, 예언과 성취 등 한 문장"}]}
규칙:
${DEEP_RULES}
- links 3~5개.`;

const VERSE_QA_PROMPT = `${DEEP_ROLE}
아래에 개역개정 구절, 다른 번역(새번역·영어 BSB), 앞뒤 본문, 고전 주석들의 영어 원문 발췌가 주어집니다.
반드시 아래 형식의 JSON 하나만 출력하세요. 다른 글은 절대 쓰지 마세요.
{"questions":[{"q":"이 구절을 꼼꼼히 읽는 사람이 실제로 품을 만한 궁금증","a":"본문·다른 성경 구절·주석을 근거로 든 핵심만 담은 답 2~3문장"}],
 "debates":[{"issue":"해석이 갈리는 지점","views":[{"view":"견해 내용","who":"주로 누구의 견해인지 (주석 이름, 또는 '일부 학자')","why":"그 근거 한 문장"}]}]}
규칙:
${DEEP_RULES}
- questions 2~3개. 가장 중요한 궁금증만. debates는 실제로 견해가 갈리는 곳만 0~2개 (각 2~3개 견해를 공정하게).
- 주석에 없는 말을 그 주석의 이름으로 지어내면 절대 안 됩니다.
- 다른 번역이 개역개정과 뜻이 달라 보이는 곳이 있으면, 그 차이와 이유를 questions에서 설명하세요.`;

const VERSE_COMM_PROMPT = `Reasoning: low
${DEEP_ROLE}
아래에 개역개정 구절과, 고전 주석 하나의 영어 원문 발췌가 주어집니다.
이 주석이 이 구절에 대해 실제로 말하는 내용을 한국어로 정리하세요.
반드시 아래 형식의 JSON 하나만 출력하세요. 다른 글은 절대 쓰지 마세요.
{"point":"이 주석이 이 구절에서 주장하는 구체적 논점과 그 근거(원어 낱말, 문법, 다른 성경 구절, 역사적 사실, 논리) 2~4문장. 이 주석만의 특색이 드러나는 핵심만"}
규칙:
${DEEP_RULES}
- 발췌에 없는 말을 이 주석의 이름으로 지어내면 절대 안 됩니다.
- 발췌가 이 구절과 상관없는 내용뿐이면 {"point":""} 를 출력하세요.`;

const VERSE_EXTRA_PROMPT = `Reasoning: low
당신은 신학대학원에서 성경 주해를 가르치는 교수입니다. 독자는 성경을 오래 읽어 온 성도입니다.
아래에 개역개정 구절, 앞뒤 본문, 그 책의 소개(주제·구조)가 주어집니다.
반드시 아래 형식의 JSON 하나만 출력하세요. 다른 글은 절대 쓰지 마세요.
{"bookflow":"이 구절이 그 책 전체의 구조와 주제 안에서 어떤 자리에 있고 어떤 역할을 하는지, 앞뒤 단락·책의 목적과 어떻게 이어지는지 핵심만 1~2문장",
 "modern":[{"who":"현대 학자 이름 (예: D. A. 카슨)","point":"그 학자가 이 구절에 대해 펼친 것으로 잘 알려진 해석의 핵심 1~2문장"}]}
규칙:
- bookflow: 주어진 '책 소개'(주제·구조)를 참고해, 이 구절이 책 전체에서 맡은 역할을 구체적으로 씁니다.
- modern: 20세기 이후 이 책의 대표적인 현대 주석가·학자(예: D. A. 카슨, 더글러스 무, 크레이그 키너, 고든 웬함, 브루스 월키, 리처드 보컴, N. T. 라이트, 레온 모리스, F. F. 브루스 등 그 책을 실제로 연구한 학자) 가운데, 이 구절에 대한 견해를 확실히 아는 학자만 1~3명. 확실하지 않으면 학자 이름을 지어내지 말고 '현대 학자들 다수' 또는 '일부 현대 학자'로 쓰세요. 고전 주석 발췌와 같은 내용을 되풀이하지 말고 현대 연구(고고학, 고대 근동·제2성전기 유대교 배경, 원문 연구, 문학 구조)가 더해 준 통찰을 담으세요.
- 간결하게: 핵심만 짧게, 군더더기 없이.
- 적용·교훈·기도는 쓰지 마세요. 존댓말(~입니다)로 쓰고, 확실하지 않은 사실은 지어내지 마세요.`;

const VERSE_ASK_PROMPT = `당신은 신학대학원에서 성경 주해를 가르치는 교수입니다. 성도가 특정 성경 구절에 대해 질문합니다.
주어진 구절, 앞뒤 본문, 고전 주석 발췌, 앞서 나눈 내용을 참고해 질문에 깊고 구체적으로 답하세요.
반드시 아래 형식의 JSON 하나만 출력하세요. 다른 글은 절대 쓰지 마세요.
{"answer":"질문에 대한 답 2~5문장. 핵심부터 간결하게, 근거(본문, 다른 성경 구절, 주석 이름)를 밝히며 구체적으로","refs":["근거로 든 성경 구절 (예: 롬 5:8)"]}
규칙: 적용·교훈·기도는 쓰지 말고 질문에 대한 답만 합니다. 견해가 갈리면 여러 견해를 공정하게 소개합니다. 주석에 없는 말을 주석 이름으로 지어내지 말고, 모르는 것은 모른다고 하세요. 존댓말로 씁니다.`;

/* ---- v1.7: 장 깊은 해설 (흐름 · 관찰 질문 · 어려운 곳 · 주석가별) ---- */
const CHAP_ROLE = `당신은 신학대학원에서 성경 주해를 가르치는 교수입니다. 독자는 성경을 오래 읽어 온 성도이며, 성경 한 장을 깊고 구체적으로 이해하고 싶어 합니다.`;
const CHAP_RULES = `- 간결하게: 핵심 요점만 짧게 씁니다. 서론, 같은 말 되풀이, 꾸밈말, "~라고 할 수 있습니다" 같은 군더더기는 빼고, 한 문장에 한 가지만 담습니다.
- 적용, 교훈, 권면, 다짐, 기도, "우리는 ~해야 합니다", "오늘 우리에게", "우리가 배울 점" 같은 말은 절대 쓰지 마세요. 오직 본문의 뜻과 근거만 다룹니다.
- 어느 장에나 할 수 있는 일반론은 쓰지 마세요. 이 장에만 해당하는 구체적인 내용(낱말, 흐름, 논리, 역사적 사실, 다른 구절과의 관계)을 씁니다.
- 성경 인용은 개역개정 표현을 따르고, 절을 말할 때는 "3절", "5-8절"처럼 숫자로 밝히세요.
- 존댓말(~입니다)로 쓰고, 확실하지 않은 사실은 지어내지 마세요.`;

const CHAP_FLOW_PROMPT = `Reasoning: low
${CHAP_ROLE}
아래에 개역개정 한 장 전체, 단락 소제목, 앞 장 끝과 다음 장 처음, 그 책의 소개가 주어집니다.
반드시 아래 형식의 JSON 하나만 출력하세요. 다른 글은 절대 쓰지 마세요.
{"flow":[{"from":1,"to":4,"title":"이 단락의 핵심을 담은 짧은 제목 (20자 이내)","gist":"이 단락이 말하는 것과 앞 단락에서 어떻게 이어지는지 핵심만 1~2문장"}],
 "key":[{"v":28,"why":"이 절이 이 장을 여는 열쇠인 이유 1~2문장"}],
 "prev":"앞 장(또는 앞부분)에서 이 장으로 어떻게 넘어오는지 1~2문장",
 "next":"이 장이 다음 장(또는 뒷부분)으로 어떻게 이어지는지 1~2문장"}
규칙:
${CHAP_RULES}
- flow: 장 전체를 빠짐없이 3~7단락으로 나눕니다 (from/to는 절 번호, 첫 단락은 1절부터, 마지막 단락은 마지막 절까지). 단락의 논리 관계(그러므로, 그러나, 이는 등)가 드러나게 씁니다.
- key: 1~2개.`;

const CHAP_HARD_PROMPT = `${CHAP_ROLE}
아래에 개역개정 한 장 전체, 단락 소제목, 고전 주석들의 영어 원문 발췌(일부)가 주어집니다.
반드시 아래 형식의 JSON 하나만 출력하세요. 다른 글은 절대 쓰지 마세요.
{"hard":[{"q":"이 장에서 성도들이 실제로 많이 막히거나 오해하는 곳 (절 번호와 함께)","a":"본문·다른 성경 구절·주석을 근거로 든 핵심만 담은 답 2~4문장. 왜 어려운지를 한마디로 짚고 답을 줍니다. 견해가 갈리면 주요 견해를 근거와 함께 짧게"}],
 "canon":[{"ref":"성경 구절 (예: 창 3:17-19)","why":"이 장이 그 구절과 어떻게 이어지는지 — 구약의 약속과 배경, 인용, 같은 주제의 발전, 성취 등 핵심만 1~2문장"}]}
규칙:
${CHAP_RULES}
- hard 4~5개. 뻔한 질문은 빼고, 실제로 읽다가 막히는 곳을 장 전체에서 고르게 고릅니다.
- canon 5~6개. 구약과 신약을 고르게, 창조–타락–언약–이스라엘–그리스도–교회–완성으로 이어지는 성경 전체 이야기 속에서 이 장의 자리가 드러나게, 성경 순서대로 놓습니다.
- 주석에 없는 말을 그 주석의 이름으로 지어내면 절대 안 됩니다. 영어 자료는 자연스러운 한국어로 옮기세요.`;

const CHAP_COMM_PROMPT = `Reasoning: low
${CHAP_ROLE}
아래에 성경 한 장의 단락 소제목과, 고전 주석 하나가 이 장 전체에 대해 쓴 영어 원문 발췌(장 전체에서 고르게 뽑은 것)가 주어집니다.
이 주석이 이 장을 어떻게 읽는지 한국어로 정리하세요.
반드시 아래 형식의 JSON 하나만 출력하세요. 다른 글은 절대 쓰지 마세요.
{"point":"이 주석이 이 장 전체를 어떻게 보는지 — 장의 핵심 주제와 구조를 어떻게 이해하는지, 특히 강조하는 절과 그 이유, 이 주석만의 독특한 해석과 근거를 핵심만 3~5문장. 절 번호를 밝히며"}
규칙:
${CHAP_RULES}
- 발췌에 없는 말을 이 주석의 이름으로 지어내면 절대 안 됩니다. 인물 이름은 한국 교회에서 쓰는 표기(칼빈, 매튜 헨리 등)로.
- 발췌가 이 장과 상관없는 내용뿐이면 {"point":""} 를 출력하세요.`;

/** 폰이 보내 준 주석 발췌를 정리 (v1.8: 주석 3가지 · 하나당 3400자까지, 합계 약 14000자) */
function sourcesText(list) {
  let total = 0;
  const out = [];
  for (const s of (Array.isArray(list) ? list : []).slice(0, 8)) {
    const who = clip(s?.who, 40).trim();
    const text = clip(s?.text, 3400).trim();
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
 "names":[{"name":"이름","kind":"인물|지명|민족|절기|기타","desc":"누구/어디인지, 성경에서의 중요성 1~2문장","refs":["관련 대표 구절 (예: 창 12:1)"]}]}
규칙: 어려운 낱말은 0~8개, 고유명사는 본문에 나온 것만. 존댓말로 쓰고 지어내지 마세요.`;

const TERM_PROMPT = `당신은 성경 사전 편집자입니다. 사용자가 묻는 성경 낱말·인물·지명·개념을 한국어로 쉽게 설명하세요.
반드시 아래 형식의 JSON 하나만 출력하세요. 다른 글은 절대 쓰지 마세요.
{"title":"표제어 (개역개정 표기)","kind":"인물|지명|낱말|개념|절기|기타","desc":"뜻과 성경에서의 의미·주요 사건 2~3문장","refs":["대표 구절 2~5개 (예: 창 12:1)"]}
규칙: 존댓말로 쓰고, 성경에 없는 내용이나 확실하지 않은 내용은 지어내지 마세요.`;

const BG_PROMPT = `당신은 성경 배경을 잘 아는 성경 교사입니다. 주어진 성경 한 장의 배경 카드를 한국어로 만드세요.
반드시 아래 형식의 JSON 하나만 출력하세요. 다른 글은 절대 쓰지 마세요.
{"summary":"이 장의 내용 요약 1~2문장",
 "era":"시대 (예: 주전 1000년경 다윗 왕 시대 / 주후 30년경 예수님 공생애)",
 "place":"주요 장소",
 "people":"주요 등장인물 (쉼표로)",
 "flow":"앞 장과의 연결과 성경 전체 흐름 속 의미 한 문장",
 "key":[{"v":절번호,"why":"이 절이 중요한 이유 한 문장"}]}
규칙: key 는 1~2개. 모든 항목을 짧고 간결하게. 존댓말로 쓰고, 확실하지 않은 연대는 '~경' 또는 '전통적으로'라고 쓰세요. 지어내지 마세요.`;

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

/* ================================================================
   v1.9: 근거 있는 해설 — AI는 "주석 원문에서 문장 고르기 + 번역"만 합니다.
   고른 영어 문장이 원문에 정말 있는지 서버가 글자 단위로 확인하고, 없으면 버립니다.
   ================================================================ */
const TR_RULES = `번역 규칙 (가장 중요):
- 고른 영어 문장을 빠짐없이, 보태지 말고, 요약하지 말고, 뜻 그대로 정확하고 자연스러운 한국어로 옮깁니다. 원문에 없는 설명·의견·적용을 덧붙이면 절대 안 됩니다.
- 문장의 논리(그러므로, 그러나, ~때문에)와 강조, 조건, 단서를 그대로 살립니다. 모르는 낱말을 얼버무리지 말고 문맥에 맞게 정확히 옮깁니다.
- 신학 용어는 한국 교회 표준 용어로: justification 칭의, justify 의롭다 하다, sanctification 성화, atonement 속죄, propitiation 화목제물, redemption 구속, reconciliation 화목, covenant 언약, grace 은혜, mercy 긍휼, righteousness 의, faith 믿음, repentance 회개, kingdom of heaven 천국, kingdom of God 하나님 나라, Messiah 메시아, the Law 율법, Gentiles 이방인, Pharisees 바리새인, scribes 서기관, Holy Spirit/Holy Ghost 성령, saints 성도, the elect 택하신 자, election 선택, providence 섭리, incarnation 성육신, resurrection 부활, gospel 복음, apostle 사도, disciples 제자들, flesh 육신, sacrifice 제사/제물, offering 예물, tabernacle 성막, temple 성전, priest 제사장, prophet 선지자, idolatry 우상 숭배, judgment 심판, salvation 구원, eternal life 영생, Second Coming 재림.
- 성경 인용은 개역개정 표현을 따르고, 구절 표기는 한국어 약어로 바꿉니다 (Matt 5:3 → 마 5:3, Ps/Pss → 시, Isa → 사, Gen → 창, Exod → 출, Deut → 신, Rom → 롬, 1 Cor → 고전, Heb → 히, Rev → 계, cp. → 참조, see → 참조).
- 인물·지명은 개역개정과 한국 교회 표기로 (Calvin 칼빈, Augustine 어거스틴, Chrysostom 크리소스톰, Jerome 제롬, Luther 루터, Moses 모세, Elijah 엘리야, Jerusalem 예루살렘, Judea 유대).
- 문체는 평서문(~이다, ~한다)으로 원문의 어조를 살립니다. 한국어 맞춤법과 띄어쓰기를 지킵니다.`;

const PICK_RULES = `문장 고르기 규칙:
- en 에는 원문에 실제로 있는 문장(또는 한 문장 안의 연속된 부분)을 철자·문장부호까지 한 글자도 바꾸지 말고 그대로 복사합니다. 고치거나, 줄이거나, 여러 곳을 이어 붙이면 안 됩니다. 맨 앞의 절 번호(예: "5:3")는 빼도 됩니다.
- 해석·설명·근거가 담긴 문장을 고릅니다. 성경 본문을 그대로 옮겨 적은 문장, 라틴어, 구절 번호만 늘어놓은 문장은 고르지 않습니다.
- 자기 생각은 한 마디도 쓰지 않습니다. 원문에 없는 내용은 절대 만들어 내지 않습니다.`;

const EXTRACT_PROMPT = `Reasoning: low
당신은 영어 성경 주석을 한국어로 옮기는 신학 번역가입니다. 주어진 원문에서 중요한 문장을 골라 정확하게 번역하는 일만 합니다.
할 일: '원문'에서 '찾을 내용'에 대해 이 자료가 말하는 가장 중요한 문장을, 서로 겹치지 않게 원문 순서대로, '고를 문장 수'만큼 고릅니다. 원문이 그 내용과 상관없으면 빈 배열.
반드시 아래 형식의 JSON 하나만 출력하세요. 다른 글은 절대 쓰지 마세요.
{"items":[{"en":"원문 문장 그대로","ko":"그 문장의 충실한 한국어 번역"}]}
${PICK_RULES}
${TR_RULES}`;

const EASY_RULES = `쉬운 번역 규칙 (위 '문체' 규칙 대신 이것을 따릅니다):
- 성경을 처음 읽는 성도도 한 번에 알아듣게, 말하듯 자연스럽고 쉬운 우리말로 옮깁니다. 존댓말(~입니다, ~했습니다)로 씁니다.
- 영어 어순을 따르지 말고 한국어 어순으로 풀어 씁니다. 한 문장이 길면 두세 문장으로 나눕니다.
- 어려운 한자어·학술 용어는 쉬운 말로 바꿉니다 (예: commissioning → 사명을 맡김, exile → 포로 생활, domination → 지배, hostages from the upper classes → 지도층 사람들을 인질로).
- BC → 주전, AD → 주후 (예: 주전 597년). 괄호 속 성경 구절 표기는 그대로 한국어 약어로 둡니다.
- 그래도 원문의 뜻을 더하거나 빼지 않습니다. 원문에 없는 설명·의견을 붙이지 않습니다.`;

const GQA_PROMPT = `Reasoning: low
당신은 영어 성경 주석을 한국어로 옮기는 신학 번역가입니다. 주어진 주석 원문에 실제로 있는 문장만 골라 정확하게 번역합니다.
아래에 성경 본문(개역개정)과 여러 주석의 원문 발췌가 [주석 이름]으로 나뉘어 주어집니다.
1) qa: 이 본문을 읽는 성도가 실제로 품을 만한 궁금증(낱말의 뜻, 문화·역사 배경, 앞뒤 논리, 다른 구절과의 관계 등) 가운데, 주석 원문이 직접 답하고 있는 것만 고릅니다. q 는 한국어로 짧은 질문, quotes 는 그 답이 되는 주석 원문 문장(같은 주석에서 1~3개).
2) debates: 주석들이 같은 곳을 서로 다르게 해석한다는 것이 원문에 분명히 드러날 때만 씁니다. views 는 서로 다른 주석에서 하나씩, 그 주석 원문의 문장. 그런 곳이 없으면 빈 배열 (억지로 만들지 마세요).
반드시 아래 형식의 JSON 하나만 출력하세요. 다른 글은 절대 쓰지 마세요.
{"qa":[{"q":"질문","who":"주석 이름 (주어진 그대로)","quotes":[{"en":"원문 문장 그대로","ko":"충실한 번역"}]}],
 "debates":[{"issue":"해석이 갈리는 지점 (짧게)","views":[{"who":"주석 이름","en":"원문 문장 그대로","ko":"충실한 번역"}]}]}
규칙:
- qa 는 '질문 수'만큼 (원문이 답하는 것이 그보다 적으면 적게). debates 0~2개.
- 질문(q)과 쟁점(issue) 외에는 자기 말을 쓰지 않습니다.
${PICK_RULES}
${TR_RULES}`;

const GASK_PROMPT = `Reasoning: low
당신은 영어 성경 주석을 한국어로 옮기는 신학 번역가입니다. 성도의 질문에 자기 말로 답하지 않고, 주석 원문에서 그 질문에 직접 답하는 문장을 찾아 정확하게 번역합니다.
반드시 아래 형식의 JSON 하나만 출력하세요. 다른 글은 절대 쓰지 마세요.
{"quotes":[{"who":"주석 이름 (주어진 그대로)","en":"원문 문장 그대로","ko":"충실한 번역"}]}
규칙:
- 질문에 직접 답하는 문장만 1~5개. 답이 되는 문장이 없으면 {"quotes":[]} (억지로 고르지 마세요).
${PICK_RULES}
${TR_RULES}`;

const EASY_PROMPT = `Reasoning: low
당신은 성경 주석 문장들을 중학생도 알아듣게 정리하는 편집자입니다.
아래 '문장들'은 실제 주석에서 원문 확인을 거친 문장과 그 번역입니다. 문장마다 [S번호]와 주석 이름이 붙어 있습니다.
할 일: 이 문장들에 있는 내용만 가지고, 이 본문의 핵심을 3~5문장으로 쉽게 정리합니다.
반드시 아래 형식의 JSON 하나만 출력하세요. 다른 글은 절대 쓰지 마세요.
{"lines":[{"ko":"쉬운 한국어 문장","src":["S1","S3"]}]}
규칙:
- 각 문장(ko)은 '문장들'에 실제로 있는 내용만 씁니다. 거기 없는 사실·해석·숫자·인물·배경을 하나도 더하지 않습니다.
- 각 문장의 src 에는 그 문장의 근거가 된 [S번호]를 모두 적습니다. 근거를 댈 수 없는 문장은 쓰지 않습니다.
- 적용, 교훈("우리도 ~해야 합니다"), 기도, 권면, 감탄은 쓰지 않습니다. 본문이 무슨 뜻인지만 씁니다.
- 중학생이 한 번에 알아듣는 쉬운 말, 존댓말(~입니다). 한 문장은 짧게 (60자 안팎). 어려운 한자어·학술 용어는 쉬운 말로.
- 주석끼리 의견이 다르면 "~라고 보는 주석도 있습니다"처럼 갈린다는 것을 그대로 씁니다.
- 순서: 이 본문이 무엇에 관한 것인지 → 중요한 내용 → (있으면) 어려운 곳의 뜻.`;

/** 영어 비교용: 소문자 · 따옴표 통일 · 글자와 숫자만 */
function normEn(s) {
  return String(s ?? '').toLowerCase()
    .replace(/[\u2018\u2019\u02bc`\u00b4]/g, "'").replace(/[\u201c\u201d]/g, '"')
    .replace(/<[^>]+>/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
}
/** AI가 고른 문장이 원문에 그대로 있는지 */
function inSrc(en, srcNorm) {
  const n = normEn(en);
  return n.length >= 20 && n.split(' ').length >= 4 && srcNorm.includes(n);
}
function verifyPts(list, src, max) {
  const sn = normEn(src);
  const seen = new Set();
  const out = [];
  for (const x of (Array.isArray(list) ? list : [])) {
    const en = clip(x?.en, 1500).trim(), ko = clip(x?.ko, 2000).trim();
    if (!en || !ko || !/[가-힣]/.test(ko) || !inSrc(en, sn)) continue;
    const k = normEn(en);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ en, ko });
    if (out.length >= max) break;
  }
  return out;
}
/** 여러 주석 중 어느 원문에 있는지 (이름이 틀려도 실제로 있는 주석으로 바로잡음) */
function srcList(list) {
  return (Array.isArray(list) ? list : []).slice(0, 6)
    .map(s => ({ who: clip(s?.who, 40).trim(), text: clip(s?.text, 4000).trim() }))
    .filter(s => s.who && s.text)
    .map(s => ({ ...s, norm: normEn(s.text) }));
}
function whoHas(en, who, srcs) {
  const named = srcs.find(s => s.who === who);
  if (named && inSrc(en, named.norm)) return named.who;
  const any = srcs.find(s => inSrc(en, s.norm));
  return any ? any.who : '';
}
function srcBlock(srcs) { return srcs.map(s => `[${s.who}]\n${s.text}`).join('\n\n') || '(주석 자료 없음)'; }

/* ---- 함께 쓰는 해설 저장소 (Cloudflare D1 · 무료) ----
   wrangler.jsonc 에 DB 연결이 있을 때만 씁니다. 없으면 예전처럼 폰마다 저장. */
const DAILY_NEW = 20;            // 폰 하나가 하루에 새로 AI를 부를 수 있는 횟수 (구절·장 해설 하나 ≈ 4번)
const CACHE_VER = 'v190';
let dbReady = false;
async function dbOn(env) {
  if (!env.DB) return false;
  if (dbReady) return true;
  try {
    await env.DB.batch([
      'CREATE TABLE IF NOT EXISTS ai (k TEXT PRIMARY KEY, v TEXT NOT NULL, t INTEGER)',
      'CREATE TABLE IF NOT EXISTS usage (d TEXT NOT NULL, dev TEXT NOT NULL, n INTEGER NOT NULL, PRIMARY KEY (d, dev))',
      // v1.9.5 저녁 미리 만들기: 하루 AI 사용량(어림) · 읽은 장 · 미리 만든 표시 · 상태
      'CREATE TABLE IF NOT EXISTS spend (d TEXT PRIMARY KEY, n REAL NOT NULL)',
      'CREATE TABLE IF NOT EXISTS reads (k TEXT PRIMARY KEY, t INTEGER)',
      'CREATE TABLE IF NOT EXISTS pre (k TEXT PRIMARY KEY, t INTEGER)',
      'CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT)',
    ].map(q => env.DB.prepare(q)));
    dbReady = true;
  } catch { return false; }
  return true;
}
const today = () => new Date().toISOString().slice(0, 10);
async function sharedGet(env, k) {
  try { const r = await env.DB.prepare('SELECT v FROM ai WHERE k = ?').bind(k).first(); return r ? JSON.parse(r.v) : null; } catch { return null; }
}
async function sharedPut(env, k, v) {
  try { await env.DB.prepare('INSERT OR REPLACE INTO ai (k, v, t) VALUES (?, ?, ?)').bind(k, JSON.stringify(v), Date.now()).run(); } catch { /* 무시 */ }
}
async function usedToday(env, dev) {
  try { const r = await env.DB.prepare('SELECT n FROM usage WHERE d = ? AND dev = ?').bind(today(), dev).first(); return Number(r?.n) || 0; } catch { return 0; }
}
async function addUse(env, dev) {
  try { await env.DB.prepare('INSERT INTO usage (d, dev, n) VALUES (?, ?, 1) ON CONFLICT(d, dev) DO UPDATE SET n = n + 1').bind(today(), dev).run(); } catch { /* 무시 */ }
}

/** 저장소에 있으면 바로, 없으면 AI → 확인된 결과만 저장 */
async function grounded(env, request, key, run, keep, opt = {}) {
  const has = await dbOn(env);
  const k = key ? `${CACHE_VER}|${key}` : '';
  if (has && k) {
    const hit = await sharedGet(env, k);
    if (hit) return json({ ...hit, shared: true });
  }
  const dev = clip(request.headers.get('x-sk-dev'), 40).replace(/[^\w-]/g, '');
  if (has && dev && !opt.free && (await usedToday(env, dev)) >= DAILY_NEW) {
    return json({ error: `오늘 이 폰에서 새로 만들 수 있는 해설을 다 썼습니다 (하루 구절·장 해설 약 ${Math.round(DAILY_NEW / 4)}개). 이미 만들어진 해설은 계속 볼 수 있고, 새 해설은 내일 다시 만들 수 있습니다.`, limit: true }, 429);
  }
  const out = await run();
  if (has && dev && !opt.free) await addUse(env, dev);
  if (has && k && keep(out)) await sharedPut(env, k, out);
  return json(out);
}

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
      if (CRON) CRON.sub++;
      const r = await env.AI.run(model, {
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        max_tokens: opt.max_tokens || 6000,
        temperature: 0.2,
      });
      const txt = extractText(r);
      await addSpend(env, neuronsOf(model, r, system.length + user.length, txt.length));
      const out = parseJson(txt);
      if (out) return out;
      lastErr = new Error('AI 답을 읽지 못했습니다');
    } catch (e) {
      lastErr = e instanceof Error ? e : new Error(String(e));
    }
  }
  throw lastErr;
}


/* ---- 근거 있는 해설의 세 가지 일 (폰의 요청에서도, 저녁 미리 만들기에서도 씀) ---- */
async function doExtract(env, body) {
  const who = clip(body.who, 40).trim();
  const src = clip(body.source, 7000);
  const max = Math.min(8, Math.max(1, Number(body.max) || 4));
  const ask = `찾을 내용: ${clip(body.focus, 300)}\n고를 문장 수: ${clip(body.n, 10) || '2~4'}개\n자료: ${who}\n\n원문:\n${src}`;
  const sys = body.style === 'easy' ? EXTRACT_PROMPT + '\n' + EASY_RULES : EXTRACT_PROMPT;
  let out = await runLLM(env, sys, ask, { max_tokens: 6000 });
  let items = verifyPts(out?.items, src, max);
  // 골랐는데 원문과 한 글자라도 달라 모두 걸러졌으면 한 번만 다시 (원문 그대로 복사하라고 다시 일러 줌)
  if (!items.length && Array.isArray(out?.items) && out.items.length) {
    out = await runLLM(env, sys, ask + '\n\n(주의: 앞서 고른 문장이 원문과 글자가 달라 모두 버려졌습니다. en 에는 원문의 문장을 한 글자도 바꾸지 말고 그대로 복사하세요.)', { max_tokens: 6000 });
    items = verifyPts(out?.items, src, max);
  }
  return { who, items };
}
async function doGqa(env, body) {
  const q = clip(body.q, 400).trim();
  const srcs = srcList(body.sources);
  const out = await runLLM(env, GQA_PROMPT,
    `본문: ${q}\n${clip(body.text, 4000)}\n질문 수: ${clip(body.n, 10) || '2~3'}개\n\n주석 원문 발췌:\n${srcBlock(srcs)}`,
    { max_tokens: 9000 });
  const qa = (Array.isArray(out?.qa) ? out.qa : []).slice(0, 8).map(x => {
    const pts = [];
    let who = '';
    for (const p of (Array.isArray(x?.quotes) ? x.quotes : []).slice(0, 4)) {
      const w = whoHas(p?.en, clip(x?.who, 40).trim(), srcs);
      const ko = clip(p?.ko, 2000).trim();
      if (!w || !ko || !/[가-힣]/.test(ko) || (who && w !== who)) continue;
      who = w;
      pts.push({ en: clip(p.en, 1500).trim(), ko });
    }
    return { q: clip(x?.q, 200).trim(), who, pts };
  }).filter(x => x.q && x.pts.length);
  const debates = (Array.isArray(out?.debates) ? out.debates : []).slice(0, 3).map(d => {
    const views = [];
    for (const v of (Array.isArray(d?.views) ? d.views : []).slice(0, 4)) {
      const w = whoHas(v?.en, clip(v?.who, 40).trim(), srcs);
      const ko = clip(v?.ko, 2000).trim();
      if (!w || !ko || !/[가-힣]/.test(ko) || views.some(x => x.who === w)) continue;
      views.push({ who: w, en: clip(v.en, 1500).trim(), ko });
    }
    return { issue: clip(d?.issue, 200).trim(), views };
  }).filter(d => d.issue && d.views.length >= 2);
  return { qa, debates };
}
function easyPts(list) {
  return (Array.isArray(list) ? list : []).slice(0, 24)
    .map(p => ({ id: clip(p?.id, 6).trim(), who: clip(p?.who, 40).trim(), en: clip(p?.en, 800).trim(), ko: clip(p?.ko, 900).trim() }))
    .filter(p => /^S\d{1,2}$/.test(p.id) && p.who && p.ko);
}
/** 📖 쉽게 정리 — 확인된 주석 문장만 근거로 · 근거(S번호)를 못 댄 문장은 버림 */
async function doEasy(env, body) {
  const q = clip(body.q, 120).trim();
  const pts = easyPts(body.pts);
  if (pts.length < 2) return { lines: [] };
  const ids = new Map(pts.map(p => [p.id, p]));
  const ask = `본문: ${q}\n\n문장들:\n${pts.map(p => `[${p.id}] (${p.who}) ${p.ko}\n    원문: ${p.en}`).join('\n')}`;
  const out = await runLLM(env, EASY_PROMPT, ask, { max_tokens: 4000 });
  const lines = [];
  for (const l of (Array.isArray(out?.lines) ? out.lines : []).slice(0, 6)) {
    const ko = clip(l?.ko, 240).trim();
    const src = [...new Set((Array.isArray(l?.src) ? l.src : []).map(x => String(x).replace(/[\[\]\s]/g, '')))].filter(x => ids.has(x));
    if (!ko || !/[가-힣]/.test(ko) || !src.length) continue;
    if (/(야 합니다|야 하겠|합시다|바랍니다|기도하|기도합|아멘|우리도 |본받)/.test(ko)) continue;   // 적용·권면·기도는 빼기
    lines.push({ ko, who: [...new Set(src.map(x => ids.get(x).who))], src });
    if (lines.length >= 5) break;
  }
  return { lines };
}

async function handleAsk(request, env) {
  if (request.headers.get('x-sk-app') !== '1') return json({ error: 'forbidden' }, 403);
  if (!env.AI) return json({ error: 'AI 연결(binding)이 없습니다. wrangler.jsonc 를 확인하세요.' }, 500);
  let body;
  try { body = await request.json(); } catch { return json({ error: '잘못된 요청' }, 400); }
  const q = clip(body.q, 400).trim();
  if (!q) return json({ error: '질문이 비어 있습니다' }, 400);

  try {
    /* ---- v1.9 근거 있는 해설 ---- */
    if (body.step === 'extract') {
      return grounded(env, request, `x|${clip(body.ck, 160)}`, () => doExtract(env, body), r => r.items.length > 0);
    }
    if (body.step === 'gqa') {
      if (!srcList(body.sources).length) return json({ qa: [], debates: [] });
      return grounded(env, request, `q|${clip(body.ck, 160)}`, () => doGqa(env, body), r => r.qa.length > 0 || r.debates.length > 0);
    }
    if (body.step === 'gask') {
      const srcs = srcList(body.sources);
      if (!srcs.length) return json({ quotes: [] });
      return grounded(env, request, '', async () => {
        const out = await runLLM(env, GASK_PROMPT,
          `구절: ${clip(body.ref, 60)}\n${clip(body.text, 3000)}\n\n질문: ${q}\n\n주석 원문 발췌:\n${srcBlock(srcs)}`,
          { max_tokens: 6000 });
        const quotes = [];
        for (const p of (Array.isArray(out?.quotes) ? out.quotes : []).slice(0, 6)) {
          const w = whoHas(p?.en, clip(p?.who, 40).trim(), srcs);
          const ko = clip(p?.ko, 2000).trim();
          if (!w || !ko || !/[가-힣]/.test(ko) || quotes.some(x => normEn(x.en) === normEn(p.en))) continue;
          quotes.push({ who: w, en: clip(p.en, 1500).trim(), ko });
        }
        return { quotes };
      }, () => false);
    }
    if (body.step === 'easy') {
      if (easyPts(body.pts).length < 2) return json({ lines: [] });
      return grounded(env, request, `${clip(body.ck, 160)}`, () => doEasy(env, body), r => r.lines.length > 0, { free: true });
    }

    if (body.step === 'topic') {
      const verses = (Array.isArray(body.verses) ? body.verses : []).slice(0, 200);
      const paras = !!body.paras;
      // 단락 요약을 만들 때는 본문을 더 많이 읽음
      const per = paras ? (verses.length > 80 ? 90 : 260) : (verses.length > 60 ? 50 : 120);
      const text = verses.map((t, i) => `${i + 1} ${clip(t, per)}`).join('\n').slice(0, paras ? 13000 : 9000);
      const hs = (Array.isArray(body.heads) ? body.heads : []).slice(0, 40);
      const heads = hs.map(h => `${Number(h?.[0]) || 1}절 ${clip(h?.[1], 80)}`).join(' / ');
      const starts = [...new Set(hs.map(h => Number(h?.[0]) || 1))].join(', ');
      const ask = `${clip(body.book, 20)} ${Number(body.chapter) || 1}장 (모두 ${verses.length}절)\n단락 소제목: ${heads || '(없음)'}${paras ? `\n단락 시작 절: ${starts || '(없음)'}` : ''}\n\n본문:\n${text}`;
      if (paras) {
        let out = null;
        for (let tries = 0; tries < 2; tries++) {
          out = await runLLM(env, TOPIC_PARA_PROMPT, ask, { max_tokens: 7000 });
          const t = clip(out?.topic, 120).trim();
          if (t && !isSquashed(t) && Array.isArray(out?.paras) && out.paras.length) break;
        }
        const topic = clip(out?.topic, 120).trim();
        const list = (Array.isArray(out?.paras) ? out.paras : []).slice(0, 40)
          .map(x => ({ v: Number(x?.v) || 0, sum: clip(x?.sum, 600).trim() })).filter(x => x.v > 0 && x.sum);
        if (!topic || isSquashed(topic) || !list.length) return json({ error: 'AI가 단락 요약을 쓰지 못했습니다' }, 502);
        return json({ topic, paras: list });
      }
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
    if (typeof body.step === 'string' && body.step.startsWith('chap-')) {
      const head = `${clip(body.q, 40)} (모두 ${Number(body.count) || 0}절)\n단락 소제목: ${clip(body.heads, 1500) || '(없음)'}`;
      const text = clip(body.text, 12000);
      const arr = (x, n) => (Array.isArray(x) ? x : []).slice(0, n);
      if (body.step === 'chap-flow') {
        const out = await runLLM(env, CHAP_FLOW_PROMPT,
          `${head}\n\n앞 장 끝: ${clip(body.prev, 500) || '(없음 — 책의 처음)'}\n다음 장 처음: ${clip(body.next, 500) || '(없음 — 책의 끝)'}\n\n책 소개:\n${clip(body.bookinfo, 1200) || '(없음)'}\n\n본문:\n${text}`,
          { max_tokens: 4000 });
        const res = {
          flow: arr(out.flow, 9).map(f => ({ from: Number(f?.from) || 0, to: Number(f?.to) || 0, title: clip(f?.title, 80), gist: clip(f?.gist, 800) })).filter(f => f.from && f.title),
          key: arr(out.key, 3).map(k => ({ v: Number(k?.v) || 0, why: clip(k?.why, 600) })).filter(k => k.v),
          prev: clip(out.prev, 800), next: clip(out.next, 800),
        };
        if (!res.flow.length) return json({ error: 'AI가 흐름을 쓰지 못했습니다' }, 502);
        return json(res);
      }
      if (body.step === 'chap-hard') {
        const out = await runLLM(env, CHAP_HARD_PROMPT,
          `${head}\n\n본문:\n${text}\n\n고전 주석 발췌(영어 원문, 일부):\n${sourcesText(body.sources)}`,
          { max_tokens: 11000 });
        const res = {
          hard: arr(out.hard, 7).map(x => ({ q: clip(x?.q, 300), a: clip(x?.a, 3000) })).filter(x => x.q && x.a),
          canon: arr(out.canon, 9).map(l => ({ ref: clip(l?.ref, 40), why: clip(l?.why, 900) })).filter(l => l.ref),
        };
        if (!res.hard.length && !res.canon.length) return json({ error: 'AI가 내용을 쓰지 못했습니다' }, 502);
        return json(res);
      }
      if (body.step === 'chap-comm') {
        const who = clip(body.who, 40);
        const out = await runLLM(env, CHAP_COMM_PROMPT,
          `${head}\n\n주석: ${who}\n발췌(영어 원문):\n${clip(body.source, 6800)}`,
          { max_tokens: 5000 });
        return json({ who, point: clip(out.point, 3500) });
      }
    }
    if (body.step === 'verse-core') {
      const out = await runLLM(env, VERSE_CORE_PROMPT,
        `구절: ${q}\n${clip(body.text, 3000)}\n\n다른 번역:\n${clip(body.others, 3000) || '(없음)'}\n\n앞뒤 본문(참고):\n${clip(body.around, 3000)}`,
        { max_tokens: 3000 });
      const res = {
        summary: clip(out.summary, 1200),
        background: clip(out.background, 1500),
        links: (Array.isArray(out.links) ? out.links : []).slice(0, 8).map(l => ({ ref: clip(l?.ref, 40), why: clip(l?.why, 600) })).filter(l => l.ref),
      };
      if (!res.summary) return json({ error: 'AI가 해설을 쓰지 못했습니다. 다시 시도해 주세요' }, 502);
      return json(res);
    }
    if (body.step === 'verse-links') {
      const out = await runLLM(env, VERSE_LINKS_PROMPT,
        `구절: ${q}\n${clip(body.text, 3000)}\n\n앞뒤 본문(참고):\n${clip(body.around, 3000)}`,
        { max_tokens: 3000 });
      const links = (Array.isArray(out.links) ? out.links : []).slice(0, 8).map(l => ({ ref: clip(l?.ref, 40), why: clip(l?.why, 600) })).filter(l => l.ref);
      return json({ links });
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
        `구절: ${q}\n${clip(body.text, 2000)}\n\n앞뒤 본문(참고):\n${clip(body.around, 1500)}\n\n주석: ${who}\n발췌(영어 원문):\n${clip(body.source, 5000)}`,
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
        intro: '', interpretation: '', points: [],
      });
    }
    return json({ error: '알 수 없는 요청' }, 400);
  } catch (e) {
    const msg = String(e?.message || e);
    if (/neuron|quota|limit|4006|exceeded/i.test(msg)) {
      return json({ error: '오늘 무료 AI 사용량을 다 썼습니다. 이미 만들어진 해설은 계속 볼 수 있고, 새 해설은 내일 다시 만들 수 있습니다.' }, 429);
    }
    return json({ error: 'AI 답변 실패: ' + msg.slice(0, 200) }, 502);
  }
}

/* ================================================================
   🌙 저녁 미리 만들기 (Cron · v1.9.5)
   무료 AI 사용량(하루 10,000 뉴런)은 한국 시간 오전 9시(미국 동부 저녁 8시, 겨울엔 7시)에
   새로 채워집니다. 그 직전 한 시간(UTC 23시) 동안 5분마다 깨어나, 그날 남은 양으로
   ① 사람들이 읽은 장의 "다음 장" → ② 많이 읽는 책 순서로
   배경 · (하루 최대 3개) 장 깊은 해설을 미리 만들어 D1에 넣어 둡니다. (v1.9.6: 단락 요약 없앰)
   - 만드는 방법은 폰이 부를 때와 똑같습니다 (주석 원문에서 고르고 번역만, 서버가 원문 확인).
   - 그날 쓴 양이 STOP(8,500)을 넘으면 바로 멈춥니다. 실패해도 다음 날 다시 시도.
   ================================================================ */
const CRON_STOP = 8500;          // 하루 10,000 가운데 여기까지만 (사람들이 쓸 몫 남김)
const CRON_DEEP_PER_DAY = 3;     // 장 깊은 해설은 하루 최대 3개
const CRON_CALLS = 6;            // 한 번 깨어날 때 AI 호출 최대 횟수
const CH = [50,40,27,36,34,24,21,4,31,24,22,25,29,36,10,13,10,42,150,31,12,8,66,52,5,48,12,14,3,9,1,4,7,3,3,3,2,14,4,28,16,24,21,28,16,16,13,6,6,4,4,5,3,6,4,3,1,13,5,5,3,5,1,1,1,22];
const KO_NAME = ['창세기','출애굽기','레위기','민수기','신명기','여호수아','사사기','룻기','사무엘상','사무엘하','열왕기상','열왕기하','역대상','역대하','에스라','느헤미야','에스더','욥기','시편','잠언','전도서','아가','이사야','예레미야','예레미야애가','에스겔','다니엘','호세아','요엘','아모스','오바댜','요나','미가','나훔','하박국','스바냐','학개','스가랴','말라기',
  '마태복음','마가복음','누가복음','요한복음','사도행전','로마서','고린도전서','고린도후서','갈라디아서','에베소서','빌립보서','골로새서','데살로니가전서','데살로니가후서','디모데전서','디모데후서','디도서','빌레몬서','히브리서','야고보서','베드로전서','베드로후서','요한일서','요한이서','요한삼서','유다서','요한계시록'];
const USFM_ = ['GEN','EXO','LEV','NUM','DEU','JOS','JDG','RUT','1SA','2SA','1KI','2KI','1CH','2CH','EZR','NEH','EST','JOB','PSA','PRO','ECC','SNG','ISA','JER','LAM','EZK','DAN','HOS','JOL','AMO','OBA','JON','MIC','NAM','HAB','ZEP','HAG','ZEC','MAL',
  'MAT','MRK','LUK','JHN','ACT','ROM','1CO','2CO','GAL','EPH','PHP','COL','1TH','2TH','1TI','2TI','TIT','PHM','HEB','JAS','1PE','2PE','1JN','2JN','3JN','JUD','REV'];
// 많이 읽는 책 순서: 복음서 → 사도행전 → 로마서 → 창세기 → 시편 → 요한일서·에베소서·빌립보서·히브리서·야고보서 … → 나머지
const POP_FIRST = [39, 40, 41, 42, 43, 44, 0, 18, 61, 48, 49, 57, 58, 47, 50, 45, 46, 1, 19, 22, 51, 52, 53, 54, 55, 56, 59, 60, 62, 63, 64, 65];
const POPULAR = [...POP_FIRST, ...CH.map((_, i) => i).filter(i => !POP_FIRST.includes(i))];
const POP_LIST = POPULAR.flatMap(b => Array.from({ length: CH[b] }, (_, i) => [b, i + 1]));
// 앱(study.ts)의 COMMENTARIES 와 같아야 저장 열쇠가 맞습니다
const CRON_COMMS = [
  { id: 'john-calvin', name: '칼빈 주석', fb: { id: 'matthew-henry', name: '매튜 헨리 주석' } },
  { id: 'tyndale', name: '틴데일 스터디 노트' },
  { id: 'keil-delitzsch', name: '카일·델리취 주석', ot: true },
  { id: 'jamieson-fausset-brown', name: 'JFB 주석', nt: true },
];
const HELLOAO = 'https://bible.helloao.org/api';

/* ---- 하루 AI 사용량 (뉴런) 어림 — Cloudflare 요금표 기준 ---- */
const RATE = { '@cf/openai/gpt-oss-120b': [31.818, 68.182], '@cf/meta/llama-4-scout-17b-16e-instruct': [24.545, 77.273] };  // 1천 토큰당 [입력, 출력]
// 저녁 작업 중일 때만 씀: 바깥 요청(D1·fetch·AI) 수와 AI 사용량을 모아 둠 (무료: 한 번에 50개까지)
let CRON = null;
function neuronsOf(model, r, inChars, outChars) {
  const [ri, ro] = RATE[model] || [31.818, 68.182];
  const u = r?.usage || {};
  const tin = Number(u.prompt_tokens) || inChars / 2.5;
  const tout = Number(u.completion_tokens) || outChars / 1.5 + 800;   // 생각(추론) 몫을 넉넉히
  return (tin * ri + tout * ro) / 1000;
}
async function addSpend(env, n) {
  if (CRON) { CRON.spend += n; return; }   // 저녁 작업은 끝날 때 한 번에 적음
  if (!env.DB || !n) return;
  try { await env.DB.prepare('INSERT INTO spend (d, n) VALUES (?, ?) ON CONFLICT(d) DO UPDATE SET n = n + excluded.n').bind(today(), n).run(); } catch { /* 무시 */ }
}
async function spentToday(env) {
  try { const r = await env.DB.prepare('SELECT n FROM spend WHERE d = ?').bind(today()).first(); return Number(r?.n) || 0; } catch { return 0; }
}
async function metaGet(env, k) {
  try { const r = await env.DB.prepare('SELECT v FROM meta WHERE k = ?').bind(k).first(); return r ? r.v : null; } catch { return null; }
}
async function metaSet(env, k, v) {
  try { await env.DB.prepare('INSERT OR REPLACE INTO meta (k, v) VALUES (?, ?)').bind(k, String(v)).run(); } catch { /* 무시 */ }
}
async function markPre(env, k, t) {
  try { await env.DB.prepare('INSERT OR REPLACE INTO pre (k, t) VALUES (?, ?)').bind(k, t).run(); } catch { /* 무시 */ }
}

/* ---- 읽은 장 기록 (폰이 한 장을 5초 넘게 펴 두면 알려 줌 · 장 번호만, 사람 정보 없음) ---- */
async function noteRead(env, ck) {
  const k = clip(ck, 10);
  const m = k.match(/^(\d{1,2})\.(\d{1,3})$/);
  if (!m || +m[1] > 65 || +m[2] < 1 || +m[2] > CH[+m[1]] || !(await dbOn(env))) return;
  try { await env.DB.prepare('INSERT OR REPLACE INTO reads (k, t) VALUES (?, ?)').bind(k, Date.now()).run(); } catch { /* 무시 */ }
}
const nextOf = (b, c) => (c < CH[b] ? [b, c + 1] : b < 65 ? [b + 1, 1] : null);

/* ---- helloao 자료 받기 (크면 건너뜀 — 무료 Worker 는 CPU 10ms 제한) ---- */
async function getJson(url, maxBytes = 400000) {
  if (CRON) CRON.sub++;
  const r = await fetch(url);
  if (!r.ok) return null;
  const t = await r.text();
  if (t.length > maxBytes) return null;
  try { return JSON.parse(t); } catch { return null; }
}
function itemTextW(it) {
  return (it?.content || []).map(x => (typeof x === 'string' ? x : x?.text || '')).join('\n');
}
const LATIN_W = /\b(est|et|qui|quae|quod|non|sed|enim|nos|nobis|ut|per|autem|sunt|cum|ad|Dei|Christi|in|Deus|esse|nisi|vel|atque)\b/g;
function isLatinW(p) { const w = p.split(/\s+/).length; return w > 8 && (p.match(LATIN_W)?.length || 0) / w > 0.18; }
function cleanParas(raw) {
  return raw.replace(/\[\d+\]/g, '').replace(/[ \t]+/g, ' ').split(/\n\s*\n/).map(p => p.trim())
    .filter(p => p.length > 30 && !isLatinW(p) && !(/^\d+\.\s/.test(p) && p.length < 350) && !/^[A-Z][a-z]+ \d+:\d+(-\d+)?$/.test(p))
    .join('\n');
}
/** 앱의 chapterExcerpt 와 같은 방식(장 전체에서 고르게)이지만, 고를 부분만 손질해서 CPU를 아낌 */
function cronExcerpt(items, max) {
  const its = items.filter(i => typeof i.number === 'number').sort((a, b) => a.number - b.number)
    .map(it => ({ n: it.number, raw: itemTextW(it) })).filter(x => x.raw.length > 30);
  if (!its.length) return '';
  const rawTotal = its.reduce((n, x) => n + x.raw.length, 0);
  if (rawTotal <= max * 1.3) {
    const all = its.map(x => ({ n: x.n, t: cleanParas(x.raw) })).filter(x => x.t.length > 30);
    const total = all.reduce((n, x) => n + x.t.length, 0);
    if (total <= max) return all.map(x => `(${x.n}절~) ${x.t}`).join('\n\n');
  }
  const k = Math.max(1, Math.min(its.length, Math.floor(max / 350)));
  const per = Math.floor(max / k);
  const out = [];
  let j = 0;
  for (let i = 0; i < k && j < its.length; i++) {
    j = Math.max(j, Math.floor(i * its.length / k));
    // 라틴어 본문 등으로 비면 다음 항목으로
    for (; j < its.length; j++) {
      const t0 = cleanParas(its[j].raw.slice(0, per * 4));
      if (t0.length <= 30) continue;
      let t = t0.slice(0, per);
      const cut = Math.max(t.lastIndexOf('. '), t.lastIndexOf('; '));
      if (t0.length > per && cut > per * 0.5) t = t.slice(0, cut + 1);
      out.push(`(${its[j].n}절~) ${t}${t0.length > t.length || its[j].raw.length > per * 4 ? ' …' : ''}`);
      j++;
      break;
    }
  }
  return out.join('\n\n');
}
/* 책 소개 나누기 (앱 study.ts 와 같음) */
function introSectionsW(t) {
  const ps = t.split(/\n\s*\n/).map(x => x.trim()).filter(Boolean);
  const out = [];
  let cur = { h: '', ps: [] };
  for (const x of ps) {
    if (x.length < 50 && !/[.:;,]$/.test(x) && !x.startsWith('•')) { out.push(cur); cur = { h: x, ps: [] }; }
    else cur.ps.push(x);
  }
  out.push(cur);
  return out;
}
function chapRangesW(x, eng) {
  const r = [];
  const add = (a, b) => r.push([+a, +(b || a)]);
  for (const m of x.matchAll(/\b(?:[Cc]hapters?|chs?|[Pp]salms?)\.? (\d+)(?:\s*[–-]\s*(\d+))?/g)) add(m[1], m[2]);
  if (eng) for (const m of x.matchAll(new RegExp(`\\b${eng} (\\d+)\\s*[–-]\\s*(\\d+)\\b(?!:)`, 'g'))) add(m[1], m[2]);
  for (const m of x.matchAll(/\((\d+):\d+(?:[–-](\d+)(?::(\d+))?)?/g)) r.push([+m[1], m[3] ? +m[2] : +m[1]]);
  return r;
}
const ENG_W = { GEN: 'Genesis', EXO: 'Exodus', LEV: 'Leviticus', NUM: 'Numbers', DEU: 'Deuteronomy', ISA: 'Isaiah', JER: 'Jeremiah', EZK: 'Ezekiel', DAN: 'Daniel', JOB: 'Job', PRO: 'Proverbs' };
function chapterParaW(t, book, c) {
  const sum = introSectionsW(t).find(x => /^summary/i.test(x.h));
  if (!sum) return null;
  let bi = -1, span = 1e9;
  const eng = ENG_W[USFM_[book]] || '';
  sum.ps.forEach((x, i) => {
    for (const [a, b] of chapRangesW(x, eng)) if (a <= c && c <= b && b - a < span) { span = b - a; bi = i; }
  });
  if (bi >= 0) {
    let lo = c, hi = c;
    for (const [a, b] of chapRangesW(sum.ps[bi], eng)) if (a <= c && c <= b && b - a >= hi - lo) { lo = a; hi = b; }
    return { text: sum.ps[bi], range: lo === hi ? `${lo}장` : `${lo}–${hi}장`, key: `q${bi}` };
  }
  const all = sum.ps.join('\n\n');
  return all.length > 80 ? { text: all.slice(0, 4000), range: '', key: `c${c}` } : null;
}
/** 본문(BSB 영어)과 그 소제목 — 궁금증 풀이에 본문 대신 넣음 (폰에서는 개역개정을 넣음) */
async function bsbChapter(book, c) {
  const j = await getJson(`${HELLOAO}/BSB/${USFM_[book]}/${c}.json`, 200000).catch(() => null);
  const heads = [], lines = [];
  for (const it of j?.chapter?.content || []) {
    if (it.type === 'heading') heads.push(itemTextW(it).trim());
    else if (it.type === 'verse') {
      if (heads.length && !heads[heads.length - 1].includes('절 ')) heads[heads.length - 1] = `${it.number}절 ${heads[heads.length - 1]}`;
      lines.push(`${it.number} ${itemTextW(it).replace(/\s+/g, ' ').trim().slice(0, 90)}`);
    }
  }
  return { heads, lines };
}
const chapLabel = (b, c) => `${KO_NAME[b]} ${c}${b === 18 ? '편' : '장'}`;
const keyOf = k => `${CACHE_VER}|${k}`;

/* ---- 무엇이 이미 있는지 한 번에 확인 ---- */
async function haveKeys(env, keys) {
  const has = new Set();
  for (let i = 0; i < keys.length; i += 90) {
    const part = keys.slice(i, i + 90);
    const qs = part.map(() => '?').join(',');
    try {
      const r = await env.DB.prepare(`SELECT k FROM ai WHERE k IN (${qs}) UNION ALL SELECT k FROM pre WHERE k IN (${qs})`).bind(...part, ...part).all();
      for (const x of r.results || []) has.add(x.k);
    } catch { /* 무시 */ }
  }
  return has;
}
const lightKeys = (b, c) => [`g:${b}.${c}`];   // v1.9.6: 단락 요약은 없앰 → 배경만
const deepKeys = (b, c) => [keyOf(`q|c|${b}.${c}`), `d:${b}.${c}`];
const lightDone = (has, b, c) => has.has(`g:${b}.${c}`);
const deepDone = (has, b, c) => has.has(keyOf(`q|c|${b}.${c}`)) || has.has(`d:${b}.${c}`);

/* ---- v1.11 책 소개 부분 (앱 study.ts 의 BI_PARTS 와 같게) ---- */
const BI_W = {
  w: { re: /^(author|date|recipients?|recpients|readers|audience|place and date|occasion and place)/i, n: '2~3', max: 3, size: 5000,
    focus: n => `${n}을(를) 누가, 언제, 어디서, 누구에게 썼는가 — 처음 읽는 중학생도 알 수 있는 가장 기본적인 사실 (학자들의 논쟁 과정보다 결론)` },
  y: { re: /^(occasion|purpose|paul.s purpose|meaning and message)/i, n: '2~3', max: 3, size: 5000,
    focus: n => `${n}을(를) 왜 썼는가 — 이 책이 가장 하고 싶은 말, 큰 목적과 메시지` },
  s: { re: /summary/i, n: '3~5', max: 5, size: 6000,
    focus: n => `${n}의 줄거리 — 처음부터 끝까지 무슨 일(무슨 내용)이 차례로 나오는가. 큰 흐름만` },
};
function biSourceW(text, part) {
  const P = BI_W[part];
  const secs = introSectionsW(text);
  let src = secs.filter(x => P.re.test(x.h)).flatMap(x => x.ps).join('\n\n');
  if (!src && part === 's') src = secs.filter(x => /^setting/i.test(x.h)).flatMap(x => x.ps).join('\n\n');
  if (!src) src = text;
  return src.slice(0, P.size);
}

/* ---- ① 배경 (한 장) ---- */
async function cronLight(env, st, b, c, has) {
  const ck = `${b}.${c}`;
  st.log.push(`light ${ck}`);
  if (!has.has(`g:${ck}`) && st.calls < CRON_CALLS) {
    if (st.intro[b] === undefined) {
      const j = await getJson(`${HELLOAO}/c/tyndale/${USFM_[b]}/1.json`).catch(() => null);
      st.intro[b] = String(j?.book?.introduction || '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
    }
    const intro = st.intro[b];
    let needBook = c === 1 || CH[b] === 1;
    if (intro && !needBook) {
      const para = chapterParaW(intro, b, c);
      if (!para) needBook = true;
      else if (!(await sharedGet(env, keyOf(`x|bc|${b}|${para.key}`)))) {
        const { heads } = await bsbChapter(b, c);
        const hs = heads.map(h => h.replace(/^\d+절 /, '')).join(', ');
        st.calls++;
        const r = await doExtract(env, {
          style: 'easy', who: '틴데일 스터디 노트 (책 소개)', source: para.text,
          focus: para.range
            ? `${KO_NAME[b]} ${para.range}이 무슨 내용이고 책 전체에서 어떤 부분인지 (특히 ${c}장${hs ? ': ' + hs : ''})`
            : `${KO_NAME[b]} ${c}장의 내용${hs ? ' (' + hs + ')' : ''}`,
          n: '2~3', max: 3,
        });
        if (r.items.length) await sharedPut(env, keyOf(`x|bc|${b}|${para.key}`), r);
        else needBook = true;   // 앱도 이럴 때 책 전체 배경을 보여 줌
      }
    }
    if (intro && needBook && st.calls < CRON_CALLS && !(await sharedGet(env, keyOf(`x|b2|${b}`)))) {
      const secs = introSectionsW(intro);
      const set = secs.find(x => /^(setting|historical setting|background)/i.test(x.h));
      const src = [secs[0]?.ps[0] || '', ...(set?.ps || [])].join('\n\n') || intro;
      st.calls++;
      const r = await doExtract(env, {
        style: 'easy', who: '틴데일 스터디 노트 (책 소개)', source: src.slice(0, 5000),
        focus: `${KO_NAME[b]}을(를) 처음 읽는 성도가 꼭 알아야 할 큰 그림 — 언제, 어디서, 누가, 누구에게, 어떤 상황에서 쓰였는가. 연도·왕·전투 이름이 줄줄이 나오는 문장보다 상황을 한눈에 알려 주는 문장`,
        n: '3~4', max: 4,
      });
      if (r.items.length) await sharedPut(env, keyOf(`x|b2|${b}`), r);
    }
    // v1.11 📘 책 소개 (누가·언제·어디서 / 왜 / 줄거리) — 1장을 미리 만들 때 함께
    if (c === 1) {
      let text = intro, who = '틴데일 스터디 노트 (책 소개)';
      if (!text) {
        const j = await getJson(`${HELLOAO}/c/jamieson-fausset-brown/${USFM_[b]}/1.json`).catch(() => null);
        text = String(j?.book?.introduction || '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
        who = 'JFB 주석 (책 머리말)';
      }
      for (const part of text ? ['w', 'y', 's'] : []) {
        const k = keyOf(`x|bi|${b}|${part}`);
        if (await sharedGet(env, k)) continue;
        if (st.calls >= CRON_CALLS) return true;   // 다음에 이어서 (표시를 남기지 않음)
        st.calls++;
        const P = BI_W[part];
        const r = await doExtract(env, { style: 'easy', who, source: biSourceW(text, part), focus: P.focus(KO_NAME[b]), n: P.n, max: P.max });
        if (r.items.length) await sharedPut(env, k, r);
      }
    }
    await markPre(env, `g:${ck}`, Date.now());
  }
  return true;
}

/* ---- ② 장 깊은 해설 (여러 번에 나눠: 주석 받기 → 주석마다 고르기 → 궁금증 풀이) ---- */
async function cronDeep(env, st, job) {
  const { b, c } = job;
  const ck = `${b}.${c}`;
  const label = chapLabel(b, c);
  const list = CRON_COMMS.filter(x => (!x.ot || b < 39) && (!x.nt || b >= 39));
  const save = () => metaSet(env, 'job', JSON.stringify(job));
  if (job.srcs.length < list.length) {
    if (st.heavy >= 2) return false;          // 큰 주석은 한 번 깨어날 때 둘까지만 (CPU 10ms 제한 · 하나에 1~2ms)
    st.heavy++;
    job.tries = (job.tries || 0) + 1;
    if (job.tries > 2) { job.srcs.push(null); job.tries = 0; await save(); return true; }   // 두 번 실패하면 건너뜀
    await save();
    const cm = list[job.srcs.length];
    let got = null;
    for (const s of cm.fb ? [cm, cm.fb] : [cm]) {
      const j = await getJson(`${HELLOAO}/c/${s.id}/${USFM_[b]}/${c}.json`).catch(() => null);
      const text = Array.isArray(j?.chapter?.content) ? cronExcerpt(j.chapter.content, 6500) : '';
      if (text.length > 80) { got = { who: s.name, text }; break; }
    }
    job.srcs.push(got); job.tries = 0;
    st.log.push(`src ${ck} ${got ? got.who : '-'}`);
    await save();
    return true;
  }
  const focus = `${label} 전체 — 이 장의 핵심 주제와 구조, 특히 중요한 절과 그 해석`;
  job.done = job.done || [];
  for (let i = 0; i < job.srcs.length; i++) {
    const s = job.srcs[i];
    if (!s || job.done.includes(i)) continue;
    if (st.calls >= CRON_CALLS) return false;
    const k = keyOf(`x|c|${ck}|${s.who}`);
    if (!(await sharedGet(env, k))) {
      st.calls++;
      const r = await doExtract(env, { who: s.who, source: s.text, focus, n: '3~5', max: 6 });
      if (r.items.length) await sharedPut(env, k, r);
    }
    job.done.push(i);
    st.log.push(`ext ${ck} ${s.who}`);
    await save();
    return true;
  }
  const sources = job.srcs.filter(Boolean).map(x => ({ who: x.who, text: x.text.slice(0, 2600) }));
  if (sources.length && !(await sharedGet(env, keyOf(`q|c|${ck}`)))) {
    if (st.calls >= CRON_CALLS) return false;
    const { heads, lines } = await bsbChapter(b, c);
    const text = `(소제목: ${heads.join(' / ') || '없음'})\n` + lines.join('\n').slice(0, 4000);
    st.calls++;
    const r = await doGqa(env, { q: label, text, n: '3~4', sources });
    if (r.qa.length || r.debates.length) await sharedPut(env, keyOf(`q|c|${ck}`), r);
  }
  // v1.12 📖 쉽게 정리 — 위에서 만든(원문 확인된) 문장만 가지고 · 앱과 같은 순서
  if (sources.length && st.calls < CRON_CALLS && !(await sharedGet(env, keyOf(`e|c|${ck}`)))) {
    const pts = [];
    const add = (who, p) => { if (p?.en && p?.ko && pts.length < 24) pts.push({ id: `S${pts.length + 1}`, who, en: p.en, ko: p.ko }); };
    for (const x of job.srcs) {
      if (!x) continue;
      const r = await sharedGet(env, keyOf(`x|c|${ck}|${x.who}`));
      (r?.items || []).forEach(p => add(x.who, p));
    }
    const g = await sharedGet(env, keyOf(`q|c|${ck}`));
    (g?.qa || []).forEach(q => (q.pts || []).forEach(p => add(q.who, p)));
    (g?.debates || []).forEach(d => (d.views || []).forEach(v => add(v.who, v)));
    if (pts.length >= 2) {
      st.calls++;
      const r = await doEasy(env, { q: label, pts });
      if (r.lines.length) await sharedPut(env, keyOf(`e|c|${ck}`), r);
    }
  }
  await markPre(env, `d:${ck}`, sources.length ? Date.now() : 1);   // 주석이 하나도 없던 장은 오늘 개수에 안 셈
  await metaSet(env, 'job', '');
  st.job = null;
  st.log.push(`deep ${ck} 끝`);
  return true;
}

const isQuota = e => /neuron|quota|4006|exceeded/i.test(String(e?.message || e));
/** AI 한도 오류가 아니면 그 장은 건너뛰고 계속 (한 장 때문에 매일 막히지 않게) */
async function soft(st, what, fn) {
  try { return await fn(); } catch (e) {
    if (isQuota(e)) throw e;
    st.log.push(`건너뜀 ${what}: ${String(e?.message || e).slice(0, 60)}`);
    return 'fail';
  }
}
async function cronStep(env, st) {
  if (st.job) {
    const job = st.job;
    const r = await soft(st, `deep ${job.b}.${job.c}`, () => cronDeep(env, st, job));
    if (r === false) return false;   // 이번에 할 몫을 다 씀 → 다음에 이어서
    if (r === 'fail') {   // 두 번 실패하면 이 장은 그만 (이미 만든 부분은 그대로 쓰임)
      job.fails = (job.fails || 0) + 1;
      if (job.fails >= 2) { await markPre(env, `d:${job.b}.${job.c}`, 2); await metaSet(env, 'job', ''); st.job = null; }
      else await metaSet(env, 'job', JSON.stringify(job));
    }
    return true;
  }
  // ① 사람들이 읽은 장의 다음 장 (최근 3일)
  if (!st.nexts) {
    let rows = [];
    try { rows = (await env.DB.prepare('SELECT k FROM reads WHERE t > ? ORDER BY t DESC LIMIT 20').bind(Date.now() - 3 * 864e5).all()).results || []; } catch { /* 무시 */ }
    const seen = new Set();
    st.nexts = rows.map(r => r.k.split('.').map(Number)).map(([b, c]) => nextOf(b, c)).filter(x => x && !seen.has(x.join('.')) && seen.add(x.join('.')));
    st.has = await haveKeys(env, st.nexts.flatMap(([b, c]) => [...lightKeys(b, c), ...deepKeys(b, c)]));
  }
  const n1 = st.nexts.find(([b, c]) => !lightDone(st.has, b, c));
  if (n1) { await lightSafe(env, st, n1); return true; }
  // ② 장 깊은 해설 (하루 최대 3개): 다음 장 먼저, 없으면 많이 읽는 책 순서로
  if (st.deepLeft === undefined) {
    let n = 0;
    try { n = Number((await env.DB.prepare("SELECT COUNT(*) AS n FROM pre WHERE k LIKE 'd:%' AND t >= ?").bind(Date.parse(today())).first())?.n) || 0; } catch { /* 무시 */ }
    st.deepLeft = CRON_DEEP_PER_DAY - n;
  }
  if (st.deepLeft > 0) {
    let t = st.nexts.find(([b, c]) => !deepDone(st.has, b, c));
    if (!t) t = await popScan(env, st, 'pd', deepKeys, deepDone);
    if (t) {
      st.deepLeft--;
      deepKeys(...t).forEach(k => st.has.add(k));
      st.job = { b: t[0], c: t[1], srcs: [] };
      await metaSet(env, 'job', JSON.stringify(st.job));
      st.log.push(`deep ${t.join('.')} 시작`);
      return true;
    }
  }
  // ③ 많이 읽는 책 순서로 배경
  const t = await popScan(env, st, 'pc', lightKeys, lightDone);
  if (t) { await lightSafe(env, st, t); return true; }
  return false;
}
async function lightSafe(env, st, [b, c]) {
  const r = await soft(st, `light ${b}.${c}`, () => cronLight(env, st, b, c, st.has));
  if (r === 'fail') await markPre(env, `g:${b}.${c}`, 2);
  lightKeys(b, c).forEach(k => st.has.add(k));
}
/** 많이 읽는 책 순서에서 아직 없는 첫 장 (앞쪽이 다 됐으면 표시를 앞으로 옮김) */
async function popScan(env, st, name, keysFn, doneFn) {
  let P = st.pop[name];
  if (!P) P = st.pop[name] = { cur: Number(await metaGet(env, name)) || 0, part: null, saved: -1 };
  for (let round = 0; round < 3 && P.cur < POP_LIST.length; round++) {
    if (!P.part) {
      P.part = POP_LIST.slice(P.cur, P.cur + 15);
      (await haveKeys(env, P.part.flatMap(([b, c]) => keysFn(b, c)))).forEach(k => st.has.add(k));
    }
    const i = P.part.findIndex(([b, c]) => !doneFn(st.has, b, c));
    if (i >= 0) {
      if (P.cur + i !== P.saved && i > 0) { P.cur += i; P.part = P.part.slice(i); P.saved = P.cur; await metaSet(env, name, P.cur); }
      return P.part[0];
    }
    P.cur += P.part.length; P.part = null;
    P.saved = P.cur; await metaSet(env, name, P.cur);
  }
  return null;
}

/** 무료 Worker 는 한 번 깨어날 때 바깥 요청(D1 질의 · fetch · AI) 50개까지 — 세어 가며 멈춤
    한 단계가 많아야 18개쯤 쓰므로, 29개를 넘으면 새 단계를 시작하지 않음 */
const CRON_SUB_START = 29;
function countingDB(db, st) {
  return {
    prepare(sql) {
      const p = db.prepare(sql);
      const wrap = x => ({
        bind: (...a) => wrap(x.bind(...a)),
        first: (...a) => { st.sub++; return x.first(...a); },
        all: () => { st.sub++; return x.all(); },
        run: () => { st.sub++; return x.run(); },
        _raw: x,
      });
      return wrap(p);
    },
    batch(list) { st.sub++; return db.batch(list.map(x => x._raw || x)); },
  };
}

async function runCron(env) {
  if (!env.AI || !env.DB) return;
  const st = { calls: 0, heavy: 0, sub: 0, spend: 0, log: [], intro: {}, pop: {} };
  env = { ...env, DB: countingDB(env.DB, st) };
  dbReady = false;   // 이 env 로 표 확인 (새로 깨어난 경우 대부분 어차피 필요)
  if (!(await dbOn(env))) return;
  const now = Date.now();
  if (Number(await metaGet(env, 'lock')) > now - 4.5 * 60e3) return;   // 앞의 것이 아직 도는 중
  if ((await metaGet(env, 'stopd')) === today()) return;               // 오늘 AI 한도에 걸렸음
  await metaSet(env, 'lock', now);
  const job = await metaGet(env, 'job');
  try { st.job = job ? JSON.parse(job) : null; } catch { st.job = null; }
  CRON = st;
  try {
    const base = await spentToday(env);
    for (let i = 0; i < 12 && st.calls < CRON_CALLS && st.sub <= CRON_SUB_START; i++) {
      if (base + st.spend >= CRON_STOP) { st.log.push('오늘 몫 다 씀'); break; }
      if (!(await cronStep(env, st))) break;
    }
  } catch (e) {
    const msg = String(e?.message || e);
    st.log.push('오류: ' + msg.slice(0, 120));
    if (isQuota(e)) await metaSet(env, 'stopd', today());
  } finally {
    CRON = null;
    if (st.spend) await addSpend(env, st.spend);
    await metaSet(env, 'lock', 0);
    await metaSet(env, 'last', JSON.stringify({ t: new Date(now).toISOString(), calls: st.calls, sub: st.sub + 2, log: st.log.slice(0, 20) }));
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/ask') {
      if (request.method !== 'POST') return json({ error: 'POST only' }, 405);
      return handleAsk(request, env);
    }
    if (url.pathname === '/api/read') {
      if (request.method !== 'POST' || request.headers.get('x-sk-app') !== '1') return json({ ok: false }, 403);
      try { await noteRead(env, (await request.json())?.ck); } catch { /* 무시 */ }
      return json({ ok: true });
    }
    if (url.pathname === '/api/health') {
      const db = await dbOn(env);
      if (!db) return json({ ok: true, ai: !!env.AI, shared: false });
      let made = 0;
      try { made = Number((await env.DB.prepare('SELECT COUNT(*) AS n FROM pre WHERE t >= ?').bind(Date.parse(today())).first())?.n) || 0; } catch { /* 무시 */ }
      return json({ ok: true, ai: !!env.AI, shared: true, spentToday: Math.round(await spentToday(env)), preToday: made, lastCron: JSON.parse((await metaGet(env, 'last')) || 'null') });
    }
    return env.ASSETS.fetch(request);
  },
  // 🌙 저녁 미리 만들기 — wrangler.jsonc 의 "triggers" 시간에 Cloudflare가 부름
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runCron(env));
  },
};
