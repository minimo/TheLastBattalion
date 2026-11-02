"""Author the orc, goblin, wolf and support units, plus the banners and arrows. Run inside Blender (exec, or the Python Console).
It adds one generated scene per unit and never saves the open file. Rebuilding replaces hand edits in those scenes.
Coordinates are the game's: X right, Y up, Z forward. Each scene's budget is the triangle count of the model it replaced.
"""
import math, sys
from pathlib import Path
import bpy
from mathutils import Vector
sys.path.insert(0, str(Path(__file__).resolve().parent))
from unit_kit import Part, begin_scene, study_setup

# ---- Orc parts ----
def orc_torso(body, skin='hide'):
    """Barrel torso leaning forward: the chest sits ahead of the hips and the head ahead of the chest."""
    body.rings([(7.9, 2.05, 1.5, 0, -.1), (9.3, 2.3, 1.72, 0, .02), (10.9, 2.85, 1.9, 0, .22), (12.4, 3.05, 1.82, 0, .36), (13.4, 1.85, 1.3, 0, .5)], 8, skin, (False, True), phase=0)

def orc_breastplate(body, material='rust', strap='strap'):
    """Two hammered halves meeting at a raised ridge, a narrower rear plate, and straps over the shoulders."""
    for sign in (-1, 1):
        body.fan([(0, 13.0, 2.34), (sign * 1.5, 12.9, 2.02), (sign * 2.5, 11.7, 1.76), (sign * 2.1, 10.05, 1.92), (0, 9.75, 2.2)], (sign * 1.15, 11.5, 2.5), material, (0, 0, 1))
        body.patch([(sign * 1.2, 13.05, 2.04), (sign * 1.85, 13.0, 1.84), (sign * 2.0, 13.55, .4), (sign * 1.35, 13.55, .45)], strap, (0, 1, .3))
        body.patch([(sign * 1.35, 13.55, .45), (sign * 2.0, 13.55, .4), (sign * 2.15, 12.9, -1.52), (sign * 1.5, 12.95, -1.56)], strap, (0, 1, -.3))
    body.fan([(-1.9, 12.9, -1.5), (1.9, 12.9, -1.5), (1.7, 10.0, -1.86), (-1.7, 10.0, -1.86)], (0, 11.6, -2.12), material, (0, 0, -1))

def belt_and_loincloth(body, front='faction', back='rag'):
    body.rings([(8.1, 2.2, 1.68, 0, -.08), (8.85, 2.32, 1.82, 0, -.02)], 8, 'strap', phase=0)
    body.box((0, 8.48, 1.82), (1.05, .95, .3), 'iron')
    for z, tilt, name in [(1.72, 1, front), (-1.68, -1, back)]:
        body.patch([(-1.3, 8.15, z), (1.3, 8.15, z), (1.05, 5.6, z + tilt * .25), (.1, 4.85, z + tilt * .3), (-.95, 5.75, z + tilt * .22)], name, (0, 0, tilt))

def monster_head(part, origin, s=1., skin='hide', dark='hideDark', ear=1., tusks=True):
    """Heavy brow, undershot jaw, glowing eyes and swept ears: the silhouette that reads from far away."""
    ox, oy, oz = origin
    def at(x, y, z): return (ox + x * s, oy + y * s, oz + z * s)
    part.rings([(oy + y * s, a * s, b * s, ox, oz + z * s) for y, a, b, z in [(-1, 1.12, 1.12, .1), (.2, 1.38, 1.3, 0), (1.2, 1.12, 1.15, -.12), (1.8, .45, .55, -.2)]], 8, skin, (False, True), phase=0)
    part.rings([(oy + y * s, a * s, b * s, ox, oz + .85 * s) for y, a, b in [(-1.4, .88, .62), (-.4, 1.12, .78)]], 6, skin, (True, True))
    part.box(at(0, .67, 1.12), (2.3 * s, .42 * s, .62 * s), dark)
    for sign in (-1, 1):
        part.patch([at(sign * .22, .09, 1.34), at(sign * .92, .15, 1.16), at(sign * .92, .43, 1.22), at(sign * .22, .41, 1.38)], 'eye')
        if tusks: part.cone(at(sign * .68, -.55, 1.35), at(sign * .85, .5, 1.62), .17 * s, 3, 'bone')
        part.cone(at(sign * 1.2, .55, -.25), at(sign * (1.2 + 1.4 * ear), .55 + .55 * ear, -.25 - .65 * ear), .38 * s, 3, skin)
    part.fan([at(-.34, -.23, 1.55), at(.34, -.23, 1.55), at(.26, .33, 1.22), at(-.26, .33, 1.22)], at(0, -.05, 1.72), dark)

def orc_neck(body, skin='hideDark'):
    body.tube([((0, 13.1, .55), 1.3, 1.1), ((0, 14.15, 1.0), 1.0, .95)], 6, skin)

def rust_pauldron(body, sign, spikes=2):
    x = sign * 3.05
    body.rings([(11.75, 1.25, 1.42, x, .2), (12.65, 1.55, 1.62, sign * 2.95, .2), (13.35, .72, .88, sign * 2.65, .2)], 8, ['iron', 'rust'], (False, True))
    if spikes:
        body.cone((sign * 3.15, 13.05, .75), (sign * 3.45, 14.55, .9), .3, 3, 'bone')
        body.cone((sign * 3.25, 13.05, -.25), (sign * 3.6, 14.35, -.5), .3, 3, 'bone')

def bare_shoulder(body):
    body.rings([(11.9, 1.0, 1.15, 2.95, .1), (12.75, 1.15, 1.25, 2.85, .1), (13.3, .5, .62, 2.55, .1)], 6, 'hide', (False, True))

