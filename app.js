/* からだログ — 今日やる動画を1本だけ出して、やったことを記録する
 *
 * 考え方
 *  - 部位は 上半身 → 下半身 → 体幹 の順にまわす(最後にやった部位の次を出す)
 *  - 「まだできそう」が2回続いたら、その部位の動画を1段きつくする
 *  - 2本目は全身の動画から出す(同じ部位を続けると負荷が偏るため)
 *  - データはこの端末の localStorage だけ。外には出さない
 */
'use strict';

const STORE_KEY = 'karadalog.v1';
/* 部位のまわし方: 下半身 → 上半身 → 全身 → 体幹 の4日サイクル。
 * 目標が「筋肉を増やす」なので、体で一番大きい下半身から始め、全身の日を挟んで
 * 下半身と上半身に当たる回数を増やす。厚労省ガイドも大きな筋群をまんべんなく鍛えることを勧めている。 */
const PARTS = ['lower', 'upper', 'full', 'core'];
const PART_LABEL = { upper: '上半身', lower: '下半身', core: '体幹', full: '全身', warmup: 'ウォームアップ' };
const LEVELS = ['easy', 'normal', 'hard'];
const LEVEL_LABEL = { easy: 'やさしい', normal: 'ふつう', hard: 'きつい' };
const SPARE_TO_LEVEL_UP = 2;   // 「できそう」がこの回数続いたらレベルを上げる
const BACKUP_REMIND_DAYS = 30;

/* 動画マスタ — YouTube「ザ・きんにくTV」再生リスト「自宅で筋トレ」全30本
 * len は動画の長さ(解説を含む総尺)。実際に動く時間はタイトルの「○分」のほう。
 * part / level はタイトルから分類したもの。中身を全部見てはいないので、設定画面で直せる。
 */
