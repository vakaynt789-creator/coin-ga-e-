// ─────────────────────────────────────────────────────────────
//  Telegram-бот для игры Coin game
//  Чистый Node.js (без внешних модулей), использует https + Ботапи Телеграм
//
//  Логика:
//    /start  -> бот присылает кнопку-ссылку на канал (для подписки)
//              + кнопку «Проверить подписку»
//    Проверить подписку -> бот проверяет статус через getChatMember
//              если подписка есть -> отправляет файл игры (HTML)
//              если нет -> просит сначала подписаться
// ─────────────────────────────────────────────────────────────

const https = require('https');
const fs = require('fs');
const path = require('path');

// ===== НАСТРОЙКИ =====
const BOT_TOKEN = '9083407614:AAGMaFxAt4l8vqsgG_zg_peGc8PytvGZ-Sc';
// Канал, на который нужно подписаться.
const CHANNEL = 'https://t.me/style_conti_7';
// Username канала (для проверки подписки через API): без @, например "style_conti_7".
const CHANNEL_USERNAME = 'style_conti_7';

// Адрес игры (Mini App на Render).
const GAME_WEB_APP_URL = 'https://coin-game-lutn.onrender.com/';
// Адрес админ-панели (Mini App на Render, открывается только твоим аккаунтом).
const ADMIN_WEB_APP_URL = 'https://coin-game-lutn.onrender.com/admin.html';

// Telegram ID админа(ов). Админ после подписки дополнительно получает кнопку админ-панели.
const ADMIN_IDS = [1497464101]; // твой Telegram ID

// Папка с файлом игры. Файл загружается админом через бота и сохраняется сюда
// и раздаётся игрокам после подписки.
const FILES_DIR = path.join(__dirname, 'files');

// Имя файла игры, который бот отправляет пользователю (ZIP-архив).
const GAME_ZIP_NAME = 'Coin game.zip';
// HTML-файл (запасной вариант, если нет ZIP).
const GAME_HTML_NAME = 'Coin game.html';

// Файл, который отправляется игрокам. Приоритет: Coin game.zip, затем Coin game.html,
// затем любой файл в files/.
function getGameFile() {
  const preferred = path.join(FILES_DIR, GAME_ZIP_NAME);
  if (fs.existsSync(preferred)) return preferred;
  const html = path.join(FILES_DIR, GAME_HTML_NAME);
  if (fs.existsSync(html)) return html;
  const items = fs.existsSync(FILES_DIR) ? fs.readdirSync(FILES_DIR).map((f) => path.join(FILES_DIR, f)) : [];
  // игнорируем файл инструкции при выборе "любого файла"
  const f = items.filter((x) => {
    try { return fs.statSync(x).isFile() && path.basename(x) !== 'ИНСТРУКЦИЯ.txt'; } catch (e) { return false; }
  })[0];
  return f || null;
}

const API = `https://api.telegram.org/bot${BOT_TOKEN}`;
let offset = 0;

function isAdmin(chatId) {
  if (!ADMIN_IDS.length) return true; // нет ограничения
  return ADMIN_IDS.includes(chatId);
}

