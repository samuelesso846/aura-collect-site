/* Aura Collect — portail client connecté à l'API réelle */
(function () {
  'use strict';

  var token = (location.pathname.match(/\/p\/([A-Za-z0-9]+)/) || [])[1] || '';
  var card = document.getElementById('card');
  var data = null;
  var busy = false;
  var pendingKey = '';

  var ICON = {
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>',
    cross: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>',
    clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7.5V12l3 2"/></svg>',
    camera: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8a2 2 0 012-2h2l1.5-2h7L17 6h2a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><circle cx="12" cy="12.5" r="3.4"/></svg>',
    file: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6"/></svg>'
  };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function fail(message) {
    card.innerHTML =
      '<div class="done">' +
        '<div class="done__ico" style="background:linear-gradient(140deg,#F0506E,#FF8CA0)">' + ICON.cross + '</div>' +
        '<h1 style="font-size:24px">Lien indisponible</h1>' +
        '<p>' + esc(message) + '</p>' +
        '<p style="font-size:11px;color:var(--muted);margin-top:18px">Demandez un nouveau lien à votre cabinet.</p>' +
      '</div>';
  }

  function initials(name) {
    return String(name).split(/\s+/).filter(Boolean).slice(0, 2).map(function (w) { return w[0]; }).join('').toUpperCase();
  }

  function renderHead() {
    var d = data.dossier;
    var p = d.progress;
    var review = d.pieces.filter(function (x) { return x.status === 'review'; }).length;
    var remaining = p.total - p.ok;
    var hint = p.ok === p.total ? 'Dossier complet'
      : review > 0
        ? review + ' à vérifier · ' + remaining + ' restant' + (remaining > 1 ? 's' : '')
        : (remaining === 1 ? 'Il reste 1 document' : 'Il reste ' + remaining + ' documents');

    var banner = data.ai ? '' :
      '<div style="margin-top:14px;background:#FFF8EC;border:1px solid #F5E3C3;color:#8A5A1B;border-radius:9px;padding:9px 11px;font-size:11px;line-height:1.5">' +
      'La vérification automatique n\'est pas encore activée sur ce cabinet : vos pièces sont bien transmises, le cabinet les contrôle manuellement.</div>';

    return '<div class="portal__head">' +
      '<div style="display:flex;align-items:center;gap:9px;margin-bottom:14px">' +
        '<span style="width:30px;height:30px;border-radius:8px;background:linear-gradient(140deg,#1B1240,#6B4BFF);color:#fff;display:grid;place-items:center;font-size:11px;font-weight:700">' + initials(data.cabinet) + '</span>' +
        '<span style="font-size:10.5px;font-weight:650;letter-spacing:.1em;text-transform:uppercase;color:var(--violet)">' + esc(data.cabinet) + '</span>' +
      '</div>' +
      '<h1>Bonjour ' + esc(d.client.split(' ')[0]) + ',</h1>' +
      '<p class="portal__desc">Votre cabinet vous demande ' + p.total + ' pièces pour votre dossier « ' + esc(d.template) + ' ». Chaque document est vérifié à l\'arrivée.</p>' +
      banner +
      '<div class="progress">' +
        '<div class="progress__top"><span>' + p.ok + ' / ' + p.total + ' pièces validées' +
          (review ? ' · ' + review + ' reçue' + (review > 1 ? 's' : '') : '') + '</span><b>' + hint + '</b></div>' +
        '<div class="progress__bar"><i style="width:' + p.pct + '%"></i></div>' +
      '</div>' +
    '</div>';
  }

  /* Le mode guidé : ce que la pièce est, où l'obtenir, ce qui est accepté,
     ce qui fait renvoyer. Contenu écrit côté serveur, jamais généré ici. */
  function guideBlock(p) {
    var g = p.guide;
    if (!g || p.status === 'ok') return '';

    function list(items) {
      return '<ul>' + items.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>';
    }

    var body = '';
    if (g.quoi) body += '<p>' + esc(g.quoi) + '</p>';
    if (g.ou) body += '<p><b>Où l\'obtenir :</b> ' + esc(g.ou) + '</p>';

    var cols = '';
    if (g.accepte && g.accepte.length) cols += '<div><b>Ce qui est accepté</b>' + list(g.accepte) + '</div>';
    if (g.refuse && g.refuse.length) cols += '<div><b>Ce qui fait renvoyer</b>' + list(g.refuse) + '</div>';
    if (cols) body += '<div class="g__cols">' + cols + '</div>';

    if (g.photo) body += '<p><b>Comment le prendre :</b> ' + esc(g.photo) + '</p>';
    if (g.substituts && g.substituts.length) body += '<p><b>Vous ne l\'avez pas ?</b> ' + esc(g.substituts.join(' · ')) + '</p>';

    return '<details class="upload__guide"' + (p.status === 'ko' ? ' open' : '') + '>' +
      '<summary>Comment l\'obtenir ?</summary>' +
      '<div class="g__in">' + body + '</div>' +
    '</details>';
  }

  function pieceRow(p, i) {
    var cls = p.status === 'ok' ? 'is-done' : p.status === 'ko' ? 'is-ko' : p.status === 'review' ? 'is-review' : '';
    if (p.guide && p.status !== 'ok') cls += ' has-guide';
    var ico = p.status === 'ok' ? ICON.check : p.status === 'ko' ? ICON.cross : ICON.clock;
    var sub, action;

    if (p.status === 'ok') {
      sub = '<span style="color:var(--green)">Validé · ' + esc(p.filename) + '</span>';
      action = '<button class="btn btn--ghost btn--sm" data-act="replace" data-key="' + esc(p.key) + '">Remplacer</button>';
    } else if (p.status === 'ko') {
      sub = '<span class="err">' + esc(p.reason) + '</span>';
      action = '<button class="btn btn--ghost btn--sm" data-cam="' + esc(p.key) + '" aria-label="Prendre une photo" style="padding:0 9px">' + ICON.camera + '</button>' +
        '<button class="btn btn--primary btn--sm" data-act="pick" data-key="' + esc(p.key) + '">Reprendre</button>';
    } else if (p.status === 'review') {
      sub = '<span class="review">' + esc(p.reason) + '</span>';
      action = '<button class="btn btn--ghost btn--sm" data-cam="' + esc(p.key) + '" aria-label="Prendre une photo" style="padding:0 9px">' + ICON.camera + '</button>' +
        '<button class="btn btn--ghost btn--sm" data-act="pick" data-key="' + esc(p.key) + '">Remplacer</button>';
    } else {
      sub = 'Attendu · ' + esc(p.rule);
      action = '<button class="btn btn--ghost btn--sm" data-cam="' + esc(p.key) + '" aria-label="Prendre une photo" style="padding:0 9px">' + ICON.camera + '</button>' +
        '<button class="btn btn--ghost btn--sm" data-act="pick" data-key="' + esc(p.key) + '">Déposer</button>';
    }

    return '<div class="upload ' + cls + '" id="row-' + i + '">' +
      '<div class="upload__ico">' + ico + '</div>' +
      '<div class="upload__body"><div class="upload__n">' + esc(p.label) + '</div>' +
        '<div class="upload__s">' + sub + '</div>' + guideBlock(p) + '</div>' +
      '<div class="upload__act">' + action + '</div>' +
    '</div>';
  }

  function bind() {
    Array.prototype.forEach.call(document.querySelectorAll('[data-act]'), function (b) {
      b.addEventListener('click', function () {
        if (busy) return;
        pendingKey = b.dataset.key;
        document.getElementById('fileAny').click();
      });
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-cam]'), function (b) {
      b.addEventListener('click', function () {
        if (busy) return;
        pendingKey = b.dataset.cam;
        document.getElementById('fileCamera').click();
      });
    });
  }

  function render() {
    if (!data) return;
    var d = data.dossier;

    if (d.progress.ok === d.progress.total) return renderDone();

    card.innerHTML = renderHead() +
      '<div class="portal__list">' + d.pieces.map(pieceRow).join('') + '</div>' +
      '<div class="portal__foot">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>' +
        '<span>Vos documents sont transmis de façon chiffrée à votre cabinet. Ils ne sont jamais rendus publics.</span>' +
      '</div>';
    bind();
  }

  function renderDone() {
    var d = data.dossier;
    card.innerHTML =
      '<div class="done">' +
        '<div class="done__ico">' + ICON.check + '</div>' +
        '<div class="portal__hi">Dossier complet</div>' +
        '<h1 style="margin-top:8px">Merci ' + esc(d.client.split(' ')[0]) + ', tout est là.</h1>' +
        '<p>' + d.pieces.length + ' pièces validées pour votre dossier « ' + esc(d.template) + ' ».<br>' +
        'Votre cabinet est prévenu : il peut télécharger l\'ensemble, déjà classé et renommé.</p>' +
        '<p style="font-size:11px;color:var(--muted);margin-top:24px">Vous pouvez fermer cette page.</p>' +
      '</div>';
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function showAnalysis(key) {
    var d = data.dossier;
    var idx = d.pieces.findIndex(function (p) { return p.key === key; });
    var row = document.getElementById('row-' + idx);
    if (!row) return null;
    var box = document.createElement('div');
    box.className = 'analysis';
    box.id = 'analysisBox';
    box.innerHTML = '<span class="spinner"></span><div><div class="analysis__t" id="anTitle">Téléversement…</div>' +
      '<div class="analysis__s">Le document est analysé, ne fermez pas cette page.</div></div>';
    row.insertAdjacentElement('afterend', box);

    var steps = ['Lecture du document…', 'Contrôle du type de pièce…', 'Vérification de la date…', 'Rédaction du verdict…'];
    var i = 0;
    var iv = setInterval(function () {
      var el = document.getElementById('anTitle');
      if (el && i < steps.length) el.textContent = steps[i++];
    }, 1400);
    return function () { clearInterval(iv); box.remove(); };
  }

  async function upload(file, key) {
    if (!file || busy) return;
    if (file.size > 15 * 1024 * 1024) {
      alert('Fichier trop volumineux : 15 Mo maximum.');
      return;
    }

    busy = true;
    var stop = showAnalysis(key);
    var form = new FormData();
    form.append('file', file);

    try {
      var res = await fetch('/api/portal/' + token + '/pieces/' + encodeURIComponent(key), {
        method: 'POST',
        body: form
      });
      var body = {};
      try { body = await res.json(); } catch (_) {}
      if (!res.ok) throw new Error(body.error || 'Dépôt impossible (' + res.status + ')');

      data.dossier = body.dossier;
      if (stop) stop();
      render();

      if (body.piece.status === 'ko') {
        var row = document.querySelector('.upload.is-ko');
        if (row) row.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    } catch (err) {
      if (stop) stop();
      alert(err.message);
    } finally {
      busy = false;
    }
  }

  document.getElementById('fileAny').addEventListener('change', function (e) {
    upload(e.target.files[0], pendingKey);
    e.target.value = '';
  });
  document.getElementById('fileCamera').addEventListener('change', function (e) {
    upload(e.target.files[0], pendingKey);
    e.target.value = '';
  });

  async function boot() {
    if (!token) return fail('Ce lien est incomplet.');
    try {
      var res = await fetch('/api/portal/' + token);
      var body = await res.json().catch(function () { return {}; });
      if (!res.ok) return fail(body.error || 'Ce lien n\'est plus valide.');
      data = body;
      render();
    } catch (err) {
      fail('Impossible de joindre le serveur. Vérifiez votre connexion et réessayez.');
    }
  }

  boot();
})();
