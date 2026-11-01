'use strict';
/* État d'abonnement des cabinets.
   FedaPay ne gère pas de récurrence native : Aura Collect stocke une date de fin d'accès
   (`paid_until`) et l'étend à chaque paiement confirmé. Le renouvellement est donc un
   cycle prépayé : relance avant échéance, puis suspension après grâce. */

const store = require('./store');
const plans = require('./plans');

const GRACE_DAYS = Number(process.env.BILLING_GRACE_DAYS || 7);
const TRIAL_DAYS = Number(process.env.BILLING_TRIAL_DAYS || 7);

async function q(text, params) {
  const { rows } = await store.pool.query(text, params);
  return rows;
}

/* Cabinet rattaché à cette instance. Un seul aujourd'hui ; devient un vrai multi-tenant
   dès que l'inscription autonome est branchée (la facturation est déjà clé sur cabinet_id). */
async function ensureCabinet() {
  const existing = await q('select * from aura.cabinets order by created_at asc limit 1');
  if (existing.length) return existing[0];

  const name = process.env.CABINET_NAME || 'Cabinet de démonstration';
  const email = process.env.CABINET_EMAIL || null;
  const rows = await q(
    `insert into aura.cabinets (name, slug, email, plan, plan_status, trial_ends_at)
     values ($1, $2, $3, 'starter', 'trialing', now() + ($4 || ' days')::interval)
     returning *`,
    [name, name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'cabinet', email, String(TRIAL_DAYS)]
  );
  return rows[0];
}

async function findById(id) {
  const rows = await q('select * from aura.cabinets where id = $1', [id]);
  return rows[0] || null;
}

async function findByEmail(email) {
  const rows = await q('select * from aura.cabinets where lower(email) = lower($1) order by created_at asc limit 1', [email]);
  return rows[0] || null;
}

/* Compte créé par un cabinet lui-même : aucun accès tant que le paiement n'est pas confirmé. */
async function createAccount({ name, email, passwordHash, plan }) {
  const slug = name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'cabinet';
  const rows = await q(
    `insert into aura.cabinets (name, slug, email, plan, plan_status, password_hash, trial_ends_at)
     values ($1, $2, $3, $4, 'trialing', $5, now() + ($6 || ' days')::interval)
     returning *`,
    [name, slug + '-' + Math.random().toString(36).slice(2, 7), email, plan, passwordHash, String(TRIAL_DAYS)]
  );
  return rows[0];
}

/* Réparation : un cabinet créé avant la mise en place des essais n'a aucune
   échéance. `accessOf` le classe alors « suspendu » et l'interface lui répond
   « Abonnement inactif » — sans lui offrir le moindre moyen de régulariser.
   On lui ouvre un essai à sa première connexion, plutôt que de le laisser
   dans une impasse. */
async function startTrialIfMissing(cabinet) {
  if (!cabinet) return cabinet;
  if (cabinet.trial_ends_at || cabinet.paid_until) return cabinet;
  const rows = await q(
    `update aura.cabinets
        set trial_ends_at = now() + ($1 || ' days')::interval, plan_status = 'trialing'
      where id = $2 and trial_ends_at is null and paid_until is null
      returning *`,
    [String(TRIAL_DAYS), cabinet.id]
  );
  return rows[0] || cabinet;
}

function accessOf(cabinet) {
  const now = Date.now();
  const paidUntil = cabinet.paid_until ? new Date(cabinet.paid_until).getTime() : null;
  const trialEnds = cabinet.trial_ends_at ? new Date(cabinet.trial_ends_at).getTime() : null;
  const limit = Math.max(paidUntil || 0, trialEnds || 0);

  let state = 'active';
  if (!limit) state = 'suspended';
  else if (now > limit) state = now - limit > GRACE_DAYS * 86400000 ? 'suspended' : 'grace';
  else if (cabinet.plan_status === 'trialing' && trialEnds && trialEnds >= now && (!paidUntil || paidUntil < now)) state = 'trialing';

  return {
    state,
    plan: cabinet.plan,
    planStatus: cabinet.plan_status,
    paidUntil: cabinet.paid_until,
    trialEndsAt: cabinet.trial_ends_at,
    graceDays: GRACE_DAYS,
    daysLeft: limit ? Math.max(0, Math.ceil((limit - now) / 86400000)) : 0,
    limits: (plans.get(cabinet.plan) || plans.get('starter')).limits
  };
}

