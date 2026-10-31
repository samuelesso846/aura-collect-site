/* Aura Collect — interactions du site vitrine */
(function () {
  'use strict';
  document.documentElement.classList.add('js');

  /* nav : ombre au scroll */
  var nav = document.getElementById('nav');
  function onScroll() {
    if (!nav) return;
    nav.classList.toggle('is-stuck', window.scrollY > 8);
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  /* menu mobile */
  var burger = document.getElementById('burger');
  var menu = document.getElementById('mobileMenu');
  if (burger && menu) {
    burger.addEventListener('click', function () {
      var open = menu.classList.toggle('is-open');
      burger.setAttribute('aria-expanded', open ? 'true' : 'false');
      burger.setAttribute('aria-label', open ? 'Fermer le menu' : 'Ouvrir le menu');
    });
    menu.querySelectorAll('a').forEach(function (a) {
      a.addEventListener('click', function () {
        menu.classList.remove('is-open');
        burger.setAttribute('aria-expanded', 'false');
      });
    });
  }

  /* révélations douces */
  var items = document.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window && items.length) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) {
          e.target.classList.add('is-in');
          io.unobserve(e.target);
        }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -40px' });
    items.forEach(function (el, i) {
      el.style.transitionDelay = (i % 3) * 70 + 'ms';
      io.observe(el);
    });
  } else {
    items.forEach(function (el) { el.classList.add('is-in'); });
  }

  /* bascule mensuel / annuel */
  var sw = document.getElementById('billingSwitch');
  if (sw) {
    var amounts = document.querySelectorAll('.plan__amount');
    var notes = document.querySelectorAll('.plan__note');
    var buttons = sw.querySelectorAll('button');

    function setBilling(mode) {
      buttons.forEach(function (b) {
        b.classList.toggle('is-active', b.dataset.billing === mode);
      });
      amounts.forEach(function (a) {
        var v = Number(mode === 'yearly' ? a.dataset.yearly : a.dataset.monthly);
        // En annuel, le montant affiché est l'équivalent mensuel arrondi : le total réel
        // est rappelé dans la note sous le prix.
        a.textContent = (mode === 'yearly' ? '≈ ' : '') + v.toLocaleString('fr-FR');
      });
      notes.forEach(function (n) {
        if (mode === 'yearly') {
          var total = { '20000': 200000, '55000': 550000, '130000': 1300000 };
          var monthly = n.closest('.plan') && n.closest('.plan').querySelector('.plan__amount');
          var key = monthly && monthly.dataset ? monthly.dataset.monthly : '';
          n.textContent = total[key]
            ? 'Facturé ' + total[key].toLocaleString('fr-FR') + ' FCFA par an · 2 mois offerts'
            : 'Facturé annuellement · 2 mois offerts';
        } else {
          n.textContent = '';
        }
      });
    }

    buttons.forEach(function (b) {
      b.addEventListener('click', function () { setBilling(b.dataset.billing); });
    });

    /* si l'URL contient ?annuel, on pré-sélectionne */
    if (/[?&]annuel/.test(location.search)) setBilling('yearly');
  }

  /* année du footer */
  var y = document.getElementById('year');
  if (y) y.textContent = String(new Date().getFullYear());
})();
