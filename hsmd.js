const config = require("./hello.js");

const {
    default: makeWASocket,
    useMultiFileAuthState,
    downloadContentFromMessage,
    emitGroupParticipantsUpdate,
    emitGroupUpdate,
    generateWAMessageContent,
    generateWAMessage,
    makeInMemoryStore,
    prepareWAMessageMedia,
    generateWAMessageFromContent,
    MediaType,
    areJidsSameUser,
    WAMessageStatus,
    downloadAndSaveMediaMessage,
    AuthenticationState,
    GroupMetadata,
    initInMemoryKeyStore,
    getContentType,
    MiscMessageGenerationOptions,
    useSingleFileAuthState,
    BufferJSON,
    WAMessageProto,
    MessageOptions,
    WAFlag,
    WANode,
    WAMetric,
    ChatModification,
    MessageTypeProto,
    WALocationMessage,
    ReconnectMode,
    WAContextInfo,
    proto,
    WAGroupMetadata,
    ProxyAgent,
    waChatKey,
    MimetypeMap,
    MediaPathMap,
    WAContactMessage,
    WAContactsArrayMessage,
    WAGroupInviteMessage,
    WATextMessage,
    WAMessageContent,
    WAMessage,
    BaileysError,
    WA_MESSAGE_STATUS_TYPE,
    MediaConnInfo,
    URL_REGEX,
    WAUrlInfo,
    WA_DEFAULT_EPHEMERAL,
    WAMediaUpload,
    jidDecode,
    mentionedJid,
    processTime,
    Browser,
    MessageType,
    Presence,
    WA_MESSAGE_STUB_TYPES,
    Mimetype,
    relayWAMessage,
    Browsers,
    GroupSettingChange,
    DisconnectReason,
    WASocket,
    getStream,
    WAProto,
    isBaileys,
    AnyMessageContent,
    fetchLatestBaileysVersion,
    templateMessage,
    InteractiveMessage,
    Header,
} = require('@whiskeysockets/baileys');
const fs = require("fs");
const P = require("pino");
const crypto = require("crypto");
const path = require("path");
const sessions = new Map();
const readline = require('readline');
const fetch = require("node-fetch");
const chalk = require("chalk");
const TelegramBot = require("node-telegram-bot-api");
const axios = require("axios");
const moment = require('moment');

const BOT_TOKEN = config.BOT_TOKEN;
const DEVELOPER_ID = config.DEVELOPER_ID || [];
const REQUIRED_CHANNEL_ID = config.REQUIRED_CHANNEL_ID;
const REQUIRED_CHANNEL_LINK = config.REQUIRED_CHANNEL_LINK;

const GITHUB_TOKEN = config.GITHUB_TOKEN;
const GITHUB_OWNER = config.GITHUB_OWNER;
const GITHUB_REPO = config.GITHUB_REPO;
const GITHUB_BRANCH = config.GITHUB_BRANCH || "main";
const GITHUB_API = "https://api.github.com";

const DATABASE_DIR = "./database";
const PREMIUM_FILE = path.join(DATABASE_DIR, "premium.json");
const ADMIN_FILE = path.join(DATABASE_DIR, "admin.json");
const COOLDOWN_FILE = path.join(DATABASE_DIR, "cooldown.json");
const MURBUG_FILE = path.join(DATABASE_DIR, "murbugGC.json");
const GROUP_SETTINGS_FILE = path.join(DATABASE_DIR, "group_settings.json");
const BANNED_FILE = path.join(DATABASE_DIR, "banned.json");
const WARN_FILE = path.join(DATABASE_DIR, "warn.json");
const LISTUSER_FILE = path.join(DATABASE_DIR, "listuser.json");

function ensureDirExists(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function ensureFileExists(filePath, defaultData = []) {
  ensureDirExists(path.dirname(filePath));
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, JSON.stringify(defaultData, null, 2));
  }
}

ensureDirExists(DATABASE_DIR);
ensureFileExists(PREMIUM_FILE, []);
ensureFileExists(ADMIN_FILE, []);
ensureFileExists(COOLDOWN_FILE, { time: 5 * 60 * 1000, users: {} });
ensureFileExists(MURBUG_FILE, []);
ensureFileExists(GROUP_SETTINGS_FILE, {});
ensureFileExists(BANNED_FILE, []);
ensureFileExists(WARN_FILE, {});
ensureFileExists(LISTUSER_FILE, []);

async function githubRequest(method, endpoint, body = null) {
  const url = `${GITHUB_API}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${endpoint}`;
  const headers = {
    "Authorization": `token ${GITHUB_TOKEN}`,
    "Accept": "application/vnd.github.v3+json",
    "User-Agent": "HeysakaBot"
  };
  try {
    const options = { method, headers };
    if (body) options.body = JSON.stringify(body);
    const res = await fetch(url, options);
    const data = await res.json();
    return { status: res.status, data };
  } catch (e) {
    console.error("GitHub API error:", e.message);
    return { status: 500, data: null };
  }
}

async function getGithubFile(filename) {
  const { status, data } = await githubRequest("GET", `database/${filename}?ref=${GITHUB_BRANCH}`);
  if (status === 200 && data.content) {
    return Buffer.from(data.content, 'base64').toString('utf-8');
  }
  return null;
}

async function saveGithubFile(filename, content, commitMessage = "update database") {
  const getRes = await githubRequest("GET", `database/${filename}?ref=${GITHUB_BRANCH}`);
  let sha = null;
  if (getRes.status === 200 && getRes.data.sha) {
    sha = getRes.data.sha;
  }
  const body = {
    message: commitMessage,
    content: Buffer.from(content).toString('base64'),
    branch: GITHUB_BRANCH
  };
  if (sha) body.sha = sha;
  const { status, data } = await githubRequest("PUT", `database/${filename}`, body);
  if (status === 200 || status === 201) {
    console.log(`GitHub: ${filename} saved`);
    return true;
  } else {
    console.error(`GitHub: failed to save ${filename}`, data);
    return false;
  }
}

async function syncFromGithub() {
  const files = [
    { local: PREMIUM_FILE, remote: "premium.json", default: [] },
    { local: ADMIN_FILE, remote: "admin.json", default: [] },
    { local: COOLDOWN_FILE, remote: "cooldown.json", default: { time: 5 * 60 * 1000, users: {} } },
    { local: MURBUG_FILE, remote: "murbugGC.json", default: [] },
    { local: GROUP_SETTINGS_FILE, remote: "group_settings.json", default: {} },
    { local: BANNED_FILE, remote: "banned.json", default: [] },
    { local: WARN_FILE, remote: "warn.json", default: {} },
    { local: LISTUSER_FILE, remote: "listuser.json", default: [] },
  ];
  for (const f of files) {
    const content = await getGithubFile(f.remote);
    if (content !== null) {
      fs.writeFileSync(f.local, content);
      console.log(`Synced ${f.remote} from GitHub`);
    } else {
      if (!fs.existsSync(f.local)) {
        fs.writeFileSync(f.local, JSON.stringify(f.default, null, 2));
      }
      await saveGithubFile(f.remote, fs.readFileSync(f.local, 'utf-8'), `init ${f.remote}`);
      console.log(`Initialized ${f.remote} on GitHub`);
    }
  }
}

let bot;

const RICH_CSS = `<style>
  table { width: 100%; border-collapse: collapse; margin: 10px 0; }
  th, td { text-align: center !important; padding: 8px; border: 1px solid #555; }
  th { background-color: #2b2b2b; color: #fff; font-weight: bold; }
</style>`;

async function sendRichMenu(chatId, html, replyToMessageId = null) {
  const token = bot.token;
  const payload = {
    chat_id: chatId,
    rich_message: { html: RICH_CSS + html }
  };
  if (replyToMessageId) payload.reply_parameters = { message_id: replyToMessageId };
  try {
    await axios.post(`https://api.telegram.org/bot${token}/sendRichMessage`, payload);
  } catch (e) {
    console.error("sendRichMenu error:", e?.response?.data || e.message);
  }
}

async function editRichMenu(chatId, messageId, html) {
  const token = bot.token;
  try {
    await axios.post(`https://api.telegram.org/bot${token}/editMessageText`, {
      chat_id: chatId,
      message_id: messageId,
      rich_message: { html: RICH_CSS + html }
    });
  } catch (e) {
    try { await bot.deleteMessage(chatId, messageId); } catch (_) {}
    await sendRichMenu(chatId, html);
  }
}

let premiumUsers = JSON.parse(fs.readFileSync(PREMIUM_FILE));
let adminUsers = JSON.parse(fs.readFileSync(ADMIN_FILE));
let groupSettings = JSON.parse(fs.readFileSync(GROUP_SETTINGS_FILE));
let bannedUsers = JSON.parse(fs.readFileSync(BANNED_FILE));
let warnData = JSON.parse(fs.readFileSync(WARN_FILE));
let listUser = JSON.parse(fs.readFileSync(LISTUSER_FILE));

function savePremiumUsers() {
    fs.writeFileSync(PREMIUM_FILE, JSON.stringify(premiumUsers, null, 2));
    saveGithubFile("premium.json", JSON.stringify(premiumUsers, null, 2), "update premium");
}

function saveAdminUsers() {
    fs.writeFileSync(ADMIN_FILE, JSON.stringify(adminUsers, null, 2));
    saveGithubFile("admin.json", JSON.stringify(adminUsers, null, 2), "update admin");
}

function saveGroupSettings() {
    fs.writeFileSync(GROUP_SETTINGS_FILE, JSON.stringify(groupSettings, null, 2));
    saveGithubFile("group_settings.json", JSON.stringify(groupSettings, null, 2), "update group settings");
}

function saveBanned() {
    fs.writeFileSync(BANNED_FILE, JSON.stringify(bannedUsers, null, 2));
    saveGithubFile("banned.json", JSON.stringify(bannedUsers, null, 2), "update banned");
}

function saveWarn() {
    fs.writeFileSync(WARN_FILE, JSON.stringify(warnData, null, 2));
    saveGithubFile("warn.json", JSON.stringify(warnData, null, 2), "update warn");
}

function saveListUser() {
    fs.writeFileSync(LISTUSER_FILE, JSON.stringify(listUser, null, 2));
    saveGithubFile("listuser.json", JSON.stringify(listUser, null, 2), "update listuser");
}

