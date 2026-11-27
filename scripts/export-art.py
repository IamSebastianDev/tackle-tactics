"""Export the game's sprite strips and pitch art from Josee's licensed source sheets."""

from pathlib import Path
from struct import pack, unpack_from
from tempfile import TemporaryDirectory
import zlib


ASSETS = Path(__file__).resolve().parents[1] / 'assets'
SOURCE = ASSETS / 'Goals_in_Pixels'
OUTPUT = ASSETS.parent / 'public' / 'assets'
PNG_SIGNATURE = b'\x89PNG\r\n\x1a\n'

# MatchView uses fixed strip lengths, even where the source action is shorter.
OUTFIELD = {
    'idle': ('idle', 12), 'run': ('run', 8), 'dribble': ('run_ball', 8),
    'kick': ('shoot_ball', 8), 'pass': ('shoot_ball', 6), 'header': ('header', 8),
    'trap': ('idle_ball', 6), 'slide_tackle': ('slide_tackle', 10), 'fall': ('slide', 8),
    'celebrate': ('celebration_1', 12), 'sad': ('defensive_stance', 12),
    'tired': ('defensive_stance', 12), 'clap': ('celebration_1', 12), 'juggle': ('right_foot', 12),
}
KEEPER = {
    'idle': ('idle', 12), 'run': ('slide', 8), 'gk_ready': ('defensive_stance', 12),
    'gk_hold': ('hold_ball', 12), 'gk_catch': ('clearance', 6), 'gk_punch': ('clearance_2', 6),
    'gk_punt': ('clearance_3', 8), 'gk_throw': ('clearance_3', 8),
    'celebrate': ('idle', 12), 'sad': ('defensive_stance', 12),
}


def read_aseprite(path):
    data = path.read_bytes()
    _, magic, frame_count, width, height, depth = unpack_from('<I5H', data)
    if magic != 0xA5E0 or depth != 32:
        raise ValueError(f'Expected an RGBA Aseprite file: {path}')

    layers, tags, frames = [], {}, []
    pos = 128
    for _ in range(frame_count):
        size, _, legacy_count, chunk_count = unpack_from('<IHH4xI', data, pos)
        chunk = pos + 16
        frame = {}
        for _ in range(chunk_count or legacy_count):
            length, kind = unpack_from('<IH', data, chunk)
            start = chunk + 6
            if kind == 0x2004:
                name_length = unpack_from('<H', data, start + 16)[0]
                layers.append(data[start + 18:start + 18 + name_length].decode())
            elif kind == 0x2005:
                layer, x, y, _, cel_type = unpack_from('<HhhBH', data, start)
                content = start + 16
                if cel_type == 1:
                    linked_frame = unpack_from('<H', data, content)[0]
                    _, _, w, h, rgba = frames[linked_frame][layer]
                else:
                    w, h = unpack_from('<HH', data, content)
                    rgba = data[content + 4:chunk + length]
                    if cel_type == 2:
                        rgba = zlib.decompress(rgba)
                    if cel_type not in (0, 2) or len(rgba) != w * h * 4:
                        raise ValueError(f'Unsupported Aseprite cel type {cel_type}: {path}')
                frame[layer] = (x, y, w, h, rgba)
            elif kind == 0x2018:
                count = unpack_from('<H', data, start)[0]
                tag = start + 10
                for _ in range(count):
                    first, last = unpack_from('<HH', data, tag)
                    name_length = unpack_from('<H', data, tag + 17)[0]
                    name = data[tag + 19:tag + 19 + name_length].decode()
                    tags.setdefault(name, range(first, last + 1))
                    tag += 19 + name_length
            chunk += length
        frames.append(frame)
        pos += size
    return width, height, layers, tags, frames


def write_png(path, rows):
    def chunk(kind, data):
        return pack('>I', len(data)) + kind + data + pack('>I', zlib.crc32(kind + data))

    header = pack('>IIBBBBB', len(rows[0]) // 4, len(rows), 8, 6, 0, 0, 0)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(PNG_SIGNATURE + chunk(b'IHDR', header)
                     + chunk(b'IDAT', zlib.compress(b''.join(b'\0' + row for row in rows))) + chunk(b'IEND', b''))


