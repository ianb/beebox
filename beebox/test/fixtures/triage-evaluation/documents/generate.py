"""Deterministic, fictional format fixtures. Never reads real box content."""
from pathlib import Path
import json
from PIL import Image, ImageDraw, ImageFont
from reportlab.pdfgen import canvas
from reportlab.lib.utils import ImageReader

ROOT = Path(__file__).resolve().parent
for directory in ('raw', 'expected-text', 'rendered', 'extracted'):
    (ROOT / directory).mkdir(exist_ok=True)
FONT = '/System/Library/Fonts/Supplemental/Arial.ttf'
BOLD = '/System/Library/Fonts/Supplemental/Arial Bold.ttf'
texts = {
 'digital-property': ['SYNTHETIC - NOT A REAL DOCUMENT', 'PROPERTY MAINTENANCE INVOICE', 'household of Odette Marlowe', 'Rivermouth property records', 'Invoice: SYN-1042', 'Date: 2026-08-12', 'Work: repair a leaking kitchen tap', 'Amount: 185.00 fictional currency units', 'Filed by Priya Marlowe for household property maintenance.'],
 'scan-financial': ['SYNTHETIC - NOT A REAL DOCUMENT', 'BANK ACCOUNT CLOSURE LETTER', 'household of Odette Marlowe', 'Account reference: SYN-8821', 'Date: 2026-08-15', 'The fictional household account has been closed.', 'Closing balance: 2400.00 fictional currency units.', 'This letter belongs with household banking records.'],
 'junk-layer-legal': ['SYNTHETIC - NOT A REAL DOCUMENT', 'COURT NOTICE', 'household of Odette Marlowe', 'File reference: SYN-COURT-61', 'Date: 2026-08-18', 'A fictional household records hearing is listed for', '2026-10-14 at the Rivermouth court office.', 'Keep this notice with household court correspondence.', 'This fixture contains no legal advice.'],
 'photo-property': ['SYNTHETIC - NOT A REAL DOCUMENT', 'PROPERTY INSPECTION NOTE', 'household of Odette Marlowe', 'Rivermouth property', 'Date: 2026-08-20', 'Roof gutter cleared; no remaining blockage.', 'Inspection recorded by Tomas Marlowe.', 'Keep with property maintenance records.'],
}

def page_image(lines):
    img = Image.new('RGB', (1530, 1980), '#fffdf7')
    draw = ImageDraw.Draw(img)
    draw.rectangle((70, 70, 1460, 1900), outline='#b4b4b4', width=2)
    for i, line in enumerate(lines):
        font = ImageFont.truetype(BOLD if i < 2 else FONT, 34 if i < 2 else 32)
        draw.text((110, 135 + i * 98), line, fill='#141414', font=font)
    return img

for slug, lines in texts.items():
    (ROOT / 'expected-text' / (slug + '.txt')).write_text('\n'.join(lines) + '\n')
    if slug == 'photo-property':
        photo = page_image(lines).rotate(90, expand=True).rotate(3, expand=True, fillcolor='#706b60', resample=Image.Resampling.BICUBIC)
        photo.save(ROOT / 'raw' / (slug + '.png'))
        continue
    pdf = canvas.Canvas(str(ROOT / 'raw' / (slug + '.pdf')), pagesize=(612, 792), invariant=1, pageCompression=1)
    pdf.setTitle('SYNTHETIC household corpus: ' + slug)
    pdf.setAuthor('Fictional evaluation fixture')
    if slug == 'digital-property':
        for i, line in enumerate(lines):
            pdf.setFont('Helvetica-Bold' if i < 2 else 'Helvetica', 13 if i < 2 else 12)
            pdf.drawString(44, 730 - i * 39, line)
    else:
        pdf.drawImage(ImageReader(page_image(lines)), 0, 0, width=612, height=792)
        if slug == 'junk-layer-legal':
            # Valid extractable but semantically useless invisible text layer.
            t = pdf.beginText(44, 690)
            t.setFont('Helvetica', 3)
            t.setTextRenderMode(3)
            t.setLeading(5)
            for char in 'qxzjkvwqzx' * 12:
                t.textLine(char)
            pdf.drawText(t)
    pdf.showPage()
    pdf.save()
(ROOT / 'raw' / 'corrupt-unreadable.pdf').write_bytes(b'%PDF-1.7\n% SYNTHETIC intentionally truncated fixture\n1 0 obj << /Type /Catalog\n')
manifest = [
 {'id': 'digital-property', 'raw': 'raw/digital-property.pdf', 'expected_category': 'property', 'preparation_expectation': 'usable native PDF text; no OCR needed'},
 {'id': 'scan-financial', 'raw': 'raw/scan-financial.pdf', 'expected_category': 'financial', 'preparation_expectation': 'native text empty; rasterize and OCR'},
 {'id': 'junk-layer-legal', 'raw': 'raw/junk-layer-legal.pdf', 'expected_category': 'legal', 'preparation_expectation': 'reject nonempty single-character junk layer; rasterize and OCR'},
 {'id': 'photo-property', 'raw': 'raw/photo-property.png', 'expected_category': 'property', 'preparation_expectation': 'orientation correction and OCR; retain uncertainty if automatic orientation fails'},
 {'id': 'corrupt-unreadable', 'raw': 'raw/corrupt-unreadable.pdf', 'expected_category': None, 'preparation_expectation': 'parse failure; manual preparation review, not semantic no-match'},
]
for row in manifest:
    row['synthetic'] = True
    row['expected_domain'] = 'Odette Marlowe household' if row['expected_category'] else None
    row['expected_text'] = 'expected-text/' + row['id'] + '.txt' if row['expected_category'] else None
(ROOT / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