const DEFAULT_VIDEOS = [
  // 上半身 — sub で胸→背中→肩→腕と内部でまわす(胸が2本あるので、放っておくと偏る)
  { id: 'PquP1dO3uKg', name: '大胸筋 7種目3分半', len: '15:17', part: 'upper', sub: '胸', level: 'normal' },
  { id: 'RIqa_JtJ3jk', name: '胸＆腹筋 10種目5分', len: '11:05', part: 'upper', sub: '胸', level: 'easy' },
  { id: 'al3CoAGcrTE', name: '背筋 8種目4分（器具なし）', len: '14:45', part: 'upper', sub: '背中', level: 'normal' },
  { id: 'DAI9IcAxfPA', name: '肩（三角筋）7種目4分', len: '16:27', part: 'upper', sub: '肩', level: 'normal' },
  { id: 'yjTD95S3TUc', name: '二の腕＆力こぶ 7種目4分半', len: '15:33', part: 'upper', sub: '腕', level: 'easy' },
  { id: 'LARsdRVCvHU', name: '上半身6分（ペットボトルでも可）', len: '13:45', part: 'upper', sub: '上半身まとめて', level: 'normal' },

  // 下半身 — 体で一番大きい筋群。ここが筋肉量に一番効く
  { id: 'BFitLouawaM', name: '脚 7種目3分半（初級）', len: '15:15', part: 'lower', sub: '太もも', level: 'easy' },
  { id: 'OlGiInYmSiw', name: 'レッグランジ 4種目3分', len: '10:57', part: 'lower', sub: 'ランジ', level: 'easy' },
  { id: 'eqZoAgF5Hkw', name: 'お尻 7種目4分半', len: '15:48', part: 'lower', sub: 'お尻', level: 'normal' },
  { id: 'tkRfK1dr15o', name: 'お尻＆内もも 10分', len: '15:52', part: 'lower', sub: 'お尻', level: 'normal' },
  { id: 'oalL5-xQeNg', name: '下半身 9種目6分（中級）', len: '14:24', part: 'lower', sub: '下半身まとめて', level: 'normal' },
  { id: 'GxDRXrpJjpI', name: '腹筋＆下半身 立ったまま9種目10分', len: '10:51', part: 'lower', sub: '立ったまま', level: 'normal' },
  { id: 'OY4JjthP99g', name: '脚 超高強度（企画動画・長い）', len: '28:35', part: 'lower', sub: '太もも', level: 'hard' },

  // 全身 — 下半身と上半身にもう一度当てるための日。在庫が一番多い
  { id: 'nhGh9N0baQA', name: 'スロートレーニング 基本6種目', len: '10:55', part: 'full', sub: 'スロトレ', level: 'easy' },
  { id: 'hge3fr50o0o', name: '全身10種目10分（世界一楽）', len: '11:40', part: 'full', sub: '全身', level: 'easy' },
  { id: 'hMSUxAJHwyc', name: '全身9種目（世界一楽）', len: '14:20', part: 'full', sub: '全身', level: 'easy' },
  { id: 'n5Sl3zSvIUQ', name: '続けられる筋トレ 2種目', len: '13:25', part: 'full', sub: '短い', level: 'easy' },
  { id: 'PqPnVMeYvo4', name: '世界一楽な筋トレ 第2弾', len: '12:43', part: 'full', sub: '短い', level: 'easy' },
  { id: 'SjmZGTU9tPM', name: '座ってできる全身 5分', len: '6:26', part: 'full', sub: '座ってできる', level: 'easy' },
  { id: '1nmW7eILIDA', name: '全身12種目（初心者向け解説つき）', len: '20:41', part: 'full', sub: '全身', level: 'normal' },
  { id: 'G0KSSXOmL-Y', name: '全身10種目10分（脂肪燃焼）', len: '12:04', part: 'full', sub: '全身', level: 'normal' },
  { id: 'dXQ7xgqqX44', name: '全身10種目10分（痩せたい部位）', len: '11:35', part: 'full', sub: '全身', level: 'normal' },
  { id: 'jzUlLi6JFVA', name: 'HIIT 全身9種目6分（飛ばない）', len: '13:25', part: 'full', sub: 'HIIT', level: 'hard' },
  { id: 'cQsupVhKcDg', name: 'HIIT 高強度 全身7分半', len: '11:52', part: 'full', sub: 'HIIT', level: 'hard' },

  // 体幹 — 筋肉量への寄与は小さいので4日に1回
  { id: 'u-wS8jABqQI', name: '腹筋 7種類3分半', len: '12:33', part: 'core', sub: '腹筋', level: 'easy' },
  { id: 'XpoJfzAMneY', name: '腹斜筋 7種目4分', len: '13:39', part: 'core', sub: '脇腹', level: 'easy' },
  { id: '590CWWrC4PM', name: 'プランク 7種目4分', len: '13:24', part: 'core', sub: 'プランク', level: 'normal' },
  { id: 'o5vb430_m38', name: '下腹部＆くびれ 10種目10分', len: '10:50', part: 'core', sub: '下腹', level: 'normal' },
  { id: '0HIaPspC7lQ', name: '腹筋・お尻・内腿 10種目10分', len: '17:01', part: 'core', sub: '腹とお尻', level: 'hard' },

  { id: 'fZJO5hYB0Tc', name: 'ウォーミングアップ（動的ストレッチ）', len: '9:20', part: 'warmup', sub: '準備運動', level: 'easy' },
];

/* ---------- 日付 ---------- */

function todayStr(d) {
  const t = d || new Date();
  const p = n => String(n).padStart(2, '0');
  return `${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())}`;
}

function addDays(str, n) {
  const [y, m, d] = str.split('-').map(Number);
  const t = new Date(y, m - 1, d + n);
  return todayStr(t);
}

function diffDays(a, b) {
  const pa = a.split('-').map(Number), pb = b.split('-').map(Number);
  const ta = new Date(pa[0], pa[1] - 1, pa[2]).getTime();
  const tb = new Date(pb[0], pb[1] - 1, pb[2]).getTime();
  return Math.round((ta - tb) / 86400000);
}

// 月曜はじまりの週の初日
function weekStart(str) {
  const [y, m, d] = str.split('-').map(Number);
  const t = new Date(y, m - 1, d);
  const shift = (t.getDay() + 6) % 7;
  return addDays(str, -shift);
}

