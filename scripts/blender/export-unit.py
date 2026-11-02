"""Export one Blender unit to the game's JSON: positions, normals, UVs, palette indices and baked shade.
Blender file.blend --background --python scripts/blender/export-unit.py -- --scene 'TLB Infantry Study' --output humanInfantry --max-triangles 608
UVs, smoothed normals and ambient occlusion are derived from the mesh, so hand edits only need a re-export.
"""
import argparse, json, math, random, sys
from pathlib import Path
import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree
sys.path.insert(0, str(Path(__file__).resolve().parent))
from unit_surfaces import ATLAS_MEAN, ATLAS_SIZE, CELL_MARGIN, DENSITY, GRID, SURFACES, WHITE_UV, cell_rect

args = argparse.ArgumentParser()
args.add_argument('--scene', required=True); args.add_argument('--output', required=True)
args.add_argument('--max-triangles', type=int, required=True)
# Banners and arrows do not stand on the ground, so they get no darkening toward the feet.
args.add_argument('--prop', action='store_true')
# Inside a running Blender, exec this file with EXPORT_ARGV set to the same arguments.
args = args.parse_args(globals().get('EXPORT_ARGV') or sys.argv[sys.argv.index('--') + 1:])

ROOT = Path(__file__).resolve().parents[2]
ROLE_ORDER = ['body', 'legL', 'legR', 'mountFront', 'mountBack', 'weapon', 'carry', 'nock', 'prop']
SMOOTH_ANGLE = {'plate': 42, 'iron': 42, 'blade': 25, 'brass': 40}  # hard-edged metal; everything else uses the default
SMOOTH_ANGLE_DEFAULT = 58
AO_RAYS, AO_DISTANCE, AO_FLOOR = 64, 3.2, .34

scene = bpy.data.scenes[args.scene]
root = next(o for o in scene.objects if o.get('tlb_export_root'))
# A scene that no window shows has no depsgraph until its view layer is updated.
scene.view_layers[0].update()
depsgraph = scene.view_layers[0].depsgraph
parts = {o['tlb_role']: o for o in root.children if o.type == 'MESH'}
assert parts and set(parts) <= set(ROLE_ORDER), f'Unknown roles: {sorted(parts)}'

def game(p): return Vector((p[0], p[2], -p[1]))
def rounded(values, digits): return [round(v, digits) + 0. for v in values]
def linear(value):
    channel = [(value >> shift & 255) / 255 for shift in (16, 8, 0)]
    return [c / 12.92 if c <= .04045 else ((c + .055) / 1.055) ** 2.4 for c in channel]

meshes = {}
for role, obj in parts.items():
    evaluated = obj.evaluated_get(depsgraph)
    mesh = evaluated.to_mesh(preserve_all_data_layers=True, depsgraph=depsgraph)
    mesh.calc_loop_triangles()
    transform = root.matrix_world.inverted() @ evaluated.matrix_world
    assert transform.to_3x3().determinant() > 0, f'Apply mirrored transforms first: {role}'
    meshes[role] = (mesh, [game(transform @ v.co) for v in mesh.vertices])

# Occlusion is baked in the neutral pose against every part, so legs darken under the body.
all_points, all_triangles = [], []
for mesh, points in meshes.values():
    base = len(all_points); all_points += points
    all_triangles += [[base + i for i in t.vertices] for t in mesh.loop_triangles]
bvh = BVHTree.FromPolygons(all_points, all_triangles, all_triangles=True)
model_height = max(p.y for p in all_points)

def shade_at(position, normal):
    generator = random.Random(hash_key(position, normal))
    origin = position + normal * .035
    tangent = normal.orthogonal().normalized(); bitangent = normal.cross(tangent)
    hits = 0
    for _ in range(AO_RAYS):
        # Cosine-weighted hemisphere: rays near the normal count most, as diffuse light does.
        a, r = generator.random() * math.tau, math.sqrt(generator.random())
        direction = tangent * (r * math.cos(a)) + bitangent * (r * math.sin(a)) + normal * math.sqrt(max(0, 1 - r * r))
        if bvh.ray_cast(origin, direction, AO_DISTANCE)[0] is not None: hits += 1
    occlusion = AO_FLOOR + (1 - AO_FLOOR) * (1 - hits / AO_RAYS)
    if args.prop: return occlusion
    # Ground bounce and grime: feet are a little darker than shoulders.
    ground = min(1, position.y / (model_height * .55))
    return occlusion * (.8 + .2 * ground * ground * (3 - 2 * ground))
def hash_key(position, normal):
    return hash(tuple(round(v, 3) for v in (*position, *normal))) & 0xffffffff

def surface_of(mesh, polygon):
    name = mesh.materials[polygon.material_index].get('tlb_palette')
    assert name in SURFACES, f'Unknown palette entry: {name}'
    return name

def face_normal(points, polygon):
    """Newell's method; exact for the non-planar quads of tapered limbs."""
    n = Vector()
    ids = polygon.vertices
    for i in range(len(ids)):
        a, b = points[ids[i]], points[ids[(i + 1) % len(ids)]]
        n += Vector(((a.y - b.y) * (a.z + b.z), (a.z - b.z) * (a.x + b.x), (a.x - b.x) * (a.y + b.y)))
    return n  # length is twice the area, so summing gives area weighting

def dominant_axis(n):
    return max(range(3), key=lambda i: abs(n[i]))