def monster_legs(skin, dark, wrap, s=1., thin=1.):
    """Bowed, heavy legs: knee outward, calf wrapped, broad bare feet."""
    legs = []
    for role, sign in [('legL', -1), ('legR', 1)]:
        leg = Part(role, (sign * 1.3 * s, 7.6 * s, 0))
        px, py = leg.pivot[0], leg.pivot[1]
        r = s * thin
        leg.rings([(py - 5.9 * s, .7 * r, .76 * r, px + sign * .2 * s, -.04 * s), (py - 3.3 * s, .84 * r, .9 * r, px + sign * .42 * s, .12 * s)], 6, wrap)
        leg.rings([(py - 3.3 * s, .84 * r, .9 * r, px + sign * .42 * s, .12 * s), (py - 1.7 * s, 1.08 * r, 1.12 * r, px + sign * .3 * s, .08 * s), (py + .35 * s, 1.05 * r, 1.05 * r, px, 0)], 6, skin)
        leg.rings([(py - 7.42 * s, .9 * r, 1.42 * r, px + sign * .2 * s, .55 * s), (py - 6.8 * s, .92 * r, 1.45 * r, px + sign * .2 * s, .55 * s), (py - 5.9 * s, .7 * r, .76 * r, px + sign * .2 * s, -.04 * s)], 6, dark, (True, False))
        legs.append(leg)
    return legs

def thick_arm(weapon, skin='hide', dark='hideDark', wrap='strap'):
    """Upper arm down and out, forearm forward to a closed fist. Returns the fist's centre."""
    p = Vector(weapon.pivot)
    elbow, wrist, hand = p + Vector((.5, -2.35, -.1)), p + Vector((.42, -2.65, 1.45)), p + Vector((.4, -2.6, 1.95))
    weapon.tube([(tuple(p + Vector((0, .1, 0))), .92, .96), (tuple(elbow), .78, .82), (tuple(wrist), .6, .62)], 6, [skin, wrap])
    weapon.rings([(hand.y - .5, .5, .55, hand.x, hand.z), (hand.y + .5, .55, .6, hand.x, hand.z)], 6, dark, (True, True))
    return hand

def orc_infantry():
    body = Part('body', (0, 0, 0))
    orc_torso(body); orc_breastplate(body); belt_and_loincloth(body); orc_neck(body)
    monster_head(body, (0, 14.65, 1.2))
    rust_pauldron(body, -1)
    body.tube([((-3.35, 12.1, .15), .88, .9), ((-3.75, 10.3, .25), .74, .78), ((-3.55, 9.9, 1.6), .58, .62)], 6, ['hide', 'strap'])
    # Round plank shield, turned outward, with a faction-painted centre and an iron boss.
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
    bare_shoulder(body)
    weapon = Part('weapon', (2.9, 12, 0))
    hand = thick_arm(weapon)
    # Haft leaning forward; crescent axe head, thick at the haft and thin at the ground edge.
    foot, top = hand + Vector((0, -1.8, -.1)), hand + Vector((0, 5.9, .55))
    weapon.tube([(tuple(foot), .2, .2), (tuple(top), .17, .17)], 5, 'wood', (True, True))
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
    weapon.face([weapon.vertex(on_axe(a, o, x)) for a, o, x in [(.55, .1, -.2), (.55, .1, .2), (-.5, .1, .2), (-.5, .1, -.2)]], 'iron', -out)
    for x in (-1, 1):
        for (a0, o0), (a1, o1) in [(spine[0], spine[1]), (spine[1], spine[2]), (spine[3], spine[4]), (spine[4], spine[5])]:
            weapon.patch([on_axe(a0, o0, x * (.2 if o0 < 1 else .13)), on_axe(a1, o1, x * (.2 if o1 < 1 else .13)), on_axe(a1, o1, 0), on_axe(a0, o0, 0)], 'iron', out * (1 if a0 > 0 else -1) + axis * (1 if a0 > 0 else -1))
    return [body, *monster_legs('hide', 'hideDark', 'leather'), weapon]

def orc_pikeman():
    body = Part('body', (0, 0, 0))
    orc_torso(body); orc_breastplate(body); belt_and_loincloth(body); orc_neck(body)
    monster_head(body, (0, 14.65, 1.2))
    # Rusted helmet over the crown; the face stays bare.
    body.rings([(15.2, 1.46, 1.38, 0, 1.15), (16.0, 1.18, 1.2, 0, 1.05), (16.65, .42, .5, 0, .95)], 8, 'rust', (False, True), phase=0)
    rust_pauldron(body, -1, spikes=0); rust_pauldron(body, 1, spikes=0)
    body.tube([((-3.35, 12.1, .3), .88, .9), ((-3.65, 10.2, .45), .74, .78), ((-3.3, 9.8, 1.85), .58, .62)], 6, ['hide', 'strap'])
    # Plank tower shield with iron bands and a faction-painted panel.
    body.box((-3.2, 9, 2.25), (4, 6.6, .5), 'wood')
    body.patch([(-4.8, 7.9, 2.52), (-1.6, 7.9, 2.52), (-1.6, 10.1, 2.52), (-4.8, 10.1, 2.52)], 'faction')
    for y in (6.6, 11.4): body.patch([(-5.25, y - .2, 2.54), (-1.15, y - .2, 2.54), (-1.15, y + .2, 2.54), (-5.25, y + .2, 2.54)], 'iron')
    weapon = Part('weapon', (2.9, 12, 0))
    hand = thick_arm(weapon)
    # Level pike with a bone point and a faction tassel.
    weapon.tube([(tuple(hand + Vector((0, 0, -7.5))), .24, .24), (tuple(hand + Vector((0, 0, 14.2))), .2, .2)], 4, 'logDark', (True, False))
    weapon.tube([(tuple(hand + Vector((0, 0, 14.0))), .5, .34), (tuple(hand + Vector((0, 0, 16.4))), .03, .03)], 4, 'bone', (True, False))
    weapon.patch([tuple(hand + Vector((0, .2, 12.9))), tuple(hand + Vector((0, .2, 13.8))), tuple(hand + Vector((0, -1.05, 13.5))), tuple(hand + Vector((0, -.9, 12.7)))], 'faction', (1, 0, 0))
    weapon.patch([tuple(hand + Vector((0, .2, 12.9))), tuple(hand + Vector((0, .2, 13.8))), tuple(hand + Vector((0, -1.05, 13.5))), tuple(hand + Vector((0, -.9, 12.7)))], 'faction', (-1, 0, 0))
    return [body, *monster_legs('hide', 'hideDark', 'leather'), weapon]

