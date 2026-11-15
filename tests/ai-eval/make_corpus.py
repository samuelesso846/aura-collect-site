#!/usr/bin/env python3
"""Génère un jeu de documents FICTIFS (noms, montants, numéros inventés) pour mesurer
la vérification IA. Chaque document porte le résultat attendu dans manifest.json.
Aucune pièce d'identité n'est fabriquée : pour l'identité, on ne teste que des
documents qui ne doivent PAS être acceptés ; les vraies cartes se testent à la main.

Usage : python3 make_corpus.py <dossier_de_sortie>
"""
import json, os, random, sys
from datetime import date, timedelta
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageEnhance

OUT = sys.argv[1] if len(sys.argv) > 1 else 'corpus'
os.makedirs(OUT, exist_ok=True)
RNG = random.Random(20261115)
TODAY = date.today()
W, H = 1240, 1754  # A4 ~150 dpi


def font(size, bold=False):
    for p in ('/usr/share/fonts/truetype/dejavu/DejaVuSans%s.ttf' % ('-Bold' if bold else ''),
              '/usr/share/fonts/dejavu/DejaVuSans%s.ttf' % ('-Bold' if bold else '')):
        if os.path.exists(p):
            return ImageFont.truetype(p, size)
    return ImageFont.load_default(size)


def fdate(d):
    return d.strftime('%d/%m/%Y')


def ago(days):
    return TODAY - timedelta(days=days)


def money(n):
    return f'{n:,.0f}'.replace(',', ' ') + ' F CFA'


VENDORS = ['Ets Agbeko & Frères', 'Société Togo Négoce SARL', 'Quincaillerie Les Trois Palmiers', 'Papeterie Centrale Lomé']
CLIENT = 'SARL Kodjo Services'

# ----------------------------------------------------------------- documents
def doc_invoice(vendor, number, d, lang='fr', kind='Facture'):
    rows = [(RNG.choice(['Ramettes papier A4', 'Cartouches encre', 'Câbles réseau', 'Chaises bureau', 'Ciment 50 kg', 'Peinture 20 L']),
             RNG.randint(1, 20), RNG.choice([2500, 4800, 7500, 12000, 18500, 35000])) for _ in range(4)]
    total = sum(q * p for _, q, p in rows)
    tva = round(total * 0.18)
    if lang == 'en':
        title, cols = 'INVOICE', ['Item', 'Qty', 'Unit price', 'Amount']
    else:
        title, cols = kind.upper(), ['Désignation', 'Qté', 'Prix unitaire', 'Montant']
    return dict(title=f'{title} N° {number}', issuer=vendor, sub='Lomé, Togo · Tél. 90 00 00 00',
                meta=[('Date', fdate(d)), ('Client', CLIENT), ('Adresse', 'Boulevard du Mono, Lomé')],
                table=dict(cols=cols, rows=[(n, str(q), money(p), money(q * p)) for n, q, p in rows]),
                totals=[('Total HT', money(total)), ('TVA 18 %', money(tva)), ('Total TTC', money(total + tva))],
                footer='Merci de votre confiance.')


def doc_statement(d_end, holder=CLIENT, bank='Banque Exemple du Togo'):
    bal = RNG.randint(1_500_000, 6_000_000)
    rows = []
    day = d_end - timedelta(days=28)
    for i in range(14):
        day += timedelta(days=RNG.randint(1, 3))
        amt = RNG.choice([-45000, -120000, 250000, -18500, 380000, -76000, -9500])
        bal += amt
        rows.append((fdate(min(day, d_end)), RNG.choice(['Virement client', 'Paiement fourn.', 'Frais de compte', 'Retrait', 'Versement']),
                     money(abs(amt)) if amt < 0 else '', money(amt) if amt > 0 else '', money(bal)))
    return dict(title='RELEVÉ DE COMPTE', issuer=bank, sub='Agence de Lomé',
                meta=[('Titulaire', holder), ('Compte n°', 'TG00 0000 1234 5678 9012'), ('Période', f'{fdate(d_end - timedelta(days=30))} au {fdate(d_end)}')],
                table=dict(cols=['Date', 'Libellé', 'Débit', 'Crédit', 'Solde'], rows=rows),
                totals=[('Solde final', money(bal))], footer='Page 1 / 1')


