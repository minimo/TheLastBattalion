"""Re-export every unit, banner and arrow from its .blend. Never saves those files.
Blender --background --factory-startup --python scripts/blender/export-all.py
"""
from pathlib import Path
import bpy

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = Path(__file__).resolve().parent / 'export-unit.py'
# file, scene, output, triangle budget (the model it replaced), triangles of the distant model
UNITS = [
    ('human-infantry', 'TLB Infantry Study', 'humanInfantry', 608, 150),
    ('human-pikeman', 'TLB Pikeman Study', 'humanPikeman', 654, 150),
    ('human-archer', 'TLB Archer Study', 'humanArcher', 539, 150),
    ('human-cavalry-textured', 'TLB Cavalry Study', 'humanCavalry', 744, 200),
    ('units', 'TLB Human Porter Study', 'humanPorter', 660, 150),
    ('units', 'TLB Human Engineer Study', 'humanEngineer', 660, 150),
    ('units', 'TLB Orc Infantry Study', 'orcInfantry', 624, 150),
    ('units', 'TLB Orc Pikeman Study', 'orcPikeman', 612, 150),
    ('units', 'TLB Orc Engineer Study', 'orcEngineer', 588, 150),
    ('units', 'TLB Goblin Archer Study', 'goblinArcher', 588, 150),
    ('units', 'TLB Goblin Porter Study', 'goblinPorter', 600, 150),
    ('units', 'TLB Wolf Rider Study', 'wolfRider', 804, 200),
    ('units', 'TLB Banner Study', 'banner', 156, 0),
    ('units', 'TLB Monster Banner Study', 'monsterBanner', 240, 0),
    ('units', 'TLB Arrow Study', 'arrow', 60, 0),
]
for file, scene, output, budget, lod in UNITS:
    bpy.ops.wm.open_mainfile(filepath=str(ROOT / 'assets/blender' / f'{file}.blend'))
    argv = ['--scene', scene, '--output', output, '--max-triangles', str(budget), '--lod-triangles', str(lod)]
    if not lod: argv.append('--prop')
    exec(compile(SCRIPT.read_text(), str(SCRIPT), 'exec'), {'__file__': str(SCRIPT), '__name__': '__main__', 'EXPORT_ARGV': argv})
