"""Generate the shared unit textures. Deterministic. Run with Blender's Python, which bundles NumPy:
Blender --background --python scripts/blender/generate-unit-atlas.py
Writes public/assets/units/unit-albedo.png (greyscale sRGB) and unit-mask.png (G roughness, B metalness).
"""
import struct, sys, zlib
from pathlib import Path
import numpy as np
sys.path.insert(0, str(Path(__file__).resolve().parent))
from unit_surfaces import ATLAS_MEAN, ATLAS_SIZE, CELLS, GRID, MASK_SIZE

ROOT = Path(__file__).resolve().parents[2]
CELL = ATLAS_SIZE // GRID
rng = np.random.default_rng(3791)

def noise(beta=1.5, stretch_x=1., stretch_y=1.):
    """Zero-mean, unit-variance spectral noise. A larger stretch elongates features along that axis."""
    fx, fy = np.fft.fftfreq(CELL)[None, :] * stretch_x, np.fft.fftfreq(CELL)[:, None] * stretch_y
    amplitude = np.hypot(fx, fy); amplitude[0, 0] = 1
    amplitude = amplitude ** -beta; amplitude[0, 0] = 0
    field = np.fft.ifft2(np.fft.fft2(rng.standard_normal((CELL, CELL))) * amplitude).real
    return (field - field.mean()) / field.std()

def scratches(count, length, width=1.):
    """A mask of thin straight lines: 1 on a scratch, 0 elsewhere."""
    mask = np.zeros((CELL, CELL))
    for _ in range(count):
        x, y = rng.uniform(0, CELL, 2); angle = rng.uniform(0, np.pi); run = rng.uniform(.4, 1) * length
        for t in np.arange(0, run, .5):
            mask[int(y + np.sin(angle) * t) % CELL, int(x + np.cos(angle) * t) % CELL] = 1
    if width > 1: mask = np.maximum(mask, np.roll(mask, 1, 0))
    return mask

def surface(name):
    """Returns (albedo detail around 1, roughness offset)."""
    if name == 'white': return np.ones((CELL, CELL)), np.zeros((CELL, CELL))
    if name == 'plate':
        dents, brushed, scratch = noise(2.2), noise(.8, 1, 24), scratches(90, 70)
        return 1 + dents * .05 + brushed * .025 - scratch * .07, dents * .04 + brushed * .03 - scratch * .08
    if name == 'iron':
        pits, hammer, scratch = noise(.7), noise(2.), scratches(50, 40)
        return 1 + hammer * .09 + pits * .05 - scratch * .14, hammer * .06 + pits * .06
    if name == 'mail':
        # Staggered rings: dark gaps between bright, slightly uneven links.
        y, x = np.mgrid[:CELL, :CELL]
        period = 8; row = y // period
        lx, ly = ((x + row % 2 * period // 2) % period) / period - .5, (y % period) / period - .5
        ring = np.abs(np.hypot(lx, ly) - .33)
        links = np.clip(1 - ring / .17, 0, 1)
        return .5 + links * .62 + noise(2.) * .05, (1 - links) * .3
    if name == 'brass':
        patina = noise(2.); return 1 + patina * .13 + noise(.6) * .03, np.clip(patina, 0, None) * .16
    if name == 'blade':
        streak = noise(.7, 1, 40); return 1 + streak * .035 - scratches(26, 60) * .1, streak * .04
    if name == 'rust':
        blotch, pits = noise(1.9), noise(.5)
        return 1 + blotch * .24 + pits * .12, pits * .06
    if name == 'bone':
        crack = scratches(22, 45); return 1 + noise(1.8) * .06 + noise(.8, 1, 16) * .05 - crack * .3, crack * .1
    if name == 'leather':
        grain, wear = noise(.45), noise(2.1)
        return 1 + np.abs(grain) * -.1 + wear * .13, wear * -.1 + grain * .03
    if name == 'cloth':
        y, x = np.mgrid[:CELL, :CELL]
        weave = np.sin(x * np.pi / 2) * np.sin(y * np.pi / 2)
        grime = noise(2.2)
        return 1 + weave * .06 + noise(.6, 1, 6) * .04 + grime * .13, grime * .02
    if name == 'wood':
        grain, knots = noise(1.1, 1, 22), noise(2.3)
        return 1 + grain * .17 + knots * .06 + noise(.4, 1, 30) * .05, grain * .05
    if name == 'fur':
        strands, clumps = noise(.7, 1, 14), noise(2.)
        return 1 + strands * .2 + clumps * .1, strands * .02
    if name == 'skin':
        return 1 + noise(2.2) * .06 + noise(.8) * .015, noise(1.6) * .05
    if name == 'hide':
        mottle, pores, folds = noise(1.9), noise(.45), noise(1.3, 3, 1)
        return 1 + mottle * .13 + np.abs(pores) * -.09 + folds * .05, mottle * .05 + pores * .03
    if name == 'coat':
        # Short, glossy hair: faint strands over broad muscle shading.
        return 1 + noise(.7, 1, 10) * .04 + noise(2.2) * .07, noise(1.5) * .05
    raise KeyError(name)

albedo = np.full((ATLAS_SIZE, ATLAS_SIZE), ATLAS_MEAN)
rough = np.full((ATLAS_SIZE, ATLAS_SIZE), .8)
metal = np.zeros((ATLAS_SIZE, ATLAS_SIZE))
for name, (column, row, roughness, metalness) in CELLS.items():
    detail, offset = surface(name)
    if name == 'white': detail = np.ones_like(detail)
    else:
        # Clipping shifts the mean, so normalise repeatedly to hold ATLAS_MEAN.
        for _ in range(4): detail = np.clip(detail * ATLAS_MEAN / detail.mean(), 0, 1)
    x, y = column * CELL, row * CELL
    albedo[y:y + CELL, x:x + CELL] = detail
    rough[y:y + CELL, x:x + CELL] = np.clip(roughness + offset, .08, 1)
    metal[y:y + CELL, x:x + CELL] = metalness

def png(path, pixels):
    """Writes 8-bit greyscale (H, W) or RGB (H, W, 3) with no dependencies beyond zlib."""
    height, width = pixels.shape[:2]
    color_type, channels = (2, 3) if pixels.ndim == 3 else (0, 1)
    raw = np.zeros((height, width * channels + 1), np.uint8)
    raw[:, 1:] = pixels.reshape(height, width * channels)
    def chunk(tag, data):
        return struct.pack('>I', len(data)) + tag + data + struct.pack('>I', zlib.crc32(tag + data))
    head = struct.pack('>IIBBBBB', width, height, 8, color_type, 0, 0, 0)
    path.write_bytes(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', head) + chunk(b'IDAT', zlib.compress(raw.tobytes(), 9)) + chunk(b'IEND', b''))
    print(path.name, path.stat().st_size // 1024, 'KiB')

def srgb(linear):
    return np.where(linear <= .0031308, linear * 12.92, 1.055 * np.maximum(linear, 1e-6) ** (1 / 2.4) - .055)
def bytes8(values): return np.clip(np.round(values * 255), 0, 255).astype(np.uint8)

out = ROOT / 'public/assets/units'
out.mkdir(parents=True, exist_ok=True)
png(out / 'unit-albedo.png', bytes8(srgb(albedo)))
factor = ATLAS_SIZE // MASK_SIZE
def shrink(a): return a.reshape(MASK_SIZE, factor, MASK_SIZE, factor).mean((1, 3))
png(out / 'unit-mask.png', np.dstack([np.full((MASK_SIZE, MASK_SIZE), 255, np.uint8), bytes8(shrink(rough)), bytes8(shrink(metal))]))
