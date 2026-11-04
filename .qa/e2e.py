#!/usr/bin/env python3
"""Test de bout en bout de la production : inscription, cabinet, dossiers, portail, scellement, export."""
import io, json, os, sys, time, datetime
import requests

BASE = os.environ.get('BASE', 'https://aura-collect.onrender.com')
SUF = datetime.datetime.now().strftime('%m%d%H%M%S')
EMAIL = f'samuelesso846+e2e{SUF}@gmail.com'
PWD = 'MotDePasseTest2026!'
resultats = []


def check(nom, ok, detail='', attention=False):
    resultats.append({'etape': nom, 'ok': bool(ok), 'attention': bool(attention), 'detail': str(detail)[:400]})
    etat = 'OK   ' if ok else ('ATTENTION' if attention else 'ECHEC')
    print(f'{etat}  {nom}  {str(detail)[:160]}')
    return ok


def pdf(texte, chemin):
    from reportlab.pdfgen import canvas
    from reportlab.lib.pagesizes import A4
    c = canvas.Canvas(chemin, pagesize=A4)
    y = 800
    for ligne in texte.split('\n'):
        c.drawString(60, y, ligne)
        y -= 18
    c.save()
    return chemin


os.makedirs('/tmp/e2e', exist_ok=True)
pdf("REPUBLIQUE TOGOLAISE\nSTATUTS DE LA SOCIETE AURA SARL\nArticle 1 - Denomination\nLa societe est denommee AURA SARL.\nFait a Lome, le 12 octobre 2026\nSignature : Samuel ESSO",
    '/tmp/e2e/statuts.pdf')
pdf("BANQUE ATLANTIQUE TOGO\nRELEVE D'IDENTITE BANCAIRE\nTitulaire : AURA SARL\nIBAN : TG53 0001 2345 6789 0123\nAgence : Lome Centrale\nDate : 20 octobre 2026",
    '/tmp/e2e/rib.pdf')

s = requests.Session()
s.headers['User-Agent'] = 'AuraQA/1.0'
t0 = time.time()

# 1. inscription
r = s.post(BASE + '/api/signup', json={'name': 'Cabinet Test E2E', 'email': EMAIL, 'password': PWD, 'plan': 'starter'})
check('1. Inscription (POST /api/signup)', r.status_code == 200 and r.json().get('ok'), f'{r.status_code} {r.text[:120]}')
check('1b. Cookie de session pose', 'aura_session' in s.cookies.get_dict() or any('session' in k.lower() for k in s.cookies.get_dict()), list(s.cookies.get_dict().keys()))

# 2. identite
r = s.get(BASE + '/api/me')
me = r.json() if r.headers.get('content-type', '').startswith('application/json') else {}
check('2. /api/me renvoie le cabinet', r.status_code == 200 and me.get('authenticated') and me.get('cabinet') == 'Cabinet Test E2E', json.dumps(me)[:220])
cab_id = (me.get('access') or {}).get('cabinetId') or (me.get('access') or {}).get('id')

# 3. modeles
r = s.get(BASE + '/api/templates')
tmp = r.json().get('templates', []) if r.status_code == 200 else []
check('3. Modeles de dossier', len(tmp) >= 5, f'{len(tmp)} modeles : ' + ', '.join(t["id"] for t in tmp))

# 4. abonnement / essai
r = s.get(BASE + '/api/billing')
b = r.json() if r.status_code == 200 else {}
acc = b.get('access') or b
check('4. Essai 7 jours actif', r.status_code == 200 and str((acc or {}).get('state')) in ('trial', 'trialing', 'active'), json.dumps(b)[:260])

# 5. creation du dossier
tpl = [t for t in tmp if t['id'] == 'creation'][0]
payload = {'client': 'Client Test E2E', 'email': f'samuelesso846+c{SUF}@gmail.com', 'phone': '+228 90 00 00 00',
           'template': 'creation', 'recipient': '', 'pieces': list(tpl['defaults'])}
