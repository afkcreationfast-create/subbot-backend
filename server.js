const express = require('express');
const cors = require('cors');
const pino = require('pino');
const fs = require('fs');
const path = require('path');
const QRCode = require('qrcode');
const {
  default: makeWASocket,
  useMultiFileAuthState,
  makeCacheableSignalKeyStore,
  fetchLatestBaileysVersion,
  DisconnectReason
} = require('@whiskeysockets/baileys');

const handleCommands = require('./commands');

const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors({ origin: '*' }));
app.use(express.json());

// Stockage global des instances de sockets actives
const activeSockets = {};

app.get('/', (req, res) => {
  res.send('AFK SubBot Backend prêt et opérationnel !');
});

// ROUTE CODE PAIRING AMÉLIORÉE
app.get('/pair', async (req, res) => {
  let num = req.query.number;
  if (!num) return res.status(400).json({ error: 'Numéro de téléphone requis' });

  num = num.replace(/[^0-9]/g, '');
  const sessionPath = path.join(__dirname, `session_${num}`);

  try {
    const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
      version,
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'fatal' })),
      },
      printQRInTerminal: false,
      logger: pino({ level: 'fatal' }),
      // Emulation Windows Chrome beaucoup plus stable avec Baileys v7
      browser: ['Windows', 'Chrome', '120.0.0.0'],
      connectTimeoutMs: 60000,
      keepAliveIntervalMs: 30000,
      markOnlineOnConnect: true
    });

    activeSockets[num] = sock;

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('messages.upsert', async (msg) => {
      await handleCommands(sock, msg);
    });

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect } = update;

      if (connection === 'open') {
        console.log(`[+] Connecté avec succès : ${num}`);
        await sock.sendMessage(`${num}@s.whatsapp.net`, { 
          text: `Connexion réussie ! Votre SubBot AFK est prêt. Tapez *.menu* pour commencer.` 
        });
      }

      if (connection === 'close') {
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
        console.log(`[-] Connexion fermée pour ${num}. Reconnexion automatique : ${shouldReconnect}`);
        
        if (statusCode === DisconnectReason.loggedOut) {
          if (fs.existsSync(sessionPath)) {
            fs.rmSync(sessionPath, { recursive: true, force: true });
          }
        }
      }
    });

    // Génération du code pairing après 5 secondes pour laisser le temps au socket d'être prêt
    setTimeout(async () => {
      try {
        if (!sock.authState.creds.registered) {
          const code = await sock.requestPairingCode(num);
          const formattedCode = code?.match(/.{1,4}/g)?.join('-') || code;
          if (!res.headersSent) return res.json({ code: formattedCode });
        } else {
          if (!res.headersSent) return res.json({ message: 'Déjà connecté ou session existante' });
        }
      } catch (e) {
        console.error('Erreur Pairing:', e);
        if (!res.headersSent) return res.status(500).json({ error: 'Erreur lors de la génération du code.' });
      }
    }, 5000);

  } catch (err) {
    console.error('Erreur Serveur:', err);
    if (!res.headersSent) res.status(500).json({ error: 'Erreur interne du serveur' });
  }
});

app.listen(PORT, () => {
  console.log(`Serveur AFK SubBot démarré sur le port ${PORT}`);
});
