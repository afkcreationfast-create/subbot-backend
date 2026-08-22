const express = require('express');
const cors = require('cors');
const pino = require('pino');
const path = require('path');
const {
  default: makeWASocket,
  useMultiFileAuthState,
  makeCacheableSignalKeyStore,
  fetchLatestBaileysVersion,
  DisconnectReason
} = require('@whiskeysockets/baileys');

const handleCommands = require('./commands');

const app = express();
const PORT = process.env.PORT || 8080;

app.use(cors({ origin: '*' }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

let globalSock = null;
let activePairingCode = null;

// --- INTERFACE GRAPHIQUE INTÉGRÉE ---
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="fr">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>AFK Création et Marketing - WhatsApp Bot</title>
        <style>
            body { font-family: Arial, sans-serif; background: #0f172a; color: #fff; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; }
            .card { background: #1e293b; padding: 30px; border-radius: 12px; box-shadow: 0 4px 20px rgba(0,0,0,0.5); width: 100%; max-width: 380px; text-align: center; }
            h2 { color: #38bdf8; margin-bottom: 5px; }
            p { color: #94a3b8; font-size: 13px; margin-bottom: 20px; }
            input { width: 100%; padding: 12px; border-radius: 6px; border: 1px solid #334155; background: #0f172a; color: #fff; font-size: 16px; margin-bottom: 15px; box-sizing: border-box; text-align: center; }
            button { background: #0284c7; color: white; border: none; padding: 12px; width: 100%; border-radius: 6px; font-size: 16px; font-weight: bold; cursor: pointer; }
            button:hover { background: #0369a1; }
            #result { margin-top: 20px; font-size: 16px; word-break: break-all; }
            .code-box { background: #0f172a; border: 2px dashed #38bdf8; padding: 12px; border-radius: 6px; font-size: 22px; letter-spacing: 2px; color: #38bdf8; margin-top: 10px; font-weight: bold; }
        </style>
    </head>
    <body>
        <div class="card">
            <h2>AFK Bot Manager</h2>
            <p>Entrez votre numéro WhatsApp (ex: 509XXXXXXXX)</p>
            <input type="text" id="phone" placeholder="509XXXXXXXX">
            <button onclick="getCode()">Obtenir le Code</button>
            <div id="result"></div>
        </div>
        <script>
            async function getCode() {
                const phone = document.getElementById('phone').value.trim();
                const resDiv = document.getElementById('result');
                if(!phone) { alert('Entrez un numéro'); return; }
                resDiv.innerHTML = "Génération en cours, patientez...";
                try {
                    const response = await fetch('/pair?number=' + phone);
                    const data = await response.json();
                    if(data.code) {
                        resDiv.innerHTML = 'Votre code d\\'appairage :<div class="code-box">' + data.code + '</div>';
                    } else {
                        resDiv.innerHTML = '<span style="color: #f43f5e;">' + (data.message || data.error) + '</span>';
                    }
                } catch(e) {
                    resDiv.innerHTML = '<span style="color: #f43f5e;">Erreur de requête.</span>';
                }
            }
        </script>
    </body>
    </html>
  `);
});

// --- LOGIQUE WHATSAPP & BAILEYS ---
async function startWhatsApp(num, res = null) {
  const sessionPath = path.join(__dirname, `session_${num}`);
  const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
  const { version } = await fetchLatestBaileysVersion();

  globalSock = makeWASocket({
    version,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' })),
    },
    printQRInTerminal: false,
    logger: pino({ level: 'silent' }),
    browser: ['Ubuntu', 'Chrome', '122.0.6261.94'],
    connectTimeoutMs: 60000,
    keepAliveIntervalMs: 30000,
    markOnlineOnConnect: true
  });

  globalSock.ev.on('creds.update', saveCreds);

  globalSock.ev.on('messages.upsert', async (msg) => {
    try {
      await handleCommands(globalSock, msg);
    } catch (err) {
      console.error("Erreur commande:", err);
    }
  });

  globalSock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect } = update;
    if (connection === 'open') {
      console.log('[+] WhatsApp connecté avec succès !');
      activePairingCode = null;
    }
    if (connection === 'close') {
      const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
      if (shouldReconnect) {
        setTimeout(() => startWhatsApp(num), 5000);
      }
    }
  });

  // Si non enregistré, on attend brièvement que la websocket s'ouvre puis on demande le code
  if (!globalSock.authState.creds.registered) {
    await new Promise(resolve => setTimeout(resolve, 4000));
    try {
      const code = await globalSock.requestPairingCode(num);
      activePairingCode = code?.match(/.{1,4}/g)?.join('-') || code;
      if (res && !res.headersSent) {
        return res.json({ code: activePairingCode });
      }
    } catch (err) {
      console.error("Erreur pairing code:", err);
      if (res && !res.headersSent) {
        return res.status(500).json({ error: "Échec de génération du code." });
      }
    }
  } else {
    if (res && !res.headersSent) {
      return res.json({ message: "Ce numéro est déjà connecté." });
    }
  }
}

app.get('/pair', async (req, res) => {
  let num = req.query.number;
  if (!num) return res.status(400).json({ error: 'Numéro requis' });
  num = num.replace(/[^0-9]/g, '');

  try {
    if (globalSock && globalSock.authState.creds.registered) {
      return res.json({ message: 'Session déjà active.' });
    }
    await startWhatsApp(num, res);
  } catch (err) {
    console.error(err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Erreur interne' });
    }
  }
});

app.listen(PORT, () => {
  console.log(`Serveur démarré sur le port ${PORT}`);
});
