'use strict';
/* Envoi d'emails. Avec RESEND_API_KEY : envoi réel. Sans clé : l'email est
   journalisé dans data/db.json (outbox) et affiché dans la console, pour que
   rien ne soit silencieusement perdu. */
const store = require('./store');

const FROM = process.env.MAIL_FROM || 'Aura Collect <bonjour@auracollect.fr>';
const KEY = process.env.RESEND_API_KEY || '';
const BASE = process.env.PUBLIC_BASE_URL || 'http://localhost:' + (process.env.PORT || 8788);

/* Deux transports réels, au choix :
   - Resend (RESEND_API_KEY), propre et journalisé, mais impose un domaine vérifié ;
   - SMTP (SMTP_USER / SMTP_PASS, mot de passe d'application Google), qui part
     immédiatement depuis une adresse existante, sans domaine à configurer.
   Sans l'un des deux, l'email est journalisé dans l'outbox — rien ne part. */
const SMTP_HOST = process.env.SMTP_HOST || (process.env.SMTP_USER ? 'smtp.gmail.com' : '');
const SMTP_PORT = Number(process.env.SMTP_PORT || 587);
const SMTP_USER = process.env.SMTP_USER || '';
const SMTP_PASS = process.env.SMTP_PASS || '';

function mode() {
  if (KEY) return 'resend';
  if (SMTP_HOST && SMTP_USER && SMTP_PASS) return 'smtp';
  return 'outbox';
}

async function sendSmtp({ to, subject, text }) {
  const nodemailer = require('nodemailer');

  /* Deux ports essayés dans l'ordre, IPv4 forcé : sur un hébergeur, le port 587
     peut être filtré sans réponse (on attend alors jusqu'au délai d'expiration),
     et l'IPv6 n'est pas toujours routé. Le 465 sert de repli. */
  const essais = SMTP_PORT === 465
    ? [{ port: 465, secure: true }, { port: 587, secure: false }]
    : [{ port: SMTP_PORT, secure: SMTP_PORT === 465 }, { port: 465, secure: true }];

  /* Gmail n'autorise l'envoi que depuis le compte authentifié (ou une adresse
     qu'il a validée). Une signature du type bonjour@auracollect.fr serait
     refusée : on repart de SMTP_USER, en gardant le nom affiché. */
  const nom = (FROM.match(/^([^<]*?)\s*</) || [])[1] || 'Aura Collect';
  const from = FROM.indexOf(SMTP_USER) !== -1 ? FROM : `${nom.trim()} <${SMTP_USER}>`;

  let derniere;
  for (const essai of essais) {
    try {
      const transport = nodemailer.createTransport({
        host: SMTP_HOST,
        port: essai.port,
        secure: essai.secure,
        requireTLS: !essai.secure,
        family: 4,
        connectionTimeout: 15000,
        greetingTimeout: 15000,
        socketTimeout: 30000,
        auth: { user: SMTP_USER, pass: SMTP_PASS }
      });
      const info = await transport.sendMail({ from, to, subject, text });
      return info && info.messageId ? String(info.messageId) : '';
    } catch (err) {
      derniere = err;
      console.error(`[mail] SMTP port ${essai.port} : ${err.code || ''} ${err.message}`);
    }
  }
  throw derniere;
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
  } else if (mode() === 'smtp') {
    try {
      entry.providerId = await sendSmtp({ to, subject, text });
      entry.status = 'sent';
    } catch (err) {
      console.error('[mail] SMTP échoué :', err.message);
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

async function sendMagicLink(dossier, base, nomCabinet) {
  const link = portalLink(dossier.token, base);
  /* Le nom vient du cabinet qui envoie, pas d'une variable globale : deux
     cabinets ne doivent jamais signer leurs liens du même nom. */
  const signature = nomCabinet || process.env.CABINET_NAME || 'votre cabinet';
  return send({
    to: dossier.email,
    subject: 'Vos documents à déposer — ' + signature,
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

async function sendReminder(dossier, missing, base, nomCabinet) {
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

function sendPasswordReset(cabinet, link) {
  return send({
    to: cabinet.email,
    subject: 'Réinitialisation de votre mot de passe',
    text: [
      'Bonjour,',
      '',
      'Vous avez demandé à réinitialiser le mot de passe de votre espace ' + (cabinet.name || 'Aura Collect') + '.',
      'Ce lien est valable une heure et ne sert qu\'une fois :',
      '',
      link,
      '',
      'Si vous n\'êtes pas à l\'origine de cette demande, ignorez ce message :',
      'votre mot de passe actuel reste valable.'
    ].join('\n')
  });
}

module.exports = { send, sendMagicLink, sendReminder, sendPasswordReset, portalLink, mode };
