'use strict';
/* Page de commande — le formulaire est envoyé au serveur, qui redirige lui-même
   vers la page de paiement FedaPay. Aucune navigation pilotée par JavaScript :
   c'est ce qui rendait le parcours fragile dans les navigateurs restrictifs.

   Ce script ne sert qu'à l'affichage : cartes d'offres, total, message d'erreur. */

const $ = (id) => document.getElementById(id);

let PLANS = [];
let SELECTED = 'starter';

const ERREURS = {
  nom: 'Indiquez le nom de votre cabinet.',
  email: 'Cette adresse email n’est pas valide.',
  mdp: 'Le mot de passe doit contenir au moins 8 caractères.',
  offre: 'Cette offre ou cette durée n’est pas disponible.',
  existe: 'Un compte existe déjà avec cette adresse. Connectez-vous depuis l’espace cabinet.',
  config: 'Le paiement n’est pas encore activé sur ce site.',
  trop: 'Trop de tentatives. Patientez quelques minutes avant de réessayer.',
  technique: 'Une erreur est survenue de notre côté. Réessayez dans un instant.'
};

/* Prix mensuel affiché à côté de chaque offre. Le tarif est déjà renvoyé par
   /api/billing/plans ; il manquait simplement à l'affichage. */
function formatPrix(value, currency) {
  const n = Number(value || 0);
  if (!n) return '';
  const net = String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return net + ' ' + (currency === 'XOF' ? 'FCFA' : currency || '') + '/mois';
}

function renderPlans() {
  const box = $('planChoice');
  box.innerHTML = '';
  for (const plan of PLANS) {
    const label = document.createElement('label');
    label.className = 'ord__opt' + (plan.id === SELECTED ? ' is-on' : '');
    const userTxt = plan.limits.users
      ? plan.limits.users + ' utilisateur' + (plan.limits.users > 1 ? 's' : '')
      : 'utilisateurs illimités';
    label.innerHTML = `
      <input type="radio" name="plan" value="${plan.id}" ${plan.id === SELECTED ? 'checked' : ''}>
      <span><b>${plan.label}</b><span>${plan.limits.dossiers} dossiers · ${userTxt}</span></span>
      <span class="prix">${formatPrix(plan.price, plan.currency)}</span>`;
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
  $('total').innerHTML = '7 jours <small>offerts</small>';
}

function showError() {
  const code = new URLSearchParams(location.search).get('erreur');
  if (!code) return;
  $('orderErr').textContent = ERREURS[code] || ERREURS.technique;
  $('orderErr').classList.add('is-on');
}

async function boot() {
  const wanted = new URLSearchParams(location.search).get('plan');
  if (wanted) SELECTED = wanted;

  try {
    const res = await fetch('/api/billing/plans');
    const data = await res.json();
    PLANS = data.plans || [];
    if (!PLANS.some((p) => p.id === SELECTED)) SELECTED = PLANS.length ? PLANS[0].id : 'starter';
    renderPlans();
    refresh();
  } catch (ex) {
    $('orderErr').textContent = 'Impossible de charger les offres. Rechargez la page.';
    $('orderErr').classList.add('is-on');
  }
  showError();
}

boot();