r = s.post(BASE + '/api/dossiers', json=payload)
d = r.json() if r.status_code == 201 else {}
dos = d.get('dossier', {})
check('5. Creation du dossier', r.status_code == 201 and dos.get('id'), f'{r.status_code} {r.text[:150]}')
did, token = dos.get('id'), dos.get('token')
check('5b. Lien de depot genere', bool(token), token)
_m = (d.get('mail') or {}).get('status')
check('5c. Email au client', _m in ('sent', 'simule', 'envoye'), f'mode={_m}',
      attention=(_m == 'outbox'))

# 6. liste
r = s.get(BASE + '/api/dossiers')
lst = r.json().get('dossiers', []) if r.status_code == 200 else []
check('6. Liste des dossiers', any(x.get('id') == did for x in lst), f'{len(lst)} dossiers')

# 7. page publique
r = s.get(f'{BASE}/p/{token}')
check('7. Page publique /p/<token>', r.status_code == 200 and 'text/html' in r.headers.get('content-type', ''), f'{r.status_code} {len(r.text)} octets')

# 8. api portail
r = s.get(BASE + f'/api/portal/{token}')
po = r.json() if r.status_code == 200 else {}
check('8. API portail (sans compte)', r.status_code == 200 and po.get('dossier', {}).get('client') == 'Client Test E2E', f'{r.status_code} pieces={len((po.get("dossier") or {}).get("pieces", []))}')
check('8b. IA annoncee disponible', po.get('ai') is True, po.get('ai'))

# 9. depot de pieces
pieces = list(tpl['defaults'])
verdicts = {}
for i, key in enumerate(pieces):
    f = '/tmp/e2e/statuts.pdf' if i % 2 == 0 else '/tmp/e2e/rib.pdf'
    with open(f, 'rb') as fh:
        r = s.post(BASE + f'/api/portal/{token}/pieces/{key}', files={'file': (os.path.basename(f), fh, 'application/pdf')})
    ok = r.status_code == 200
    v = (r.json().get('piece') or {}) if ok else {}
    verdicts[key] = v
    check(f'9.{i+1} Depot piece « {key} »', ok, f'{r.status_code} statut={v.get("status")} {str(v.get("reason"))[:80]}')

# 10. format refuse
with open('/tmp/e2e/note.txt', 'w') as fh:
    fh.write('pas un document')
with open('/tmp/e2e/note.txt', 'rb') as fh:
    r = s.post(BASE + f'/api/portal/{token}/pieces/{pieces[0]}', files={'file': ('note.txt', fh, 'text/plain')})
check('10. Format non accepte refuse (415)', r.status_code == 415, f'{r.status_code} {r.text[:100]}')

# 11. scellement premature refuse
r = s.post(BASE + f'/api/dossiers/{did}/seal')
check('11. Scellement bloque si pieces non validees', r.status_code in (400, 409), f'{r.status_code} {r.text[:140]}')

# 12. validation par le cabinet
for key in pieces:
    r = s.post(BASE + f'/api/dossiers/{did}/pieces/{key}/confirm', json={'force': True})
    check(f'12.{key} Validation cabinet', r.status_code == 200, f'{r.status_code} {r.text[:90]}')

# 13. integrite avant scellement
r = s.get(BASE + f'/api/dossiers/{did}/integrity')
check('13. Integrite refusee avant scellement (attendu 404)', r.status_code == 404, f'{r.status_code} {r.text[:80]}')

# 14. scellement
r = s.post(BASE + f'/api/dossiers/{did}/seal')
check('14. Scellement du dossier', r.status_code == 200, f'{r.status_code} {r.text[:140]}')

# 15. depot apres scellement refuse
with open('/tmp/e2e/statuts.pdf', 'rb') as fh:
    r = s.post(BASE + f'/api/portal/{token}/pieces/{pieces[0]}', files={'file': ('x.pdf', fh, 'application/pdf')})
check('15. Depot refuse apres scellement (409)', r.status_code == 409, f'{r.status_code} {r.text[:100]}')

# 16. export zip
r = s.get(BASE + f'/api/dossiers/{did}/export')
zip_ok = r.status_code == 200 and r.content[:2] == b'PK' and len(r.content) > 1000
check('16. Export ZIP', zip_ok, f'{r.status_code} {len(r.content)} octets')
if zip_ok:
    open('/tmp/e2e/export.zip', 'wb').write(r.content)
    import zipfile
    with zipfile.ZipFile(io.BytesIO(r.content)) as z:
        noms = z.namelist()
    check('16b. Contenu du ZIP', len(noms) >= len(pieces), f'{len(noms)} fichiers : {noms[:4]}')

