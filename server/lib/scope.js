'use strict';
/* Contexte « cabinet » d'une requête.

   Après authentification, le reste de la requête (y compris ses suites
   asynchrones) s'exécute dans le contexte du cabinet connecté. Le module de
   base de données y lit l'identifiant pour poser `aura.cabinet_id` côté
   PostgreSQL, qui n'autorise alors que les lignes de ce cabinet. */
const { AsyncLocalStorage } = require('async_hooks');

const als = new AsyncLocalStorage();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function current() {
  const s = als.getStore();
  return s && UUID.test(String(s.cabinetId)) ? s.cabinetId : null;
}

/* Exécute fn dans le contexte du cabinet. */
function run(cabinetId, fn) {
  return als.run({ cabinetId }, fn);
}

/* Exécute fn hors de tout contexte (accès complet : jetons, webhooks…). */
function system(fn) {
  return als.run(null, fn);
}

module.exports = { current, run, system, UUID };