function fmtDate(str) {
  const [, m, d] = str.split('-');
  return `${Number(m)}/${Number(d)}`;
}

/* ---------- 保存 ---------- */

const defaultState = () => ({
  v: 1,
  logs: [],                                           // {d, id, part, level, spare, slot}
  levels: { lower: 'easy', upper: 'easy', full: 'easy', core: 'easy' },
  spareRun: { lower: 0, upper: 0, full: 0, core: 0 },
  videos: null,                                       // 編集したときだけ配列が入る
  todayPick: null,                                    // {d, id} 手動で選んだ今日の動画
  lastExport: null,
  goal: '',                                           // 目標の数値。端末内にだけ置く(公開コードに入れない)
});

let state = defaultState();

function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    state = Object.assign(defaultState(), parsed);
    // 古い・壊れた値が入っていても落ちないように最低限ならす
    if (!Array.isArray(state.logs)) state.logs = [];
    PARTS.forEach(p => {
      if (!LEVELS.includes(state.levels[p])) state.levels[p] = 'easy';
      if (typeof state.spareRun[p] !== 'number') state.spareRun[p] = 0;
    });
  } catch (e) {
    console.warn('保存データを読めなかったので初期状態で始めます', e);
    state = defaultState();
  }
}

function save() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
  } catch (e) {
    toast('保存できませんでした（ブラウザの設定を確認してください）');
    console.error(e);
  }
}

function videos() {
  return (state.videos && state.videos.length) ? state.videos : DEFAULT_VIDEOS.map(v => ({ ...v, on: true }));
}

/* ---------- 今日やることを決める ---------- */

function logsOf(d) { return state.logs.filter(l => l.d === d); }

// 次にやる部位 = 最後に記録した1本目の部位の次。
// 2本目(追加の1本)はローテの基準にしない。基準にすると順番が飛ぶため。
function nextPart() {
  for (let i = state.logs.length - 1; i >= 0; i--) {
    const l = state.logs[i];
    if (l.slot !== 1) continue;
    const idx = PARTS.indexOf(l.part);
    if (idx >= 0) return PARTS[(idx + 1) % PARTS.length];
  }
  return PARTS[0];
}

// その部位で直近にやった細かい部位(胸・背中など)。偏りを避けるために使う
function recentSubs(part, n) {
  const subs = [];
  for (let i = state.logs.length - 1; i >= 0 && subs.length < n; i--) {
    if (state.logs[i].part !== part) continue;
    const v = findVideo(state.logs[i].id);
    if (v && v.sub) subs.push(v.sub);
  }
  return subs;
}

function pickVideo(part, level, excludeIds) {
  const pool = videos().filter(v => v.on !== false && v.part === part);
  if (!pool.length) return null;

  const recent = new Set(excludeIds || []);
  const recentSub = new Set(recentSubs(part, 2));              // 直近2回の細かい部位は避ける
  const order = [level, ...LEVELS.filter(l => l !== level)];   // まず希望のレベル、無ければ他

  const oneOf = list => list[Math.floor(Math.random() * list.length)];

  for (const lv of order) {
    const sameLv = pool.filter(v => v.level === lv);
    if (!sameLv.length) continue;
    // 1) 動画も細かい部位も新しい 2) 動画だけでも新しい
    const best = sameLv.filter(v => !recent.has(v.id) && !recentSub.has(v.sub));
    if (best.length) return oneOf(best);
    const second = sameLv.filter(v => !recent.has(v.id));
    if (second.length) return oneOf(second);
    // このレベルは全部やり尽くしている → 次のレベルを見る
  }
  // どのレベルにも新しいものが無い。それでも何か返す(画面を空にしない)
  const any = pool.filter(v => !recent.has(v.id));
  return oneOf(any.length ? any : pool);
}

function recentIds(n) {
  return state.logs.slice(-n).map(l => l.id);
}

function findVideo(id) {
  return videos().find(v => v.id === id) || null;
}