// ===== Небольшие хелперы =====
function callApi(method, body) {
  return new Promise((resolve) => {
    const data = body ? JSON.stringify(body) : '';
    const url = `${API}/${method}`;
    const u = new URL(url);
    const req = https.request({
      hostname: u.hostname,
      path: u.pathname,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, (res) => {
      let raw = '';
      res.on('data', (c) => (raw += c));
      res.on('end', () => {
        let json;
        try { json = JSON.parse(raw); } catch (e) { json = { ok: false, raw: raw.slice(0, 200) }; }
        if (!json.ok) console.log('[api]', method, 'FAILED:', raw.slice(0, 300));
        resolve(json);
      });
    });
    req.on('error', (e) => { console.log('[api]', method, 'NETWORK ERROR:', e.message); resolve({ ok: false }); });
    req.write(data);
    req.end();
  });
}

function sendMessage(chatId, text, opts = {}) {
  return callApi('sendMessage', Object.assign({ chat_id: chatId, text }, opts));
}

// ===== Username канала для проверки подписки =====
function channelUsername() {
  return CHANNEL_USERNAME || 'style_conti_7';
}

// ===== Проверка подписки =====
// Статусы через getChatMember. Подписан, если членство:
//   member / administrator / creator
async function isSubscribed(chatId) {
  const ch = channelUsername();
  const res = await callApi('getChatMember', {
    chat_id: `@${ch}`,
    user_id: chatId
  });
  if (!res.ok) return { subscribed: false, status: 'не удалось проверить', error: res };
  const st = res.result.status;
  const ok = st === 'member' || st === 'administrator' || st === 'creator';
  return { subscribed: ok, status: st };
}

// ===== Отправка файла игры =====
async function sendGameFile(chatId) {
  const file = getGameFile();
  if (!file) {
    return sendMessage(chatId, 'Файл игры ещё не загружен администратором. Загляни позже.');
  }
  // отправляем архив игры
  await sendDocument(chatId, file);
  // простая инструкция прямо в сообщении — куда зайти, чтобы сыграть
  return sendMessage(chatId,
    '🎮 Готово! Вот что делать:\n\n' +
    '1. Распакуй архив «Coin game.zip» на компьютере.\n' +
    '2. Запусти сервер: `node server.js`\n' +
    '3. Чтобы сыграть — открой в браузере:\n' +
    '   • на этом же компьютере: `http://localhost:3000`\n' +
    '   • на телефоне (с той же сети Wi-Fi): `http://IP_компьютера:3000`\n\n' +
    'Адрес IP_компьютера узнай командой `ipconfig` (строка IPv4).\n\n' +
    'Удачной игры! 🎮');
}

function sendDocument(chatId, filePath) {
  // sendDocument принимает multipart/form-data. Реализуем простое multipart.
  const boundary = '----multitool' + Date.now();
  const fileName = path.basename(filePath);
  const fileBuf = fs.readFileSync(filePath);
  const CRLF = '\r\n';

  const preamble = Buffer.from(
    `--${boundary}${CRLF}` +
    `Content-Disposition: form-data; name="chat_id"${CRLF}${CRLF}` +
    `${chatId}${CRLF}` +
    `--${boundary}${CRLF}` +
    `Content-Disposition: form-data; name="document"; filename="${fileName}"${CRLF}` +
    `Content-Type: application/octet-stream${CRLF}${CRLF}`
  );
  const postamble = Buffer.from(`${CRLF}--${boundary}--${CRLF}`);

  const body = Buffer.concat([preamble, fileBuf, postamble]);

  return new Promise((resolve) => {
    const u = new URL(`${API}/sendDocument`);
    const req = https.request({
      hostname: u.hostname,
      path: u.pathname,
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': body.length
      }
    }, (res) => {
      let raw = '';
      res.on('data', (c) => (raw += c));
      res.on('end', () => { try { resolve(JSON.parse(raw)); } catch (e) { resolve({ ok: false }); } });
    });
    req.on('error', () => resolve({ ok: false }));
    req.write(body);
    req.end();
  });
}

// ===== Скачивание файла, присланного в бота (по file_id) =====
async function getFile(file_id) {
  // узнаём путь файла
  const info = await callApi('getFile', { file_id });
  if (!info.ok || !info.result) return null;
  const filePath = info.result.file_path;
  // скачиваем: https://api.telegram.org/file/bot<TOKEN>/<file_path>
  return new Promise((resolve) => {
    const u = new URL(`https://api.telegram.org/file/bot${BOT_TOKEN}/${filePath}`);
    const req = https.request({ hostname: u.hostname, path: u.pathname + u.search, method: 'GET' }, (res) => {
      if (res.statusCode !== 200) return resolve(null);
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    });
    req.on('error', () => resolve(null));
    req.end();
  });
}

// сохраняет загруженный файл как "файл игры"
async function saveUploadedGame(chatId, file) {
  const buf = await getFile(file.file_id);
  if (!buf) return sendMessage(chatId, 'Не удалось скачать файл. Попробуй ещё раз.');

  const name = (file.file_name || 'game').toLowerCase();
  const isZip = name.endsWith('.zip');
  const target = path.join(FILES_DIR, isZip ? GAME_ZIP_NAME : GAME_HTML_NAME);
  if (!fs.existsSync(FILES_DIR)) fs.mkdirSync(FILES_DIR, { recursive: true });
  fs.writeFileSync(target, buf);

  await sendMessage(chatId, `✅ Файл игры обновлён: ${path.basename(target)} (${buf.length} байт).\nТеперь он будет отправляться игрокам после проверки подписки.`);
  return target;
}

function inlineKeyboard(rows) {
  return JSON.stringify({ inline_keyboard: rows, resize_keyboard: true });
}

