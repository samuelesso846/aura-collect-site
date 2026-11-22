/* Aura Collect — application cabinet (API réelle) */
(function () {
  'use strict';

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  var state = { dossiers: [], templates: [], cabinet: '', ai: null, me: null };

  /* Droits de la personne connectée (le serveur reste seul juge) : l'interface
     masque seulement ce qu'elle ne pourrait pas faire. */
  function peut(action) {
    var d = state.me && state.me.droits;
    return !d || d.indexOf(action) !== -1;
  }

  var ICON = {
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>',
    cross: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>',
    clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7.5V12l3 2"/></svg>',
    eye: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6z"/><circle cx="12" cy="12" r="2.6"/></svg>'
  };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function initials(name) {
    return String(name).split(/\s+/).filter(Boolean).slice(0, 2).map(function (w) { return w[0]; }).join('').toUpperCase();
  }

  function plur(n, un, plusieurs) { return n + ' ' + (n > 1 ? plusieurs : un); }

  var SEAL_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l7 3v5c0 4.5-3 8.2-7 10-4-1.8-7-5.5-7-10V6l7-3z"/><path d="M8.8 12.2l2.2 2.2 4.2-4.4"/></svg>';

  function rel(iso) {
    if (!iso) return '—';
    var diff = (Date.now() - new Date(iso).getTime()) / 1000;
    if (diff < 90) return "à l'instant";
    if (diff < 3600) return Math.round(diff / 60) + ' min';
    if (diff < 86400) return Math.round(diff / 3600) + ' h';
    var d = Math.round(diff / 86400);
    return d + ' j';
  }

  function toast(msg, isError) {
    var t = document.getElementById('auraToast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'auraToast';
      t.style.cssText = 'position:fixed;bottom:22px;left:50%;transform:translateX(-50%) translateY(16px);background:#0A0E1A;color:#fff;padding:10px 18px;border-radius:100px;font-size:12.5px;z-index:300;opacity:0;transition:.22s;box-shadow:0 18px 40px -20px rgba(0,0,0,.7)';
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.style.background = isError ? '#B3253F' : '#0A0E1A';
    requestAnimationFrame(function () { t.style.opacity = '1'; t.style.transform = 'translateX(-50%) translateY(0)'; });
    clearTimeout(t._t);
    t._t = setTimeout(function () { t.style.opacity = '0'; t.style.transform = 'translateX(-50%) translateY(10px)'; }, 2800);
  }

  async function api(path, opts) {
    opts = opts || {};
    var res = await fetch(path, {
      method: opts.method || 'GET',
      headers: opts.body ? { 'Content-Type': 'application/json' } : undefined,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      credentials: 'same-origin'
    });
    var data = {};
    try { data = await res.json(); } catch (_) {}
    if (res.status === 401) { showLogin(); throw new Error('unauth'); }
    if (!res.ok) throw new Error(data.error || 'Erreur serveur (' + res.status + ')');
    return data;
  }

  function showLogin() {
    var b = $('#bootView'); if (b) b.hidden = true;
    var hint = $('#switchHint');
    if (hint) {
      if (state.me && state.me.authenticated && state.me.cabinet) {
        hint.textContent = 'Vous êtes connecté en tant que « ' + state.me.cabinet + ' ». Saisissez un autre compte pour changer d\'espace.';
        hint.hidden = false;
      } else {
        hint.hidden = true;
      }
    }
    $('#loginView').hidden = false;
    $('#dashView').hidden = true;
    $('#logoutBtn').hidden = true;
    document.body.classList.add('is-login');
    setTimeout(function () { var p = $('#password'); if (p) p.focus(); }, 50);
  }

  function showDash() {
    var b = $('#bootView'); if (b) b.hidden = true;
    $('#loginView').hidden = true;
    $('#dashView').hidden = false;
    $('#logoutBtn').hidden = false;
    document.body.classList.remove('is-login');
  }

  /* ---------- rendu ---------- */
  /* Bandeau d'abonnement : le cabinet voit où il en est avant d'être bloqué. */
  function renderPlanBanner() {
    var box = $('#planBanner');
    if (!box) return;
    var me = state.me || {}, a = me.access;
    if (!a) { box.innerHTML = ''; return; }
    var u = me.usage && me.usage.dossiers, max = a.limits && a.limits.dossiers;
    var msgs = [];
    var jours = function (n) { return plur(n, 'jour', 'jours'); };
    var debut = peut('cabinet.regler') ? '<a class="btn btn--primary btn--sm" href="abonnement">' : '';
    var fin = debut ? '</a>' : '';
    if (a.state === 'trialing') {
      msgs.push({ tone: 'info', t: 'Essai gratuit : ' + (a.daysLeft > 0 ? jours(a.daysLeft) + (a.daysLeft > 1 ? ' restants' : ' restant') : 'dernier jour'),
        s: 'Tout est actif. Choisissez votre offre quand vous êtes prêt : aucun prélèvement automatique.', cta: debut && debut + 'Choisir mon offre' + fin });
    } else if (a.state === 'grace') {
      msgs.push({ tone: 'warn', t: 'Votre abonnement est arrivé à échéance', s: 'Vous gardez l’accès quelques jours pour renouveler, sans perdre vos dossiers.', cta: debut && debut + 'Renouveler' + fin });
    } else if (a.state === 'suspended') {
      msgs.push({ tone: 'warn', t: 'Abonnement inactif', s: 'Vos dossiers restent consultables. Réactivez l’abonnement pour créer de nouvelles demandes.', cta: debut && debut + 'Réactiver' + fin });
    } else if (a.planStatus !== 'trialing' && a.daysLeft > 0 && a.daysLeft <= 7) {
      msgs.push({ tone: 'info', t: 'Votre abonnement se termine dans ' + jours(a.daysLeft), s: 'Renouvelez dès maintenant pour ne pas être interrompu.', cta: debut && debut + 'Renouveler' + fin });
    }
    if (typeof u === 'number' && max && u >= Math.ceil(max * 0.8)) {
      msgs.push({ tone: u >= max ? 'warn' : 'info', t: u >= max ? 'Limite de dossiers atteinte' : 'Vous approchez de votre limite',
        s: u + ' sur ' + max + ' dossiers créés ces 30 derniers jours. ' + (u >= max ? 'Passez à l’offre supérieure pour en créer d’autres.' : 'Pensez à l’offre supérieure si le rythme continue.'),
        cta: debut && debut + 'Voir les offres' + fin });
    }
    box.innerHTML = msgs.map(function (m) {
      return '<div class="plan-banner plan-banner--' + m.tone + '"><div><b>' + m.t + '</b><span>' + m.s + '</span></div>' + (m.cta || '') + '</div>';
    }).join('');
  }

  function renderStats() {
    renderPlanBanner();
    var ds = state.dossiers;
    var attente = ds.filter(function (d) { return d.status === 'attente'; }).length;
    var incomplet = ds.filter(function (d) { return d.status === 'incomplet'; }).length;
    var aValider = ds.filter(function (d) { return d.status === 'a_valider'; }).length;
    var scelles = ds.filter(function (d) { return d.status === 'scelle'; }).length;

    var box = $('#dashSub');
    if (!ds.length) { box.className = 'dash__sub'; box.innerHTML = 'Aucun dossier pour l’instant'; return; }

    function kpi(n, label, tone) {
      return '<div class="kpi kpi--' + tone + (n ? '' : ' is-zero') + '"><b>' + n + '</b><span>' + label + '</span></div>';
    }
    box.className = 'kpis';
    box.innerHTML = [
      kpi(ds.length, ds.length > 1 ? 'dossiers' : 'dossier', 'total'),
      kpi(attente, 'en attente', 'attente'),
      kpi(incomplet, incomplet > 1 ? 'incomplets' : 'incomplet', 'incomplet'),
      kpi(aValider, 'à valider', 'valider'),
      kpi(scelles, scelles > 1 ? 'scellés' : 'scellé', 'scelle')
    ].join('');
  }

  function statusChip(d) {
    var map = { attente: 'En attente', incomplet: 'Incomplet', a_valider: 'À valider', scelle: 'Scellé' };
    return '<span class="chip chip--' + d.status + '"><i></i>' + map[d.status] + '</span>';
  }

  var COLONNES = [
    { tone: 'attente', label: 'En attente',
      help: 'Le lien est parti, rien n\'est encore arrivé.',
      test: function (d) { return d.status === 'attente'; } },
    { tone: 'incomplet', label: 'Incomplet',
      help: 'Des pièces manquent ou sont à refaire.',
      test: function (d) { return d.status === 'incomplet'; } },
    { tone: 'complet', label: 'Complet',
      help: 'Tout est reçu. À valider ou déjà scellé.',
      test: function (d) { return d.status === 'a_valider' || d.status === 'scelle'; } }
  ];

  function segments(d) {
    var tot = Math.max(d.progress.total, 1), out = '';
    for (var i = 0; i < tot; i++) out += '<i class="' + (i < d.progress.ok ? 'on' : '') + '"></i>';
    return '<div class="segs segs--' + d.status + '" role="img" aria-label="' + d.progress.ok + ' sur ' + d.progress.total + ' pièces validées">' + out + '</div>';
  }

  function kanbanCard(d) {
    var etat = d.status === 'scelle' ? SEAL_ICON + 'Scellé'
      : d.status === 'a_valider' ? 'À valider' : '';
    var relance = (d.status !== 'scelle' && d.obstacles && d.obstacles.length && peut('dossier.relancer'))
      ? '<button class="kcard__act" data-remind="' + d.id + '">Relancer</button>'
      : '';
    var al = d.score && d.score.alertes
      ? '<span class="kcard__alert" title="Points à vérifier entre les pièces">' + plur(d.score.alertes, 'alerte', 'alertes') + '</span>' : '';
    return '<div class="kcard kcard--' + d.status + '" data-id="' + d.id + '" tabindex="0" role="button">' +
      '<div class="kcard__top">' +
        '<span class="kcard__av">' + esc(initials(d.clientName || d.client)) + '</span>' +
        '<span class="kcard__id"><span class="kcard__name">' + esc(d.clientName || d.client) + '</span>' +
        '<span class="kcard__tpl">' + esc(d.templateName) + '</span></span>' +
        (etat ? '<span class="kcard__flag kcard__flag--' + d.status + '">' + etat + '</span>' : '') +
      '</div>' +
      segments(d) +
      '<div class="kcard__foot"><span>' + d.progress.ok + ' sur ' + plur(d.progress.total, 'pièce', 'pièces') + '</span>' + al +
        '<span class="kcard__when">' + rel(d.lastActivity) + '</span></div>' +
      relance +
    '</div>';
  }

  function renderList() {
    if (!state.dossiers.length) {
      $('#listWrap').innerHTML =
        '<div class="empty-state"><h3>Votre premier dossier</h3>' +
        '<p>Créez une demande : votre client reçoit un lien, dépose ses pièces, elles sont vérifiées à l\'arrivée.</p></div>';
      return;
    }

    var html = '<div class="kanban">';
    COLONNES.forEach(function (col) {
      var items = state.dossiers.filter(col.test).sort(function (a, b) {
        return new Date(b.lastActivity) - new Date(a.lastActivity);
      });
      html += '<div class="kanban__col kanban__col--' + col.tone + '">' +
        '<div class="kanban__head"><span class="kanban__dot"></span>' +
          '<span class="kanban__label">' + col.label + '</span>' +
          '<b>' + items.length + '</b></div>' +
        '<div class="kanban__body">' +
          (items.length ? items.map(kanbanCard).join('')
            : '<div class="kanban__void">' + col.help + '</div>') +
        '</div></div>';
    });
    html += '</div>';

    $('#listWrap').innerHTML = html;
    $$('.kcard').forEach(function (c) {
      c.addEventListener('click', function (ev) {
        if (ev.target.dataset && ev.target.dataset.remind) return;
        openDrawer(c.dataset.id);
      });
    });
    $$('.kcard').forEach(function (c) {
      c.addEventListener('keydown', function (ev) {
        if (ev.target === c && (ev.key === 'Enter' || ev.key === ' ')) { ev.preventDefault(); openDrawer(c.dataset.id); }
      });
    });
    $$('[data-remind]').forEach(function (b) {
      b.addEventListener('click', async function (ev) {
        ev.stopPropagation();
        var t = b.textContent;
        b.disabled = true;
        b.textContent = '…';
        try {
          await api('/api/dossiers/' + b.dataset.remind + '/remind', { method: 'POST' });
          toast('Relance prête : le lien est renvoyé.');
        } catch (e) { toast(e.message, true); }
        b.disabled = false;
        b.textContent = t;
      });
    });
  }

  function render() {
    var nb = $('#newBtn');
    if (nb) nb.style.display = peut('dossier.creer') ? '' : 'none';
    renderStats();
    renderRelances();
    renderList();
  }

  /* À relancer aujourd'hui : dossiers ouverts, des pièces qui manquent, et pas de
     nouvelle du client depuis 3 jours. Même règle que GET /api/relances. Rien
     n'est envoyé seul : le cabinet ouvre WhatsApp et relit le message. */
  var JOURS_SILENCE = 3;
  function aRelancerMaintenant() {
    var limite = Date.now() - JOURS_SILENCE * 864e5;
    return state.dossiers.filter(function (d) {
      if (d.status === 'scelle' || !d.obstacles || !d.obstacles.length) return false;
      var t = Date.parse(d.lastActivity || d.createdAt);
      return isFinite(t) && t < limite;
    }).map(function (d) {
      return { d: d, jours: Math.floor((Date.now() - Date.parse(d.lastActivity || d.createdAt)) / 864e5) };
    }).sort(function (a, b) { return b.jours - a.jours; });
  }
  function renderRelances() {
    var box = $('#relanceWrap');
    if (!box) return;
    if (!peut('dossier.relancer')) { box.innerHTML = ''; return; }
    var liste = aRelancerMaintenant();
    if (!liste.length) { box.innerHTML = ''; return; }
    var lignes = liste.slice(0, 8).map(function (x) {
      var d = x.d, n = d.obstacles.length;
      return '<div class="relrow">' +
        '<button class="relrow__who" data-open="' + d.id + '">' +
          '<span class="kcard__av">' + initials(d.clientName || d.client) + '</span>' +
          '<span><b>' + esc(d.clientName || d.client) + '</b>' +
          '<small>' + n + ' pièce' + (n > 1 ? 's' : '') + ' manquante' + (n > 1 ? 's' : '') + ' · sans nouvelle depuis ' + x.jours + ' j</small></span>' +
        '</button>' +
        '<a class="btn btn--ghost btn--sm relrow__wa" target="_blank" rel="noopener" href="https://wa.me/?text=' +
          encodeURIComponent(waRelance(d)) + '">Relancer sur WhatsApp</a>' +
      '</div>';
    }).join('');
    var plus = liste.length > 8 ? '<div class="relrow__more">et ' + (liste.length - 8) + ' autre(s)</div>' : '';
    box.innerHTML = '<section class="relance" aria-label="Dossiers à relancer">' +
      '<div class="relance__head"><h2>À relancer aujourd’hui</h2><span class="relance__n">' + liste.length + '</span></div>' +
      lignes + plus + '</section>';
    $$('[data-open]', box).forEach(function (b) {
      b.addEventListener('click', function () { openDrawer(b.dataset.open); });
    });
  }

  /* ---------- détail ---------- */
  function pieceRow(d, p) {
    var accepted = p.status === 'ok' || p.status === 'valide';
    var cls = accepted ? 'ok' : p.status === 'ko' ? 'ko' : p.status === 'review' ? 'review' : 'wait';
    var ico = accepted ? ICON.check : p.status === 'ko' ? ICON.cross : ICON.clock;
    var tag = p.status === 'valide' ? 'Validé'
      : p.status === 'ok' ? 'À confirmer'
        : p.status === 'ko' ? 'À refaire'
          : p.status === 'review' ? 'À vérifier'
            : 'Attendu';
    var meta = p.filename
      ? esc(p.filename) + (p.dateDocument ? ' · daté du ' + esc(p.dateDocument) : '')
      : 'Règle : ' + esc(p.rule);
    var confirmBtn = '';
    if (!d.sealed && peut('piece.decider')) {
      if (p.status === 'ok' || p.status === 'review') {
        confirmBtn = '<div class="piece-row__acts">' +
          '<button class="btn btn--ghost btn--xs" data-confirm="' + d.id + '|' + p.key + '">Confirmer</button>' +
          '<button class="btn btn--ghost btn--xs" data-reject="' + d.id + '|' + p.key + '">Demander à refaire</button></div>';
      } else if (p.forcable) {
        /* L'IA s'est trompée de nature de document : le cabinet tranche. */
        confirmBtn = '<div class="piece-row__acts">' +
          '<button class="btn btn--ghost btn--xs" data-confirm="' + d.id + '|' + p.key + '">Accepter quand même</button></div>';
      }
    }

    return '<div class="piece-row">' +
      '<div class="piece-row__st piece-row__st--' + cls + '">' + ico + '</div>' +
      '<div><div class="piece-row__label">' + esc(p.label) + '</div>' +
        '<div class="piece-row__meta">' + meta + '</div>' +
        (p.reason && !accepted ? '<div class="piece-row__why ' + (p.status === 'review' ? 'is-review' : '') + '">' + esc(p.reason) + '</div>' : '') +
        (p.filename ? '<a class="piece-row__link" href="/api/files/' + d.id + '/' + p.key + '" target="_blank" rel="noopener">Ouvrir la pièce</a>' : '') +
        confirmBtn +
      '</div>' +
      '<span class="chip chip--' + cls + '">' + tag + '</span>' +
    '</div>';
  }

  /* Journal des décisions : qui, quand, pourquoi. Lecture seule. */
  var JOURNAL_LABELS = {
    creation: 'Dossier créé',
    depot: 'Pièce déposée',
    verdict_ia: 'Lecture automatique',
    validation: 'Pièce validée',
    refus: 'Nouvelle version demandée',
    forcage: 'Acceptée par le cabinet',
    scellement: 'Dossier scellé',
    relation_message: 'Message au client'
  };
  var JOURNAL_ACTORS = { ia: 'IA', client: 'Client', cabinet: 'Cabinet', systeme: 'Système' };
  var JOURNAL_TONE = { depot: 'in', verdict_ia: 'ia', validation: 'ok', forcage: 'ok', refus: 'warn', scellement: 'seal', creation: 'in', relation_message: 'msg' };

  async function loadJournal(id) {
    var box = $('#journalBox');
    if (!box) return;
    try {
      var r = await api('/api/dossiers/' + id + '/journal');
      var ev = r.events || [];
      if (!ev.length) {
        box.textContent = 'Aucun événement enregistré pour le moment.';
        return;
      }
      box.className = 'timeline';
      box.innerHTML = ev.map(function (e) {
        var titre = (JOURNAL_LABELS[e.action] || e.action) + (e.piece_label ? ' · ' + e.piece_label : '');
        var quand = new Date(e.created_at).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
        var acteur = e.actor_name || JOURNAL_ACTORS[e.actor_kind] || e.actor_kind;
        return '<div class="tl tl--' + (JOURNAL_TONE[e.action] || 'in') + '"><span class="tl__node"></span><div class="tl__body">' +
          '<div class="tl__t">' + esc(titre) + '</div>' +
          (e.reason ? '<div class="tl__d">' + esc(e.reason) + '</div>' : '') +
          '<div class="tl__m">' + esc(acteur) + ' · ' + esc(quand) + '</div>' +
        '</div></div>';
      }).join('');
    } catch (err) {
      box.textContent = 'Journal indisponible pour ce dossier.';
    }
  }

  /* ── Aura Relation : le cabinet prépare, relit, et envoie lui-même. ────── */
  var REL_STATUS = {
    prepare: 'Préparé',
    ouvert: 'Ouvert dans l’application',
    envoye: 'Déclaré envoyé'
  };

  async function loadRelation(d) {
    var box = $('#relationBox');
    if (!box) return;

    var r;
    try { r = await api('/api/dossiers/' + d.id + '/relation'); }
    catch (e) { box.textContent = e.message; return; }

    if (!r.available) {
      box.innerHTML = '<div class="rel-warn">' + esc(r.reason) + '</div>' +
        (r.historyWarning ? '<div class="rel-warn">' + esc(r.historyWarning) + '</div>' : '');
      return;
    }

    var m = r.message;
    var hist = (r.history || []).map(function (h) {
      return '<div class="rel-h">' +
        '<span class="rel-h__s rel-h__s--' + esc(h.status) + '">' + esc(REL_STATUS[h.status] || h.status) + '</span>' +
        '<span class="rel-h__d">' + new Date(h.created_at).toLocaleString('fr-FR') + ' · ' + esc(h.channel) +
        (h.actor_name ? ' · ' + esc(h.actor_name) : '') + '</span>' +
        (h.status !== 'envoye'
          ? '<button class="btn btn--ghost btn--sm rel-h__b" data-sent="' + h.id + '" type="button">Déclarer envoyé</button>'
          : '') +
        '</div>';
    }).join('');

    box.innerHTML =
      '<div class="rel-g">' + esc(m.garde) + '</div>' +
      '<textarea id="relBody" class="rel-ta" rows="9" spellcheck="true">' + esc(m.body) + '</textarea>' +
      '<div class="rel-row">' +
        '<input id="relEch" class="rel-in" type="text" placeholder="Échéance à insérer (ex. 15 décembre — TVA)">' +
        '<button class="btn btn--ghost btn--sm" id="relIns" type="button">Insérer</button>' +
      '</div>' +
      '<div class="rel-row">' +
        '<select id="relChan" class="rel-in">' +
          '<option value="whatsapp">WhatsApp</option>' +
          '<option value="sms">SMS</option>' +
          '<option value="email"' + (m.clientEmail ? '' : ' disabled') + '>E-mail' +
            (m.clientEmail ? ' — ' + esc(m.clientEmail) : ' — adresse absente du dossier') + '</option>' +
        '</select>' +
        '<button class="btn btn--primary btn--sm" id="relOpen" type="button">Ouvrir le message</button>' +
      '</div>' +
      '<p class="detail-note" id="relNote">Aucun envoi automatique : le message s’ouvre dans votre application et c’est vous qui appuyez sur envoyer.</p>' +
      '<div class="rel-histhead">Historique</div>' +
      (hist || '<div class="detail-note">Aucun message préparé pour ce dossier.</div>');

    var ta = $('#relBody');
    var chan = $('#relChan');

    /* Déclaration d'envoi : c'est le cabinet qui l'affirme, pas la plateforme.
       On n'écrit jamais « livré » ni « lu » — nous ne le savons pas. */
    $$('[data-sent]', box).forEach(function (b) {
      b.addEventListener('click', async function () {
        b.disabled = true;
        try {
          await api('/api/dossiers/' + d.id + '/relation/' + b.dataset.sent + '/status', {
            method: 'POST', body: { status: 'envoye' }
          });
          toast('Marqué comme envoyé');
          loadRelation(d);
        } catch (e) { toast(e.message, true); b.disabled = false; }
      });
    });

    $('#relIns').addEventListener('click', function () {
      var v = ($('#relEch').value || '').trim();
      if (!v) { toast('Renseignez d’abord l’échéance'); return; }
      var line = '\n\nProchaine échéance : ' + v + '.';
      var p = typeof ta.selectionStart === 'number' ? ta.selectionStart : ta.value.length;
      ta.value = ta.value.slice(0, p) + line + ta.value.slice(p);
      ta.focus();
      ta.selectionStart = ta.selectionEnd = p + line.length;
    });

    $('#relOpen').addEventListener('click', async function () {
      var body = (ta.value || '').trim();
      if (!body) { toast('Le message est vide', true); return; }

      var channel = chan.value;
      var url;
      if (channel === 'whatsapp') {
        url = 'https://wa.me/?text=' + encodeURIComponent(body);
      } else if (channel === 'sms') {
        url = 'sms:?&body=' + encodeURIComponent(body);
      } else {
        if (!m.clientEmail) { toast('Aucune adresse e-mail dans ce dossier', true); return; }
        url = 'mailto:' + m.clientEmail +
          '?subject=' + encodeURIComponent('Votre dossier — ' + (state.cabinet || '')) +
          '&body=' + encodeURIComponent(body);
      }

      window.open(url, '_blank', 'noopener');
      try {
        await api('/api/dossiers/' + d.id + '/relation', {
          method: 'POST',
          body: { body: body, channel: channel, templateKey: m.family, status: 'ouvert' }
        });
        toast('Message enregistré dans l’historique');
        loadRelation(d);
      } catch (e) { toast(e.message, true); }
    });
  }

  /* Messages remis aux clients : ils doivent se comprendre seuls, venir d'un
     cabinet identifiable, dire quoi faire et jusqu'à quand. */
  var RAISON_SOCIALE = /^(ets|etablissements?|établissements?|sarl|sas|sa|ste|sté|société|entreprise|cabinet|boutique|groupe|pharmacie|hôtel|hotel|maison|ong|association|coopérative|cooperative)\b/i;
  function waSalut(name) {
    var n = String(name || '').trim();
    var w = n.split(/\s+/);
    return !n ? '' : (RAISON_SOCIALE.test(n) || w.length >= 4) ? n : w[0];
  }
  function waInvitation(d) {
    var cab = state.cabinet ? ' Ici ' + state.cabinet + '.' : '';
    return 'Bonjour ' + waSalut(d.client) + ',' + cab +
      '\nPour constituer votre dossier, déposez vos pièces depuis votre téléphone (photo ou PDF). Pas de compte à créer :\n' +
      d.link + '\nLe lien est valable 30 jours.';
  }
  function waRelance(d) {
    var liste = (d.obstacles || []).slice(0, 6).map(function (o) { return '• ' + o.label; }).join('\n');
    var plus = (d.obstacles || []).length > 6 ? '\n• et ' + (d.obstacles.length - 6) + ' autre(s)' : '';
    return 'Bonjour ' + waSalut(d.client) + ',' + (state.cabinet ? ' ici ' + state.cabinet + '.' : '') +
      '\nIl manque encore pour votre dossier :\n' + liste + plus +
      '\nVous pouvez les déposer ici, depuis votre téléphone :\n' + d.link;
  }

  function openDrawer(id) {
    var d = state.dossiers.filter(function (x) { return x.id === id; })[0];
    if (!d) return;

    var obstacles = d.obstacles || [];
    var sealed = d.sealed;

    $('#drawerName').textContent = d.client;
    $('#drawerMeta').textContent = d.templateName + ' · ' + d.progress.ok + ' sur ' + d.progress.total + ' validées' +
      (d.recipient ? ' · ' + d.recipient : '');

    var nOb = obstacles.length, nAl = (d.score && d.score.alertes) || 0;
    var canSeal = !nOb && peut('dossier.sceller');
    var verdict;
    if (sealed) {
      verdict = '<div class="seal-card"><div class="seal-card__top"><span class="seal-card__ico">' + SEAL_ICON + '</span>' +
        '<div><div class="seal-card__t">Dossier scellé</div>' +
        '<div class="seal-card__s">Le ' + new Date(sealed.at).toLocaleString('fr-FR', { dateStyle: 'long', timeStyle: 'short' }) + '. Il n’accepte plus de pièce.</div></div></div>' +
        '<div class="seal-hash" title="Empreinte SHA-256">' + esc(sealed.hash) + '</div>' +
        '<div class="seal-card__acts"><a class="btn btn--light btn--sm" href="/api/dossiers/' + d.id + '/certificate">Certificat PDF</a>' +
        '<button class="btn btn--sm seal-card__ghost" id="checkIntegrity">Vérifier l’intégrité</button></div>' +
        '<div id="integrityOut" class="seal-card__out"></div></div>';
    } else if (nOb) {
      verdict = '<div class="banner banner--warn"><div class="banner__t">' + plur(nOb, 'pièce bloque', 'pièces bloquent') + ' le scellement</div>' +
        '<div class="banner__s">Le dossier pourra être scellé quand toutes les pièces seront validées.</div></div>';
    } else {
      verdict = '<div class="banner banner--ok"><div class="banner__t">' + (nAl ? 'Pièces validées, ' + plur(nAl, 'point à vérifier', 'points à vérifier') : 'Prêt à sceller') + '</div>' +
        '<div class="banner__s">' + (nAl ? 'Contrôlez les alertes ci-dessous avant de sceller.' : 'Toutes les pièces sont validées.') + '</div>' +
        '<button class="btn btn--primary btn--sm" id="sealBtn"' + (canSeal ? '' : ' disabled') + '>Sceller le dossier</button>' +
        (peut('dossier.sceller') ? '' : '<div class="banner__s">Seuls le propriétaire et les associés peuvent sceller.</div>') + '</div>';
    }

    var obstacleHtml = obstacles.length
      ? '<div class="drawer__section"><div class="drawer__label">À fournir ou à refaire</div>' + obstacles.map(function (o) {
          return '<div class="obstacle"><span class="obstacle__dot"></span><div>' +
            '<div class="obstacle__t">' + esc(o.label) + '</div>' +
            '<div class="obstacle__d">' + esc(o.reason || (o.status === 'wait' ? 'Pièce non déposée.' : 'Pièce à vérifier.')) + '</div>' +
            '</div></div>';
        }).join('') + '</div>'
      : '';

    /* Contrôles croisés : ce qu'une pièce ne révèle pas seule. Ils alertent, ils
       ne bloquent pas : la décision reste au cabinet. */
    var ctrl = d.controles || [];
    var ctrlHtml = ctrl.length
      ? '<div class="drawer__section"><div class="drawer__label">À vérifier entre les pièces</div>' + ctrl.map(function (c) {
          var alerte = c.niveau === 'alerte';
          return '<div class="obstacle"><span class="obstacle__dot' + (alerte ? ' is-alert' : ' is-info') + '"></span><div>' +
            '<div class="obstacle__t">' + esc(c.message) + '</div>' +
            '</div></div>';
        }).join('') + '</div>'
      : '';

    $('#drawerBody').innerHTML = verdict + obstacleHtml + ctrlHtml +
      '<div class="drawer__section">' +
        '<div class="drawer__label">Pièces du dossier</div>' +
        d.pieces.map(function (p) { return pieceRow(d, p); }).join('') +
      '</div>' +
      '<div class="drawer__section">' +
        '<div class="drawer__label">Lien client</div>' +
        '<div class="link-line"><code>' + esc(d.link) + '</code>' +
          '<button class="btn btn--ghost btn--xs" id="copyLink">Copier</button></div>' +
        '<div class="detail-actions" style="margin-top:10px">' +
          '<a class="btn btn--ghost btn--sm" href="' + esc(d.link) + '" target="_blank" rel="noopener">Ouvrir le portail</a>' +
          '<a class="btn btn--ghost btn--sm btn--wa" target="_blank" rel="noopener" href="' +
            'https://wa.me/?text=' + encodeURIComponent(waInvitation(d)) +
          '">Envoyer par WhatsApp</a>' +
          (d.obstacles.length
            ? '<a class="btn btn--ghost btn--sm" target="_blank" rel="noopener" href="https://wa.me/?text=' +
                encodeURIComponent(waRelance(d)) + '">Relancer</a>'
            : '') +
          '<a class="btn btn--ghost btn--sm" href="/api/dossiers/' + d.id + '/export">Télécharger le ZIP</a>' +
        '</div>' +
        '<p class="detail-note">Le ZIP contient les pièces renommées, le sommaire et, si le dossier est scellé, le certificat et le manifeste. Le lien client expire après 30 jours.</p>' +
      '</div>' +
      '<div class="drawer__section">' +
        '<div class="drawer__label">Journal des décisions</div>' +
        '<div id="journalBox" class="detail-note">Chargement…</div>' +
      '</div>' +
      (sealed
        ? '<div class="drawer__section"><div class="drawer__label">Relation client</div>' +
          '<div id="relationBox" class="detail-note">Chargement…</div></div>'
        : '');

    loadJournal(d.id);
    if (sealed) loadRelation(d);

    $('#copyLink').addEventListener('click', function () {
      if (navigator.clipboard) navigator.clipboard.writeText(d.link).then(function () { toast('Lien copié'); });
      else toast('Copie indisponible');
    });

    var sealBtn = $('#sealBtn');
    if (sealBtn) {
      sealBtn.addEventListener('click', async function () {
        sealBtn.disabled = true;
        sealBtn.textContent = 'Scellement…';
        try {
          await api('/api/dossiers/' + d.id + '/seal', { method: 'POST' });
          toast('Dossier scellé — certificat disponible');
          await load();
          openDrawer(d.id);
        } catch (e) {
          toast(e.message, true);
          sealBtn.disabled = false;
          sealBtn.textContent = 'Sceller le dossier';
        }
      });
    }

    var check = $('#checkIntegrity');
    if (check) {
      check.addEventListener('click', async function () {
        var out = $('#integrityOut');
        out.textContent = 'Vérification en cours…';
        try {
          var r = await api('/api/dossiers/' + d.id + '/integrity');
          out.innerHTML = r.ok
            ? '<span class="is-good">Intègre : l’empreinte recalculée est identique.</span>'
            : '<span class="is-bad">Altéré : ' +
              (r.changed.length ? 'pièces modifiées : ' + esc(r.changed.join(', ')) : 'le manifeste ne correspond plus.') + '</span>';
        } catch (e) { out.textContent = e.message; }
      });
    }

    $('#drawer').classList.add('is-open');
    $('#drawerOverlay').classList.add('is-open');
      }

  function closeDrawer() {
    $('#drawer').classList.remove('is-open');
    $('#drawerOverlay').classList.remove('is-open');
  }

  /* ---------- création ---------- */
  function fillTemplates() {
    var fams = [];
    state.templates.forEach(function (t) { if (fams.indexOf(t.family) === -1) fams.push(t.family); });
    $('#clientTpl').innerHTML = fams.map(function (f) {
      return '<optgroup label="' + esc(f) + '">' + state.templates.filter(function (t) { return t.family === f; }).map(function (t) {
        return '<option value="' + t.id + '">' + esc(t.name) + '</option>';
      }).join('') + '</optgroup>';
    }).join('');
    updateHint();
  }

  function currentTemplate() {
    var id = $('#clientTpl').value;
    return state.templates.filter(function (x) { return x.id === id; })[0];
  }

  function updateHint() {
    var t = currentTemplate();
    if (!t) return;
    $('#tplHint').textContent = (t.about ? t.about + ' ' : '') + t.defaults.length + ' pièces cochées sur ' + t.catalog.length + ' possibles.';
    renderPicks();
  }

  /* Le catalogue du modèle est proposé en entier, pré-coché selon les usages.
     Le cabinet décoche ce qu'il ne demande pas. */
  function renderPicks() {
    var t = currentTemplate();
    if (!t) return;
    var groups = [];
    t.catalog.forEach(function (p) {
      var g = p.group || 'Autres';
      var found = groups.filter(function (x) { return x.name === g; })[0];
      if (!found) groups.push(found = { name: g, items: [] });
      found.items.push(p);
    });
    $('#piecePicks').innerHTML = groups.map(function (g) {
      return '<div class="picks__group">' + esc(g.name) + '</div>' + g.items.map(function (p) {
        var on = t.defaults.indexOf(p.key) !== -1;
        return '<label class="pick">' +
          '<input type="checkbox" data-key="' + esc(p.key) + '" data-label="' + esc(p.label) + '" data-rule="' + esc(p.rule) + '"' + (on ? ' checked' : '') + '>' +
          '<span class="pick__t">' + esc(p.label) + '</span>' +
          '<span class="pick__r">' + esc(p.rule) + '</span>' +
          '</label>';
      }).join('');
    }).join('');
    updateCount();
  }

  function updateCount() {
    var n = $('#piecePicks').querySelectorAll('input:checked').length +
      $('#customPieces').querySelectorAll('.pick--custom').length;
    $('#pickCount').textContent = n === 0 ? '(aucune)' : '(' + n + (n > 25 ? ' — 25 maximum' : '') + ')';
    $('#pickCount').style.color = n > 25 ? 'var(--red)' : '';
  }

  function addCustomPiece() {
    var row = document.createElement('div');
    row.className = 'pick pick--custom';
    row.innerHTML =
      '<input type="checkbox" checked>' +
      '<input class="pick__in" type="text" placeholder="Nom de la pièce" maxlength="120">' +
      '<input class="pick__in pick__in--rule" type="text" placeholder="Règle (moins de 3 mois…)" maxlength="80">' +
      '<button type="button" class="pick__del" title="Retirer">&times;</button>';
    $('#customPieces').appendChild(row);
    row.querySelector('.pick__in').focus();
    updateCount();
  }

  function collectPieces() {
    var out = [];
    $('#piecePicks').querySelectorAll('input:checked').forEach(function (el) {
      out.push({ key: el.getAttribute('data-key'), label: el.getAttribute('data-label'), rule: el.getAttribute('data-rule') });
    });
    $('#customPieces').querySelectorAll('.pick--custom').forEach(function (row) {
      if (!row.querySelector('input[type=checkbox]').checked) return;
      var label = row.querySelector('.pick__in').value.trim();
      if (!label) return;
      var rule = row.querySelector('.pick__in--rule').value.trim();
      out.push({ label: label, rule: rule || 'selon vos règles' });
    });
    return out;
  }

  function resetModal() {
    var form = $('#newForm');
    form.reset();
    form.style.display = '';
    $('#modalTitle').textContent = 'Nouvelle demande';
    var old = $('#newSuccess');
    if (old) old.remove();
    $('#createBtn').disabled = false;
    $('#createBtn').textContent = 'Créer et envoyer le lien';
    var custom = $('#customPieces');
    if (custom) custom.innerHTML = '';
  }

  function openNew() {
    resetModal();
    fillTemplates();
    $('#modalNew').classList.add('is-open');
    setTimeout(function () { $('#clientName').focus(); }, 60);
  }

  /* ---------- chargement ---------- */
  document.addEventListener('click', function (ev) {
    var btn = ev.target.closest ? ev.target.closest('[data-open]') : null;
    if (!btn) return;
    ev.preventDefault();
    openDrawer(btn.getAttribute('data-open'));
  });

  /* Confirmation d'une pièce par le cabinet : le seul geste qui vaut validation. */
  document.addEventListener('click', async function (ev) {
    var btn = ev.target.closest ? ev.target.closest('[data-confirm]') : null;
    if (!btn) return;
    ev.preventDefault();
    ev.stopPropagation();
    var parts = btn.getAttribute('data-confirm').split('|');
    var label = btn.textContent;
    btn.disabled = true;
    btn.textContent = '…';
    try {
      await api('/api/dossiers/' + parts[0] + '/pieces/' + parts[1] + '/confirm', { method: 'POST' });
      await load();
      render();
      openDrawer(parts[0]);
      toast('Pièce validée.');
    } catch (e) {
      toast(e.message, true);
      btn.disabled = false;
      btn.textContent = label;
    }
  });

  /* Le cabinet renvoie une pièce au client : elle redevient à déposer. */
  document.addEventListener('click', async function (ev) {
    var btn = ev.target.closest ? ev.target.closest('[data-reject]') : null;
    if (!btn) return;
    ev.preventDefault();
    ev.stopPropagation();
    if (!confirm('Demander une nouvelle version de cette pièce au client ?')) return;
    var parts = btn.getAttribute('data-reject').split('|');
    var label = btn.textContent;
    btn.disabled = true;
    btn.textContent = '…';
    try {
      await api('/api/dossiers/' + parts[0] + '/pieces/' + parts[1] + '/reject', { method: 'POST' });
      await load();
      render();
      openDrawer(parts[0]);
      toast('Le client est invité à redéposer cette pièce.');
    } catch (e) {
      toast(e.message, true);
      btn.disabled = false;
      btn.textContent = label;
    }
  });

  async function load() {
    var data = await api('/api/dossiers');
    state.dossiers = data.dossiers;
    state.cabinet = data.cabinet;
    $('#cabinetName').textContent = data.cabinet;
    if (!state.templates.length) {
      var t = await api('/api/templates');
      state.templates = t.templates;
    }
    showDash();
    render();
  }

  /* Mémorise qui est connecté et ce qu'il a le droit de faire.
     Appelé au démarrage ET après chaque connexion : la page ouverte avant
     connexion (ex. /app?login=1) a lu des droits vides ; sans cette relecture,
     « Nouvelle demande », « Relancer », « Confirmer » et « Sceller » restaient
     masqués jusqu'au prochain rechargement, même pour le propriétaire. */
  function applyMe(me) {
    state.me = me;
    /* Avant connexion, /api/me renvoie cabinet:null : sans ce garde-fou
       l'onglet affichait « null — Aura Collect ». */
    if (me.cabinet) {
      $('#cabinetName').textContent = me.cabinet;
      document.title = me.cabinet + ' — Aura Collect';
    } else {
      document.title = 'Aura Collect';
    }

    var pill = $('#aiPill');
    if (me.ai && me.ai.ready) {
      pill.classList.remove('is-off');
      pill.querySelector('span').textContent = 'Vérification IA active';
      pill.removeAttribute('title');
    } else {
      pill.classList.add('is-off');
      pill.querySelector('span').textContent = 'IA non configurée';
      pill.title = 'La vérification automatique est momentanément indisponible. Les pièces restent déposables et validables manuellement.';
    }
  }

  async function boot() {
    try {
      var me = await api('/api/me');
      applyMe(me);

      /* Le bouton « Se connecter » mène ici avec ?login=1 : il doit montrer le
         formulaire même si une session est déjà ouverte, sinon on entre dans
         l'espace du compte précédent sans avoir rien demandé. */
      var forceLogin = /[?&]login=1\b/.test(window.location.search);
      if (me.authenticated && !forceLogin) await load();
      else showLogin();
    } catch (e) {
      showLogin();
    }
  }

  /* ---------- événements ---------- */
  $('#loginForm').addEventListener('submit', async function (e) {
    e.preventDefault();
    var err = $('#loginErr');
    err.classList.remove('is-on');
    $('#loginBtn').disabled = true;
    try {
      await api('/api/login', { method: 'POST', body: { email: $('#email').value.trim(), password: $('#password').value } });
      $('#password').value = '';
      applyMe(await api('/api/me'));
      await load();
    } catch (ex) {
      err.textContent = ex.message === 'unauth' ? 'Identifiants incorrects.' : ex.message;
      err.classList.add('is-on');
    } finally {
      $('#loginBtn').disabled = false;
    }
  });

  /* ---------- mot de passe oublié ---------- */
  if ($('#forgotLink')) {
    $('#forgotLink').addEventListener('click', function (e) {
      e.preventDefault();
      var box = $('#forgotBox'); if (!box) return;
      box.hidden = !box.hidden;
      if (!box.hidden) {
        var fe = $('#forgotEmail');
        var em = $('#email');
        if (fe && em && !fe.value) fe.value = em.value;
        if (fe) fe.focus();
      }
    });
  }
  if ($('#forgotSend')) {
    $('#forgotSend').addEventListener('click', async function () {
      var msg = $('#forgotMsg');
      var email = (($('#forgotEmail') || {}).value || '').trim();
      function say(t, ok) { if (msg) { msg.textContent = t; msg.style.color = ok ? '#0B7A5C' : '#B42318'; } }
      if (!email) return say('Indiquez votre email de connexion.', false);
      this.disabled = true;
      try {
        var r = await fetch('/api/password/reset-request', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: email })
        });
        var d = await r.json();
        if (r.ok && d.ok) say('Demande enregistrée. Si un compte existe avec cette adresse, votre cabinet vous transmettra un lien par WhatsApp.', true);
        else say(d.error || 'Demande impossible.', false);
      } catch (e) {
        say('Connexion interrompue. Réessayez.', false);
      }
      this.disabled = false;
    });
  }

  $('#logoutBtn').addEventListener('click', async function () {
    try { await api('/api/logout', { method: 'POST' }); } catch (_) {}
    showLogin();
  });

  $('#newBtn').addEventListener('click', openNew);
  $('#clientTpl').addEventListener('change', updateHint);

  /* Sélection des pièces : tout cocher, tout décocher, ajouter, retirer. */
  document.addEventListener('click', function (ev) {
    var t = ev.target;
    if (t.id === 'addPiece') { ev.preventDefault(); addCustomPiece(); return; }
    if (t.id === 'pickAll' || t.id === 'pickNone') {
      ev.preventDefault();
      var on = t.id === 'pickAll';
      $('#piecePicks').querySelectorAll('input').forEach(function (el) { el.checked = on; });
      updateCount();
      return;
    }
    if (t.classList && t.classList.contains('pick__del')) {
      ev.preventDefault();
      var row = t.closest('.pick--custom');
      if (row) row.remove();
      updateCount();
    }
  });

  document.addEventListener('change', function (ev) {
    if (ev.target.closest && ev.target.closest('#piecePicks')) updateCount();
  });

  $$('[data-close-new]').forEach(function (b) {
    b.addEventListener('click', function () { $('#modalNew').classList.remove('is-open'); resetModal(); });
  });
  $('#modalNew').addEventListener('click', function (e) {
    if (e.target === $('#modalNew')) { $('#modalNew').classList.remove('is-open'); resetModal(); }
  });
  $('#drawerClose').addEventListener('click', closeDrawer);
  $('#drawerOverlay').addEventListener('click', closeDrawer);
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      closeDrawer();
      $('#modalNew').classList.remove('is-open');
    }
  });

  $('#newForm').addEventListener('submit', async function (e) {
    e.preventDefault();
    if (!collectPieces().length) {
      toast('Cochez au moins une pièce à demander.', true);
      return;
    }
    var btn = $('#createBtn');
    btn.disabled = true;
    btn.textContent = 'Création…';
    try {
      var r = await api('/api/dossiers', {
        method: 'POST',
        body: {
          client: $('#clientName').value.trim(),
          email: $('#clientEmail').value.trim(),
          template: $('#clientTpl').value,
          recipient: $('#clientRecipient').value.trim(),
          pieces: collectPieces()
        }
      });

      var d = r.dossier;
      $('#newForm').style.display = 'none';
      $('#modalTitle').textContent = 'Demande créée';
      var box = document.createElement('div');
      box.id = 'newSuccess';
      box.innerHTML =
        '<div style="display:flex;gap:10px;align-items:center;margin-bottom:14px">' +
          '<div style="width:32px;height:32px;border-radius:50%;background:var(--green-soft);color:var(--green);display:grid;place-items:center;flex:0 0 32px">' + ICON.check + '</div>' +
          '<div><div style="font-size:13px;font-weight:650">' + esc(d.client) + '</div>' +
          '<div style="font-size:11px;color:var(--muted)">' + esc(d.templateName) + ' · ' + d.progress.total + ' pièces</div></div>' +
        '</div>' +
        '<p style="font-size:11.5px;color:var(--muted);line-height:1.5">' +
          (r.mail.mode === 'resend'
            ? 'L\'email a été envoyé à ' + esc(d.email) + '.'
            : 'Aucun fournisseur email configuré : le message est journalisé. Transmettez ce lien vous-même.') +
        '</p>' +
        '<div class="link-line"><code>' + esc(d.link) + '</code>' +
          '<button class="btn btn--ghost btn--sm" id="copyNew" style="height:28px;padding:0 9px;font-size:10.5px">Copier</button></div>' +
        '<div class="detail-actions" style="margin-top:12px">' +
          '<a class="btn btn--primary btn--sm" href="' + esc(d.link) + '" target="_blank" rel="noopener">Ouvrir le portail client</a>' +
          '<button class="btn btn--ghost btn--sm" id="againBtn">Nouvelle demande</button>' +
        '</div>';
      $('#modalBody').appendChild(box);
      $('#copyNew').addEventListener('click', function () {
        if (navigator.clipboard) navigator.clipboard.writeText(d.link).then(function () { toast('Lien copié'); });
      });
      $('#againBtn').addEventListener('click', resetModal);

      await load();
    } catch (ex) {
      toast(ex.message, true);
      btn.disabled = false;
      btn.textContent = 'Créer et envoyer le lien';
    }
  });

  boot();
})();
