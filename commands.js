module.exports = async (sock, msg) => {
  try {
    if (!msg.messages || !msg.messages[0]) return;
    const m = msg.messages[0];

    // NOTE: La condition m.key.fromMe a été retirée pour autoriser vos propres commandes (.menu, etc.)

    const from = m.key.remoteJid;
    const isGroup = from.endsWith('@g.us');
    const type = Object.keys(m.message || {})[0];

    const body = type === 'conversation' ? m.message.conversation :
                 type === 'extendedTextMessage' ? m.message.extendedTextMessage.text :
                 type === 'imageMessage' ? m.message.imageMessage.caption :
                 type === 'videoMessage' ? m.message.videoMessage.caption : '';

    const prefix = '.';
    if (!body.startsWith(prefix)) return;

    const args = body.slice(prefix.length).trim().split(/ +/);
    const command = args.shift().toLowerCase();
    const text = args.join(' ');

    switch (command) {
      case 'ping':
        const start = Date.now();
        await sock.sendMessage(from, { text: ` Pong ! Vitesse : ${Date.now() - start}ms` }, { quoted: m });
        break;

      case 'menu':
      case 'help':
        const menuText = `*─── AFK SUBBOT MENU ───*\n\n` +
                         `* Commandes Générales :*\n` +
                         `• *.ping* : Tester la réactivité\n` +
                         `• *.menu* : Afficher le menu\n` +
                         `• *.info* : Infos système\n` +
                         `• *.owner* : Informations du créateur\n` +
                         `• *.say <texte>* : Répéter un message\n\n` +
                         `* Groupe (Admin) :*\n` +
                         `• *.link* : Obtenir le lien du groupe\n` +
                         `• *.tagall* : Mentionner tout le monde\n` +
                         `• *.kick @user* : Expulser un membre\n` +
                         `• *.group <open/close>* : Ouvrir/Fermer le groupe\n\n` +
                         `_Propulsé par AFK Création et Marketing_`;
        await sock.sendMessage(from, { text: menuText }, { quoted: m });
        break;

      case 'info':
        await sock.sendMessage(from, { 
          text: `*AFK SubBot v1.0*\nSystème d'automatisation actif.\nPrêt à exécuter vos commandes.` 
        }, { quoted: m });
        break;

      case 'owner':
        await sock.sendMessage(from, { 
          text: `*Créateur :* AFK Création et Marketing\n*Support :* Service client actif.` 
        }, { quoted: m });
        break;

      case 'say':
        if (!text) return await sock.sendMessage(from, { text: ' Entrez un texte à répéter.' }, { quoted: m });
        await sock.sendMessage(from, { text: text });
        break;

      case 'link':
        if (!isGroup) return await sock.sendMessage(from, { text: ' Commande réservée aux groupes.' }, { quoted: m });
        try {
          const code = await sock.groupInviteCode(from);
          await sock.sendMessage(from, { text: `https://chat.whatsapp.com/${code}` }, { quoted: m });
        } catch (e) {
          await sock.sendMessage(from, { text: ' Le bot doit être admin pour obtenir le lien.' }, { quoted: m });
        }
        break;

      case 'tagall':
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
          return await sock.sendMessage(from, { text: ' Mentionnez un membre.' }, { quoted: m });
        }
        try {
          await sock.groupParticipantsUpdate(from, mentioned, 'remove');
          await sock.sendMessage(from, { text: ' Membre retiré.' }, { quoted: m });
        } catch (e) {
          await sock.sendMessage(from, { text: ' Action impossible. Vérifiez les permissions admin.' }, { quoted: m });
        }
        break;

      case 'group':
        if (!isGroup) return;
        if (text === 'close' || text === 'fermer') {
          await sock.groupSettingUpdate(from, 'announcement');
          await sock.sendMessage(from, { text: ' Groupe fermé.' }, { quoted: m });
        } else if (text === 'open' || text === 'ouvrir') {
          await sock.groupSettingUpdate(from, 'not_announcement');
          await sock.sendMessage(from, { text: ' Groupe ouvert.' }, { quoted: m });
        }
        break;

      default:
        break;
    }
  } catch (err) {
    console.error('Erreur commande:', err);
  }
};
