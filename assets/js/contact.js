/* Aura Collect — formulaire de contact (sans backend)
   Prépare un email complet dans la messagerie du visiteur.
   Pour brancher un vrai endpoint, voir README.md §5. */
(function () {
  'use strict';

  var DEST = 'samuelesso846@gmail.com'; // adresse de réception des demandes
  var form = document.getElementById('contactForm');
  if (!form) return;
  var ok = document.getElementById('formOk');

  /* pré-remplissage depuis ?offre=pro */
  var params = new URLSearchParams(location.search);
  var offre = params.get('offre');
  var msg = document.getElementById('message');
  if (offre && msg && !msg.value) {
    var labels = { starter: 'Starter (20 000 FCFA/mois)', pro: 'Pro (55 000 FCFA/mois)', cabinet: 'Cabinet (130 000 FCFA/mois)' };
    msg.value = 'Offre qui m\'intéresse : ' + (labels[offre] || offre) + '\n\nPièces demandées aujourd\'hui : ';
  }

  function invalid(el) {
    el.style.borderColor = '#F0506E';
    el.style.boxShadow = '0 0 0 3px rgba(240,80,110,.12)';
    el.addEventListener('input', function reset() {
      el.style.borderColor = '';
      el.style.boxShadow = '';
      el.removeEventListener('input', reset);
    });
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var prenom = form.prenom.value.trim();
    var nom = form.nom.value.trim();
    var email = form.email.value.trim();
    var structure = form.structure.value.trim();
    var metier = form.metier.value;
    var volume = form.volume.value;
    var message = form.message.value.trim();

    var bad = false;
    [form.prenom, form.nom, form.email].forEach(function (el) {
      if (!el.value.trim()) { invalid(el); bad = true; }
    });
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) { invalid(form.email); bad = true; }
    if (bad) return;

    var subject = 'Démo Aura Collect — ' + prenom + ' ' + nom + (structure ? ' (' + structure + ')' : '');
    var body = [
      'Bonjour,',
      '',
      'Je souhaite une démonstration d\'Aura Collect.',
      '',
      'Prénom : ' + prenom,
      'Nom : ' + nom,
      'Email : ' + email,
      'Structure : ' + (structure || '—'),
      'Métier : ' + metier,
      'Dossiers par mois : ' + volume,
      '',
      'Pièces demandées aujourd\'hui :',
      message || '—',
      '',
      'Merci.'
    ].join('\n');

    /* Repli : si l'enregistrement échoue, on propose la messagerie du visiteur. */
    var href = 'mailto:' + DEST + '?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(body);
    var link = '<a href="' + href + '" style="color:#0B7A5C;font-weight:600;text-decoration:underline">nous écrire depuis votre messagerie</a>';

    function show(html) {
      if (!ok) return;
      ok.innerHTML = html;
      ok.classList.add('is-on');
      ok.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    var btn = form.querySelector('button[type="submit"], input[type="submit"]');
    if (btn) btn.disabled = true;

    fetch('/api/contact', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prenom: prenom, nom: nom, email: email,
        structure: structure, metier: metier, volume: volume, message: message
      })
    }).then(function (r) {
      return r.json().then(function (d) { return { ok: r.ok, d: d }; });
    }).then(function (out) {
      if (out.ok && out.d && out.d.ok) {
        form.reset();
        show('Demande enregistrée. Nous vous répondons sous 24 heures ouvrées, à l\'adresse ' + email + '.');
      } else {
        var msg = (out.d && out.d.error) ? out.d.error : 'L\'envoi n\'a pas abouti.';
        show(msg + ' Vous pouvez aussi ' + link + ' ou écrire à ' + DEST + '.');
      }
    }).catch(function () {
      show('Connexion interrompue. ' + link.charAt(0).toUpperCase() + link.slice(1) +
           ', ou écrivez à ' + DEST + '.');
    }).then(function () {
      if (btn) btn.disabled = false;
    });
  });
})();
