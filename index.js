// Bot SIMsimd para grupo de WhatsApp — bienvenida, moderación de enlaces,
// sorteos y mensajes masivos SOLO a los números propios del dueño.
// Usa whatsapp-web.js (no oficial). El número que se vincula puede ser baneado
// por WhatsApp: usa un número secundario, no tu número principal.
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const fs = require('fs');
const path = require('path');

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
  console.log('Escanea este código QR con el WhatsApp del número bot:');
  qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
  console.log('✅ Bot listo y conectado.');
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

client.initialize();
console.log('Iniciando bot… escanea el QR cuando aparezca.');
