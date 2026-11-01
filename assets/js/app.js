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
    $('#loginView').hidden = false;
    $('#dashView').hidden = true;
    $('#logoutBtn').hidden = true;
    setTimeout(function () { var p = $('#password'); if (p) p.focus(); }, 50);
  }

  function showDash() {
    var b = $('#bootView'); if (b) b.hidden = true;
    $('#loginView').hidden = true;
    $('#dashView').hidden = false;
    $('#logoutBtn').hidden = false;
  }

  /* ---------- rendu ---------- */
  function renderStats() {
    var ds = state.dossiers;
    var attente = ds.filter(function (d) { return d.status === 'attente'; }).length;
    var incomplet = ds.filter(function (d) { return d.status === 'incomplet'; }).length;
    var aValider = ds.filter(function (d) { return d.status === 'a_valider'; }).length;
    var scelles = ds.filter(function (d) { return d.status === 'scelle'; }).length;

    $('#stats').innerHTML = [
      { l: 'Dossiers', n: ds.length, c: '' },
      { l: 'Incomplets', n: incomplet + attente, c: (incomplet + attente) ? 'is-warn' : '' },
      { l: 'À valider', n: aValider, c: aValider ? 'is-warn' : '' },
      { l: 'Scellés', n: scelles, c: scelles ? 'is-ok' : '' }
    ].map(function (s) {
      return '<div class="stat-card"><div class="stat-card__l">' + s.l + '</div>' +
        '<div class="stat-card__n ' + s.c + '">' + s.n + '</div></div>';
    }).join('');

    $('#dashSub').textContent = ds.length
      ? ds.length + ' dossier' + (ds.length > 1 ? 's' : '') + ' · ' + aValider + ' à valider · ' + scelles + ' scellé' + (scelles > 1 ? 's' : '')
      : 'Aucun dossier pour l\'instant.';
  }

  function statusChip(d) {
    var map = { attente: 'En attente', incomplet: 'Incomplet', a_valider: 'À valider', scelle: 'Scellé' };
    return '<span class="chip chip--' + d.status + '"><i></i>' + map[d.status] + '</span>';
  }

  function renderList() {
    if (!state.dossiers.length) {
      $('#listWrap').innerHTML =
        '<div class="empty-state"><h3>Votre premier dossier</h3>' +
        '<p>Créez une demande : votre client reçoit un lien, dépose ses pièces, elles sont vérifiées à l\'arrivée.</p></div>';
      return;
    }

    // Le cabinet travaille par client, pas dossier par dossier.
    var groups = {};
    var order = [];
    state.dossiers.forEach(function (d) {
      var key = d.clientId || ('nom:' + d.client);
      if (!groups[key]) {
        groups[key] = { name: d.clientName || d.client, phone: d.clientPhone || '', items: [] };
        order.push(key);
      }
      groups[key].items.push(d);
    });
    order.sort(function (a, b) { return groups[a].name.localeCompare(groups[b].name, 'fr'); });

    var html = '';
    order.forEach(function (key) {
      var g = groups[key];
      var enCours = g.items.filter(function (d) { return d.status !== 'scelle'; }).length;
      html += '<div class="dgroup"><div class="dgroup__head">' +
        '<span class="dgroup__name">' + esc(g.name) + '</span>' +
        (g.phone ? '<span class="dgroup__phone">' + esc(g.phone) + '</span>' : '') +
        '<span class="dgroup__count">' + g.items.length + ' dossier' + (g.items.length > 1 ? 's' : '') +
        (enCours ? ' · ' + enCours + ' en cours' : ' · tout est scellé') + '</span>' +
      '</div>';
      html += g.items.map(function (d) {
        var barClass = d.status === 'scelle' ? 'is-ok'
          : d.status === 'incomplet' ? 'is-warn'
            : d.status === 'a_valider' ? 'is-warn' : '';
        return '<button class="drow" data-id="' + d.id + '">' +
          '<div class="drow__client"><span class="drow__av">' + initials(d.client) + '</span>' +
            '<div style="min-width:0"><div class="drow__name">' + esc(d.templateName) + '</div>' +
            '<div class="drow__mail">' + esc(d.email) + '</div></div></div>' +
          '<div class="drow__tpl">' + esc(d.recipient || '—') + '</div>' +
          '<div class="drow__prog"><div class="drow__bar ' + barClass + '"><i style="width:' + d.progress.pct + '%"></i></div>' +
            '<div class="drow__count">' + d.progress.ok + '/' + d.progress.total + ' pièces reçues</div></div>' +
          '<div class="drow__date">' + rel(d.lastActivity) + '</div>' +
          '<div class="drow__status">' + statusChip(d) + '</div>' +
        '</button>';
      }).join('');
      html += '</div>';
    });

    $('#listWrap').innerHTML =
      '<div class="dlist"><div class="dlist__head"><span>Dossier</span><span>Destinataire</span>' +
      '<span>Progression</span><span>Activité</span><span>Statut</span></div>' + html + '</div>';

    $$('.drow').forEach(function (row) {
      row.addEventListener('click', function () { openDrawer(row.dataset.id); });
    });
  }

  /* Écran du matin : ce que le client doit faire, et ce qui attend votre décision.
     Trié du plus ancien au plus récent — le dossier qui dort est celui qui coûte. */
  function renderTodo() {
    var wrap = $('#todoWrap');
    if (!wrap) return;

    var pourClient = state.dossiers
      .filter(function (d) { return d.status !== 'scelle' && d.obstacles.length; })
      .sort(function (a, b) { return new Date(a.lastActivity) - new Date(b.lastActivity); });

    var pourMoi = state.dossiers
      .filter(function (d) { return d.status === 'a_valider'; })
      .sort(function (a, b) { return new Date(a.lastActivity) - new Date(b.lastActivity); });

    if (!pourClient.length && !pourMoi.length) {
      wrap.innerHTML = '<div class="todo todo--empty"><b>Tout est à jour.</b> ' +
        'Aucun dossier en attente de pièce ou de décision.</div>';
      return;
    }

    function ligne(d, action) {
      var manque = action === 'client'
        ? d.obstacles.slice(0, 3).map(function (p) { return p.label; }).join(', ') +
          (d.obstacles.length > 3 ? ' +' + (d.obstacles.length - 3) : '')
        : d.progress.ok + ' pièces reçues, à confirmer';
      var btn = action === 'client'
        ? '<a class="btn btn--ghost btn--xs" target="_blank" rel="noopener" href="https://wa.me/?text=' +
            encodeURIComponent('Bonjour ' + (d.clientName || d.client) + ', il manque ' + d.obstacles.length +
              ' pièce(s) pour votre dossier : ' + d.link) + '">Relancer</a>'
        : '<button class="btn btn--primary btn--xs" data-open="' + d.id + '">Trancher</button>';
      return '<div class="todo__row">' +
        '<div class="todo__who"><b>' + esc(d.clientName || d.client) + '</b>' +
          '<span>' + esc(manque) + '</span></div>' +
        '<div class="todo__age">' + rel(d.lastActivity) + '</div>' +
        btn +
      '</div>';
    }

    var html = '<section class="todo"><div class="todo__head">' +
      '<h2>À faire maintenant</h2>' +
      '<span class="todo__sub">' + pourMoi.length + ' à trancher · ' + pourClient.length + ' client(s) à relancer</span>' +
    '</div><div class="todo__grid">';

    html += '<div class="todo__col"><h3>Le client doit agir <span>' + pourClient.length + '</span></h3>';
    html += pourClient.length
      ? pourClient.map(function (d) { return ligne(d, 'client'); }).join('')
      : '<p class="todo__none">Rien à réclamer.</p>';
    html += '</div>';

    html += '<div class="todo__col"><h3>Vous devez trancher <span>' + pourMoi.length + '</span></h3>';
    html += pourMoi.length
      ? pourMoi.map(function (d) { return ligne(d, 'moi'); }).join('')
      : '<p class="todo__none">Aucun dossier complet en attente.</p>';
    html += '</div>';

    html += '</div></section>';
    wrap.innerHTML = html;
  }

  function render() {
    renderStats();
    renderTodo();
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

    var confirmBtn = (!d.sealed && (p.status === 'ok' || p.status === 'review'))
      ? '<button class="btn btn--ghost btn--xs" data-confirm="' + d.id + '|' + p.key + '">Confirmer</button>'
      : '';

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
            'https://wa.me/?text=' + encodeURIComponent('Bonjour ' + d.client + ', voici le lien pour déposer vos pièces : ' + d.link) +
          '">Envoyer par WhatsApp</a>' +
          (d.obstacles.length
            ? '<a class="btn btn--ghost btn--sm" target="_blank" rel="noopener" href="https://wa.me/?text=' +
                encodeURIComponent('Bonjour ' + d.client + ', il manque encore ' + d.obstacles.length +
                  ' pièce(s) pour compléter votre dossier : ' + d.link) + '">Relancer</a>'
            : '') +
          '<a class="btn btn--ghost btn--sm" href="/api/dossiers/' + d.id + '/export">Télécharger le ZIP</a>' +
        '</div>' +
        '<p class="detail-note">Le ZIP contient les pièces renommées, le sommaire et, si le dossier est scellé, le certificat et le manifeste. Le lien client expire après 30 jours.</p>' +
      '</div>' +
      '<div class="drawer__section">' +
        '<div class="drawer__label">Pièces du dossier</div>' +
        d.pieces.map(function (p) { return pieceRow(d, p); }).join('') +
      '</div>' + sealHtml;

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

  function updateHint() {
    var id = $('#clientTpl').value;
    var t = state.templates.filter(function (x) { return x.id === id; })[0];
    if (!t) return;
    $('#tplHint').textContent = t.pieces.length + ' pièces : ' +
      t.pieces.slice(0, 3).map(function (p) { return p.label; }).join(', ') +
      (t.pieces.length > 3 ? '…' : '');
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
      toast('Pièce confirmée.');
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
      $('#cabinetName').textContent = me.cabinet;
      document.title = me.cabinet + ' — Aura Collect';

      var pill = $('#aiPill');
      if (me.ai && me.ai.ready) {
        pill.classList.remove('is-off');
        pill.querySelector('span').textContent = 'Vérification IA active';
      } else {
        pill.classList.add('is-off');
        pill.querySelector('span').textContent = 'IA non configurée';
        pill.title = 'La vérification automatique est momentanément indisponible. Les pièces restent déposables et validables manuellement.';
      }

      if (me.authenticated) await load();
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

  $('#logoutBtn').addEventListener('click', async function () {
    try { await api('/api/logout', { method: 'POST' }); } catch (_) {}
    showLogin();
  });

  $('#newBtn').addEventListener('click', openNew);
  $('#clientTpl').addEventListener('change', updateHint);

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
          recipient: $('#clientRecipient').value.trim()
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
