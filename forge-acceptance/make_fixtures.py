#!/usr/bin/env python3
"""Forge acceptance fixtures. Standard library only (zlib, zipfile, struct, os, random)."""
import os, random, struct, zipfile, zlib

OUT = os.path.dirname(os.path.abspath(__file__))
random.seed(7731)

def p(name): return os.path.join(OUT, name)

# ---------- PNG ----------
def png_chunk(t, data):
    c = struct.pack('>I', len(data)) + t + data
    return c + struct.pack('>I', zlib.crc32(t + data) & 0xffffffff)

def write_png(path, w, h, rows, color_type, level=9):
    """rows: iterable of raw scanline bytes (no filter byte)."""
    ihdr = struct.pack('>IIBBBBB', w, h, 8, color_type, 0, 0, 0)
    comp = zlib.compressobj(level)
    idat = bytearray()
    for r in rows:
        idat += comp.compress(b'\x00' + r)
    idat += comp.flush()
    with open(path, 'wb') as f:
        f.write(b'\x89PNG\r\n\x1a\n' + png_chunk(b'IHDR', ihdr) + png_chunk(b'IDAT', bytes(idat)) + png_chunk(b'IEND', b''))

# 5x7 bitmap font, only the glyphs needed
FONT = {
 'F': ['11111','10000','10000','11110','10000','10000','10000'],
 'O': ['01110','10001','10001','10001','10001','10001','01110'],
 'R': ['11110','10001','10001','11110','10100','10010','10001'],
 'G': ['01110','10001','10000','10111','10001','10001','01111'],
 'E': ['11111','10000','10000','11110','10000','10000','11111'],
 'C': ['01110','10001','10000','10000','10000','10001','01110'],
 '-': ['00000','00000','00000','11111','00000','00000','00000'],
 '7': ['11111','00001','00010','00100','01000','01000','01000'],
 '3': ['11110','00001','00001','01110','00001','00001','11110'],
 '1': ['00100','01100','00100','00100','00100','00100','01110'],
}

