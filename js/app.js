// ===== Firebase 설정 =====
// TODO: Firebase 콘솔에서 실제 프로젝트를 만든 뒤 아래 값을 교체하세요.
// 참고: 이 값들을 채우지 않아도 로그인/마이페이지는 로컬(localStorage)로 정상 동작합니다.
// 체질 진단과 AI 맞춤 가이드(Cloud Function 호출)는 실제 Firebase 프로젝트 연결이 필요합니다.
var firebaseConfig = {
  apiKey: "REPLACE_WITH_YOUR_FIREBASE_API_KEY",
  authDomain: "REPLACE_WITH_YOUR_PROJECT.firebaseapp.com",
  projectId: "REPLACE_WITH_YOUR_PROJECT_ID",
  storageBucket: "REPLACE_WITH_YOUR_PROJECT.firebasestorage.app",
  messagingSenderId: "REPLACE_ME",
  appId: "REPLACE_ME"
};

var _fbReady = false;
var db = null;
var getGuideFn = null;
var diagnoseFn = null;
var askCoachFn = null;
var _authUid = null;
try {
  firebase.initializeApp(firebaseConfig);
  db = firebase.firestore();
  // functions/index.js 배포 리전과 반드시 일치시킬 것
  getGuideFn = firebase.app().functions('asia-northeast3').httpsCallable('getGuide');
  diagnoseFn = firebase.app().functions('asia-northeast3').httpsCallable('diagnose');
  askCoachFn = firebase.app().functions('asia-northeast3').httpsCallable('askCoach');
  _fbReady = true;
  // 익명 인증: Firestore 보안 규칙에서 request.auth.uid로 사용자별 데이터를 분리하기 위함
  firebase.auth().signInAnonymously().then(function (cred) {
    _authUid = cred.user.uid;
  }).catch(function (e) { console.warn('익명 인증 실패 - Firestore 동기화는 건너뜁니다.', e); });
} catch (e) {
  console.warn('Firebase 초기화 실패 - 로컬 모드로 동작합니다.', e);
}

// ===== 체질 데이터 =====
var CTYPES = {
  taeyang: {
    name: '태양인',
    desc: '진취적이고 사교적이며 창의적인 기운이 강한 편이에요. 다만 간 기능이 약할 수 있어 과로와 과음을 피하고, 담백한 채소와 해산물 위주 식단이 잘 맞아요.'
  },
  taeeum: {
    name: '태음인',
    desc: '묵묵하고 끈기 있으며 큰 그릇을 가진 편이에요. 살이 찌기 쉬운 체질이라 꾸준한 유산소 운동과 과식을 피하는 습관이 중요해요.'
  },
  soyang: {
    name: '소양인',
    desc: '민첩하고 사교적이며 열정적인 편이에요. 몸에 열이 많아 자극적이고 기름진 음식보다 시원하고 담백한 음식이 잘 맞아요.'
  },
  soeum: {
    name: '소음인',
    desc: '차분하고 꼼꼼하며 계획적인 편이에요. 소화 기능이 약하고 손발이 찬 편이라 따뜻한 음식과 규칙적인 소식 습관이 도움이 돼요.'
  }
};
var CTYPE_ORDER = ['taeyang', 'taeeum', 'soyang', 'soeum'];

