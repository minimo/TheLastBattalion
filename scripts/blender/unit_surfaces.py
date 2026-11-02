"""Shared unit atlas layout and palette. Used by the atlas generator and the mesh exporter.
The atlas is a 4x4 grid. Albedo holds colourless detail; colour stays in the vertices.
"""
GRID = 4
ATLAS_SIZE = 1024
MASK_SIZE = 512
# Every textured cell has this linear mean, so distant mip levels keep the vertex colour.
ATLAS_MEAN = .8
# Texels per model unit, before an oversized island is scaled down to fit its cell.
DENSITY = 32
CELL_MARGIN = 8

# name: (column, row from the image top, roughness, metalness)
CELLS = {
    'plate': (1, 0, .46, .72), 'iron': (2, 0, .52, .66), 'mail': (3, 0, .5, .78),
    'brass': (0, 1, .4, .8), 'blade': (1, 1, .3, .86), 'rust': (2, 1, .86, .22), 'bone': (3, 1, .68, 0),
    'leather': (0, 2, .62, 0), 'cloth': (1, 2, .94, 0), 'wood': (2, 2, .8, 0), 'fur': (3, 2, .96, 0),
    'white': (0, 3, .72, .12), 'skin': (1, 3, .62, 0), 'hide': (2, 3, .72, 0), 'coat': (3, 3, .58, 0),
}
# The game's fallback for geometry without its own UVs. See WHITE_UV in unitAsset.ts.
WHITE_UV = (.125, .125)

# palette name: (atlas cell, sRGB colour; faction is replaced by the army's colour in the game)
SURFACES = {
    'steel': ('plate', 0x98a6ae), 'edge': ('blade', 0xd3dde2), 'iron': ('iron', 0x57646d), 'mail': ('mail', 0x7a858b),
    'blade': ('blade', 0xc8d2d8), 'gold': ('brass', 0xb7975a), 'rust': ('rust', 0x5a4030),
    'leather': ('leather', 0x5f4631), 'boot': ('leather', 0x33302c), 'strap': ('leather', 0x3e2f24),
    'cloth': ('cloth', 0x2f4052), 'rag': ('cloth', 0x5a5242), 'faction': ('cloth', 0x6f9be8),
    'wood': ('wood', 0x6b5236), 'bone': ('bone', 0xd9cfb4),
    'skin': ('skin', 0xc99c7e), 'hide': ('hide', 0x566b3b), 'hideDark': ('hide', 0x3d4f2a),
    'dark': ('white', 0x151e26), 'eye': ('white', 0xff3a1c),
    'coat': ('coat', 0x76503b), 'muzzle': ('coat', 0x46382e), 'mane': ('fur', 0x25282b),
    'shaft': ('wood', 0xb7a482), 'feather': ('bone', 0xc4d0d0),
}

def cell_rect(name):
    """Returns the cell's UV rectangle (u0, v0, u1, v1). Image rows run down; V runs up."""
    column, row = CELLS[name][:2]
    return column / GRID, 1 - (row + 1) / GRID, (column + 1) / GRID, 1 - row / GRID
