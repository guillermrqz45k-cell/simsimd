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

### Desde tu celular, GRATIS con Termux (recomendado)

SIMsimd usa Baileys, que no necesita navegador ni servidor: corre directo en tu celular con Termux, gratis, sin pagar nada.

1. **Instala Termux** desde F-Droid (busca "Termux" en la app F-Droid; la versión de Play Store está vieja, no la uses).
2. Abre Termux y escribe estos comandos, uno por uno:
   ```bash
   pkg update && pkg install nodejs git -y
   git clone https://github.com/guillermrqz45k-cell/simsimd
   cd simsimd
   npm install
   node index.js
   ```
3. Va a aparecer un código QR en la pantalla. Escanéalo con el WhatsApp del número bot: WhatsApp → Ajustes → Dispositivos vinculados → Vincular un dispositivo.
   - También puedes ver el QR grande abriendo en el navegador del celular `http://localhost:3000/qr`.
4. La sesión queda guardada en la carpeta `auth`, así que la próxima vez no pide el QR. Para que el bot siga corriendo, deja Termux abierto (o usa `npm install -g pm2` y `pm2 start index.js` para que siga en segundo plano).
5. Agrega ese número al grupo y hazlo admin del grupo.
6. Para usar el bot desde la web, abre en el navegador del celular `http://localhost:3000/admin` e ingresa tu clave de admin (por defecto `simsimd`, cámbiala con la variable `BOT_ADMIN_KEY`). Es tu panel web privado, con todo en un solo lugar: el botón de **encendido/apagado** del bot, una sección para **enviar la difusión desde la web** (escribes el mensaje y pones a cuántos números, de 1 a 100.000), un recuadro para **poner el número** al que quieres que le llegue la difusión (lo agregas y queda en la lista; también lo puedes eliminar), y el estado del **sorteo** abierto. Para más ajustes (bienvenida, mensajes, respuestas), abre `http://localhost:3000/config` con la misma clave.

> **¿Solo quieres mandar y ya?** Abre `http://localhost:3000/enviar` con tu clave: es una página sencilla con un solo recuadro para el mensaje, la cantidad opcional (de 1 a 100.000) y el botón de mandar. Nada más.

> El bot se vincula como un dispositivo más de WhatsApp (igual que WhatsApp Web). Usa un número secundario para el bot, no tu número principal: WhatsApp puede banear números que usan bots no oficiales.

### En una computadora o servidor

```bash
git clone https://github.com/guillermrqz45k-cell/simsimd
cd simsimd
npm install
node index.js
```

1. Al arrancar aparece un código QR en la terminal (y también en la página web `http://localhost:3000/qr`).
2. En el teléfono del número bot, abre WhatsApp → Ajustes → Dispositivos vinculados → Vincular un dispositivo, y escanea el QR.
3. La sesión queda guardada en la carpeta `auth`, así que la próxima vez no pide el QR.
4. Agrega ese número al grupo y hazlo admin del grupo.

## Configuración (`config.json` o desde la página web `/config`)

- `botName`: nombre del bot, `SIMsimd`.

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
| `/adm` o `!admin` | Solo admin (en grupo) o solo tus números (por privado) | Ver los comandos configurados y la configuración actual |

## Advertencia

WhatsApp no tiene una API oficial para bots en grupos. Este bot usa Baileys, que se conecta como un dispositivo más (igual que WhatsApp Web), lo cual va contra las reglas de WhatsApp y puede terminar en baneo del número. Úsalo con un número secundario y no abuses (no mandes cientos de mensajes por minuto).
