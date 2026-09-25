/**
 * アセノサッカークラブ 公式LINE連携（見込み客用 @225hvwib）
 * Google Apps Script — 1ファイルで完結
 *
 * できること
 *  1. 友だち追加の直後に、あいさつ＋3つの質問（学年／知ったきっかけ／いまのお気持ち）をボタンで聞く
 *  2. 答えをスプレッドシートの「LINE友だち」シートに1人1行で記録する
 *  3. 答えに合わせて、学年とLINE受付番号が入った体験申込フォームを案内する
 *  4. 体験申込が届いたら、どのLINE友だちか照合してシートを更新し、LINEでお礼を送る
 *
 * 既存の「アセノ会員連絡」プロジェクトとは別のプロジェクトとして置きます。
 * 既存のメール通知（体験申込→保護者へ自動返信・担当者へ通知）はそのまま動きます。
 *
 * 導入手順は同じフォルダの README.md を見てください。
 *  - スクリプト プロパティ LINE_TOKEN にチャネルアクセストークン（長期）を入れる
 *  - setup() を1回実行
 *  - ウェブアプリとしてデプロイし、URL に ?key=（合言葉）を付けて LINE の Webhook URL に登録
 */

const CONFIG = {
  // 「会員連絡（回答・名簿）」スプレッドシート
  SHEET_ID: '1wJ_nhaSEh0xwtd9R1JoluBJyGrAmuYMZ_kMMlo0tsCw',
  // 無料体験申込フォーム（編集用URLの /d/ と /edit の間）
  TRIAL_FORM_ID: '1bHAHAeuA1bBtYexlqniQGOuyn00W5gNaS07uN71zvUk',
  FRIEND_SHEET: 'LINE友だち',
  // 体験申込フォームに追加する欄（setup() が自動で追加します）
  UID_ITEM_TITLE: 'LINE受付番号',
  UID_ITEM_HELP: 'LINEから開いた場合は自動で入ります。変更せずに、そのまま送信してください。',
  GRADE_ITEM_TITLE: '学年',
  TEL: '0297-45-6301',
  // 体験申込が届いたとき、LINEでお礼を送るか（1通ぶん無料枠を使います）
  PUSH_ON_TRIAL: true,
  // このテキストが送られたら、LINE受付番号入りの体験申込ボタンを返す
  // （リッチメニュー①のアクションを「テキスト：無料体験申込」にした場合に使います）
  TRIAL_KEYWORDS: ['無料体験申込'],

  // 友だち追加直後のあいさつ（{name} はLINEの表示名に置き換わります）
  GREETING: [
    '{name}友だち追加ありがとうございます！',
    '守谷で44年つづく少年サッカークラブ、アセノサッカークラブです⚽',
    '',
    '✔ 小学1〜3年生・はじめてのお子さま大歓迎',
    '✔ 学校・学童・ご自宅の近くまで専用バスで送迎',
    '✔ ナイター完備の専用人工芝グラウンド',
    '✔ 平日のみの活動なので、他チームとの掛け持ちOK',
    '',
    'このLINEで、無料体験やイベントのご案内をお届けします。',
    'お電話：' + '0297-45-6301' + '（平日14:00〜20:30）',
  ].join('\n'),

  // 1問目の前に付ける一言
  QUESTION_INTRO: 'はじめに、3つだけ教えてください。\n下のボタンを押すだけで答えられます（10秒ほどで終わります）。',

  // 「送迎が気になる」を選んだ人への返信
  BUS_TEXT: 'アセノの送迎は、専用バスで学校・学童・ご自宅の近くまでお迎えに行き、練習が終わったらご自宅周辺までお送りします。お仕事の間、お子さまをお預かりするイメージです。中学生は守谷駅との送迎もあります。',
};