// ===== 주간 체질 가이드 콘텐츠 뱅크 (AI 호출 없이 로테이션, 매주 갱신) =====
var WEEKLY_TIPS = {
  taeyang: [
    { title: '간을 아끼는 한 주', body: '과음·과로를 피하고 담백한 채소·해산물 위주로 드세요. 무리한 승부욕보다 여유를 가지면 몸이 더 편해요.' },
    { title: '목 건강 챙기기', body: '목이 쉽게 피로해지는 편이니 말을 많이 한 날은 따뜻한 물과 배·도라지 같은 음식으로 목을 달래주세요.' },
    { title: '메밀과 잘 맞아요', body: '태양인에게는 메밀, 순채나물, 조개류처럼 서늘하고 담백한 음식이 잘 맞아요. 이번 주 한 끼는 메밀국수 어떠세요?' },
    { title: '과음 주의보', body: '회식이 있는 주라면 평소보다 술을 줄여보세요. 간이 약한 편이라 다음날 회복이 더딜 수 있어요.' },
    { title: '가벼운 유산소', body: '격렬한 운동보다 산책이나 가벼운 조깅처럼 꾸준히 할 수 있는 운동이 잘 맞아요.' },
    { title: '여유 있는 마음', body: '급하게 몰아붙이기보다 이번 주는 한 박자 쉬어가는 걸 목표로 삼아보세요.' }
  ],
  taeeum: [
    { title: '체중 관리 습관', body: '살이 찌기 쉬운 편이니 이번 주는 과식 한 끼만 줄여봐도 충분해요.' },
    { title: '땀 내는 운동', body: '태음인은 땀을 흘리고 나면 몸이 개운해지는 편이에요. 이번 주 20분 이상 걷기 어떠세요?' },
    { title: '콩과 채소', body: '콩류, 무, 다시마처럼 담백한 음식이 잘 맞아요. 기름진 음식은 조금만 줄여도 몸이 가벼워져요.' },
    { title: '느긋함이 강점', body: '끈기 있고 참을성이 많은 편이라, 이번 주는 급한 다이어트보다 천천히 오래 갈 습관 하나만 만들어보세요.' },
    { title: '변비엔 이렇게', body: '변비 경향이 있다면 아침에 미지근한 물 한 잔과 섬유질 채소를 챙겨보세요.' },
    { title: '야식 줄이기', body: '저녁 늦은 시간의 야식이 특히 안 맞는 편이에요. 이번 주는 저녁 8시 이후엔 물만 드셔보는 건 어떨까요?' }
  ],
  soyang: [
    { title: '열을 식히는 음식', body: '몸에 열이 많은 편이니 맵고 자극적인 음식보다 오이, 배, 수박처럼 시원한 음식이 잘 맞아요.' },
    { title: '감정 다스리기', body: '화가 났을 때 바로 표현하는 편인데, 이번 주는 한 박자 쉬고 말해보는 연습을 해보세요.' },
    { title: '숙면 챙기기', body: '활동적인 만큼 밤에 흥분 상태가 이어질 수 있어요. 자기 전 스마트폰을 줄이고 일찍 눕는 습관을 만들어보세요.' },
    { title: '튀김 줄이기', body: '기름지고 자극적인 음식은 몸의 열을 더 올릴 수 있어요. 이번 주 한 끼는 담백하게 먹어보세요.' },
    { title: '한 박자 쉬고 결정하기', body: '급하게 결정하기보다 하루 정도 묵혀두고 판단하는 습관이 도움이 돼요.' },
    { title: '수분 보충', body: '땀과 활동량이 많은 편이라 물을 평소보다 조금 더 챙겨 드세요.' }
  ],
  soeum: [
    { title: '따뜻한 음식이 좋아요', body: '소화 기능이 약한 편이라 찬 음식보다 따뜻한 국물, 생강차 같은 게 잘 맞아요.' },
    { title: '소식 습관', body: '한 번에 많이 먹기보다 조금씩 자주 먹는 게 소화에 더 도움이 돼요.' },
    { title: '손발 따뜻하게', body: '손발이 찬 편이라면 이번 주는 반신욕이나 따뜻한 양말로 몸을 데워보세요.' },
    { title: '무리하지 않기', body: '기초 체력이 약한 편이니 이번 주는 평소보다 30분 일찍 잠자리에 들어보는 건 어떨까요?' },
    { title: '찬 음료 줄이기', body: '얼음이 많이 든 음료는 소화에 부담을 줄 수 있어요. 미지근한 물로 바꿔보세요.' },
    { title: '규칙적인 식사시간', body: '불규칙한 식사가 특히 안 맞는 편이라, 이번 주는 식사 시간을 일정하게 맞춰보세요.' }
  ]
};
function getWeekIndex() { return Math.floor(Date.now() / (7 * 24 * 60 * 60 * 1000)); }
function getWeeklyTip(ctype) {
  var tips = WEEKLY_TIPS[ctype];
  if (!tips || !tips.length) return null;
  return tips[getWeekIndex() % tips.length];
}

