// SIMsimd — Bot de WhatsApp para tu grupo (versión Baileys, sin navegador).
// Corre en Termux en tu celular, GRATIS, sin servidor. No usa Chromium.
// Funciones: bienvenida, mensajes automáticos, moderación de enlaces,
// sorteos con ganador automático, panel /ADM y difusión solo a TUS números.
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const QRCode = require('qrcode');
const express = require('express');
const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, 'config.json');
const STATE_PATH = path.join(__dirname, 'sorteo.json');

// Clave para abrir la página de configuración desde el celular.
// Se lee de la variable de entorno BOT_ADMIN_KEY; si no está puesta, usa 'simsimd'.
// ¡Cámbiala para que solo tú puedas entrar!
const ADMIN_KEY = process.env.BOT_ADMIN_KEY || 'simsimd';
const PORT = process.env.PORT || 3000;

// Estado de conexión (para la página web)
let qrString = null;
let isReady = false;
let readyInfo = '';

// ---- Configuración (edita config.json o la página web /config) ----
const DEFAULT_CONFIG = {
  botName: 'SIMsimd',
  // Interruptor maestro: true = bot encendido, false = bot apagado.
  // Cuando está apagado el bot no responde ni manda nada; se vuelve a
  // encender solo desde el panel web privado /admin.
  botEnabled: true,
  // SOLO estos números reciben los mensajes masivos. Pon aquí TUS números
  // (con código de país, sin + ni espacios, ej: "573001234567").
  // El bot NO manda masivos a ningún número que no esté en esta lista.
  allowedNumbers: [],
  // Si lo dejas vacío, el bot actúa en todos los grupos donde esté.
  // Para limitarlo a un grupo, pon su ID, ej: "1203630...@g.us"
  groupId: "",
  welcomeMessage: "¡Bienvenido/a al grupo, {name}! 👋 Lee las reglas y preséntate.",
  // Mensaje automático diario (hora 0-23). Pon null para desactivarlo.
  dailyMessageHour: 9,
  dailyMessage: "¡Buenos días grupo! ☀️ Que tengan un buen día.",
  // Palabras que activan una respuesta automática (el bot responde solo en el grupo)
  autoReplies: {
    "hola bot": "¡Hola! 👋 Soy SIMsimd, el bot del grupo. Escribe !ayuda para ver lo que puedo hacer.",
    "reglas": "📌 Reglas del grupo:\n1. Respeto ante todo.\n2. Nada de enlaces sin permiso de un admin.\n3. Nada de spam."
  }
};

let config = DEFAULT_CONFIG;
try {
  if (fs.existsSync(CONFIG_PATH)) {
    config = { ...DEFAULT_CONFIG, ...JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) };
  } else {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(DEFAULT_CONFIG, null, 2));
  }
} catch (e) {
  console.error('No se pudo leer config.json, uso valores por defecto:', e.message);
}

// ---- Estado del sorteo (persiste en sorteo.json) ----
let sorteo = { activo: false, premio: '', participantes: [] };
try {
  if (fs.existsSync(STATE_PATH)) {
    sorteo = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
  }
} catch (e) {
  console.error('No se pudo leer sorteo.json, empiezo sin sorteo activo.');
}
function saveSorteo() {
  fs.writeFileSync(STATE_PATH, JSON.stringify(sorteo, null, 2));
}

const LINK_RE = /(https?:\/\/|www\.)[^\s]+/i;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const normNum = (id) => String(id || '').split('@')[0].replace(/\D/g, '');
const isGroupJid = (jid) => String(jid || '').endsWith('@g.us');

