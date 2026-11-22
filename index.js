// Bot SIMsimd para grupo de WhatsApp — bienvenida, moderación de enlaces,
// sorteos y mensajes masivos SOLO a los números propios del dueño.
// Usa whatsapp-web.js (no oficial). El número que se vincula puede ser baneado
// por WhatsApp: usa un número secundario, no tu número principal.
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const QRCode = require('qrcode');
const express = require('express');
const fs = require('fs');
const path = require('path');

// Clave para abrir la página de configuración desde el celular.
// Se lee de la variable de entorno BOT_ADMIN_KEY; si no está puesta, usa 'simsimd'.
// ¡Cámbiala en Railway para que solo tú puedas entrar!
const ADMIN_KEY = process.env.BOT_ADMIN_KEY || 'simsimd';
const PORT = process.env.PORT || 3000;

// Estado de conexión (para la página web)
let qrString = null;
let isReady = false;
let readyInfo = '';

const CONFIG_PATH = path.join(__dirname, 'config.json');
const STATE_PATH = path.join(__dirname, 'sorteo.json');

// ---- Configuración (edita config.json) ----
const DEFAULT_CONFIG = {
  botName: 'SIMsimd',
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
    "hola bot": "¡Hola! 👋 Soy el bot del grupo. Escribe !ayuda para ver lo que puedo hacer.",
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

const client = new Client({
  authStrategy: new LocalAuth({ dataPath: path.join(__dirname, '.wwebjs_auth') }),
  puppeteer: { headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] }
});

client.on('qr', (qr) => {
  qrString = qr;
  isReady = false;
  console.log('Escanea este código QR con el WhatsApp del número bot:');
  qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
  qrString = null;
  isReady = true;
  readyInfo = client.info ? `${client.info.pushname || ''} (${client.info.wid ? client.info.wid.user : ''})` : '';
  console.log('✅ Bot listo y conectado.', readyInfo);
  scheduleDailyMessage();
});

client.on('auth_failure', (msg) => {
  console.error('❌ Falló la autenticación:', msg);
});

client.on('disconnected', (reason) => {
  console.log('Bot desconectado:', reason);
});

// ---- Bienvenida cuando alguien entra al grupo ----
client.on('group_join', async (notification) => {
  try {
    const chat = await notification.getChat();
    if (!chat.isGroup) return;
    if (config.groupId && chat.id._serialized !== config.groupId) return;
    const name = notification.recipientIds
      .map(id => `@${id.user}`).join(', ');
    const text = config.welcomeMessage.replace('{name}', name);
    await chat.sendMessage(text, { mentions: notification.recipientIds });
    console.log('Bienvenida enviada a:', name);
  } catch (e) {
    console.error('Error en bienvenida:', e.message);
  }
});

// ---- Mensaje automático diario ----
let dailyTimer = null;
function scheduleDailyMessage() {
  if (config.dailyMessageHour === null || config.dailyMessageHour === undefined) return;
  if (dailyTimer) clearInterval(dailyTimer);
  dailyTimer = setInterval(async () => {
    const now = new Date();
    if (now.getHours() !== config.dailyMessageHour || now.getMinutes() !== 0) return;
    try {
      const chats = await client.getChats();
      for (const chat of chats) {
        if (!chat.isGroup) continue;
        if (config.groupId && chat.id._serialized !== config.groupId) continue;
        await chat.sendMessage(config.dailyMessage);
      }
    } catch (e) {
      console.error('Error en mensaje diario:', e.message);
    }
  }, 60 * 1000);
}

// ---- Ayuda: saber si quien escribe es admin del grupo ----
async function isAdmin(chat, authorId) {
  try {
    const participants = chat.participants || [];
    const p = participants.find(x => x.id._serialized === authorId);
    return !!(p && p.isAdmin);
  } catch (e) {
    return false;
  }
}

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
    `• Grupo: ${group}\n` +
    `• Números permitidos para difusión: ${nums}\n` +
    `• Mensaje diario: ${daily}\n` +
    `• Bienvenida: "${config.welcomeMessage}"\n` +
    `• Respuestas automáticas: ${replies}`
  );
}