def timber_load(body, y, z, wood, rope):
    """Three lashed logs across the back."""
    for dx, dy in [(0, 0), (0, 1.0), (.2, .5)]:
        d = -1.0 if dy == .5 else 0
        body.tube([((dx - 3.3, y + dy - .35, z + d * .55), .56, .56), ((dx + 3.3, y + dy + .35, z + d * .55), .5, .5)], 5, wood, (True, True))
    for x in (-1.7, 1.7):
        body.patch([(x - .14, y - .5, z - 1.16), (x + .14, y - .5, z - 1.16), (x + .14, y + 1.6, z - 1.16), (x - .14, y + 1.6, z - 1.16)], rope, (0, 0, -1))
        body.patch([(x - .14, y + 1.6, z - 1.16), (x + .14, y + 1.6, z - 1.16), (x + .14, y + 1.6, z + .6), (x - .14, y + 1.6, z + .6)], rope, (0, 1, 0))

def orc_engineer():
    body = Part('body', (0, 0, 0))
    orc_torso(body)
    # Leather apron and belt instead of a breastplate.
    body.patch([(-2.1, 12.5, 2.08), (2.1, 12.5, 2.08), (1.9, 7.4, 2.02), (-1.9, 7.4, 2.02)], 'leather')
    belt_and_loincloth(body, 'faction', 'faction')
    orc_neck(body)
    monster_head(body, (0, 14.4, 1.2))
    # Rusted skull cap.
    body.rings([(14.95, 1.46, 1.38, 0, 1.15), (16.05, 1.0, 1.02, 0, 1.0)], 8, 'rust', (False, True), phase=0)
    timber_load(body, 11.6, -2.45, 'logDark', 'bone')
    body.tube([((-3.1, 12.2, .15), .84, .86), ((-3.55, 10.1, .3), .7, .74), ((-3.2, 8.6, 1.1), .55, .6)], 6, ['hide', 'strap'])
    bare_shoulder(body)
    body.rings([(11.9, 1.0, 1.15, -2.95, .1), (12.75, 1.15, 1.25, -2.85, .1), (13.3, .5, .62, -2.55, .1)], 6, 'hide', (False, True))
    weapon = Part('weapon', (2.8, 12, 0))
    hand = thick_arm(weapon)
    # Pickaxe: a double point, tapered both ways from the haft.
    top = hand + Vector((0, 5.4, .3))
    weapon.tube([(tuple(hand + Vector((0, -1.7, -.1))), .2, .2), (tuple(top), .17, .17)], 5, 'wood', (True, False))
    weapon.tube([(tuple(top + Vector((0, -.55, 3.0))), .04, .04), (tuple(top), .3, .36), (tuple(top + Vector((0, -.55, -2.6))), .04, .04)], 4, 'iron')
    return [body, *monster_legs('hide', 'hideDark', 'leather'), weapon]

# ---- Goblin parts ----
def goblin_hips(body):
    body.rings([(7.4, 1.5, 1.05, 0, 0), (8.2, 1.3, .92, 0, 0)], 8, 'strap', phase=0)
    body.rings([(8.0, 1.25, .82, 0, 0), (8.9, .9, .42, 0, 0)], 6, 'goblinDark')
    for z, tilt, name in [(1.06, 1, 'faction'), (-1.06, -1, 'rag')]:
        body.patch([(-1.0, 7.8, z), (1.0, 7.8, z), (.8, 5.5, z + tilt * .16), (.08, 4.9, z + tilt * .2), (-.75, 5.6, z + tilt * .14)], name, (0, 0, tilt))