// 質問（ボタンの文字は20文字まで・13個まで）
const QUESTIONS = [
  {
    col: '学年',
    text: '① お子さまの学年は？\n（ごきょうだいの場合は、どちらか1人でOKです）',
    options: ['年中以下', '年長', '小1', '小2', '小3', '小4', '小5', '小6', '中学生'],
  },
  {
    col: 'きっかけ',
    text: '② アセノを知ったきっかけは？',
    options: ['チラシ', '送迎バス', 'お友だち・ご家族', 'Instagram', 'ホームページ', 'イベント', 'その他'],
  },
  {
    col: 'いまのお気持ち',
    text: '③ いまのお気持ちに近いものは？',
    options: ['体験してみたい', 'まずは情報がほしい', 'イベントなら行きたい', '送迎が気になる'],
  },
];

// 質問①の答え → 体験申込フォームの「学年」の選択肢
const GRADE_TO_FORM = {
  '年中以下': '園児', '年長': '園児',
  '小1': '小学1年生', '小2': '小学2年生', '小3': '小学3年生',
  '小4': '小学4年生', '小5': '小学5年生', '小6': '小学6年生',
};

// 「LINE友だち」シートの列（並べ替え・列の追加をしても動きます）
const COL = {
  ADDED: '友だち追加日時',
  NAME: 'LINE表示名',
  GRADE: QUESTIONS[0].col,
  SOURCE: QUESTIONS[1].col,
  INTENT: QUESTIONS[2].col,
  ANSWERED: '回答日時',
  TRIAL: '体験申込日時',
  CHILD: '体験申込のお名前',
  STATUS: '状態',
  MEMO: 'メモ',
  UID: 'LINE受付番号',
};
const HEADERS = [COL.ADDED, COL.NAME, COL.GRADE, COL.SOURCE, COL.INTENT, COL.ANSWERED,
                 COL.TRIAL, COL.CHILD, COL.STATUS, COL.MEMO, COL.UID];

// ================= 1. 初期セットアップ（最初に1回だけ実行） =================
function setup() {
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('LINE_TOKEN')) {
    throw new Error('スクリプト プロパティ LINE_TOKEN が空です。チャネルアクセストークン（長期）を入れてから実行してください。');
  }

  // --- 体験申込フォームに「LINE受付番号」欄を追加し、事前入力URLの形を調べる ---
  const form = FormApp.openById(CONFIG.TRIAL_FORM_ID);
  let uidItem = findItem_(form, CONFIG.UID_ITEM_TITLE);
  if (!uidItem) {
    uidItem = form.addTextItem().setTitle(CONFIG.UID_ITEM_TITLE).setHelpText(CONFIG.UID_ITEM_HELP).setRequired(false);
    Logger.log('体験申込フォームの最後に「' + CONFIG.UID_ITEM_TITLE + '」欄を追加しました。');
  }
  let res = form.createResponse().withItemResponse(uidItem.asTextItem().createResponse('__UID__'));
  const gradeItem = findItem_(form, CONFIG.GRADE_ITEM_TITLE);
  let gradeChoices = [];
  if (gradeItem && gradeItem.getType() === FormApp.ItemType.LIST) {
    gradeChoices = gradeItem.asListItem().getChoices().map(c => c.getValue());
    res = res.withItemResponse(gradeItem.asListItem().createResponse(gradeChoices[0]));
  }
  const template = res.toPrefilledUrl();
  const entries = {};
  (template.match(/entry\.\d+=[^&]*/g) || []).forEach(kv => {
    const [k, v] = kv.split('=');
    entries[k] = v;
  });
  const uidEntry = Object.keys(entries).find(k => entries[k] === '__UID__');
  const gradeEntry = Object.keys(entries).find(k => k !== uidEntry) || '';
  if (!uidEntry) throw new Error('事前入力URLの作成に失敗しました: ' + template);

  const missing = Object.keys(GRADE_TO_FORM).filter(k => gradeChoices.indexOf(GRADE_TO_FORM[k]) < 0);
  if (missing.length) Logger.log('注意: 次の学年はフォームの選択肢に見つからないため、事前入力しません → ' + missing.join('、'));

  props.setProperties({
    TRIAL_BASE_URL: template.split('?')[0],
    TRIAL_UID_ENTRY: uidEntry,
    TRIAL_GRADE_ENTRY: gradeEntry,
    GRADE_CHOICES: JSON.stringify(gradeChoices),
  });
  if (!props.getProperty('WEBHOOK_KEY')) {
    props.setProperty('WEBHOOK_KEY', Utilities.getUuid().replace(/-/g, '').slice(0, 16));
  }

  // --- 「LINE友だち」シート ---
  sheet_();

  // --- 体験申込が届いたときのトリガー（このプロジェクトの分だけ入れ直す） ---
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'onTrialSubmitLine')
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('onTrialSubmitLine').forForm(form).onFormSubmit().create();

  Logger.log('セットアップ完了。');
  Logger.log('■ Webhookの合言葉: ' + props.getProperty('WEBHOOK_KEY'));
  Logger.log('■ LINEに登録するWebhook URL: （ウェブアプリのURL）?key=' + props.getProperty('WEBHOOK_KEY'));
  Logger.log('■ 体験申込フォーム（LINE受付番号入りの例）: ' + trialUrl_('Uxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', '小1'));
}

