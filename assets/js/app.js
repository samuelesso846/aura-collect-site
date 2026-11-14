/* Aura Collect — application cabinet (API réelle) */
(function () {
  'use strict';

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  var state = { dossiers: [], templates: [], cabinet: '', ai: null, me: null };

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
  function renderStats() {
    var ds = state.dossiers;
    var attente = ds.filter(function (d) { return d.status === 'attente'; }).length;
    var incomplet = ds.filter(function (d) { return d.status === 'incomplet'; }).length;
    var aValider = ds.filter(function (d) { return d.status === 'a_valider'; }).length;
    var scelles = ds.filter(function (d) { return d.status === 'scelle'; }).length;

    if (!ds.length) {
      $('#dashSub').innerHTML = '<span class="dchip dchip--muted">Aucun dossier pour l\'instant</span>';
      return;
    }

    function chip(n, label, tone) {
      return '<span class="dchip dchip--' + tone + '"><b>' + n + '</b> ' + label + '</span>';
    }
    $('#dashSub').innerHTML = [
      chip(ds.length, 'dossier' + (ds.length > 1 ? 's' : ''), 'total'),
      chip(attente, 'en attente', 'attente'),
      chip(incomplet, 'incomplet' + (incomplet > 1 ? 's' : ''), 'incomplet'),
      chip(aValider, 'à valider', 'valider'),
      chip(scelles, 'scellé' + (scelles > 1 ? 's' : ''), 'scelle')
    ].join('');
  }

  function statusChip(d) {
    var map = { attente: 'En attente', incomplet: 'Incomplet', a_valider: 'À valider', scelle: 'Scellé' };
    return '<span class="chip chip--' + d.status + '"><i></i>' + map[d.status] + '</span>';
  }

  var COLONNES = [
    { tone: 'attente', dot: '#FF9F43', label: 'En attente',
      help: 'Le lien est parti, rien n\'est encore arrivé.',
      test: function (d) { return d.status === 'attente'; } },
    { tone: 'incomplet', dot: '#F0506E', label: 'Incomplet',
      help: 'Des pièces manquent ou sont à refaire.',
      test: function (d) { return d.status === 'incomplet'; } },
    { tone: 'complet', dot: '#12A57C', label: 'Complet',
      help: 'Tout est reçu. À valider ou déjà scellé.',
      test: function (d) { return d.status === 'a_valider' || d.status === 'scelle'; } }
  ];

  function kanbanCard(d) {
    var etat = d.status === 'scelle' ? 'scellé'
      : d.status === 'a_valider' ? 'à valider' : '';
    var bar = (d.status === 'scelle' || d.status === 'a_valider') ? 'is-ok'
      : d.status === 'incomplet' ? 'is-warn' : '';
    var relance = (d.status !== 'scelle' && d.obstacles && d.obstacles.length)
      ? '<button class="kcard__act" data-remind="' + d.id + '">Relancer</button>'
      : '';
    return '<div class="kcard kcard--' + d.status + '" data-id="' + d.id + '">' +
      '<div class="kcard__top">' +
        '<span class="kcard__av">' + initials(d.clientName || d.client) + '</span>' +
        '<span class="kcard__name">' + esc(d.clientName || d.client) + '</span>' +
        (etat ? '<span class="kcard__flag kcard__flag--' + d.status + '">' + etat + '</span>' : '') +
      '</div>' +
      '<div class="kcard__tpl">' + esc(d.templateName) + '</div>' +
      '<div class="kcard__bar ' + bar + '"><i style="width:' + d.progress.pct + '%"></i></div>' +
      '<div class="kcard__foot"><span>' + d.progress.ok + '/' + d.progress.total + ' pièces</span>' +
        '<span>' + rel(d.lastActivity) + '</span></div>' +
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
        '<div class="kanban__head"><span class="kanban__dot" style="background:' + col.dot + '"></span>' +
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
    renderStats();
    renderList();
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
    var style = accepted ? 'background:var(--green-soft);color:var(--green)'
      : p.status === 'ko' ? 'background:var(--red-soft);color:#C4304A'
        : p.status === 'review' ? 'background:var(--amber-soft);color:#A5620B'
          : 'background:#F1F3F8;color:#98A0B2';

    var confirmBtn = '';
    if (!d.sealed) {
      if (p.status === 'ok' || p.status === 'review') {
        confirmBtn =
          '<button class="btn btn--ghost btn--xs" data-confirm="' + d.id + '|' + p.key + '">Confirmer</button>' +
          '<button class="btn btn--ghost btn--xs" data-reject="' + d.id + '|' + p.key + '">Demander à refaire</button>';
      } else if (p.forcable) {
        /* L'IA s'est trompée de nature de document : le cabinet tranche. */
        confirmBtn =
          '<button class="btn btn--ghost btn--xs" data-confirm="' + d.id + '|' + p.key + '">Accepter quand même</button>';
      }
    }

    return '<div class="piece-row">' +
      '<div class="piece-row__st" style="' + style + '">' + ico + '</div>' +
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
    verdict_ia: 'Vérification automatique',
    validation: 'Pièce validée',
    refus: 'Nouvelle version demandée',
    forcage: 'Validation forcée',
    scellement: 'Dossier scellé'
  };
  var JOURNAL_ACTORS = { ia: 'IA', client: 'Client', cabinet: 'Cabinet', systeme: 'Système' };

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
      box.innerHTML = ev.map(function (e) {
        var titre = (JOURNAL_LABELS[e.action] || e.action) + (e.piece_label ? ' · ' + e.piece_label : '');
        var quand = new Date(e.created_at).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
        var acteur = (JOURNAL_ACTORS[e.actor_kind] || e.actor_kind) + (e.actor_email ? ' — ' + e.actor_email : '');
        var detail = quand + ' · ' + acteur;
        if (e.reason) detail += ' — ' + e.reason;
        return '<div class="obstacle"><span class="obstacle__dot"></span><div>' +
          '<div class="obstacle__t">' + esc(titre) + '</div>' +
          '<div class="obstacle__d">' + esc(detail) + '</div>' +
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
      box.innerHTML = '<span style="color:#8A6A00">' + esc(r.reason) + '</span>' +
        (r.historyWarning ? '<div style="margin-top:6px;color:#8A6A00">' + esc(r.historyWarning) + '</div>' : '');
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
      '<p class="detail-note" id="relNote" style="margin-top:8px">Aucun envoi automatique : le message s’ouvre dans votre application et c’est vous qui appuyez sur envoyer.</p>' +
      '<div class="drawer__label" style="margin-top:14px">Historique relationnel</div>' +
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
    $('#drawerMeta').textContent = d.templateName + ' · ' + d.progress.ok + '/' + d.progress.total + ' validées' +
      (d.recipient ? ' · ' + d.recipient : '');

    var verdict = sealed
      ? '<div class="verdict-box is-ok"><div class="verdict-box__t">Dossier scellé</div><div class="verdict-box__s">Empreinte enregistrée le ' +
        new Date(sealed.at).toLocaleString('fr-FR') + '. Le dossier n\'accepte plus de pièce.</div></div>'
      : obstacles.length
        ? '<div class="verdict-box is-warn"><div class="verdict-box__t">' + obstacles.length + ' obstacle' + (obstacles.length > 1 ? 's' : '') +
          '</div><div class="verdict-box__s">Le scellement sera possible quand toutes les pièces seront validées.</div></div>'
        : '<div class="verdict-box is-ok"><div class="verdict-box__t">Prêt à sceller</div><div class="verdict-box__s">Toutes les pièces sont validées.</div></div>';

    var obstacleHtml = obstacles.length
      ? '<div class="drawer__section"><div class="drawer__label">Obstacles</div>' + obstacles.map(function (o) {
          return '<div class="obstacle"><span class="obstacle__dot"></span><div>' +
            '<div class="obstacle__t">' + esc(o.label) + '</div>' +
            '<div class="obstacle__d">' + esc(o.reason || (o.status === 'wait' ? 'Pièce non déposée.' : 'Pièce à vérifier.')) + '</div>' +
            '</div></div>';
        }).join('') + '</div>'
      : '';

    var sealHtml;
    if (sealed) {
      sealHtml = '<div class="drawer__section"><div class="drawer__label">Scellement</div>' +
        '<div class="seal-hash">' + esc(sealed.hash) + '</div>' +
        '<div class="detail-actions" style="margin-top:10px">' +
          '<a class="btn btn--primary btn--sm" href="/api/dossiers/' + d.id + '/certificate">Certificat PDF</a>' +
          '<button class="btn btn--ghost btn--sm" id="checkIntegrity">Vérifier l\'intégrité</button>' +
        '</div><div id="integrityOut" class="detail-note"></div></div>';
    } else {
      sealHtml = '<div class="drawer__section"><div class="drawer__label">Scellement</div>' +
        '<p class="detail-note" style="margin-top:0">Calcule une empreinte SHA-256 des pièces et produit un certificat PDF horodaté.</p>' +
        '<button class="btn btn--primary btn--block btn--sm" id="sealBtn"' +
        (obstacles.length ? ' disabled style="opacity:.45;cursor:not-allowed"' : '') + '>Sceller le dossier</button></div>';
    }

    $('#drawerBody').innerHTML = verdict + obstacleHtml +
      '<div class="drawer__section">' +
        '<div class="drawer__label">Lien client</div>' +
        '<div class="link-line"><code>' + esc(d.link) + '</code>' +
          '<button class="btn btn--ghost btn--sm" id="copyLink" style="height:28px;padding:0 9px;font-size:10.5px">Copier</button></div>' +
        '<div class="detail-actions" style="margin-top:10px">' +
          '<a class="btn btn--ghost btn--sm" href="' + esc(d.link) + '" target="_blank" rel="noopener">Ouvrir le portail</a>' +
          '<a class="btn btn--ghost btn--sm" style="border-color:#BBE5CA;color:#0A8F7C" target="_blank" rel="noopener" href="' +
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
        '<div class="drawer__label">Pièces du dossier</div>' +
        d.pieces.map(function (p) { return pieceRow(d, p); }).join('') +
      '</div>' +
      '<div class="drawer__section">' +
        '<div class="drawer__label">Journal des décisions</div>' +
        '<div id="journalBox" class="detail-note" style="margin-top:6px">Chargement…</div>' +
      '</div>' + sealHtml +
      (sealed
        ? '<div class="drawer__section"><div class="drawer__label">Relation client</div>' +
          '<div id="relationBox" class="detail-note" style="margin-top:6px">Chargement…</div></div>'
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
            ? '<span style="color:var(--green);font-weight:600">Intègre — empreinte recalculée identique.</span>'
            : '<span style="color:#C4304A;font-weight:600">Altéré — ' +
              (r.changed.length ? 'pièces modifiées : ' + esc(r.changed.join(', ')) : 'le manifeste ne correspond plus.') + '</span>';
        } catch (e) { out.textContent = e.message; }
      });
    }

    $('#drawer').classList.add('is-open');
    $('#drawerOverlay').classList.add('is-open');
    $('#drawerOverlay').style.background = 'rgba(10,14,26,.25)';
  }

  function closeDrawer() {
    $('#drawer').classList.remove('is-open');
    $('#drawerOverlay').classList.remove('is-open');
  }

  /* ---------- création ---------- */
  function fillTemplates() {
    $('#clientTpl').innerHTML = state.templates.map(function (t) {
      return '<option value="' + t.id + '">' + esc(t.name) + ' — ' + esc(t.family) + '</option>';
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
    $('#tplHint').textContent = t.catalog.length + ' pièces possibles pour ce modèle.';
    renderPicks();
  }

  /* Le catalogue du modèle est proposé en entier, pré-coché selon les usages.
     Le cabinet décoche ce qu'il ne demande pas. */
  function renderPicks() {
    var t = currentTemplate();
    if (!t) return;
    $('#piecePicks').innerHTML = t.catalog.map(function (p) {
      var on = t.defaults.indexOf(p.key) !== -1;
      return '<label class="pick">' +
        '<input type="checkbox" data-label="' + esc(p.label) + '" data-rule="' + esc(p.rule) + '"' + (on ? ' checked' : '') + '>' +
        '<span class="pick__t">' + esc(p.label) + '</span>' +
        '<span class="pick__r">' + esc(p.rule) + '</span>' +
        '</label>';
    }).join('');
    updateCount();
  }

  function updateCount() {
    var n = $('#piecePicks').querySelectorAll('input:checked').length +
      $('#customPieces').querySelectorAll('.pick--custom').length;
    $('#pickCount').textContent = n === 0 ? '(aucune)' : '(' + n + ')';
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
      out.push({ label: el.getAttribute('data-label'), rule: el.getAttribute('data-rule') });
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

  async function boot() {
    try {
      var me = await api('/api/me');
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
      } else {
        pill.classList.add('is-off');
        pill.querySelector('span').textContent = 'IA non configurée';
        pill.title = 'La vérification automatique est momentanément indisponible. Les pièces restent déposables et validables manuellement.';
      }

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