// 今日の1本目
function todaysPlan() {
  const d = todayStr();
  if (state.todayPick && state.todayPick.d === d) {
    const v = findVideo(state.todayPick.id);
    if (v) return { video: v, part: v.part, level: v.level };
  }
  const part = nextPart();
  const level = state.levels[part] || 'easy';
  const video = pickVideo(part, level, recentIds(6));
  return { video, part, level };
}

// 追加の1本(余力ありのとき)は同じ部位をもう1本。何本目でも同じ考え方で出す。
// 同じ日のうちなら回復の妨げにならず、その部位のボリュームが増えて筋肉を増やす方向に効く。
// 別の部位を足すと、その部位の回復日程がずれる。
// 動画は今日やったものと別になり、pickVideo が直近の細かい部位も避けるので、
// 胸をやった日の次は背中や肩が出る。
function nextPlan() {
  const d = todayStr();
  const todayLogs = logsOf(d);
  const first = todayLogs.find(l => l.slot === 1);
  const done = todayLogs.map(l => l.id);
  const part = first ? first.part : nextPart();
  const level = first ? first.level : (state.levels[part] || 'easy');

  const v = pickVideo(part, level, done);
  if (v) return { video: v, part, level: v.level };

  // その部位に出せる動画が残っていなければ全身から
  const alt = pickVideo('full', 'easy', done.concat(recentIds(4)));
  return alt ? { video: alt, part: 'full', level: alt.level } : null;
}

/* ---------- 記録する ---------- */

function recordDone(video, part, level, slot) {
  state.logs.push({ d: todayStr(), id: video.id, part, level, spare: null, slot });
  save();
}

function setSpare(hasSpare) {
  const d = todayStr();
  // 今日の最後の記録に余力を書く
  let answered = null;
  for (let i = state.logs.length - 1; i >= 0; i--) {
    if (state.logs[i].d === d) { state.logs[i].spare = hasSpare; answered = state.logs[i]; break; }
  }
  if (!answered) return;

  // レベルの上げ下げは「その日の1本目」の回答だけで判断する。
  // 2本目以降も数えると、1日のうちに何段も上がってしまう。
  if (answered.slot !== 1) { save(); return; }

  const first = answered;
  const part = PARTS.includes(first.part) ? first.part : null;
  if (part) {
    if (hasSpare) {
      state.spareRun[part] = (state.spareRun[part] || 0) + 1;
      if (state.spareRun[part] >= SPARE_TO_LEVEL_UP) {
        const i = LEVELS.indexOf(state.levels[part] || 'easy');
        if (i < LEVELS.length - 1) {
          state.levels[part] = LEVELS[i + 1];
          toast(`${PART_LABEL[part]}を「${LEVEL_LABEL[state.levels[part]]}」に上げました`);
        }
        state.spareRun[part] = 0;
      }
    } else {
      state.spareRun[part] = 0;
    }
  }
  save();
}

function undoToday() {
  const d = todayStr();
  const before = state.logs.length;
  state.logs = state.logs.filter(l => l.d !== d);
  state.todayPick = null;
  save();
  return before - state.logs.length;
}

/* ---------- 集計 ---------- */

function doneDays() {
  return [...new Set(state.logs.map(l => l.d))].sort();
}

// 連続日数。今日やっていなければ昨日までの連続を返す(まだ途切れていない扱い)
function streak() {
  const days = new Set(doneDays());
  const t = todayStr();
  let cur = days.has(t) ? t : addDays(t, -1);
  if (!days.has(cur)) return 0;
  let n = 0;
  while (days.has(cur)) { n++; cur = addDays(cur, -1); }
  return n;
}

function thisWeekDays() {
  const ws = weekStart(todayStr());
  return doneDays().filter(d => d >= ws).length;
}

function balance30() {
  const from = addDays(todayStr(), -29);
  const counts = { upper: 0, lower: 0, core: 0, full: 0 };
  state.logs.filter(l => l.d >= from).forEach(l => {
    if (counts[l.part] === undefined) counts[l.part] = 0;
    counts[l.part]++;
  });
  return counts;
}

/* ---------- 画面 ---------- */

const $ = sel => document.querySelector(sel);

function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { el.hidden = true; }, 2600);
}

function ytUrl(id) { return `https://www.youtube.com/watch?v=${id}`; }