function addUserToDb(userId) {
    if (!listUser.includes(userId.toString())) {
        listUser.push(userId.toString());
        saveListUser();
    }
}

function watchFile(filePath, updateCallback) {
    fs.watch(filePath, (eventType) => {
        if (eventType === 'change') {
            try {
                const updatedData = JSON.parse(fs.readFileSync(filePath));
                updateCallback(updatedData);
                console.log(`File ${filePath} updated successfully.`);
            } catch (error) {
                console.error(`Error updating ${filePath}:`, error.message);
            }
        }
    });
}

watchFile(PREMIUM_FILE, (data) => (premiumUsers = data));
watchFile(ADMIN_FILE, (data) => (adminUsers = data));
watchFile(GROUP_SETTINGS_FILE, (data) => (groupSettings = data));
watchFile(BANNED_FILE, (data) => (bannedUsers = data));
watchFile(WARN_FILE, (data) => (warnData = data));
watchFile(LISTUSER_FILE, (data) => (listUser = data));

async function fetchAndValidateToken() {
  try {
    bot = new TelegramBot(BOT_TOKEN, { polling: true });
    bot.on('polling_error', (err) => {
      console.log('[POLLING ERROR]', err.message);
    });

    console.log(chalk.green(`heysaka - MD online`));
    await syncFromGithub();
    startBot();
    initializeBot();
  } catch (error) {
    console.error("Error:", error);
    process.exit(1);
  }
}

function startBot() {
  console.log(
    chalk.yellow(`heysaka multi device`)
  );
}

let sock;

function saveActiveSessions(botNumber) {
  try {
    let sessionsList = [];
    if (fs.existsSync(SESSIONS_FILE)) {
      sessionsList = JSON.parse(fs.readFileSync(SESSIONS_FILE));
    }
    if (!sessionsList.includes(botNumber)) {
      sessionsList.push(botNumber);
    }
    fs.writeFileSync(SESSIONS_FILE, JSON.stringify(sessionsList, null, 2));
  } catch (error) {
    console.error("Error saving session:", error);
  }
}

async function initializeWhatsAppConnections() {
  try {
    if (fs.existsSync(SESSIONS_FILE)) {
      const activeNumbers = JSON.parse(fs.readFileSync(SESSIONS_FILE));
      console.log(`Found ${activeNumbers.length} active WhatsApp sessions`);

      for (const botNumber of activeNumbers) {
        console.log(`Attempting to connect WhatsApp: ${botNumber}`);
        const sessionDir = createSessionDir(botNumber);
        const { state, saveCreds } = await useMultiFileAuthState(sessionDir);

        sock = makeWASocket({
          auth: state,
          printQRInTerminal: true,
          logger: P({ level: "silent" }),
          defaultQueryTimeoutMs: undefined,
        });

        await new Promise((resolve, reject) => {
          sock.ev.on("connection.update", async (update) => {
            const { connection, lastDisconnect } = update;
            if (connection === "open") {
              console.log(`Bot ${botNumber} connected!`);
              sessions.set(botNumber, sock);
              resolve();
            } else if (connection === "close") {
              const shouldReconnect =
                lastDisconnect?.error?.output?.statusCode !==
                DisconnectReason.loggedOut;
              if (shouldReconnect) {
                console.log(`Attempting to reconnect bot ${botNumber}...`);
                await initializeWhatsAppConnections();
              } else {
                reject(new Error("Connection closed"));
              }
            }
          });

          sock.ev.on("creds.update", saveCreds);
        });
      }
    }
  } catch (error) {
    console.error("Error initializing WhatsApp connections:", error);
  }
}

function createSessionDir(botNumber) {
  const deviceDir = path.join(SESSIONS_DIR, `device${botNumber}`);
  if (!fs.existsSync(deviceDir)) {
    fs.mkdirSync(deviceDir, { recursive: true });
  }
  return deviceDir;
}

async function connectToWhatsApp(botNumber, chatId) {
  let statusMessageId = null;
  try {
    const res = await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendRichMessage`, {
      chat_id: chatId,
      rich_message: {
        html: RICH_CSS + `<h3>WhatsApp Connection</h3>
<table border="2">
<tr><th>info</th><th>detail</th></tr>
<tr><td>number</td><td>${botNumber}</td></tr>
<tr><td>status</td><td>initializing...</td></tr>
</table>`
      }
    });
    statusMessageId = res?.data?.result?.message_id;
  } catch (e) {
    console.error("init status error:", e?.message);
  }

  const sessionDir = createSessionDir(botNumber);
  const { state, saveCreds } = await useMultiFileAuthState(sessionDir);

  sock = makeWASocket({
    auth: state,
    printQRInTerminal: false,
    logger: P({ level: "silent" }),
    defaultQueryTimeoutMs: undefined,
  });

  const updateStatus = async (title, rows) => {
    if (!statusMessageId) return;
    let rowsHtml = "";
    for (const [k, v] of rows) rowsHtml += `<tr><td>${k}</td><td>${v}</td></tr>\n`;
    try {
      await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/editMessageText`, {
        chat_id: chatId,
        message_id: statusMessageId,
        rich_message: {
          html: RICH_CSS + `<h3>${title}</h3>
<table border="2">
<tr><th>info</th><th>detail</th></tr>
${rowsHtml}
</table>`
        }
      });
    } catch (e) {
      console.error("edit status error:", e?.message);
    }
  };

  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect } = update;

    if (connection === "close") {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      if (statusCode && statusCode >= 500 && statusCode < 600) {
        await updateStatus("WhatsApp Connection", [
          ["number", botNumber],
          ["status", "reconnecting..."]
        ]);
        await connectToWhatsApp(botNumber, chatId);
      } else {
        await updateStatus("WhatsApp Connection", [
          ["number", botNumber],
          ["status", "connection failed"]
        ]);
        try {
          fs.rmSync(sessionDir, { recursive: true, force: true });
        } catch (error) {
          console.error("Error deleting session:", error);
        }
      }
    } else if (connection === "open") {
      sessions.set(botNumber, sock);
      saveActiveSessions(botNumber);
      await updateStatus("WhatsApp Connection", [
        ["number", botNumber],
        ["status", "successfully connected"]
      ]);
      
      sock.ev.on('group-participants.update', async (update) => {
        try {
          const { id, participants, action } = update;
          const settings = groupSettings[id] || {};
          if (action === 'add' && settings.welcome) {
            for (const participant of participants) {
              let msg = settings.welcomeMsg || 'welcome {user} to {group}!';
              try {
                const meta = await sock.groupMetadata(id);
                msg = msg.replace(/{user}/g, `@${participant.split('@')[0]}`).replace(/{group}/g, meta.subject);
              } catch (_) {
                msg = msg.replace(/{user}/g, `@${participant.split('@')[0]}`);
              }
              await sock.sendMessage(id, { text: msg, mentions: [participant] });
            }
          } else if (action === 'remove' && settings.welcome) {
            for (const participant of participants) {
              let msg = settings.goodbyeMsg || 'goodbye {user} from {group}!';
              try {
                const meta = await sock.groupMetadata(id);
                msg = msg.replace(/{user}/g, `@${participant.split('@')[0]}`).replace(/{group}/g, meta.subject);
              } catch (_) {
                msg = msg.replace(/{user}/g, `@${participant.split('@')[0]}`);
              }
              await sock.sendMessage(id, { text: msg, mentions: [participant] });
            }
          }
        } catch (e) {
          console.error("group-participants update error:", e.message);
        }
      });

    } else if (connection === "connecting") {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      try {
        if (!fs.existsSync(`${sessionDir}/creds.json`)) {
          const code = await sock.requestPairingCode(botNumber, "SAKA4444");
          const formattedCode = code.match(/.{1,4}/g)?.join("-") || code;
          await updateStatus("WhatsApp Pairing", [
            ["number", botNumber],
            ["pairing code", `<b>${formattedCode}</b>`],
            ["status", "enter code in whatsapp"]
          ]);
        }
      } catch (error) {
        console.error("Error requesting pairing code:", error);
        await updateStatus("WhatsApp Connection", [
          ["number", botNumber],
          ["status", "error"],
          ["message", error.message]
        ]);
      }
    }
  });

  sock.ev.on("creds.update", saveCreds);
  return sock;
}

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function formatRuntime(seconds) {
  return `${seconds} Seconds`;
}

const startTime = Math.floor(Date.now() / 1000);

function getBotRuntime() {
  const now = Math.floor(Date.now() / 1000);
  return formatRuntime(now - startTime);
}

function getCurrentDate() {
  const now = new Date();
  const options = { weekday: "long", year: "numeric", month: "long", day: "numeric" };
  return now.toLocaleDateString("en-US", options); 
}

let cooldownData = fs.existsSync(COOLDOWN_FILE) ? JSON.parse(fs.readFileSync(COOLDOWN_FILE)) : { time: 5 * 60 * 1000, users: {} };

function saveCooldown() {
    fs.writeFileSync(COOLDOWN_FILE, JSON.stringify(cooldownData, null, 2));
    saveGithubFile("cooldown.json", JSON.stringify(cooldownData, null, 2), "update cooldown");
}

function checkCooldown(userId) {
    if (cooldownData.users[userId]) {
        const remainingTime = cooldownData.time - (Date.now() - cooldownData.users[userId]);
        if (remainingTime > 0) {
            return Math.ceil(remainingTime / 1000); 
        }
    }
    cooldownData.users[userId] = Date.now();
    saveCooldown();
    setTimeout(() => {
        delete cooldownData.users[userId];
        saveCooldown();
    }, cooldownData.time);
    return 0;
}

function setCooldown(timeString) {
    const match = timeString.match(/(\d+)([smh])/);
    if (!match) return "Invalid format! Use example: /settimer 5m";

    let [_, value, unit] = match;
    value = parseInt(value);

    if (unit === "s") cooldownData.time = value * 1000;
    else if (unit === "m") cooldownData.time = value * 60 * 1000;
    else if (unit === "h") cooldownData.time = value * 60 * 60 * 1000;

    saveCooldown();
    return `Cooldown set to ${value}${unit}`;
}