def goblin_archer():
    body = Part('body', (0, 0, 0))
    goblin_hips(body)
    body.rings([(7.9, 1.2, .8, 0, -.05), (9.8, 1.42, .95, 0, .1), (11.5, 1.75, 1.02, 0, .25), (12.3, 1.0, .75, 0, .42)], 8, 'goblin', (False, True), phase=0)
    body.fan([(-1.35, 11.4, 1.2), (1.35, 11.4, 1.2), (1.2, 8.5, .98), (-1.2, 8.5, .98)], (0, 10, 1.34), 'vest')
    body.fan([(-1.35, 11.4, -.72), (1.35, 11.4, -.72), (1.2, 8.5, -.92), (-1.2, 8.5, -.92)], (0, 10, -1.02), 'vest', (0, 0, -1))
    # Faction scarf at the neck; the head thrusts forward on a thin neck.
    body.rings([(11.9, 1.1, .95, 0, .3), (12.75, .78, .72, 0, .55)], 6, 'faction')
    body.tube([((0, 12.3, .45), .55, .5), ((0, 13.4, .85), .48, .46)], 5, 'goblinDark')
    monster_head(body, (0, 14.05, .85), .82, 'goblin', 'goblinDark', ear=2.1, tusks=False)
    # Quiver on the back with two arrows.
    q0, q1 = Vector((.5, 8.9, -1.25)), Vector((1.35, 12.2, -1.6)); qa = (q1 - q0).normalized()
    body.tube([(tuple(q0), .46, .48), (tuple(q1), .56, .58)], 5, 'leather', (True, False))
    for dx in (-.2, .2):
        tip = q1 + Vector((dx, 0, 0)) + qa * (1.25 + dx)
        body.tube([(tuple(q1 + Vector((dx, 0, 0))), .06, .06), (tuple(tip), .06, .06)], 3, 'shaft')
        body.patch([tuple(tip - qa * .5), tuple(tip), tuple(tip + Vector((.18, 0, 0))), tuple(tip - qa * .5 + Vector((.14, 0, 0)))], 'fletchRed')
        body.patch([tuple(tip - qa * .5), tuple(tip), tuple(tip + Vector((.18, 0, 0))), tuple(tip - qa * .5 + Vector((.14, 0, 0)))], 'fletchRed', (0, 0, -1))
    # Only the arms and the bow change between aiming and carrying. Both aim parts pivot at the shoulders.
    weapon = Part('weapon', (0, 11.5, 0))
    # Thin arms in the drawn pose; the arrow passes beside the cheek.
    x, y = 1.0, 13.3
    bow_hand, draw_hand = Vector((x, y, 4.9)), Vector((x, y, .35))
    weapon.tube([((-1.5, 11.5, .55), .46, .48), ((-.4, 12.5, 2.65), .36, .38), (tuple(bow_hand - Vector((0, 0, .38))), .26, .28)], 5, ['goblin', 'goblinDark'])
    weapon.tube([((1.55, 11.5, -.1), .46, .48), ((2.7, 13.1, -1.55), .35, .37)], 5, 'goblin', (False, True))
    weapon.tube([((2.8, 13.25, -1.65), .35, .35), ((1.25, y, .05), .24, .26)], 5, 'goblinDark')
    weapon.tube([(tuple(bow_hand - Vector((0, .33, 0))), .34, .36), (tuple(bow_hand + Vector((0, .3, 0))), .32, .34)], 4, 'goblinDark', (True, True))
    weapon.tube([((1.2, y, .03), .26, .29), (tuple(draw_hand), .24, .27)], 4, 'goblinDark', (True, True))
    # Crooked dark bow, bound in sections.
    path = [(-4.8, 3.3), (-3.3, 3.75), (-1.6, 4.65), (0, 4.9), (1.6, 4.65), (3.3, 3.75), (4.8, 3.3)]
    weapon.tube([((x, y + a, b), .13 if a else .2, .18 if a else .23) for a, b in path], 4, 'logDark', (True, True))
    for sign in (-1, 1):
        weapon.tube([((x, y + sign * 4.8, 3.3), .026, .026), (tuple(draw_hand), .026, .026)], 3, 'bone')
    # Carried pose, shown unless attacking: arms down, the bow held at the left side.
    carry = Part('carry', (0, 0, 0))
    carry.tube([((1.6, 11.5, -.05), .46, .48), ((2.05, 9.75, .1), .36, .38), ((1.95, 8.35, .6), .26, .28)], 5, ['goblin', 'goblinDark'])
    carry.tube([((1.95, 8.35, .6), .3, .32), ((1.93, 7.9, .72), .27, .3)], 4, 'goblinDark', (True, True))
    carry.tube([((-1.6, 11.5, -.05), .46, .48), ((-2.0, 9.85, .05), .36, .38), ((-2.12, 8.75, .72), .26, .28)], 5, ['goblin', 'goblinDark'])
    carry.tube([((-2.12, 8.92, .82), .32, .34), ((-2.12, 8.4, .82), .3, .32)], 4, 'goblinDark', (True, True))
    carry.tube([((-2.12, 8.65 + a, .82 + b), .13 if a else .2, .18 if a else .23) for a, b in [(-4.8, -1.1), (-2.4, -.4), (0, 0), (2.4, -.4), (4.8, -1.1)]], 4, 'logDark', (True, True))
    carry.tube([((-2.12, 3.85, -.28), .026, .026), ((-2.12, 13.45, -.28), .026, .026)], 3, 'bone')
    nock = Part('nock', (0, 11.5, 0))
    ay = y + .08
    nock.tube([((x, ay, .35), .047, .047), ((x, ay, 5.75), .047, .047)], 4, 'shaft')
    base = [nock.vertex((x + a, ay + b, 5.75)) for a, b in [(-.14, 0), (0, .1), (.14, 0), (0, -.1)]]
    tip = nock.vertex((x, ay, 6.2))
    for i in range(4): nock.face([base[i], base[(i + 1) % 4], tip], 'iron', (0, 0, 1))
    for sign in (-1, 1):
        nock.patch([(x, ay, .55), (x, ay, 1.05), (x + sign * .22, ay, 1.05), (x + sign * .14, ay, .55)], 'fletchRed', (0, 1, 0))
        nock.patch([(x, ay - .01, .55), (x, ay - .01, 1.05), (x + sign * .22, ay - .01, 1.05), (x + sign * .14, ay - .01, .55)], 'fletchRed', (0, -1, 0))
    return [body, *monster_legs('goblin', 'goblinDark', 'vest', .95, .78), weapon, carry, nock]

def arrow_bundle(body, y, z, shaft, fletch):
    """A strapped sheaf: five shafts fanning slightly, fletching up."""
    for dx, dz in [(-.8, 0), (-.4, .32), (0, -.35), (.4, .32), (.8, 0)]:
        top = Vector((dx * 1.12, y + 4.3, z + dz))
        body.tube([((dx, y, z + dz), .07, .07), (tuple(top), .07, .07)], 3, shaft)
        body.patch([tuple(top - Vector((0, .75, 0))), tuple(top), tuple(top + Vector((.2, 0, 0))), tuple(top + Vector((.2, -.75, 0)))], fletch)
        body.patch([tuple(top - Vector((0, .75, 0))), tuple(top), tuple(top + Vector((.2, 0, 0))), tuple(top + Vector((.2, -.75, 0)))], fletch, (0, 0, -1))
    body.rings([(y + 1.25, 1.25, .75, 0, z), (y + 1.65, 1.25, .75, 0, z)], 6, 'strap')