async function createPayment({ cabinetId, plan, months, amount }) {
  const rows = await q(
    `insert into aura.payments (cabinet_id, plan, months, amount, currency, status)
     values ($1, $2, $3, $4, 'XOF', 'pending') returning *`,
    [cabinetId, plan, months, amount]
  );
  return rows[0];
}

async function attachCheckout(paymentId, checkout) {
  await q(
    `update aura.payments
        set fedapay_transaction_id = $2, fedapay_reference = $3, checkout_url = $4, updated_at = now()
      where id = $1`,
    [paymentId, checkout.id, checkout.reference || null, checkout.url]
  );
}

async function paymentByTransaction(transactionId) {
  const rows = await q('select * from aura.payments where fedapay_transaction_id = $1', [transactionId]);
  return rows[0] || null;
}

/* Étend l'accès du cabinet du nombre de mois achetés. Idempotent au niveau de l'appelant. */
async function grantPeriod(cabinetId, months, plan) {
  const rows = await q(
    `update aura.cabinets
        set paid_until = greatest(coalesce(paid_until, now()), now()) + ($2 || ' months')::interval,
            plan = coalesce($3, plan),
            plan_status = 'active',
            updated_at = now()
      where id = $1
      returning *`,
    [cabinetId, String(months), plan || null]
  );
  return rows[0];
}

/* Transition pending → approved une seule fois : évite un double crédit si le webhook
   et la page de retour arrivent tous les deux. */
async function approveOnce(transactionId, raw) {
  const rows = await q(
    `update aura.payments
        set status = 'approved', raw = coalesce($2, raw), updated_at = now()
      where fedapay_transaction_id = $1 and status <> 'approved'
      returning *`,
    [transactionId, raw || null]
  );
  return rows[0] || null;
}

async function markPayment(transactionId, status, raw) {
  const rows = await q(
    `update aura.payments
        set status = $2, raw = coalesce($3, raw), updated_at = now()
      where fedapay_transaction_id = $1
      returning *`,
    [transactionId, status, raw || null]
  );
  return rows[0] || null;
}

/* Une transaction jamais payée ne doit pas rester indéfiniment « pending ».
   On ne touche qu'aux paiements encore en attente. */
async function expireIfPending(transactionId, status, raw) {
  const rows = await q(
    `update aura.payments
        set status = $2, raw = coalesce($3, raw), updated_at = now()
      where fedapay_transaction_id = $1 and status = 'pending'
      returning *`,
    [transactionId, status, raw || null]
  );
  return rows[0] || null;
}

/* Remboursement : la période accordée est reprise immédiatement.
   Un remboursement partiel ou commercial se rattrape à la main depuis le back-office. */
async function revokeAccess(cabinetId) {
  const rows = await q(
    `update aura.cabinets
        set paid_until = least(coalesce(paid_until, now()), now()),
            plan_status = 'suspended',
            updated_at = now()
      where id = $1
      returning *`,
    [cabinetId]
  );
  return rows[0] || null;
}

/* Journal des événements webhook : la contrainte unique (name, object_id) sert d'anti-doublon. */
async function recordEvent(name, objectId, payload) {
  const rows = await q(
    `insert into aura.webhook_events (name, object_id, payload)
     values ($1, $2, $3)
     on conflict (name, object_id) do nothing
     returning id`,
    [name, objectId || null, payload || null]
  );
  return rows.length > 0;
}

async function recentPayments(cabinetId, limit = 20) {
  return q(
    `select id, plan, months, amount, currency, status, fedapay_reference, created_at
       from aura.payments where cabinet_id = $1 order by created_at desc limit $2`,
    [cabinetId, limit]
  );
}

module.exports = {
  ensureCabinet, findById, findByEmail, createAccount,
  accessOf, startTrialIfMissing, createPayment, attachCheckout, paymentByTransaction,
  grantPeriod, approveOnce, markPayment, expireIfPending, revokeAccess,
  recordEvent, recentPayments, GRACE_DAYS, TRIAL_DAYS
};
