"""Author the orc infantry: a hunched brute with a rusted breastplate, a spiked pauldron, a round shield and an axe.
Run in Blender's Python Console or through exec. It adds its own scene and never saves the open file.
Rebuilds only the generated scene; do not use it for a plain re-export after hand edits.
"""
import math, sys
from pathlib import Path
import bpy
from mathutils import Vector
sys.path.insert(0, str(Path(__file__).resolve().parent))
from unit_kit import Part, begin_scene, study_setup

scene, root = begin_scene('TLB Orc Infantry Study', 'Orc Infantry Refined', .46)
NAMES = ['hide', 'hideDark', 'rust', 'iron', 'leather', 'strap', 'rag', 'faction', 'wood', 'bone', 'eye', 'dark', 'blade']

body = Part('body', (0, 0, 0))
# Barrel torso leaning forward: the chest sits ahead of the hips and the head ahead of the chest.
body.rings([(7.9, 2.05, 1.5, 0, -.1), (9.3, 2.3, 1.72, 0, .02), (10.9, 2.85, 1.9, 0, .22), (12.4, 3.05, 1.82, 0, .36), (13.4, 1.85, 1.3, 0, .5)], 8, 'hide', (False, True), phase=0)
# Rusted breastplate: two hammered halves meeting at a raised ridge, on the front of the chest.
for sign in (-1, 1):
    body.fan([(0, 13.0, 2.34), (sign * 1.5, 12.9, 2.02), (sign * 2.5, 11.7, 1.76), (sign * 2.1, 10.05, 1.92), (0, 9.75, 2.2)], (sign * 1.15, 11.5, 2.5), 'rust', (0, 0, 1))
    # Shoulder strap running over the top of the chest.
    body.patch([(sign * 1.2, 13.05, 2.04), (sign * 1.85, 13.0, 1.84), (sign * 2.0, 13.55, .4), (sign * 1.35, 13.55, .45)], 'strap', (0, 1, .3))
    body.patch([(sign * 1.35, 13.55, .45), (sign * 2.0, 13.55, .4), (sign * 2.15, 12.9, -1.52), (sign * 1.5, 12.95, -1.56)], 'strap', (0, 1, -.3))
# Rear plate, narrower than the front.
body.fan([(-1.9, 12.9, -1.5), (1.9, 12.9, -1.5), (1.7, 10.0, -1.86), (-1.7, 10.0, -1.86)], (0, 11.6, -2.12), 'rust', (0, 0, -1))
# Belt with an iron plate, and a torn cloth hanging in front and behind.
body.rings([(8.1, 2.2, 1.68, 0, -.08), (8.85, 2.32, 1.82, 0, -.02)], 8, 'strap', phase=0)
body.box((0, 8.48, 1.82), (1.05, .95, .3), 'iron')
for z, tilt, name in [(1.72, 1, 'faction'), (-1.68, -1, 'rag')]:
    body.patch([(-1.3, 8.15, z), (1.3, 8.15, z), (1.05, 5.6, z + tilt * .25), (.1, 4.85, z + tilt * .3), (-.95, 5.75, z + tilt * .22)], name, (0, 0, tilt))
# Thick neck pushed forward, then the skull: heavy brow, narrow crown.
body.tube([((0, 13.1, .55), 1.3, 1.1), ((0, 14.15, 1.0), 1.0, .95)], 6, 'hideDark')
body.rings([(13.65, 1.12, 1.12, 0, 1.3), (14.85, 1.38, 1.3, 0, 1.2), (15.85, 1.12, 1.15, 0, 1.08), (16.45, .45, .55, 0, 1.0)], 8, 'hide', (False, True), phase=0)
# Undershot jaw reaching past the face.
body.rings([(13.25, .88, .62, 0, 2.05), (14.25, 1.12, .78, 0, 2.05)], 6, 'hide', (True, True))
# Overhanging brow, deep-set eyes and a flat nose.
body.box((0, 15.32, 2.32), (2.3, .42, .62), 'hideDark')
for sign in (-1, 1):
    body.patch([(sign * .22, 14.74, 2.54), (sign * .92, 14.8, 2.36), (sign * .92, 15.08, 2.42), (sign * .22, 15.06, 2.58)], 'eye')
    # Lower tusks and swept ears: the head's silhouette from far away.
    body.cone((sign * .68, 14.1, 2.55), (sign * .85, 15.15, 2.82), .17, 3, 'bone')
    body.cone((sign * 1.2, 15.2, .95), (sign * 2.6, 15.75, .3), .38, 3, 'hide')
