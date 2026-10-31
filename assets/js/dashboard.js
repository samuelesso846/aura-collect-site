/* Aura Collect — tableau de bord de démonstration */
(function () {
  'use strict';

  var S = window.AuraStore;
  var state = S.load();
  var activeFilter = '';

  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  var ICON = {
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>',
    cross: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>',
    clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7.5V12l3 2"/></svg>',
    doc: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6"/></svg>',
    home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10l9-7 9 7v10a1 1 0 01-1 1h-5v-6H9v6H4a1 1 0 01-1-1z"/></svg>',
    user: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="3.4"/><path d="M4.5 21c0-3.9 3.2-6.2 7.5-6.2s7.5 2.3 7.5 6.2"/></svg>',
    plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>'
  };

  /* ---------- utilitaires ---------- */
  function initials(name) {
    return name.split(/\s+/).filter(Boolean).slice(0, 2).map(function (w) { return w[0]; }).join('').toUpperCase();
  }

  function rel(iso) {
    if (!iso) return '—';
    var diff = (Date.now() - new Date(iso).getTime()) / 1000;
    if (diff < 90) return "à l'instant";
    if (diff < 3600) return 'il y a ' + Math.round(diff / 60) + ' min';
    if (diff < 86400) return 'il y a ' + Math.round(diff / 3600) + ' h';
    var d = Math.round(diff / 86400);
    return d <= 1 ? 'hier' : 'il y a ' + d + ' jours';
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function toast(msg) {
    var t = document.getElementById('auraToast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'auraToast';
      t.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%) translateY(20px);background:#0A0E1A;color:#fff;padding:11px 18px;border-radius:100px;font-size:12.5px;z-index:200;opacity:0;transition:.25s;box-shadow:0 20px 40px -20px rgba(0,0,0,.6)';
      document.body.appendChild(t);
    }
    t.textContent = msg;
    requestAnimationFrame(function () {
      t.style.opacity = '1';
      t.style.transform = 'translateX(-50%) translateY(0)';
    });
    clearTimeout(t._tm);
    t._tm = setTimeout(function () {
      t.style.opacity = '0';
      t.style.transform = 'translateX(-50%) translateY(12px)';
    }, 2400);
  }

  function portalLink(token) {
    var base = location.href.split('?')[0].replace(/[^/]*$/, '');
    return base + 'portail.html?d=' + token;
  }

  function copy(text) {
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(function () { toast('Lien copié'); }, fallback);
    } else { fallback(); }
    function fallback() {
      var ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); toast('Lien copié'); } catch (e) { toast('Copie impossible — sélectionnez le lien'); }
      document.body.removeChild(ta);
    }
  }

  /* ---------- rendu ---------- */
  function renderKpis() {
    var ds = state.dossiers;
    var counts = { attente: 0, incomplet: 0, complet: 0 };
    ds.forEach(function (d) { counts[S.statusOf(d)]++; });
    var piecesOk = ds.reduce(function (n, d) { return n + S.progressOf(d).ok; }, 0);
    var kpis = [
      { l: 'Dossiers actifs', n: ds.length, d: piecesOk + ' pièces validées' },
      { l: 'En attente client', n: counts.attente, d: 'aucun dépôt reçu' },
      { l: 'Incomplets', n: counts.incomplet, d: 'relance à envoyer' },
      { l: 'Complets', n: counts.complet, d: 'prêts à exporter' }
    ];
    $('#kpis').innerHTML = kpis.map(function (k) {
      return '<div class="kpi"><div class="kpi__l">' + k.l + '</div>' +
        '<div class="kpi__n">' + k.n + '</div>' +
        '<div class="kpi__d">' + k.d + '</div></div>';
    }).join('');
    $('#topbarSub').textContent = state.cabinet + ' · ' + ds.length + ' dossiers';
  }

  function card(d) {
    var p = S.progressOf(d);
    var st = S.statusOf(d);
    var tpl = S.template(d.template);
    var ko = d.pieces.filter(function (x) { return x.status === 'ko'; }).length;
    var barClass = st === 'complet' ? 'is-ok' : (st === 'incomplet' ? 'is-warn' : '');
    return '<button class="d-card" data-id="' + d.id + '">' +
      '<div class="d-card__top">' +
        '<span class="d-card__av">' + initials(d.client) + '</span>' +
        '<div style="min-width:0"><div class="d-card__name">' + esc(d.client) + '</div>' +
        '<div class="d-card__tpl">' + esc(tpl.name) + '</div></div>' +
      '</div>' +
      '<div class="d-card__bar ' + barClass + '"><i style="width:' + (st === 'attente' ? 3 : p.pct) + '%"></i></div>' +
      '<div class="d-card__meta"><span>' + p.ok + '/' + p.total + ' pièces</span>' +
      (ko ? '<span class="d-card__flag">' + ko + ' refusée' + (ko > 1 ? 's' : '') + '</span>' : '<span>' + rel(d.lastActivity) + '</span>') +
      '</div></button>';
  }

  function renderBoard() {
    var cols = [
      { id: 'attente', title: 'En attente', dot: '#98A0B2', empty: 'Aucun dossier en attente de premier dépôt.' },
      { id: 'incomplet', title: 'Incomplet', dot: '#FF9F43', empty: 'Tous les dossiers ouverts ont leurs pièces.' },
      { id: 'complet', title: 'Complet', dot: '#12A57C', empty: 'Aucun dossier complet pour l\'instant.' }
    ];
    var ds = state.dossiers.filter(function (d) {
      if (!activeFilter) return true;
      var q = activeFilter.toLowerCase();
      return d.client.toLowerCase().indexOf(q) > -1 || d.email.toLowerCase().indexOf(q) > -1;
    });

    $('#board').innerHTML = cols.map(function (c) {
      var list = ds.filter(function (d) { return S.statusOf(d) === c.id; });
      return '<div class="col">' +
        '<div class="col__head"><span class="col__dot" style="background:' + c.dot + '"></span>' + c.title +
        '<span class="cnt">' + list.length + '</span></div>' +
        (list.length ? list.map(card).join('') : '<div class="empty">' + c.empty + '</div>') +
        '</div>';
    }).join('');

    $$('.d-card').forEach(function (el) {
      el.addEventListener('click', function () { openDrawer(el.dataset.id); });
    });
  }

  function renderTemplates() {
    var strip = $('#tplStrip');
    strip.innerHTML = S.TEMPLATES.map(function (t) {
      return '<button class="tpl" data-tpl="' + t.id + '" style="text-align:left;padding:16px 16px 15px">' +
        '<div class="tpl__ico" style="width:30px;height:30px;border-radius:8px;margin-bottom:10px">' + (ICON[t.icon] || ICON.doc) + '</div>' +
        '<h4 style="font-size:12.5px">' + esc(t.name) + '</h4>' +
        '<p style="font-size:11px">' + esc(t.family) + ' · ' + t.pieces.length + ' pièces</p>' +
        '</button>';
    }).join('');
    $$('[data-tpl]').forEach(function (el) {
      el.addEventListener('click', function () { openNew(el.dataset.tpl); });
    });
  }

  function render() {
    renderKpis();
    renderBoard();
  }

  /* ---------- modale nouvelle demande ---------- */
  var modalNew = $('#modalNew');
  var formNew = $('#formNew');
  var selectTpl = $('#clientTpl');

  function fillSelect() {
    selectTpl.innerHTML = S.TEMPLATES.map(function (t) {
      return '<option value="' + t.id + '">' + esc(t.name) + ' — ' + esc(t.family) + '</option>';
    }).join('');
    updateHint();
  }

  function updateHint() {
    var t = S.template(selectTpl.value);
    $('#tplHint').textContent = t.pieces.length + ' pièces attendues : ' +
      t.pieces.slice(0, 3).map(function (p) { return p.label; }).join(', ') +
      (t.pieces.length > 3 ? '…' : '');
  }

  function resetModal() {
    formNew.reset();
    formNew.style.display = '';
    $('#modalNewTitle').textContent = 'Nouvelle demande';
    var old = $('#newSuccess');
    if (old) old.remove();
    var btn = formNew.querySelector('button[type=submit]');
    if (btn) btn.disabled = false;
  }

  function openNew(tplId) {
    resetModal();
    fillSelect();
    if (tplId) selectTpl.value = tplId;
    updateHint();
    modalNew.classList.add('is-open');
    setTimeout(function () { $('#clientName').focus(); }, 60);
  }

  function closeAll() {
    modalNew.classList.remove('is-open');
    closeDrawer();
  }

  selectTpl.addEventListener('change', updateHint);

  formNew.addEventListener('submit', function (e) {
    e.preventDefault();
    var name = $('#clientName').value.trim();
    var email = $('#clientEmail').value.trim();
    if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
      if (!name) $('#clientName').style.borderColor = '#F0506E';
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) $('#clientEmail').style.borderColor = '#F0506E';
      return;
    }
    var d = S.create(state, { client: name, email: email, template: selectTpl.value });
    render();
    var link = portalLink(d.token);

    formNew.style.display = 'none';
    $('#modalNewTitle').textContent = 'Demande créée';
    var box = document.createElement('div');
    box.id = 'newSuccess';
    box.innerHTML =
      '<div style="display:flex;gap:10px;align-items:center;margin-bottom:16px">' +
        '<div style="width:34px;height:34px;border-radius:50%;background:var(--green-soft);color:var(--green);display:grid;place-items:center;flex:0 0 34px">' + ICON.check + '</div>' +
        '<div><div style="font-size:13.5px;font-weight:650">Lien client généré</div>' +
        '<div style="font-size:11.5px;color:var(--muted)">' + esc(name) + ' · ' + S.template(d.template).pieces.length + ' pièces demandées</div></div>' +
      '</div>' +
      '<div style="font-size:11.5px;font-weight:650;margin-bottom:6px;color:var(--ink-3)">Lien d\'accès magique</div>' +
      '<div class="link-box"><code>' + esc(link) + '</code>' +
        '<button class="btn btn--ghost btn--sm" id="copyLink" style="height:30px;padding:0 10px;font-size:11px;flex:0 0 auto">Copier</button>' +
      '</div>' +
      '<p style="font-size:11px;color:var(--muted);margin-top:10px;line-height:1.5">En production, ce lien est envoyé par email et expire après 30 jours. Aucun mot de passe, aucun compte.</p>' +
      '<div style="display:flex;gap:8px;margin-top:18px">' +
        '<a class="btn btn--primary btn--sm" style="flex:1" href="' + link + '">Ouvrir le portail client</a>' +
        '<button class="btn btn--ghost btn--sm" id="againBtn">Nouvelle</button>' +
      '</div>';
    $('#modalNewBody').appendChild(box);
    $('#copyLink').addEventListener('click', function () { copy(link); });
    $('#againBtn').addEventListener('click', resetModal);
  });

  /* ---------- tiroir ---------- */
  var drawer = $('#drawer');
  var drawerOverlay = $('#drawerOverlay');

  function pieceRow(p) {
    var cls = p.status === 'ok' ? 'ok' : (p.status === 'ko' ? 'ko' : 'wait');
    var ico = p.status === 'ok' ? ICON.check : (p.status === 'ko' ? ICON.cross : ICON.clock);
    var tag = p.status === 'ok' ? 'Validé' : (p.status === 'ko' ? 'Refusé' : 'Attendu');
    return '<div class="piece">' +
      '<div class="piece__st st--' + cls + '">' + ico + '</div>' +
      '<div style="min-width:0;flex:1">' +
        '<div class="piece__n">' + esc(p.label) + '</div>' +
        '<div class="piece__f">' + (p.file ? esc(p.file) : 'Règle : ' + esc(p.rule)) + '</div>' +
        (p.reason ? '<div class="piece__why">' + esc(p.reason) + '</div>' : '') +
      '</div>' +
      '<span class="piece__tag tag--' + cls + '">' + tag + '</span>' +
    '</div>';
  }

  function openDrawer(id) {
    var d = S.byId(state, id);
    if (!d) return;
    var p = S.progressOf(d);
    var tpl = S.template(d.template);
    var link = portalLink(d.token);

    $('#drawerName').textContent = d.client;
    $('#drawerMeta').textContent = tpl.name + ' · ' + p.ok + '/' + p.total + ' pièces validées · créé ' + rel(d.createdAt);

    $('#drawerBody').innerHTML =
      '<div class="drawer__section">' +
        '<div class="drawer__label">Progression</div>' +
        '<div class="progress__bar" style="height:7px"><i style="width:' + p.pct + '%"></i></div>' +
        '<div style="display:flex;justify-content:space-between;font-size:10.5px;color:var(--muted);margin-top:7px">' +
          '<span>' + p.ok + ' validées</span><span>' + (p.total - p.ok) + ' restantes</span></div>' +
      '</div>' +
      '<div class="drawer__section">' +
        '<div class="drawer__label">Pièces du dossier</div>' +
        d.pieces.map(pieceRow).join('') +
      '</div>' +
      '<div class="drawer__section">' +
        '<div class="drawer__label">Lien client</div>' +
        '<div class="link-box"><code>' + esc(link) + '</code>' +
          '<button class="btn btn--ghost btn--sm" id="dCopy" style="height:30px;padding:0 10px;font-size:11px;flex:0 0 auto">Copier</button></div>' +
        '<div style="display:flex;gap:8px;margin-top:10px">' +
          '<a class="btn btn--ghost btn--sm" style="flex:1" href="' + link + '">Ouvrir le portail</a>' +
          '<button class="btn btn--ghost btn--sm" id="dMail" style="flex:1">Renvoyer le lien</button>' +
        '</div>' +
      '</div>' +
      '<div class="drawer__section">' +
        '<div class="drawer__label">Sortie</div>' +
        '<button class="btn btn--primary btn--block btn--sm" id="dExport" style="height:44px">Prévisualiser l\'export ZIP</button>' +
        '<p style="font-size:10.5px;color:var(--muted);margin-top:8px;line-height:1.5">Fichiers renommés automatiquement : ' +
          esc(S.exportTree(d).files[0]) + ', ' + esc(S.exportTree(d).files[1]) + '…</p>' +
      '</div>';

    $('#dCopy').addEventListener('click', function () { copy(link); });
    $('#dMail').addEventListener('click', function () { toast('Lien renvoyé à ' + d.email + ' (simulation)'); });
    $('#dExport').addEventListener('click', function () { openExport(d); });

    drawer.classList.add('is-open');
    drawerOverlay.classList.add('is-open');
    drawerOverlay.style.background = 'rgba(10,14,26,.25)';
  }

  function closeDrawer() {
    drawer.classList.remove('is-open');
    drawerOverlay.classList.remove('is-open');
  }

  /* ---------- export ---------- */
  function openExport(d) {
    var tree = S.exportTree(d);
    var old = document.getElementById('exportModal');
    if (old) old.remove();

    var overlay = document.createElement('div');
    overlay.className = 'overlay is-open';
    overlay.id = 'exportModal';
    overlay.style.zIndex = '120';
    overlay.innerHTML =
      '<div class="modal" style="max-width:540px">' +
        '<div class="modal__head"><div><h2>Export du dossier</h2>' +
        '<p>' + esc(d.client) + ' · ' + tree.files.length + ' fichiers' + (tree.missing ? ' · ' + tree.missing + ' pièce(s) manquante(s)' : '') + '</p></div>' +
        '<button class="modal__x" data-close-export aria-label="Fermer">✕</button></div>' +
        '<div class="modal__body">' +
          '<div class="drawer__label">Arborescence générée</div>' +
          '<div class="tree"><b>' + esc(tree.folder) + '/</b><br>' +
            tree.files.map(function (f, i) {
              var ok = d.pieces[i] && d.pieces[i].status === 'ok';
              return (ok ? '├── <i>' + esc(f) + '</i>' : '├── <span style="color:#5B6480">' + esc(f) + ' (manquant)</span>');
            }).join('<br>') +
            '<br>└── <b>sommaire.pdf</b>' +
          '</div>' +
          '<p style="font-size:11.5px;color:var(--muted);line-height:1.55;margin-top:14px">' +
            'En production, le ZIP contient les pièces originales, renommées selon le modèle, plus un sommaire PDF horodaté. ' +
            'Cette démo ne stocke aucun fichier : elle génère le manifeste.' +
          '</p>' +
          '<div style="display:flex;gap:8px;margin-top:16px">' +
            '<button class="btn btn--primary btn--sm" id="dlManifest" style="flex:1">Télécharger le manifeste</button>' +
            '<button class="btn btn--ghost btn--sm" data-close-export>Fermer</button>' +
          '</div>' +
        '</div>' +
      '</div>';
    document.body.appendChild(overlay);

    overlay.addEventListener('click', function (e) {
      if (e.target === overlay || e.target.hasAttribute('data-close-export')) overlay.remove();
    });

    document.getElementById('dlManifest').addEventListener('click', function () {
      var text = 'AURA COLLECT — manifeste d\'export\n' +
        'Cabinet : ' + state.cabinet + '\n' +
        'Client : ' + d.client + '\n' +
        'Modèle : ' + S.template(d.template).name + '\n' +
        'Date : ' + new Date().toLocaleString('fr-FR') + '\n\n' +
        tree.folder + '/\n' +
        tree.files.map(function (f, i) {
          return '  ├── ' + f + (d.pieces[i].status === 'ok' ? '' : '   [manquant]');
        }).join('\n') + '\n  └── sommaire.pdf\n';
      var blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = tree.folder + '_manifeste.txt';
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 1500);
      toast('Manifeste téléchargé');
    });
  }

  /* ---------- événements globaux ---------- */
  $('#newBtn').addEventListener('click', function () { openNew(); });

  $$('[data-close]').forEach(function (b) {
    b.addEventListener('click', function () {
      if (b.hasAttribute('data-close')) { modalNew.classList.remove('is-open'); resetModal(); }
    });
  });

  $$('[data-close-drawer]').forEach(function (b) { b.addEventListener('click', closeDrawer); });
  drawerOverlay.addEventListener('click', closeDrawer);

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      closeAll();
      var ex = document.getElementById('exportModal');
      if (ex) ex.remove();
    }
  });

  modalNew.addEventListener('click', function (e) {
    if (e.target === modalNew) { modalNew.classList.remove('is-open'); resetModal(); }
  });

  $('#resetBtn').addEventListener('click', function (e) {
    e.preventDefault();
    state = S.reset();
    activeFilter = '';
    $('#search').value = '';
    render();
    toast('Démo réinitialisée');
  });

  var search = $('#search');
  $('#searchWrap').style.display = 'block';
  search.addEventListener('input', function () {
    activeFilter = search.value.trim();
    renderBoard();
  });

  $$('[data-soon]').forEach(function (a) {
    a.addEventListener('click', function (e) {
      e.preventDefault();
      toast('Écran disponible dans la version complète');
    });
  });

  /* ---------- init ---------- */
  fillSelect();
  renderTemplates();
  render();
})();
