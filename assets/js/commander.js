'use strict';
/* Page de commande — le formulaire est envoyé au serveur, qui redirige lui-même
   vers la page de paiement FedaPay. Aucune navigation pilotée par JavaScript :
   c'est ce qui rendait le parcours fragile dans les navigateurs restrictifs.

   Ce script ne sert qu'à l'affichage : cartes d'offres, total, message d'erreur. */

const $ = (id) => document.getElementById(id);

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

/* Pas de choix d'offre ici : l'offre (Starter, Pro, Cabinet) et son prix se choisissent
   dans l'espace, page « Abonnement », au moment de payer. */
function refresh() {
  $('total').innerHTML = '7 jours <small>offerts</small>';
}

function showError() {
  const code = new URLSearchParams(location.search).get('erreur');
  if (!code) return;
  $('orderErr').textContent = ERREURS[code] || ERREURS.technique;
  $('orderErr').classList.add('is-on');
}

function boot() {
  refresh();
  showError();
}

boot();
