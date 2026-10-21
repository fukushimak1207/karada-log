/* 意見(フィードバック)の受け口 — Cloudflare Pages Functions
 *
 * アプリ → /api/feedback → GitHub Issues(非公開リポジトリ)
 *
 * 置き場所の決まり: functions/ は「プロジェクトのルート」に置く。
 * ビルド出力ディレクトリ(app/)の中ではない。
 * 出典: https://developers.cloudflare.com/pages/functions/get-started/
 *   "Make sure that the /functions directory is at the root of your Pages project"
 *
 * 必要な環境変数(Cloudflare のダッシュボードで設定する。コードにもページにも書かない)
 *   GITHUB_FEEDBACK_TOKEN … Issues の読み書きだけを許可した GitHub の鍵
 *   FEEDBACK_SECRET       … 合言葉。アプリが送ってきた値とここで照合する
 *
 * 合言葉がある理由: このアプリにはログインが無いので、
 * これが無いと誰でも Issue を立てられてしまう。
 */

const OWNER = 'fukushimak1207';
const REPO = 'karada-log-feedback';
const KINDS = ['不具合', '要望', 'その他'];
const MAX_TEXT = 2000;
const FENCE = '```';

export async function onRequest(context) {
  const { request, env } = context;
  try {
    if (request.method === 'GET') return await handleGet(request, env);
    if (request.method === 'POST') return await handlePost(request, env);
    return json({ ok: false, error: 'この方法では受け付けていません' }, 405);
  } catch (e) {
    // 中身は返さない(鍵やURLが混ざる恐れがあるため)
    console.error(e);
    return json({ ok: false, error: 'サーバー側で問題が起きました' }, 500);
  }
}

/* ---------- 共通 ---------- */

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

function configured(env) {
  return Boolean(env.GITHUB_FEEDBACK_TOKEN && env.FEEDBACK_SECRET);
}

// 合言葉の照合。長さが違っても早く抜けないようにして、総当たりの手がかりを減らす
function aikotobaOk(given, real) {
  const a = String(given || ''), b = String(real || '');
  if (!a || !b) return false;
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}

async function gh(env, path, init) {
  const res = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${env.GITHUB_FEEDBACK_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'karada-log-feedback',
      'Content-Type': 'application/json',
      ...(init && init.headers),
    },
  });
  return res;
}

/* ---------- 本文の組み立てと読み取り ---------- */
/* Issue 本文 = 意見の文 + 画面情報の json ブロック。
 * 人が GitHub で読んでも分かり、機械でも取り出せる形にする。 */

function buildBody(text, screen) {
  return `${text}\n\n${FENCE}json\n${JSON.stringify(screen, null, 2)}\n${FENCE}\n`;
}

function parseBody(body) {
  const src = String(body || '');
  const i = src.indexOf(`${FENCE}json`);
  if (i < 0) return { text: src.trim(), screen: null };
  const text = src.slice(0, i).trim();
  const rest = src.slice(i + (FENCE + 'json').length);
  const end = rest.indexOf(FENCE);
  let screen = null;
  try { screen = JSON.parse(end < 0 ? rest : rest.slice(0, end)); } catch (e) { screen = null; }
  return { text, screen };
}

function kindOf(labels) {
  const names = (labels || []).map(l => (typeof l === 'string' ? l : l.name));
  return KINDS.find(k => names.includes(k)) || 'その他';
}

/* ---------- ラベル ---------- */
/* 初回の送信でラベルを作る。すでにあれば 422 が返るので、それは成功として扱う。 */

async function ensureLabels(env, kind) {
  const wanted = [
    { name: 'feedback', color: '0e8a16', description: 'からだログの意見' },
    { name: kind, color: kind === '不具合' ? 'd73a4a' : (kind === '要望' ? '1d76db' : 'cccccc') },
  ];
  for (const l of wanted) {
    const res = await gh(env, `/repos/${OWNER}/${REPO}/labels`, {
      method: 'POST',
      body: JSON.stringify(l),
    });
    if (!res.ok && res.status !== 422) {
      throw new Error(`ラベルを作れません (${res.status})`);
    }
  }
}

/* ---------- 一覧 ---------- */

async function handleGet(request, env) {
  if (!configured(env)) return json({ ok: false, error: 'まだ設定が済んでいません' }, 503);
  const url = new URL(request.url);
  if (!aikotobaOk(url.searchParams.get('aikotoba'), env.FEEDBACK_SECRET)) {
    return json({ ok: false, error: '合言葉が違います' }, 401);
  }

  const q = `/repos/${OWNER}/${REPO}/issues?labels=feedback&state=all&per_page=50&sort=created&direction=desc`;
  const res = await gh(env, q, { method: 'GET' });
  if (!res.ok) return json({ ok: false, error: `一覧を取れません (${res.status})` }, 502);
  const issues = await res.json();

  // 返事(コメント)は1回の呼び出しでまとめて取る。件数が少ないので十分
  let comments = [];
  const cres = await gh(env, `/repos/${OWNER}/${REPO}/issues/comments?per_page=100`, { method: 'GET' });
  if (cres.ok) comments = await cres.json();

  const items = issues
    .filter(i => !i.pull_request)
    .map(i => {
      const { text, screen } = parseBody(i.body);
      const reply = comments
        .filter(c => Number(String(c.issue_url).split('/').pop()) === i.number)
        .map(c => c.body)
        .join('\n\n');
      return {
        number: i.number,
        kind: kindOf(i.labels),
        text,
        screen,
        createdAt: i.created_at,
        status: i.state === 'closed' ? '対応済み' : '未対応',
        reply,
      };
    });

  return json({ ok: true, items });
}

/* ---------- 送信 ---------- */

async function handlePost(request, env) {
  if (!configured(env)) return json({ ok: false, error: 'まだ設定が済んでいません' }, 503);

  let body;
  try { body = await request.json(); } catch (e) { return json({ ok: false, error: '形式が違います' }, 400); }

  if (!aikotobaOk(body.aikotoba, env.FEEDBACK_SECRET)) {
    return json({ ok: false, error: '合言葉が違います' }, 401);
  }

  const kind = KINDS.includes(body.kind) ? body.kind : 'その他';
  const text = String(body.text || '').trim().slice(0, MAX_TEXT);
  if (!text) return json({ ok: false, error: '内容が空です' }, 400);

  const screen = (body.screen && typeof body.screen === 'object') ? body.screen : {};
  const tab = String(screen.tab || '画面不明');
  const head = text.replace(/\s+/g, ' ').slice(0, 40);

  await ensureLabels(env, kind);

  const res = await gh(env, `/repos/${OWNER}/${REPO}/issues`, {
    method: 'POST',
    body: JSON.stringify({
      title: `[${kind}] ${tab} ${head}`,
      body: buildBody(text, screen),
      labels: ['feedback', kind],
    }),
  });
  if (!res.ok) return json({ ok: false, error: `送れませんでした (${res.status})` }, 502);

  const issue = await res.json();
  return json({
    ok: true,
    item: {
      number: issue.number,
      kind,
      text,
      screen,
      createdAt: issue.created_at,
      status: '未対応',
      reply: '',
    },
  });
}