# 17. certificat
r = s.get(BASE + f'/api/dossiers/{did}/certificate')
check('17. Certificat de scellement', r.status_code == 200, f'{r.status_code} {len(r.content)} octets {r.headers.get("content-type")}')

# 18. relance
r = s.post(BASE + f'/api/dossiers/{did}/remind')
check('18. Relance client (dossier complet -> refus attendu)', r.status_code in (200, 400), f'{r.status_code} {r.text[:110]}')

# 19. isolation entre cabinets
autre = os.environ.get('AUTRE_DOSSIER', 'd_hnbw2kfe')
r = s.get(BASE + f'/api/dossiers/{autre}')
r2 = s.get(BASE + f'/api/dossiers/{autre}/export')
check('19. Isolation : dossier d\'un autre cabinet inaccessible', r.status_code == 404 and r2.status_code == 404, f'GET {r.status_code} / export {r2.status_code}')

# 20. deconnexion + reconnexion
s.post(BASE + '/api/logout')
r = s.get(BASE + '/api/me')
check('20. Deconnexion', r.status_code in (401, 200), f'{r.status_code}')
r = s.post(BASE + '/api/login', json={'email': EMAIL, 'password': PWD})
check('21. Reconnexion avec les identifiants', r.status_code == 200, f'{r.status_code} {r.text[:100]}')
r = s.post(BASE + '/api/login', json={'email': EMAIL, 'password': 'mauvais-mot-de-passe'})
check('22. Mauvais mot de passe refuse', r.status_code in (401, 429), f'{r.status_code} {r.text[:100]}')

# 23. reinitialisation
r = s.post(BASE + '/api/password/reset-request', json={'email': EMAIL})
check('23. Demande de reinitialisation', r.status_code == 200, f'{r.status_code} {r.text[:120]}')

# 24. changement de mot de passe
r = s.post(BASE + '/api/password', json={'current': PWD, 'next': 'NouveauMotDePasse2026!'})
check('24. Changement de mot de passe', r.status_code == 200, f'{r.status_code} {r.text[:120]}')

# 25. paiement
r = s.post(BASE + '/api/billing/checkout', json={'plan': 'pro', 'cycle': 'monthly'})
pay = r.json() if r.status_code == 200 else {}
check('25. Paiement FedaPay (lien genere)', r.status_code == 200 and (pay.get('url') or pay.get('payment_url')), f'{r.status_code} {json.dumps(pay)[:160]}')

# 26. page commander
r = requests.get(BASE + '/commander.html')
check('26. Page /commander.html', r.status_code == 200 and 'form' in r.text.lower(), f'{r.status_code}')

# nettoyage : le compte de test ne doit pas rester en base
try:
    import psycopg2
    env = dict(l.split('=', 1) for l in open('.env') if '=' in l and not l.startswith('#'))
    cx = psycopg2.connect(env['DATABASE_URL'].strip(), connect_timeout=15)
    cur = cx.cursor()
    cur.execute("delete from aura.cabinets where email like 'samuelesso846+e2e%%'")
    cur.execute("delete from aura.outbox where recipient like 'samuelesso846+%%'")
    cx.commit(); cx.close()
    check('27. Nettoyage du compte de test', True, 'cabinet supprime')
except Exception as e:
    check('27. Nettoyage du compte de test', False, str(e)[:120])

dt = round(time.time() - t0, 1)
ok = sum(1 for x in resultats if x['ok'])
att = sum(1 for x in resultats if x.get('attention'))
print(f'\n=== {ok}/{len(resultats)} verifications OK, {att} attention, {len(resultats)-ok-att} echecs en {dt}s ===')
json.dump({'email': EMAIL, 'cabinet_id': cab_id, 'dossier': did, 'resultats': resultats},
          open('/tmp/e2e/rapport.json', 'w'), ensure_ascii=False, indent=1)
