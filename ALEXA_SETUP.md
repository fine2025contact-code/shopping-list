# AlexaとFirebaseの連携セットアップ手順

## 1. Firebase Cloud Functionsのデプロイ

```bash
# Firebase CLIのインストール（未インストールの場合）
npm install -g firebase-tools

# ログイン
firebase login

# functionsフォルダの依存関係インストール
cd functions
npm install
cd ..

# Firebase設定（初回のみ）
firebase use shopping-list-8795f

# デプロイ
firebase deploy --only functions
```

デプロイ後、以下のようなURLが表示されます:
```
https://us-central1-shopping-list-8795f.cloudfunctions.net/alexaAddItem
```

このURLをメモしておいてください。

---

## 2. IFTTTを使ったAlexaとの連携（簡単な方法）

IFTTTを使うと、プログラミングなしでAlexaのボイスコマンドとCloud Functionを繋げられます。

1. **IFTTTでアカウント作成** → https://ifttt.com
2. **新しいAppletを作成**
   - **If**: Amazon Alexa → Say a specific phrase
   - フレーズ例: `買い物リストに {{ItemName}} を追加して`（英語では `add {{ItemName}} to shopping list`）
3. **Then**: Webhooks → Make a web request
   - URL: `https://us-central1-shopping-list-8795f.cloudfunctions.net/alexaAddItem`
   - Method: `POST`
   - Content Type: `application/json`
   - Body:
     ```json
     {"familyCode": "あなたの家族コード", "item": "{{ItemName}}"}
     ```

---

## 3. Alexaルーティンを使った方法（もっと簡単）

Alexaアプリの「ルーティン」機能でWebhookを呼ぶことができます。

1. **Alexaアプリ** → ルーティン → 追加
2. **実行条件**: 音声（例：「アレクサ、〇〇を買い物リストに追加して」）
3. **アクション**: カスタムアクション → Webhook
   - URL: Cloud FunctionのURL
   - Body: `{"familyCode": "家族コード", "item": "〇〇"}`

---

## 4. 動作テスト

デプロイ後、ブラウザやcurlでテストできます:

```bash
curl -X POST "https://us-central1-shopping-list-8795f.cloudfunctions.net/alexaAddItem" \
  -H "Content-Type: application/json" \
  -d '{"familyCode": "あなたの家族コード", "item": "テストアイテム"}'
```

成功すると:
```json
{"success": true, "added": "テストアイテム"}
```

---

## 注意事項

- 家族コードはURLに含めず、bodyに入れることでセキュリティが保たれます
- より安全にしたい場合は、Cloud Functionに`ALEXA_SECRET`環境変数を設定してください:
  ```bash
  firebase functions:secrets:set ALEXA_SECRET
  ```