// ---- Panel de admin: comandos configurados y ajustes actuales ----
function adminPanel() {
  const nums = (config.allowedNumbers || []).length;
  const group = config.groupId ? config.groupId : 'todos los grupos';
  const daily = (config.dailyMessageHour === null || config.dailyMessageHour === undefined)
    ? 'desactivado'
    : `${config.dailyMessageHour}:00 — "${config.dailyMessage}"`;
  const replies = Object.keys(config.autoReplies || {}).join(', ') || 'ninguna';
  return (
    `🛠️ *Panel de admin — ${config.botName}*\n\n` +
    `*Comandos de admin:*\n` +
    `!sorteo <premio> — abrir un sorteo\n` +
    `!cerrar — cerrar el sorteo y elegir al ganador\n` +
    `!difundir <mensaje> — mandar el mensaje a tus números permitidos\n\n` +
    `*Comandos de todos:*\n` +
    `!ayuda — ver los comandos\n` +
    `!participo — entrar al sorteo abierto\n` +
    `!estado — ver el sorteo abierto\n\n` +
    `*Configuración actual:*\n` +
    `• Bot: ${config.botName}\n` +
    `• Estado: ${config.botEnabled ? '🟢 Encendido' : '🔴 Apagado'}\n` +
    `• Grupo: ${group}\n` +
    `• Números permitidos para difusión: ${nums}\n` +
    `• Mensaje diario: ${daily}\n` +
    `• Bienvenida: "${config.welcomeMessage}"\n` +
    `• Respuestas automáticas: ${replies}`
  );
}

let sock = null;

// ---- Saber si quien escribe es admin del grupo ----
async function isAdmin(groupJid, senderId) {
  try {
    const metadata = await sock.groupMetadata(groupJid);
    const p = (metadata.participants || []).find(x => x.id === senderId);
    return !!(p && (p.admin === 'admin' || p.admin === 'superadmin'));
  } catch (e) {
    return false;
  }
}

// ---- Mensaje masivo SOLO a los números permitidos (los del dueño) ----
// limit: cuántos números reciben el mensaje (1–100000). Si no se pasa,
// les llega a todos los de la lista.
async function sendMassive(text, limit) {
  const numbers = config.allowedNumbers || [];
  const n = (limit && Number.isFinite(limit) && limit > 0) ? Math.min(Math.floor(limit), 100000) : numbers.length;
  const target = numbers.slice(0, n);
  let sent = 0;
  const failed = [];
  for (const num of target) {
    try {
      const id = `${String(num).replace(/\D/g, '')}@s.whatsapp.net`;
      await sock.sendMessage(id, { text });
      sent++;
      await sleep(3000); // pausa entre mensajes para no parecer spam
    } catch (e) {
      failed.push(num);
    }
  }
  return { sent, failed, total: target.length };
}

// ---- Mensaje automático diario ----
let dailyTimer = null;
async function sendDailyToGroups() {
  if (!sock) return;
  try {
    const groups = await sock.groupFetchAllParticipating();
    for (const [jid] of Object.entries(groups)) {
      if (config.groupId && jid !== config.groupId) continue;
      await sock.sendMessage(jid, { text: config.dailyMessage });
    }
  } catch (e) {
    console.error('Error en mensaje diario:', e.message);
  }
}
function scheduleDailyMessage() {
  if (config.dailyMessageHour === null || config.dailyMessageHour === undefined) return;
  if (dailyTimer) clearInterval(dailyTimer);
  dailyTimer = setInterval(() => {
    const now = new Date();
    if (now.getHours() === config.dailyMessageHour && now.getMinutes() === 0) {
      sendDailyToGroups();
    }
  }, 60 * 1000);
}