// ===== 빠른 신호 칩 (탭하면 소개글에 문장 추가) =====
var CHIPS = [
  { label: '손발이 차요', text: '손발이 찬 편이에요.' },
  { label: '더위를 많이 타요', text: '더위를 많이 타는 편이에요.' },
  { label: '땀이 많아요', text: '땀이 많은 편이에요.' },
  { label: '땀이 적어요', text: '땀이 적은 편이에요.' },
  { label: '소화가 잘 안돼요', text: '소화가 잘 안 되는 편이에요.' },
  { label: '소화가 잘돼요', text: '소화가 잘 되고 잘 먹는 편이에요.' },
  { label: '변비가 있어요', text: '변비 경향이 있어요.' },
  { label: '대변이 무른 편이에요', text: '대변이 무르거나 자주 변하는 편이에요.' }
];

// ===== 상태 =====
var USER = null;      // 현재 로그인 사용자 (localStorage 기준)
var _pendingCheckup = null;
var _isRefining = false;
var _returnToGuideAfterDiagnosis = false; // 가이드 화면에서 "체질 추가하기"로 진입한 경우

// ===== 로컬 저장소 =====
function loadUsers() {
  try { return JSON.parse(localStorage.getItem('nb_users') || '[]'); }
  catch (e) { return []; }
}
function saveUsers(list) { localStorage.setItem('nb_users', JSON.stringify(list)); }
function findUser(name, birthYear) {
  var list = loadUsers();
  for (var i = 0; i < list.length; i++) {
    if (list[i].name === name && String(list[i].birthYear) === String(birthYear)) return list[i];
  }
  return null;
}
function upsertUser(user) {
  var list = loadUsers();
  var idx = -1;
  for (var i = 0; i < list.length; i++) { if (list[i].id === user.id) { idx = i; break; } }
  if (idx >= 0) list[idx] = user; else list.push(user);
  saveUsers(list);
}
function uid() { return 'u_' + Date.now() + '_' + Math.floor(Math.random() * 10000); }

// ===== 화면 전환 =====
function showScreen(id) {
  var screens = document.querySelectorAll('.screen');
  for (var i = 0; i < screens.length; i++) screens[i].classList.remove('active');
  document.getElementById(id).classList.add('active');
  window.scrollTo(0, 0);
}

// ===== 로그인 =====
document.getElementById('btn-login').addEventListener('click', function () {
  var name = document.getElementById('in-name').value.trim();
  var birth = document.getElementById('in-birth').value.trim();
  var gender = document.getElementById('in-gender').value;
  if (!name) { alert('이름을 입력해주세요.'); return; }
  if (!birth || isNaN(Number(birth))) { alert('태어난 연도를 숫자로 입력해주세요.'); return; }

  var user = findUser(name, birth);
  if (!user) {
    user = { id: uid(), name: name, birthYear: birth, gender: gender, ctype: null, survey: null, guides: [], lastCheckup: null, chatLog: [], chatToday: null };
    upsertUser(user);
  } else if (gender && user.gender !== gender) {
    user.gender = gender;
    upsertUser(user);
  }
  USER = user;
  localStorage.setItem('nb_last_user', USER.id);
  renderHome();
  showScreen('scr-home');
});

function tryAutoLogin() {
  var lastId = localStorage.getItem('nb_last_user');
  if (!lastId) return false;
  var list = loadUsers();
  for (var i = 0; i < list.length; i++) {
    if (list[i].id === lastId) {
      USER = list[i];
      renderHome();
      showScreen('scr-home');
      return true;
    }
  }
  return false;
}

document.getElementById('btn-logout').addEventListener('click', function () {
  localStorage.removeItem('nb_last_user');
  USER = null;
  showScreen('scr-landing');
});

