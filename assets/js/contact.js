/* Aura Collect — formulaire de contact (sans backend)
   Prépare un email complet dans la messagerie du visiteur.
   Pour brancher un vrai endpoint, voir README.md §5. */
(function () {
  'use strict';

  var DEST = 'bonjour@auracollect.fr'; // ← à remplacer par votre adresse réelle
  var form = document.getElementById('contactForm');
  if (!form) return;
  var ok = document.getElementById('formOk');

  /* pré-remplissage depuis ?offre=pro */
  var params = new URLSearchParams(location.search);
  var offre = params.get('offre');
  var msg = document.getElementById('message');
  if (offre && msg && !msg.value) {
    var labels = { starter: 'Starter (50 000 FCFA/mois)', pro: 'Pro (95 000 FCFA/mois)', cabinet: 'Cabinet (160 000 FCFA/mois)' };
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

    var href = 'mailto:' + DEST + '?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(body);
    window.location.href = href;

    if (ok) {
      ok.innerHTML = 'Votre messagerie s\'ouvre avec la demande préremplie. Il ne reste qu\'à l\'envoyer. ' +
        'Si rien ne s\'est passé, <a href="' + href + '" style="color:#0B7A5C;font-weight:600;text-decoration:underline">cliquez ici</a> ' +
        'ou écrivez à ' + DEST + '.';
      ok.classList.add('is-on');
      ok.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  });
})();
