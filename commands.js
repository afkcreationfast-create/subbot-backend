module.exports = async (sock, msg) => {
  try {
    if (!msg.messages || !msg.messages[0]) return;
    const m = msg.messages[0];
    if (m.key.fromMe) return;

    const from = m.key.remoteJid;
    const isGroup = from.endsWith('@g.us');
    const type = Object.keys(m.message || {})[0];

    // Extrait le texte de n'importe quel type de message
    const body = type === 'conversation' ? m.message.conversation :
                 type === 'extendedTextMessage' ? m.message.extendedTextMessage.text :
                 type === 'imageMessage' ? m.message.imageMessage.caption :
                 type === 'videoMessage' ? m.message.videoMessage.caption : '';

    const prefix = '.';
    if (!body.startsWith(prefix)) return;

    const args = body.slice(prefix.length).trim().split(/ +/);
    const command = args.shift().toLowerCase();
    const text = args.join(' ');

    // Informations sur l'expéditeur
    const sender = isGroup ? m.key.participant : m.key.remoteJid;

    switch (command) {
      // ─── COMMANDES GÉNÉRALES ───
      case 'ping':
        const start = Date.now();
        await sock.sendMessage(from, { text: ` Pong ! Vitesse : ${Date.now() - start}ms` }, { quoted: m });
        break;

      case 'menu':
      case 'help':
        const menuText = `*─── AFK SUBBOT MENU ───*\n\n` +
                         `* Commandes Générales :*\n` +
                         `• *.ping* : Vitesse du bot\n` +
                         `• *.menu* : Liste des commandes\n` +
                         `• *.info* : Infos sur le SubBot\n` +
                         `• *.owner* : Contact du propriétaire\n` +
                         `• *.say <texte>* : Répéter un message\n\n` +
                         `* Groupe (Admin) :*\n` +
                         `• *.link* : Lien d'invitation du groupe\n` +
                         `• *.tagall* : Mentionner tous les membres\n` +
                         `• *.kick @user* : Expulser un membre\n` +
                         `• *.group <open/close>* : Ouvrir/Fermer le groupe\n\n` +
                         `_Propulsé par AFK Création et Marketing_`;
        await sock.sendMessage(from, { text: menuText }, { quoted: m });
        break;

      case 'info':
        await sock.sendMessage(from, { 
          text: `*AFK SubBot v1.0*\nDéveloppé pour la gestion automatique WhatsApp.\nStatut : Connecté et Actif.` 
        }, { quoted: m });
        break;

      case 'owner':
        await sock.sendMessage(from, { 
          text: `*Créateur :* AFK Création et Marketing\n*Contact :* Support AFK` 
        }, { quoted: m });
        break;

      case 'say':
        if (!text) return await sock.sendMessage(from, { text: ' Entrez un texte à répéter.' }, { quoted: m });
        await sock.sendMessage(from, { text: text });
        break;

      // ─── COMMANDES DE GROUPE ───
      case 'link':
      case 'linkgroup':
        if (!isGroup) return await sock.sendMessage(from, { text: ' Cette commande marche uniquement dans un groupe.' }, { quoted: m });
        try {
          const code = await sock.groupInviteCode(from);
          await sock.sendMessage(from, { text: `https://chat.whatsapp.com/${code}` }, { quoted: m });
        } catch (e) {
          await sock.sendMessage(from, { text: ' Le bot doit être Admin du groupe pour obtenir le lien.' }, { quoted: m });
        }
        break;

      case 'tagall':
      case 'everyone':
        if (!isGroup) return;
        try {
          const groupMetadata = await sock.groupMetadata(from);
          const participants = groupMetadata.participants;
          let mentionsText = `* MENTION GÉNÉRALE *\n\nMessage : ${text || 'Aucun'}\n\n`;
          let mentions = [];

          for (let mem of participants) {
            mentionsText += `@${mem.id.split('@')[0]}\n`;
            mentions.push(mem.id);
          }

          await sock.sendMessage(from, { text: mentionsText, mentions: mentions }, { quoted: m });
        } catch (e) {
          console.error(e);
        }
        break;

      case 'kick':
        if (!isGroup) return;
        const mentioned = m.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
        if (mentioned.length === 0) {
          return await sock.sendMessage(from, { text: ' Mentionnez l\'utilisateur à expulser avec @.' }, { quoted: m });
        }
        try {
          await sock.groupParticipantsUpdate(from, mentioned, 'remove');
          await sock.sendMessage(from, { text: ' Membre retiré avec succès.' }, { quoted: m });
        } catch (e) {
          await sock.sendMessage(from, { text: ' Impossible de retirer le membre. Assurez-vous que le bot est Admin.' }, { quoted: m });
        }
        break;

      case 'group':
        if (!isGroup) return;
        if (text === 'close' || text === 'fermer') {
          await sock.groupSettingUpdate(from, 'announcement');
          await sock.sendMessage(from, { text: ' Groupe fermé. Seuls les admins peuvent envoyer des messages.' }, { quoted: m });
        } else if (text === 'open' || text === 'ouvrir') {
          await sock.groupSettingUpdate(from, 'not_announcement');
          await sock.sendMessage(from, { text: ' Groupe ouvert à tous les membres.' }, { quoted: m });
        } else {
          await sock.sendMessage(from, { text: ' Utilisation : `.group open` ou `.group close`' }, { quoted: m });
        }
        break;

      default:
        break;
    }
  } catch (err) {
    console.error('Erreur commande:', err);
  }
};
