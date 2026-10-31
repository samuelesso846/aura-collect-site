/* Aura Collect — portail client de démonstration
   La vérification est simulée localement, selon le nom du fichier :
   « flou » → lisibilité, « expire » → validité, « facture » → mauvais type. */
(function () {
  'use strict';

  var S = window.AuraStore;
  var state = S.load();
  var params = new URLSearchParams(location.search);
  var token = params.get('d');
  var dossier = token ? S.byToken(state, token) : null;
  var fallback = false;

  if (!dossier) {
    /* accès direct : on montre un dossier de démonstration */
    for (var i = 0; i < state.dossiers.length; i++) {
      if (S.statusOf(state.dossiers[i]) === 'incomplet') { dossier = state.dossiers[i]; break; }
    }
    if (!dossier) dossier = state.dossiers[0];
    fallback = true;
  }

  var $ = function (s) { return document.querySelector(s); };
  var busy = false;
  var pendingIndex = -1;

  var ICON = {
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>',
    cross: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>',
    clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7.5V12l3 2"/></svg>',
    upload: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 16v3a2 2 0 002 2h12a2 2 0 002-2v-3"/></svg>',
    camera: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8a2 2 0 012-2h2l1.5-2h7L17 6h2a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><circle cx="12" cy="12.5" r="3.4"/></svg>',
    file: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6"/></svg>'
  };

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function progress() { return S.progressOf(dossier); }

  function persist() {
    dossier.lastActivity = new Date().toISOString();
    S.save(state);
  }

  /* ---------- en-tête ---------- */
  function renderHead() {
    var p = progress();
    var tpl = S.template(dossier.template);
    var first = dossier.client.split(' ')[0];
    $('#cabinetName').textContent = state.cabinet;
    $('#greeting').textContent = 'Bonjour ' + first + ',';
    $('#intro').textContent = 'Votre cabinet vous demande ' + p.total + ' pièces pour votre dossier « ' +
      tpl.name + ' ». Chaque document est vérifié immédiatement : vous saurez tout de suite s\'il convient.';

    $('#progressLabel').textContent = p.ok + ' / ' + p.total + ' pièces validées';
    $('#progressBar').style.width = p.pct + '%';
    $('#progressHint').textContent = p.ok === p.total
      ? 'Dossier complet'
      : (p.total - p.ok === 1 ? 'Il reste 1 document' : 'Il reste ' + (p.total - p.ok) + ' documents');

    if (fallback) $('#demoNote').hidden = false;
  }

  /* ---------- liste ---------- */
  function renderList() {
    $('#list').innerHTML = dossier.pieces.map(function (piece, i) {
      var cls = piece.status === 'ok' ? 'is-done' : (piece.status === 'ko' ? 'is-ko' : '');
      var ico = piece.status === 'ok' ? ICON.check : (piece.status === 'ko' ? ICON.cross : ICON.file);
      var sub, action;

      if (piece.status === 'ok') {
        sub = '<span style="color:var(--green)">Validé · ' + esc(piece.file) + '</span>';
        action = '<button class="btn btn--ghost btn--sm" data-act="replace" data-i="' + i + '">Remplacer</button>';
      } else if (piece.status === 'ko') {
        sub = '<span class="err">' + esc(piece.reason) + '</span>';
        action = '<button class="btn btn--ghost btn--sm" data-cam="' + i + '" aria-label="Prendre une photo" style="padding:0 10px;margin-right:5px">' + ICON.camera + '</button>' +
          '<button class="btn btn--primary btn--sm" data-act="pick" data-i="' + i + '">Reprendre</button>';
      } else {
        sub = 'Attendu · ' + esc(piece.rule);
        action = '<button class="btn btn--ghost btn--sm" data-cam="' + i + '" aria-label="Prendre une photo" style="padding:0 10px;margin-right:5px">' + ICON.camera + '</button>' +
          '<button class="btn btn--ghost btn--sm" data-act="pick" data-i="' + i + '">Déposer</button>';
      }

      return '<div class="upload ' + cls + '" id="row-' + i + '">' +
        '<div class="upload__ico">' + ico + '</div>' +
        '<div class="upload__body">' +
          '<div class="upload__n">' + esc(piece.label) + '</div>' +
          '<div class="upload__s">' + sub + '</div>' +
        '</div>' +
        '<div class="upload__act">' + action + '</div>' +
      '</div>';
    }).join('');

    document.querySelectorAll('[data-act]').forEach(function (b) {
      b.addEventListener('click', function () {
        if (busy) return;
        pendingIndex = +b.dataset.i;
        $('#fileAny').click();
      });
    });

    document.querySelectorAll('[data-cam]').forEach(function (b) {
      b.addEventListener('click', function () {
        if (busy) return;
        pendingIndex = +b.dataset.cam;
        $('#fileCamera').click();
      });
    });
  }

  /* ---------- analyse simulée ---------- */
  var STEPS = [
    'Lecture du document…',
    'Contrôle du type de pièce…',
    'Vérification de la lisibilité…',
    'Contrôle des dates…'
  ];

  function analyse(piece, file, done) {
    var row = document.getElementById('row-' + dossier.pieces.indexOf(piece));
    if (!row) return done();

    var box = document.createElement('div');
    box.className = 'analysis';
    box.innerHTML = '<span class="spinner"></span><div><div class="analysis__t" id="anTitle">Lecture du document…</div>' +
      '<div class="analysis__s" id="anSub">' + esc(file.name) + '</div></div>';
    row.insertAdjacentElement('afterend', box);

    var step = 0;
    var iv = setInterval(function () {
      step++;
      if (step < STEPS.length) {
        $('#anTitle').textContent = STEPS[step];
      }
    }, 520);

    setTimeout(function () {
      clearInterval(iv);
      box.remove();
      done();
    }, 2100);
  }

  function verdict(name, piece) {
    var n = name.toLowerCase();
    if (/flou|blur|sombre|noir|obscur/.test(n)) {
      return {
        ok: false,
        reason: 'Photo trop sombre ou floue : le document n\'est pas lisible en entier. Reprenez-la à la lumière du jour, feuille bien à plat, quatre coins visibles.'
      };
    }
    if (/expire|perime|périmé|2021|2022|2023/.test(n)) {
      return {
        ok: false,
        reason: 'Ce document semble trop ancien. Il faut une version récente : ' + piece.rule + '.'
      };
    }
    if (/facture|electricite|électricité|edf|orange|sosh/.test(n)) {
      return {
        ok: false,
        reason: 'Ce document ne correspond pas à la pièce attendue (« ' + piece.label + ' »). Une facture ne peut pas servir de justificatif.'
      };
    }
    return { ok: true };
  }

  function handleFile(file) {
    if (!file || pendingIndex < 0 || busy) return;
    if (file.size > 15 * 1024 * 1024) {
      alert('Fichier trop volumineux : 15 Mo maximum.');
      return;
    }

    var piece = dossier.pieces[pendingIndex];
    busy = true;

    analyse(piece, file, function () {
      var v = verdict(file.name, piece);
      if (v.ok) {
        piece.status = 'ok';
        piece.file = file.name;
        piece.reason = '';
        piece.at = new Date().toISOString();
      } else {
        piece.status = 'ko';
        piece.file = '';
        piece.reason = v.reason;
        piece.at = new Date().toISOString();
      }
      persist();
      busy = false;
      renderHead();
      renderList();
      if (progress().ok === dossier.pieces.length) renderDone();
    });

    /* feedback immédiat */
    var row = document.getElementById('row-' + pendingIndex);
    if (row) {
      row.classList.add('is-done');
      row.classList.remove('is-ko');
      row.querySelector('.upload__s').textContent = 'Analyse en cours…';
    }
  }

  /* ---------- dépôt ---------- */
  $('#fileAny').addEventListener('change', function (e) {
    handleFile(e.target.files[0]);
    e.target.value = '';
  });
  $('#fileCamera').addEventListener('change', function (e) {
    var f = e.target.files[0];
    if (f && !/\.[a-z0-9]+$/i.test(f.name)) {
      /* photo prise à l'instant : nom neutre */
      try { Object.defineProperty(f, 'name', { value: 'photo-' + Date.now() + '.jpg' }); } catch (err) { /* read-only */ }
    }
    handleFile(f);
    e.target.value = '';
  });

  /* glisser-déposer */
  var card = $('#portalCard');
  ['dragenter', 'dragover'].forEach(function (ev) {
    card.addEventListener(ev, function (e) {
      e.preventDefault();
      card.style.outline = '2px dashed #6B4BFF';
      card.style.outlineOffset = '-8px';
    });
  });
  ['dragleave', 'drop'].forEach(function (ev) {
    card.addEventListener(ev, function (e) {
      e.preventDefault();
      card.style.outline = '';
      card.style.outlineOffset = '';
    });
  });
  card.addEventListener('drop', function (e) {
    if (busy) return;
    var f = e.dataTransfer.files[0];
    if (!f) return;
    var idx = dossier.pieces.findIndex(function (p) { return p.status !== 'ok'; });
    if (idx < 0) return;
    pendingIndex = idx;
    handleFile(f);
  });

  /* ---------- écran de fin ---------- */
  function renderDone() {
    var tpl = S.template(dossier.template);
    card.innerHTML =
      '<div class="done">' +
        '<div class="done__ico">' + ICON.check + '</div>' +
        '<div class="portal__hi">Dossier complet</div>' +
        '<h1 style="margin-top:8px">Merci ' + esc(dossier.client.split(' ')[0]) + ', tout est là.</h1>' +
        '<p>' + dossier.pieces.length + ' pièces validées pour votre dossier « ' + esc(tpl.name) + ' ».<br>' +
        'Votre cabinet vient d\'être notifié : il peut télécharger l\'ensemble, déjà classé et renommé.</p>' +
        '<div style="margin-top:24px;display:flex;gap:10px;justify-content:center;flex-wrap:wrap">' +
          '<a class="btn btn--primary btn--sm" href="demo.html">Voir le dossier côté cabinet</a>' +
          '<a class="btn btn--ghost btn--sm" href="index.html">En savoir plus</a>' +
        '</div>' +
        '<p style="font-size:11px;color:var(--muted);margin-top:28px">Vous pouvez fermer cette page. Un récapitulatif a été envoyé à ' + esc(dossier.email) + '.</p>' +
      '</div>';
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /* ---------- synchronisation entre onglets ---------- */
  window.addEventListener('storage', function (e) {
    if (e.key !== S.KEY) return;
    state = S.load();
    var fresh = token ? S.byToken(state, token) : S.byId(state, dossier.id);
    if (fresh) {
      dossier = fresh;
      renderHead();
      renderList();
    }
  });

  /* ---------- init ---------- */
  renderHead();
  renderList();
  if (progress().ok === dossier.pieces.length) renderDone();
})();
