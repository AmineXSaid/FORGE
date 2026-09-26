"""
Cuts the welcome artwork into the two PNGs the welcome page ships.

    python scripts/gen-welcome-art.py assets/welcome-art-source.png

The source is one drawing, white ink and coloured objects (the purple cube and
hammer), either on a solid black background or already cut out with
transparency. The current source is the cut-out kind, kept in `assets/` (not
shipped in the VSIX). The page needs two
transparent cuts of it, as the official ships `welcome-art-dark.svg` and
`welcome-art-light.svg` (see ForgeWelcomeArt.vue):

- resources/forge-welcome-dark.png:  white ink, for a dark panel;
- resources/forge-welcome-light.png: black ink, for a light one.

The coloured objects are the same opaque pixels in both cuts, dark shading
included, so the cube and the hammer look identical on either theme. Every other
pixel is ink whose opacity is its brightness: the black background becomes
transparent and the halftone shading keeps its tone on whatever panel is behind.

A cut-out source carries its own transparency, soft glows included, so
nothing is derived from brightness. The current one also draws every shape in
both black and white ink (black outlines, white fill), so it reads on either
panel as drawn: both cuts are the source itself. Inverting its ink for the light
panel was tried and is worse: the cube's and the hammer's black halftone turns
white, and the pale purple glow turns green.

Needs Pillow only.
"""
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

WIDTH = 1500
# Below this brightness a neutral pixel is background noise, not ink.
BLACK_POINT = 14
# Closes the gaps in an object's coloured outline, so its dark faces count as
# the object rather than as background.
CLOSE_PX = 13
OUT = Path(__file__).resolve().parent.parent / "resources"


def colour_weight(r: int, g: int, b: int) -> float:
    """How coloured a pixel is: 0 is neutral ink or background, 1 is an object."""
    top = max(r, g, b)
    if top < 28:
        return 0.0
    saturation = (top - min(r, g, b)) / top
    return min(1.0, max(0.0, (saturation - 0.3) / 0.2))


def object_masks(source: Image.Image) -> tuple[Image.Image, Image.Image]:
    """The coloured objects, filled solid: (whole object, its interior)."""
    width, height = source.size
    coloured = Image.new("L", source.size)
    coloured.putdata([255 if colour_weight(*p) > 0.5 else 0 for p in source.getdata()])
    closed = coloured.filter(ImageFilter.MaxFilter(CLOSE_PX)).filter(ImageFilter.MinFilter(CLOSE_PX))

    # Fill the holes: whatever the border cannot reach is inside an object.
    outside = closed.copy()
    px = outside.load()
    border = [(x, y) for x in range(width) for y in (0, height - 1)]
    border += [(x, y) for y in range(height) for x in (0, width - 1)]
    for xy in border:
        if px[xy] == 0:
            ImageDraw.floodfill(outside, xy, 128)
    whole = outside.point(lambda v: 0 if v == 128 else 255)
    return whole, whole.filter(ImageFilter.MinFilter(CLOSE_PX))


def cut(source: Image.Image, whole: Image.Image, interior: Image.Image, ink: int) -> Image.Image:
    pixels = []
    for (r, g, b), in_object, in_interior in zip(source.getdata(), whole.getdata(), interior.getdata()):
        top = max(r, g, b)
        if in_object:
            # The object as drawn. Its rim fades out on the black background
            # rather than carrying a black fringe onto a light panel.
            alpha = 1.0 if in_interior else min(1.0, max(0.0, (top - 6) / 24))
            pixels.append((r, g, b, round(alpha * 255)))
            continue
        w = colour_weight(r, g, b)
        ink_alpha = max(0.0, (top - BLACK_POINT) / (255 - BLACK_POINT))
        alpha = w + (1 - w) * ink_alpha
        if alpha <= 0:
            pixels.append((0, 0, 0, 0))
            continue
        # A stray coloured pixel keeps its colour; ink is pure white or black,
        # its tone carried by alpha.
        mix = w / alpha
        pixels.append((
            round(mix * r + (1 - mix) * ink),
            round(mix * g + (1 - mix) * ink),
            round(mix * b + (1 - mix) * ink),
            round(alpha * 255),
        ))
    out = Image.new("RGBA", source.size)
    out.putdata(pixels)
    return out


def is_cut_out(source: Image.Image) -> bool:
    """The background is already transparent (a tenth of the pixels or more)."""
    alpha = source.getchannel("A").histogram()
    return alpha[0] >= 0.1 * source.width * source.height


def main() -> None:
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    source = Image.open(sys.argv[1]).convert("RGBA")
    height = round(source.height * WIDTH / source.width)
    source = source.resize((WIDTH, height), Image.Resampling.LANCZOS)
    if is_cut_out(source):
        cuts = {"forge-welcome-dark.png": source, "forge-welcome-light.png": source}
    else:
        opaque = source.convert("RGB")
        whole, interior = object_masks(opaque)
        cuts = {name: cut(opaque, whole, interior, ink) for name, ink in (("forge-welcome-dark.png", 255), ("forge-welcome-light.png", 0))}
    for name, art in cuts.items():
        path = OUT / name
        # A 256-colour palette with alpha: about a quarter of the size, and a
        # mean error under 3/255 once composited on the panel.
        art.quantize(colors=256, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.NONE).save(path, optimize=True)
        print(f"{path.name}: {WIDTH}x{height}, {path.stat().st_size // 1024} KB")


if __name__ == "__main__":
    main()