// ===== 홈 =====
function renderHome() {
  var noSurvey = document.getElementById('home-no-survey');
  var hasSurvey = document.getElementById('home-has-survey');
  var weeklyCard = document.getElementById('home-weekly-card');
  if (!USER.ctype) {
    noSurvey.classList.remove('hidden');
    hasSurvey.classList.add('hidden');
    weeklyCard.classList.add('hidden');
  } else {
    noSurvey.classList.add('hidden');
    hasSurvey.classList.remove('hidden');
    var ct = CTYPES[USER.ctype];
    document.getElementById('home-ctype-badge').textContent = ct.name;
    document.getElementById('home-ctype-desc').textContent = ct.desc;

    var tip = getWeeklyTip(USER.ctype);
    if (tip) {
      weeklyCard.classList.remove('hidden');
      document.getElementById('home-weekly-title').textContent = '이번 주 가이드: ' + tip.title;
      document.getElementById('home-weekly-preview').textContent = tip.body;
    } else {
      weeklyCard.classList.add('hidden');
    }
  }
  renderGuideList('home-guide-list');
}

function renderGuideList(containerId) {
  var el = document.getElementById(containerId);
  el.innerHTML = '';
  var guides = (USER.guides || []).slice().reverse();
  if (guides.length === 0) {
    el.innerHTML = '<div class="empty-note">아직 받은 가이드가 없어요.</div>';
    return;
  }
  guides.forEach(function (g) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'guide-item';
    var d = new Date(g.createdAt);
    var dateStr = d.getFullYear() + '.' + (d.getMonth() + 1) + '.' + d.getDate();
    btn.innerHTML = '<div class="g-date">' + dateStr + '</div><div class="g-preview">' + g.text.slice(0, 60) + '...</div>';
    btn.addEventListener('click', function () { showGuideResult(g.text); });
    el.appendChild(btn);
  });
}

document.getElementById('btn-go-mypage').addEventListener('click', function () { renderMypage(); showScreen('scr-mypage'); });
document.getElementById('btn-mypage-back').addEventListener('click', function () { renderHome(); showScreen('scr-home'); });
document.getElementById('btn-start-survey').addEventListener('click', startSurvey);
document.getElementById('btn-resurvey').addEventListener('click', startSurvey);
document.getElementById('btn-survey-back').addEventListener('click', function () { showScreen('scr-home'); });
document.getElementById('btn-go-checkup').addEventListener('click', function () { openCheckup(); });
document.getElementById('btn-checkup-back').addEventListener('click', function () { showScreen('scr-home'); });
document.getElementById('btn-result-to-home').addEventListener('click', function () { renderHome(); showScreen('scr-home'); });
document.getElementById('btn-result-to-checkup').addEventListener('click', function () { openCheckup(); });
document.getElementById('btn-guide-to-home').addEventListener('click', function () { renderHome(); showScreen('scr-home'); });
document.getElementById('btn-guide-error-home').addEventListener('click', function () { renderHome(); showScreen('scr-home'); });
document.getElementById('btn-guide-retry').addEventListener('click', function () { requestGuide(_pendingCheckup); });
document.getElementById('btn-diagnose-submit').addEventListener('click', submitDiagnosis);
document.getElementById('btn-survey-retry').addEventListener('click', submitDiagnosis);
document.getElementById('btn-result-refine').addEventListener('click', startRefine);
document.getElementById('btn-guide-add-ctype').addEventListener('click', function () {
  _returnToGuideAfterDiagnosis = true;
  startSurvey();
});
document.getElementById('btn-go-weekly').addEventListener('click', openWeekly);
document.getElementById('btn-weekly-back').addEventListener('click', function () { renderHome(); showScreen('scr-home'); });
document.getElementById('btn-chat-send').addEventListener('click', sendChatMessage);
document.getElementById('chat-input').addEventListener('keydown', function (e) {
  if (e.key === 'Enter') { e.preventDefault(); sendChatMessage(); }
});

function openCheckup() {
  var hint = document.getElementById('checkup-mode-hint');
  if (USER.ctype) {
    hint.textContent = CTYPES[USER.ctype].name + ' 체질을 반영해서 더 정교하게 분석해드려요. 모르는 항목은 비워두셔도 됩니다.';
  } else {
    hint.textContent = '건강검진 결과가 있다면 입력해주세요. 모르는 항목은 비워두셔도 됩니다. 현대의학 관점에서 쉽게 풀어드려요.';
  }
  showScreen('scr-checkup');
}