// ---- Procesar un mensaje entrante ----
async function handleMessage(msg) {
  try {
    const jid = msg.key.remoteJid;
    if (!jid || msg.key.fromMe) return;
    // Interruptor maestro: si el bot está apagado, no responde ni manda nada.
    // Solo se vuelve a encender desde el panel web privado /admin.
    if (!config.botEnabled) return;
    const senderId = msg.key.participant || jid;
    const body = (msg.message?.conversation || msg.message?.extendedTextMessage?.text || '').trim();
    if (!body) return;
    const lower = body.toLowerCase();
    const senderNumber = normNum(senderId);
    const isAllowedNumber = (config.allowedNumbers || []).map(n => normNum(n)).includes(senderNumber);
    const inGroup = isGroupJid(jid);

    // --- Chat privado con el bot: solo !difundir, /adm y !ayuda, y solo desde TUS números ---
    if (!inGroup) {
      if (lower === '!ayuda' || lower === '!help') {
        await sock.sendMessage(jid, { text: `🤖 *${config.botName}*\n\n!difundir <mensaje> — mandar el mensaje a todos tus números permitidos\n/adm — ver los comandos y la configuración\n!ayuda — ver esta lista` });
        return;
      }
      if (lower === '/adm' || lower === '!admin') {
        if (!isAllowedNumber) {
          await sock.sendMessage(jid, { text: 'Este bot solo recibe órdenes de los números permitidos por el dueño.' });
          return;
        }
        await sock.sendMessage(jid, { text: adminPanel() });
        return;
      }
      if (lower.startsWith('!difundir')) {
        if (!isAllowedNumber) {
          await sock.sendMessage(jid, { text: 'Este bot solo recibe órdenes de los números permitidos por el dueño.' });
          return;
        }
        const text = body.slice('!difundir'.length).trim();
        if (!text) {
          await sock.sendMessage(jid, { text: 'Escribe el mensaje después de !difundir. Ej: !difundir Hola, esto es una prueba.' });
          return;
        }
        const result = await sendMassive(text);
        await sock.sendMessage(jid, { text: `📣 Difusión enviada a ${result.sent} de ${result.total} números permitidos.${result.failed.length ? ' Falló en: ' + result.failed.join(', ') : ''}` });
        return;
      }
      return; // en privado no respondo a nada más
    }

    if (config.groupId && jid !== config.groupId) return;

    // --- Moderación: borrar enlaces de quien NO sea admin ---
    if (LINK_RE.test(body)) {
      const admin = await isAdmin(jid, senderId);
      if (!admin) {
        try {
          await sock.sendMessage(jid, { delete: msg.key });
          await sock.sendMessage(jid, {
            text: `⚠️ @${senderNumber}, los enlaces solo los pueden compartir los admins. Tu mensaje fue eliminado.`,
            mentions: [senderId]
          });
          console.log('Enlace eliminado de:', senderId);
        } catch (e) {
          console.error('No pude eliminar el enlace (¿el bot es admin del grupo?):', e.message);
        }
        return;
      }
    }

    // --- Respuestas automáticas por palabra clave ---
    for (const [key, reply] of Object.entries(config.autoReplies || {})) {
      if (lower.includes(key.toLowerCase())) {
        await sock.sendMessage(jid, { text: reply });
        return;
      }
    }

    // --- Comandos ---
    if (lower === '!ayuda' || lower === '!help') {
      await sock.sendMessage(jid, {
        text: `🤖 *${config.botName} — Comandos*\n\n` +
          `!ayuda — ver esta lista\n` +
          `!sorteo <premio> — (solo admin) abre un sorteo\n` +
          `!participo — entrar al sorteo abierto\n` +
          `!cerrar — (solo admin) cierra el sorteo y elige al ganador\n` +
          `!estado — ver si hay sorteo abierto y cuántos participan\n` +
          `!difundir <mensaje> — (solo admin) mandar el mensaje a tus números permitidos\n` +
          `/adm — (solo admin) ver los comandos y la configuración`
      });
      return;
    }

    if (lower === '/adm' || lower === '!admin') {
      const admin = await isAdmin(jid, senderId);
      if (!admin) {
        await sock.sendMessage(jid, { text: 'Solo un admin puede ver el panel de admin.' });
        return;
      }
      await sock.sendMessage(jid, { text: adminPanel() });
      return;
    }

    if (lower === '!estado') {
      if (!sorteo.activo) {
        await sock.sendMessage(jid, { text: 'No hay ningún sorteo abierto ahora mismo.' });
      } else {
        await sock.sendMessage(jid, {
          text: `🎁 Sorteo abierto: *${sorteo.premio}*\nParticipantes: ${sorteo.participantes.length}\nEscribe !participo para entrar.`
        });
      }
      return;
    }

    if (lower.startsWith('!sorteo')) {
      const admin = await isAdmin(jid, senderId);
      if (!admin) {
        await sock.sendMessage(jid, { text: 'Solo un admin puede abrir un sorteo.' });
        return;
      }
      if (sorteo.activo) {
        await sock.sendMessage(jid, { text: `Ya hay un sorteo abierto: *${sorteo.premio}*. Ciérralo con !cerrar antes de abrir otro.` });
        return;
      }
      const premio = body.slice('!sorteo'.length).trim() || 'premio sorpresa';
      sorteo = { activo: true, premio, participantes: [] };
      saveSorteo();
      await sock.sendMessage(jid, {
        text: `🎁 ¡SORTEO ABIERTO!\nPremio: *${premio}*\n\nEscribe !participo para participar. El sorteo se cierra cuando un admin escriba !cerrar.`
      });
      return;
    }

    if (lower === '!participo') {
      if (!sorteo.activo) {
        await sock.sendMessage(jid, { text: 'No hay ningún sorteo abierto. Pídele a un admin que abra uno con !sorteo.' });
        return;
      }
      if (sorteo.participantes.includes(senderId)) {
        await sock.sendMessage(jid, { text: 'Ya estás participando. ¡Suerte! 🍀' });
        return;
      }
      sorteo.participantes.push(senderId);
      saveSorteo();
      await sock.sendMessage(jid, {
        text: `✅ @${senderNumber} ya está participando en el sorteo de *${sorteo.premio}*.`,
        mentions: [senderId]
      });
      return;
    }

    if (lower === '!cerrar') {
      const admin = await isAdmin(jid, senderId);
      if (!admin) {
        await sock.sendMessage(jid, { text: 'Solo un admin puede cerrar el sorteo.' });
        return;
      }
      if (!sorteo.activo) {
        await sock.sendMessage(jid, { text: 'No hay ningún sorteo abierto para cerrar.' });
        return;
      }
      if (sorteo.participantes.length === 0) {
        sorteo = { activo: false, premio: '', participantes: [] };
        saveSorteo();
        await sock.sendMessage(jid, { text: 'El sorteo se cerró sin participantes. Nadie ganó esta vez.' });
        return;
      }
      const winner = sorteo.participantes[Math.floor(Math.random() * sorteo.participantes.length)];
      const premio = sorteo.premio;
      const total = sorteo.participantes.length;
      sorteo = { activo: false, premio: '', participantes: [] };
      saveSorteo();
      await sock.sendMessage(jid, {
        text: `🎉 ¡SORTEO CERRADO!\n\nPremio: *${premio}*\nParticipantes: ${total}\n\n🏆 El ganador es @${normNum(winner)} ¡Felicidades! 🎊`,
        mentions: [winner]
      });
      console.log('Ganador del sorteo:', winner, 'Premio:', premio);
      return;
    }

    if (lower.startsWith('!difundir')) {
      const admin = await isAdmin(jid, senderId);
      if (!admin) {
        await sock.sendMessage(jid, { text: 'Solo un admin puede mandar una difusión.' });
        return;
      }
      const text = body.slice('!difundir'.length).trim();
      if (!text) {
        await sock.sendMessage(jid, { text: 'Escribe el mensaje después de !difundir. Ej: !difundir Hola, esto es una prueba.' });
        return;
      }
      const result = await sendMassive(text);
      await sock.sendMessage(jid, { text: `📣 Difusión enviada a ${result.sent} de ${result.total} números permitidos.${result.failed.length ? ' Falló en: ' + result.failed.join(', ') : ''}` });
      return;
    }
  } catch (e) {
    console.error('Error procesando mensaje:', e.message);
  }
}

