'use strict';
/* Observabilité minimale : identifiant de requête, un journal JSON par requête,
   arrêt propre. Aucun contenu de pièce, aucun corps de requête, aucun jeton :
   les adresses /p/<jeton> et /api/portal/<jeton> sont masquées. */
const crypto = require('crypto');

function redact(url) {
  return String(url || '')
    .split('?')[0]
    .replace(/(\/p\/)[^/]+/, '$1:jeton')
    .replace(/(\/api\/portal\/)[^/]+/, '$1:jeton')
    .replace(/(\/invitation\/|\/invite\/)[^/]+/, '$1:jeton');
}

function requestLogger(opts) {
  const quiet = (opts && opts.quiet) || (() => false);
  return (req, res, next) => {
    const id = (req.headers['x-request-id'] && String(req.headers['x-request-id']).slice(0, 64)) || crypto.randomBytes(6).toString('hex');
    req.id = id;
    res.setHeader('X-Request-Id', id);
    const t0 = process.hrtime.bigint();
    res.on('finish', () => {
      if (quiet(req)) return;
      const ms = Number(process.hrtime.bigint() - t0) / 1e6;
      const line = { t: new Date().toISOString(), id, m: req.method, p: redact(req.originalUrl), s: res.statusCode, ms: Math.round(ms) };
      if (res.statusCode >= 500) console.error(JSON.stringify(line));
      else console.log(JSON.stringify(line));
    });
    next();
  };
}

/* Disjoncteur : après `threshold` échecs de suite, on cesse d'appeler le service
   pendant `coolMs`, au lieu de faire attendre chaque dépôt 45 s pour rien. */
function breaker(threshold, coolMs) {
  let fails = 0, openUntil = 0;
  return {
    allow() { return Date.now() >= openUntil; },
    ok() { fails = 0; openUntil = 0; },
    fail() { fails += 1; if (fails >= threshold) openUntil = Date.now() + coolMs; },
    state() { return { fails, open: Date.now() < openUntil, retryInMs: Math.max(0, openUntil - Date.now()) }; }
  };
}

module.exports = { redact, requestLogger, breaker };
