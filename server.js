const express = require('express');
const cors = require('cors');
const pino = require('pino');
const fs = require('fs');
const path = require('path');
const {
  default: makeWASocket,
  useMultiFileAuthState,
  delay,
  makeCacheableSignalKeyStore
} = require('@whiskeysockets/baileys');

const handleCommands = require('./commands');

const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors({ origin: '*' }));
app.use(express.json());

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
      browser: ['Ubuntu', 'Chrome', '20.0.04']
    });

    sock.ev.on('creds.update', saveCreds);

    // Écoute des messages pour exécuter les commandes
    sock.ev.on('messages.upsert', async (msg) => {
      await handleCommands(sock, msg);
    });

    await delay(3000);
    const code = await sock.requestPairingCode(num);
    return res.json({ code: code });

  } catch (err) {
    console.error("Erreur pairing:", err);
    return res.status(500).json({ error: 'Erreur lors de la génération du code' });
  }
});

app.listen(PORT, () => {
  console.log(`Serveur prêt sur le port ${PORT}`);
});