function cardHtml(plan, slot) {
  const v = plan.video;
  if (!v) {
    return `<div class="card"><p class="vtitle">動画がありません</p>
      <p class="note">設定の「動画リスト」で、この部位の動画を1つ以上オンにしてください。</p></div>`;
  }
  return `
    <div class="card">
      <div class="part-row">
        <span class="part-badge">${escapeHtml(PART_LABEL[plan.part] || plan.part)}</span>
        ${v.sub ? `<span class="sub-badge">${escapeHtml(v.sub)}</span>` : ''}
        <span class="level-badge level-${v.level}">${LEVEL_LABEL[v.level]}</span>
      </div>
      <p class="vtitle">${escapeHtml(v.name)}</p>
      <p class="vmeta">動画 ${escapeHtml(v.len)}（解説を含む長さ）</p>
      <div class="btn-row">
        <a class="btn primary" href="${ytUrl(v.id)}" target="_blank" rel="noopener">動画を開く</a>
        <button class="btn" data-done="${slot}" data-id="${escapeHtml(v.id)}" data-part="${plan.part}" data-level="${v.level}">やった</button>
      </div>
      <p class="note">動画の回数で止めず、<strong>できなくなるところまで</strong>。筋肉を増やすにはここが効きます。</p>
    </div>`;
}

