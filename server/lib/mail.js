'use strict';
/* Envoi d'emails. Avec RESEND_API_KEY : envoi réel. Sans clé : l'email est
   journalisé dans data/db.json (outbox) et affiché dans la console, pour que
   rien ne soit silencieusement perdu. */
const store = require('./store');

const FROM = process.env.MAIL_FROM || 'Aura Collect <bonjour@auracollect.fr>';
const KEY = process.env.RESEND_API_KEY || '';
const BASE = process.env.PUBLIC_BASE_URL || 'http://localhost:' + (process.env.PORT || 8788);

function mode() {
  return KEY ? 'resend' : 'outbox';
}

async function send({ to, subject, text, dossierId }) {
  const entry = {
    id: 'm_' + store.token(8),
    to, subject, text,
    dossierId: dossierId || '',
    mode: mode(),
    at: new Date().toISOString(),
    status: 'queued'
  };

  if (KEY) {
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + KEY,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ from: FROM, to: [to], subject, text })
      });
      const body = await res.text();
      if (!res.ok) throw new Error('Resend ' + res.status + ' : ' + body.slice(0, 200));
      entry.status = 'sent';
      entry.providerId = (() => { try { return JSON.parse(body).id || ''; } catch (_) { return ''; } })();
    } catch (err) {
      console.error('[mail] envoi échoué :', err.message);
      entry.status = 'failed';
      entry.error = err.message;
    }
  } else {
    entry.status = 'outbox';
    console.log('\n[mail:outbox] à ' + to + ' — ' + subject + '\n' + text + '\n');
  }

  await store.addOutbox(entry);
  return entry;
}

function portalLink(token, base) {
  return String(base || BASE).replace(/\/$/, '') + '/p/' + token;
}

async function sendMagicLink(dossier, base) {
  const link = portalLink(dossier.token, base);
  return send({
    to: dossier.email,
    subject: 'Vos documents à déposer — ' + (process.env.CABINET_NAME || 'votre cabinet'),
    text: [
      'Bonjour ' + dossier.client.split(' ')[0] + ',',
      '',
      'Votre cabinet vous demande quelques pièces justificatives.',
      'Déposez-les directement depuis votre téléphone, sans créer de compte :',
      '',
      link,
      '',
      'Chaque document est vérifié immédiatement : vous saurez tout de suite s\'il convient.',
      'Ce lien reste valable 30 jours.',
      '',
      'À bientôt.'
    ].join('\n'),
    dossierId: dossier.id
  });
}

async function sendReminder(dossier, missing, base) {
  return send({
    to: dossier.email,
    subject: 'Il manque ' + missing + ' document' + (missing > 1 ? 's' : '') + ' à votre dossier',
    text: [
      'Bonjour ' + dossier.client.split(' ')[0] + ',',
      '',
      'Votre dossier n\'est pas encore complet : il manque ' + missing + ' pièce' + (missing > 1 ? 's' : '') + '.',
      'Vous pouvez les déposer en deux minutes depuis ce lien :',
      '',
      portalLink(dossier.token, base),
      '',
      'Merci.'
    ].join('\n'),
    dossierId: dossier.id
  });
}

module.exports = { send, sendMagicLink, sendReminder, portalLink, mode };