def goblin_porter():
    body = Part('body', (0, 0, 0))
    goblin_hips(body)
    body.rings([(7.9, 1.2, .8, 0, -.05), (9.6, 1.42, .95, 0, .15), (11.3, 1.72, 1.0, 0, .35), (12.1, 1.0, .75, 0, .52)], 8, 'goblin', (False, True), phase=0)
    body.fan([(-1.3, 11.2, 1.25), (1.3, 11.2, 1.25), (1.2, 8.4, 1.0), (-1.2, 8.4, 1.0)], (0, 9.8, 1.42), 'faction')
    body.tube([((0, 12.1, .55), .55, .5), ((0, 13.1, 1.0), .48, .46)], 5, 'goblinDark')
    monster_head(body, (0, 13.75, 1.0), .82, 'goblin', 'goblinDark', ear=2.1, tusks=False)
    # A swollen sack on the back, tied at the top, with arrows sticking out.
    body.rings([(8.3, 1.2, 1.0, 0, -2.65), (9.6, 2.35, 1.85, 0, -2.7), (11.4, 2.45, 1.95, 0, -2.75), (13.1, 1.2, 1.05, 0, -2.75)], 8, 'burlap', (True, False), phase=0)
    body.rings([(13.0, .85, .75, 0, -2.75), (13.55, .95, .85, 0, -2.75)], 6, 'strap')
    arrow_bundle(body, 11.9, -2.75, 'logDark', 'fletchRed')
    for sign in (-1, 1):
        body.patch([(sign * .85, 11.9, 1.3), (sign * 1.25, 11.9, 1.3), (sign * 1.55, 12.15, -.95), (sign * 1.1, 12.2, -.95)], 'strap', (0, 1, .2))
    # Free arm grips the strap across the chest.
    body.tube([((-1.75, 11.5, -.05), .46, .48), ((-2.05, 9.9, .95), .36, .38), ((-.95, 11.3, 1.42), .26, .28)], 5, ['goblin', 'goblinDark'])
    weapon = Part('weapon', (2.4, 11.6, 0))
    p = Vector(weapon.pivot); hand = p + Vector((.28, -1.75, 1.6))
    weapon.tube([(tuple(p), .46, .48), (tuple(p + Vector((.36, -1.85, 0))), .36, .38), (tuple(hand - Vector((.02, .05, .4))), .26, .28)], 5, ['goblin', 'goblinDark'])
    weapon.rings([(hand.y - .4, .34, .38, hand.x, hand.z), (hand.y + .4, .36, .4, hand.x, hand.z)], 6, 'goblinDark', (True, True))
    # Bone club.
    weapon.tube([(tuple(hand + Vector((0, -1.0, -.1))), .14, .14), (tuple(hand + Vector((0, 2.35, .35))), .2, .2), (tuple(hand + Vector((0, 3.2, .45))), .38, .38), (tuple(hand + Vector((0, 3.85, .55))), .24, .24)], 5, 'bone', (True, True))
    return [body, *monster_legs('goblin', 'goblinDark', 'vest', .95, .78), weapon]

# ---- Wolf rider ----
def wolf_rider():
    body = Part('body', (0, 0, 0))
    # Long, deep chested wolf with a high shoulder and a tucked belly.
    body.tube([((0, 8.3, -5.5), 1.15, 1.35), ((0, 8.55, -3.6), 1.95, 2.05), ((0, 9.05, 0), 2.05, 2.25), ((0, 9.55, 3.1), 2.3, 2.85), ((0, 9.75, 4.9), 1.55, 2.05)], 6, 'fur', (True, True))
    # Thick ruff into a heavy head and long muzzle.
    body.tube([((0, 10.2, 4.3), 1.85, 2.2), ((0, 10.95, 6.8), 1.3, 1.45)], 6, 'furLight')
    body.tube([((0, 11.05, 6.6), 1.2, 1.28), ((0, 11.1, 8.0), 1.0, .98), ((0, 10.35, 9.0), .55, .55), ((0, 10.15, 10.25), .42, .4)], 6, ['fur', 'fur', 'furLight'], (True, True))
    body.patch([(-.3, 10.34, 10.32), (.3, 10.34, 10.32), (.26, 10.02, 10.42), (-.26, 10.02, 10.42)], 'dark')
    for sign in (-1, 1):
        body.patch([(sign * .25, 11.42, 8.42), (sign * .92, 11.48, 7.92), (sign * .95, 11.72, 7.95), (sign * .28, 11.62, 8.42)], 'eye')
        body.cone((sign * .7, 12.0, 6.75), (sign * .85, 13.65, 6.3), .42, 4, 'fur')
        # Bared teeth along the muzzle.
        body.patch([(sign * .42, 9.86, 9.05), (sign * .4, 9.84, 10.1), (sign * .39, 10.1, 10.1), (sign * .5, 10.1, 9.05)], 'bone', (sign, 0, 0))
    # Low-slung brush tail.
    body.tube([((0, 9.0, -5.3), .5, .55), ((0, 7.6, -7.3), .68, .7), ((0, 5.9, -8.4), .08, .1)], 4, 'fur')
    # Faction saddle blanket draped over the barrel, and a bone-framed saddle.
    columns = [[(1.42, 11.05, -2.3), (2.3, 9.3, -2.35), (2.08, 7.45, -2.2)], [(1.5, 11.25, 2.0), (2.5, 9.5, 2.0), (2.25, 7.5, 1.9)]]
    for sign in (-1, 1):
        for j in range(2):
            a, b = columns[0], columns[1]
            body.patch([(sign * a[j][0], a[j][1], a[j][2]), (sign * b[j][0], b[j][1], b[j][2]), (sign * b[j + 1][0], b[j + 1][1], b[j + 1][2]), (sign * a[j + 1][0], a[j + 1][1], a[j + 1][2])], 'faction', (sign, 0, 0))
        body.patch([(0, 11.3, -2.3), (0, 11.5, 2.0), (sign * 1.5, 11.25, 2.0), (sign * 1.42, 11.05, -2.3)], 'faction', (0, 1, 0))
    body.box((0, 11.65, -.35), (2.7, .55, 3.0), 'leather')
    body.box((0, 12.15, -1.75), (2.5, .85, .38), 'bone')
    # The orc rider: squat torso, legs gripping the wolf.
    body.rings([(11.9, 1.8, 1.25, 0, -.3), (13.3, 2.15, 1.45, 0, -.2), (15.0, 2.45, 1.45, 0, -.05), (16.3, 1.45, 1.0, 0, .05)], 8, 'hide', (False, True), phase=0)
    for sign in (-1, 1):
        body.fan([(0, 15.85, 1.6), (sign * 1.3, 15.75, 1.4), (sign * 2.05, 14.65, 1.2), (sign * 1.7, 13.2, 1.35), (0, 13.0, 1.52)], (sign * .95, 14.5, 1.82), 'rust')
        body.tube([((sign * 1.1, 12.3, -.2), .85, .9), ((sign * 2.65, 11.0, 1.2), .68, .72), ((sign * 2.85, 8.95, .65), .5, .55)], 6, ['hide', 'leather'])
        body.rings([(7.65, .62, 1.0, sign * 2.85, 1.0), (8.2, .64, 1.02, sign * 2.85, 1.0), (9.0, .5, .55, sign * 2.85, .65)], 6, 'hideDark', (True, False))
        body.rings([(14.7, 1.05, 1.2, sign * 2.55, -.1), (15.45, 1.25, 1.35, sign * 2.45, -.1), (16.0, .55, .7, sign * 2.2, -.1)], 6, ['iron', 'rust'], (False, True))
    body.tube([((0, 16.0, .25), 1.05, .9), ((0, 17.1, .75), .85, .8)], 6, 'hideDark')
    monster_head(body, (0, 17.75, 1.0), .92)
    # Rein arm: reaches for the wolf's scruff.
    body.tube([((-2.7, 15.0, -.05), .72, .75), ((-3.05, 13.4, .75), .58, .6), ((-1.2, 13.35, 2.1), .46, .48)], 5, ['hide', 'strap'])
    legs = []
    for role, z, rows in [
        ('mountFront', 3.6, lambda s: [((s * 1.35, 8.6, 3.05), .75, .82), ((s * 1.42, 5.0, 3.5), .5, .58), ((s * 1.42, 2.8, 3.55), .3, .36), ((s * 1.42, .85, 3.6), .27, .32)]),
        ('mountBack', -3.6, lambda s: [((s * 1.42, 8.3, -3.6), .85, 1.0), ((s * 1.5, 5.2, -2.85), .52, .68), ((s * 1.5, 3.05, -4.35), .29, .36), ((s * 1.5, .85, -4.0), .26, .31)]),
    ]:
        part = Part(role, (0, 7, z))
        for sign in (-1, 1):
            r = rows(sign)
            part.tube(r, 4, 'fur')
            # Paw: wide, with its toes forward.
            x, y, pz = r[-1][0]
            part.rings([(0.02, .46, .72, x, pz + .3), (.45, .46, .72, x, pz + .3), (y + .1, .29, .34, x, pz)], 4, ['furLight', 'fur'], (True, False))
        legs.append(part)
    weapon = Part('weapon', (2.6, 16.2, 0))
    p = Vector(weapon.pivot); elbow, hand = p + Vector((.35, -1.95, -.05)), p + Vector((.3, -1.9, 1.75))
    weapon.tube([(tuple(p + Vector((0, 0, -.05))), .72, .75), (tuple(elbow), .58, .62), (tuple(hand - Vector((0, 0, .45))), .46, .48)], 5, ['hide', 'strap'])
    axis = Vector((0, .15, 1)).normalized()
    def along(t): return tuple(hand + axis * t)
    weapon.tube([(along(-.45), .52, .56), (along(.45), .54, .58)], 5, 'hideDark', (True, True))
    weapon.tube([(along(-5), .22, .22), (along(10.4), .16, .16)], 5, 'wood', (True, False))
    weapon.tube([(along(10.3), .52, .34), (along(13.1), .03, .03)], 4, 'bone', (True, False))
    pennant = [along(7.7), along(9.5), tuple(Vector(along(9.2)) + Vector((0, -1.35, 0))), tuple(Vector(along(8.5)) + Vector((0, -.7, 0))), tuple(Vector(along(7.5)) + Vector((0, -1.35, 0)))]
    weapon.patch(pennant, 'faction', (1, 0, 0)); weapon.patch(pennant, 'faction', (-1, 0, 0))
    return [body, *legs, weapon]

