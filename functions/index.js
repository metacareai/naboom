const functions = require('firebase-functions');

// 배포 전 아래 명령으로 API 키를 Secret Manager에 등록하세요 (Firestore/코드에 키를 직접 넣지 말 것):
//   firebase functions:secrets:set ANTHROPIC_KEY
const ANTHROPIC_KEY = process.env.ANTHROPIC_KEY;
const withSecret = { secrets: ['ANTHROPIC_KEY'] }; // 2026-07-05 재배포(시크릿 최신본 반영)

const CTYPE_NAMES = {
  taeyang: '태양인',
  taeeum: '태음인',
  soyang: '소양인',
  soeum: '소음인'
};

const GENDER_NAMES = { male: '남성', female: '여성' };

function buildPrompt(ctype, checkup) {
  var lines = [];
  if (ctype && CTYPE_NAMES[ctype]) lines.push('체질: ' + CTYPE_NAMES[ctype]);
  if (checkup.glucose) lines.push('공복혈당: ' + checkup.glucose + ' mg/dL');
  if (checkup.bpSys || checkup.bpDia) lines.push('혈압: ' + (checkup.bpSys || '?') + '/' + (checkup.bpDia || '?') + ' mmHg');
  if (checkup.chol) lines.push('총 콜레스테롤: ' + checkup.chol + ' mg/dL');
  if (checkup.weight) lines.push('체중: ' + checkup.weight + ' kg');
  if (checkup.memo) lines.push('기타 특이사항: ' + checkup.memo);
  return lines.join('\n');
}

async function callAnthropic(body) {
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify(body)
  });
  const json = await resp.json();
  if (!resp.ok) {
    console.error('Anthropic API 오류', json);
    throw new functions.https.HttpsError('internal', 'AI 응답 생성에 실패했습니다.');
  }
  return (json.content && json.content[0] && json.content[0].text) || '';
}

exports.getGuide = functions
  .runWith(withSecret)
  .region('asia-northeast3')
  .https.onCall(async (data, context) => {
    if (!ANTHROPIC_KEY) {
      throw new functions.https.HttpsError('failed-precondition', 'Anthropic API 키가 설정되지 않았습니다.');
    }

    const ctype = data && data.ctype;
    const checkup = (data && data.checkup) || {};
    const hasCtype = !!(ctype && CTYPE_NAMES[ctype]);

    const userInfo = buildPrompt(ctype, checkup);

    const system = '당신은 건강검진 수치를 현대의학 관점에서 알기 쉽게 풀어주는 건강 가이드 도우미입니다. ' +
      '사용자는 의료인이 아니며, 이 앱은 의료 행위를 하지 않습니다. ' +
      '반드시 "추천", "가이드", "도움" 같은 표현만 쓰고 "처방", "치료", "진단" 같은 의료 행위를 뜻하는 표현은 쓰지 마세요. ' +
      '먼저 입력된 검진 수치가 일반적인 기준에서 정상 범위인지, 주의가 필요한지를 현대의학 관점에서 쉽게 설명하세요. ' +
      (hasCtype
        ? '그 다음, 이 사람의 사상체질(' + CTYPE_NAMES[ctype] + ')을 함께 고려했을 때 어떤 식단·생활 습관이 특히 더 잘 맞는지 이어서 설명하세요.'
        : '체질 정보는 아직 없으니 일반적인 생활습관 가이드로 마무리하고, 마지막 문장에 "사상체질을 함께 알려주시면 체질에 맞춰 더 정교한 가이드를 드릴 수 있어요"라는 취지를 자연스럽게 덧붙이세요.'
      ) + ' ' +
      '전체 한국어 4~6문단, 친근하고 따뜻한 말투로 작성하세요. ' +
      '건강 이상이 의심되는 수치가 있다면 반드시 병원 진료를 권하는 문장을 포함하세요.';

    const body = {
      model: 'claude-haiku-4-5',
      max_tokens: 900,
      system: system,
      messages: [
        { role: 'user', content: userInfo || '입력된 검진 수치가 없습니다. 체질에 맞는 일반적인 생활 가이드를 알려주세요.' }
      ]
    };

    try {
      const text = await callAnthropic(body);
      return { text: text };
    } catch (e) {
      console.error('getGuide 처리 오류', e);
      throw new functions.https.HttpsError('internal', 'AI 응답 생성 중 오류가 발생했습니다.');
    }
  });