function getPremiumStatus(userId) {
  const user = premiumUsers.find(user => user.id === userId);
  
  if (user && new Date(user.expiresAt) > new Date()) {
    const now = new Date();
    const expires = new Date(user.expiresAt);
    const diffMs = expires - now;

    const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diffMs / (1000 * 60 * 60)) % 24);
    const minutes = Math.floor((diffMs / (1000 * 60)) % 60);
    const seconds = Math.floor((diffMs / 1000) % 60);

    return `Active - ${days}d ${hours}h ${minutes}m ${seconds}s`;
  } else {
    return "No Active";
  }
}

async function heysakabug1(target) {
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 1500));
  }
}

async function heysakabug2(target) {
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 1500));
  }
}

async function heysakabug3(target) {
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 1500));
  }
}

function isDeveloper(userId) {
  return DEVELOPER_ID.includes(userId.toString());
}

let murbugGC = [];

function saveMurbugGC() {
  try {
    if (!Array.isArray(murbugGC)) murbugGC = [];
    fs.writeFileSync(MURBUG_FILE, JSON.stringify(murbugGC, null, 2));
    saveGithubFile("murbugGC.json", JSON.stringify(murbugGC, null, 2), "update murbugGC");
  } catch (e) {
    console.error("Failed to save murbugGC:", e.message);
  }
}

function loadMurbugGC() {
  try {
    if (fs.existsSync(MURBUG_FILE)) {
      const data = JSON.parse(fs.readFileSync(MURBUG_FILE, 'utf8'));
      murbugGC = Array.isArray(data) ? data : [];
    } else {
      murbugGC = [];
    }
  } catch (e) {
    murbugGC = [];
  }
}
loadMurbugGC();

async function checkJoin(chatId, userId) {
    try {
        const chatMember = await bot.getChatMember(REQUIRED_CHANNEL_ID, userId);
        const validStatus = ['creator', 'administrator', 'member'];
        if (validStatus.includes(chatMember.status)) {
            return true;
        }
    } catch (e) {
        console.error("Check join error:", e.message);
    }

    const html = `<h3>Join Channel Required</h3>
<p>Sorry, you must join our channel first to use this bot.</p>

<blockquote><b>Access Status:</b></blockquote>
<ul>
  <li>Join Channel: Not Yet</li>
</ul>

<p>Please click the button below to join, then click Check Again.</p>

<tg-button-row>
  <tg-button type="url" url="${REQUIRED_CHANNEL_LINK}" style="primary">Join Channel</tg-button>
</tg-button-row>
<tg-button-row>
  <tg-button type="callback_data" data="check_join" style="primary">Check Again</tg-button>
</tg-button-row>`;
    await sendRichMenu(chatId, html);
    return false;
}