// ---- Conectar a WhatsApp (Baileys) ----
async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState(path.join(__dirname, 'auth'));
  const { version } = await fetchLatestBaileysVersion();
  sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: false,
    browser: ['SIMsimd', 'Chrome', '1.0.0']
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;
    if (qr) {
      qrString = qr;
      isReady = false;
      console.log('Escanea este código QR con el WhatsApp del número bot:');
      try {
        console.log(await QRCode.toString(qr, { type: 'terminal', small: true }));
      } catch (e) {
        console.log('QR (texto):', qr);
      }
      console.log('O abre la página web del bot (/qr) en tu celular para verlo grande.');
    }
    if (connection === 'open') {
      qrString = null;
      isReady = true;
      readyInfo = sock.user ? `${sock.user.name || ''} (${sock.user.id ? normNum(sock.user.id) : ''})` : '';
      console.log('✅ SIMsimd listo y conectado.', readyInfo);
      scheduleDailyMessage();
    }
    if (connection === 'close') {
      const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
      console.log('Conexión cerrada. ¿Reconectar?', shouldReconnect);
      if (shouldReconnect) {
        setTimeout(startBot, 5000);
      } else {
        console.log('Sesión cerrada (loggedOut). Borra la carpeta auth y vuelve a escanear el QR.');
      }
    }
  });

  // Mensajes entrantes
  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    for (const msg of messages) {
      await handleMessage(msg);
    }
  });

  // Bienvenida cuando alguien entra al grupo
  sock.ev.on('group-participants.update', async ({ id, participants, action }) => {
    try {
      if (action !== 'add') return;
      if (config.groupId && id !== config.groupId) return;
      const names = participants.map(p => `@${normNum(p)}`).join(', ');
      const text = config.welcomeMessage.replace('{name}', names);
      await sock.sendMessage(id, { text, mentions: participants });
      console.log('Bienvenida enviada a:', names);
    } catch (e) {
      console.error('Error en bienvenida:', e.message);
    }
  });
}