exports.diagnose = functions
  .runWith(withSecret)
  .region('asia-northeast3')
  .https.onCall(async (data, context) => {
    if (!ANTHROPIC_KEY) {
      throw new functions.https.HttpsError('failed-precondition', 'Anthropic API 키가 설정되지 않았습니다.');
    }

    const description = data && data.description;
    if (!description || !String(description).trim()) {
      throw new functions.https.HttpsError('invalid-argument', '소개 글이 비어 있습니다.');
    }
    const gender = (data && data.gender) || '';
    const birthYear = data && data.birthYear;
    const illness = (data && data.illness) || '';
    const previousCtype = data && data.previousCtype;
    const previousReasoning = (data && data.previousReasoning) || '';

    var infoLines = [];
    if (gender && GENDER_NAMES[gender]) infoLines.push('성별: ' + GENDER_NAMES[gender]);
    if (birthYear) infoLines.push('태어난 연도: ' + birthYear);
    infoLines.push('자기소개: ' + description);
    if (illness) infoLines.push('지병/복용약: ' + illness);
    if (previousCtype && CTYPE_NAMES[previousCtype]) {
      infoLines.push('이전 AI 판단: ' + CTYPE_NAMES[previousCtype] + (previousReasoning ? ' (이유: ' + previousReasoning + ')' : ''));
      infoLines.push('사용자는 이 이전 판단이 자신과 맞지 않는다고 느껴 위 내용을 더 자세히 적었습니다. 새로 적힌 내용을 충분히 반영해 다시 판단해주세요. 이전과 같은 체질이어도 괜찮지만, 다르게 느껴지면 바꿔도 됩니다.');
    }

    const system = '당신은 사상의학의 전통적 진단 요소인 체형기상(몸의 형태), 용모사기(얼굴 생김새와 인상), ' +
      '성질재간(성격과 기질), 병증약리(잘 걸리는 병과 몸의 반응 경향)를 참고하여 ' +
      '사용자의 사상체질을 태양인, 태음인, 소양인, 소음인 중 하나로 판단하는 도우미입니다. ' +
      '사용자는 의료인이 아니며 이는 의학적 진단이 아닌 참고용 체질 경향 분석입니다. ' +
      '반드시 아래 형식을 정확히 지켜 답하세요(다른 말은 덧붙이지 마세요):\n' +
      '체질: (태양인|태음인|소양인|소음인) 중 하나만\n' +
      '이유: 2~4문장, 친근한 말투로 왜 그렇게 판단했는지 설명';

    const body = {
      model: 'claude-haiku-4-5',
      max_tokens: 500,
      system: system,
      messages: [{ role: 'user', content: infoLines.join('\n') }]
    };

    try {
      const text = await callAnthropic(body);
      const ctypeMatch = text.match(/체질\s*[:：]\s*(태양인|태음인|소양인|소음인)/);
      const reasonMatch = text.match(/이유\s*[:：]\s*([\s\S]*)/);
      const NAME_TO_KEY = { 태양인: 'taeyang', 태음인: 'taeeum', 소양인: 'soyang', 소음인: 'soeum' };
      const ctype = ctypeMatch ? NAME_TO_KEY[ctypeMatch[1]] : null;
      if (!ctype) {
        console.error('진단 응답 형식 오류', text);
        throw new functions.https.HttpsError('internal', 'AI 응답 형식을 해석하지 못했습니다.');
      }
      const reasoning = reasonMatch ? reasonMatch[1].trim() : text.trim();
      return { ctype: ctype, reasoning: reasoning };
    } catch (e) {
      console.error('diagnose 처리 오류', e);
      if (e instanceof functions.https.HttpsError) throw e;
      throw new functions.https.HttpsError('internal', 'AI 진단 중 오류가 발생했습니다.');
    }
  });

exports.askCoach = functions
  .runWith(withSecret)
  .region('asia-northeast3')
  .https.onCall(async (data, context) => {
    if (!ANTHROPIC_KEY) {
      throw new functions.https.HttpsError('failed-precondition', 'Anthropic API 키가 설정되지 않았습니다.');
    }

    const message = data && data.message;
    if (!message || !String(message).trim()) {
      throw new functions.https.HttpsError('invalid-argument', '메시지가 비어 있습니다.');
    }
    const ctype = data && data.ctype;
    const checkup = (data && data.checkup) || {};
    const illness = (data && data.illness) || '';
    const history = Array.isArray(data && data.history) ? data.history.slice(-6) : [];

    var contextLines = [];
    if (ctype && CTYPE_NAMES[ctype]) contextLines.push('사용자 체질: ' + CTYPE_NAMES[ctype]);
    var checkupInfo = buildPrompt(null, checkup);
    if (checkupInfo) contextLines.push('최근 검진 수치:\n' + checkupInfo);
    if (illness) contextLines.push('지병/복용약: ' + illness);

    const system = '당신은 나봄 앱의 건강 코치입니다. 아래는 이 사용자에 대해 미리 알고 있는 정보입니다:\n' +
      (contextLines.join('\n') || '아직 알려진 정보가 없습니다.') + '\n\n' +
      '사용자는 의료인이 아니며, 이 앱은 의료 행위를 하지 않습니다. ' +
      '반드시 "추천", "가이드", "도움" 같은 표현만 쓰고 "처방", "치료", "진단" 같은 표현은 쓰지 마세요. ' +
      '위 정보를 참고해서 사용자의 질문에 짧고 친근한 대화체로 2~4문장 안에 답하세요. ' +
      '답변에 도움이 될 만한 정보가 부족하면, 답변 끝에 자연스러운 되물음을 딱 하나만 덧붙여도 됩니다 (여러 개 묻지 마세요). ' +
      '건강 이상이 의심되면 병원 진료를 권하는 문장을 포함하세요.';

    const messages = history
      .filter(function (m) { return m && m.role && m.text; })
      .map(function (m) { return { role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.text) }; });
    messages.push({ role: 'user', content: String(message) });

    const body = {
      model: 'claude-haiku-4-5',
      max_tokens: 400,
      system: system,
      messages: messages
    };

    try {
      const text = await callAnthropic(body);
      return { text: text };
    } catch (e) {
      console.error('askCoach 처리 오류', e);
      if (e instanceof functions.https.HttpsError) throw e;
      throw new functions.https.HttpsError('internal', 'AI 응답 생성 중 오류가 발생했습니다.');
    }
  });
