const express = require('express');
const cors = require('cors');
const pino = require('pino');
const fs = require('fs');
const path = require('path');
const QRCode = require('qrcode');
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

const activeSockets = {};

app.get('/', (req, res) => {
  res.send('AFK SubBot Backend en ligne !');
});

// ROUTE 1 : Connexion par Code d'Appairage
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
      browser: Browsers.macOS('Desktop'),
      connectTimeoutMs: 60000,
      defaultQueryTimeoutMs: 0,
      keepAliveIntervalMs: 10000
    });

    activeSockets[num] = sock;

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('messages.upsert', async (msg) => {
      await handleCommands(sock, msg);
    });

    sock.ev.on('connection.update', async (update) => {
      const { connection } = update;
      if (connection === 'open') {
        console.log(`[+] Connecté pour le numéro : ${num}`);
        await sock.sendMessage(`${num}@s.whatsapp.net`, { 
          text: ` Connexion réussie ! Votre SubBot AFK est maintenant opérationnel. Tapez *.menu* pour afficher les commandes.` 
        });
      }
    });

    await delay(3000);
    const code = await sock.requestPairingCode(num);
    const formattedCode = code?.match(/.{1,4}/g)?.join('-') || code;
    
    return res.json({ code: formattedCode });

  } catch (err) {
    console.error("Erreur pairing:", err);
    if (!res.headersSent) {
      return res.status(500).json({ error: 'Erreur lors de la génération du code' });
    }
  }
});

// ROUTE 2 : Connexion par QR Code
app.get('/qr', async (req, res) => {
  let num = req.query.number || 'default_qr';
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

    let qrSent = false;

    sock.ev.on('connection.update', async (update) => {
      const { connection, qr } = update;

      if (qr && !qrSent) {
        qrSent = true;
        const qrImage = await QRCode.toDataURL(qr);
        if (!res.headersSent) {
          return res.json({ qr: qrImage });
        }
      }

      if (connection === 'open') {
        console.log(`[+] Connexion QR validée.`);
      }
    });

  } catch (err) {
    console.error("Erreur QR:", err);
    if (!res.headersSent) {
      return res.status(500).json({ error: 'Erreur génération QR' });
    }
  }
});

app.listen(PORT, () => {
  console.log(`Serveur prêt sur le port ${PORT}`);
});