// ---- Servidor web: QR para vincular desde el celular + configuración ----
const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

const page = (title, body) => `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title><style>body{font-family:sans-serif;background:#111;color:#eee;max-width:560px;margin:0 auto;padding:20px}h1{color:#25D366}a{color:#25D366}input,textarea,select{width:100%;padding:10px;margin:6px 0 14px;border-radius:8px;border:1px solid #444;background:#222;color:#eee;box-sizing:border-box}button{background:#25D366;color:#111;border:0;padding:12px 20px;border-radius:8px;font-weight:bold;cursor:pointer}img{max-width:280px;width:100%;background:#fff;padding:10px;border-radius:12px}.card{background:#1c1c1c;border:1px solid #333;border-radius:12px;padding:16px;margin:14px 0}small{color:#aaa}</style></head><body>${body}</body></html>`;

app.get('/api/health', (req, res) => res.json({ ok: true, app: 'simsimd', ready: isReady }));

app.get('/', async (req, res) => {
  const status = isReady
    ? `✅ <b>Conectado</b> ${readyInfo ? 'como ' + readyInfo : ''}`
    : (qrString ? '⏳ Esperando que escanees el QR' : '🔄 Conectando…');
  res.send(page('SIMsimd', `<h1>🤖 SIMsimd</h1><div class="card">${status}</div><p><a href="/admin">🔒 Panel web privado — usar el bot desde la web (encendido/apagado, difusión, números, sorteo)</a></p><p><a href="/qr">📷 Ver código QR para vincular</a></p><p><a href="/config">⚙️ Configuración</a></p><p><small>Bot de WhatsApp para tu grupo: bienvenida, moderación, sorteos y difusión a tus números. Corre en tu celular con Termux, gratis. Abre el panel web desde el navegador del celular.</small></p>`));
});

