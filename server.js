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
  Browsers
} = require('@whiskeysockets/baileys');

const handleCommands = require('./commands');

const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors({ origin: '*' }));
app.use(express.json());

app.get('/', (req, res) => {
  res.send('AFK SubBot Backend prêt !');
});

// ROUTE CODE PAIRING ULTRA-RAPIDE
app.get('/pair', async (req, res) => {
  let num = req.query.number;
  if (!num) return res.status(400).json({ error: 'Numéro requis' });

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
      browser: Browsers.macOS('Desktop'),
      connectTimeoutMs: 30000,
      keepAliveIntervalMs: 15000
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('messages.upsert', async (msg) => {
      await handleCommands(sock, msg);
    });

    sock.ev.on('connection.update', async (update) => {
      const { connection } = update;
      if (connection === 'open') {
        console.log(`[+] Connecté : ${num}`);
        await sock.sendMessage(`${num}@s.whatsapp.net`, { 
          text: `Connexion réussie ! Votre SubBot est prêt. Tapez *.menu* pour commencer.` 
        });
      }
    });

    // Génération instantanée sans délai d'attente
    setTimeout(async () => {
      try {
        const code = await sock.requestPairingCode(num);
        const formattedCode = code?.match(/.{1,4}/g)?.join('-') || code;
        if (!res.headersSent) return res.json({ code: formattedCode });
      } catch (e) {
        if (!res.headersSent) return res.status(500).json({ error: 'Erreur réseau, réessayez' });
      }
    }, 1000);

  } catch (err) {
    if (!res.headersSent) res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ROUTE QR CODE INSTANTANÉ
app.get('/qr', async (req, res) => {
  let num = req.query.number || 'default';
  num = num.replace(/[^0-9]/g, '');
  const sessionPath = path.join(__dirname, `session_qr_${num}`);

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
      browser: Browsers.macOS('Desktop')
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('messages.upsert', async (msg) => {
      await handleCommands(sock, msg);
    });

    let sent = false;
    sock.ev.on('connection.update', async (update) => {
      const { qr } = update;
      if (qr && !sent) {
        sent = true;
        const qrImage = await QRCode.toDataURL(qr);
        if (!res.headersSent) return res.json({ qr: qrImage });
      }
    });

  } catch (err) {
    if (!res.headersSent) res.status(500).json({ error: 'Erreur QR' });
  }
});

app.listen(PORT, () => {
  console.log(`Serveur démarré sur le port ${PORT}`);
});
