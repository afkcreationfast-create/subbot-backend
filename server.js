const express = require('express');
const cors = require('cors');
const pino = require('pino');
const fs = require('fs');
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

// Interface graphique moderne et épurée
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="fr">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>AFK SubBot - Connexion WhatsApp</title>
        <style>
            body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background: #0f172a; color: #f8fafc; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; }
            .card { background: #1e293b; padding: 30px; border-radius: 16px; box-shadow: 0 10px 25px rgba(0,0,0,0.3); width: 100%; max-width: 400px; text-align: center; }
            h2 { margin-bottom: 10px; color: #38bdf8; }
            p { color: #94a3b8; font-size: 14px; margin-bottom: 20px; }
            input { width: 100%; padding: 12px; border-radius: 8px; border: 1px solid #334155; background: #0f172a; color: #fff; font-size: 16px; margin-bottom: 15px; box-sizing: border-box; text-align: center; }
            button { background: #0284c7; color: white; border: none; padding: 12px; width: 100%; border-radius: 8px; font-size: 16px; font-weight: bold; cursor: pointer; transition: background 0.2s; }
            button:hover { background: #0369a1; }
            #result { margin-top: 20px; font-size: 18px; font-weight: bold; word-break: break-all; }
            .code-box { background: #0f172a; border: 2px dashed #38bdf8; padding: 15px; border-radius: 8px; font-size: 24px; letter-spacing: 2px; color: #38bdf8; margin-top: 10px; }
        </style>
    </head>
    <body>
        <div class="card">
            <h2>AFK SubBot</h2>
            <p>Entrez votre numéro WhatsApp avec l'indicatif (ex: 509XXXXXXXX)</p>
            <input type="text" id="phone" placeholder="509XXXXXXXX">
            <button onclick="getCode()">Générer le Code</button>
            <div id="result"></div>
        </div>
        <script>
            async function getCode() {
                const phone = document.getElementById('phone').value.trim();
                const resultDiv = document.getElementById('result');
                if(!phone) { alert('Veuillez entrer un numéro valide'); return; }
                resultDiv.innerHTML = "Génération en cours...";
                try {
                    const res = await fetch('/pair?number=' + phone);
                    const data = await res.json();
                    if(data.code) {
                        resultDiv.innerHTML = 'Code d\\'appairage :<div class="code-box">' + data.code + '</div>';
                    } else {
                        resultDiv.innerHTML = '<span style="color: #f43f5e;">' + (data.message || data.error) + '</span>';
                    }
                } catch(e) {
                    resultDiv.innerHTML = '<span style="color: #f43f5e;">Erreur de connexion au serveur.</span>';
                }
            }
        </script>
    </body>
    </html>
  `);
});

async function initWhatsApp(num, resObj = null) {
  const sessionPath = path.join(__dirname, `session_${num}`);
  const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
  const { version } = await fetchLatestBaileysVersion();

  globalSock = makeWASocket({
    version,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'fatal' })),
    },
    printQRInTerminal: false,
    logger: pino({ level: 'fatal' }),
    browser: ['Ubuntu', 'Chrome', '122.0.6261.94'],
    connectTimeoutMs: 60000,
    keepAliveIntervalMs: 30000,
    markOnlineOnConnect: true
  });

  globalSock.ev.on('creds.update', saveCreds);

  globalSock.ev.on('messages.upsert', async (msg) => {
    await handleCommands(globalSock, msg);
  });

  globalSock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect } = update;
    if (connection === 'open') {
      console.log(`[+] Connecté à WhatsApp avec succès !`);
      activePairingCode = null;
    }
    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      if (statusCode !== DisconnectReason.loggedOut) {
        setTimeout(() => initWhatsApp(num), 5000);
      }
    }
  });

  if (!globalSock.authState.creds.registered) {
    // Attente de sécurité pour laisser la socket s'initialiser correctement
    await new Promise((resolve) => setTimeout(resolve, 3000));
    try {
      const code = await globalSock.requestPairingCode(num);
      activePairingCode = code?.match(/.{1,4}/g)?.join('-') || code;
      if (resObj && !resObj.headersSent) {
        resObj.json({ code: activePairingCode });
      }
    } catch (err) {
      console.error("Erreur pairing code:", err);
      if (resObj && !resObj.headersSent) {
        resObj.status(500).json({ error: 'Impossible de générer le code, réessayez.' });
      }
    }
  } else {
    if (resObj && !resObj.headersSent) {
      resObj.json({ message: 'Ce numéro est déjà enregistré et connecté !' });
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
    await initWhatsApp(num, res);
  } catch (err) {
    console.error(err);
    if (!res.headersSent) {
      return res.status(500).json({ error: 'Erreur interne du serveur' });
    }
  }
});

app.listen(PORT, () => {
  console.log(`Serveur AFK SubBot démarré sur le port ${PORT}`);
});
