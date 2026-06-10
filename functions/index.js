const { onRequest } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');

admin.initializeApp();
const db = admin.firestore();

/**
 * Alexaからアイテムを追加するエンドポイント
 *
 * 使い方（IFTTTやAlexaスキルから呼ぶ）:
 *   POST https://<your-region>-shopping-list-8795f.cloudfunctions.net/alexaAddItem
 *   Content-Type: application/json
 *   {
 *     "familyCode": "yamada2026",
 *     "item": "牛乳"
 *   }
 *
 * セキュリティ: ALEXA_SECRET環境変数を設定すると、
 *   Authorization: Bearer <secret> ヘッダーで認証できます
 */
exports.alexaAddItem = onRequest({ cors: true }, async (req, res) => {
  // OPTIONSプリフライトへの対応
  if (req.method === 'OPTIONS') {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'POST, GET');
    res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.status(204).send('');
    return;
  }

  // 簡易認証（オプション）
  const secret = process.env.ALEXA_SECRET;
  if (secret) {
    const auth = req.headers['authorization'] || '';
    if (auth !== `Bearer ${secret}`) {
      res.status(401).json({ error: '認証エラー' });
      return;
    }
  }

  // GETパラメータとPOSTボディの両方に対応（IFTTTなど様々な呼び方に対応）
  const familyCode = (req.body?.familyCode || req.query?.familyCode || '').trim().toLowerCase();
  const item = (req.body?.item || req.query?.item || '').trim();

  if (!familyCode || !item) {
    res.status(400).json({ error: 'familyCode と item が必要です' });
    return;
  }

  try {
    await db.collection('items').add({
      name: item,
      done: false,
      createdAt: Date.now(),
      familyCode,
    });
    res.status(200).json({ success: true, added: item });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Firestoreへの書き込みに失敗しました' });
  }
});
