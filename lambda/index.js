const Alexa = require('ask-sdk-core');
const https = require('https');

const FAMILY_CODE = '小木曽達也仁美';
const FIREBASE_PROJECT = 'shopping-list-8795f';
const FIREBASE_API_KEY = 'AIzaSyC4aO87v3JV0ltomhFyf4v2CJhs1Oz_pa8';

function addItemToFirestore(itemName) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      fields: {
        name:       { stringValue: itemName },
        done:       { booleanValue: false },
        createdAt:  { integerValue: Date.now().toString() },
        familyCode: { stringValue: FAMILY_CODE }
      }
    });

    const req = https.request({
      hostname: 'firestore.googleapis.com',
      path: `/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents/items?key=${FIREBASE_API_KEY}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        // ★ ここが修正箇所：ステータスコードを確認する
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(data);
        } else {
          // エラー詳細をログに出力（CloudWatchで確認できる）
          console.error(`Firestore error: status=${res.statusCode}, body=${data}`);
          reject(new Error(`Firestore returned ${res.statusCode}: ${data}`));
        }
      });
    });

    req.on('error', (e) => {
      console.error('Request error:', e);
      reject(e);
    });

    req.write(body);
    req.end();
  });
}

const LaunchRequestHandler = {
  canHandle(handlerInput) {
    return Alexa.getRequestType(handlerInput.requestEnvelope) === 'LaunchRequest';
  },
  handle(handlerInput) {
    return handlerInput.responseBuilder
      .speak('かいものメモを開きました。追加したいものを教えてください。')
      .reprompt('何を追加しますか？')
      .getResponse();
  }
};

const AddItemIntentHandler = {
  canHandle(handlerInput) {
    return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest'
      && Alexa.getIntentName(handlerInput.requestEnvelope) === 'AddItemIntent';
  },
  async handle(handlerInput) {
    const item = Alexa.getSlotValue(handlerInput.requestEnvelope, 'item');
    if (!item) {
      return handlerInput.responseBuilder
        .speak('何を追加しますか？')
        .reprompt('何を追加しますか？')
        .getResponse();
    }
    try {
      await addItemToFirestore(item);
      return handlerInput.responseBuilder
        .speak(`${item}をリストに追加しました。`)
        .getResponse();
    } catch (e) {
      console.error('AddItem failed:', e.message);
      return handlerInput.responseBuilder
        .speak('追加できませんでした。しばらくしてからもう一度お試しください。')
        .getResponse();
    }
  }
};

const HelpIntentHandler = {
  canHandle(handlerInput) {
    return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest'
      && Alexa.getIntentName(handlerInput.requestEnvelope) === 'AMAZON.HelpIntent';
  },
  handle(handlerInput) {
    return handlerInput.responseBuilder
      .speak('追加したいものを教えてください。例えば、牛乳をリストに追加して、と言ってみてください。')
      .reprompt('何を追加しますか？')
      .getResponse();
  }
};

const CancelAndStopIntentHandler = {
  canHandle(handlerInput) {
    return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest'
      && (Alexa.getIntentName(handlerInput.requestEnvelope) === 'AMAZON.CancelIntent'
        || Alexa.getIntentName(handlerInput.requestEnvelope) === 'AMAZON.StopIntent');
  },
  handle(handlerInput) {
    return handlerInput.responseBuilder
      .speak('かいものメモを閉じます。')
      .getResponse();
  }
};

const ErrorHandler = {
  canHandle() { return true; },
  handle(handlerInput, error) {
    console.error('Unhandled error:', error);
    return handlerInput.responseBuilder
      .speak('エラーが発生しました。もう一度試してください。')
      .getResponse();
  }
};

exports.handler = Alexa.SkillBuilders.custom()
  .addRequestHandlers(
    LaunchRequestHandler,
    AddItemIntentHandler,
    HelpIntentHandler,
    CancelAndStopIntentHandler
  )
  .addErrorHandlers(ErrorHandler)
  .lambda();
