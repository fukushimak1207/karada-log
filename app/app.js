/* からだログ — 今日やる動画を1本だけ出して、やったことを記録する
 *
 * 考え方
 *  - 部位は 下半身 → 上半身 → 全身 → 体幹 の4日サイクル(最後に記録した1本目の部位の次を出す)
 *  - 「まだできそう」が2回続いたら、その部位の動画を1段きつくする
 *  - 2本目は同じ部位からもう1本出す(同じ日ならボリュームが増えるだけで回復の妨げにならない)
 *  - 体重は扱わない。測る日を知らせるだけ(日付だけ持ち、数値は Health Planet に入れる)
 *  - データはこの端末の localStorage だけ。外には出さない
 */
'use strict';

const STORE_KEY = 'karadalog.v1';
/* 部位のまわし方: 下半身 → 上半身 → 全身 → 体幹 の4日サイクル。
 * 目標が「筋肉を増やす」なので、体で一番大きい下半身から始め、全身の日を挟んで
 * 下半身と上半身に当たる回数を増やす。厚労省ガイドも大きな筋群をまんべんなく鍛えることを勧めている。 */
const PARTS = ['lower', 'upper', 'full', 'core'];
const PART_LABEL = { upper: '上半身', lower: '下半身', core: '体幹', full: '全身', warmup: 'ウォームアップ', stretch: 'ストレッチ' };
const LEVELS = ['easy', 'normal', 'hard'];
const LEVEL_LABEL = { easy: 'やさしい', normal: 'ふつう', hard: 'きつい' };
const SPARE_TO_LEVEL_UP = 2;   // 「できそう」がこの回数続いたらレベルを上げる
/* 1日にやる本数。1本目=部位のローテ、2本目=体幹(体幹の日は上半身の手薄なところ)。
 * 腹筋を増やしたいという本人の希望で、2026-10-21 に1本立てから変えた。 */
const PLAN_SLOTS = 3;   // 3本目はストレッチ(2026-10-24 追加。長座で腰が曲がるため)
const STRETCH_SLOT = 3;
const ROLLER_SUB = 'ローラー';   // 腰を痛めやすいので2日に1回まで
const ROLLER_REST_DAYS = 1;
const BACKUP_REMIND_DAYS = 30;
const APP_VERSION = 'karadalog-cf-v10';   // sw.js の CACHE_VERSION と合わせる
/* 体組成を測る日の知らせ。アプリは数値を持たない(測った日付だけ)。
 * Web アプリは定時に自分で通知を出せないので、開いたときに画面へ出すだけにしている。 */
const MEASURE_GAP_WARN = 10;       // 前回からこの日数が空いたら、曜日に関係なく知らせる
const EVAL_DATE = '2027-01-18';    // 3か月後に筋肉量と筋肉スコアを見る日

/* 動画マスタ — YouTube「ザ・きんにくTV」再生リスト「自宅で筋トレ」全30本
 * len は動画の長さ(解説を含む総尺)。実際に動く時間はタイトルの「○分」のほう。
 * part / level はタイトルから分類したもの。中身を全部見てはいないので、設定画面で直せる。
 */