def read_png(path):
    data = path.read_bytes()
    width, height, depth, color, _, _, interlace = unpack_from('>IIBBBBB', data, 16)
    if not data.startswith(PNG_SIGNATURE) or (depth, color, interlace) != (8, 6, 0):
        raise ValueError(f'Expected a non-interlaced RGBA PNG: {path}')
    chunks = []
    offset = 8
    while offset < len(data):
        size, kind = unpack_from('>I4s', data, offset)
        if kind == b'IDAT':
            chunks.append(data[offset + 8:offset + 8 + size])
        offset += size + 12

    def paeth(a, b, c):
        p = a + b - c
        return min((a, b, c), key=lambda candidate: abs(p - candidate))

    raw = zlib.decompress(b''.join(chunks))
    stride = width * 4
    rows = [bytes(stride)]
    for start in range(0, len(raw), stride + 1):
        mode = raw[start]
        row = bytearray(raw[start + 1:start + 1 + stride])
        if mode:
            previous = rows[-1]
            for i, value in enumerate(row):
                a, b, c = row[i - 4] if i >= 4 else 0, previous[i], previous[i - 4] if i >= 4 else 0
                predictor = (a, b, (a + b) // 2, paeth(a, b, c) if mode == 4 else 0)[mode - 1]
                row[i] = (value + predictor) & 255
        rows.append(bytes(row))
    if len(rows) != height + 1:
        raise ValueError(f'Wrong PNG height: {path}')
    return rows[1:]


def crop(rows, x, y, w, h):
    return [row[x * 4:(x + w) * 4] for row in rows[y:y + h]]


def mirror(rows):
    return [b''.join(row[i:i + 4] for i in range(len(row) - 4, -1, -4)) for row in rows]


def ramp(*colors):
    return {bytes.fromhex(old): bytes.fromhex(new) for old, new in zip(colors[::2], colors[1::2])}


SKIN = ramp('fca790', 'e8b496', 'fdcbb0', 'f6d2b6', 'f68181', 'c98f74', 'f04f78', 'c98f74')
HAIR = ramp('e83b3b', '38323f', '7a3045', '38323f', '3e3546', '38323f', '694f62', '4e4658')


def render_frame(asset, index, hair, jersey, pattern):
    width, height, layers, _, frames = asset
    canvas = bytearray(width * height * 4)
    palettes = {'body': SKIN, hair: HAIR, 'jersey': jersey, pattern: ramp('3e3546', 'f2f1e7')}
    for layer, (x, y, w, h, rgba) in sorted(frames[index].items()):
        name = layers[layer]
        if name in ('ball', 'VFX') or (name.startswith('stripes') and name != pattern) or (name.lower().startswith('hair') and name != hair):
            continue
        palette = palettes.get(name, {})
        for row in range(h):
            for column in range(w):
                i = (row * w + column) * 4
                px, py = x + column, y + row
                if rgba[i + 3] and 0 <= px < width and 0 <= py < height:
                    pos = (py * width + px) * 4
                    color = rgba[i:i + 3]
                    canvas[pos:pos + 4] = palette.get(color, color) + rgba[i + 3:i + 4]

    # Keep a square frame and a common foot anchor while enlarging the profile art.
    rows = []
    for y in range(64):
        sy = 47 + (y - 56) * 5 // 7
        row = bytearray()
        for x in range(64):
            sx = width // 2 + 1 + (x - 32) * 5 // 7
            offset = (sy * width + sx) * 4
            row.extend(canvas[offset:offset + 4] if 0 <= sy < height and 0 <= sx < width else b'\0' * 4)
        rows.append(bytes(row))
    return rows


def export_cast(out, asset, name, hair, jersey, animations, pattern=''):
    tags = asset[3]
    folder = out / 'cast' / name
    for animation, (tag, count) in animations.items():
        frames = tags[tag]
        if animation == 'pass':
            frames = frames[2:7]
        if animation == 'fall':
            frames = frames[1:5]
        originals = [render_frame(asset, i, hair, jersey, pattern) for i in frames]
        selected = [originals[round(i * (len(originals) - 1) / (count - 1))] for i in range(count)]
        right = [b''.join(row) for row in zip(*selected)]
        left = [b''.join(row) for row in zip(*(mirror(frame) for frame in selected))]
        write_png(folder / f'{animation}_right.png', right)
        write_png(folder / f'{animation}_left.png', left)


def export_ground(out):
    field = read_png(SOURCE / 'tilesets/field/field.png')
    # Assemble four grass motifs without the light/dark bands baked into the atlas.
    palette = ramp('547e64', '467c46', '374e4a', '407442', '92a984', '4d824b')
    grass = [crop(field, x, y, 16, 16) for x, y in [(48, 208), (80, 208), (48, 224), (80, 224)]]
    turf = []
    for order in [(0, 1, 2, 3), (2, 0, 3, 1), (3, 2, 1, 0), (1, 3, 0, 2)]:
        for source_row in zip(*(grass[i] for i in order)):
            row = b''.join(source_row)
            turf.append(b''.join(palette[row[i:i + 3]] + row[i + 3:i + 4] for i in range(0, len(row), 4)))
    write_png(out / 'tiles/turf.png', turf)
    goal = crop(field, 174, 224, 34, 96)
    write_png(out / 'goal_left.png', goal)
    write_png(out / 'goal_right.png', mirror(goal))
    for color, y in [('yellow', 269), ('checked', 301), ('red', 333)]:
        frames = [crop(field, i * 16, y, 16, 19) for i in range(1, 7)]
        write_png(out / f'flag_{color}.png', [b''.join(row) for row in zip(*frames)])
    environment = read_png(SOURCE / 'tilesets/enviroment/enviroment.png')
    write_png(out / 'bench.png', crop(environment, 130, 343, 29, 17))
    for fans, x, y in [('home', 162, 343), ('mixed', 130, 375), ('away', 162, 375)]:
        write_png(out / f'seats_{fans}.png', crop(environment, x, y, 29, 17))
    write_png(out / 'fence.png', crop(environment, 29, 349, 54, 51))
    write_png(out / 'boards.png', crop(environment, 16, 176, 176, 16))


def export_ball(out):
    # A classic black pentagon, edge panels and seams, rolled under a fixed light.
    panels = (
        '...##......',
        '...##......',
        '....+...##.',
        '.....#.+###',
        '....###++##',
        '...#####+..',
        '....###....',
        '....+.+....',
        '..##...##..',
        '..##...##..',
        '.......#...',
    )
    ink = bytes.fromhex('24252bff')
    seam = bytes.fromhex('a5adaaff')
    lit = bytes.fromhex('fffef5ff')
    shade = bytes.fromhex('d6dcd5ff')
    rim = bytes.fromhex('81918aff')

    def pixel(x, y, panel):
        radius = (x - 5) ** 2 + (y - 5) ** 2
        if radius > 29:
            return b'\0' * 4
        if panel == '#':
            return ink
        if panel == '+':
            return seam
        if radius >= 24 and x + y > 10:
            return rim
        return lit if x + y < 12 else shade

    frames = []
    for _ in range(4):
        frames.append([b''.join(pixel(x, y, panel) for x, panel in enumerate(row)) for y, row in enumerate(panels)])
        panels = tuple(''.join(column) for column in zip(*panels[::-1]))
    write_png(out / 'football-roll.png', [b''.join(row) for row in zip(*frames)])


def export_awards(out):
    cup = (
        '11111111111', '12333333321', '12013331021', '12013331021', '12213331221',
        '01113331110', '00012321000', '00001210000', '00001210000', '00001210000',
        '00013331000', '00111111100',
    )
    medal = (
        '012101210', '012101210', '001212100', '001212100', '000121000',
        '001111100', '012333210', '012323210', '012333210', '001111100',
    )
    for name, shape, colors in [
        ('cup_gold', cup, ('402f21', 'c48734', 'ffdb73')),
        ('cup_silver', cup, ('313a47', '8f9eaf', 'e2e9ed')),
        ('medal_silver', medal, ('313a47', '8f9eaf', 'e2e9ed')),
    ]:
        palette = [b'\0' * 4, *(bytes.fromhex(color + 'ff') for color in colors)]
        write_png(out / 'props' / f'{name}.png', [b''.join(palette[int(pixel)] for pixel in row) for row in shape])


def main():
    players = read_aseprite(SOURCE / 'characters/players/character.aseprite')
    keepers = read_aseprite(SOURCE / 'characters/goalkeeper/goalkeeper.aseprite')
    referee = read_aseprite(SOURCE / 'characters/referee/referee.aseprite')
    OUTPUT.parent.mkdir(exist_ok=True)
    with TemporaryDirectory(dir=ASSETS) as temp:
        out = Path(temp) / OUTPUT.name
        for kit, light, shade, pattern in [
            ('blue', '58a8ef', '285b9a', ''),
            ('yellow', 'ffe272', 'ca872b', ''),
            ('white', 'faf8ee', 'abbac1', ''),
            ('hoops', '55bb76', '236946', 'stripes1'),
            ('sky', '96def7', '458eae', ''),
            ('stripes', '454957', '252734', 'stripes3'),
            ('orange', 'ff964a', 'bb5128', ''),
            ('red', 'e15358', '8f293c', ''),
        ]:
            for index, hair in enumerate(('Hair2', 'Hair4'), 1):
                export_cast(out, players, f'{kit}_player_{index}', hair, ramp('ffffff', light, 'c7dcd0', shade), OUTFIELD, pattern)
        for kit, light, shade in [('pink', 'f287a8', 'a64672'), ('black', 'a198b8', '544669'),
                                 ('lime', 'b6e368', '588635'), ('orange', 'fea971', 'af5524')]:
            export_cast(out, keepers, f'keeper_{kit}', 'Hair', ramp('ffffff', light, 'c7dcd0', shade), KEEPER)
        for coach in ('coach', 'coach_2'):
            export_cast(out, referee, coach, 'Hair', {}, {'idle': ('idle', 12), 'shout': ('idle', 12)})
        export_ground(out)
        export_ball(out)
        export_awards(out)
        previous = Path(temp) / 'previous'
        if OUTPUT.exists():
            OUTPUT.rename(previous)
        try:
            out.rename(OUTPUT)
        except OSError:
            if previous.exists():
                previous.rename(OUTPUT)
            raise
    print(f'Goals in Pixels exported to {OUTPUT.relative_to(ASSETS.parent)}')


if __name__ == '__main__':
    main()
