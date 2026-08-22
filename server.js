const express = require('express');
const cors = require('cors');
const pino = require('pino');
const {
  default: makeWASocket,
  useMultiFileAuthState,
  delay,
  makeCacheableSignalKeyStore
} = require('@whiskeysockets/baileys');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
  res.send('AFK SubBot Backend en ligne !');
});

app.get('/pair', async (req, res) => {
  let num = req.query.number;

  if (!num) {
    return res.status(400).json({ error: 'Numéro de téléphone requis' });
  }

  // Nettoyage du numéro
  num = num.replace(/[^0-9]/g, '');

  try {
    const { state, saveCreds } = await useMultiFileAuthState(`./session_${num}`);
    
    const sock = makeWASocket({
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'fatal' })),
      },
      printQRInTerminal: false,
      logger: pino({ level: 'fatal' })
    });

    sock.ev.on('creds.update', saveCreds);

    if (!sock.authState.creds.registered) {
      await delay(1500);
      const code = await sock.requestPairingCode(num);
      return res.json({ code: code });
    } else {
      return res.json({ code: 'DÉJÀ CONNECTÉ' });
    }

  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Erreur lors de la génération du code' });
  }
});

app.listen(PORT, () => {
  console.log(`Serveur prêt sur le port ${PORT}`);
});