# ---- Human support units ----
def human_legs(trousers, shin, boot):
    legs = []
    for role, sign in [('legL', -1), ('legR', 1)]:
        leg = Part(role, (sign * 1.12, 7.8, 0))
        px, py = leg.pivot[0], leg.pivot[1]
        front = .36 if sign < 0 else -.25
        leg.rings([(py - 6.25, .4, .45, px + sign * .2, front), (py - 4.6, .55, .6, px + sign * .16, front), (py - 2.7, .59, .64, px + sign * .08, .12), (py, .65, .71, px, 0)], 6, [shin, trousers, trousers])
        leg.rings([(py - 7.58, .57, 1.02, px + sign * .2, .36 + front), (py - 7.02, .61, 1.08, px + sign * .2, .39 + front), (py - 6.1, .42, .49, px + sign * .2, front)], 6, boot, (True, True))
        legs.append(leg)
    return legs

def human_trunk(body, tunic, skirt):
    """Hips, a tapered trunk, belt, neck and an open face."""
    body.rings([(7.45, 1.9, 1.04, 0, 0), (8.7, 1.56, .94, 0, 0)], 8, skirt)
    body.rings([(8.4, 1.48, .91, 0, 0), (10.8, 1.89, 1.17, 0, 0), (12.65, 1.66, .92, 0, -.05)], 8, tunic, (False, True))
    body.rings([(8.38, 1.66, 1.02, 0, 0), (8.73, 1.66, 1.02, 0, 0)], 8, 'leather')
    body.patch([(-.22, 8.39, 1.04), (.22, 8.39, 1.04), (.22, 8.73, 1.04), (-.22, 8.73, 1.04)], 'gold')
    body.rings([(12.3, .77, .66, 0, -.1), (13.6, .5, .49, 0, -.05)], 6, tunic)
    body.rings([(13.45, .56, .61, 0, .12), (14.35, .87, .82, 0, .16), (15.32, .83, .79, 0, .08)], 6, 'skin', (False, True))
    for sign in (-1, 1):
        body.patch([(sign * .2, 14.72, .93), (sign * .57, 14.72, .89), (sign * .57, 14.83, .89), (sign * .2, 14.83, .93)], 'dark')
    body.patch([(0, 14.83, .94), (.14, 14.2, .91), (0, 14.2, 1.16)], 'skin'); body.patch([(0, 14.83, .94), (0, 14.2, 1.16), (-.14, 14.2, .91)], 'skin')

