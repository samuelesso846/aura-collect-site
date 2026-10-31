'use strict';
/* Grille tarifaire Aura Collect — montants en FCFA (XOF, sans centimes).
   Modifiable sans redéploiement de code : chaque prix peut être surchargé par variable d'environnement. */

const DEFAULTS = {
  starter: { price: 20000,  annual: 200000,  users: 1, dossiers: 20,  label: 'Starter',  audience: 'Cabinet individuel' },
  pro:     { price: 55000,  annual: 550000,  users: 5, dossiers: 150, label: 'Pro',      audience: 'Cabinet de 2 à 5 personnes' },
  cabinet: { price: 130000, annual: 1300000, users: 0, dossiers: 800, label: 'Cabinet', audience: 'Structure multi-sites' }
};

function num(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : fallback;
}

function all() {
  return Object.keys(DEFAULTS).map((id) => {
    const d = DEFAULTS[id];
    const up = id.toUpperCase();
    return {
      id,
      label: d.label,
      audience: d.audience,
      price: num(process.env[`PLAN_${up}_PRICE`], d.price),
      annual: num(process.env[`PLAN_${up}_ANNUAL`], d.annual),
      currency: 'XOF',
      limits: { users: d.users, dossiers: d.dossiers }
    };
  });
}

function get(id) {
  return all().find((p) => p.id === String(id || '').toLowerCase()) || null;
}

/* Renvoie le montant à facturer pour un plan et une durée, ou null si l'entrée est invalide. */
function amountFor(planId, months) {
  const plan = get(planId);
  if (!plan) return null;
  const m = Number(months);
  if (m === 1) return plan.price;
  if (m === 12) return plan.annual;
  if (Number.isInteger(m) && m > 0 && m < 12) return plan.price * m;
  return null;
}

function publicList() {
  return all().map((p) => ({
    id: p.id, label: p.label, audience: p.audience,
    price: p.price, annual: p.annual, currency: p.currency, limits: p.limits
  }));
}

module.exports = { all, get, amountFor, publicList };