// ================= 2. LINEからの受け口（ウェブアプリ） =================
function doPost(e) {
  const out = ContentService.createTextOutput('OK');
  try {
    const key = PropertiesService.getScriptProperties().getProperty('WEBHOOK_KEY');
    if (!key || !e || !e.parameter || e.parameter.key !== key) return out;
    const body = JSON.parse(e.postData.contents);
    (body.events || []).forEach(ev => {
      try { handleEvent_(ev); } catch (err) { console.error(err && err.stack || err); }
    });
  } catch (err) {
    console.error(err && err.stack || err);
  }
  return out;
}

// ブラウザでURLを開いたときの動作確認用
function doGet() {
  return ContentService.createTextOutput('アセノLINE連携は動いています。');
}

function handleEvent_(ev) {
  if (!ev.source || ev.source.type !== 'user' || !ev.source.userId) return;
  const uid = ev.source.userId;
  switch (ev.type) {
    case 'follow': return onFollow_(ev, uid);
    case 'unfollow': return upsert_(uid, { [COL.STATUS]: 'ブロック' });
    case 'postback': return onPostback_(ev, uid);
    case 'message':
      if (ev.message && ev.message.type === 'text' && CONFIG.TRIAL_KEYWORDS.indexOf(ev.message.text.trim()) >= 0) {
        const row = getRow_(uid) || {};
        return reply_(ev.replyToken, [trialButton_(uid, row[COL.GRADE], 'こちらから1分ほどで申し込めます。担当者から2〜3日以内にご連絡します。', '無料体験に申し込む')]);
      }
      return; // それ以外は、LINE公式アカウントの応答メッセージ・チャットに任せる
  }
}

// 友だち追加（ブロック解除を含む）
function onFollow_(ev, uid) {
  const name = profileName_(uid);
  const before = getRow_(uid);
  const fields = { [COL.NAME]: name, [COL.STATUS]: before ? '友だち（再追加）' : '友だち' };
  if (!before) fields[COL.ADDED] = new Date();
  upsert_(uid, fields);

  const greeting = { type: 'text', text: CONFIG.GREETING.replace('{name}', name ? name + 'さん、' : '') };
  if (before && before[COL.ANSWERED]) {
    // 以前に答えてくれた人には、質問をくり返さない
    return reply_(ev.replyToken, [greeting, trialButton_(uid, before[COL.GRADE], '無料体験は、いつでもこちらから申し込めます（参加費無料）。', '無料体験に申し込む')]);
  }
  return reply_(ev.replyToken, [greeting, questionMessage_(0, CONFIG.QUESTION_INTRO)]);
}

// 質問のボタンが押された
function onPostback_(ev, uid) {
  const d = parseData_(ev.postback && ev.postback.data);
  const qi = Number(d.q), vi = Number(d.v);
  const q = QUESTIONS[qi];
  if (!q || !(vi >= 0 && vi < q.options.length)) return;
  const answer = q.options[vi];
  const isLast = qi === QUESTIONS.length - 1;

  const fields = { [q.col]: answer };
  if (isLast) fields[COL.ANSWERED] = new Date();
  const row = upsert_(uid, fields);

  if (!isLast) return reply_(ev.replyToken, [questionMessage_(qi + 1)]);
  return reply_(ev.replyToken, finalMessages_(answer, row[COL.GRADE], uid));
}

