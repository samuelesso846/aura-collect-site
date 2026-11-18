# Feuille de route — d'un outil de collecte à une plateforme de dossiers

*Écrite le 18 novembre 2026 à partir de l'état réel du code. Chaque phase laisse le site en ligne et testé.*

## Principe
On ne repart pas de zéro : la base est saine (paiement FedaPay, scellement, relances, équipe, journal en ajout seul, 65 tests, CI). Une réécriture complète ferait perdre des semaines pour zéro valeur client. On **renforce, puis on ajoute**, par phases livrables.
Ce qui donne le prix d'un logiciel, ce sont d'abord les cabinets qui paient ; le code sert à les servir et à rassurer l'acheteur.

## Phase 1 — Fondations (en cours)
- [x] Isolation des cabinets imposée par la base (migration 0004, politiques par ligne, 9 tests + serveur de test exécuté comme le rôle applicatif).
- [x] Dockerfile reproductible, vérification de santé.
- [ ] Hébergement sans mise en veille (décision du propriétaire : offre payante Render).
- [ ] Sauvegardes : vérifier la politique Supabase, tester une restauration.
- [ ] File de tâches pour les traitements lourds (IA, archives), reprise sur erreur.
- [ ] Contraintes CHECK (statuts, plans).

## Phase 2 — Valeur métier
- Extraction des champs de chaque pièce (numéros, dates, montants, identité) et contrôles croisés entre pièces.
- Score de complétude et alertes (pièce expirée, doublon, nom différent d'une pièce à l'autre).
- Workflows : étapes, échéances, relances automatiques, assignation.

## Phase 3 — Équipes et grands cabinets
- Rôles fins, validation à deux niveaux, double authentification, SSO.
- Plusieurs établissements, vue de direction, tableaux de bord de pilotage.
- API publique avec clés, webhooks, exports vers logiciels comptables.

## Phase 4 — Confiance de l'acheteur
- Documentation d'exploitation, plan de reprise, politique de sécurité, conformité données.
- Interface par composants réutilisables (étudier un framework seulement si les besoins l'exigent).
- Données de démonstration, parcours d'essai, mesures d'usage.

## Hors de portée du code
Signer des cabinets, valider les règles fiscales locales, prouver la fiabilité par l'usage. Ces points se traitent avec des cabinets réels.
