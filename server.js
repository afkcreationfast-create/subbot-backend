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

  // Suppression du dossier de session précédent pour autoriser une nouvelle tentative
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

    sock.ev.on('messages.upsert', async (msg) => {
      await handleCommands(sock, msg);
    });

    // Attente active de la connexion initiale
    let codeSent = false;

    sock.ev.on('connection.update', async (update) => {
      const { connection, qr } = update;
      
      if (!sock.authState.creds.registered && !codeSent) {
        codeSent = true;
        await delay(3000);
        try {
          const code = await sock.requestPairingCode(num);
          const formattedCode = code?.match(/.{1,4}/g)?.join('-') || code;
          if (!res.headersSent) {
            return res.json({ code: formattedCode });
          }
        } catch (err) {
          console.error("Erreur génération code:", err);
          if (!res.headersSent) {
            return res.status(500).json({ error: 'Erreur lors de la génération du code' });
          }
        }
      }

      if (connection === 'open') {
        console.log(`[+] SubBot connecté pour : ${num}`);
      }
    });

  } catch (err) {
    console.error("Erreur serveur:", err);
    if (!res.headersSent) {
      return res.status(500).json({ error: 'Erreur interne du serveur' });
    }
  }
});

app.listen(PORT, () => {
  console.log(`Serveur prêt sur le port ${PORT}`);
});
