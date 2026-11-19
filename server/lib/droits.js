'use strict';
/* Rôles et droits d'un cabinet.

   owner         propriétaire : tout, y compris équipe, facturation, identité, domaine
   associe       valide et scelle les dossiers ; pas de réglages du cabinet
   collaborateur prépare les dossiers : crée, relance, confirme ou refuse des pièces ;
                 ne scelle pas (un associé doit valider)
   lecture       consulte seulement

   « member » est l'ancien rôle des invités : il garde exactement les droits
   qu'il avait (ceux d'un associé), pour ne rien retirer à personne. */

const ROLES = ['owner', 'associe', 'collaborateur', 'lecture'];
const INVITABLES = ['associe', 'collaborateur', 'lecture'];

const LIBELLES = {
  owner: 'Propriétaire',
  associe: 'Associé',
  collaborateur: 'Collaborateur',
  lecture: 'Lecture seule'
};

const DROITS = {
  owner: ['dossier.creer', 'dossier.relancer', 'piece.decider', 'dossier.message', 'dossier.sceller', 'cabinet.regler', 'equipe.gerer'],
  associe: ['dossier.creer', 'dossier.relancer', 'piece.decider', 'dossier.message', 'dossier.sceller'],
  collaborateur: ['dossier.creer', 'dossier.relancer', 'piece.decider', 'dossier.message'],
  lecture: []
};

function normaliser(role) {
  if (role === 'member') return 'associe';
  return ROLES.includes(role) ? role : 'lecture'; // inconnu : le moins de droits
}

function peut(role, action) {
  return DROITS[normaliser(role)].includes(action);
}

const MESSAGES = {
  'dossier.creer': "Votre rôle ne permet pas de créer un dossier.",
  'dossier.relancer': "Votre rôle ne permet pas de relancer un client.",
  'piece.decider': "Votre rôle ne permet pas de valider ou refuser une pièce.",
  'dossier.message': "Votre rôle ne permet pas d'écrire au client.",
  'dossier.sceller': "Seuls le propriétaire et les associés peuvent sceller un dossier.",
  'cabinet.regler': "Seul le propriétaire peut modifier les réglages du cabinet.",
  'equipe.gerer': "Seul le propriétaire peut gérer l'équipe."
};

const DROITS_DE = (role) => DROITS[normaliser(role)].slice();

module.exports = { ROLES, INVITABLES, LIBELLES, DROITS, DROITS_DE, normaliser, peut, MESSAGES };