def human_right_arm(weapon, sleeve, cuff):
    """Bent elbow, forearm forward to a closed fist. Returns the fist's centre."""
    p = Vector(weapon.pivot)
    elbow, wrist, hand = p + Vector((.53, -1.9, -.23)), p + Vector((.42, -1.56, 1.47)), p + Vector((.4, -1.36, 1.99))
    weapon.tube([(tuple(p + Vector((0, -.05, 0))), .57, .59), (tuple(elbow), .48, .5), (tuple(wrist), .36, .4)], 6, [sleeve, cuff])
    weapon.rings([(hand.y - .42, .38, .43, hand.x, hand.z), (hand.y + .42, .4, .45, hand.x, hand.z)], 6, 'skin', (True, True))
    return hand

def human_porter():
    body = Part('body', (0, 0, 0))
    human_trunk(body, 'faction', 'tunic')
    # Leather jerkin over the faction tunic.
    body.fan([(-1.3, 12.0, 1.15), (1.3, 12.0, 1.15), (1.5, 8.8, 1.08), (-1.5, 8.8, 1.08)], (0, 10.5, 1.34), 'leather')
    # Wide-brimmed felt hat.
    body.rings([(15.18, 1.85, 1.8, 0, .1), (15.3, 1.8, 1.75, 0, .1)], 8, 'felt', (True, False))
    body.rings([(15.3, 1.02, .98, 0, .08), (16.2, .72, .7, 0, .03)], 8, 'felt', (False, True))
    # Pack frame with a shelf, and sheaves of arrows.
    body.box((0, 10.6, -1.5), (3.0, 5.0, .34), 'log')
    body.box((0, 8.3, -2.25), (3.0, .34, 1.35), 'log')
    arrow_bundle(body, 8.5, -2.3, 'shaft', 'feather')
    # Bedroll over the top of the frame.
    body.tube([((-1.9, 13.3, -1.7), .56, .56), ((1.9, 13.3, -1.7), .56, .56)], 6, 'burlap', (True, True))
    for sign in (-1, 1):
        body.patch([(sign * .75, 12.5, 1.02), (sign * 1.2, 12.45, .95), (sign * 1.4, 12.75, -1.32), (sign * .9, 12.8, -1.32)], 'strap', (0, 1, .1))
        body.rings([(11.75, .62, .7, sign * 2.0, -.05), (12.4, .72, .78, sign * 1.95, -.05), (12.85, .35, .45, sign * 1.8, -.05)], 6, 'faction', (False, True))
    # Free hand on the pack strap.
    body.tube([((-2.05, 12.05, 0), .55, .57), ((-2.5, 10.35, .45), .46, .48), ((-1.05, 11.5, 1.2), .34, .36)], 5, ['faction', 'leather'])
    weapon = Part('weapon', (2.6, 12, 0))
    hand = human_right_arm(weapon, 'faction', 'leather')
    # Walking staff.
    weapon.tube([(tuple(hand + Vector((0, -3.2, -.4))), .13, .13), (tuple(hand + Vector((0, 3.4, .45))), .17, .17)], 5, 'log', (True, True))
    return [body, *human_legs('tunic', 'leather', 'boot'), weapon]

def human_engineer():
    body = Part('body', (0, 0, 0))
    human_trunk(body, 'tunic', 'tunic')
    # Leather apron, faction chest band and hanging panels.
    body.fan([(-1.35, 11.0, 1.2), (1.35, 11.0, 1.2), (1.5, 7.2, 1.2), (-1.5, 7.2, 1.2)], (0, 9.2, 1.42), 'leather')
    body.patch([(-1.6, 11.05, 1.17), (1.6, 11.05, 1.17), (1.45, 12.1, 1.0), (-1.45, 12.1, 1.0)], 'faction')
    for sign in (-1, 1):
        body.patch([(sign * .95, 7.6, -1.05), (sign * .1, 7.6, -1.08), (sign * .2, 5.95, -1.2), (sign * 1.1, 6.15, -1.14)], 'faction', (0, 0, -1))
    # Iron helmet with a brim.
    body.rings([(15.05, 1.26, 1.2, 0, .06), (15.25, 1.26, 1.2, 0, .06)], 8, 'iron', (True, False))
    body.rings([(15.2, .98, .94, 0, .06), (16.05, .78, .74, 0, .02), (16.5, .28, .3, 0, 0)], 8, 'iron', (False, True))
    # Frame with lashed logs, and a tool pouch on the belt.
    body.box((0, 10.6, -1.5), (2.8, 4.7, .34), 'wood')
    timber_load(body, 12.45, -2.35, 'log', 'rope')
    body.box((-1.85, 7.8, .55), (1.05, 1.25, .75), 'leather')
    for sign in (-1, 1):
        body.rings([(11.75, .62, .7, sign * 2.0, -.05), (12.4, .72, .78, sign * 1.95, -.05), (12.85, .35, .45, sign * 1.8, -.05)], 6, 'tunic', (False, True))
    body.tube([((-2.05, 12.05, 0), .55, .57), ((-2.55, 10.35, .25), .46, .48), ((-2.2, 8.75, .85), .34, .36)], 5, ['tunic', 'leather'])
    body.rings([(8.1, .35, .4, -2.15, 1.05), (8.8, .37, .42, -2.15, 1.05)], 5, 'skin', (True, True))
    weapon = Part('weapon', (2.65, 12, 0))
    hand = human_right_arm(weapon, 'tunic', 'leather')
    # Sledgehammer: a square iron head across a long haft.
    top = hand + Vector((0, 5.3, .55))
    weapon.tube([(tuple(hand + Vector((0, -1.5, -.15))), .15, .15), (tuple(top), .18, .18)], 5, 'wood', (True, False))
    weapon.tube([(tuple(top + Vector((0, 0, -1.35))), .55, .62), (tuple(top + Vector((0, 0, 1.35))), .6, .68)], 4, 'iron', (True, True))
    return [body, *human_legs('tunic', 'leather', 'boot'), weapon]

# ---- Banners and arrows ----
def double_sided(part, points, material, normal=(0, 0, 1)):
    part.patch(points, material, normal)
    part.patch(points, material, tuple(-v for v in normal))