app.get('/qr', async (req, res) => {
  if (isReady) {
    return res.send(page('SIMsimd — QR', `<h1>🤖 SIMsimd</h1><div class="card">✅ Ya está vinculado y conectado ${readyInfo ? 'como ' + readyInfo : ''}. No necesitas escanear nada.</div><p><a href="/">← Volver</a></p>`));
  }
  if (!qrString) {
    return res.send(page('SIMsimd — QR', `<h1>🤖 SIMsimd</h1><div class="card">🔄 Generando el código QR… recarga la página en unos segundos.</div><p><a href="/">← Volver</a></p>`));
  }
  try {
    const dataUrl = await QRCode.toDataURL(qrString, { width: 280, margin: 1 });
    res.send(page('SIMsimd — QR', `<h1>🤖 SIMsimd</h1><div class="card"><p>Escanea este código con el WhatsApp del número bot:<br><small>WhatsApp → Ajustes → Dispositivos vinculados → Vincular un dispositivo</small></p><img src="${dataUrl}" alt="Código QR"><p><small>Si el código vence, recarga la página para ver uno nuevo.</small></p></div><p><a href="/">← Volver</a></p>`));
  } catch (e) {
    res.status(500).send('No se pudo generar el QR: ' + e.message);
  }
});

function configForm(key, msg = '') {
  const nums = (config.allowedNumbers || []).join('\n');
  const replies = JSON.stringify(config.autoReplies || {}, null, 2);
  return page('SIMsimd — Configuración', `<h1>⚙️ Configuración — SIMsimd</h1>${msg ? `<div class="card">${msg}</div>` : ''}
  <form method="POST" action="/config">
  <input type="hidden" name="key" value="${key}">
  <label>Nombre del bot</label><input name="botName" value="${config.botName || ''}">
  <label>Números permitidos para difusión (uno por línea, con código de país, ej. 573001234567)</label><textarea name="allowedNumbers" rows="4" placeholder="573001234567">${nums}</textarea>
  <label>ID del grupo (vacío = todos los grupos)</label><input name="groupId" value="${config.groupId || ''}">
  <label>Mensaje de bienvenida ({name} = nombre del que entra)</label><textarea name="welcomeMessage" rows="2">${config.welcomeMessage || ''}</textarea>
  <label>Hora del mensaje diario (0–23, vacío = desactivado)</label><input name="dailyMessageHour" value="${(config.dailyMessageHour === null || config.dailyMessageHour === undefined) ? '' : config.dailyMessageHour}">
  <label>Mensaje diario</label><textarea name="dailyMessage" rows="2">${config.dailyMessage || ''}</textarea>
  <label>Respuestas automáticas (JSON: palabra → respuesta)</label><textarea name="autoReplies" rows="6">${replies}</textarea>
  <button type="submit">💾 Guardar configuración</button>
  </form><p><a href="/">← Volver</a></p><p><small>La configuración se guarda en el servidor. El bot la aplica sin reiniciar, salvo la hora del mensaje diario.</small></p>`);
}

app.get('/config', (req, res) => {
  const key = String(req.query.key || '');
  if (key !== ADMIN_KEY) {
    return res.send(page('SIMsimd — Configuración', `<h1>⚙️ Configuración</h1><div class="card"><form method="GET" action="/config"><label>Clave de admin</label><input type="password" name="key" placeholder="Tu clave de admin"><button type="submit">Entrar</button></form></div><p><small>La clave es la variable BOT_ADMIN_KEY del servidor.</small></p>`));
  }
  res.send(configForm(key));
});

app.post('/config', (req, res) => {
  const key = String(req.body.key || '');
  if (key !== ADMIN_KEY) return res.status(403).send('Clave incorrecta.');
  try {
    config.botName = String(req.body.botName || 'SIMsimd');
    config.allowedNumbers = String(req.body.allowedNumbers || '').split('\n').map(s => s.trim().replace(/\D/g, '')).filter(Boolean);
    config.groupId = String(req.body.groupId || '').trim();
    config.welcomeMessage = String(req.body.welcomeMessage || '');
    config.dailyMessage = String(req.body.dailyMessage || '');
    const h = String(req.body.dailyMessageHour || '').trim();
    config.dailyMessageHour = h === '' ? null : Math.max(0, Math.min(23, parseInt(h, 10) || 0));
    try {
      config.autoReplies = JSON.parse(String(req.body.autoReplies || '{}'));
    } catch (e) {
      return res.send(configForm(key, '❌ Las respuestas automáticas no son un JSON válido. No se guardó nada.'));
    }
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
    scheduleDailyMessage();
    res.send(configForm(key, '✅ Configuración guardada.'));
  } catch (e) {
    res.send(configForm(key, '❌ Error al guardar: ' + e.message));
  }
});