def doc_utility(d, holder='M. Kodjo Mensah'):
    return dict(title='FACTURE D\'ÉLECTRICITÉ', issuer='Compagnie d\'Électricité Exemple', sub='Service clientèle · Lomé',
                meta=[('Abonné', holder), ('Adresse du site', 'Rue des Cocotiers, Quartier Bè, Lomé'), ('Date d\'émission', fdate(d)),
                      ('Période', 'Consommation bimestrielle')],
                table=dict(cols=['Désignation', 'Quantité', 'Montant'], rows=[('Consommation', '412 kWh', money(41200)), ('Taxes', '', money(4120))]),
                totals=[('Net à payer', money(45320))], footer='À régler avant la date limite.')


def doc_rib(holder):
    return dict(title='RELEVÉ D\'IDENTITÉ BANCAIRE', issuer='Banque Exemple du Togo', sub='Agence de Lomé',
                meta=[('Titulaire du compte', holder), ('Code banque', 'TG999'), ('Code guichet', '01001'), ('N° de compte', '00123456789'), ('Clé RIB', '47'),
                      ('IBAN', 'TG53 TG999 01001 00123456789 47')], table=None, totals=[], footer='Document à remettre à vos partenaires.')


def doc_letter(title, issuer, paragraphs, d, signed=False, extra_meta=None):
    return dict(title=title, issuer=issuer, sub='Lomé, Togo', meta=[('Date', fdate(d))] + (extra_meta or []), table=None, totals=[],
                paragraphs=paragraphs, signature=signed, footer='')


def doc_tva(year, quarters):
    rows = [(f'T{q} {year}', money(RNG.randint(400_000, 2_500_000)), money(RNG.randint(100_000, 900_000)), money(RNG.randint(0, 500_000))) for q in quarters]
    return dict(title='DÉCLARATION DE TVA', issuer='Administration fiscale (modèle fictif)', sub='Déclaration trimestrielle',
                meta=[('Contribuable', CLIENT), ('Exercice', str(year))],
                table=dict(cols=['Trimestre', 'Chiffre d\'affaires', 'TVA collectée', 'TVA à payer'], rows=rows), totals=[], footer='')


def doc_amort():
    rows = [(str(i), fdate(ago(-30 * i)), money(250000), money(180000 - i * 1000), money(60000 + i * 1000)) for i in range(1, 9)]
    return dict(title='TABLEAU D\'AMORTISSEMENT', issuer='Banque Exemple du Togo', sub='Prêt professionnel n° 2025-0042',
                meta=[('Emprunteur', CLIENT), ('Capital', money(15_000_000)), ('Durée', '60 mois')],
                table=dict(cols=['Éch.', 'Date', 'Mensualité', 'Capital', 'Intérêts'], rows=rows), totals=[], footer='')


