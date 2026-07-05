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
var _authUid = null;
try {
  firebase.initializeApp(firebaseConfig);
  db = firebase.firestore();
  // functions/index.js 배포 리전과 반드시 일치시킬 것
  getGuideFn = firebase.app().functions('asia-northeast3').httpsCallable('getGuide');
  diagnoseFn = firebase.app().functions('asia-northeast3').httpsCallable('diagnose');
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
var _photoBase64 = null;
var _photoMediaType = null;

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
    user = { id: uid(), name: name, birthYear: birth, gender: gender, ctype: null, survey: null, guides: [] };
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
  if (!USER.ctype) {
    noSurvey.classList.remove('hidden');
    hasSurvey.classList.add('hidden');
  } else {
    noSurvey.classList.add('hidden');
    hasSurvey.classList.remove('hidden');
    var ct = CTYPES[USER.ctype];
    document.getElementById('home-ctype-badge').textContent = ct.name;
    document.getElementById('home-ctype-desc').textContent = ct.desc;
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
    var div = document.createElement('div');
    div.className = 'guide-item';
    var d = new Date(g.createdAt);
    var dateStr = d.getFullYear() + '.' + (d.getMonth() + 1) + '.' + d.getDate();
    div.innerHTML = '<div class="g-date">' + dateStr + '</div><div class="g-preview">' + g.text.slice(0, 60) + '...</div>';
    div.addEventListener('click', function () { showGuideResult(g.text); });
    el.appendChild(div);
  });
}

document.getElementById('btn-go-mypage').addEventListener('click', function () { renderMypage(); showScreen('scr-mypage'); });
document.getElementById('btn-mypage-back').addEventListener('click', function () { renderHome(); showScreen('scr-home'); });
document.getElementById('btn-start-survey').addEventListener('click', startSurvey);
document.getElementById('btn-resurvey').addEventListener('click', startSurvey);
document.getElementById('btn-survey-back').addEventListener('click', function () { showScreen('scr-home'); });
document.getElementById('btn-go-checkup').addEventListener('click', function () { showScreen('scr-checkup'); });
document.getElementById('btn-checkup-back').addEventListener('click', function () { showScreen('scr-home'); });
document.getElementById('btn-result-to-home').addEventListener('click', function () { renderHome(); showScreen('scr-home'); });
document.getElementById('btn-result-to-checkup').addEventListener('click', function () { showScreen('scr-checkup'); });
document.getElementById('btn-guide-to-home').addEventListener('click', function () { renderHome(); showScreen('scr-home'); });
document.getElementById('btn-guide-error-home').addEventListener('click', function () { renderHome(); showScreen('scr-home'); });
document.getElementById('btn-guide-retry').addEventListener('click', function () { requestGuide(_pendingCheckup); });
document.getElementById('btn-diagnose-submit').addEventListener('click', submitDiagnosis);
document.getElementById('btn-survey-retry').addEventListener('click', submitDiagnosis);
document.getElementById('btn-photo-remove').addEventListener('click', clearPhoto);
document.getElementById('in-photo').addEventListener('change', onPhotoSelected);

// ===== 체질 진단 =====
function startSurvey() {
  document.getElementById('in-description').value = '';
  document.getElementById('in-illness').value = '';
  clearPhoto();
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
    var span = document.createElement('span');
    span.className = 'chip';
    span.textContent = chip.label;
    span.addEventListener('click', function () {
      span.classList.toggle('active');
      var ta = document.getElementById('in-description');
      if (span.classList.contains('active')) {
        ta.value = (ta.value ? ta.value.replace(/\s+$/, '') + ' ' : '') + chip.text;
      } else {
        ta.value = ta.value.split(chip.text).join('').replace(/\s+/g, ' ').trim();
      }
    });
    el.appendChild(span);
  });
}

function onPhotoSelected(e) {
  var file = e.target.files && e.target.files[0];
  if (!file) return;
  var reader = new FileReader();
  reader.onload = function () {
    var dataUrl = reader.result; // data:image/jpeg;base64,....
    var parts = dataUrl.split(',');
    _photoMediaType = parts[0].match(/data:(.*);base64/)[1];
    _photoBase64 = parts[1];
    document.getElementById('photo-preview-img').src = dataUrl;
    document.getElementById('photo-preview').classList.remove('hidden');
  };
  reader.readAsDataURL(file);
}

function clearPhoto() {
  _photoBase64 = null;
  _photoMediaType = null;
  document.getElementById('in-photo').value = '';
  document.getElementById('photo-preview-img').src = '';
  document.getElementById('photo-preview').classList.add('hidden');
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

  diagnoseFn({
    gender: USER.gender || '',
    birthYear: USER.birthYear,
    description: description,
    illness: illness,
    photoBase64: _photoBase64,
    photoMediaType: _photoMediaType
  }).then(function (res) {
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
      hasPhoto: !!_photoBase64,
      reasoning: reasoning,
      diagnosedAt: Date.now()
    };
    upsertUser(USER);
    syncUserToFirestore();
    showDiagnosisResult(ctype, reasoning);
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
    ctype: USER.ctype,
    ctypeName: CTYPES[USER.ctype].name,
    checkup: checkup
  }).then(function (res) {
    var text = (res.data && res.data.text) ? res.data.text : '';
    if (!text) { onGuideError(); return; }
    var guide = { id: uid(), createdAt: Date.now(), checkup: checkup, text: text };
    USER.guides = USER.guides || [];
    USER.guides.push(guide);
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
  document.getElementById('guide-ctype-badge').textContent = CTYPES[USER.ctype].name;
  document.getElementById('guide-text').textContent = text;
  showScreen('scr-guide');
}

function onGuideError() {
  document.getElementById('guide-loading').classList.add('hidden');
  document.getElementById('guide-result').classList.add('hidden');
  document.getElementById('guide-error').classList.remove('hidden');
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
