# SIMsimd — Bot de WhatsApp para tu grupo

Bot para administrar tu grupo de WhatsApp: da la bienvenida, manda mensajes automáticos, modera enlaces, hace sorteos con ganador automático y manda difusiones solo a tus números.

## Lo que hace

- **Bienvenida:** cuando alguien entra al grupo, le da la bienvenida mencionándolo.
- **Mensaje automático diario:** un mensaje cada día a la hora que elijas (por defecto 9:00 AM).
- **Respuestas automáticas:** responde solo cuando alguien escribe una palabra clave (ej. "reglas", "hola bot"). Se editan en `config.json`.
- **Moderación de enlaces:** si alguien que NO es admin manda un enlace (http, https o www), el bot borra el mensaje y avisa. Los admins sí pueden mandar enlaces.
- **Sorteo:**
  - Un admin escribe `!sorteo <premio>` para abrirlo (ej. `!sorteo 50.000 COP`).
  - Los miembros entran con `!participo`.
  - Un admin escribe `!cerrar` y el bot elige al ganador al azar y lo anuncia mencionándolo.
  - `!estado` muestra si hay sorteo abierto y cuántos participan.
  - `!ayuda` muestra todos los comandos.
- **Difusión a tus números:** un admin escribe `!difundir <mensaje>` en el grupo, o le escribes `!difundir <mensaje>` al bot por privado desde uno de tus números, y SIMsimd manda ese mensaje a todos los números de la lista `allowedNumbers` en `config.json`. Solo a esos números, a nadie más. Entre cada mensaje espera 3 segundos para no parecer spam.

## Requisitos para que funcione

1. **El bot debe ser admin del grupo.** Si no es admin, no puede borrar mensajes de otros.
2. **Usa un número secundario, NO tu número principal.** Este bot usa whatsapp-web.js, que no es oficial de WhatsApp. WhatsApp puede detectar la automatización y banear el número. Con un número secundario, si lo banean, no pierdes tu cuenta principal.
3. **Debe estar encendido siempre.** El bot corre en una computadora o servidor. Si lo apagas, deja de responder. Para tenerlo 24/7, déjalo corriendo en una computadora encendida o en un servidor (Railway, VPS, etc.).

## Cómo ponerlo en marcha

```bash
cd whatsapp-group-bot
npm install
node index.js
```

1. Al arrancar aparece un código QR en la terminal.
2. En el teléfono del número bot, abre WhatsApp → Ajustes → Dispositivos vinculados → Vincular un dispositivo, y escanea el QR.
3. La sesión queda guardada en `.wwebjs_auth`, así que la próxima vez no pide el QR.
4. Agrega ese número al grupo y hazlo admin del grupo.

## Configuración (`config.json`)

- `botName`: nombre del bot, `SIMsimd`.
- `allowedNumbers`: **la lista de TUS números** (con código de país, sin `+` ni espacios, ej. `"573001234567"`). Solo a estos números les llegan las difusiones de `!difundir`, y solo desde estos números se le puede escribir `!difundir` al bot por privado. Si la lista está vacía, la difusión no manda nada.
- `groupId`: déjalo vacío para que el bot actúe en todos los grupos donde esté. Para limitarlo a un grupo, pon el ID del grupo (termina en `@g.us`). Para saber el ID, el bot lo imprime en la consola cuando recibe un mensaje; también puedes pedirlo con un comando, o verlo en los registros.
- `welcomeMessage`: el mensaje de bienvenida. `{name}` se reemplaza por el nombre del que entra.
- `dailyMessageHour`: hora (0–23) del mensaje diario. Pon `null` para desactivarlo.
- `dailyMessage`: el texto del mensaje diario.
- `autoReplies`: palabras clave y su respuesta automática.

El estado del sorteo se guarda en `sorteo.json`, así que si el bot se reinicia, el sorteo abierto no se pierde.

## Comandos (en el grupo)

| Comando | Quién | Qué hace |
|---|---|---|
| `!ayuda` | Todos | Muestra los comandos |
| `!sorteo <premio>` | Solo admin | Abre un sorteo |
| `!participo` | Todos | Entrar al sorteo abierto |
| `!cerrar` | Solo admin | Cierra el sorteo y anuncia al ganador |
| `!estado` | Todos | Ver sorteo abierto y participantes |
| `!difundir <mensaje>` | Solo admin (en grupo) o solo tus números (por privado) | Mandar el mensaje a tus números permitidos |

## Advertencia

WhatsApp no tiene una API oficial para bots en grupos. Este bot automatiza WhatsApp Web, lo cual va contra las reglas de WhatsApp y puede terminar en baneo del número. Úsalo con un número secundario y no abuses (no mandes cientos de mensajes por minuto).