palette, palette_ids = [], {}
asset = {'version': 2, 'scale': float(root['game_scale']), 'factionScale': .65, 'triangles': 0, 'palette': palette, 'parts': []}
for role in [r for r in ROLE_ORDER if r in parts]:
    mesh, points = meshes[role]
    pivot = Vector(parts[role]['game_pivot'])
    polygons = list(mesh.polygons)
    area_normals = [face_normal(points, p) for p in polygons]
    names = [surface_of(mesh, p) for p in polygons]
    around = [[] for _ in points]
    for index, polygon in enumerate(polygons):
        for vertex in polygon.vertices: around[vertex].append(index)

    # UV islands: connected faces sharing a surface and a dominant axis, box-projected at a fixed density.
    island_of, islands = [-1] * len(polygons), []
    edge_faces = {}
    for index, polygon in enumerate(polygons):
        for edge in polygon.edge_keys: edge_faces.setdefault(edge, []).append(index)
    for start in range(len(polygons)):
        if island_of[start] >= 0: continue
        axis = dominant_axis(area_normals[start])
        members, stack = [], [start]
        island_of[start] = len(islands)
        while stack:
            current = stack.pop(); members.append(current)
            for edge in polygons[current].edge_keys:
                for other in edge_faces[edge]:
                    if island_of[other] < 0 and names[other] == names[start] and dominant_axis(area_normals[other]) == axis:
                        island_of[other] = len(islands); stack.append(other)
        islands.append((axis, members))
    uv_of = {}
    generator = random.Random(f'{args.output}:{role}')
    per_unit = DENSITY / ATLAS_SIZE
    margin = CELL_MARGIN / ATLAS_SIZE
    usable = 1 / GRID - margin * 2
    def project(axis, p):
        return (p.z, p.y) if axis == 0 else (p.x, p.z) if axis == 1 else (p.x, p.y)
    for axis, members in islands:
        cell = SURFACES[names[members[0]]][0]
        vertices = {v for m in members for v in polygons[m].vertices}
        if cell == 'white':
            for v in vertices: uv_of[(members[0], v)] = WHITE_UV
        else:
            flat = {v: project(axis, points[v]) for v in vertices}
            low_u, high_u = min(f[0] for f in flat.values()), max(f[0] for f in flat.values())
            low_v, high_v = min(f[1] for f in flat.values()), max(f[1] for f in flat.values())
            scale = min(per_unit, usable / max(high_u - low_u, high_v - low_v, 1e-6))
            u0, v0, _, _ = cell_rect(cell)
            # Each island lands at its own spot, so repeated parts do not share the same blemishes.
            start_u = u0 + margin + generator.random() * (usable - (high_u - low_u) * scale)
            start_v = v0 + margin + generator.random() * (usable - (high_v - low_v) * scale)
            for v, (a, b) in flat.items():
                uv_of[(members[0], v)] = (start_u + (a - low_u) * scale, start_v + (b - low_v) * scale)

    # Keep the same UVs on the editable mesh, so the viewport shows what the game will.
    source = parts[role].data
    if len(source.polygons) == len(polygons):
        layer = source.uv_layers.get('Atlas') or source.uv_layers.new(name='Atlas')
        for index, polygon in enumerate(source.polygons):
            for corner in polygon.loop_indices:
                layer.data[corner].uv = uv_of[(islands[island_of[index]][1][0], source.loops[corner].vertex_index)]
    positions, normals, uvs, colors, shades, indices, unique = [], [], [], [], [], [], {}
    shade_cache = {}
    for triangle in mesh.loop_triangles:
        assert triangle.area > 1e-10, f'Degenerate triangle in {role}'
        face = triangle.polygon_index
        name = names[face]
        if name not in palette_ids:
            palette_ids[name] = len(palette)
            palette.append({'name': name, 'linear': rounded(linear(SURFACES[name][1]), 6)})
        cell = SURFACES[name][0]
        limit = math.cos(math.radians(SMOOTH_ANGLE.get(cell, SMOOTH_ANGLE_DEFAULT)))
        own = area_normals[face].normalized()
        for corner in triangle.loops:
            vertex = mesh.loops[corner].vertex_index
            # Smooth across shallow creases only, so plate keeps its edges and cloth does not facet.
            total = Vector()
            for other in around[vertex]:
                if names[other] == name and area_normals[other].normalized().dot(own) >= limit: total += area_normals[other]
            normal = total.normalized()
            position = points[vertex]
            key_shade = (vertex, tuple(rounded(normal, 3)))
            if key_shade not in shade_cache: shade_cache[key_shade] = shade_at(position, normal)
            shade = shade_cache[key_shade] / (ATLAS_MEAN if cell != 'white' else 1)
            uv = uv_of[(islands[island_of[face]][1][0], vertex)]
            p = rounded(position - pivot, 5); n = rounded(normal, 5); t = rounded(uv, 5); s = round(shade, 3)
            assert all(math.isfinite(v) for v in p + n + t)
            key = (*p, *n, *t, palette_ids[name], s)
            if key not in unique:
                unique[key] = len(colors)
                positions += p; normals += n; uvs += t; colors.append(palette_ids[name]); shades.append(s)
            indices.append(unique[key])
    asset['triangles'] += len(indices) // 3
    asset['parts'].append({'role': role, 'pivot': list(parts[role]['game_pivot']), 'positions': positions, 'normals': normals,
        'uvs': uvs, 'colors': colors, 'shades': shades, 'indices': indices})
    print(role, len(indices) // 3, 'triangles,', len(colors), 'vertices')
# An archer shows either its aiming parts or its carrying ones, so the budget counts what is on screen.
shown = sum(len(p['indices']) // 3 for p in asset['parts'] if p['role'] != 'carry')
assert shown <= args.max_triangles, f'Over budget: {shown}'
output = ROOT / f'app/render/three/assets/{args.output}.json'
output.write_text(json.dumps(asset, separators=(',', ':')) + '\n')
print('Exported', shown, 'shown of', asset['triangles'], 'triangles,', sum(len(p['colors']) for p in asset['parts']), 'vertices,', output.stat().st_size // 1024, 'KiB')
