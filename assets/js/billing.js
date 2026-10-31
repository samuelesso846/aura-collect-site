'use strict';
/* Page abonnement — affiche l'état d'accès et déclenche un paiement FedaPay.
   Le montant est toujours recalculé côté serveur : le navigateur ne fait que choisir plan + durée. */

const fmt = new Intl.NumberFormat('fr-FR');
let MONTHS = 1;
let DATA = null;

const $ = (id) => document.getElementById(id);

function money(n) {
  return fmt.format(n) + ' FCFA';
}

function dateFr(value) {
  if (!value) return '—';
  return new Date(value).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' });
}

function stateLabel(access) {
  if (!access) return { text: 'Inconnu', cls: 'is-warn' };
  if (access.state === 'active') return { text: 'Actif', cls: '' };
  if (access.state === 'trialing') return { text: 'Période d’essai', cls: '' };
  if (access.state === 'grace') return { text: 'Échéance dépassée — grâce', cls: 'is-warn' };
  return { text: 'Accès suspendu', cls: 'is-off' };
}

function renderHero() {
  const access = DATA.access;
  const chip = stateLabel(access);
  const el = $('stateChip');
  el.className = 'bill-hero__state ' + chip.cls;
  el.innerHTML = '<i></i><span>' + chip.text + '</span>';

  const plan = (DATA.plans || []).find((p) => p.id === access.plan);
  const lines = [];
  lines.push('<b>' + (plan ? plan.label : access.plan) + '</b>');
  if (access.state === 'trialing') {
    lines.push('Essai jusqu’au ' + dateFr(access.trialEndsAt) + ' · ' + access.daysLeft + ' j restants');
  } else if (access.paidUntil) {
    lines.push('Payé jusqu’au ' + dateFr(access.paidUntil) + ' · ' + access.daysLeft + ' j restants');
  } else {
    lines.push('Aucune période active');
  }
  $('heroMeta').innerHTML = lines.join('');
}

function renderPlans() {
  const grid = $('planGrid');
  grid.innerHTML = '';
  const current = DATA.access.plan;

  for (const plan of DATA.plans) {
    const amount = MONTHS === 12 ? plan.annual : plan.price;
    const monthly = MONTHS === 12 ? Math.round(plan.annual / 12) : null;

    const card = document.createElement('article');
    card.className = 'bill-card' + (plan.id === current ? ' is-current' : '');
    if (plan.id === current) card.insertAdjacentHTML('beforeend', '<span class="bill-card__tag">Offre actuelle</span>');

    card.insertAdjacentHTML('beforeend', `
      <h3>${plan.label}</h3>
      <p class="bill-card__aud">${plan.audience}</p>
      <p class="bill-card__price">${money(amount)}<span> / ${MONTHS === 12 ? 'an' : 'mois'}</span></p>
      ${monthly ? `<p class="bill-card__aud" style="min-height:0;margin-top:4px">soit ${money(monthly)} par mois</p>` : ''}
      <ul>
        <li>${plan.limits.users ? plan.limits.users + ' utilisateurs' : 'Utilisateurs illimités'}</li>
        <li>${fmt.format(plan.limits.dossiers)} dossiers par mois</li>
        <li>Portail client et relances automatiques</li>
        <li>Vérification IA et dossier scellé</li>
      </ul>
      <button class="btn btn--primary btn--sm" data-plan="${plan.id}">
        ${plan.id === current ? 'Prolonger' : 'Souscrire'}
      </button>
    `);

    card.querySelector('button').addEventListener('click', (ev) => checkout(plan.id, ev.currentTarget));
    grid.appendChild(card);
  }
}

function renderHistory() {
  const box = $('historyBox');
  const rows = DATA.payments || [];
  if (!rows.length) {
    box.innerHTML = '<p class="bill-empty">Aucun paiement enregistré pour le moment.</p>';
    return;
  }
  const body = rows.map((p) => `
    <tr>
      <td>${dateFr(p.created_at)}</td>
      <td>${p.plan} · ${p.months} mois</td>
      <td>${money(p.amount)}</td>
      <td class="st st--${p.status}">${p.status}</td>
      <td>${p.fedapay_reference || '—'}</td>
    </tr>`).join('');

  box.innerHTML = `
    <table class="bill-table">
      <thead><tr><th>Date</th><th>Offre</th><th>Montant</th><th>Statut</th><th>Référence</th></tr></thead>
      <tbody>${body}</tbody>
    </table>`;
}

async function checkout(planId, button) {
  const original = button.textContent;
  button.disabled = true;
  button.textContent = 'Ouverture du paiement…';
  try {
    const res = await fetch('/api/billing/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan: planId, months: MONTHS })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Paiement indisponible.');
    window.location.href = data.url;
  } catch (err) {
    button.disabled = false;
    button.textContent = original;
    alert(err.message);
  }
}

async function boot() {
  try {
    const plansRes = await fetch('/api/billing/plans');
    const plansData = await plansRes.json();

    const stateRes = await fetch('/api/billing');
    if (stateRes.status === 401) {
      document.querySelector('main').innerHTML =
        '<div class="auth__card" style="margin:60px auto"><h1>Connexion requise</h1>' +
        '<p>Connectez-vous à votre espace cabinet pour gérer l’abonnement.</p>' +
        '<p style="margin-top:16px"><a class="btn btn--primary btn--sm" href="app">Aller à la connexion</a></p></div>';
      return;
    }
    const state = await stateRes.json();
    DATA = { plans: plansData.plans, access: state.access, payments: state.payments, cabinet: state.cabinet };
    $('graceDays').textContent = plansData.billing.graceDays;
    if (DATA.cabinet && DATA.cabinet.name) $('cabinetName').textContent = DATA.cabinet.name;

    renderHero();
    renderPlans();
    renderHistory();
  } catch (err) {
    $('heroMeta').innerHTML = '<b>Indisponible</b>Réessayez dans un instant';
    console.error(err);
  }
}

$('cycleToggle').addEventListener('click', (ev) => {
  const btn = ev.target.closest('button[data-months]');
  if (!btn) return;
  MONTHS = Number(btn.dataset.months);
  for (const b of $('cycleToggle').querySelectorAll('button')) b.classList.toggle('is-on', b === btn);
  if (DATA) renderPlans();
});

boot();
