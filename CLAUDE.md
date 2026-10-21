# からだログ — Claude 向けの覚え書き

## 「フィードバック見て」と言われたら

アプリの「意見」ボタンから送られた意見は、**非公開リポジトリ `fukushimak1207/karada-log-feedback` の Issue** に入っている。

```bash
gh issue list --repo fukushimak1207/karada-log-feedback --label feedback --state open
```

1. 未対応（open）のものを読み、**内容を要約して報告する**。本文末尾の ```json ブロックに
   「どの画面の、どの状態から送ったか」が入っているので、再現の手がかりに使う
2. 対応したら、返事を書いてから閉じる（closed = 対応済みとしてアプリに出る）

```bash
gh issue comment <番号> --repo fukushimak1207/karada-log-feedback --body "直しました。…"
gh issue close <番号> --repo fukushimak1207/karada-log-feedback
```

3. **対応しない・保留のものは閉じない。** 理由をコメントに書き、open のままにする
   （アプリ側では「未対応」のまま、理由だけが表示される）

## 意見の仕組み

```
アプリ → /api/feedback → GitHub Issues（非公開リポジトリ）
         Cloudflare Pages Functions        ↑ Claude は gh で読み書き
```

- コードは `functions/api/feedback.js`。**`functions/` はリポジトリのルート**に置く
  （ビルド出力の `app/` の中ではない）
- 本番で必要な環境変数（Cloudflare のダッシュボードで設定。コードにもページにも書かない）

| 名前 | 中身 |
|---|---|
| `GITHUB_FEEDBACK_TOKEN` | Issues の読み書きだけを許可した GitHub の鍵。**期限切れに注意** |
| `FEEDBACK_AIKOTOBA` | 合言葉。アプリが送ってきた値と照合する |

- このアプリに**ログインは無い**。合言葉がサーバー側の入口を守っている
- ローカルで試すときは、鍵をファイルに書かず、その場で渡す

```bash
npx.cmd -y wrangler@4 pages dev app --port 8788 --binding GITHUB_FEEDBACK_TOKEN="$(gh auth token)" FEEDBACK_AIKOTOBA="好きな合言葉"
```

## 触るときの注意

- **ファイルを更新したら `app/sw.js` の `CACHE_VERSION` を上げる。** 上げないとスマホが古い画面を使い続ける
- `要件定義.md` は **git 管理外**（体組成の数値が入っているため）。コミットに混ぜない
- ロジックの検証は Node で行う（`localStorage` と `document` を差し替えて `app.js` を読み込む）
