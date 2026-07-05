const functions = require('firebase-functions');

// 배포 전 아래 명령으로 API 키를 설정하세요 (Firestore/코드에 키를 직접 넣지 말 것):
//   firebase functions:config:set anthropic.key="sk-ant-실제키"
const ANTHROPIC_KEY = functions.config().anthropic && functions.config().anthropic.key;

const CTYPE_NAMES = {
  taeyang: '태양인',
  taeeum: '태음인',
  soyang: '소양인',
  soeum: '소음인'
};

const GENDER_NAMES = { male: '남성', female: '여성' };

function buildPrompt(ctype, checkup) {
  var lines = [];
  lines.push('체질: ' + (CTYPE_NAMES[ctype] || ctype));
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
  .region('asia-northeast3')
  .https.onCall(async (data, context) => {
    if (!ANTHROPIC_KEY) {
      throw new functions.https.HttpsError('failed-precondition', 'Anthropic API 키가 설정되지 않았습니다.');
    }

    const ctype = data && data.ctype;
    const checkup = (data && data.checkup) || {};
    if (!CTYPE_NAMES[ctype]) {
      throw new functions.https.HttpsError('invalid-argument', '체질 정보가 올바르지 않습니다.');
    }

    const userInfo = buildPrompt(ctype, checkup);

    const system = '당신은 사상체질과 서양의학 건강검진 결과를 함께 살펴보는 건강 가이드 도우미입니다. ' +
      '사용자는 의료인이 아니며, 이 앱은 의료 행위를 하지 않습니다. ' +
      '반드시 "추천", "가이드", "도움" 같은 표현만 쓰고 "처방", "치료", "진단" 같은 의료 행위를 뜻하는 표현은 쓰지 마세요. ' +
      '체질 특성과 입력된 검진 수치를 연결지어, 이 체질에서 해당 수치가 어떤 의미를 가질 수 있는지 쉽게 설명하고, ' +
      '체질에 맞는 식단·생활 습관 가이드를 한국어로 4~6문단, 친근하고 따뜻한 말투로 작성하세요. ' +
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
    const photoBase64 = data && data.photoBase64;
    const photoMediaType = data && data.photoMediaType;

    var infoLines = [];
    if (gender && GENDER_NAMES[gender]) infoLines.push('성별: ' + GENDER_NAMES[gender]);
    if (birthYear) infoLines.push('태어난 연도: ' + birthYear);
    infoLines.push('자기소개: ' + description);
    if (illness) infoLines.push('지병/복용약: ' + illness);

    const system = '당신은 사상의학의 전통적 진단 요소인 체형기상(몸의 형태), 용모사기(얼굴 생김새와 인상), ' +
      '성질재간(성격과 기질), 병증약리(잘 걸리는 병과 몸의 반응 경향)를 참고하여 ' +
      '사용자의 사상체질을 태양인, 태음인, 소양인, 소음인 중 하나로 판단하는 도우미입니다. ' +
      '사용자는 의료인이 아니며 이는 의학적 진단이 아닌 참고용 체질 경향 분석입니다. ' +
      '사진이 함께 제공되면 체형과 인상을 참고하되, 외모를 평가하거나 부정적으로 표현하지 마세요. ' +
      '반드시 아래 형식을 정확히 지켜 답하세요(다른 말은 덧붙이지 마세요):\n' +
      '체질: (태양인|태음인|소양인|소음인) 중 하나만\n' +
      '이유: 2~4문장, 친근한 말투로 왜 그렇게 판단했는지 설명';

    const content = [{ type: 'text', text: infoLines.join('\n') }];
    if (photoBase64 && photoMediaType) {
      content.push({
        type: 'image',
        source: { type: 'base64', media_type: photoMediaType, data: photoBase64 }
      });
    }

    const body = {
      model: 'claude-haiku-4-5',
      max_tokens: 500,
      system: system,
      messages: [{ role: 'user', content: content }]
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