// ---- Mensaje masivo SOLO a los números permitidos (los del dueño) ----
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function sendMassive(text) {
  const numbers = config.allowedNumbers || [];
  let sent = 0;
  const failed = [];
  for (const num of numbers) {
    try {
      const id = `${String(num).replace(/\D/g, '')}@c.us`;
      await client.sendMessage(id, text);
      sent++;
      await sleep(3000); // pausa entre mensajes para no parecer spam
    } catch (e) {
      failed.push(num);
    }
  }
  return { sent, failed, total: numbers.length };
}

// ---- Mensajes: moderación + comandos ----
client.on('message', async (msg) => {
  try {
    const chat = await msg.getChat();
    if (msg.fromMe) return;

    const authorId = msg.author || msg.from;
    const body = (msg.body || '').trim();
    const lower = body.toLowerCase();
    const senderNumber = String(authorId).split('@')[0].replace(/\D/g, '');
    const isAllowedNumber = (config.allowedNumbers || []).map(n => String(n).replace(/\D/g, '')).includes(senderNumber);

    // --- Chat privado con el bot: solo !difundir y !ayuda, y solo desde TUS números ---
    if (!chat.isGroup) {
      if (lower === '!ayuda' || lower === '!help') {
        await msg.reply(
          `🤖 *${config.botName}*\n\n` +
          `!difundir <mensaje> — mandar el mensaje a todos tus números permitidos\n` +
          `/adm — ver los comandos y la configuración\n` +
          `!ayuda — ver esta lista`
        );
        return;
      }
      if (lower === '/adm' || lower === '!admin') {
        if (!isAllowedNumber) {
          await msg.reply('Este bot solo recibe órdenes de los números permitidos por el dueño.');
          return;
        }
        await msg.reply(adminPanel());
        return;
      }
      if (lower.startsWith('!difundir')) {
        if (!isAllowedNumber) {
          await msg.reply('Este bot solo recibe órdenes de los números permitidos por el dueño.');
          return;
        }
        const text = body.slice('!difundir'.length).trim();
        if (!text) {
          await msg.reply('Escribe el mensaje después de !difundir. Ej: !difundir Hola, esto es una prueba.');
          return;
        }
        const result = await sendMassive(text);
        await msg.reply(`📣 Difusión enviada a ${result.sent} de ${result.total} números permitidos.${result.failed.length ? ' Falló en: ' + result.failed.join(', ') : ''}`);
        return;
      }
      return; // en privado no respondo a nada más
    }

    if (config.groupId && chat.id._serialized !== config.groupId) return;

    // --- Moderación: borrar enlaces de quien NO sea admin ---
    if (LINK_RE.test(body)) {
      const admin = await isAdmin(chat, authorId);
      if (!admin) {
        try {
          await msg.delete(true);
          const contact = await msg.getContact();
          await chat.sendMessage(
            `⚠️ @${contact.number}, los enlaces solo los pueden compartir los admins. Tu mensaje fue eliminado.`,
            { mentions: [authorId] }
          );
          console.log('Enlace eliminado de:', authorId);
        } catch (e) {
          console.error('No pude eliminar el enlace (¿el bot es admin del grupo?):', e.message);
        }
        return;
      }
    }

    // --- Respuestas automáticas por palabra clave ---
    for (const [key, reply] of Object.entries(config.autoReplies || {})) {
      if (lower.includes(key.toLowerCase())) {
        await chat.sendMessage(reply);
        return;
      }
    }

    // --- Comandos ---
    if (lower === '!ayuda' || lower === '!help') {
      await chat.sendMessage(
        `🤖 *${config.botName} — Comandos*\n\n` +
        `!ayuda — ver esta lista\n` +
        `!sorteo <premio> — (solo admin) abre un sorteo\n` +
        `!participo — entrar al sorteo abierto\n` +
        `!cerrar — (solo admin) cierra el sorteo y elige al ganador\n` +
        `!estado — ver si hay sorteo abierto y cuántos participan\n` +
        `!difundir <mensaje> — (solo admin) mandar el mensaje a tus números permitidos\n` +
        `/adm — (solo admin) ver los comandos y la configuración`
      );
      return;
    }

    if (lower === '/adm' || lower === '!admin') {
      const admin = await isAdmin(chat, authorId);
      if (!admin) {
        await chat.sendMessage('Solo un admin puede ver el panel de admin.');
        return;
      }
      await chat.sendMessage(adminPanel());
      return;
    }

    if (lower.startsWith('!difundir')) {
      const admin = await isAdmin(chat, authorId);
      if (!admin) {
        await chat.sendMessage('Solo un admin puede mandar una difusión.');
        return;
      }
      const text = body.slice('!difundir'.length).trim();
      if (!text) {
        await chat.sendMessage('Escribe el mensaje después de !difundir. Ej: !difundir Hola, esto es una prueba.');
        return;
      }
      const result = await sendMassive(text);
      await chat.sendMessage(`📣 Difusión enviada a ${result.sent} de ${result.total} números permitidos.${result.failed.length ? ' Falló en: ' + result.failed.join(', ') : ''}`);
      return;
    }

    if (lower === '!estado') {
      if (!sorteo.activo) {
        await chat.sendMessage('No hay ningún sorteo abierto ahora mismo.');
      } else {
        await chat.sendMessage(
          `🎁 Sorteo abierto: *${sorteo.premio}*\nParticipantes: ${sorteo.participantes.length}\nEscribe !participo para entrar.`
        );
      }
      return;
    }

    if (lower.startsWith('!sorteo')) {
      const admin = await isAdmin(chat, authorId);
      if (!admin) {
        await chat.sendMessage('Solo un admin puede abrir un sorteo.');
        return;
      }
      if (sorteo.activo) {
        await chat.sendMessage(`Ya hay un sorteo abierto: *${sorteo.premio}*. Ciérralo con !cerrar antes de abrir otro.`);
        return;
      }
      const premio = body.slice('!sorteo'.length).trim() || 'premio sorpresa';
      sorteo = { activo: true, premio, participantes: [] };
      saveSorteo();
      await chat.sendMessage(
        `🎁 ¡SORTEO ABIERTO!\nPremio: *${premio}*\n\nEscribe !participo para participar. El sorteo se cierra cuando un admin escriba !cerrar.`
      );
      return;
    }

    if (lower === '!participo') {
      if (!sorteo.activo) {
        await chat.sendMessage('No hay ningún sorteo abierto. Pídele a un admin que abra uno con !sorteo.');
        return;
      }
      if (sorteo.participantes.includes(authorId)) {
        await chat.sendMessage('Ya estás participando. ¡Suerte! 🍀');
        return;
      }
      sorteo.participantes.push(authorId);
      saveSorteo();
      await chat.sendMessage(`✅ @${authorId.split('@')[0]} ya está participando en el sorteo de *${sorteo.premio}*.`, {
        mentions: [authorId]
      });
      return;
    }

    if (lower === '!cerrar') {
      const admin = await isAdmin(chat, authorId);
      if (!admin) {
        await chat.sendMessage('Solo un admin puede cerrar el sorteo.');
        return;
      }
      if (!sorteo.activo) {
        await chat.sendMessage('No hay ningún sorteo abierto para cerrar.');
        return;
      }
      if (sorteo.participantes.length === 0) {
        sorteo = { activo: false, premio: '', participantes: [] };
        saveSorteo();
        await chat.sendMessage('El sorteo se cerró sin participantes. Nadie ganó esta vez.');
        return;
      }
      const winner = sorteo.participantes[Math.floor(Math.random() * sorteo.participantes.length)];
      const premio = sorteo.premio;
      const total = sorteo.participantes.length;
      sorteo = { activo: false, premio: '', participantes: [] };
      saveSorteo();
      await chat.sendMessage(
        `🎉 ¡SORTEO CERRADO!\n\nPremio: *${premio}*\nParticipantes: ${total}\n\n🏆 El ganador es @${winner.split('@')[0]} ¡Felicidades! 🎊`,
        { mentions: [winner] }
      );
      console.log('Ganador del sorteo:', winner, 'Premio:', premio);
      return;
    }
  } catch (e) {
    console.error('Error procesando mensaje:', e.message);
  }
});

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
  res.send(page('SIMsimd', `<h1>🤖 SIMsimd</h1><div class="card">${status}</div><p><a href="/qr">📷 Ver código QR para vincular</a></p><p><a href="/config">⚙️ Configuración</a></p><p><small>Bot de WhatsApp para tu grupo: bienvenida, moderación, sorteos y difusión a tus números.</small></p>`));
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

app.listen(PORT, () => console.log(`🌐 Panel web en http://localhost:${PORT} ( /qr para vincular, /config para ajustes )`));

client.initialize();
console.log('Iniciando bot… escanea el QR cuando aparezca.');