// 3問目の答えに合わせた返信
function finalMessages_(intent, grade, uid) {
  const filled = GRADE_TO_FORM[grade] ? '（学年は入力済みです）' : '';
  switch (intent) {
    case '体験してみたい':
      return [trialButton_(uid, grade, 'ありがとうございます！\n無料体験は1分ほどで申し込めます' + filled + '。担当者から2〜3日以内にご連絡します。', '無料体験に申し込む')];
    case '送迎が気になる':
      return [
        { type: 'text', text: 'ありがとうございます！\n\n' + CONFIG.BUS_TEXT },
        trialButton_(uid, grade, '乗車場所やルートは、体験のときにご相談いただけます（参加費無料）。', '無料体験に申し込む'),
      ];
    case 'イベントなら行きたい':
      return [
        { type: 'text', text: 'ありがとうございます！\nイベントの日程が決まったら、真っ先にこのLINEでお知らせします。' },
        trialButton_(uid, grade, 'ふだんの練習の体験も、いつでも受け付けています（参加費無料）。', '無料体験を見てみる'),
      ];
    default:
      return [
        { type: 'text', text: 'ありがとうございます！\n体験会やイベントの日程が決まったら、このLINEでお知らせします。気になることは、いつでもこのトークに送ってください。' },
        trialButton_(uid, grade, '体験はいつでも受け付けています（参加費無料）。', '無料体験を見てみる'),
      ];
  }
}

// ================= 3. 体験申込フォームが送信されたとき =================
function onTrialSubmitLine(e) {
  const r = {};
  e.response.getItemResponses().forEach(ir => { r[ir.getItem().getTitle()] = ir.getResponse(); });
  const uid = String(r[CONFIG.UID_ITEM_TITLE] || '').trim();
  if (!/^U[0-9a-f]{32}$/.test(uid)) return; // LINE以外（HP・チラシのURLなど）から来た申込

  const child = [r['お子さまのお名前'], r['学年'] ? '（' + r['学年'] + '）' : ''].join('');
  upsert_(uid, { [COL.TRIAL]: new Date(), [COL.CHILD]: child, [COL.STATUS]: '体験申込済' });

  if (!CONFIG.PUSH_ON_TRIAL) return;
  const parent = r['保護者のお名前'] ? r['保護者のお名前'] + ' 様\n' : '';
  push_(uid, [{
    type: 'text',
    text: parent + '無料体験のお申し込みありがとうございます！\n担当者から2〜3日以内に、お電話かメールでご連絡します。\n\n' +
      '当日は、運動できる服装・シューズ・飲み物をお持ちください。参加費は無料です。\n' +
      'お急ぎの場合は ' + CONFIG.TEL + '（平日14:00〜20:30）へどうぞ。',
  }]);
}

// ================= 4. 手動で使う関数 =================
// Webhookを入れる前に友だちになった人にも、質問を一斉に送る（友だちの人数ぶん無料枠を使います）
function askAllFriends() {
  broadcast_([questionMessage_(0, 'アセノサッカークラブです。お子さまに合ったご案内をお届けするため、3つだけ教えてください。\n下のボタンを押すだけで答えられます。')]);
  Logger.log('一斉送信しました。');
}

// ================= 共通 =================
function questionMessage_(qi, intro) {
  const q = QUESTIONS[qi];
  return {
    type: 'text',
    text: (intro ? intro + '\n\n' : '') + q.text,
    quickReply: {
      items: q.options.map((label, vi) => ({
        type: 'action',
        action: { type: 'postback', label: label, data: 'q=' + qi + '&v=' + vi, displayText: label },
      })),
    },
  };
}

function trialButton_(uid, grade, text, label) {
  return {
    type: 'template',
    altText: '無料体験のお申し込み',
    template: { type: 'buttons', text: text, actions: [{ type: 'uri', label: label, uri: trialUrl_(uid, grade) }] },
  };
}