// ===== 체질 진단 =====
function startSurvey() {
  _isRefining = false;
  document.getElementById('in-description').value = '';
  document.getElementById('in-illness').value = '';
  document.getElementById('refine-note').classList.add('hidden');
  renderChips();
  document.getElementById('survey-form-card').classList.remove('hidden');
  document.getElementById('survey-loading').classList.add('hidden');
  document.getElementById('survey-error').classList.add('hidden');
  showScreen('scr-survey');
}

// 진단 결과가 미흡하다고 느낄 때 - 이전 답변을 유지한 채 내용을 더 적어서 재진단
function startRefine() {
  _isRefining = true;
  var s = USER.survey || {};
  document.getElementById('in-description').value = s.description || '';
  document.getElementById('in-illness').value = s.illness || '';
  var note = document.getElementById('refine-note');
  var ctName = CTYPES[USER.ctype] ? CTYPES[USER.ctype].name : '';
  note.textContent = '이전 진단 결과: ' + ctName + '. 놓친 부분이나 다르게 느껴지는 점을 아래 내용에 더 적어주시면 다시 살펴볼게요.';
  note.classList.remove('hidden');
  renderChips();
  document.getElementById('survey-form-card').classList.remove('hidden');
  document.getElementById('survey-loading').classList.add('hidden');
  document.getElementById('survey-error').classList.add('hidden');
  showScreen('scr-survey');
}

function renderChips() {
  var el = document.getElementById('signal-chips');
  el.innerHTML = '';
  CHIPS.forEach(function (chip) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'chip';
    btn.textContent = chip.label;
    btn.addEventListener('click', function () {
      btn.classList.toggle('active');
      var ta = document.getElementById('in-description');
      if (btn.classList.contains('active')) {
        ta.value = (ta.value ? ta.value.replace(/\s+$/, '') + ' ' : '') + chip.text;
      } else {
        ta.value = ta.value.split(chip.text).join('').replace(/\s+/g, ' ').trim();
      }
    });
    el.appendChild(btn);
  });
}

function submitDiagnosis() {
  var description = document.getElementById('in-description').value.trim();
  var illness = document.getElementById('in-illness').value.trim();
  if (!description) { alert('나를 소개하는 글을 입력해주세요.'); return; }

  document.getElementById('survey-form-card').classList.add('hidden');
  document.getElementById('survey-error').classList.add('hidden');
  document.getElementById('survey-loading').classList.remove('hidden');

  if (!diagnoseFn) {
    document.getElementById('survey-loading').classList.add('hidden');
    document.getElementById('survey-error').classList.remove('hidden');
    return;
  }

  var payload = {
    gender: USER.gender || '',
    birthYear: USER.birthYear,
    description: description,
    illness: illness
  };
  if (_isRefining && USER.survey) {
    payload.previousCtype = USER.ctype;
    payload.previousReasoning = USER.survey.reasoning || '';
  }

  diagnoseFn(payload).then(function (res) {
    var ctype = res.data && res.data.ctype;
    var reasoning = (res.data && res.data.reasoning) || '';
    if (!CTYPES[ctype]) {
      document.getElementById('survey-loading').classList.add('hidden');
      document.getElementById('survey-error').classList.remove('hidden');
      return;
    }
    USER.ctype = ctype;
    USER.survey = {
      description: description,
      illness: illness,
      reasoning: reasoning,
      diagnosedAt: Date.now()
    };
    upsertUser(USER);
    syncUserToFirestore();
    if (_returnToGuideAfterDiagnosis) {
      _returnToGuideAfterDiagnosis = false;
      requestGuide(_pendingCheckup);
    } else {
      showDiagnosisResult(ctype, reasoning);
    }
  }).catch(function (err) {
    console.warn('진단 요청 실패', err);
    document.getElementById('survey-loading').classList.add('hidden');
    document.getElementById('survey-error').classList.remove('hidden');
  });
}

function showDiagnosisResult(ctype, reasoning) {
  var ct = CTYPES[ctype];
  document.getElementById('result-ctype-badge').textContent = ct.name;
  document.getElementById('result-ctype-name').textContent = ct.name;
  document.getElementById('result-ctype-desc').textContent = ct.desc;
  document.getElementById('result-ai-reason').textContent = reasoning;
  showScreen('scr-result');
}