def banner():
    """A leader's banner; the origin is the foot of the pole. The cloth ripples, with the device following it."""
    prop = Part('prop', (0, 0, 0))
    prop.rings([(0, .3, .3, 0, 0), (30, .26, .26, 0, 0)], 5, 'bannerPole')
    prop.cone((0, 30, 0), (0, 31.6, 0), .45, 4, 'gold')
    prop.tube([((0, 29.2, 0), .18, .18), ((6.3, 29.2, 0), .15, .15)], 4, 'bannerPole')
    def wave(x, y): return .16 * math.sin(x * 1.1 + y * .12)
    def at(x, y, off=0): return (x, y, wave(x, y) + off)
    xs = [.4, 2.27, 4.13, 6]
    for rows, name in [((28.8, 27.1), 'bannerCream'), ((27.1, 19.75), 'faction'), ((19.75, 12.4), 'faction')]:
        for a, b in zip(xs, xs[1:]):
            # The bottom edge is cut in a shallow V.
            drop = lambda x: (abs(x - 3.2) / 2.8 - 1) * -1.3 if rows[1] == 12.4 else 0
            double_sided(prop, [at(a, rows[1] + drop(a)), at(b, rows[1] + drop(b)), at(b, rows[0]), at(a, rows[0])], name)
    for side in (1, -1):
        for radius, offset, sides, name in [(1.6, .14, 8, 'bannerCream'), (.9, .28, 6, 'faction')]:
            prop.patch([at(3.2 + radius * math.cos(i * math.tau / sides), 21 + radius * math.sin(i * math.tau / sides), side * offset) for i in range(sides)], name, (0, 0, side))
    return [prop]

def monster_banner():
    """A spear with a crosspiece, hung with a tattered red cloth and a dull device."""
    prop = Part('prop', (0, 0, 0))
    prop.rings([(0, .3, .3, 0, 0), (30, .26, .26, 0, 0)], 5, 'monsterPole')
    prop.cone((0, 30, 0), (0, 32.8, 0), .5, 4, 'iron')
    prop.tube([((-3.6, 27.6, 0), .2, .2), ((3.6, 27.6, 0), .2, .2)], 4, 'monsterPole')
    for sign in (-1, 1): prop.cone((sign * 3.5, 27.6, 0), (sign * 4.5, 27.6, 0), .25, 3, 'iron')
    def wave(x, y): return .55 + .14 * math.sin(x * 1.2 + y * .15)
    def at(x, y, off=0): return (x, y, wave(x, y) + off)
    xs = [-3, -1, 1, 3]
    for top, bottom in [(27.4, 22.2), (22.2, 17)]:
        for a, b in zip(xs, xs[1:]):
            double_sided(prop, [at(a, bottom), at(b, bottom), at(b, top), at(a, top)], 'bannerRed')
    # Tatters of uneven length, each leaning its own way.
    for i, length in enumerate([3.4, 1.4, 4.6, 2.3, 5.4, 2.6]):
        x = -3 + i; lean = math.sin(i * 2.1) * .3
        double_sided(prop, [(x, 17 - length, wave(x, 17) + lean), (x + 1, 17 - length, wave(x + 1, 17) + lean), at(x + 1, 17), at(x, 17)], 'bannerRed')
    # The device: points are fractions of the cloth (u right, v down), as on the title image's flag.
    def uv(u, v): return -3 + 6 * u, 27.4 - 10.4 * v
    for points in [[(.55, .22), (.55, .86)], [(.55, .25), (.75, .41), (.55, .56)], [(.27, .27), (.47, .38), (.39, .5), (.79, .71)]]:
        for start, end in zip(points, points[1:]):
            ax, ay = uv(*start); bx, by = uv(*end)
            length = math.hypot(bx - ax, by - ay); dx, dy = (bx - ax) / length * .2, (by - ay) / length * .2
            for side in (1, -1):
                prop.patch([at(ax - dx + dy, ay - dy - dx, side * .14), at(bx + dx + dy, by + dy - dx, side * .14), at(bx + dx - dy, by + dy + dx, side * .14), at(ax - dx - dy, ay - dy + dx, side * .14)], 'bannerMark', (0, 0, side))
    return [prop]

def arrow():
    """A flying arrow, head toward +Z. Thicker and brighter than life so it reads from far away."""
    prop = Part('prop', (0, 0, 0))
    prop.tube([((0, 0, -2.3), .16, .16), ((0, 0, 2.3), .16, .16)], 3, 'arrowShaft')
    prop.cone((0, 0, 2.25), (0, 0, 2.95), .3, 3, 'arrowHead')
    double_sided(prop, [(0, -.28, -2.4), (0, .28, -2.4), (0, .28, -1.5), (0, -.28, -1.5)], 'arrowFletch', (1, 0, 0))
    double_sided(prop, [(-.28, 0, -2.4), (.28, 0, -2.4), (.28, 0, -1.5), (-.28, 0, -1.5)], 'arrowFletch', (0, 1, 0))
    return [prop]

UNITS = [
    ('TLB Orc Infantry Study', orc_infantry, .46, 624), ('TLB Orc Pikeman Study', orc_pikeman, .46, 612),
    ('TLB Orc Engineer Study', orc_engineer, .45, 588), ('TLB Goblin Archer Study', goblin_archer, .4, 588),
    ('TLB Goblin Porter Study', goblin_porter, .38, 600), ('TLB Wolf Rider Study', wolf_rider, .44, 804),
    ('TLB Human Porter Study', human_porter, .42, 660), ('TLB Human Engineer Study', human_engineer, .44, 660),
    ('TLB Banner Study', banner, 1., 156), ('TLB Monster Banner Study', monster_banner, 1., 240), ('TLB Arrow Study', arrow, 1., 60),
]
over = []
for title, build, scale, budget in UNITS:
    scene, root = begin_scene(title, title.replace('TLB ', '').replace(' Study', ''), scale)
    finished = [part.finish(scene, root) for part in build()]
    total = sum(len(o.data.loop_triangles) for o in finished if o['tlb_role'] != 'carry')
    print(title, 'TOTAL', total, '/', budget, [(o['tlb_role'], len(o.data.loop_triangles)) for o in finished])
    over += [title] if total > budget else []
    study_setup(scene)
assert not over, over