function trialUrl_(uid, grade) {
  const p = PropertiesService.getScriptProperties().getProperties();
  let url = p.TRIAL_BASE_URL + '?usp=pp_url&' + p.TRIAL_UID_ENTRY + '=' + encodeURIComponent(uid);
  const choice = GRADE_TO_FORM[grade];
  const choices = JSON.parse(p.GRADE_CHOICES || '[]');
  if (choice && p.TRIAL_GRADE_ENTRY && choices.indexOf(choice) >= 0) {
    url += '&' + p.TRIAL_GRADE_ENTRY + '=' + encodeURIComponent(choice);
  }
  return url;
}

function findItem_(form, title) {
  return form.getItems().find(it => it.getTitle() === title) || null;
}

function parseData_(s) {
  const o = {};
  String(s || '').split('&').forEach(kv => {
    const i = kv.indexOf('=');
    if (i > 0) o[kv.slice(0, i)] = kv.slice(i + 1);
  });
  return o;
}

// --- スプレッドシート ---
function sheet_() {
  const ss = SpreadsheetApp.openById(CONFIG.SHEET_ID);
  let sh = ss.getSheetByName(CONFIG.FRIEND_SHEET);
  if (!sh) {
    sh = ss.insertSheet(CONFIG.FRIEND_SHEET);
    sh.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

function header_(sh) {
  return sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
}

function findRowIndex_(sh, head, uid) {
  const c = head.indexOf(COL.UID) + 1;
  if (c < 1 || sh.getLastRow() < 2) return 0;
  const hit = sh.getRange(2, c, sh.getLastRow() - 1, 1).createTextFinder(uid).matchEntireCell(true).findNext();
  return hit ? hit.getRow() : 0;
}

function readRow_(sh, head, row) {
  const vals = sh.getRange(row, 1, 1, head.length).getValues()[0];
  const o = {};
  head.forEach((h, i) => { o[h] = vals[i]; });
  return o;
}

function getRow_(uid) {
  const sh = sheet_();
  const head = header_(sh);
  const row = findRowIndex_(sh, head, uid);
  return row ? readRow_(sh, head, row) : null;
}

// uid の行がなければ作り、fields の列を書き込んで、書き込み後の行を返す
function upsert_(uid, fields) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sh = sheet_();
    const head = header_(sh);
    let row = findRowIndex_(sh, head, uid);
    if (!row) {
      row = sh.getLastRow() + 1;
      sh.getRange(row, head.indexOf(COL.UID) + 1).setValue(uid);
      if (!(COL.STATUS in fields)) fields = Object.assign({ [COL.STATUS]: '友だち' }, fields);
    }
    Object.keys(fields).forEach(k => {
      const c = head.indexOf(k) + 1;
      if (c > 0) sh.getRange(row, c).setValue(fields[k]);
    });
    return readRow_(sh, head, row);
  } finally {
    lock.releaseLock();
  }
}

// --- LINE Messaging API ---
function lineFetch_(method, path, payload) {
  const token = PropertiesService.getScriptProperties().getProperty('LINE_TOKEN');
  const opt = { method: method, headers: { Authorization: 'Bearer ' + token }, muteHttpExceptions: true };
  if (payload) {
    opt.contentType = 'application/json';
    opt.payload = JSON.stringify(payload);
  }
  const res = UrlFetchApp.fetch('https://api.line.me' + path, opt);
  if (res.getResponseCode() >= 300) console.error('LINE API ' + path + ' ' + res.getResponseCode() + ' ' + res.getContentText());
  return res;
}

function reply_(replyToken, messages) {
  if (replyToken) lineFetch_('post', '/v2/bot/message/reply', { replyToken: replyToken, messages: messages });
}

function push_(to, messages) {
  lineFetch_('post', '/v2/bot/message/push', { to: to, messages: messages });
}

function broadcast_(messages) {
  lineFetch_('post', '/v2/bot/message/broadcast', { messages: messages });
}

function profileName_(uid) {
  const res = lineFetch_('get', '/v2/bot/profile/' + uid);
  if (res.getResponseCode() !== 200) return '';
  return JSON.parse(res.getContentText()).displayName || '';
}
