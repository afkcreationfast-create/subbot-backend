const express = require('express');
const cors = require('cors');
const pino = require('pino');
const fs = require('fs');
const path = require('path');
const {
  default: makeWASocket,
  useMultiFileAuthState,
  delay,
  makeCacheableSignalKeyStore,
  Browsers
} = require('@whiskeysockets/baileys');

const handleCommands = require('./commands');

const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors({ origin: '*' }));
app.use(express.json());

// Stockage global des instances de sockets actifs
const activeSockets = {};

app.get('/', (req, res) => {
  res.send('AFK SubBot Backend en ligne !');
});

app.get('/pair', async (req, res) => {
  let num = req.query.number;

  if (!num) {
    return res.status(400).json({ error: 'Numéro de téléphone requis' });
  }

  num = num.replace(/[^0-9]/g, '');
  const sessionPath = path.join(__dirname, `session_${num}`);

  // Nettoyage de la session précédente si existante
  if (fs.existsSync(sessionPath)) {
    fs.rmSync(sessionPath, { recursive: true, force: true });
  }

  try {
    const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
    
    const sock = makeWASocket({
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'fatal' })),
      },
      printQRInTerminal: false,
      logger: pino({ level: 'fatal' }),
      browser: Browsers.macOS('Desktop'), // Signature officielle reconnue par WhatsApp
      connectTimeoutMs: 60000,
      defaultQueryTimeoutMs: 0,
      keepAliveIntervalMs: 10000
    });

    activeSockets[num] = sock;

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('messages.upsert', async (msg) => {
      await handleCommands(sock, msg);
    });

    sock.ev.on('connection.update', (update) => {
      const { connection } = update;
      if (connection === 'open') {
        console.log(`[+] SubBot connecté avec succès pour : ${num}`);
      }
    });

    await delay(3000);
    const code = await sock.requestPairingCode(num);
    
    // Formater le code avec le tiret au milieu (ex: XXXX-XXXX)
    const formattedCode = code?.match(/.{1,4}/g)?.join('-') || code;
    
    return res.json({ code: formattedCode });

  } catch (err) {
    console.error("Erreur pairing:", err);
    return res.status(500).json({ error: 'Erreur lors de la génération du code' });
  }
});

app.listen(PORT, () => {
  console.log(`Serveur prêt sur le port ${PORT}`);
});
