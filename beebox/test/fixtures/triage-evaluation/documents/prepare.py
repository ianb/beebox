"""Verify real local preparation; expected-text is never an extraction input."""
import argparse
import json
from pathlib import Path
import re
import subprocess

ROOT = Path(__file__).resolve().parent
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--output', type=Path, required=True)
output = parser.parse_args().output.resolve()
if output == ROOT.parent or ROOT.parent in output.parents:
    parser.error('--output must be outside the committed triage-evaluation fixture tree')
output.mkdir(parents=True, exist_ok=True)
manifest = json.loads((ROOT / 'manifest.json').read_text())
ESSENTIAL = {
    'digital-property': ['property maintenance invoice', 'odette marlowe', 'leaking kitchen tap'],
    'scan-financial': ['bank account closure letter', 'odette marlowe', 'account has been closed'],
    'junk-layer-legal': ['court notice', 'odette marlowe', 'records hearing'],
    'photo-property': ['property inspection note', 'odette marlowe', 'roof gutter cleared'],
}


def require(condition, message):
    if not condition:
        raise ValueError(message)


def run(args, prefix):
    try:
        proc = subprocess.run(args, capture_output=True, text=True, timeout=60)
    except (OSError, subprocess.TimeoutExpired) as error:
        raise ValueError(f'{args[0]} could not complete: {error}') from error
    (output / f'{prefix}.stderr.txt').write_text(proc.stderr)
    (output / f'{prefix}.stdout.txt').write_text(proc.stdout)
    return proc


def contains_evidence(text, slug):
    normalized = ' '.join(text.lower().split())
    require(all(token in normalized for token in ESSENTIAL[slug]),
            f'{slug}: essential routing evidence missing from extracted text')


results = []
for item in manifest:
    slug = item['id']
    source = ROOT / item['raw']
    row = dict(item, status='verification_failed')
    try:
        if source.suffix == '.pdf':
            proc = run(['pdftotext', '-layout', str(source), '-'], f'{slug}.native')
            row['native_exit'] = proc.returncode
            row['native_text'] = f'{slug}.native.stdout.txt'
            if slug == 'corrupt-unreadable':
                require(proc.returncode != 0, 'corrupt fixture unexpectedly parsed')
                row['status'] = 'preparation_failed_as_expected'
                results.append(row)
                continue
            require(proc.returncode == 0, f'{slug}: native extraction failed')
            tokens = proc.stdout.split()
            row['native_characters'] = len(re.sub(r'\s', '', proc.stdout))
            row['native_tokens'] = len(tokens)
            if slug == 'digital-property':
                require(row['native_characters'] >= 64, 'digital text unexpectedly short')
                contains_evidence(proc.stdout, slug)
                row['status'] = 'native_text_verified'
                results.append(row)
                continue
            if slug == 'scan-financial':
                require(not tokens, 'image-only PDF unexpectedly has native text')
            else:
                require(slug == 'junk-layer-legal', 'unrecognized PDF fixture')
                require(len(tokens) >= 100 and all(re.fullmatch('[A-Za-z]', t) for t in tokens),
                        'junk layer must contain at least 100 isolated letter tokens')
            rendered = output / slug
            proc = run(['pdftoppm', '-scale-to', '1800', '-png', '-singlefile',
                        str(source), str(rendered)], f'{slug}.render')
            require(proc.returncode == 0, f'{slug}: rendering failed')
            source = rendered.with_suffix('.png')
        proc = run(['tesseract', str(source), 'stdout', '--psm',
                    '1' if slug == 'photo-property' else '6'], f'{slug}.ocr')
        row['ocr_exit'] = proc.returncode
        row['ocr_text'] = f'{slug}.ocr.stdout.txt'
        require(proc.returncode == 0, f'{slug}: OCR failed')
        contains_evidence(proc.stdout, slug)
        row['status'] = 'ocr_evidence_verified'
    except (ValueError, OSError) as error:
        row['error'] = str(error)
    results.append(row)
(output / 'results.json').write_text(json.dumps(results, indent=2) + '\n')
for row in results:
    print(f"{row['id']}: {row['status']}" + (f" ({row['error']})" if 'error' in row else ''))
raise SystemExit(1 if any(row['status'] == 'verification_failed' for row in results) else 0)
