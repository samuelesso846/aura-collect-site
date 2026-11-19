'use strict';
/* Contrôles croisés d'un dossier : ce qu'une pièce ne dit pas seule, mais que
   l'ensemble révèle (nom différent d'une pièce à l'autre, pièce expirée, même
   fichier déposé deux fois).

   Règle de conduite : ces contrôles ALERTENT le cabinet, ils ne rejettent jamais
   une pièce et ne s'adressent pas au client. Une lecture automatique peut se
   tromper ; la décision reste humaine. Fonctions pures, sans base ni réseau. */

/* Pièces qui portent le nom de la personne du dossier. On exclut volontairement
   les pièces de garant et celles d'une société. */
const PIECES_PERSONNE = new Set([
  'piece-identite', 'justif-domicile', 'rib', 'bulletins-salaire', 'contrat-travail', 'contrat',
  'attestation-employeur', 'domiciliation-salaire', 'acte-naissance', 'casier-judiciaire',
  'releves-bancaires', 'carte-vitale', 'cnss-salarie', 'diplomes'
]);

const TITRES = new Set(['m', 'mr', 'mme', 'mlle', 'monsieur', 'madame', 'mademoiselle', 'sieur', 'dame', 'epouse', 'ep', 'nee', 'ne', 'veuve', 'dr', 'me']);

function normaliserNom(s) {
  return String(s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z\s'-]/g, ' ')
    .split(/[\s'-]+/)
    .filter((t) => t.length > 1 && !TITRES.has(t));
}

/* Deux noms sont compatibles si tous les mots du plus court se retrouvent dans
   le plus long (ordre libre, prénoms facultatifs). « KOFI Mensah » et
   « Mensah Kofi Yao » passent ; « Mensah » et « Agbeko » non. */
function nomsCompatibles(a, b) {
  const ta = normaliserNom(a), tb = normaliserNom(b);
  if (!ta.length || !tb.length) return true; // rien de lisible : pas d'alerte
  const [court, long] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  const setLong = new Set(long);
  const communs = court.filter((t) => setLong.has(t)).length;
  if (communs === court.length) return true;
  return court.length >= 3 && communs / court.length >= 0.67;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const joursEntre = (a, b) => Math.round((b - a) / 864e5);
const lisible = (iso) => iso.split('-').reverse().join('/');

function controles(pieces, now = new Date()) {
  const out = [];
  const lues = (pieces || []).filter((p) => p && ['ok', 'review', 'valide'].includes(p.status));

  /* 1. Pièces expirées ou qui expirent bientôt */
  for (const p of lues) {
    const exp = p.champs && p.champs.dateExpiration;
    if (!exp || !DATE.test(exp)) continue;
    const reste = joursEntre(now, new Date(exp + 'T23:59:59Z'));
    if (reste < 0) {
      out.push({ niveau: 'alerte', code: 'expiree', pieces: [p.key],
        message: `« ${p.label} » semble expirée depuis le ${lisible(exp)}.` });
    } else if (reste <= 30) {
      out.push({ niveau: 'info', code: 'expire_bientot', pieces: [p.key],
        message: `« ${p.label} » expire le ${lisible(exp)} (dans ${reste} jour${reste > 1 ? 's' : ''}).` });
    }
  }

  /* 2. Même titulaire d'une pièce à l'autre */
  const avecNom = lues.filter((p) => PIECES_PERSONNE.has(p.key) && p.champs && p.champs.titulaire && normaliserNom(p.champs.titulaire).length);
  if (avecNom.length >= 2) {
    const reference = avecNom.find((p) => p.key === 'piece-identite') || avecNom[0];
    for (const p of avecNom) {
      if (p === reference) continue;
      if (!nomsCompatibles(reference.champs.titulaire, p.champs.titulaire)) {
        out.push({ niveau: 'alerte', code: 'nom_different', pieces: [reference.key, p.key],
          message: `Le nom lu sur « ${p.label} » (${p.champs.titulaire}) ne correspond pas à celui de « ${reference.label} » (${reference.champs.titulaire}). À vérifier : nom d'épouse, homonyme ou document d'un tiers.` });
      }
    }
  }

  /* 3. Même fichier déposé pour deux pièces différentes */
  const parEmpreinte = new Map();
  for (const p of lues) {
    if (!p.empreinte) continue;
    if (!parEmpreinte.has(p.empreinte)) parEmpreinte.set(p.empreinte, []);
    parEmpreinte.get(p.empreinte).push(p);
  }
  for (const groupe of parEmpreinte.values()) {
    if (groupe.length < 2) continue;
    out.push({ niveau: 'alerte', code: 'doublon', pieces: groupe.map((p) => p.key),
      message: `Le même fichier a été déposé pour « ${groupe.map((p) => p.label).join(' » et « ')} ».` });
  }

  /* 4. Pièce acceptée alors que la lecture n'a pas de certitude */
  for (const p of lues) {
    if (p.status === 'ok' && p.confidence !== null && p.confidence !== undefined && p.confidence < 0.7) {
      out.push({ niveau: 'info', code: 'confiance_moyenne', pieces: [p.key],
        message: `« ${p.label} » a été acceptée avec une certitude moyenne (${Math.round(p.confidence * 100)} %). Un coup d'œil est conseillé.` });
    }
  }
  return out;
}

/* Score de préparation : part des pièces acceptées, et dossier « prêt » seulement
   si tout est accepté et qu'aucune alerte n'est ouverte. Une pièce « à contrôler »
   compte à moitié : elle est déposée mais pas encore tranchée. */
function score(pieces, alertes) {
  const liste = pieces || [];
  const total = liste.length;
  const ok = liste.filter((p) => p.status === 'ok' || p.status === 'valide').length;
  const aControler = liste.filter((p) => p.status === 'review').length;
  const refuses = liste.filter((p) => p.status === 'ko').length;
  const attente = liste.filter((p) => p.status === 'wait').length;
  const nbAlertes = (alertes || []).filter((a) => a.niveau === 'alerte').length;
  const pct = total ? Math.round(((ok + aControler * 0.5) / total) * 100) : 0;
  return {
    pct, total, ok, aControler, refuses, attente, alertes: nbAlertes,
    pret: total > 0 && ok === total && nbAlertes === 0
  };
}

/* Dossiers à relancer : des pièces manquantes, et aucune activité depuis `jours`. */
function aRelancer(dossiers, now = new Date(), jours = 3) {
  const limite = now.getTime() - jours * 864e5;
  return (dossiers || [])
    .filter((d) => !d.sealed && d.pieces.some((p) => p.status === 'wait' || p.status === 'ko'))
    .filter((d) => {
      const t = Date.parse(d.lastActivity || d.createdAt);
      return Number.isFinite(t) && t < limite;
    })
    .map((d) => ({
      id: d.id, client: d.clientName || d.client,
      manquantes: d.pieces.filter((p) => p.status === 'wait' || p.status === 'ko').length,
      joursSilence: Math.floor((now.getTime() - Date.parse(d.lastActivity || d.createdAt)) / 864e5)
    }))
    .sort((a, b) => b.joursSilence - a.joursSilence);
}

module.exports = { controles, score, aRelancer, nomsCompatibles, normaliserNom, PIECES_PERSONNE };