def text_png(path, text, W, H):
    scale = 40                    # each font pixel = 40x40 block
    gw = 6 * scale                # glyph advance (5 cols + 1 gap)
    tw, th = len(text) * gw - scale, 7 * scale
    x0, y0 = (W - tw) // 2, (H - th) // 2
    black_cols = []               # per font-row: set of black x ranges
    for fr in range(7):
        line = bytearray(b'\xff' * W)
        for i, ch in enumerate(text):
            bits = FONT[ch][fr]
            for c, b in enumerate(bits):
                if b == '1':
                    xs = x0 + i * gw + c * scale
                    line[xs:xs + scale] = b'\x00' * scale
        black_cols.append(bytes(line))
    white = b'\xff' * W
    def rows():
        for y in range(H):
            if y0 <= y < y0 + th:
                yield black_cols[(y - y0) // scale]
            else:
                yield white
    write_png(path, W, H, rows(), 0)

text_png(p('big.png'), 'FORGE-OCR-7731', 4000, 3000)
write_png(p('tiny.png'), 64, 64, (bytes([124, 58, 237]) * 64 for _ in range(64)), 2)

for n in range(1, 11):            # RGB noise: ~12 MB each, incompressible
    write_png(p(f'img{n:02d}.png'), 2000, 2000, (os.urandom(2000 * 3) for _ in range(2000)), 2, level=1)

# extra for test 1 edge case: one ~15 MB image
write_png(p('huge15.png'), 2240, 2240, (os.urandom(2240 * 3) for _ in range(2240)), 2, level=1)

# ---------- PDF ----------
def write_pdf(path, objects):
    """objects: list of bytes bodies for objects 1..n. Object 1 must be the Catalog."""
    out = bytearray(b'%PDF-1.4\n%\xe2\xe3\xcf\xd3\n')
    offs = []
    for i, body in enumerate(objects, 1):
        offs.append(len(out))
        out += b'%d 0 obj\n' % i + body + b'\nendobj\n'
    xref = len(out)
    out += b'xref\n0 %d\n0000000000 65535 f \n' % (len(objects) + 1)
    for o in offs:
        out += b'%010d 00000 n \n' % o
    out += b'trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n' % (len(objects) + 1, xref)
    with open(path, 'wb') as f:
        f.write(out)

def stream(dict_extra, raw):
    data = zlib.compress(raw)
    return b'<< /Length %d /Filter /FlateDecode %s >>\nstream\n' % (len(data), dict_extra) + data + b'\nendstream'

content = b'BT /F1 24 Tf 72 700 Td (PDF-MARKER-4412) Tj ET\n'
write_pdf(p('report.pdf'), [
    b'<< /Type /Catalog /Pages 2 0 R >>',
    b'<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    b'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    stream(b'', content),
    b'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
])

iw, ih = 200, 100
img = bytes((x * 255 // iw) for y in range(ih) for x in range(iw))  # grey gradient, no text
write_pdf(p('scanned.pdf'), [
    b'<< /Type /Catalog /Pages 2 0 R >>',
    b'<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    b'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /XObject << /Im1 5 0 R >> >> /Contents 4 0 R >>',
    stream(b'', b'q 400 0 0 200 106 400 cm /Im1 Do Q\n'),
    stream(b'/Type /XObject /Subtype /Image /Width %d /Height %d /ColorSpace /DeviceGray /BitsPerComponent 8' % (iw, ih), img),
])

# ---------- XLSX ----------
from xml.sax.saxutils import escape
shared = []
def si(s):
    if s not in shared: shared.append(s)
    return shared.index(s)

def col(i): return 'ABCDEFGH'[i]

def sheet_xml(rows):
    out = ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
           '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>']
    for r, row in enumerate(rows, 1):
        out.append(f'<row r="{r}">')
        for c, v in enumerate(row):
            ref = f'{col(c)}{r}'
            if isinstance(v, tuple):          # (formula, cached)
                out.append(f'<c r="{ref}"><f>{escape(v[0])}</f><v>{v[1]}</v></c>')
            elif isinstance(v, (int, float)):
                out.append(f'<c r="{ref}"><v>{v}</v></c>')
            else:
                out.append(f'<c r="{ref}" t="s"><v>{si(v)}</v></c>')
        out.append('</row>')
    out.append('</sheetData></worksheet>')
    return ''.join(out)

sales = [
    ['Region', 'Customer', 'Amount'],
    ['North', 'Smith, John', 1200],
    ['South', 'He said "hi"', 850],
    ['East', 'Café 中文', 430],
    ['West', 'Plain', 99],
]
formulas = [[10], [20], [30], [('SUM(A1:A3)', 60)]]
sheets = [('Sales', sheet_xml(sales)), ('Formulas', sheet_xml(formulas)), ('Empty', sheet_xml([]))]

NS = 'http://schemas.openxmlformats.org'
with zipfile.ZipFile(p('book.xlsx'), 'w', zipfile.ZIP_DEFLATED) as z:
    z.writestr('[Content_Types].xml',
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        f'<Types xmlns="{NS}/package/2006/content-types">'
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        '<Default Extension="xml" ContentType="application/xml"/>'
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
        + ''.join(f'<Override PartName="/xl/worksheets/sheet{i}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' for i in (1, 2, 3)) +
        '<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>'
        '</Types>')
    z.writestr('_rels/.rels',
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        f'<Relationships xmlns="{NS}/package/2006/relationships">'
        f'<Relationship Id="rId1" Type="{NS}/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
        '</Relationships>')
    z.writestr('xl/workbook.xml',
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        f'<workbook xmlns="{NS}/spreadsheetml/2006/main" xmlns:r="{NS}/officeDocument/2006/relationships"><sheets>'
        + ''.join(f'<sheet name="{n}" sheetId="{i}" r:id="rId{i}"/>' for i, (n, _) in enumerate(sheets, 1)) +
        '</sheets></workbook>')
    z.writestr('xl/_rels/workbook.xml.rels',
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        f'<Relationships xmlns="{NS}/package/2006/relationships">'
        + ''.join(f'<Relationship Id="rId{i}" Type="{NS}/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet{i}.xml"/>' for i in (1, 2, 3)) +
        f'<Relationship Id="rId4" Type="{NS}/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>'
        '</Relationships>')
    for i, (_, xml) in enumerate(sheets, 1):
        z.writestr(f'xl/worksheets/sheet{i}.xml', xml)
    z.writestr('xl/sharedStrings.xml',
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        f'<sst xmlns="{NS}/spreadsheetml/2006/main" count="{len(shared)}" uniqueCount="{len(shared)}">'
        + ''.join(f'<si><t>{escape(s)}</t></si>' for s in shared) + '</sst>')

# ---------- ZIPs ----------
with zipfile.ZipFile(p('bundle.zip'), 'w', zipfile.ZIP_DEFLATED) as z:
    z.writestr('readme.txt', 'BUNDLE-README-1\n')
    z.writestr('data.csv', 'a,b\n1,2\n')
    z.writestr('nested/deep/inner.txt', 'BUNDLE-NESTED-3\n')

with zipfile.ZipFile(p('evil.zip'), 'w') as z:
    z.writestr(zipfile.ZipInfo('../../escape.txt'), 'ZIP-SLIP-ESCAPED\n')

with zipfile.ZipFile(p('bomb.zip'), 'w', zipfile.ZIP_STORED) as z:
    for i in range(6000):
        z.writestr(f'f{i:05d}.txt', 'x')

# ---------- PCAPNG ----------
def block(btype, body):
    body += b'\x00' * (-len(body) % 4)
    total = 12 + len(body)
    return struct.pack('<II', btype, total) + body + struct.pack('<I', total)

def ip_checksum(h):
    s = sum(struct.unpack('!10H', h))
    while s >> 16: s = (s & 0xffff) + (s >> 16)
    return ~s & 0xffff

qname = b''.join(bytes([len(l)]) + l for l in b'example.com'.split(b'.')) + b'\x00'
dns = struct.pack('!HHHHHH', 0x7731, 0x0100, 1, 0, 0, 0) + qname + struct.pack('!HH', 1, 1)
udp = struct.pack('!HHHH', 53000, 53, 8 + len(dns), 0) + dns
iph = struct.pack('!BBHHHBBH4s4s', 0x45, 0, 20 + len(udp), 1, 0, 64, 17, 0, bytes([192,168,1,10]), bytes([8,8,8,8]))
iph = iph[:10] + struct.pack('!H', ip_checksum(iph)) + iph[12:]
frame = bytes.fromhex('020000000002') + bytes.fromhex('020000000001') + b'\x08\x00' + iph + udp

ts = 1759500000 * 1000000
shb = block(0x0A0D0D0A, struct.pack('<IHHq', 0x1A2B3C4D, 1, 0, -1))
idb = block(1, struct.pack('<HHI', 1, 0, 65535))
epb = block(6, struct.pack('<IIIII', 0, ts >> 32, ts & 0xffffffff, len(frame), len(frame)) + frame)
with open(p('capture.pcapng'), 'wb') as f:
    f.write(shb + idb + epb)

# ---------- misc ----------
with open(p('notes.weird-ext'), 'wb') as f:
    f.write(os.urandom(1024))

# extra for test 9: a file over 64 MB
with open(p('over64.bin'), 'wb') as f:
    for _ in range(65):
        f.write(os.urandom(1024 * 1024))

# ---------- paste.txt ----------
arabic = 'مرحبا بالعالم، هذا نص عربي من اليمين إلى اليسار'
emoji = '🚀🔥✅👨‍👩‍👧‍👦🇲🇦'
lines = []
for i in range(1, 401):
    k = i % 8
    if k == 0:   s = f'function line{i}(a, b) {{ return a + b; }} // ' + 'x' * 620
    elif k == 1: s = f'\tif (x{i} > 0) {{\n'.rstrip('\n') + f'\t\t// tab-indented {i}'
    elif k == 2: s = f'{emoji} emoji line {i} {emoji}'
    elif k == 3: s = f'{arabic} — line {i} — {arabic}'
    elif k == 4: s = f'const s{i} = "' + ('lorem ipsum ' * 55) + '";'
    elif k == 5: s = f'def py_{i}(self):\treturn {{"k": [{i}, {i*2}]}}'
    elif k == 6: s = f'mixed LTR {arabic} RTL {emoji} line {i}\twith\ttabs'
    else:        s = f'SELECT * FROM t WHERE id = {i}; -- plain'
    lines.append(s)
lines[-1] = 'PASTE-LAST-LINE-400 ' + arabic + ' ' + emoji + ' END'
with open(p('paste.txt'), 'w', encoding='utf-8') as f:
    f.write('\n'.join(lines) + '\n')

print('done')