body.fan([(-.34, 14.42, 2.75), (.34, 14.42, 2.75), (.26, 14.98, 2.42), (-.26, 14.98, 2.42)], (0, 14.6, 2.92), 'hideDark')
# Shield arm: spiked rusted pauldron, wrapped forearm reaching to the shield's grip.
body.rings([(11.75, 1.25, 1.42, -3.05, .2), (12.65, 1.55, 1.62, -2.95, .2), (13.35, .72, .88, -2.65, .2)], 8, ['iron', 'rust'], (False, True))
body.cone((-3.15, 13.05, .75), (-3.45, 14.55, .9), .3, 3, 'bone')
body.cone((-3.25, 13.05, -.25), (-3.6, 14.35, -.5), .3, 3, 'bone')
body.tube([((-3.35, 12.1, .15), .88, .9), ((-3.75, 10.3, .25), .74, .78), ((-3.55, 9.9, 1.6), .58, .62)], 6, ['hide', 'strap'])
# Round plank shield, turned outward, with a dull faction-painted centre and an iron boss.
center = Vector((-3.75, 9.35, 1.95)); side = Vector((.96, 0, .28)); up = Vector((0, 1, 0)); facing = Vector((-.28, 0, .96))
def on_shield(angle, radius, depth=0): return center + side * (radius * math.cos(angle)) + up * (radius * math.sin(angle)) + facing * depth
SIDES = 8
rim_back = [body.vertex(on_shield(i * math.tau / SIDES, 2.75, -.22)) for i in range(SIDES)]
rim_front = [body.vertex(on_shield(i * math.tau / SIDES, 2.75, .05)) for i in range(SIDES)]
paint = [body.vertex(on_shield(i * math.tau / SIDES, 1.9, .14)) for i in range(SIDES)]
for i in range(SIDES):
    k = (i + 1) % SIDES
    body.face([rim_back[i], rim_back[k], rim_front[k], rim_front[i]], 'iron', on_shield((i + .5) * math.tau / SIDES, 1) - center)
    body.face([rim_front[i], rim_front[k], paint[k], paint[i]], 'wood', facing)
    body.face([paint[i], paint[k], body.vertex(center + facing * .24)], 'faction', facing)
body.face(rim_back, 'wood', -facing)
body.fan([on_shield(i * math.tau / 6, .62, .22) for i in range(6)], center + facing * .68, 'iron', facing)
# Weapon-side shoulder: bare and muscled, ringed by a strap.
body.rings([(11.9, 1.0, 1.15, 2.95, .1), (12.75, 1.15, 1.25, 2.85, .1), (13.3, .5, .62, 2.55, .1)], 6, 'hide', (False, True))
objects = [body]

for role, sign in [('legL', -1), ('legR', 1)]:
    leg = Part(role, (sign * 1.3, 7.6, 0))
    # Bowed, heavy legs: knee outward, calf wrapped, broad bare feet.
    px, py = leg.pivot[0], leg.pivot[1]
    leg.rings([(py - 5.9, .7, .76, px + sign * .2, -.04), (py - 3.3, .84, .9, px + sign * .42, .12)], 6, 'leather')
    leg.rings([(py - 3.3, .84, .9, px + sign * .42, .12), (py - 1.7, 1.08, 1.12, px + sign * .3, .08), (py + .35, 1.05, 1.05, px, 0)], 6, 'hide')
    leg.rings([(py - 7.42, .9, 1.42, px + sign * .2, .55), (py - 6.8, .92, 1.45, px + sign * .2, .55), (py - 5.9, .7, .76, px + sign * .2, -.04)], 6, 'hideDark', (True, False))
    objects.append(leg)

weapon = Part('weapon', (2.9, 12, 0))
p = Vector(weapon.pivot)
# Thick upper arm down and out; forearm forward to a closed fist on the haft.
elbow, wrist, hand = p + Vector((.5, -2.35, -.1)), p + Vector((.42, -2.65, 1.45)), p + Vector((.4, -2.6, 1.95))
weapon.tube([(tuple(p + Vector((0, .1, 0))), .92, .96), (tuple(elbow), .78, .82), (tuple(wrist), .6, .62)], 6, ['hide', 'strap'])
weapon.rings([(hand.y - .5, .5, .55, hand.x, hand.z), (hand.y + .5, .55, .6, hand.x, hand.z)], 6, 'hideDark', (True, True))
# Haft leaning forward with the blade above the fist.
foot, top = hand + Vector((0, -1.8, -.1)), hand + Vector((0, 5.9, .55))
weapon.tube([(tuple(foot), .2, .2), (tuple(top), .17, .17)], 5, 'wood', (True, True))
# Crescent axe head, iron with a bright ground edge, thick at the haft and thin at the edge.
axis = (top - foot).normalized(); out = Vector((0, 0, 1)); out = (out - axis * out.dot(axis)).normalized()
neck = top - axis * 1.05
def on_axe(a, o, x=0): return neck + axis * a + out * o + Vector((x, 0, 0))
spine = [(.55, .1), (.95, .75), (1.55, 2.15), (-1.0, 2.15), (-.75, .75), (-.5, .1)]
edge = [(1.72, 2.72), (.3, 2.3), (-1.15, 2.72)]
for x in (-1, 1):
    n = Vector((x, 0, 0))
    ids = [weapon.vertex(on_axe(a, o, x * (.2 if o < 1 else .13))) for a, o in spine]
    weapon.face(ids, 'iron', n)
    tip = [weapon.vertex(on_axe(a, o, 0)) for a, o in edge]
    weapon.face([ids[2], tip[0], tip[1], tip[2], ids[3]], 'blade', n)
back = [weapon.vertex(on_axe(a, o, x)) for a, o, x in [(.55, .1, -.2), (.55, .1, .2), (-.5, .1, .2), (-.5, .1, -.2)]]
weapon.face(back, 'iron', -out)
for x in (-1, 1):
    for (a0, o0), (a1, o1) in [(spine[0], spine[1]), (spine[1], spine[2]), (spine[3], spine[4]), (spine[4], spine[5])]:
        weapon.patch([on_axe(a0, o0, x * (.2 if o0 < 1 else .13)), on_axe(a1, o1, x * (.2 if o1 < 1 else .13)), on_axe(a1, o1, 0), on_axe(a0, o0, 0)], 'iron', out * (1 if a0 > 0 else -1) + axis * (1 if a0 > 0 else -1))
objects.append(weapon)

finished = [part.finish(scene, root, NAMES) for part in objects]
total = sum(len(o.data.loop_triangles) for o in finished)
print('TOTAL', total, '/ 624')
assert total <= 624
study_setup(scene)
if bpy.context.window: bpy.context.window.scene = scene
