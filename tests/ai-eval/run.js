#!/usr/bin/env node
'use strict';
/* Mesure la vérification IA sur le jeu de documents fictifs (voir make_corpus.py).
   Appelle exactement la fonction de production `ai.validate`.

   Usage : GROQ_API_KEY=... node tests/ai-eval/run.js <dossier_corpus> [dossier_sortie]
   Ne fait jamais échouer la CI : c'est une mesure, pas un test unitaire. */
const fs = require('fs');
const path = require('path');
const ai = require('../../server/lib/ai');

const dir = process.argv[2];
const out = process.argv[3] || dir;
if (!dir) { console.error('Usage : node run.js <dossier_corpus> [sortie]'); process.exit(1); }
if (!ai.configured()) { console.error('GROQ_API_KEY absente : mesure impossible.'); process.exit(2); }

const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
const MIME = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.pdf': 'application/pdf' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DELAY = Number(process.env.EVAL_DELAY_MS || 2500);

function classify(expect, status) {
  if (status === 'review') return 'a_controler';
  if (expect === 'ok') return status === 'ok' ? 'juste' : 'faux_refus';
  return status === 'ko' ? 'juste' : 'fausse_acceptation';
}

(async () => {
  const rows = [];
  const only = (process.env.EVAL_IDS || '').split(',').map((s) => s.trim()).filter(Boolean);
  const repeat = Math.max(1, Number(process.env.EVAL_REPEAT || 1));
  const plan = [];
  for (const c of manifest.cases) if (!only.length || only.includes(c.id)) for (let k = 0; k < repeat; k += 1) plan.push(c);
  for (const c of plan) {
    const file = path.join(dir, c.file);
    const buffer = fs.readFileSync(file);
    const t0 = Date.now();
    const r = await ai.validate(
      { buffer, mimetype: MIME[path.extname(c.file).toLowerCase()], originalname: c.file },
      { label: c.label, rule: c.rule }, c.template);
    const row = {
      id: c.id, file: c.file, piece: c.label, rule: c.rule, expect: c.expect, note: c.note,
      status: r.status, verdict: classify(c.expect, r.status), reason: r.reason,
      typeDetecte: r.typeDetecte || '', date: r.dateDocument || '', confidence: r.confidence, ms: Date.now() - t0
    };
    rows.push(row);
    console.log(`${row.verdict.padEnd(18)} ${c.id.padEnd(22)} attendu=${c.expect} obtenu=${r.status}`);
    if (row.verdict !== 'juste') console.log(`    motif: ${String(r.reason).slice(0, 220)} | type=${row.typeDetecte} | date=${row.date} | conf=${r.confidence}`);
    await sleep(DELAY);
  }

  const n = rows.length;
  const count = (v) => rows.filter((x) => x.verdict === v).length;
  const bad = rows.filter((x) => x.expect === 'ko'), good = rows.filter((x) => x.expect === 'ok');
  const summary = {
    modele: ai.status().model, date: new Date().toISOString(), documents: n,
    justes: count('juste'), a_controler: count('a_controler'),
    faux_refus: count('faux_refus'), fausses_acceptations: count('fausse_acceptation'),
    sur_les_mauvais_documents: { total: bad.length, acceptes_a_tort: bad.filter((x) => x.status === 'ok').length },
    sur_les_bons_documents: { total: good.length, refuses_a_tort: good.filter((x) => x.status === 'ko').length, acceptes: good.filter((x) => x.status === 'ok').length }
  };

  const md = [];
  md.push(`# Mesure de la vérification IA — ${summary.date.slice(0, 10)}`, '', `Modèle : \`${summary.modele}\` · ${n} documents fictifs`, '',
    '| Indicateur | Résultat |', '|---|---|',
    `| Décisions justes | **${summary.justes}** / ${n} |`,
    `| Renvoyées au cabinet (« à contrôler ») | ${summary.a_controler} |`,
    `| **Fausses acceptations** (mauvais document accepté) | **${summary.fausses_acceptations}** |`,
    `| Faux refus (bon document refusé) | ${summary.faux_refus} |`, '',
    'La fausse acceptation est l\'erreur grave : un mauvais document validé. Le faux refus est gênant mais le client peut reprendre. « À contrôler » est sûr : le cabinet tranche.', '',
    '| Cas | Attendu | Obtenu | Résultat | Motif donné au client |', '|---|---|---|---|---|');
  for (const x of rows) {
    md.push(`| ${x.id} — ${x.note} | ${x.expect} | ${x.status} | ${x.verdict} | ${String(x.reason).replace(/\|/g, '/').slice(0, 140)} |`);
  }
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify({ summary, rows }, null, 1));
  fs.writeFileSync(path.join(out, 'report.md'), md.join('\n'));
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md.join('\n') + '\n');
  console.log('\n' + JSON.stringify(summary, null, 2));
})().catch((e) => { console.error(e); process.exit(1); });
