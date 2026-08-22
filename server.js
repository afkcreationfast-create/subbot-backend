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
const PORT = process.env.PORT || 10000;

app.use(cors({ origin: '*' }));
app.use(express.json());

// Stockage global des sessions en mémoire
const sessions = {};

app.get('/', (req, res) => {
  res.send('AFK SubBot Backend prêt et opérationnel !');
});

// ROUTE ULTIME DE CONNEXION PAIRING
app.get('/pair', async (req, res) => {
  let num = req.query.number;
  if (!num) return res.status(400).json({ error: 'Numéro requis' });

  num = num.replace(/[^0-9]/g, '');
  const sessionPath = path.join(__dirname, `session_${num}`);

  try {
    // Si une session existe déjà, on la nettoie pour forcer un nouveau pairing propre
    if (!sessions[num]) {
      if (fs.existsSync(sessionPath)) {
        fs.rmSync(sessionPath, { recursive: true, force: true });
      }

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
        // Emulation officielle Chrome Linux ultra-compatible
        browser: ['Ubuntu', 'Chrome', '122.0.6261.94'],
        connectTimeoutMs: 120000,
        keepAliveIntervalMs: 30000,
        retryRequestDelayMs: 2000,
        markOnlineOnConnect: true
      });

      sessions[num] = sock;

      sock.ev.on('creds.update', saveCreds);

      sock.ev.on('messages.upsert', async (msg) => {
        await handleCommands(sock, msg);
      });

      sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;

        if (connection === 'open') {
          console.log(`[+] Connecté avec succès au numéro : ${num}`);
          await sock.sendMessage(`${num}@s.whatsapp.net`, { 
            text: `✅ *AFK SubBot Connecté !*\n\nVotre bot est désormais opérationnel. Tapez *.menu* pour commencer.` 
          });
        }

        if (connection === 'close') {
          const statusCode = lastDisconnect?.error?.output?.statusCode;
          const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
          
          delete sessions[num];

          if (shouldReconnect) {
            console.log(`[-] Reconnexion automatique pour ${num}...`);
          } else {
            console.log(`[-] Déconnexion définitive pour ${num}.`);
            if (fs.existsSync(sessionPath)) {
              fs.rmSync(sessionPath, { recursive: true, force: true });
            }
          }
        }
      });
    }

    const sock = sessions[num];

    // Attente de 3 secondes pour générer le code
    setTimeout(async () => {
      try {
        if (sock && !sock.authState.creds.registered) {
          const code = await sock.requestPairingCode(num);
          const formattedCode = code?.match(/.{1,4}/g)?.join('-') || code;
          if (!res.headersSent) return res.json({ code: formattedCode });
        } else {
          if (!res.headersSent) return res.json({ message: 'Session déjà connectée' });
        }
      } catch (e) {
        console.error('Erreur Pairing:', e);
        delete sessions[num];
        if (!res.headersSent) return res.status(500).json({ error: 'Échec de génération. Réessayez.' });
      }
    }, 3000);

  } catch (err) {
    console.error('Erreur serveur:', err);
    if (!res.headersSent) res.status(500).json({ error: 'Erreur interne du serveur' });
  }
});

app.listen(PORT, () => {
  console.log(`Serveur AFK SubBot actif sur le port ${PORT}`);
});