function initializeBot() {

  bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const username = msg.from.username ? `@${msg.from.username}` : "No username";

    addUserToDb(userId);

    if (!isDeveloper(userId) && !adminUsers.includes(userId)) {
        const isJoined = await checkJoin(chatId, userId);
        if (!isJoined) return;
    }

    const senderId = msg.from.id;
    const premiumStatus = getPremiumStatus(senderId);
    const omak = getCurrentDate();
    const Cihuyy = getBotRuntime();

    const html = `<tg-collage>
  <img src="https://ganga--link--ghhzdp9sv8hk.code.run/i/uxbiqmf6.jpg"/>
  <figcaption>create by heysaka</figcaption>
</tg-collage>

<h3>Hello, ${username.toLowerCase()}</h3>
<p>This is the Heysaka MD menu & features. Please choose the menu you want through the buttons below.</p>

<blockquote><b>Information:</b></blockquote>
<ul>
  <li>Developer 1: @heysaka</li>
  <li>Bot Name: Heysaka MD Bot</li>
</ul>

<blockquote><b>Time & Date:</b></blockquote>
<ul>
  <li>Runtime: ${Cihuyy}</li>
  <li>Date: ${omak}</li>
  <li>Status: ${premiumStatus}</li>
</ul>

<tg-button-row>
  <tg-button type="callback_data" data="ownmenu" style="primary">Owner Menu</tg-button>
  <tg-button type="callback_data" data="attackmenu" style="primary">Bug Menu</tg-button>
  <tg-button type="callback_data" data="groupmenu" style="primary">Group Menu</tg-button>
</tg-button-row>
<tg-button-row>
  <tg-button type="callback_data" data="thanksto" style="primary">Thanks To</tg-button>
</tg-button-row>
<tg-button-row>
  <tg-button type="url" url="https://t.me/diaryheysaka" style="primary">Telegram Channel</tg-button>
</tg-button-row>`;

    await sendRichMenu(chatId, html);
  });

  bot.on("callback_query", async (query) => {
    try {
      const chatId = query.message.chat.id;
      const messageId = query.message.message_id;
      const username = query.from.username ? `@${query.from.username}` : "No username";
      const senderId = query.from.id;
      const Cihuyy = getBotRuntime();
      const premiumStatus = getPremiumStatus(query.from.id);
      const omak = getCurrentDate();

      addUserToDb(senderId);

      let html = "";

      if (query.data === "check_join") {
        if (!isDeveloper(senderId) && !adminUsers.includes(senderId)) {
            const isJoined = await checkJoin(chatId, senderId);
            if (!isJoined) {
                return bot.answerCallbackQuery(query.id, { text: "you have not joined the channel!", show_alert: true }).catch(() => {});
            }
        }
        
        html = `<h3>Successfully Joined</h3>
<table border="2">
<tr><th>info</th><th>detail</th></tr>
<tr><td>status</td><td>success</td></tr>
<tr><td>next</td><td>please type /start</td></tr>
</table>`;
        
        await editRichMenu(chatId, messageId, html);
        return bot.answerCallbackQuery(query.id, { text: "verification successful, please type /start", show_alert: true }).catch(() => {});
      }

      if (query.data === "attackmenu") {
        html = `<tg-collage>
  <img src="https://ganga--link--ghhzdp9sv8hk.code.run/i/uxbiqmf6.jpg"/>
  <figcaption>create by heysaka</figcaption>
</tg-collage>

<h3>Bug List - Heysaka</h3>

<blockquote><b>Access Status:</b></blockquote>
<ul>
  <li>Premium: ${premiumStatus}</li>
</ul>

<blockquote><b>Android Bugs:</b></blockquote>
<ul>
  <li><code>/bugdelay 62xxx</code> - work</li>
  <li><code>/bugcrash 62xxx</code> - work</li>
  <li><code>/bugfreeze 62xxx</code> - work</li>
</ul>

<blockquote><b>Group Bugs:</b></blockquote>
<ul>
  <li><code>/buggroup (link)</code> - work</li>
</ul>

<blockquote>Use the features as wisely as possible without harming others!</blockquote>

<tg-button-row>
  <tg-button type="callback_data" data="back" style="danger">Back To Menu</tg-button>
</tg-button-row>`;
      }

      if (query.data === "groupmenu") {
        html = `<tg-collage>
  <img src="https://ganga--link--ghhzdp9sv8hk.code.run/i/uxbiqmf6.jpg"/>
  <figcaption>create by heysaka</figcaption>
</tg-collage>

<h3>Group Menu - Heysaka</h3>

<blockquote><b>Moderation (Reply or Username):</b></blockquote>
<ul>
  <li><code>/kick @username</code> - kick member</li>
  <li><code>/ban @username</code> - ban member</li>
  <li><code>/unban @username</code> - unban member</li>
  <li><code>/mute @username</code> - mute member</li>
  <li><code>/unmute @username</code> - unmute member</li>
  <li><code>/warn @username</code> - warn member</li>
  <li><code>/unwarn @username</code> - unwarn member</li>
</ul>

<blockquote><b>Welcome/Goodbye:</b></blockquote>
<ul>
  <li><code>/welcome on/off</code> - toggle welcome</li>
  <li><code>/setwelcome (text)</code> - set welcome message</li>
  <li><code>/setgoodbye (text)</code> - set goodbye message</li>
</ul>

<tg-button-row>
  <tg-button type="callback_data" data="back" style="danger">Back To Menu</tg-button>
</tg-button-row>`;
      }

      if (query.data === "ownmenu") {
        html = `<tg-collage>
  <img src="https://ganga--link--ghhzdp9sv8hk.code.run/i/uxbiqmf6.jpg"/>
  <figcaption>create by heysaka</figcaption>
</tg-collage>

<h3>Owner Menu - Heysaka</h3>

<blockquote><b>Owner Menu:</b></blockquote>
<ul>
  <li><code>/addowner (id)</code> - add owner</li>
  <li><code>/delowner (id)</code> - remove owner</li>
</ul>

<blockquote><b>Premium Menu:</b></blockquote>
<ul>
  <li><code>/addprem (id) (duration)</code> - add premium</li>
  <li><code>/delprem (id)</code> - remove premium</li>
  <li><code>/listprem</code> - view premium list</li>
</ul>

<blockquote><b>Murbugs Menu:</b></blockquote>
<ul>
  <li><code>/modemurbuggb on/off</code> - toggle murbug mode</li>
</ul>

<blockquote><b>Settings Menu:</b></blockquote>
<ul>
  <li><code>/addsender (62xxx)</code> - add sender</li>
  <li><code>/setjeda (time)</code> - set delay (example: 5m)</li>
  <li><code>/info</code> - check user info</li>
  <li><code>/broadcast (reply/text)</code> - broadcast to all users</li>
</ul>

<tg-button-row>
  <tg-button type="callback_data" data="back" style="danger">Back To Menu</tg-button>
</tg-button-row>`;
      }

      if (query.data === "thanksto") {
        html = `<tg-collage>
  <img src="https://ganga--link--ghhzdp9sv8hk.code.run/i/uxbiqmf6.jpg"/>
  <figcaption>create by heysaka</figcaption>
</tg-collage>

<h3>Thanks To</h3>

<blockquote><b>Credits:</b></blockquote>
<ul>
  <li>Developer: heysaka official ID</li>
  <li>Friend: Niel</li>
  <li>Thanks to: all buyer</li>
</ul>

<tg-button-row>
  <tg-button type="url" url="https://t.me/diaryheysaka" style="primary">Info Bot</tg-button>
</tg-button-row>
<tg-button-row>
  <tg-button type="url" url="https://instagram.com/@sakaurbans" style="primary">Instagram</tg-button>
  <tg-button type="url" url="https://youtube.com/@gwsaka" style="primary">YouTube</tg-button>
</tg-button-row>
<tg-button-row>
  <tg-button type="url" url="https://t.me/heysaka" style="primary">Telegram Developer</tg-button>
</tg-button-row>
<tg-button-row>
  <tg-button type="callback_data" data="back" style="danger">Back To Menu</tg-button>
</tg-button-row>`;
      }

      if (query.data === "back") {
        html = `<tg-collage>
  <img src="https://ganga--link--ghhzdp9sv8hk.code.run/i/uxbiqmf6.jpg"/>
  <figcaption>create by heysaka</figcaption>
</tg-collage>

<h3>Hello, ${username.toLowerCase()}</h3>
<p>This is the Heysaka MD menu & features. Please choose the menu you want through the buttons below.</p>

<blockquote><b>Information:</b></blockquote>
<ul>
  <li>Developer 1: @heysaka</li>
  <li>Bot Name: Heysaka MD Bot</li>
</ul>

<blockquote><b>Time & Date:</b></blockquote>
<ul>
  <li>Runtime: ${Cihuyy}</li>
  <li>Date: ${omak}</li>
  <li>Status: ${premiumStatus}</li>
</ul>

<tg-button-row>
  <tg-button type="callback_data" data="ownmenu" style="primary">Owner Menu</tg-button>
  <tg-button type="callback_data" data="attackmenu" style="primary">Bug Menu</tg-button>
  <tg-button type="callback_data" data="groupmenu" style="primary">Group Menu</tg-button>
</tg-button-row>
<tg-button-row>
  <tg-button type="callback_data" data="thanksto" style="primary">Thanks To</tg-button>
</tg-button-row>
<tg-button-row>
  <tg-button type="url" url="https://t.me/diaryheysaka" style="primary">Telegram Channel</tg-button>
</tg-button-row>`;
      }

      if (html) {
        await editRichMenu(chatId, messageId, html);
        await bot.answerCallbackQuery(query.id).catch(() => {});
      }

    } catch (error) {
      console.error("Error handling callback query:", error);
      try {
        await bot.answerCallbackQuery(query.id, { text: "an error occurred: " + error.message, show_alert: true });
      } catch (e) {}
    }
  });

  bot.onText(/\/buggroup (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const senderId = msg.from.id;
    const userId = msg.from.id;
    const target = match[1].trim();

    addUserToDb(userId);

    const inviteMatch = target.match(/(?:chat\.whatsapp\.com\/|wa\.me\/)([A-Za-z0-9_-]+)/);
    const inviteCode = inviteMatch ? inviteMatch[1] : target.replace(/[^A-Za-z0-9_-]/g, "");
    const cooldown = checkCooldown(userId);
    const omak = getCurrentDate();

    const isMurbugActive = msg.chat.type !== "private" && Array.isArray(murbugGC) && murbugGC.includes(String(chatId));
    const isPremiumUser = premiumUsers.some(user => user.id === senderId && new Date(user.expiresAt) > new Date());

    if (!isMurbugActive && !isPremiumUser && !isDeveloper(userId)) {
      const html = `<h3>Access Denied</h3>
<table border="2">
<tr><th>info</th><th>detail</th></tr>
<tr><td>status</td><td>premium access required</td></tr>
</table>`;
      return sendRichMenu(chatId, html);
    }

    if (cooldown > 0) {
      const html = `<h3>Cooldown</h3>
<table border="2">
<tr><th>info</th><th>detail</th></tr>
<tr><td>wait</td><td>Wait ${cooldown} seconds before sending another message.</td></tr>
</table>`;
      return sendRichMenu(chatId, html);
    }

    if (!inviteCode) {
      const html = `<h3>Invalid Link</h3>
<table border="2">
<tr><th>info</th><th>detail</th></tr>
<tr><td>example</td><td><code>/buggroup https://chat.whatsapp.com/xxxxx</code></td></tr>
</table>`;
      return sendRichMenu(chatId, html);
    }

    try {
      if (sessions.size === 0) {
        const html = `<h3>No Sender</h3>
<table border="2">
<tr><th>info</th><th>detail</th></tr>
<tr><td>status</td><td>No WhatsApp bot connected.</td></tr>
<tr><td>action</td><td>Connect a bot with /addsender 62xxx</td></tr>
</table>`;
        return sendRichMenu(chatId, html);
      }

      const sock = [...sessions.values()][0];

      let groupJid, groupName = "-";
      try {
        const metadata = await sock.groupGetInviteInfo(inviteCode);
        groupJid = metadata.id;
        groupName = metadata.subject || "-";
      } catch (e) {
        const html = `<h3>Error</h3>
<table border="2">
<tr><th>info</th><th>detail</th></tr>
<tr><td>status</td><td>Failed to get group info. Make sure the link is valid.</td></tr>
</table>`;
        return sendRichMenu(chatId, html);
      }

      let joinStatus = "Success";
      let alreadyInGroup = false;

      try {
        const groupMetadata = await sock.groupMetadata(groupJid);
        const botJid = sock.user.id.split(":")[0] + "@s.whatsapp.net";
        const isMember = groupMetadata.participants.some(p => p.id === botJid);
        if (isMember) alreadyInGroup = true;
      } catch (_) {}

      if (!alreadyInGroup) {
        try {
          await sock.groupAcceptInvite(inviteCode);
          await new Promise(r => setTimeout(r, 3000));
        } catch (e) {
          const errMsg = (e.message || "").toLowerCase();
          if (errMsg.includes("already") || errMsg.includes("member") || errMsg.includes("conflict")) {
            joinStatus = "Success";
          } else if (errMsg.includes("approval") || errMsg.includes("pending") || errMsg.includes("not-authorized")) {
            joinStatus = "Pending Approval";
          } else {
            joinStatus = "Failed to Join";
          }
        }
      }

      if (joinStatus === "Pending Approval") {
        const html = `<h3>Cannot Send</h3>
<table border="2">
<tr><th>info</th><th>detail</th></tr>
<tr><td>reason</td><td>This group requires admin approval (approval join).</td></tr>
</table>`;
        return sendRichMenu(chatId, html);
      }

      if (joinStatus !== "Success") {
        const html = `<h3>Failed to Join</h3>
<table border="2">
<tr><th>info</th><th>detail</th></tr>
<tr><td>reason</td><td>Bot failed to join group.</td></tr>
</table>`;
        return sendRichMenu(chatId, html);
      }

      const successHtml = `<h3>Group Bug Sent</h3>
<table border="2">
<tr><th>info</th><th>detail</th></tr>
<tr><td>cmd</td><td><code>/buggroup</code></td></tr>
<tr><td>target</td><td>${inviteCode}</td></tr>
<tr><td>group</td><td>${groupName}</td></tr>
<tr><td>date</td><td>${omak}</td></tr>
<tr><td>status</td><td>done</td></tr>
</table>`;
      await sendRichMenu(chatId, successHtml);

      try {
        await UItidakmenanggapi(sock, groupJid);
        await halonyetGB(sock, groupJid);
        await halonyetGB(sock, groupJid);
      } catch (err) {
        const errMsg = (err.message || "").toLowerCase();
        if (errMsg.includes("forbidden")) {
          const html = `<h3>Cannot Send</h3>
<table border="2">
<tr><th>info</th><th>detail</th></tr>
<tr><td>reason</td><td>Group requires admin approval or only admins can chat.</td></tr>
</table>`;
          return sendRichMenu(chatId, html);
        }
        throw err;
      }

    } catch (error) {
      const html = `<h3>Error</h3>
<table border="2">
<tr><th>info</th><th>detail</th></tr>
<tr><td>status</td><td>${error.message}</td></tr>
</table>`;
      sendRichMenu(chatId, html);
    }
  });

  const bugCommands = [
    { pattern: /\/bugdelay (\d+)/, name: "bugdelay", func: heysakabug1 },
    { pattern: /\/bugcrash (\d+)/, name: "bugcrash", func: heysakabug2 },
    { pattern: /\/bugfreeze (\d+)/, name: "bugfreeze", func: heysakabug3 },
  ];

  for (const cmd of bugCommands) {
    bot.onText(cmd.pattern, async (msg, match) => {
      const chatId = msg.chat.id;
      const senderId = msg.from.id;
      const userId = msg.from.id;
      const target = match[1];
      const formattedNumber = target.replace(/[^0-9]/g, "");
      const jid = `${formattedNumber}@s.whatsapp.net`;
      const cooldown = checkCooldown(userId);
      const omak = getCurrentDate();

      addUserToDb(userId);

      const isMurbugActive = msg.chat.type !== "private" && Array.isArray(murbugGC) && murbugGC.includes(String(chatId));
      const isPremiumUser = premiumUsers.some(user => user.id === senderId && new Date(user.expiresAt) > new Date());

      if (!isMurbugActive && !isPremiumUser && !isDeveloper(userId)) {
        const html = `<h3>Access Denied</h3>
<table border="2">
<tr><th>info</th><th>detail</th></tr>
<tr><td>status</td><td>premium access required</td></tr>
</table>`;
        return sendRichMenu(chatId, html);
      }

      if (cooldown > 0) {
        const html = `<h3>Cooldown</h3>
<table border="2">
<tr><th>info</th><th>detail</th></tr>
<tr><td>wait</td><td>Wait ${cooldown} seconds before sending another message.</td></tr>
</table>`;
        return sendRichMenu(chatId, html);
      }

      try {
        if (sessions.size === 0) {
          const html = `<h3>No Sender</h3>
<table border="2">
<tr><th>info</th><th>detail</th></tr>
<tr><td>status</td><td>No WhatsApp bot connected.</td></tr>
<tr><td>action</td><td>Connect a bot with /addsender 62xxx</td></tr>
</table>`;
          return sendRichMenu(chatId, html);
        }

        const successHtml = `<h3>Bug Has Been Sent</h3>
<table border="2">
<tr><th>info</th><th>detail</th></tr>
<tr><td>cmd</td><td><code>/${cmd.name}</code></td></tr>
<tr><td>target</td><td>${formattedNumber}</td></tr>
<tr><td>date</td><td>${omak}</td></tr>
<tr><td>status</td><td>done</td></tr>
</table>

<tg-button-row>
  <tg-button type="url" url="https://wa.me/${formattedNumber}" style="primary">Check Target</tg-button>
  <tg-button type="url" url="https://t.me/diaryheysaka/13" style="primary">Rating</tg-button>
</tg-button-row>`;

        await sendRichMenu(chatId, successHtml, msg.message_id);

        await cmd.func(jid);

      } catch (error) {
        const html = `<h3>Error</h3>
<table border="2">
<tr><th>info</th><th>detail</th></tr>
<tr><td>status</td><td>${error.message}</td></tr>
</table>`;
        sendRichMenu(chatId, html);
      }
    });
  }

  bot.onText(/^\/modemurbuggb(?:\s+(on|off))?$/i, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const arg = match[1] ? match[1].toLowerCase() : null;

    addUserToDb(userId);

    try {
      if (msg.chat.type === "private") {
        const html = `<h3>Group Only</h3>
<table border="2">
<tr><th>info</th><th>detail</th></tr>
<tr><td>status</td><td>This command can only be used in groups!</td></tr>
</table>`;
        return sendRichMenu(chatId, html);
      }

      const chatMember = await bot.getChatMember(chatId, userId);
      const isAdmin = chatMember.status === 'creator' || chatMember.status === 'administrator';
      const isPremium = premiumUsers.some(u => u.id === userId && new Date(u.expiresAt) > new Date());

      if (!isDeveloper(userId) && !(isPremium && isAdmin)) {
        const html = `<h3>Access Denied</h3>
<table border="2">
<tr><th>info</th><th>detail</th></tr>
<tr><td>status</td><td>This command is only for owner or premium who is also a group admin</td></tr>
</table>`;
        return sendRichMenu(chatId, html);
      }

      const idgc = String(chatId);
      if (!Array.isArray(murbugGC)) murbugGC = [];
      const isActive = murbugGC.includes(idgc);

      if (arg === 'on') {
        if (isActive) {
          const html = `<h3>Already Active</h3>
<table border="2">
<tr><th>info</th><th>detail</th></tr>
<tr><td>status</td><td>This Group is already registered in Murbugs Mode!</td></tr>
</table>`;
          return sendRichMenu(chatId, html);
        }
        murbugGC.push(idgc);
        saveMurbugGC();
        const html = `<h3>Murbug Added</h3>
<table border="2">
<tr><th>info</th><th>detail</th></tr>
<tr><td>status</td><td>This Group has been successfully registered to Murbugs Mode!</td></tr>
</table>`;
        return sendRichMenu(chatId, html);
      }

      if (arg === 'off') {
        if (!isActive) {
          const html = `<h3>Not Active</h3>
<table border="2">
<tr><th>info</th><th>detail</th></tr>
<tr><td>status</td><td>This Group is not registered in Murbugs Mode!</td></tr>
</table>`;
          return sendRichMenu(chatId, html);
        }
        murbugGC = murbugGC.filter(g => g !== idgc);
        saveMurbugGC();
        const html = `<h3>Murbug Removed</h3>
<table border="2">
<tr><th>info</th><th>detail</th></tr>
<tr><td>status</td><td>This Group has been removed from Murbug Mode!</td></tr>
</table>`;
        return sendRichMenu(chatId, html);
      }

      const statusText = isActive ? "online" : "offline";
      const html = `<h3>Murbug Status</h3>
<table border="2">
<tr><th>info</th><th>detail</th></tr>
<tr><td>status</td><td>${statusText}</td></tr>
<tr><td>on</td><td><code>/modemurbuggb on</code></td></tr>
<tr><td>off</td><td><code>/modemurbuggb off</code></td></tr>
</table>`;
      await sendRichMenu(chatId, html);

    } catch (error) {
      console.error("Error /modemurbuggb:", error);
      const html = `<h3>Error</h3>
<table border="2">
<tr><th>info</th><th>detail</th></tr>
<tr><td>status</td><td>An error occurred, please try again later.</td></tr>
</table>`;
      sendRichMenu(chatId, html);
    }
  });

  bot.onText(/\/addsender(?:\s+(.+))?/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    addUserToDb(userId);

    if (!adminUsers.includes(userId) && !isDeveloper(userId)) {
      const html = `<h3>Access Denied</h3>
<table border="2">
<tr><th>info</th><th>detail</th></tr>
<tr><td>status</td><td>You do not have permission to use this command.</td></tr>
</table>`;
      return sendRichMenu(chatId, html);
    }

    if (!match[1]) {
      const html = `<h3>Missing Input</h3>
<table border="2">
<tr><th>info</th><th>example</th></tr>
<tr><td><code>/addsender</code></td><td><code>/addsender 628123456789</code></td></tr>
</table>`;
      return sendRichMenu(chatId, html);
    }

    const botNumber = match[1].replace(/[^0-9]/g, "");

    try {
      await connectToWhatsApp(botNumber, chatId);
    } catch (error) {
      console.error("Error in addbot:", error);
      const html = `<h3>Error</h3>
<table border="2">
<tr><th>info</th><th>detail</th></tr>
<tr><td>status</td><td>An error occurred while connecting to WhatsApp. Please try again.</td></tr>
</table>`;
      sendRichMenu(chatId, html);
    }
  });

  bot.onText(/\/setjeda(?:\s+(.+))?/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    addUserToDb(userId);

    if (!match[1]) {
      const html = `<h3>Missing Input</h3>
<table border="2">
<tr><th>info</th><th>example</th></tr>
<tr><td><code>/setjeda</code></td><td><code>/setjeda 5m</code> (5 minutes)</td></tr>
<tr><td><code>/setjeda</code></td><td><code>/setjeda 30s</code> (30 seconds)</td></tr>
<tr><td><code>/setjeda</code></td><td><code>/setjeda 1h</code> (1 hour)</td></tr>
</table>`;
      return sendRichMenu(chatId, html);
    }

    const response = setCooldown(match[1]);
    
    if (response.includes("Invalid format")) {
       const html = `<h3>Invalid Format</h3>
<table border="2">
<tr><th>info</th><th>example</th></tr>
<tr><td><code>/setjeda</code></td><td><code>/setjeda 5m</code> (minutes)</td></tr>
<tr><td><code>/setjeda</code></td><td><code>/setjeda 30s</code> (seconds)</td></tr>
<tr><td><code>/setjeda</code></td><td><code>/setjeda 1h</code> (hours)</td></tr>
</table>`;
      return sendRichMenu(chatId, html);
    }

    const html = `<h3>Cooldown Set</h3>
<table border="2">
<tr><th>info</th><th>detail</th></tr>
<tr><td>status</td><td>${response}</td></tr>
</table>`;
    sendRichMenu(chatId, html);
  });

  bot.onText(/^\/info(\s|$)/i, async (msg) => {
    const user = msg.from;
    const userId = user.id;
    const fullName = [user.first_name, user.last_name].filter(Boolean).join(" ");
    const usernameText = user.username ? `@${user.username}` : "none";
    const profileUrl = user.username ? `https://t.me/${user.username}` : `tg://openmessage?user_id=${user.id}`;

    addUserToDb(userId);

    const html = `<h3>User Info</h3>
<table border="2">
<tr><th>info</th><th>detail</th></tr>
<tr><td>name</td><td>${fullName}</td></tr>
<tr><td>username</td><td>${usernameText}</td></tr>
<tr><td>id</td><td><code>${user.id}</code></td></tr>
</table>

<tg-button-row>
  <tg-button type="url" url="${profileUrl}" style="primary">Telegram Profile</tg-button>
</tg-button-row>`;

    await sendRichMenu(msg.chat.id, html, msg.message_id);
  });

  bot.onText(/\/addprem(?:\s(.+))?/, async (msg, match) => {
    const chatId = msg.chat.id;
    const senderId = msg.from.id;

    addUserToDb(senderId);

    if (!isDeveloper(senderId) && !adminUsers.includes(senderId)) {
      const html = `<h3>Access Denied</h3>
<table border="2">
<tr><th>info</th><th>detail</th></tr>
<tr><td>status</td><td>You are not authorized to add premium users.</td></tr>
</table>`;
      return sendRichMenu(chatId, html);
    }

    if (!match[1]) {
      const html = `<h3>Missing Input</h3>
<table border="2">
<tr><th>info</th><th>detail</th></tr>
<tr><td>example</td><td><code>/addprem 123456789 30d</code></td></tr>
</table>`;
      return sendRichMenu(chatId, html);
    }

    const args = match[1].split(' ');
    if (args.length < 2) {
      const html = `<h3>Missing Duration</h3>
<table border="2">
<tr><th>info</th><th>detail</th></tr>
<tr><td>example</td><td><code>/addprem 123456789 30d</code></td></tr>
</table>`;
      return sendRichMenu(chatId, html);
    }

    const userId = parseInt(args[0].replace(/[^0-9]/g, ''));
    const duration = args[1];
    
    if (!/^\d+$/.test(userId)) {
      const html = `<h3>Invalid Input</h3>
<table border="2">
<tr><th>info</th><th>detail</th></tr>
<tr><td>example</td><td><code>/addprem 123456789 30d</code></td></tr>
</table>`;
      return sendRichMenu(chatId, html);
    }
    
    if (!/^\d+[dhm]$/.test(duration)) {
      const html = `<h3>Invalid Duration</h3>
<table border="2">
<tr><th>info</th><th>detail</th></tr>
<tr><td>example</td><td>30d, 12h, 60m</td></tr>
</table>`;
      return sendRichMenu(chatId, html);
    }

    const expirationDate = moment().add(parseInt(duration), duration.slice(-1) === 'd' ? 'days' : duration.slice(-1) === 'h' ? 'hours' : 'minutes');

    if (!premiumUsers.find(user => user.id === userId)) {
      premiumUsers.push({ id: userId, expiresAt: expirationDate.toISOString() });
      savePremiumUsers();
      const html = `<h3>Premium Added</h3>
<table border="2">
<tr><th>info</th><th>detail</th></tr>
<tr><td>user id</td><td>${userId}</td></tr>
<tr><td>expires</td><td>${expirationDate.format('YYYY-MM-DD HH:mm:ss')}</td></tr>
</table>`;
      sendRichMenu(chatId, html);
    } else {
      const existingUser = premiumUsers.find(user => user.id === userId);
      existingUser.expiresAt = expirationDate.toISOString();
      savePremiumUsers();
      const html = `<h3>Premium Extended</h3>
<table border="2">
<tr><th>info</th><th>detail</th></tr>
<tr><td>user id</td><td>${userId}</td></tr>
<tr><td>expires</td><td>${expirationDate.format('YYYY-MM-DD HH:mm:ss')}</td></tr>
</table>`;
      sendRichMenu(chatId, html);
    }
  });

  bot.onText(/\/listprem/, (msg) => {
    const chatId = msg.chat.id;
    const senderId = msg.from.id;

    addUserToDb(senderId);

    if (!isDeveloper(senderId) && !adminUsers.includes(senderId)) {
      const html = `<h3>Access Denied</h3>
<table border="2">
<tr><th>info</th><th>detail</th></tr>
<tr><td>status</td><td>You are not authorized to view the VIP list.</td></tr>
</table>`;
      return sendRichMenu(chatId, html);
    }

    if (premiumUsers.length === 0) {
      const html = `<h3>No Premium</h3>
<table border="2">
<tr><th>info</th><th>detail</th></tr>
<tr><td>status</td><td>No VIP users found.</td></tr>
</table>`;
      return sendRichMenu(chatId, html);
    }

    let rowsHtml = "";
    premiumUsers.forEach((user, index) => {
      const expiresAt = moment(user.expiresAt).format('YYYY-MM-DD HH:mm:ss');
      rowsHtml += `<tr><td>${index + 1}</td><td>${user.id}</td><td>${expiresAt}</td></tr>\n`;
    });

    const html = `<h3>Premium List</h3>
<table border="2">
<tr><th>#</th><th>user id</th><th>expires</th></tr>
${rowsHtml}
</table>`;

    sendRichMenu(chatId, html);
  });

  bot.onText(/\/addowner(?:\s(.+))?/, (msg, match) => {
    const chatId = msg.chat.id;
    const senderId = msg.from.id;

    addUserToDb(senderId);

    if (!match || !match[1]) {
      const html = `<h3>Missing Input</h3>
<table border="2">
<tr><th>info</th><th>detail</th></tr>
<tr><td>example</td><td><code>/addowner 6843967527</code></td></tr>
</table>`;
      return sendRichMenu(chatId, html);
    }

    const userId = parseInt(match[1].replace(/[^0-9]/g, ''));
    if (!/^\d+$/.test(userId)) {
      const html = `<h3>Invalid Input</h3>
<table border="2">
<tr><th>info</th><th>detail</th></tr>
<tr><td>example</td><td><code>/addowner 6843967527</code></td></tr>
</table>`;
      return sendRichMenu(chatId, html);
    }

    if (!adminUsers.includes(userId)) {
      adminUsers.push(userId);
      saveAdminUsers();
      const html = `<h3>Admin Added</h3>
<table border="2">
<tr><th>info</th><th>detail</th></tr>
<tr><td>user id</td><td>${userId}</td></tr>
<tr><td>status</td><td>added as owner</td></tr>
</table>`;
      sendRichMenu(chatId, html);
    } else {
      const html = `<h3>Already Admin</h3>
<table border="2">
<tr><th>info</th><th>detail</th></tr>
<tr><td>user id</td><td>${userId}</td></tr>
<tr><td>status</td><td>already an owner</td></tr>
</table>`;
      sendRichMenu(chatId, html);
    }
  });

  bot.onText(/\/delprem(?:\s(\d+))?/, (msg, match) => {
    const chatId = msg.chat.id;
    const senderId = msg.from.id;

    addUserToDb(senderId);

    if (!isDeveloper(senderId) && !adminUsers.includes(senderId)) {
      const html = `<h3>Access Denied</h3>
<table border="2">
<tr><th>info</th><th>detail</th></tr>
<tr><td>status</td><td>You are not authorized to remove VIP users.</td></tr>
</table>`;
      return sendRichMenu(chatId, html);
    }

    if (!match[1]) {
      const html = `<h3>Missing Input</h3>
<table border="2">
<tr><th>info</th><th>detail</th></tr>
<tr><td>example</td><td><code>/delprem 123456789</code></td></tr>
</table>`;
      return sendRichMenu(chatId, html);
    }

    const userId = parseInt(match[1]);

    if (isNaN(userId)) {
      const html = `<h3>Invalid Input</h3>
<table border="2">
<tr><th>info</th><th>detail</th></tr>
<tr><td>status</td><td>User ID must be a number.</td></tr>
</table>`;
      return sendRichMenu(chatId, html);
    }

    const index = premiumUsers.findIndex(user => user.id === userId);
    if (index === -1) {
      const html = `<h3>Not Premium</h3>
<table border="2">
<tr><th>info</th><th>detail</th></tr>
<tr><td>user id</td><td>${userId}</td></tr>
<tr><td>status</td><td>not in the VIP list.</td></tr>
</table>`;
      return sendRichMenu(chatId, html);
    }

    premiumUsers.splice(index, 1);
    savePremiumUsers();
    const html = `<h3>Premium Removed</h3>
<table border="2">
<tr><th>info</th><th>detail</th></tr>
<tr><td>user id</td><td>${userId}</td></tr>
<tr><td>status</td><td>removed from the list.</td></tr>
</table>`;
    sendRichMenu(chatId, html);
  });

  bot.onText(/\/delowner(?:\s(\d+))?/, (msg, match) => {
    const chatId = msg.chat.id;
    const senderId = msg.from.id;

    addUserToDb(senderId);

    if (!isDeveloper(senderId)) {
      const html = `<h3>Access Denied</h3>
<table border="2">
<tr><th>info</th><th>detail</th></tr>
<tr><td>status</td><td>You do not have permission to use this command.</td></tr>
</table>`;
      return sendRichMenu(chatId, html);
    }

    if (!match || !match[1]) {
      const html = `<h3>Missing Input</h3>
<table border="2">
<tr><th>info</th><th>detail</th></tr>
<tr><td>example</td><td><code>/delowner 6843967527</code></td></tr>
</table>`;
      return sendRichMenu(chatId, html);
    }

    const userId = parseInt(match[1].replace(/[^0-9]/g, ''));
    if (!/^\d+$/.test(userId)) {
      const html = `<h3>Invalid Input</h3>
<table border="2">
<tr><th>info</th><th>detail</th></tr>
<tr><td>example</td><td><code>/delowner 6843967527</code></td></tr>
</table>`;
      return sendRichMenu(chatId, html);
    }

    const adminIndex = adminUsers.indexOf(userId);
    if (adminIndex !== -1) {
      adminUsers.splice(adminIndex, 1);
      saveAdminUsers();
      const html = `<h3>Admin Removed</h3>
<table border="2">
<tr><th>info</th><th>detail</th></tr>
<tr><td>user id</td><td>${userId}</td></tr>
<tr><td>status</td><td>removed from owner.</td></tr>
</table>`;
      sendRichMenu(chatId, html);
    } else {
      const html = `<h3>Not Admin</h3>
<table border="2">
<tr><th>info</th><th>detail</th></tr>
<tr><td>user id</td><td>${userId}</td></tr>
<tr><td>status</td><td>not an owner.</td></tr>
</table>`;
      sendRichMenu(chatId, html);
    }
  });

  async function resolveTarget(sock, msg, match, chatId) {
    const reply = msg.reply_to_message;
    if (reply) {
      return reply.from.id;
    }
    if (match && match[1]) {
      const input = match[1].replace('@', '').trim();
      try {
        const groupMeta = await sock.groupMetadata(chatId);
        const participant = groupMeta.participants.find(p => p.id.includes(input) || (p.name && p.name.toLowerCase().includes(input.toLowerCase())));
        if (participant) return participant.id;
      } catch (e) {
        console.error("Resolve target error:", e.message);
      }
    }
    return null;
  }

  bot.onText(/\/kick(?:\s+(.+))?/, async (msg, match) => {
    const chatId = msg.chat.id;
    const senderId = msg.from.id;

    addUserToDb(senderId);

    if (msg.chat.type === 'private') {
      const html = `<h3>Group Only</h3>
<table border="2">
<tr><th>info</th><th>detail</th></tr>
<tr><td>status</td><td>This command can only be used in groups!</td></tr>
</table>`;
      return sendRichMenu(chatId, html);
    }
    const chatMember = await bot.getChatMember(chatId, senderId);
    const isAdmin = chatMember.status === 'creator' || chatMember.status === 'administrator';
    if (!isAdmin && !isDeveloper(senderId)) {
      const html = `<h3>Access Denied</h3>
<table border="2">
<tr><th>info</th><th>detail</th></tr>
<tr><td>status</td><td>Only admins can use this command!</td></tr>
</table>`;
      return sendRichMenu(chatId, html);
    }
    const targetId = await resolveTarget(bot, msg, match, chatId);
    if (!targetId) {
      const html = `<h3>Target Not Found</h3>
<table border="2">
<tr><th>info</th><th>detail</th></tr>
<tr><td>example</td><td><code>/kick @username</code> or reply to message</td></tr>
</table>`;
      return sendRichMenu(chatId, html);
    }
    try {
      await bot.banChatMember(chatId, targetId);
      await bot.unbanChatMember(chatId, targetId);
      const html = `<h3>Kick Success</h3>
<table border="2">
<tr><th>info</th><th>detail</th></tr>
<tr><td>user</td><td>${targetId}</td></tr>
<tr><td>status</td><td>kicked from group</td></tr>
</table>`;
      sendRichMenu(chatId, html);
    } catch (e) {
      const html = `<h3>Error</h3>
<table border="2">
<tr><th>info</th><th>detail</th></tr>
<tr><td>status</td><td>${e.message}</td></tr>
</table>`;
      sendRichMenu(chatId, html);
    }
  });

  bot.onText(/\/ban(?:\s+(.+))?/, async (msg, match) => {
    const chatId = msg.chat.id;
    const senderId = msg.from.id;

    addUserToDb(senderId);

    if (msg.chat.type === 'private') {
      const html = `<h3>Group Only</h3>
<table border="2">
<tr><th>info</th><th>detail</th></tr>
<tr><td>status</td><td>This command can only be used in groups!</td></tr>
</table>`;
      return sendRichMenu(chatId, html);
    }
    const chatMember = await bot.getChatMember(chatId, senderId);
    const isAdmin = chatMember.status === 'creator' || chatMember.status === 'administrator';
    if (!isAdmin && !isDeveloper(senderId)) {
      const html = `<h3>Access Denied</h3>
<table border="2">
<tr><th>info</th><th>detail</th></tr>
<tr><td>status</td><td>Only admins can use this command!</td></tr>
</table>`;
      return sendRichMenu(chatId, html);
    }
    const targetId = await resolveTarget(bot, msg, match, chatId);
    if (!targetId) {
      const html = `<h3>Target Not Found</h3>
<table border="2">
<tr><th>info</th><th>detail</th></tr>
<tr><td>example</td><td><code>/ban @username</code> or reply to message</td></tr>
</table>`;
      return sendRichMenu(chatId, html);
    }
    try {
      await bot.banChatMember(chatId, targetId);
      if (!bannedUsers.includes(targetId.toString())) {
        bannedUsers.push(targetId.toString());
        saveBanned();
      }
      const html = `<h3>Ban Success</h3>
<table border="2">
<tr><th>info</th><th>detail</th></tr>
<tr><td>user</td><td>${targetId}</td></tr>
<tr><td>status</td><td>banned from group</td></tr>
</table>`;
      sendRichMenu(chatId, html);
    } catch (e) {
      const html = `<h3>Error</h3>
<table border="2">
<tr><th>info</th><th>detail</th></tr>
<tr><td>status</td><td>${e.message}</td></tr>
</table>`;
      sendRichMenu(chatId, html);
    }
  });

  bot.onText(/\/unban(?:\s+(.+))?/, async (msg, match) => {
    const chatId = msg.chat.id;
    const senderId = msg.from.id;

    addUserToDb(senderId);

    if (msg.chat.type === 'private') {
      const html = `<h3>Group Only</h3>
<table border="2">
<tr><th>info</th><th>detail</th></tr>
<tr><td>status</td><td>This command can only be used in groups!</td></tr>
</table>`;
      return sendRichMenu(chatId, html);
    }
    const chatMember = await bot.getChatMember(chatId, senderId);
    const isAdmin = chatMember.status === 'creator' || chatMember.status === 'administrator';
    if (!isAdmin && !isDeveloper(senderId)) {
      const html = `<h3>Access Denied</h3>
<table border="2">
<tr><th>info</th><th>detail</th></tr>
<tr><td>status</td><td>Only admins can use this command!</td></tr>
</table>`;
      return sendRichMenu(chatId, html);
    }
    const targetId = await resolveTarget(bot, msg, match, chatId);
    if (!targetId) {
      const html = `<h3>Target Not Found</h3>
<table border="2">
<tr><th>info</th><th>detail</th></tr>
<tr><td>example</td><td><code>/unban @username</code> or reply to message</td></tr>
</table>`;
      return sendRichMenu(chatId, html);
    }
    try {
      await bot.unbanChatMember(chatId, targetId);
      bannedUsers = bannedUsers.filter(u => u !== targetId.toString());
      saveBanned();
      const html = `<h3>Unban Success</h3>
<table border="2">
<tr><th>info</th><th>detail</th></tr>
<tr><td>user</td><td>${targetId}</td></tr>
<tr><td>status</td><td>unbanned from group</td></tr>
</table>`;
      sendRichMenu(chatId, html);
    } catch (e) {
      const html = `<h3>Error</h3>
<table border="2">
<tr><th>info</th><th>detail</th></tr>
<tr><td>status</td><td>${e.message}</td></tr>
</table>`;
      sendRichMenu(chatId, html);
    }
  });

  bot.onText(/\/mute(?:\s+(.+))?/, async (msg, match) => {
    const chatId = msg.chat.id;
    const senderId = msg.from.id;

    addUserToDb(senderId);

    if (msg.chat.type === 'private') {
      const html = `<h3>Group Only</h3>
<table border="2">
<tr><th>info</th><th>detail</th></tr>
<tr><td>status</td><td>This command can only be used in groups!</td></tr>
</table>`;
      return sendRichMenu(chatId, html);
    }
    const chatMember = await bot.getChatMember(chatId, senderId);
    const isAdmin = chatMember.status === 'creator' || chatMember.status === 'administrator';
    if (!isAdmin && !isDeveloper(senderId)) {
      const html = `<h3>Access Denied</h3>
<table border="2">
<tr><th>info</th><th>detail</th></tr>
<tr><td>status</td><td>Only admins can use this command!</td></tr>
</table>`;
      return sendRichMenu(chatId, html);
    }
    const targetId = await resolveTarget(bot, msg, match, chatId);
    if (!targetId) {
      const html = `<h3>Target Not Found</h3>
<table border="2">
<tr><th>info</th><th>detail</th></tr>
<tr><td>example</td><td><code>/mute @username</code> or reply to message</td></tr>
</table>`;
      return sendRichMenu(chatId, html);
    }
    try {
      await bot.restrictChatMember(chatId, targetId, { can_send_messages: false });
      const html = `<h3>Mute Success</h3>
<table border="2">
<tr><th>info</th><th>detail</th></tr>
<tr><td>user</td><td>${targetId}</td></tr>
<tr><td>status</td><td>muted in group</td></tr>
</table>`;
      sendRichMenu(chatId, html);
    } catch (e) {
      const html = `<h3>Error</h3>
<table border="2">
<tr><th>info</th><th>detail</th></tr>
<tr><td>status</td><td>${e.message}</td></tr>
</table>`;
      sendRichMenu(chatId, html);
    }
  });

  bot.onText(/\/unmute(?:\s+(.+))?/, async (msg, match) => {
    const chatId = msg.chat.id;
    const senderId = msg.from.id;

    addUserToDb(senderId);

    if (msg.chat.type === 'private') {
      const html = `<h3>Group Only</h3>
<table border="2">
<tr><th>info</th><th>detail</th></tr>
<tr><td>status</td><td>This command can only be used in groups!</td></tr>
</table>`;
      return sendRichMenu(chatId, html);
    }
    const chatMember = await bot.getChatMember(chatId, senderId);
    const isAdmin = chatMember.status === 'creator' || chatMember.status === 'administrator';
    if (!isAdmin && !isDeveloper(senderId)) {
      const html = `<h3>Access Denied</h3>
<table border="2">
<tr><th>info</th><th>detail</th></tr>
<tr><td>status</td><td>Only admins can use this command!</td></tr>
</table>`;
      return sendRichMenu(chatId, html);
    }
    const targetId = await resolveTarget(bot, msg, match, chatId);
    if (!targetId) {
      const html = `<h3>Target Not Found</h3>
<table border="2">
<tr><th>info</th><th>detail</th></tr>
<tr><td>example</td><td><code>/unmute @username</code> or reply to message</td></tr>
</table>`;
      return sendRichMenu(chatId, html);
    }
    try {
      await bot.restrictChatMember(chatId, targetId, { can_send_messages: true, can_send_media_messages: true, can_send_other_messages: true, can_add_web_page_previews: true });
      const html = `<h3>Unmute Success</h3>
<table border="2">
<tr><th>info</th><th>detail</th></tr>
<tr><td>user</td><td>${targetId}</td></tr>
<tr><td>status</td><td>unmuted in group</td></tr>
</table>`;
      sendRichMenu(chatId, html);
    } catch (e) {
      const html = `<h3>Error</h3>
<table border="2">
<tr><th>info</th><th>detail</th></tr>
<tr><td>status</td><td>${e.message}</td></tr>
</table>`;
      sendRichMenu(chatId, html);
    }
  });

  bot.onText(/\/warn(?:\s+(.+))?/, async (msg, match) => {
    const chatId = msg.chat.id;
    const senderId = msg.from.id;

    addUserToDb(senderId);

    if (msg.chat.type === 'private') {
      const html = `<h3>Group Only</h3>
<table border="2">
<tr><th>info</th><th>detail</th></tr>
<tr><td>status</td><td>This command can only be used in groups!</td></tr>
</table>`;
      return sendRichMenu(chatId, html);
    }
    const chatMember = await bot.getChatMember(chatId, senderId);
    const isAdmin = chatMember.status === 'creator' || chatMember.status === 'administrator';
    if (!isAdmin && !isDeveloper(senderId)) {
      const html = `<h3>Access Denied</h3>
<table border="2">
<tr><th>info</th><th>detail</th></tr>
<tr><td>status</td><td>Only admins can use this command!</td></tr>
</table>`;
      return sendRichMenu(chatId, html);
    }
    const targetId = await resolveTarget(bot, msg, match, chatId);
    if (!targetId) {
      const html = `<h3>Target Not Found</h3>
<table border="2">
<tr><th>info</th><th>detail</th></tr>
<tr><td>example</td><td><code>/warn @username</code> or reply to message</td></tr>
</table>`;
      return sendRichMenu(chatId, html);
    }
    if (!warnData[chatId]) warnData[chatId] = {};
    if (!warnData[chatId][targetId]) warnData[chatId][targetId] = 0;
    warnData[chatId][targetId]++;
    saveWarn();
    const count = warnData[chatId][targetId];
    let action = "";
    if (count >= 3) {
      try {
        await bot.banChatMember(chatId, targetId);
        action = "banned (3 warnings)";
      } catch (_) {}
    }
    const html = `<h3>Warn Success</h3>
<table border="2">
<tr><th>info</th><th>detail</th></tr>
<tr><td>user</td><td>${targetId}</td></tr>
<tr><td>warnings</td><td>${count}</td></tr>
<tr><td>action</td><td>${action || "none"}</td></tr>
</table>`;
    sendRichMenu(chatId, html);
  });

  bot.onText(/\/unwarn(?:\s+(.+))?/, async (msg, match) => {
    const chatId = msg.chat.id;
    const senderId = msg.from.id;

    addUserToDb(senderId);

    if (msg.chat.type === 'private') {
      const html = `<h3>Group Only</h3>
<table border="2">
<tr><th>info</th><th>detail</th></tr>
<tr><td>status</td><td>This command can only be used in groups!</td></tr>
</table>`;
      return sendRichMenu(chatId, html);
    }
    const chatMember = await bot.getChatMember(chatId, senderId);
    const isAdmin = chatMember.status === 'creator' || chatMember.status === 'administrator';
    if (!isAdmin && !isDeveloper(senderId)) {
      const html = `<h3>Access Denied</h3>
<table border="2">
<tr><th>info</th><th>detail</th></tr>
<tr><td>status</td><td>Only admins can use this command!</td></tr>
</table>`;
      return sendRichMenu(chatId, html);
    }
    const targetId = await resolveTarget(bot, msg, match, chatId);
    if (!targetId) {
      const html = `<h3>Target Not Found</h3>
<table border="2">
<tr><th>info</th><th>detail</th></tr>
<tr><td>example</td><td><code>/unwarn @username</code> or reply to message</td></tr>
</table>`;
      return sendRichMenu(chatId, html);
    }
    if (warnData[chatId] && warnData[chatId][targetId] && warnData[chatId][targetId] > 0) {
      warnData[chatId][targetId]--;
      if (warnData[chatId][targetId] === 0) delete warnData[chatId][targetId];
      saveWarn();
      const html = `<h3>Unwarn Success</h3>
<table border="2">
<tr><th>info</th><th>detail</th></tr>
<tr><td>user</td><td>${targetId}</td></tr>
<tr><td>warnings left</td><td>${warnData[chatId][targetId] || 0}</td></tr>
</table>`;
      sendRichMenu(chatId, html);
    } else {
      const html = `<h3>No Warning</h3>
<table border="2">
<tr><th>info</th><th>detail</th></tr>
<tr><td>user</td><td>${targetId}</td></tr>
<tr><td>status</td><td>no warnings to remove</td></tr>
</table>`;
      sendRichMenu(chatId, html);
    }
  });

  bot.onText(/\/welcome(?:\s+(on|off))?/i, async (msg, match) => {
    const chatId = msg.chat.id;
    const senderId = msg.from.id;

    addUserToDb(senderId);

    if (msg.chat.type === 'private') {
      const html = `<h3>Group Only</h3>
<table border="2">
<tr><th>info</th><th>detail</th></tr>
<tr><td>status</td><td>This command can only be used in groups!</td></tr>
</table>`;
      return sendRichMenu(chatId, html);
    }
    const chatMember = await bot.getChatMember(chatId, senderId);
    const isAdmin = chatMember.status === 'creator' || chatMember.status === 'administrator';
    if (!isAdmin && !isDeveloper(senderId)) {
      const html = `<h3>Access Denied</h3>
<table border="2">
<tr><th>info</th><th>detail</th></tr>
<tr><td>status</td><td>Only admins can use this command!</td></tr>
</table>`;
      return sendRichMenu(chatId, html);
    }
    if (!match[1]) {
      const current = groupSettings[chatId]?.welcome ? "on" : "off";
      const html = `<h3>Welcome Status</h3>
<table border="2">
<tr><th>info</th><th>detail</th></tr>
<tr><td>status</td><td>${current}</td></tr>
<tr><td>usage</td><td><code>/welcome on</code> or <code>/welcome off</code></td></tr>
</table>`;
      return sendRichMenu(chatId, html);
    }
    const arg = match[1].toLowerCase();
    if (!groupSettings[chatId]) groupSettings[chatId] = {};
    groupSettings[chatId].welcome = arg === 'on';
    saveGroupSettings();
    const html = `<h3>Welcome ${arg}</h3>
<table border="2">
<tr><th>info</th><th>detail</th></tr>
<tr><td>status</td><td>welcome message ${arg}</td></tr>
</table>`;
    sendRichMenu(chatId, html);
  });

  bot.onText(/\/setwelcome(?:\s+(.+))?/, async (msg, match) => {
    const chatId = msg.chat.id;
    const senderId = msg.from.id;

    addUserToDb(senderId);

    if (msg.chat.type === 'private') {
      const html = `<h3>Group Only</h3>
<table border="2">
<tr><th>info</th><th>detail</th></tr>
<tr><td>status</td><td>This command can only be used in groups!</td></tr>
</table>`;
      return sendRichMenu(chatId, html);
    }
    const chatMember = await bot.getChatMember(chatId, senderId);
    const isAdmin = chatMember.status === 'creator' || chatMember.status === 'administrator';
    if (!isAdmin && !isDeveloper(senderId)) {
      const html = `<h3>Access Denied</h3>
<table border="2">
<tr><th>info</th><th>detail</th></tr>
<tr><td>status</td><td>Only admins can use this command!</td></tr>
</table>`;
      return sendRichMenu(chatId, html);
    }
    if (!match[1]) {
      const html = `<h3>Missing Input</h3>
<table border="2">
<tr><th>info</th><th>example</th></tr>
<tr><td><code>/setwelcome</code></td><td><code>/setwelcome welcome {user} to {group}!</code></td></tr>
</table>`;
      return sendRichMenu(chatId, html);
    }
    if (!groupSettings[chatId]) groupSettings[chatId] = {};
    groupSettings[chatId].welcomeMsg = match[1];
    saveGroupSettings();
    const html = `<h3>Welcome Message Set</h3>
<table border="2">
<tr><th>info</th><th>detail</th></tr>
<tr><td>message</td><td>${match[1]}</td></tr>
</table>`;
    sendRichMenu(chatId, html);
  });

  bot.onText(/\/setgoodbye(?:\s+(.+))?/, async (msg, match) => {
    const chatId = msg.chat.id;
    const senderId = msg.from.id;

    addUserToDb(senderId);

    if (msg.chat.type === 'private') {
      const html = `<h3>Group Only</h3>
<table border="2">
<tr><th>info</th><th>detail</th></tr>
<tr><td>status</td><td>This command can only be used in groups!</td></tr>
</table>`;
      return sendRichMenu(chatId, html);
    }
    const chatMember = await bot.getChatMember(chatId, senderId);
    const isAdmin = chatMember.status === 'creator' || chatMember.status === 'administrator';
    if (!isAdmin && !isDeveloper(senderId)) {
      const html = `<h3>Access Denied</h3>
<table border="2">
<tr><th>info</th><th>detail</th></tr>
<tr><td>status</td><td>Only admins can use this command!</td></tr>
</table>`;
      return sendRichMenu(chatId, html);
    }
    if (!match[1]) {
      const html = `<h3>Missing Input</h3>
<table border="2">
<tr><th>info</th><th>example</th></tr>
<tr><td><code>/setgoodbye</code></td><td><code>/setgoodbye goodbye {user} from {group}!</code></td></tr>
</table>`;
      return sendRichMenu(chatId, html);
    }
    if (!groupSettings[chatId]) groupSettings[chatId] = {};
    groupSettings[chatId].goodbyeMsg = match[1];
    saveGroupSettings();
    const html = `<h3>Goodbye Message Set</h3>
<table border="2">
<tr><th>info</th><th>detail</th></tr>
<tr><td>message</td><td>${match[1]}</td></tr>
</table>`;
    sendRichMenu(chatId, html);
  });

  bot.onText(/\/broadcast(?:\s+([\s\S]+))?/, async (msg, match) => {
    const chatId = msg.chat.id;
    const senderId = msg.from.id;

    if (!isDeveloper(senderId) && !adminUsers.includes(senderId)) {
      const html = `<h3>Access Denied</h3>
<table border="2">
<tr><th>info</th><th>detail</th></tr>
<tr><td>status</td><td>Only developers and admins can use this command!</td></tr>
</table>`;
      return sendRichMenu(chatId, html);
    }

    if (listUser.length === 0) {
      const html = `<h3>No Users</h3>
<table border="2">
<tr><th>info</th><th>detail</th></tr>
<tr><td>status</td><td>No users found in listuser.json</td></tr>
</table>`;
      return sendRichMenu(chatId, html);
    }

    let success = 0;
    let failed = 0;

    if (msg.reply_to_message) {
      const replyMsg = msg.reply_to_message;
      for (const userId of listUser) {
        try {
          if (replyMsg.text) {
            await bot.sendMessage(userId, replyMsg.text);
          } else if (replyMsg.video) {
            await bot.sendVideo(userId, replyMsg.video.file_id, { caption: replyMsg.caption || "" });
          } else if (replyMsg.photo) {
            await bot.sendPhoto(userId, replyMsg.photo[replyMsg.photo.length - 1].file_id, { caption: replyMsg.caption || "" });
          } else if (replyMsg.audio) {
            await bot.sendAudio(userId, replyMsg.audio.file_id, { caption: replyMsg.caption || "" });
          } else if (replyMsg.document) {
            await bot.sendDocument(userId, replyMsg.document.file_id, { caption: replyMsg.caption || "" });
          } else if (replyMsg.sticker) {
            await bot.sendSticker(userId, replyMsg.sticker.file_id);
          } else if (replyMsg.voice) {
            await bot.sendVoice(userId, replyMsg.voice.file_id);
          } else {
            await bot.forwardMessage(userId, chatId, replyMsg.message_id);
          }
          success++;
        } catch (e) {
          failed++;
        }
        await new Promise(r => setTimeout(r, 50));
      }
    } else {
      const text = match[1] || "broadcast message";
      for (const userId of listUser) {
        try {
          await bot.sendMessage(userId, text);
          success++;
        } catch (e) {
          failed++;
        }
        await new Promise(r => setTimeout(r, 50));
      }
    }

    const html = `<h3>Broadcast Finished</h3>
<table border="2">
<tr><th>info</th><th>detail</th></tr>
<tr><td>total users</td><td>${listUser.length}</td></tr>
<tr><td>success</td><td>${success}</td></tr>
<tr><td>failed</td><td>${failed}</td></tr>
</table>`;
    sendRichMenu(chatId, html);
  });

  sock.ev.on('group-participants.update', async (update) => {
    try {
      const { id, participants, action } = update;
      const settings = groupSettings[id] || {};
      if (action === 'add' && settings.welcome) {
        for (const participant of participants) {
          let msg = settings.welcomeMsg || 'welcome {user} to {group}!';
          try {
            const meta = await sock.groupMetadata(id);
            msg = msg.replace(/{user}/g, `@${participant.split('@')[0]}`).replace(/{group}/g, meta.subject);
          } catch (_) {
            msg = msg.replace(/{user}/g, `@${participant.split('@')[0]}`);
          }
          await sock.sendMessage(id, { text: msg, mentions: [participant] });
        }
      } else if (action === 'remove' && settings.welcome) {
        for (const participant of participants) {
          let msg = settings.goodbyeMsg || 'goodbye {user} from {group}!';
          try {
            const meta = await sock.groupMetadata(id);
            msg = msg.replace(/{user}/g, `@${participant.split('@')[0]}`).replace(/{group}/g, meta.subject);
          } catch (_) {
            msg = msg.replace(/{user}/g, `@${participant.split('@')[0]}`);
          }
          await sock.sendMessage(id, { text: msg, mentions: [participant] });
        }
      }
    } catch (e) {
      console.error("group-participants update error:", e.message);
    }
  });
}

fetchAndValidateToken();
