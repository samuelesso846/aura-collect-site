'use strict';
/* Création de compte + paiement. Le montant est toujours recalculé côté serveur :
   le navigateur ne fait que transmettre un choix d'offre et de durée. */

const fmt = new Intl.NumberFormat('fr-FR');
const $ = (id) => document.getElementById(id);

let PLANS = [];
let SELECTED = 'starter';
let MONTHS = 1;

function amountOf(planId, months) {
  const plan = PLANS.find((p) => p.id === planId);
  if (!plan) return 0;
  if (months === 12) return plan.annual;
  return plan.price * months;
}

function renderPlans() {
  const box = $('planChoice');
  box.innerHTML = '';
  for (const plan of PLANS) {
    const id = 'plan-' + plan.id;
    const label = document.createElement('label');
    label.className = 'ord__opt' + (plan.id === SELECTED ? ' is-on' : '');
    label.innerHTML = `
      <input type="radio" name="plan" id="${id}" value="${plan.id}" ${plan.id === SELECTED ? 'checked' : ''}>
      <span><b>${plan.label}</b><span>${plan.limits.users ? plan.limits.users + ' utilisateurs' : 'Utilisateurs illimités'} · ${fmt.format(plan.limits.dossiers)} dossiers</span></span>
      <span class="prix">${fmt.format(plan.price)} FCFA</span>`;
    label.addEventListener('click', () => {
      SELECTED = plan.id;
      for (const el of box.querySelectorAll('.ord__opt')) el.classList.remove('is-on');
      label.classList.add('is-on');
      refresh();
    });
    box.appendChild(label);
  }
}

function refresh() {
  const plan = PLANS.find((p) => p.id === SELECTED);
  const total = amountOf(SELECTED, MONTHS);
  $('total').innerHTML = fmt.format(total) + ' <small>FCFA</small>';
  $('sumPlan').textContent = plan ? plan.label : '—';
  $('sumCycle').textContent = MONTHS === 12 ? '12 mois (2 offerts)' : '1 mois';
}

async function submit(event) {
  event.preventDefault();
  const err = $('orderErr');
  err.classList.remove('is-on');
  const btn = $('submitBtn');
  const original = btn.innerHTML;
  btn.disabled = true;
  btn.textContent = 'Redirection vers le paiement…';

  // Un appel qui ne répond jamais laisserait le bouton bloqué sans explication.
  const stop = new AbortController();
  const timer = setTimeout(() => stop.abort(), 45000);

  try {
    const res = await fetch('/api/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: stop.signal,
      body: JSON.stringify({
        name: $('nom').value.trim(),
        email: $('email').value.trim(),
        password: $('password').value,
        plan: SELECTED,
        months: MONTHS
      })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Impossible de créer le compte.');

    // Certains aperçus intégrés bloquent la sortie vers un autre domaine sans
    // afficher d'erreur : on propose toujours le lien en clair.
    $('payLink').href = data.url;
    $('payFallback').hidden = false;
    window.location.href = data.url;

    // Si la navigation est bloquée, le bouton reste utilisable.
    setTimeout(() => { btn.disabled = false; btn.innerHTML = original; }, 2500);
  } catch (ex) {
    btn.disabled = false;
    btn.innerHTML = original;
    err.textContent = ex.name === 'AbortError'
      ? 'Le serveur met trop de temps à répondre. Réessayez dans un instant.'
      : ex.message;
    err.classList.add('is-on');
  } finally {
    clearTimeout(timer);
  }
}

async function boot() {
  try {
    const res = await fetch('/api/billing/plans');
    const data = await res.json();
    PLANS = data.plans || [];
    if (!data.payment || !data.payment.configured) {
      $('orderErr').textContent = 'Le paiement n’est pas encore activé. Réessayez plus tard.';
      $('orderErr').classList.add('is-on');
    }
    const wanted = new URLSearchParams(location.search).get('plan');
    if (wanted && PLANS.some((p) => p.id === wanted)) SELECTED = wanted;
    renderPlans();
    refresh();
  } catch (ex) {
    $('orderErr').textContent = 'Service indisponible. Réessayez dans un instant.';
    $('orderErr').classList.add('is-on');
  }
}

$('cycleChoice').addEventListener('click', (ev) => {
  const opt = ev.target.closest('.ord__opt');
  if (!opt) return;
  MONTHS = Number(opt.dataset.months);
  for (const el of $('cycleChoice').querySelectorAll('.ord__opt')) el.classList.toggle('is-on', el === opt);
  refresh();
});

$('orderForm').addEventListener('submit', submit);

boot();
