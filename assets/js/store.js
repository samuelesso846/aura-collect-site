/* Aura Collect — état partagé de la démo (localStorage)
   Le tableau de bord et le portail client lisent/écrivent le même état :
   un dépôt fait dans le portail apparaît immédiatement côté cabinet. */
(function (global) {
  'use strict';

  var KEY = 'aura_collect_demo_v1';
  var CABINET = 'Cabinet Lemaire & Associés';

  var TEMPLATES = [
    {
      id: 'bilan', name: 'Bilan annuel', family: 'Expert-comptable', icon: 'doc',
      pieces: [
        { key: 'avis-imposition', label: "Avis d'imposition 2025", rule: '12 mois' },
        { key: 'piece-identite', label: "Pièce d'identité", rule: 'en cours de validité' },
        { key: 'releves-bancaires', label: '3 derniers relevés bancaires', rule: '3 mois' },
        { key: 'justif-domicile', label: 'Justificatif de domicile', rule: '3 mois' },
        { key: 'liasse-fiscale', label: 'Liasse fiscale N-1', rule: 'signée' }
      ]
    },
    {
      id: 'tva', name: 'Déclarations de TVA', family: 'Expert-comptable', icon: 'doc',
      pieces: [
        { key: 'declarations-tva', label: 'Déclarations de TVA 2025', rule: '4 trimestres' },
        { key: 'releves-bancaires', label: 'Relevés bancaires professionnels', rule: '3 mois' },
        { key: 'justif-activite', label: "Justificatif d'activité", rule: 'moins de 12 mois' },
        { key: 'piece-identite', label: "Pièce d'identité du gérant", rule: 'en cours de validité' }
      ]
    },
    {
      id: 'creation', name: 'Création de société', family: 'Expert-comptable', icon: 'doc',
      pieces: [
        { key: 'piece-identite', label: "Pièce d'identité", rule: 'en cours de validité' },
        { key: 'justif-domicile', label: 'Justificatif de domicile', rule: '3 mois' },
        { key: 'depot-capital', label: 'Attestation de dépôt du capital', rule: 'originale' },
        { key: 'statuts', label: 'Statuts signés', rule: 'toutes pages' },
        { key: 'rib', label: 'RIB professionnel', rule: 'au nom de la société' }
      ]
    },
    {
      id: 'credit', name: 'Crédit immobilier', family: 'Courtier', icon: 'home',
      pieces: [
        { key: 'piece-identite', label: "Pièce d'identité", rule: 'en cours de validité' },
        { key: 'justif-domicile', label: 'Justificatif de domicile', rule: '3 mois' },
        { key: 'bulletins-salaire', label: '3 derniers bulletins de salaire', rule: '3 mois' },
        { key: 'avis-imposition', label: "2 derniers avis d'imposition", rule: 'N-1 et N-2' },
        { key: 'releves-bancaires', label: '3 derniers relevés bancaires', rule: 'toutes pages' },
        { key: 'contrat-travail', label: 'Contrat de travail', rule: 'signé' }
      ]
    },
    {
      id: 'locataire', name: 'Dossier locataire', family: 'Immobilier', icon: 'home',
      pieces: [
        { key: 'piece-identite', label: "Pièce d'identité", rule: 'en cours de validité' },
        { key: 'justif-domicile', label: 'Justificatif de domicile', rule: '3 mois' },
        { key: 'bulletins-salaire', label: '3 derniers bulletins de salaire', rule: '3 mois' },
        { key: 'contrat-travail', label: 'Contrat de travail', rule: 'signé' },
        { key: 'avis-imposition', label: "Avis d'imposition", rule: 'N-1' }
      ]
    },
    {
      id: 'onboarding', name: 'Onboarding salarié', family: 'RH & freelance', icon: 'user',
      pieces: [
        { key: 'piece-identite', label: "Pièce d'identité", rule: 'en cours de validité' },
        { key: 'rib', label: 'RIB', rule: 'au nom du salarié' },
        { key: 'carte-vitale', label: 'Carte vitale', rule: 'lisible' },
        { key: 'contrat', label: 'Contrat de travail signé', rule: 'toutes pages' }
      ]
    },
    {
      id: 'surmesure', name: 'Dossier sur-mesure', family: 'Personnalisé', icon: 'plus',
      pieces: [
        { key: 'piece-1', label: 'Première pièce', rule: 'selon vos règles' },
        { key: 'piece-2', label: 'Deuxième pièce', rule: 'selon vos règles' },
        { key: 'piece-3', label: 'Troisième pièce', rule: 'selon vos règles' }
      ]
    }
  ];

  function template(id) {
    for (var i = 0; i < TEMPLATES.length; i++) if (TEMPLATES[i].id === id) return TEMPLATES[i];
    return TEMPLATES[0];
  }

  function uid(n) {
    var s = 'abcdefghijkmnpqrstuvwxyz23456789', out = '';
    for (var i = 0; i < (n || 10); i++) out += s[Math.floor(Math.random() * s.length)];
    return out;
  }

  function slug(s) {
    return String(s)
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
  }

  function daysAgo(n) {
    return new Date(Date.now() - n * 864e5).toISOString();
  }

  function seed() {
    function pieces(tplId, statuses) {
      return template(tplId).pieces.map(function (p, i) {
        var st = statuses[i] || { status: 'wait' };
        return {
          key: p.key, label: p.label, rule: p.rule,
          status: st.status, file: st.file || '', reason: st.reason || '', at: st.at || ''
        };
      });
    }

    return {
      cabinet: CABINET,
      plan: 'Pro',
      dossiers: [
        {
          id: 'd1', token: 'dupont7k2m', client: 'Jean Dupont', email: 'jean.dupont@email.fr',
          template: 'bilan', createdAt: daysAgo(1), lastActivity: daysAgo(0.2),
          pieces: pieces('bilan', [
            { status: 'ok', file: 'avis-imposition-2025.pdf', at: daysAgo(0.8) },
            { status: 'ok', file: 'cni-verso.jpg', at: daysAgo(0.7) },
            { status: 'ok', file: 'releves-q3.pdf', at: daysAgo(0.6) },
            { status: 'ok', file: 'quittance-septembre.pdf', at: daysAgo(0.5) },
            { status: 'ok', file: 'liasse-2025.pdf', at: daysAgo(0.3) }
          ])
        },
        {
          id: 'd2', token: 'moreau4p9x', client: 'Claire Moreau', email: 'claire.moreau@email.fr',
          template: 'credit', createdAt: daysAgo(4), lastActivity: daysAgo(0.4),
          pieces: pieces('credit', [
            { status: 'ok', file: 'cni.jpg', at: daysAgo(2) },
            { status: 'ko', file: 'quittance-mars.jpg', at: daysAgo(1), reason: 'Document daté de 7 mois : un justificatif de moins de 3 mois est attendu.' },
            { status: 'ok', file: 'bulletins-aout-sept-oct.pdf', at: daysAgo(1.2) },
            { status: 'wait' },
            { status: 'wait' },
            { status: 'ok', file: 'contrat-cdi.pdf', at: daysAgo(2.4) }
          ])
        },
        {
          id: 'd3', token: 'bakker8n3q', client: 'Sanne Bakker', email: 's.bakker@email.fr',
          template: 'locataire', createdAt: daysAgo(0.3), lastActivity: daysAgo(0.3),
          pieces: pieces('locataire', [])
        },
        {
          id: 'd4', token: 'nava2c5v', client: 'Atelier Nava', email: 'contact@ateliernava.fr',
          template: 'tva', createdAt: daysAgo(6), lastActivity: daysAgo(1.5),
          pieces: pieces('tva', [
            { status: 'ok', file: 'tva-2025.pdf', at: daysAgo(3) },
            { status: 'ok', file: 'releves-pro.pdf', at: daysAgo(3) },
            { status: 'ok', file: 'kbis.pdf', at: daysAgo(2.5) },
            { status: 'wait' }
          ])
        },
        {
          id: 'd5', token: 'ferrand6t1r', client: 'Léa Ferrand', email: 'lea.ferrand@email.fr',
          template: 'onboarding', createdAt: daysAgo(2), lastActivity: daysAgo(0.1),
          pieces: pieces('onboarding', [
            { status: 'ok', file: 'cni.jpg', at: daysAgo(1) },
            { status: 'ok', file: 'rib.pdf', at: daysAgo(0.9) },
            { status: 'ok', file: 'carte-vitale.jpg', at: daysAgo(0.5) },
            { status: 'ok', file: 'contrat-signe.pdf', at: daysAgo(0.2) }
          ])
        },
        {
          id: 'd6', token: 'diallo9w4j', client: 'Moussa Diallo', email: 'm.diallo@email.fr',
          template: 'creation', createdAt: daysAgo(0.1), lastActivity: daysAgo(0.1),
          pieces: pieces('creation', [
            { status: 'ok', file: 'cni-recto-verso.jpg', at: daysAgo(0.05) },
            { status: 'wait' }, { status: 'wait' }, { status: 'wait' }, { status: 'wait' }
          ])
        }
      ]
    };
  }

  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) { var s = seed(); save(s); return s; }
      var parsed = JSON.parse(raw);
      if (!parsed || !Array.isArray(parsed.dossiers)) throw new Error('shape');
      return parsed;
    } catch (e) {
      var fresh = seed();
      save(fresh);
      return fresh;
    }
  }

  function save(state) {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* mode privé */ }
  }

  function reset() {
    var s = seed();
    save(s);
    return s;
  }

  function statusOf(d) {
    var ok = d.pieces.filter(function (p) { return p.status === 'ok'; }).length;
    if (ok === d.pieces.length) return 'complet';
    if (ok === 0 && d.pieces.filter(function (p) { return p.status === 'ko'; }).length === 0) return 'attente';
    return 'incomplet';
  }

  function progressOf(d) {
    var ok = d.pieces.filter(function (p) { return p.status === 'ok'; }).length;
    return { ok: ok, total: d.pieces.length, pct: Math.round((ok / d.pieces.length) * 100) };
  }

  function byToken(state, token) {
    for (var i = 0; i < state.dossiers.length; i++) if (state.dossiers[i].token === token) return state.dossiers[i];
    return null;
  }

  function byId(state, id) {
    for (var i = 0; i < state.dossiers.length; i++) if (state.dossiers[i].id === id) return state.dossiers[i];
    return null;
  }

  function create(state, data) {
    var tpl = template(data.template);
    var d = {
      id: 'd' + uid(6),
      token: slug(data.client).toLowerCase().replace(/_/g, '') .slice(0, 6) + uid(4),
      client: data.client,
      email: data.email,
      template: tpl.id,
      createdAt: new Date().toISOString(),
      lastActivity: new Date().toISOString(),
      pieces: tpl.pieces.map(function (p) {
        return { key: p.key, label: p.label, rule: p.rule, status: 'wait', file: '', reason: '', at: '' };
      })
    };
    state.dossiers.unshift(d);
    save(state);
    return d;
  }

  function exportName(d, piece, index) {
    var base = slug(d.client.split(' ').slice(-1)[0] || d.client);
    var name = slug(piece.label);
    var ext = piece.file && /\.pdf$/i.test(piece.file) ? 'pdf' : 'pdf';
    return base + '_' + name + '.' + ext;
  }

  function exportTree(d) {
    var base = slug(d.client.split(' ').slice(-1)[0] || d.client);
    return {
      folder: base + '_' + slug(template(d.template).name) + '_2026',
      files: d.pieces.map(function (p, i) { return exportName(d, p, i); }),
      missing: d.pieces.filter(function (p) { return p.status !== 'ok'; }).length
    };
  }

  global.AuraStore = {
    KEY: KEY, TEMPLATES: TEMPLATES, template: template,
    load: load, save: save, reset: reset, seed: seed,
    statusOf: statusOf, progressOf: progressOf, byToken: byToken, byId: byId,
    create: create, exportTree: exportTree, slug: slug, uid: uid, daysAgo: daysAgo
  };
})(window);