// ---- Panel privado /admin: solo tú, con tu clave ----
// Encendido/apagado + recuadro para poner el número al que llega la difusión.
// Es la web completa para usar el bot: estado, difusión, números y sorteo.
function adminPage(key, msg = '') {
  const nums = config.allowedNumbers || [];
  const rows = nums.length
    ? nums.map(n => `<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid #333"><span>📱 ${n}</span><form method="POST" action="/admin/remove-number" style="margin:0"><input type="hidden" name="key" value="${key}"><input type="hidden" name="number" value="${n}"><button type="submit" style="background:#c0392b;padding:6px 12px">Eliminar</button></form></div>`).join('')
    : '<p><small>Todavía no hay números. Agrega el primero abajo.</small></p>';
  const state = config.botEnabled ? '🟢 ENCENDIDO' : '🔴 APAGADO';
  const toggleBtn = config.botEnabled
    ? `<button type="submit" style="background:#c0392b;width:100%;font-size:18px">⏻ APAGAR EL BOT</button>`
    : `<button type="submit" style="width:100%;font-size:18px">⏻ ENCENDER EL BOT</button>`;
  const conn = isReady ? `✅ Conectado a WhatsApp ${readyInfo ? 'como ' + readyInfo : ''}` : (qrString ? '⏳ Esperando que escanees el QR' : '🔄 Conectando…');
  const raffle = sorteo.activo
    ? `<p><b>🎁 Sorteo abierto:</b> ${escapeHtml(sorteo.premio || '')}</p><p>${sorteo.participantes.length} participante(s). Para cerrarlo y anunciar al ganador, escribe <b>!cerrar</b> en el grupo (solo admin).</p>`
    : `<p><small>No hay sorteo abierto. Para abrir uno, escribe <b>!sorteo &lt;premio&gt;</b> en el grupo (solo admin).</small></p>`;
  return page('SIMsimd — Panel web', `<h1>🤖 SIMsimd — Panel web</h1>
  ${msg ? `<div class="card">${msg}</div>` : ''}
  <div class="card"><p><b>Estado del bot: ${state}</b></p><p>${conn}</p>
  <form method="POST" action="/admin/toggle"><input type="hidden" name="key" value="${key}">${toggleBtn}</form>
  <p><small>Cuando está apagado el bot no responde ni manda nada. Lo vuelves a encender aquí mismo.</small></p></div>
  <div class="card"><h3>📣 Enviar difusión desde la web</h3>
  <form method="POST" action="/admin/difundir"><input type="hidden" name="key" value="${key}">
  <label>Mensaje</label><textarea name="message" rows="3" placeholder="Escribe el mensaje que quieres mandar"></textarea>
  <label>¿A cuántos números? (de 1 a 100.000)</label><input name="quantity" type="number" min="1" max="100000" placeholder="Ej. 50 — vacío = a todos los de la lista">
  <button type="submit">📣 Enviar difusión</button></form>
  <p><small>El mensaje les llega a los primeros números de tu lista, hasta la cantidad que pongas (máximo 100.000). Si la lista tiene menos, les llega a todos los que hay.</small></p></div>
  <div class="card"><h3>📱 Números que reciben la difusión</h3>${rows}
  <form method="POST" action="/admin/add-number" style="margin-top:14px"><input type="hidden" name="key" value="${key}">
  <label>Número (con código de país, ej. 573001234567)</label><input name="number" placeholder="573001234567" inputmode="numeric">
  <button type="submit">➕ Agregar número</button></form>
  <p><small>Solo a estos números les llega lo que mandes con !difundir. El bot no manda nada a ningún otro número.</small></p></div>
  <div class="card"><h3>🎁 Sorteo</h3>${raffle}</div>
  <p><a href="/config?key=${encodeURIComponent(key)}">⚙️ Más ajustes (bienvenida, mensajes, respuestas)</a></p>
  <p><a href="/qr">📷 Ver código QR para vincular</a></p>
  <p><a href="/">← Volver</a></p>`);
}