function doneCardHtml(log) {
  const v = findVideo(log.id);
  const name = v ? v.name : log.id;
  const spare = log.spare === true ? 'まだできそう' : (log.spare === false ? 'ここまで' : '');
  return `
    <div class="done-card">
      <p class="done-head">${escapeHtml(String(log.slot || 1))}本目 — やりました</p>
      <div class="part-row">
        <span class="part-badge">${escapeHtml(PART_LABEL[log.part] || log.part)}</span>
        ${v && v.sub ? `<span class="sub-badge">${escapeHtml(v.sub)}</span>` : ''}
      </div>
      <p class="vtitle">${escapeHtml(name)}</p>
      ${spare ? `<p class="vmeta">${spare}</p>` : ''}
    </div>`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function render() {
  const d = todayStr();
  const today = logsOf(d);

  // 状況
  $('#stat-streak').textContent = streak();
  $('#stat-week').textContent = thisWeekDays();
  $('#stat-total').textContent = state.logs.length;

  // 今日やること / 今日やったこと(何本でも並べる)
  $('#today-card').innerHTML = today.length
    ? today.map(l => doneCardHtml(l)).join('')
    : cardHtml(todaysPlan(), 1);

  // 余力の質問 → 記録済みで、まだ余力を答えていないとき
  const last = today[today.length - 1];
  $('#spare-area').hidden = !(last && last.spare === null);

  // 次の1本 → 最後の回答が「できそう」のとき。何本目でも出す
  if (last && last.spare === true) {
    const n = today.length + 1;
    const plan = nextPlan();
    $('#second-area').hidden = false;
    $('#second-title').textContent = `追加の1本（${n}本目）`;
    $('#second-card').innerHTML = plan
      ? cardHtml(plan, n)
      : '<div class="card"><p class="note">今日はもう出せる動画がありません。</p></div>';
    const note = $('#second-note');
    note.hidden = n < 3;
    if (n >= 3) {
      note.textContent = '無理はしないでください。慣れないうちは筋肉痛が数日残って、かえって続かなくなります。';
    }
  } else {
    $('#second-area').hidden = true;
  }

  renderBalance();
  renderHistory();
  renderBackupNote();
}

function renderBalance() {
  const c = balance30();
  const max = Math.max(1, ...Object.values(c));
  const rows = PARTS.map(p => {
    const n = c[p] || 0;
    const w = Math.round((n / max) * 100);
    return `<div class="bal-row">
      <span>${PART_LABEL[p]}</span>
      <span class="bal-bar"><span class="bal-fill" style="width:${w}%"></span></span>
      <span class="bal-num">${n}</span>
    </div>`;
  }).join('');
  $('#balance').innerHTML = rows;
}

function renderHistory() {
  const ul = $('#history');
  if (!state.logs.length) {
    ul.innerHTML = '<li class="empty">まだ記録がありません。今日の1本から始めましょう。</li>';
    return;
  }
  const items = state.logs.slice(-20).reverse().map(l => {
    const v = findVideo(l.id);
    const name = v ? v.name : l.id;
    const spare = l.spare === true ? '／まだできそう' : (l.spare === false ? '／ここまで' : '');
    const label = (PART_LABEL[l.part] || l.part) + (v && v.sub ? '・' + v.sub : '');
    return `<li>
      <span class="h-date">${fmtDate(l.d)}</span>
      <span>
        <span class="h-title">${escapeHtml(name)}</span><br>
        <span class="h-spare">${escapeHtml(label)}${spare}</span>
      </span>
    </li>`;
  }).join('');
  ul.innerHTML = items;
}

function renderBackupNote() {
  const el = $('#backup-note');
  if (!el) return;
  if (!state.logs.length) { el.textContent = ''; return; }
  if (!state.lastExport) {
    el.textContent = 'まだ一度も書き出していません。';
    return;
  }
  const n = diffDays(todayStr(), state.lastExport);
  el.textContent = n >= BACKUP_REMIND_DAYS
    ? `前回の書き出しから${n}日たっています。書き出しをおすすめします。`
    : `前回の書き出し: ${state.lastExport}`;
}

/* ---------- 設定画面 ---------- */

function renderSettings() {
  const g = $('#goal-memo');
  if (g) g.value = state.goal || '';
  renderPartSelect();
  renderLevels();
  renderVideoList();
  renderBackupNote();
}

function renderPartSelect() {
  const part = $('#sel-part').value;
  const list = videos().filter(v => v.part === part);
  $('#sel-video').innerHTML = list.length
    ? list.map(v => `<option value="${escapeHtml(v.id)}">${escapeHtml(v.name)}（${LEVEL_LABEL[v.level]}）</option>`).join('')
    : '<option value="">この部位の動画がありません</option>';
}

function renderLevels() {
  $('#levels').innerHTML = PARTS.map(p => `
    <div class="lv-row">
      <span>${PART_LABEL[p]}</span>
      <span class="lv-btns">
        ${LEVELS.map(lv => `<button data-lv-part="${p}" data-lv="${lv}"
          aria-pressed="${state.levels[p] === lv}">${LEVEL_LABEL[lv]}</button>`).join('')}
      </span>
    </div>`).join('');
}

function renderVideoList() {
  const list = videos();
  $('#vlist').innerHTML = list.map(v => `
    <li>
      <div class="v-head">
        <input type="checkbox" data-von="${escapeHtml(v.id)}" ${v.on === false ? '' : 'checked'} aria-label="使う">
        <span class="v-name">${escapeHtml(v.name)}<br><span class="h-spare">${escapeHtml(v.len)}</span></span>
      </div>
      <select data-vpart="${escapeHtml(v.id)}">
        ${Object.keys(PART_LABEL).map(p => `<option value="${p}" ${v.part === p ? 'selected' : ''}>${PART_LABEL[p]}</option>`).join('')}
      </select>
      <select data-vlevel="${escapeHtml(v.id)}">
        ${LEVELS.map(lv => `<option value="${lv}" ${v.level === lv ? 'selected' : ''}>${LEVEL_LABEL[lv]}</option>`).join('')}
      </select>
    </li>`).join('');
}

function ensureVideosCopy() {
  if (!state.videos || !state.videos.length) {
    state.videos = DEFAULT_VIDEOS.map(v => ({ ...v, on: true }));
  }
  return state.videos;
}

/* ---------- 書き出し・読み込み ---------- */

function exportJson() {
  const data = JSON.stringify(state, null, 2);
  const blob = new Blob([data], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `karadalog-${todayStr()}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
  state.lastExport = todayStr();
  save();
  renderBackupNote();
  toast('書き出しました');
}

function importJson(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(reader.result);
      if (!parsed || !Array.isArray(parsed.logs)) throw new Error('形式が違います');
      const n = parsed.logs.length;
      if (!confirm(`今のデータを、読み込んだデータ（記録${n}件）で置き換えます。よろしいですか。`)) return;
      state = Object.assign(defaultState(), parsed);
      save();
      render();
      renderSettings();
      toast('読み込みました');
    } catch (e) {
      toast('読み込めませんでした（ファイルの形式を確認してください）');
      console.error(e);
    }
  };
  reader.readAsText(file);
}

/* ---------- 画面の操作 ---------- */

function bind() {
  // 「やった」
  document.addEventListener('click', ev => {
    const btn = ev.target.closest('[data-done]');
    if (!btn) return;
    const slot = Number(btn.dataset.done);
    const v = findVideo(btn.dataset.id);
    if (!v) { toast('動画が見つかりません'); return; }
    recordDone(v, btn.dataset.part, btn.dataset.level, slot);
    render();
    toast('記録しました');
  });

  $('#btn-spare-yes').addEventListener('click', () => { setSpare(true); render(); });
  $('#btn-spare-no').addEventListener('click', () => { setSpare(false); render(); toast('おつかれさまでした'); });

  // 目標メモ(端末内にだけ残す)
  $('#goal-memo').addEventListener('input', ev => {
    state.goal = ev.target.value;
    save();
  });

  // 設定の開閉
  $('#btn-settings').addEventListener('click', () => {
    renderSettings();
    $('#settings').hidden = false;
  });
  $('#btn-close-settings').addEventListener('click', () => {
    $('#settings').hidden = true;
    render();
  });

  // 今日の動画を変える
  $('#sel-part').addEventListener('change', renderPartSelect);
  $('#btn-apply-video').addEventListener('click', () => {
    const id = $('#sel-video').value;
    if (!id) { toast('動画を選んでください'); return; }
    if (logsOf(todayStr()).some(l => l.slot === 1)) {
      toast('今日はもう記録済みです。消してから変えてください');
      return;
    }
    state.todayPick = { d: todayStr(), id };
    save();
    toast('今日の動画を変えました');
    $('#settings').hidden = true;
    render();
  });

  // 今日の記録を消す
  $('#btn-undo-today').addEventListener('click', () => {
    const n = logsOf(todayStr()).length;
    if (!n) { toast('今日の記録はありません'); return; }
    if (!confirm(`今日の記録（${n}件）を消します。よろしいですか。`)) return;
    undoToday();
    render();
    toast('今日の記録を消しました');
  });

  // 書き出し・読み込み
  $('#btn-export').addEventListener('click', exportJson);
  $('#file-import').addEventListener('change', ev => {
    const f = ev.target.files && ev.target.files[0];
    if (f) importJson(f);
    ev.target.value = '';
  });

  // レベルの手動変更
  $('#levels').addEventListener('click', ev => {
    const b = ev.target.closest('[data-lv]');
    if (!b) return;
    state.levels[b.dataset.lvPart] = b.dataset.lv;
    state.spareRun[b.dataset.lvPart] = 0;
    save();
    renderLevels();
    toast(`${PART_LABEL[b.dataset.lvPart]}を「${LEVEL_LABEL[b.dataset.lv]}」にしました`);
  });

  // 動画リストの編集
  $('#vlist').addEventListener('change', ev => {
    const t = ev.target;
    const list = ensureVideosCopy();
    const find = id => list.find(v => v.id === id);
    if (t.dataset.von) {
      const v = find(t.dataset.von); if (v) v.on = t.checked;
    } else if (t.dataset.vpart) {
      const v = find(t.dataset.vpart); if (v) v.part = t.value;
    } else if (t.dataset.vlevel) {
      const v = find(t.dataset.vlevel); if (v) v.level = t.value;
    } else return;
    save();
    renderPartSelect();
  });

  $('#btn-reset-videos').addEventListener('click', () => {
    if (!confirm('動画リストを初期状態に戻します。オン・オフや分類の変更は失われます。よろしいですか。')) return;
    state.videos = null;
    save();
    renderSettings();
    render();
    toast('初期状態に戻しました');
  });
}

/* ---------- 起動 ---------- */

load();
bind();
render();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(e => console.warn('SW 登録に失敗', e));
  });
}