const DEFAULT_VIDEOS = [
  // 上半身 — sub で胸→背中→肩→腕と内部でまわす(胸が2本あるので、放っておくと偏る)
  { id: 'PquP1dO3uKg', name: '大胸筋 7種目3分半', len: '15:17', part: 'upper', sub: '胸', level: 'normal' , start: 553 },
  { id: 'RIqa_JtJ3jk', name: '胸＆腹筋 10種目5分', len: '11:05', part: 'upper', sub: '胸', level: 'easy' },
  { id: 'al3CoAGcrTE', name: '背筋 8種目4分（器具なし）', len: '14:45', part: 'upper', sub: '背中', level: 'normal' , start: 569 },
  { id: 'DAI9IcAxfPA', name: '肩（三角筋）7種目4分', len: '16:27', part: 'upper', sub: '肩', level: 'normal' , start: 654 },
  { id: 'yjTD95S3TUc', name: '二の腕＆力こぶ 7種目4分半', len: '15:33', part: 'upper', sub: '腕', level: 'easy' , start: 603 },
  { id: 'LARsdRVCvHU', name: '上半身6分（ペットボトルでも可）', len: '13:45', part: 'upper', sub: '上半身まとめて', level: 'normal' },

  // 背中と腕の補充(CALISLIFE自重トレ)。きんにくTV は背中1本・腕1本しか無く、
  // 器具なしで「引く」種目が作れないため。タオルは家にあるので追加購入は不要。
  { id: 'IgwjbjOAxQk', name: 'タオルで背中全体 6分', len: '6:04', part: 'upper', sub: '背中', level: 'easy', on: false },
  { id: 'Q-LGg-58_ZU', name: '背筋7種目 器具なし 6分', len: '6:18', part: 'upper', sub: '背中', level: 'normal' },
  { id: 'fk1fw8ERt7E', name: '背筋100回 9種目 6分', len: '6:50', part: 'upper', sub: '背中', level: 'hard' },
  { id: 'UHn8wAbY0L0', name: 'タオルで上腕二頭筋', len: '4:46', part: 'upper', sub: '腕', level: 'easy', on: false },
  { id: 'DGdaX4PqoLg', name: '上腕三頭筋 4種目', len: '4:50', part: 'upper', sub: '腕', level: 'normal' },

  // 下半身 — 体で一番大きい筋群。ここが筋肉量に一番効く
  { id: 'BFitLouawaM', name: '脚 7種目3分半（初級）', len: '15:15', part: 'lower', sub: '太もも', level: 'easy' , start: 638 },
  { id: 'OlGiInYmSiw', name: 'レッグランジ 4種目3分', len: '10:57', part: 'lower', sub: 'ランジ', level: 'easy' , start: 412 },
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
  { id: 'u-wS8jABqQI', name: '腹筋 7種類3分半', len: '12:33', part: 'core', sub: '腹筋', level: 'easy' , start: 197 },
  { id: 'XpoJfzAMneY', name: '腹斜筋 7種目4分', len: '13:39', part: 'core', sub: '脇腹', level: 'easy' },
  { id: '590CWWrC4PM', name: 'プランク 7種目4分', len: '13:24', part: 'core', sub: 'プランク', level: 'normal' },
  { id: 'o5vb430_m38', name: '下腹部＆くびれ 10種目10分', len: '10:50', part: 'core', sub: '下腹', level: 'normal' },
  { id: '0HIaPspC7lQ', name: '腹筋・お尻・内腿 10種目10分', len: '17:01', part: 'core', sub: '腹とお尻', level: 'hard' },

  // 腹筋ローラー。持っているのに使う動画が無かったので足す。
  // sub が ROLLER_SUB のものは、腰を痛めないよう2日に1回までしか出さない。
  { id: 'Z-h6_7In8G0', name: 'ローラー 安全な使い方とフォーム', len: '4:41', part: 'core', sub: 'ローラー', level: 'easy', once: true },
  { id: 'q2p3JUSlwXo', name: 'ローラー 腹筋5種目（世界チャンプ直伝）', len: '5:58', part: 'core', sub: 'ローラー', level: 'normal' },
  { id: 'qhO8aBENLjk', name: 'ローラー 腹直筋と腹斜筋 8分', len: '8:32', part: 'core', sub: 'ローラー', level: 'hard' },

  { id: 'fZJO5hYB0Tc', name: 'ウォーミングアップ（動的ストレッチ）', len: '9:20', part: 'warmup', sub: '準備運動', level: 'easy' },

  // ストレッチ。3本目に毎日出す。長座で腰が曲がる(股関節まわりが硬い)ため。
  { id: '-Y5bOC_ecB0', name: '股関節が超硬い人向け 毎日9分', len: '9:35', part: 'stretch', sub: '股関節', level: 'easy' },
  { id: 'cJXY4ghyRyc', name: '長座が辛い・前屈で骨盤が立たない人へ', len: '15:55', part: 'stretch', sub: '長座・前屈', level: 'easy' },
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

// 0=日曜 ... 6=土曜
function weekdayOf(str) {
  const [y, m, d] = str.split('-').map(Number);
  return new Date(y, m - 1, d).getDay();
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
  todayPick: null,                                    // {d, ids:{slot:id}} 手で選んだ今日の動画
  lastExport: null,
  measure: { weekday: 0, last: null },                // 測る曜日(既定は日曜)と、最後に測った日
  evalSeen: false,                                    // 評価日の知らせを確認したか
  starts: {},                                         // {動画ID: 秒} 運動が始まる位置。覚えさせた分
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
    // measure は後から足した項目。古い保存データには無いので作り直す
    if (!state.measure || typeof state.measure !== 'object') state.measure = { weekday: 0, last: null };
    const wd = Number(state.measure.weekday);
    state.measure.weekday = (Number.isInteger(wd) && wd >= 0 && wd <= 6) ? wd : 0;
    if (typeof state.measure.last !== 'string') state.measure.last = null;
    if (!state.starts || typeof state.starts !== 'object') state.starts = {};
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
  return (state.videos && state.videos.length) ? state.videos : DEFAULT_VIDEOS.map(v => ({ ...v, on: v.on !== false }));
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

/* ローラーを今日出してよいか。直近 ROLLER_REST_DAYS 日に使っていたら出さない。
 * 腹筋ローラーは腰を痛めやすく、本人は始めたばかりのため。 */
function rollerOk(d) {
  const today = d || todayStr();
  for (let i = state.logs.length - 1; i >= 0; i--) {
    const l = state.logs[i];
    const gap = diffDays(today, l.d);
    if (gap > ROLLER_REST_DAYS) break;
    if (gap === 0 && l.d === today) {
      const v0 = findVideo(l.id);
      if (v0 && v0.sub === ROLLER_SUB) return false;
      continue;
    }
    const v = findVideo(l.id);
    if (v && v.sub === ROLLER_SUB) return false;
  }
  return true;
}

function pickVideo(part, level, excludeIds) {
  // once の動画(フォーム解説など)は、一度やったらもう出さない。
  // 解説だけで回数が無いので、繰り返し出ると練習にならないため。
  const didOnce = new Set(state.logs.map(l => l.id));
  let pool = videos().filter(v => v.on !== false && v.part === part && !(v.once && didOnce.has(v.id)));
  if (!rollerOk()) pool = pool.filter(v => v.sub !== ROLLER_SUB);
  if (!pool.length) pool = videos().filter(v => v.on !== false && v.part === part && !(v.once && didOnce.has(v.id)));
  if (!pool.length) pool = videos().filter(v => v.on !== false && v.part === part);
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
/* 手で選んだ動画の取り出し。古い保存データ({d,id})にも対応する */
function pickedId(slot) {
  const p = state.todayPick;
  if (!p || p.d !== todayStr()) return null;
  if (p.ids) return p.ids[String(slot)] || null;
  return slot === 1 ? (p.id || null) : null;   // 1本立てだった頃のデータ
}

function setPicked(slot, id) {
  const d = todayStr();
  if (!state.todayPick || state.todayPick.d !== d || !state.todayPick.ids) {
    const old = (state.todayPick && state.todayPick.d === d && state.todayPick.id)
      ? { '1': state.todayPick.id } : {};
    state.todayPick = { d, ids: old };
  }
  state.todayPick.ids[String(slot)] = id;
  save();
}

function todaysPlan() {
  const d = todayStr();
  const picked = pickedId(1);
  if (picked) {
    const v = findVideo(picked);
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
/* 今日の slot 番目にやる分を決める。
 *  slot 1 … 部位のローテ(下半身→上半身→全身→体幹)
 *  slot 2 … 体幹。1本目が体幹の日は、上半身の手薄なところ(背中・腕)
 * PLAN_SLOTS を超えた分は nextPlan()(余力があるときの追加)が決める。 */
function planFor(slot) {
  if (slot <= 1) return todaysPlan();
  const picked = pickedId(slot);
  if (picked) {
    const pv = findVideo(picked);
    if (pv) return { video: pv, part: pv.part, level: pv.level };
  }
  const d = todayStr();
  const done = logsOf(d).map(l => l.id);

  // 3本目はストレッチで固定
  if (slot === STRETCH_SLOT) {
    const sv = pickVideo('stretch', 'easy', done);
    return sv ? { video: sv, part: 'stretch', level: sv.level } : null;
  }

  const mainPart = (logsOf(d).find(l => l.slot === 1) || {}).part || nextPart();
  const part = mainPart === 'core' ? 'upper' : 'core';
  const level = state.levels[part] || 'easy';
  const v = pickVideo(part, level, done);
  return v ? { video: v, part, level: v.level } : null;
}

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
  const d = todayStr();
  // 2本目を「実際にやった」ことを、この日のレベル上げの条件にする。
  // 「できそう」と答えただけでやらなかった日に上がってしまうのを防ぐ。
  // 決められた本数(PLAN_SLOTS)を超えて、実際にやった日だけ数える。
  // 2本目は毎日やる前提になったので、「2本目をやった=余力あり」ではなくなった。
  const firstExtra = slot > PLAN_SLOTS && !logsOf(d).some(l => l.slot > PLAN_SLOTS);
  state.logs.push({ d, id: video.id, part, level, spare: null, slot });
  if (firstExtra) countSpareDay(part);
  save();
}

/* その部位の「余力のあった日」を1日ぶん数え、2日たまったらレベルを上げる */
function countSpareDay(part) {
  if (!PARTS.includes(part)) return;
  state.spareRun[part] = (state.spareRun[part] || 0) + 1;
  if (state.spareRun[part] < SPARE_TO_LEVEL_UP) return;
  const i = LEVELS.indexOf(state.levels[part] || 'easy');
  if (i < LEVELS.length - 1) {
    state.levels[part] = LEVELS[i + 1];
    toast(`${PART_LABEL[part]}を「${LEVEL_LABEL[state.levels[part]]}」に上げました`);
  }
  state.spareRun[part] = 0;
}

function setSpare(hasSpare) {
  const d = todayStr();
  // 今日の最後の記録に余力を書く
  let answered = null;
  for (let i = state.logs.length - 1; i >= 0; i--) {
    if (state.logs[i].d === d) { state.logs[i].spare = hasSpare; answered = state.logs[i]; break; }
  }
  if (!answered) return;

  // レベルを上げるのは「2本目を実際にやった日」だけ(recordDone で数える)。
  // ここでは「ここまで」と答えたときの据え置き(積み上がりを戻す)だけを見る。
  // 1本目の回答だけを見るのは、1日に何段も上がらないようにするため。
  if (answered.slot === PLAN_SLOTS && !hasSpare) {
    const part = PARTS.includes(answered.part) ? answered.part : null;
    if (part) state.spareRun[part] = 0;
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

/* ---------- 測る日の知らせ ---------- */

/* 出すものを決めて返す。何も出さないときは null。
 * 数値は持たない。「測った」を押した日付だけを残す。 */
function measureNotice(d) {
  const today = d || todayStr();
  const last = state.measure.last;
  if (last === today) return null;                       // 今日はもう測った

  if (last) {
    const gap = diffDays(today, last);
    if (gap >= MEASURE_GAP_WARN) {
      return { kind: 'gap', text: `前回の測定から${gap}日たっています。` };
    }
  }
  if (weekdayOf(today) !== state.measure.weekday) return null;
  return {
    kind: 'day',
    text: last ? `今日は測る日です（前回 ${fmtDate(last)}）` : '今日は測る日です。',
  };
}

function markMeasured() {
  state.measure.last = todayStr();
  save();
}

// 評価日(3か月後の見直し)。一度確認したら出さない
function evalNotice(d) {
  const today = d || todayStr();
  if (state.evalSeen) return null;
  if (diffDays(today, EVAL_DATE) < 0) return null;
  return { kind: 'eval', text: '見直しの日です。筋肉量と筋肉スコアを確認してください。' };
}

/* ---------- 画面 ---------- */

const $ = sel => document.querySelector(sel);

let shownPlan = null;   // 今この画面に出している「今日やること」

function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { el.hidden = true; }, 2600);
}

/* 運動が始まる位置(秒)。覚えさせた分があればそれを使う。
 * 既定値は自動生成字幕から求めたもの(いちばん長い[音楽]だけの区間の先頭)。 */
function startOf(id) {
  const mine = state.starts && state.starts[id];
  if (typeof mine === 'number' && mine >= 0) return mine;
  const v = findVideo(id);
  return (v && typeof v.start === 'number') ? v.start : 0;
}

function fmtSec(sec) {
  const m = Math.floor(sec / 60), r = Math.floor(sec % 60);
  return `${m}:${String(r).padStart(2, '0')}`;
}

function ytUrl(id) {
  const t = startOf(id);
  return `https://www.youtube.com/watch?v=${id}` + (t > 0 ? `&t=${t}s` : '');
}

// アプリの中で再生するための URL
function ytEmbed(id) {
  const t = startOf(id);
  return `https://www.youtube-nocookie.com/embed/${id}?rel=0&playsinline=1&enablejsapi=1`
    + (t > 0 ? `&start=${t}` : '');
}

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
      <div class="player" data-player="${escapeHtml(v.id)}">
        <button class="btn primary wide play" data-play="${escapeHtml(v.id)}">
          ${startOf(v.id) > 0 ? `${escapeHtml(fmtSec(startOf(v.id)))} から再生` : 'ここで再生'}
        </button>
      </div>
      <div class="btn-row">
        <a class="btn" href="${ytUrl(v.id)}" target="_blank" rel="noopener">YouTubeで開く</a>
        <button class="btn" data-done="${slot}" data-id="${escapeHtml(v.id)}" data-part="${plan.part}" data-level="${v.level}">やった</button>
      </div>
      <p class="note">${plan.part === 'stretch'
        ? '<strong>痛いところまで伸ばさない。</strong>気持ちよく伸びる手前で止めて、呼吸を止めないでください。'
        : (v.sub === ROLLER_SUB
          ? '<strong>膝をついたまま（膝コロ）で。</strong>腰が反ると痛めます。できる回数で止めてください。'
          : '動画の回数で止めず、<strong>できなくなるところまで</strong>。筋肉を増やすにはここが効きます。')}</p>
      <div class="btn-row sub-row">
        <button class="btn small" data-swap="${slot}" data-id="${escapeHtml(v.id)}">別のにする</button>
        <button class="btn small" data-mute="${slot}" data-id="${escapeHtml(v.id)}">もう出さない</button>
      </div>
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

  renderNotices();

  // 状況
  $('#stat-streak').textContent = streak();
  $('#stat-week').textContent = thisWeekDays();
  $('#stat-total').textContent = state.logs.length;

  // 今日やること = 決められた本数(PLAN_SLOTS)。やった分は記録カードに変わる
  const cards = [];
  shownPlan = null;
  // 記録は slot で突き合わせる。並び順で見ると、先に2本目をやったときに
  // 1本目の枠が消えてしまう(意見 #11)。
  const maxSlot = today.reduce((m, l) => Math.max(m, l.slot || 1), PLAN_SLOTS);
  for (let slot = 1; slot <= maxSlot; slot++) {
    const log = today.find(l => l.slot === slot);
    if (log) { cards.push(doneCardHtml(log)); continue; }
    const plan = planFor(slot);
    if (!shownPlan) shownPlan = plan;            // 意見に添える情報は「次にやる分」を使う
    cards.push(plan
      ? cardHtml(plan, slot)
      : '<div class="card"><p class="note">出せる動画がありません。設定の「動画リスト」を確認してください。</p></div>');
  }
  $('#today-card').innerHTML = cards.join('');

  // 余力の質問 → 決められた分をやり終えて、まだ答えていないとき
  const last = today[today.length - 1];
  const planDone = today.length >= PLAN_SLOTS;
  $('#spare-area').hidden = !(last && last.spare === null && planDone);

  // 追加の1本 → 決められた分を終えたあと「できそう」と答えたとき
  if (last && last.spare === true && planDone) {
    const n = today.reduce((m, l) => Math.max(m, l.slot || 1), 0) + 1;
    const plan = nextPlan();
    $('#second-area').hidden = false;
    $('#second-title').textContent = `追加の1本（${n}本目）`;
    $('#second-card').innerHTML = plan
      ? cardHtml(plan, n)
      : '<div class="card"><p class="note">今日はもう出せる動画がありません。</p></div>';
    const note = $('#second-note');
    note.hidden = n < PLAN_SLOTS + 1;
    if (n >= PLAN_SLOTS + 1) {
      note.textContent = '無理はしないでください。慣れないうちは筋肉痛が数日残って、かえって続かなくなります。';
    }
  } else {
    $('#second-area').hidden = true;
  }

  renderBalance();
  renderHistory();
  renderBackupNote();
}

function renderNotices() {
  const el = $('#notices');
  if (!el) return;
  const items = [];

  const m = measureNotice();
  if (m) {
    items.push(`<div class="notice">
      <p class="notice-text">${escapeHtml(m.text)}</p>
      <p class="note">数値は Health Planet のアプリに入れてください。ここには日付だけ残ります。</p>
      <div class="btn-row"><button class="btn primary" data-act="measured">測った</button></div>
    </div>`);
  }

  const e = evalNotice();
  if (e) {
    items.push(`<div class="notice">
      <p class="notice-text">${escapeHtml(e.text)}</p>
      <p class="note">増えていなければ、トレーニング量を増やすか食べる量を見直すかを決めます。</p>
      <div class="btn-row"><button class="btn" data-act="eval-seen">確認した</button></div>
    </div>`);
  }

  el.innerHTML = items.join('');
  el.hidden = !items.length;
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
  const w = $('#sel-measure-day');
  if (w) w.value = String(state.measure.weekday);
  const ml = $('#measure-last');
  if (ml) {
    ml.textContent = state.measure.last
      ? `前回の測定: ${state.measure.last}`
      : 'まだ測った記録がありません。';
  }
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
    state.videos = DEFAULT_VIDEOS.map(v => ({ ...v, on: v.on !== false }));
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

/* ---------- 意見(フィードバック) ---------- */
/* 送り先は Cloudflare Pages Functions(/api/feedback) 経由で GitHub の非公開リポジトリ。
 * 鍵はページに置かない。ここが持つのは利用者が打ち込む合言葉だけ。
 * 「どの画面の、どの状態から送ったか」を自動で添えるので、本文に書かなくても伝わる。 */

const FB_API = '/api/feedback';
const FB_KEY = 'karadalog.fb';     // 合言葉と、送った直後の控え
const FB_KINDS = ['不具合', '要望', 'その他'];

let fbState = { aikotoba: '', sent: [] };
let fbKind = '要望';
let fbScroll = 0;

function fbLoad() {
  try {
    const raw = localStorage.getItem(FB_KEY);
    if (!raw) return;
    const p = JSON.parse(raw);
    fbState.aikotoba = typeof p.aikotoba === 'string' ? p.aikotoba : '';
    fbState.sent = Array.isArray(p.sent) ? p.sent : [];
  } catch (e) { fbState = { aikotoba: '', sent: [] }; }
}

function fbSave() {
  try { localStorage.setItem(FB_KEY, JSON.stringify(fbState)); } catch (e) { /* 入らなくても送信はできる */ }
}

/* 送信時に自動で添える情報。体重・体脂肪・目標メモは入れない(端末内に留める約束) */
function screenInfo() {
  const d = todayStr();
  const today = logsOf(d);
  const last = today[today.length - 1];
  const settingsOpen = !$('#settings').hidden;
  const v = today.length ? findVideo(last.id) : (shownPlan && shownPlan.video);
  const part = today.length ? last.part : (shownPlan && shownPlan.part);
  const notice = measureNotice() ? '測る日' : (evalNotice() ? '見直しの日' : '');
  return {
    tab: settingsOpen ? '設定' : '今日やること',
    path: location.pathname,
    video: v ? v.name : '',
    part: PART_LABEL[part] || part || '',
    level: v ? (LEVEL_LABEL[v.level] || v.level) : '',
    slot: today.length ? `${today.length}本目まで記録` : '記録前',
    doneToday: today.length > 0,
    noticeShown: notice,
    appVersion: APP_VERSION,
    width: window.innerWidth,
  };
}

function fbContextText(info) {
  const bits = [info.video, info.part].filter(Boolean).join('・');
  return `送り先の情報として「${info.tab}${bits ? '（' + bits + '）' : ''}」も一緒に保存します。`;
}

function fbOpen() {
  const info = screenInfo();
  $('#fb-context').textContent = fbContextText(info);
  $('#fb-aikotoba-field').hidden = Boolean(fbState.aikotoba);
  $('#fb-msg').hidden = true;
  fbRenderKinds();
  fbRenderList(fbState.sent);
  fbScroll = window.scrollY;
  document.body.classList.add('no-scroll');   // 背景をスクロールさせない
  $('#fb').hidden = false;
  $('.fb-sheet').scrollTop = 0;   // 必ず上から見せる
  // ここで内容欄にフォーカスしない。スマホはフォーカスした欄を見える位置まで
  // 中身をスクロールするので、上にある説明と合言葉欄が隠れてしまう
  fbFetchList();
}

function fbClose() {
  $('#fb').hidden = true;
  document.body.classList.remove('no-scroll');
  window.scrollTo(0, fbScroll);
}

function fbRenderKinds() {
  $('#fb-kinds').querySelectorAll('.chip').forEach(b => {
    b.classList.toggle('on', b.dataset.kind === fbKind);
    b.setAttribute('aria-pressed', String(b.dataset.kind === fbKind));
  });
}

function fbMsg(text) {
  const el = $('#fb-msg');
  el.textContent = text;
  el.hidden = false;
}

function fbItemHtml(it) {
  const when = String(it.createdAt || '').slice(0, 10);
  const scr = it.screen || {};
  const where = [scr.tab, scr.video].filter(Boolean).join('・');
  const reply = it.reply
    ? `<p class="fb-reply">${escapeHtml(it.reply)}</p>`
    : '';
  return `<li class="fb-item">
    <p class="fb-text">${escapeHtml(it.text || '')}</p>
    <p class="fb-meta">
      <span class="fb-kind">${escapeHtml(it.kind || '')}</span>
      ${where ? `<span>${escapeHtml(where)}</span>` : ''}
      <span>${escapeHtml(when)}</span>
      <span class="fb-status ${it.status === '対応済み' ? 'done' : ''}">${escapeHtml(it.status || '未対応')}</span>
    </p>
    ${reply}
  </li>`;
}

function fbRenderList(items) {
  const ul = $('#fb-list');
  if (!items || !items.length) {
    ul.innerHTML = '<li class="empty">まだ意見はありません。</li>';
    return;
  }
  ul.innerHTML = items.map(fbItemHtml).join('');
}

// 送った直後の1件は GitHub の一覧にすぐ出ない(数秒遅れる)。
// 控えを先頭に足して見せ、番号が一致したら取り直した側を優先する。
function fbMerge(server) {
  const nums = new Set(server.map(i => i.number));
  const pending = fbState.sent.filter(i => !nums.has(i.number));
  return pending.concat(server);
}

async function fbFetchList() {
  if (!fbState.aikotoba) return;
  try {
    // 合言葉は URL に載せない(通信記録やブラウザの履歴に残るため)。ヘッダーで送る
    const r = await fetch(FB_API, { cache: 'no-store', headers: { 'X-Aikotoba': fbState.aikotoba } });
    const data = await r.json();
    if (!data.ok) { fbMsg(data.error || '一覧を取れませんでした'); return; }
    fbState.sent = fbMerge(data.items).slice(0, 50);
    fbSave();
    fbRenderList(fbState.sent);
  } catch (e) {
    // 通信できないときは控えだけ見せる(送信前なので何も壊れない)
    fbRenderList(fbState.sent);
  }
}

async function fbSend() {
  const text = $('#fb-text').value.trim();
  if (!text) { fbMsg('内容を書いてください'); return; }

  if (!fbState.aikotoba) {
    const word = $('#fb-aikotoba').value.trim();
    if (!word) {
      fbMsg('合言葉を入れてください');
      $('#fb-aikotoba').scrollIntoView({ block: 'center' });
      $('#fb-aikotoba').focus();
      return;
    }
    fbState.aikotoba = word;
  }

  const btn = $('#fb-send');
  btn.disabled = true;
  try {
    const r = await fetch(FB_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ aikotoba: fbState.aikotoba, kind: fbKind, text, screen: screenInfo() }),
    });
    const data = await r.json();
    if (!data.ok) {
      if (r.status === 401) fbState.aikotoba = '';          // 合言葉が違えば入れ直してもらう
      $('#fb-aikotoba-field').hidden = Boolean(fbState.aikotoba);
      fbMsg(data.error || '送れませんでした。通信を確かめてもう一度押してください');
      return;
    }
    fbState.sent = [data.item].concat(fbState.sent).slice(0, 50);
    fbSave();
    $('#fb-text').value = '';
    $('#fb-aikotoba-field').hidden = true;
    fbRenderList(fbState.sent);
    fbMsg('送りました。チャットで「フィードバック見て」と送ると対応します');
  } catch (e) {
    fbMsg('送れませんでした。通信を確かめてもう一度押してください');
  } finally {
    btn.disabled = false;
  }
}

/* 今出ている動画を別のものに替える。mute なら、その動画を以後出さない(設定で戻せる)。 */
function swapVideo(slot, id, mute) {
  const cur = findVideo(id);
  if (!cur) return;

  if (mute) {
    const list = ensureVideosCopy();
    const target = list.find(v => v.id === id);
    if (target) target.on = false;
  }

  const used = logsOf(todayStr()).map(l => l.id).concat([id]);
  const level = state.levels[cur.part] || 'easy';
  const next = pickVideo(cur.part, level, used);

  if (!next || next.id === id) {
    if (mute) { save(); render(); toast('もう出しません。設定の「動画リスト」で戻せます'); }
    else toast('ほかに出せる動画がありません');
    return;
  }

  setPicked(slot, next.id);   // setPicked の中で保存する
  render();

  if (mute) {
    const left = videos().filter(v => v.on !== false && v.part === cur.part).length;
    toast(left <= 2
      ? `もう出しません。${PART_LABEL[cur.part]}の残りは${left}本です`
      : 'もう出しません。設定の「動画リスト」で戻せます');
  } else {
    toast('別の動画にしました');
  }
}

/* 再生位置の受け取り。
 * 埋め込みプレーヤーは enablejsapi=1 のとき、現在位置を postMessage で知らせてくる。
 * YouTube の API スクリプトは読み込まない(外部依存を増やさないため)。 */
const playerTime = {};
let playingId = null;

function watchPlayer(iframe, id) {
  playingId = id;
  const tell = () => {
    try {
      iframe.contentWindow.postMessage(JSON.stringify({ event: 'listening', id }), '*');
    } catch (e) { /* 準備前は届かない。次の呼び出しで届く */ }
  };
  iframe.addEventListener('load', tell);
  const timer = setInterval(tell, 1000);
  setTimeout(() => clearInterval(timer), 20000);
}

window.addEventListener('message', ev => {
  let host = '';
  try { host = new URL(ev.origin).hostname; } catch (e) { return; }
  if (!/(^|\.)youtube(-nocookie)?\.com$/.test(host)) return;   // YouTube 以外は無視
  let d;
  try { d = JSON.parse(ev.data); } catch (e) { return; }
  const t = d && d.info && d.info.currentTime;
  if (typeof t === 'number' && playingId) playerTime[playingId] = t;
});

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

  // 測る日の知らせ
  document.addEventListener('click', ev => {
    const btn = ev.target.closest('[data-act]');
    if (!btn) return;
    if (btn.dataset.act === 'measured') {
      markMeasured();
      render();
      toast('測定日を記録しました');
    } else if (btn.dataset.act === 'eval-seen') {
      state.evalSeen = true;
      save();
      render();
    }
  });

  // アプリの中で再生する。YouTube に飛ばずに済ませるため。
  document.addEventListener('click', ev => {
    const play = ev.target.closest('[data-play]');
    if (!play) return;
    const id = play.dataset.play;
    const box = play.closest('[data-player]');
    if (!box) return;
    box.innerHTML = `
      <div class="frame">
        <iframe src="${ytEmbed(id)}" title="動画" allow="autoplay; fullscreen; picture-in-picture"
          allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe>
      </div>
      <button class="btn small wide" data-mark="${escapeHtml(id)}">いまのところを開始位置にする</button>
      <p class="note">解説を飛ばして運動が始まったところで押すと、次から そこで始まります。</p>`;
    const frame = box.querySelector('iframe');
    if (frame) watchPlayer(frame, id);
  });

  // 「いまのところを開始位置にする」。再生位置はプレーヤーから受け取る
  document.addEventListener('click', ev => {
    const mark = ev.target.closest('[data-mark]');
    if (!mark) return;
    const id = mark.dataset.mark;
    const sec = Math.floor(playerTime[id] || 0);
    if (!sec) { toast('まだ再生位置を受け取れていません。少し再生してから押してください'); return; }
    state.starts[id] = sec;
    save();
    render();
    toast(`次から ${fmtSec(sec)} から始まります`);
  });

  // 合わない動画をその場で外す(意見 #7)
  document.addEventListener('click', ev => {
    const swap = ev.target.closest('[data-swap]');
    if (swap) { swapVideo(Number(swap.dataset.swap), swap.dataset.id, false); return; }
    const mute = ev.target.closest('[data-mute]');
    if (mute) { swapVideo(Number(mute.dataset.mute), mute.dataset.id, true); }
  });

  $('#btn-spare-yes').addEventListener('click', () => { setSpare(true); render(); });
  $('#btn-spare-no').addEventListener('click', () => { setSpare(false); render(); toast('おつかれさまでした'); });

  // 目標メモ(端末内にだけ残す)
  $('#goal-memo').addEventListener('input', ev => {
    state.goal = ev.target.value;
    save();
  });

  // 測る曜日
  $('#sel-measure-day').addEventListener('change', ev => {
    state.measure.weekday = Number(ev.target.value);
    save();
    renderSettings();
  });

  // 意見シート
  $('#btn-feedback').addEventListener('click', fbOpen);
  $('#fb-close').addEventListener('click', fbClose);
  $('#fb').addEventListener('click', ev => {           // 外側をタップ
    if (ev.target === $('#fb')) fbClose();
  });
  document.addEventListener('keydown', ev => {         // Esc
    if (ev.key === 'Escape' && !$('#fb').hidden) fbClose();
  });
  $('#fb-kinds').addEventListener('click', ev => {
    const b = ev.target.closest('.chip');
    if (!b) return;
    fbKind = FB_KINDS.includes(b.dataset.kind) ? b.dataset.kind : 'その他';
    fbRenderKinds();
  });
  $('#fb-send').addEventListener('click', fbSend);

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
    setPicked(1, id);
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
fbLoad();
bind();
render();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(e => console.warn('SW 登録に失敗', e));
  });
}