def doc_cotisations(year):
    rows = [(m, money(RNG.randint(150_000, 260_000)), money(RNG.randint(30_000, 60_000))) for m in ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin']]
    return dict(title='ÉTAT DES COTISATIONS SOCIALES', issuer='Organisme de protection sociale (modèle fictif)', sub=f'Exercice {year}',
                meta=[('Employeur', CLIENT)], table=dict(cols=['Mois', 'Masse salariale', 'Cotisations'], rows=rows), totals=[], footer='')


LOREM = ['Article {n} - Objet. La société a pour objet le commerce général, la prestation de services et toutes opérations connexes.',
         'Article {n} - Capital. Le capital social est fixé à 1 000 000 de francs CFA, divisé en parts égales entièrement libérées.',
         'Article {n} - Gérance. La société est administrée par un gérant nommé pour une durée de cinq ans renouvelable.',
         'Article {n} - Exercice. L\'exercice social commence le 1er janvier et se termine le 31 décembre de chaque année.']


def doc_statutes(pages=2, signed=True):
    paras = []
    for i in range(1, 4 * pages + 1):
        paras.append(LOREM[(i - 1) % 4].format(n=i))
    return dict(title='STATUTS DE LA SOCIÉTÉ KODJO SERVICES SARL', issuer='', sub='Société à responsabilité limitée · Lomé',
                meta=[], table=None, totals=[], paragraphs=paras, signature=signed, footer='', pages=pages)


# ----------------------------------------------------------------- rendu PIL
def wrap(draw, text, fnt, width):
    words, line, out = text.split(), '', []
    for w in words:
        t = (line + ' ' + w).strip()
        if draw.textlength(t, font=fnt) <= width:
            line = t
        else:
            out.append(line)
            line = w
    out.append(line)
    return out


def scribble(draw, x, y):
    pts, cx, cy = [], x, y
    for i in range(24):
        cx += RNG.randint(6, 16)
        cy = y + int(30 * np.sin(i / 2.2)) + RNG.randint(-6, 6)
        pts.append((cx, cy))
    draw.line(pts, fill=(20, 30, 120), width=4)


def render_pil(doc, page=0):
    img = Image.new('RGB', (W, H), (252, 252, 250))
    d = ImageDraw.Draw(img)
    y = 90
    if doc.get('issuer'):
        d.text((80, y), doc['issuer'], font=font(40, True), fill=(20, 40, 80)); y += 56
    if doc.get('sub'):
        d.text((80, y), doc['sub'], font=font(24), fill=(90, 90, 90)); y += 60
    d.line([(80, y), (W - 80, y)], fill=(160, 160, 160), width=2); y += 36
    d.text((80, y), doc['title'], font=font(38, True), fill=(0, 0, 0)); y += 70
    for k, v in doc.get('meta', []):
        d.text((80, y), f'{k} :', font=font(26, True), fill=(40, 40, 40))
        d.text((420, y), v, font=font(26), fill=(0, 0, 0)); y += 42
    y += 24
    t = doc.get('table')
    if t:
        n = len(t['cols'])
        xs = [80 + int((W - 160) * i / n) for i in range(n)]
        for i, c in enumerate(t['cols']):
            d.text((xs[i] + 6, y), c, font=font(22, True), fill=(255, 255, 255))
        d.rectangle([(80, y - 6), (W - 80, y + 34)], fill=(40, 70, 120))
        for i, c in enumerate(t['cols']):
            d.text((xs[i] + 8, y), c, font=font(22, True), fill=(255, 255, 255))
        y += 46
        for r in t['rows']:
            for i, c in enumerate(r):
                d.text((xs[i] + 8, y), str(c)[:26], font=font(21), fill=(0, 0, 0))
            d.line([(80, y + 34), (W - 80, y + 34)], fill=(210, 210, 210), width=1)
            y += 42
    y += 24
    for k, v in doc.get('totals', []):
        d.text((W - 620, y), k, font=font(26, True), fill=(0, 0, 0))
        d.text((W - 330, y), v, font=font(26, True), fill=(0, 0, 0)); y += 44
    paras = doc.get('paragraphs', [])
    per = max(1, len(paras) // max(1, doc.get('pages', 1)))
    for p in paras[page * per:(page + 1) * per] if doc.get('pages', 1) > 1 else paras:
        for ln in wrap(d, p, font(26), W - 160):
            d.text((80, y), ln, font=font(26), fill=(0, 0, 0)); y += 38
        y += 22
    if doc.get('signature') and (page == doc.get('pages', 1) - 1):
        d.text((80, y + 40), 'Le gérant (lu et approuvé) :', font=font(24), fill=(60, 60, 60))
        scribble(d, 520, y + 70)
    if doc.get('footer'):
        d.text((80, H - 120), doc['footer'], font=font(22), fill=(110, 110, 110))
    return img


# ----------------------------------------------------------------- prise de vue
def coeffs(src, dst):
    a = []
    for (x, y), (u, v) in zip(dst, src):
        a += [[x, y, 1, 0, 0, 0, -u * x, -u * y], [0, 0, 0, x, y, 1, -v * x, -v * y]]
    b = np.array(src).reshape(8)
    return np.linalg.solve(np.array(a, dtype=float), b)


def photo(doc_img, mode='phone'):
    CW, CH = 1700, 2200
    bg = np.zeros((CH, CW, 3), dtype=np.uint8)
    bg[:] = (110, 82, 60)
    bg = bg + np.random.RandomState(7).randint(-14, 14, bg.shape).astype(np.int16).clip(0, 255).astype(np.uint8)
    canvas = Image.fromarray(bg.clip(0, 255).astype(np.uint8))
    img = doc_img.copy()
    if mode == 'crop':
        img = img.crop((0, 0, int(W * 0.58), H))
    if mode == 'lowres':
        img = img.resize((380, int(380 * img.height / img.width))).resize(img.size)
    if mode == 'blur':
        img = img.filter(ImageFilter.GaussianBlur(11))
    dw = int(CW * 0.78)
    dh = int(dw * img.height / img.width)
    img = img.resize((dw, dh))
    j = lambda m: RNG.randint(-m, m)
    ox, oy = (CW - dw) // 2, (CH - dh) // 2
    dst = [(ox + j(40), oy + j(40)), (ox + dw + j(40), oy + j(40)), (ox + dw + j(40), oy + dh + j(40)), (ox + j(40), oy + dh + j(40))]
    src = [(0, 0), (dw, 0), (dw, dh), (0, dh)]
    layer = img.transform((CW, CH), Image.PERSPECTIVE, coeffs(src, dst), Image.BICUBIC, fillcolor=(0, 0, 0))
    mask = Image.new('L', (dw, dh), 255).transform((CW, CH), Image.PERSPECTIVE, coeffs(src, dst), Image.BICUBIC, fillcolor=0)
    canvas.paste(layer, (0, 0), mask)
    if mode == 'tilt':
        canvas = canvas.rotate(14, expand=False, fillcolor=(110, 82, 60))
    arr = np.asarray(canvas).astype(np.float32)
    g = np.linspace(1.0, 0.72, CW)[None, :, None]  # ombre latérale
    arr = arr * g + np.random.RandomState(3).normal(0, 6, arr.shape)
    out = Image.fromarray(arr.clip(0, 255).astype(np.uint8))
    if mode == 'dark':
        out = ImageEnhance.Brightness(out).enhance(0.55)
    if mode == 'verydark':
        out = ImageEnhance.Brightness(out).enhance(0.12)
    return out.resize((1275, 1650))


def chat_screenshot():
    img = Image.new('RGB', (1080, 1920), (236, 229, 221))
    d = ImageDraw.Draw(img)
    d.rectangle([(0, 0), (1080, 160)], fill=(7, 94, 84))
    d.text((60, 60), 'Cabinet Exemple', font=font(44, True), fill=(255, 255, 255))
    y = 240
    for i, t in enumerate(['Bonjour, vous avez reçu mon dossier ?', 'Oui, il manque encore les relevés.', 'D\'accord, je vous les envoie demain.', 'Merci !']):
        x = 60 if i % 2 == 0 else 360
        d.rounded_rectangle([(x, y), (x + 640, y + 120)], 24, fill=(255, 255, 255) if i % 2 == 0 else (220, 248, 198))
        d.text((x + 24, y + 36), t, font=font(30), fill=(0, 0, 0)); y += 160
    return img


def essay():
    img = Image.new('RGB', (W, H), (255, 255, 255))
    d = ImageDraw.Draw(img)
    d.text((100, 100), 'Devoir de philosophie — Licence 2', font=font(34, True), fill=(0, 0, 0))
    y = 190
    for p in ['La liberté est-elle compatible avec le déterminisme ? Cette question traverse toute la tradition philosophique depuis les stoïciens jusqu\'aux modernes.',
              'Nous verrons d\'abord que la liberté se comprend comme absence de contrainte, puis qu\'elle suppose une raison capable de se donner des règles.']:
        for ln in wrap(d, p, font(28), W - 200):
            d.text((100, y), ln, font=font(28), fill=(0, 0, 0)); y += 42
        y += 30
    return img


def landscape():
    arr = np.zeros((1400, 1050, 3), dtype=np.uint8)
    sky = np.linspace((120, 180, 235), (210, 230, 250), 700)
    arr[:700] = sky[:, None, :].astype(np.uint8)
    arr[700:] = (60, 130, 60)
    img = Image.fromarray(arr)
    ImageDraw.Draw(img).ellipse([(780, 90), (920, 230)], fill=(255, 235, 120))
    return img.filter(ImageFilter.GaussianBlur(2))


def blank_paper():
    return Image.new('RGB', (W, H), (250, 250, 248))


def plan_localisation():
    img = Image.new('RGB', (W, 1300), (245, 245, 240))
    d = ImageDraw.Draw(img)
    d.text((80, 50), 'PLAN DE LOCALISATION DU SIÈGE — SARL Kodjo Services', font=font(34, True), fill=(0, 0, 0))
    for x in range(100, 1140, 160):
        d.line([(x, 160), (x, 1200)], fill=(200, 200, 200), width=10)
    for y in range(240, 1200, 200):
        d.line([(100, y), (1140, y)], fill=(200, 200, 200), width=10)
    d.rectangle([(420, 440), (580, 600)], fill=(200, 60, 60))
    d.text((400, 620), 'SIÈGE · Rue des Cocotiers', font=font(28, True), fill=(160, 20, 20))
    d.text((120, 280), 'Boulevard du Mono', font=font(24), fill=(60, 60, 60))
    d.text((700, 760), 'Marché de Bè (500 m)', font=font(24), fill=(60, 60, 60))
    return img


# ----------------------------------------------------------------- sortie
manifest = []


def save_img(name, img, fmt='JPEG', q=82):
    path = os.path.join(OUT, name)
    img.convert('RGB').save(path, fmt, quality=q) if fmt == 'JPEG' else img.save(path, fmt)
    return name


def save_pdf_text(name, doc):
    from reportlab.lib.pagesizes import A4
    from reportlab.pdfgen import canvas as cv
    c = cv.Canvas(os.path.join(OUT, name), pagesize=A4)
    pages = doc.get('pages', 1)
    paras = doc.get('paragraphs', [])
    per = max(1, len(paras) // pages) if paras else 0
    for pg in range(pages):
        y = 800
        for txt, size, bold in [(doc.get('issuer', ''), 16, True), (doc.get('sub', ''), 10, False), (doc['title'], 14, True)]:
            if txt:
                c.setFont('Helvetica-Bold' if bold else 'Helvetica', size); c.drawString(40, y, txt); y -= size + 10
        for k, v in doc.get('meta', []):
            c.setFont('Helvetica-Bold', 10); c.drawString(40, y, f'{k} :'); c.setFont('Helvetica', 10); c.drawString(170, y, v); y -= 16
        y -= 10
        t = doc.get('table')
        if t:
            c.setFont('Helvetica-Bold', 9); c.drawString(40, y, '   |   '.join(t['cols'])); y -= 14
            c.setFont('Helvetica', 9)
            for r in t['rows']:
                c.drawString(40, y, '   |   '.join(str(x) for x in r)); y -= 14
        for k, v in doc.get('totals', []):
            c.setFont('Helvetica-Bold', 10); c.drawString(300, y - 10, f'{k} : {v}'); y -= 16
        for p in (paras[pg * per:(pg + 1) * per] if paras else []):
            c.setFont('Helvetica', 10); c.drawString(40, y, p[:105]); y -= 18
            if len(p) > 105:
                c.drawString(40, y, p[105:210]); y -= 18
        if doc.get('signature') and pg == pages - 1:
            c.setFont('Helvetica-Oblique', 10); c.drawString(40, y - 30, 'Le gérant (lu et approuvé) : K. Mensah')
        c.showPage()
    c.save()
    return name


def save_pdf_scan(name, imgs):
    imgs = [i.convert('RGB') for i in imgs]
    imgs[0].save(os.path.join(OUT, name), 'PDF', save_all=True, append_images=imgs[1:], resolution=150)
    return name


def add(case_id, file, key, label, rule, template, expect, note):
    manifest.append(dict(id=case_id, file=file, key=key, label=label, rule=rule, template=template, expect=expect, note=note))


BILAN, TVA, CREA = 'Bilan annuel', 'Déclarations de TVA', 'Création de société'
FA = ('factures-achat', "Factures d'achat de l'exercice", 'toutes les pages')
FV = ('factures-vente', "Factures de vente de l'exercice", 'toutes les pages')
RB = ('releves-bancaires', '3 derniers relevés bancaires', 'moins de 3 mois')
ID = ('piece-identite', "Pièce d'identité du gérant", 'en cours de validité')


def A(cid, file, k, template, expect, note):
    add(cid, file, k[0], k[1], k[2], template, expect, note)


inv = doc_invoice(VENDORS[0], '2026-0412', ago(40))
A('fa-pdf', save_pdf_text('fa-pdf.pdf', inv), FA, BILAN, 'ok', 'facture d\'achat, PDF texte')
A('fa-photo', save_img('fa-photo.jpg', photo(render_pil(doc_invoice(VENDORS[1], '0087', ago(25))))), FA, BILAN, 'ok', 'facture photographiée au téléphone')
A('fa-sombre', save_img('fa-sombre.jpg', photo(render_pil(doc_invoice(VENDORS[2], '311', ago(12))), 'dark')), FA, BILAN, 'ok', 'photo un peu sombre mais lisible')
A('fa-tresflou', save_img('fa-tresflou.jpg', photo(render_pil(doc_invoice(VENDORS[3], '99', ago(30))), 'blur')), FA, BILAN, 'ko', 'très floue : illisible')
A('fa-noire', save_img('fa-noire.jpg', photo(render_pil(doc_invoice(VENDORS[0], '55', ago(30))), 'verydark')), FA, BILAN, 'ko', 'quasi noire : illisible')
A('fa-basserez', save_img('fa-basserez.jpg', photo(render_pil(doc_invoice(VENDORS[1], '12', ago(30))), 'lowres')), FA, BILAN, 'ko', 'basse résolution : illisible')
A('fa-coupee', save_img('fa-coupee.jpg', photo(render_pil(doc_invoice(VENDORS[2], '77', ago(30))), 'crop')), FA, BILAN, 'ko', 'moitié de la page coupée')
A('fa-penchee', save_img('fa-penchee.jpg', photo(render_pil(doc_invoice(VENDORS[3], '1204', ago(30))), 'tilt')), FA, BILAN, 'ok', 'photo penchée de 14°')
A('fa-tournee', save_img('fa-tournee.jpg', render_pil(doc_invoice(VENDORS[0], '88', ago(30))).rotate(90, expand=True)), FA, BILAN, 'ok', 'page tournée de 90°')
A('fa-anglais', save_pdf_text('fa-anglais.pdf', doc_invoice(VENDORS[1], '5521', ago(20), lang='en')), FA, BILAN, 'ok', 'facture en anglais')
A('fv-photo', save_img('fv-photo.jpg', photo(render_pil(doc_invoice('SARL Kodjo Services', 'V-0231', ago(18), kind='Facture')))), FV, BILAN, 'ok', 'facture de vente')
A('fv-releve', save_img('fv-releve.jpg', photo(render_pil(doc_statement(ago(20))))), FV, BILAN, 'ko', 'relevé bancaire à la place d\'une facture')
A('rb-pdf', save_pdf_text('rb-pdf.pdf', doc_statement(ago(21))), RB, BILAN, 'ok', 'relevé récent, PDF texte')
A('rb-photo', save_img('rb-photo.jpg', photo(render_pil(doc_statement(ago(15))))), RB, BILAN, 'ok', 'relevé récent photographié')
A('rb-ancien', save_img('rb-ancien.jpg', photo(render_pil(doc_statement(ago(430))))), RB, BILAN, 'ko', 'relevé vieux de 14 mois (règle : moins de 3 mois)')
A('rb-scan', save_pdf_scan('rb-scan.pdf', [render_pil(doc_statement(ago(21)))]), RB, BILAN, 'ok', 'PDF scanné (sans texte) : limite connue, « à contrôler » attendu')
A('rb-elec', save_img('rb-elec.jpg', photo(render_pil(doc_utility(ago(20))))), RB, BILAN, 'ko', 'facture d\'électricité à la place d\'un relevé')
LS = ('liasse-fiscale', 'Liasse fiscale N-1', 'signée')
lia = doc_letter('LIASSE FISCALE — EXERCICE 2025', 'Cabinet d\'expertise (modèle fictif)',
                 ['Bilan, compte de résultat et annexes de l\'exercice clos le 31/12/2025.', 'Total du bilan : 48 250 000 F CFA. Résultat net : 6 120 000 F CFA.'], ago(200), signed=True)
A('liasse-signee', save_img('liasse-signee.jpg', photo(render_pil(lia))), LS, BILAN, 'ok', 'liasse signée')
lia2 = dict(lia, signature=False)
A('liasse-nonsignee', save_img('liasse-nonsignee.jpg', photo(render_pil(lia2))), LS, BILAN, 'ko', 'liasse sans signature')
A('cotis', save_pdf_text('cotis.pdf', doc_cotisations(TODAY.year)), ('charges-sociales', 'Justificatifs de charges sociales', 'exercice concerné'), BILAN, 'ok', 'état de cotisations de l\'exercice en cours')
EM = ('contrats-emprunt', "Contrats d'emprunt en cours", "tableau d'amortissement joint")
A('emprunt-ok', save_pdf_text('emprunt-ok.pdf', doc_amort()), EM, BILAN, 'ok', 'tableau d\'amortissement présent')
A('emprunt-pasdetableau', save_pdf_text('emprunt-pasdetableau.pdf', doc_letter('ATTESTATION DE PRÊT', 'Banque Exemple du Togo', ['La banque atteste avoir consenti un prêt professionnel de 15 000 000 F CFA à la société Kodjo Services.'], ago(90))), EM, BILAN, 'ko', 'attestation sans tableau d\'amortissement')
TV = ('declarations-tva', 'Déclarations de TVA', 'les 4 trimestres')
A('tva-4t', save_pdf_text('tva-4t.pdf', doc_tva(TODAY.year - 1, [1, 2, 3, 4])), TV, TVA, 'ok', 'les 4 trimestres présents')
A('tva-1t', save_pdf_text('tva-1t.pdf', doc_tva(TODAY.year - 1, [1])), TV, TVA, 'ko', 'un seul trimestre sur 4')
JA = ('justif-activite', "Justificatif d'activité", 'moins de 12 mois')
act = lambda d: doc_letter('ATTESTATION D\'ACTIVITÉ', 'Registre du commerce (modèle fictif)', ['Il est attesté que la société SARL Kodjo Services exerce une activité de négoce à Lomé.'], d)
A('act-recent', save_img('act-recent.jpg', photo(render_pil(act(ago(150))))), JA, TVA, 'ok', 'attestation de 5 mois')
A('act-ancien', save_img('act-ancien.jpg', photo(render_pil(act(ago(620))))), JA, TVA, 'ko', 'attestation de 20 mois')
JD = ('justif-domicile', 'Justificatif de domicile', 'moins de 3 mois')
A('dom-ok', save_img('dom-ok.jpg', photo(render_pil(doc_utility(ago(22))))), JD, CREA, 'ok', 'facture d\'électricité récente')
A('dom-ancien', save_img('dom-ancien.jpg', photo(render_pil(doc_utility(ago(250))))), JD, CREA, 'ko', 'facture de 8 mois')
A('capital', save_img('capital.jpg', photo(render_pil(doc_letter('ATTESTATION DE DÉPÔT DU CAPITAL', 'Banque Exemple du Togo', ['Nous attestons avoir reçu en dépôt la somme de 1 000 000 F CFA, constituant le capital de la société en formation SARL Kodjo Services.'], ago(30), signed=True)))), ('depot-capital', 'Attestation de dépôt du capital', 'originale'), CREA, 'ok', 'attestation de dépôt du capital')
A('statuts', save_pdf_text('statuts.pdf', doc_statutes(2, True)), ('statuts', 'Statuts signés', 'toutes les pages'), CREA, 'ok', 'statuts de 2 pages signés')
RIBK = ('rib', 'RIB professionnel', 'au nom de la société')
A('rib-societe', save_img('rib-societe.jpg', photo(render_pil(doc_rib('SARL KODJO SERVICES')))), RIBK, CREA, 'ok', 'RIB au nom de la société')
A('rib-perso', save_img('rib-perso.jpg', photo(render_pil(doc_rib('M. KODJO MENSAH')))), RIBK, CREA, 'ko', 'RIB au nom d\'une personne')
A('plan', save_img('plan.jpg', plan_localisation()), ('plan-localisation', 'Plan de localisation du siège', 'lisible'), CREA, 'ok', 'plan lisible')
A('id-devoir', save_img('id-devoir.jpg', photo(essay())), ID, CREA, 'ko', 'devoir universitaire à la place d\'une pièce d\'identité')
A('id-chat', save_img('id-chat.png', chat_screenshot(), 'PNG'), ID, CREA, 'ko', 'capture d\'écran de conversation')
A('id-paysage', save_img('id-paysage.jpg', landscape()), ID, CREA, 'ko', 'photo de paysage')
A('id-blanc', save_img('id-blanc.jpg', photo(blank_paper())), ID, CREA, 'ko', 'feuille blanche')
A('id-facture', save_img('id-facture.jpg', photo(render_pil(doc_invoice(VENDORS[0], '9', ago(10))))), ID, CREA, 'ko', 'facture à la place d\'une pièce d\'identité')
A('generique', save_img('generique.jpg', photo(render_pil(doc_invoice(VENDORS[1], '10', ago(10))))), ('p1', 'Première pièce', 'selon vos règles'), 'Dossier sur-mesure', 'ok', 'pièce générique : tout document lisible est accepté')

with open(os.path.join(OUT, 'manifest.json'), 'w', encoding='utf-8') as f:
    json.dump(dict(generated=str(TODAY), cases=manifest), f, ensure_ascii=False, indent=1)
print(f'{len(manifest)} documents écrits dans {OUT}')