app.get('/admin', (req, res) => {
  const key = String(req.query.key || '');
  if (key !== ADMIN_KEY) {
    return res.send(page('SIMsimd — Panel privado', `<h1>🔒 Panel privado — SIMsimd</h1><div class="card"><p>Solo el dueño entra aquí.</p><form method="GET" action="/admin"><label>Clave de admin</label><input type="password" name="key" placeholder="Tu clave de admin"><button type="submit">Entrar</button></form></div><p><small>La clave es la variable BOT_ADMIN_KEY del servidor.</small></p>`));
  }
  res.send(adminPage(key));
});

app.post('/admin/toggle', (req, res) => {
  const key = String(req.body.key || '');
  if (key !== ADMIN_KEY) return res.status(403).send('Clave incorrecta.');
  config.botEnabled = !config.botEnabled;
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
  res.send(adminPage(key, config.botEnabled ? '✅ Bot encendido.' : '⏻ Bot apagado. No responderá ni mandará nada hasta que lo enciendas.'));
});

app.post('/admin/add-number', (req, res) => {
  const key = String(req.body.key || '');
  if (key !== ADMIN_KEY) return res.status(403).send('Clave incorrecta.');
  const num = String(req.body.number || '').replace(/\D/g, '');
  if (!num || num.length < 7) {
    return res.send(adminPage(key, '❌ Pon un número válido con código de país, ej. 573001234567.'));
  }
  if (!(config.allowedNumbers || []).includes(num)) {
    config.allowedNumbers = [...(config.allowedNumbers || []), num];
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
    res.send(adminPage(key, `✅ Número ${num} agregado. Ya le llega la difusión.`));
  } else {
    res.send(adminPage(key, `Ese número ${num} ya estaba en la lista.`));
  }
});

app.post('/admin/remove-number', (req, res) => {
  const key = String(req.body.key || '');
  if (key !== ADMIN_KEY) return res.status(403).send('Clave incorrecta.');
  const num = String(req.body.number || '').replace(/\D/g, '');
  config.allowedNumbers = (config.allowedNumbers || []).filter(n => n !== num);
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
  res.send(adminPage(key, `🗑️ Número ${num} eliminado de la lista.`));
});

// Difusión desde el panel privado, con cantidad (1–100000).
app.post('/admin/difundir', async (req, res) => {
  const key = String(req.body.key || '');
  if (key !== ADMIN_KEY) return res.status(403).send('Clave incorrecta.');
  const message = String(req.body.message || '').trim();
  if (!message) return res.send(adminPage(key, '❌ Escribe el mensaje que quieres mandar.'));
  if (!isReady || !sock) return res.send(adminPage(key, '❌ El bot no está conectado a WhatsApp todavía. Escanea el QR primero.'));
  const q = parseInt(String(req.body.quantity || ''), 10);
  const quantity = Number.isFinite(q) ? Math.max(1, Math.min(q, 100000)) : undefined;
  try {
    const r = await sendMassive(message, quantity);
    res.send(adminPage(key, r.failed.length
      ? `✅ Difusión enviada a ${r.sent} de ${r.total} números. Fallaron: ${r.failed.join(', ')}.`
      : `✅ Difusión enviada a ${r.sent} número(s).`));
  } catch (e) {
    res.send(adminPage(key, '❌ No se pudo enviar la difusión: ' + e.message));
  }
});

app.listen(PORT, () => console.log(`🌐 Panel web en http://localhost:${PORT} ( /qr para vincular, /config para ajustes )`));

startBot();
console.log('Iniciando SIMsimd… escanea el QR cuando aparezca.');