// ===== Обработка команд и кнопок =====
async function handleUpdate(u) {
  const msg = u.message || (u.callback_query && u.callback_query.message);
  if (!msg) return;
  const chatId = msg.chat.id;
  console.log('[in] update', u.update_id, 'chat', chatId, 'type', u.callback_query ? 'callback' : 'message', 'text', (msg.text || '').slice(0, 30));

  // обрабатываем callback-кнопку
  if (u.callback_query) {
    const cb = u.callback_query;
    const cid = cb.message.chat.id;
    const data = cb.data;
    console.log('[in] callback', data);
    const ack = await callApi('answerCallbackQuery', { callback_query_id: cb.id });
    console.log('[out] answerCallbackQuery ok=', ack && ack.ok);

    if (data === 'check_sub') {
      const check = await isSubscribed(cid);
      console.log('[out] isSubscribed:', JSON.stringify(check));
      if (check.subscribed) {
        const m1 = await sendMessage(cid, `Вы подписаны ✅\nИгра открыта — жми на кнопку ниже! 🎮`);
        console.log('[out] sendMessage ok=', m1 && m1.ok);
        // всем — кнопка игры (Mini App)
        await sendMessage(cid, 'Открыть игру:', {
          reply_markup: inlineKeyboard([
            [{ text: '🎮 Открыть игру', url: GAME_WEB_APP_URL }]
          ])
        });
        // админам — дополнительно кнопка админ-панели
        if (isAdmin(cid)) {
          await sendMessage(cid, 'Ты администратор — вот твоя панель управления:', {
            reply_markup: inlineKeyboard([
              [{ text: '🛠 Админ-панель', url: ADMIN_WEB_APP_URL }]
            ])
          });
        }
      } else {
        const m3 = await callApi('sendMessage', {
          chat_id: cid,
          text: 'Вы ещё не подписались. Сначала нажмите кнопку ниже и подпишитесь на канал, затем вернитесь и нажмите «Проверить подписку».',
          reply_markup: inlineKeyboard([
            [{ text: '📢 Подписаться', url: CHANNEL }],
            [{ text: 'Проверить подписку', callback_data: 'check_sub' }]
          ])
        });
      }
    }
    return;
  }

  // обработка команд
  const text = (msg.text || '').trim();
  if (text === '/start' || text.startsWith('/start')) {
    const f = getGameFile();
    const haveFile = !!f;
    const body =
      '👋 **Coin game**\n\n' +
      '📢 Подпишись на канал, нажав кнопку ниже.\n' +
      'Затем нажми «Проверить подписку».\n\n' +
      (haveFile
        ? '✅ После проверки получишь файл игры! 📦'
        : '⚠️ Файл ещё не загружен админом. Скажи об этом администратору.');
    // одно сообщение с текстом + кнопкой-ссылкой + кнопкой проверки
    await sendMessage(chatId, body, {
      parse_mode: 'Markdown',
      reply_markup: inlineKeyboard([
        [{ text: '📢 Подпишись на канал', url: CHANNEL }],
        [{ text: 'Проверить подписку', callback_data: 'check_sub' }]
      ])
    });
    return;
  }

  if (text === '/info') {
    const f = getGameFile();
    const fileMsg = f ? path.basename(f) : 'файл игры ещё не загружен';
    const a = isAdmin(chatId);
    await sendMessage(chatId,
      'ℹ️ Бот выдачи файла Coin game.\n\n' +
      `Файл сейчас: ${fileMsg}\n` +
      `Ты админ(можешь загружать файл): ${a ? 'да' : 'нет'}\n\n` +
      (ADMIN_IDS.length
        ? 'Загружать файл может ' + ((ADMIN_IDS.length===1) ? 'только админ' : ': ' + ADMIN_IDS.join(', '))
        : 'Загружать файл может любой (ADMIN_IDS пуст)' ));
    return;
  }

  if (text === '/upload') {
    const f = getGameFile();
    if (!isAdmin(chatId)) return sendMessage(chatId, 'Загрузка файла доступна только администратору.');
    await sendMessage(chatId,
      '📤 Пришли файлом игру (index.html или .zip).\n\n' +
      'Бот сохранит его как файл игры и будет выдавать его пользователям после подписки.\n' +
      'Текущий файл: ' + (f ? path.basename(f) : 'нет'));
    return;
  }

  if (text === '/game') {
    const f = getGameFile();
    if (!f) return sendMessage(chatId, 'Файл игры ещё не загружен.');
    // прямая выдача по команде (без проверки подписки) — только админу, для теста
    return sendDocument(chatId, f);
  }

  // загрузка файла от админа
  if (msg.document) {
    if (!isAdmin(chatId)) return sendMessage(chatId, 'Загрузка файла доступна только администратору.');
    await saveUploadedGame(chatId, msg.document);
    return;
  }
}

// ===== Главный цикл (long polling) =====
function poll() {
  callApi('getUpdates', { offset, timeout: 30, allowed_updates: ['message', 'callback_query'] })
    .then((res) => {
      if (res.ok && res.result && res.result.length) {
        for (const u of res.result) {
          handleUpdate(u).catch((e) => console.error('handle error', e.message));
          offset = u.update_id + 1;
        }
      }
      setTimeout(poll, 500);
    })
    .catch((err) => {
      console.error('poll error', err.message);
      setTimeout(poll, 3000);
    });
}

// ===== Старт =====
async function start() {
  const wh = await callApi('deleteWebhook', { drop_pending_updates: false });
  console.log('[start] deleteWebhook ok=', !!wh.ok);
  poll();
}

// ===== Минимальный HTTP-сервер для Render (health check) =====
const http = require('http');
const PORT = process.env.PORT || 10000;
const httpServer = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('bot-ok');
});
httpServer.listen(PORT, () => {
  console.log('[start] HTTP health-check слушает порт', PORT);
  console.log('🤖 Bot запущен (Render). Канал подписки:', CHANNEL);
  start();
});