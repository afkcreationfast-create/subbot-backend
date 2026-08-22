const express = require('express');
const cors = require('cors');
const pino = require('pino');
const path = require('path');
const qrcode = require('qrcode'); // Nécessite d'ajouter "qrcode" dans package.json
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
let latestQR = null;
let isConnected = false;

// --- INTERFACE GRAPHIQUE AVEC AFFICHAGE DU QR CODE ---
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
            button { background: #0284c7; color: white; border: none; padding: 12px; width: 100%; border-radius: 6px; font-size: 16px; font-weight: bold; cursor: pointer; margin-top: 10px; }
            button:hover { background: #0369a1; }
            #qr-container { margin-top: 20px; background: #fff; padding: 15px; border-radius: 8px; display: inline-block; }
            #qr-container img { width: 220px; height: 220px; }
            .status { font-weight: bold; margin-top: 15px; font-size: 16px; }
        </style>
    </head>
    <body>
        <div class="card">
            <h2>AFK Bot Manager</h2>
            <p>Scannez le QR Code ci-dessous avec votre application WhatsApp</p>
            <div id="status" class="status" style="color: #38bdf8;">Chargement du QR Code...</div>
            <div id="qr-container"><img id="qr-img" src="" alt="Génération du QR Code..." style="display:none;"></div>
            <button onclick="location.reload()">Rafraîchir le QR Code</button>
        </div>
        <script>
            async function checkStatus() {
                try {
                    const res = await fetch('/status');
                    const data = await res.json();
                    if(data.connected) {
                        document.getElementById('status').innerHTML = '<span style="color: #22c55e;">Connecté avec succès ! 🚀</span>';
                        document.getElementById('qr-container').style.display = 'none';
                    } else if(data.qrImage) {
                        document.getElementById('qr-img').src = data.qrImage;
                        document.getElementById('qr-img').style.display = 'block';
                        document.getElementById('status').innerHTML = 'Scannez avec WhatsApp';
                    }
                } catch(e) {}
            }
            setInterval(checkStatus, 3000);
            checkStatus();
        </script>
    </body>
    </html>
  `);
});

app.get('/status', async (req, res) => {
  if (isConnected) {
    return res.json({ connected: true });
  }
  if (latestQR) {
    try {
      const qrImage = await qrcode.toDataURL(latestQR);
      return res.json({ connected: false, qrImage });
    } catch (e) {
      return res.json({ connected: false, qrImage: null });
    }
  }
  res.json({ connected: false, qrImage: null });
});

// --- CONNEXION WHATSAPP VIA QR CODE ---
async function startWhatsApp() {
  const sessionPath = path.join(__dirname, `session_auth`);
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
    const { connection, lastDisconnect, qr } = update;
    
    if (qr) {
      latestQR = qr;
      console.log('[+] Nouveau QR Code généré ! Scannez-le depuis votre interface web.');
    }

    if (connection === 'open') {
      console.log('[+] WhatsApp connecté avec succès !');
      isConnected = true;
      latestQR = null;
    }

    if (connection === 'close') {
      isConnected = false;
      const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
      if (shouldReconnect) {
        setTimeout(() => startWhatsApp(), 5000);
      }
    }
  });
}

app.listen(PORT, () => {
  console.log(`Serveur démarré sur le port ${PORT}`);
  startWhatsApp();
});