// ===== 검진 결과 입력 =====
document.getElementById('btn-checkup-submit').addEventListener('click', function () {
  var checkup = {
    glucose: document.getElementById('ck-glucose').value.trim(),
    bpSys: document.getElementById('ck-bp-sys').value.trim(),
    bpDia: document.getElementById('ck-bp-dia').value.trim(),
    chol: document.getElementById('ck-chol').value.trim(),
    weight: document.getElementById('ck-weight').value.trim(),
    memo: document.getElementById('ck-memo').value.trim()
  };
  requestGuide(checkup);
});

function requestGuide(checkup) {
  _pendingCheckup = checkup;
  showScreen('scr-guide');
  document.getElementById('guide-result').classList.add('hidden');
  document.getElementById('guide-error').classList.add('hidden');
  document.getElementById('guide-loading').classList.remove('hidden');

  if (!getGuideFn) {
    onGuideError();
    return;
  }

  getGuideFn({
    ctype: USER.ctype || null,
    ctypeName: USER.ctype ? CTYPES[USER.ctype].name : null,
    checkup: checkup
  }).then(function (res) {
    var text = (res.data && res.data.text) ? res.data.text : '';
    if (!text) { onGuideError(); return; }
    var guide = { id: uid(), createdAt: Date.now(), checkup: checkup, text: text };
    USER.guides = USER.guides || [];
    USER.guides.push(guide);
    USER.lastCheckup = checkup;
    upsertUser(USER);
    syncGuideToFirestore(guide);
    showGuideResult(text);
  }).catch(function (err) {
    console.warn('가이드 요청 실패', err);
    onGuideError();
  });
}

function showGuideResult(text) {
  document.getElementById('guide-loading').classList.add('hidden');
  document.getElementById('guide-error').classList.add('hidden');
  document.getElementById('guide-result').classList.remove('hidden');

  var badge = document.getElementById('guide-ctype-badge');
  if (USER.ctype) {
    badge.textContent = CTYPES[USER.ctype].name;
    badge.classList.remove('hidden');
  } else {
    badge.classList.add('hidden');
  }
  document.getElementById('btn-guide-add-ctype').classList.toggle('hidden', !!USER.ctype);

  document.getElementById('guide-text').textContent = text;
  showScreen('scr-guide');
}

function onGuideError() {
  document.getElementById('guide-loading').classList.add('hidden');
  document.getElementById('guide-result').classList.add('hidden');
  document.getElementById('guide-error').classList.remove('hidden');
}

// ===== 주간 가이드 + AI 코치 채팅 =====
var CHAT_DAILY_LIMIT = 3;

function todayStr() {
  var d = new Date();
  return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
}

function getTodayChatCount() {
  if (!USER.chatToday || USER.chatToday.date !== todayStr()) return 0;
  return USER.chatToday.count || 0;
}

function openWeekly() {
  var tip = getWeeklyTip(USER.ctype);
  document.getElementById('weekly-ctype-badge').textContent = CTYPES[USER.ctype].name;
  document.getElementById('weekly-tip-title').textContent = tip ? tip.title : '';
  document.getElementById('weekly-tip-body').textContent = tip ? tip.body : '';
  renderChatLog();
  updateChatLimitUI();
  showScreen('scr-weekly');
}

function renderChatLog() {
  var el = document.getElementById('chat-log');
  el.innerHTML = '';
  var log = (USER.chatLog || []).slice(-12);
  log.forEach(function (m) {
    var div = document.createElement('div');
    div.className = 'chat-msg ' + (m.role === 'user' ? 'user' : 'assistant');
    div.textContent = m.text;
    el.appendChild(div);
  });
  el.scrollTop = el.scrollHeight;
}

function updateChatLimitUI() {
  var count = getTodayChatCount();
  var row = document.getElementById('chat-input-row');
  var note = document.getElementById('chat-limit-note');
  if (count >= CHAT_DAILY_LIMIT) {
    row.classList.add('hidden');
    note.textContent = '오늘 대화는 여기까지예요. 매일 조금씩 이야기 나누면서 당신을 더 잘 알아갈게요 :) 내일 또 와주세요.';
    note.classList.remove('hidden');
  } else {
    row.classList.remove('hidden');
    note.textContent = '오늘 ' + count + '/' + CHAT_DAILY_LIMIT + '번 대화했어요.';
    note.classList.remove('hidden');
  }
}

