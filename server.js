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
const PORT = process.env.PORT || 8080; // Utilise 8080 ou process.env.PORT

app.use(cors({ origin: '*' }));
app.use(express.json());

// Route d'accueil pour éviter le "Cannot GET /"
app.get('/', (req, res) => {
  res.send('<h1>🚀 AFK SubBot Backend est en ligne et opérationnel !</h1>');
});

// Stockage permanent du socket
let globalSock = null;
let activePairingCode = null;

async function initWhatsApp(num) {
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
    connectTimeoutMs: 120000,
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
      console.log(`[+] Connecté à WhatsApp !`);
      activePairingCode = null;
    }
    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      if (statusCode !== DisconnectReason.loggedOut) {
        initWhatsApp(num);
      }
    }
  });

  // Laisser 6 secondes au socket pour s'enregistrer auprès de WhatsApp
  await new Promise((resolve) => setTimeout(resolve, 6000));

  if (!globalSock.authState.creds.registered) {
    const code = await globalSock.requestPairingCode(num);
    activePairingCode = code?.match(/.{1,4}/g)?.join('-') || code;
  }
}

app.get('/pair', async (req, res) => {
  let num = req.query.number;
  if (!num) return res.status(400).json({ error: 'Numéro requis' });
  num = num.replace(/[^0-9]/g, '');

  try {
    if (!globalSock || !globalSock.authState.creds.registered) {
      await initWhatsApp(num);
    }

    if (activePairingCode) {
      return res.json({ code: activePairingCode });
    } else {
      return res.json({ message: 'Connexion déjà établie ou en cours...' });
    }
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Erreur lors de la génération' });
  }
});

app.listen(PORT, () => {
  console.log(`Serveur AFK SubBot démarré sur le port ${PORT}`);
});
