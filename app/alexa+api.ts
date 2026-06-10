/**
 * Alexa スキルのエンドポイント
 * URL: https://dist-sigma-eight-92.vercel.app/alexa
 *
 * Amazonコンソールのエンドポイント設定をこのURLに変更してください。
 *
 * Vercel環境変数 FAMILY_CODE に家族コードを設定してください。
 * 例: yamada2026
 */

const FIREBASE_API_KEY = 'AIzaSyC4aO87v3JV0ltomhFyf4v2CJhs1Oz_pa8';
const FIREBASE_PROJECT_ID = 'shopping-list-8795f';
const FIRESTORE_URL = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/items?key=${FIREBASE_API_KEY}`;

async function addItemToFirestore(item: string, familyCode: string): Promise<boolean> {
  const res = await fetch(FIRESTORE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fields: {
        name:       { stringValue: item },
        done:       { booleanValue: false },
        createdAt:  { integerValue: String(Date.now()) },
        familyCode: { stringValue: familyCode },
      },
    }),
  });
  return res.ok;
}

function alexaResponse(text: string, endSession = true) {
  return Response.json({
    version: '1.0',
    response: {
      outputSpeech: { type: 'PlainText', text },
      shouldEndSession: endSession,
    },
  });
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const requestType: string = body?.request?.type ?? '';

    // 起動時
    if (requestType === 'LaunchRequest') {
      return alexaResponse('買い物リストです。何を追加しますか？', false);
    }

    // 終了
    if (requestType === 'SessionEndedRequest') {
      return Response.json({ version: '1.0', response: {} });
    }

    if (requestType === 'IntentRequest') {
      const intentName: string = body?.request?.intent?.name ?? '';
      const slots: Record<string, { value?: string }> = body?.request?.intent?.slots ?? {};

      // キャンセル・停止
      if (['AMAZON.CancelIntent', 'AMAZON.StopIntent'].includes(intentName)) {
        return alexaResponse('またいつでもどうぞ。');
      }

      // アイテム追加インテント
      // スロット名は Item / アイテム / item / ITEM など複数に対応
      const item = (
        slots['Item']?.value ||
        slots['アイテム']?.value ||
        slots['item']?.value ||
        slots['ITEM']?.value ||
        Object.values(slots).find(s => s.value)?.value ||
        ''
      ).trim();

      if (!item) {
        return alexaResponse('何を追加しますか？', false);
      }

      // Vercel環境変数から家族コードを取得
      const familyCode = (process.env.FAMILY_CODE ?? '').trim().toLowerCase();
      if (!familyCode) {
        return alexaResponse('設定エラーです。管理者にご連絡ください。');
      }

      const ok = await addItemToFirestore(item, familyCode);
      if (!ok) {
        return alexaResponse('追加に失敗しました。もう一度お試しください。');
      }

      return alexaResponse(`${item}を買い物リストに追加しました。`);
    }

    return alexaResponse('すみません、うまく聞き取れませんでした。', false);

  } catch (e) {
    console.error('Alexa endpoint error:', e);
    return alexaResponse('エラーが発生しました。もう一度お試しください。');
  }
}

// テスト用GET（ブラウザで動作確認できます）
export async function GET() {
  return Response.json({ status: 'ok', message: 'Alexa endpoint is running' });
}