function sendChatMessage() {
  var input = document.getElementById('chat-input');
  var message = input.value.trim();
  if (!message) return;
  if (getTodayChatCount() >= CHAT_DAILY_LIMIT) { updateChatLimitUI(); return; }

  input.value = '';
  USER.chatLog = USER.chatLog || [];
  USER.chatLog.push({ role: 'user', text: message, ts: Date.now() });
  renderChatLog();

  if (!askCoachFn) {
    USER.chatLog.push({ role: 'assistant', text: '지금은 코치에게 물어볼 수 없어요. 잠시 후 다시 시도해주세요.', ts: Date.now() });
    renderChatLog();
    return;
  }

  var history = USER.chatLog.slice(0, -1).slice(-6);

  askCoachFn({
    ctype: USER.ctype || null,
    ctypeName: USER.ctype ? CTYPES[USER.ctype].name : null,
    checkup: USER.lastCheckup || null,
    illness: (USER.survey && USER.survey.illness) || '',
    history: history,
    message: message
  }).then(function (res) {
    var reply = (res.data && res.data.text) || '답변을 가져오지 못했어요.';
    USER.chatLog.push({ role: 'assistant', text: reply, ts: Date.now() });
    if (USER.chatLog.length > 40) USER.chatLog = USER.chatLog.slice(-40);

    var today = todayStr();
    if (!USER.chatToday || USER.chatToday.date !== today) USER.chatToday = { date: today, count: 0 };
    USER.chatToday.count++;

    upsertUser(USER);
    syncUserToFirestore();
    renderChatLog();
    updateChatLimitUI();
  }).catch(function (err) {
    console.warn('코치 채팅 실패', err);
    USER.chatLog.push({ role: 'assistant', text: '답변을 가져오지 못했어요. 잠시 후 다시 시도해주세요.', ts: Date.now() });
    upsertUser(USER);
    renderChatLog();
  });
}

// ===== 마이페이지 =====
var GENDER_LABEL = { male: '남성', female: '여성' };
function renderMypage() {
  document.getElementById('my-name').textContent = USER.name;
  document.getElementById('my-birth').textContent = USER.birthYear;
  document.getElementById('my-gender').textContent = GENDER_LABEL[USER.gender] || '선택 안 함';
  document.getElementById('my-ctype').textContent = USER.ctype ? CTYPES[USER.ctype].name : '진단 전';
  renderGuideList('mypage-guide-list');
}

// ===== Firestore 동기화 (best-effort, 실패해도 앱 동작에 지장 없음) =====
// 문서 ID는 항상 Firebase 익명 인증 uid를 사용 (firestore.rules가 request.auth.uid로 접근을 제한함)
function syncUserToFirestore() {
  if (!_fbReady || !db || !_authUid) return;
  try {
    db.collection('users').doc(_authUid).set({
      name: USER.name,
      birthYear: USER.birthYear,
      gender: USER.gender || '',
      ctype: USER.ctype,
      survey: USER.survey,
      lastCheckup: USER.lastCheckup || null,
      chatLog: USER.chatLog || [],
      chatToday: USER.chatToday || null,
      updatedAt: Date.now()
    }, { merge: true }).catch(function (e) { console.warn('Firestore 사용자 동기화 실패', e); });
  } catch (e) { console.warn('Firestore 사용자 동기화 실패', e); }
}

function syncGuideToFirestore(guide) {
  if (!_fbReady || !db || !_authUid) return;
  try {
    db.collection('users').doc(_authUid).collection('guides').doc(guide.id).set(guide)
      .catch(function (e) { console.warn('Firestore 가이드 동기화 실패', e); });
  } catch (e) { console.warn('Firestore 가이드 동기화 실패', e); }
}

// ===== 서비스워커 =====
if ('serviceWorker' in navigator) {
  window.addEventListener('load', function () {
    navigator.serviceWorker.register('sw.js').catch(function (e) { console.warn('SW 등록 실패', e); });
  });
}

// ===== 시작 =====
(function init() {
  if (!tryAutoLogin()) showScreen('scr-landing');
})();
