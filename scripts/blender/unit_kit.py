"""Mesh-building helpers for unit models. Coordinates are the game's: X right, Y up, Z forward."""
import math
from pathlib import Path
import bpy
from mathutils import Vector
from unit_surfaces import ATLAS_MEAN

def xyz(p): return (p[0], -p[2], p[1])

def surface_material(name):
    """One Blender material per palette entry; export-unit.py reads tlb_palette."""
    from unit_surfaces import SURFACES
    title = 'TLB Surface ' + name
    material = bpy.data.materials.get(title) or bpy.data.materials.new(title)
    channel = [(SURFACES[name][1] >> shift & 255) / 255 for shift in (16, 8, 0)]
    color = [c / 12.92 if c <= .04045 else ((c + .055) / 1.055) ** 2.4 for c in channel]
    material.diffuse_color = (*color, 1)
    material['tlb_palette'] = name
    connect_atlas(material, name, color)
    return material

def atlas_image(file):
    path = Path(__file__).resolve().parents[2] / 'public/assets/units' / file
    image = bpy.data.images.load(str(path), check_existing=True)
    if file == 'unit-mask.png': image.colorspace_settings.name = 'Non-Color'
    return image

def connect_atlas(material, name, color):
    """Viewport and preview only, so the study matches the game: atlas detail x colour, mask G/B."""
    from unit_surfaces import SURFACES
    material.use_nodes = True
    nodes, links = material.node_tree.nodes, material.node_tree.links
    nodes.clear()
    output = nodes.new('ShaderNodeOutputMaterial'); shader = nodes.new('ShaderNodeBsdfPrincipled')
    albedo = nodes.new('ShaderNodeTexImage'); albedo.image = atlas_image('unit-albedo.png')
    mask = nodes.new('ShaderNodeTexImage'); mask.image = atlas_image('unit-mask.png')
    split = nodes.new('ShaderNodeSeparateColor')
    multiply = nodes.new('ShaderNodeMixRGB'); multiply.blend_type = 'MULTIPLY'; multiply.inputs[0].default_value = 1
    # The atlas's textured cells average ATLAS_MEAN; the exporter divides that out of the vertex shade.
    gain = 1 / ATLAS_MEAN if SURFACES[name][0] != 'white' else 1
    multiply.inputs[2].default_value = (*[min(c * gain, 1) for c in color], 1)
    links.new(albedo.outputs['Color'], multiply.inputs[1])
    links.new(multiply.outputs[0], shader.inputs['Base Color'])
    links.new(mask.outputs['Color'], split.inputs[0])
    links.new(split.outputs[1], shader.inputs['Roughness'])
    links.new(split.outputs[2], shader.inputs['Metallic'])
    links.new(shader.outputs[0], output.inputs[0])

class Part:
    def __init__(self, role, pivot):
        self.role, self.pivot = role, pivot
        self.vertices, self.faces, self.materials = [], [], []
    def vertex(self, p):
        self.vertices.append(tuple(p))
        return len(self.vertices) - 1
    def face(self, ids, material, normal=None):
        ids = list(ids)
        if normal is not None:
            a, b, c = [Vector(self.vertices[i]) for i in ids[:3]]
            if (b - a).cross(c - a).dot(Vector(normal)) < 0: ids.reverse()
        self.faces.append(ids); self.materials.append(material)
    def patch(self, points, material, normal=(0, 0, 1)):
        self.face([self.vertex(p) for p in points], material, normal)
    def box(self, center, size, material):
        x, y, z = center; a, b, c = [v / 2 for v in size]
        v = [self.vertex((x + dx * a, y + dy * b, z + dz * c)) for dx, dy, dz in [(-1, -1, -1), (1, -1, -1), (1, 1, -1), (-1, 1, -1), (-1, -1, 1), (1, -1, 1), (1, 1, 1), (-1, 1, 1)]]
        for face in [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (3, 7, 6, 2), (0, 4, 7, 3), (1, 2, 6, 5)]: self.face([v[i] for i in face], material)
    def loops(self, loops, material, caps=(False, False)):
        for j in range(len(loops) - 1):
            mat = material[j] if isinstance(material, list) else material
            for i in range(len(loops[j])):
                k = (i + 1) % len(loops[j])
                self.face([loops[j][i], loops[j][k], loops[j + 1][k], loops[j + 1][i]], mat)
        if caps[0]: self.face(reversed(loops[0]), material[0] if isinstance(material, list) else material)
        if caps[1]: self.face(loops[-1], material[-1] if isinstance(material, list) else material)
    def rings(self, rows, sides, material, caps=(False, False), phase=.5):
        """Stacked horizontal rings. Each row is (y, radius x, radius z, centre x, centre z)."""
        self.loops([[self.vertex((x + rx * math.sin((i + phase) * math.tau / sides), y, z + rz * math.cos((i + phase) * math.tau / sides)))
            for i in range(sides)] for y, rx, rz, x, z in rows], material, caps)
    def tube(self, rows, sides, material, caps=(False, False)):
        """A limb through joint centres. Each row is ((x, y, z), radius a, radius b); sections stay perpendicular to the limb."""
        loops = []
        for j, (position, rx, rz) in enumerate(rows):
            axis = (Vector(rows[min(len(rows) - 1, j + 1)][0]) - Vector(rows[max(0, j - 1)][0])).normalized()
            x = Vector((1, 0, 0))
            if abs(axis.dot(x)) > .95: x = Vector((0, 0, 1))
            x = (x - axis * x.dot(axis)).normalized(); z = x.cross(axis)
            loops.append([self.vertex(Vector(position) + x * (rx * math.sin((i + .5) * math.tau / sides)) + z * (rz * math.cos((i + .5) * math.tau / sides))) for i in range(sides)])
        self.loops(loops, material, caps)
    def fan(self, outline, center, material, normal=(0, 0, 1)):
        """A shallow pyramid plate: an outline and one raised centre."""
        rim = [self.vertex(p) for p in outline]; middle = self.vertex(center)
        for i in range(len(rim)): self.face([rim[i], rim[(i + 1) % len(rim)], middle], material, normal)
    def cone(self, base, tip, radius, sides, material):
        """Horn, tusk or ear: open at the base, which sits inside the parent shape."""
        axis = (Vector(tip) - Vector(base)).normalized()
        x = Vector((1, 0, 0))
        if abs(axis.dot(x)) > .95: x = Vector((0, 1, 0))
        x = (x - axis * x.dot(axis)).normalized(); z = x.cross(axis)
        rim = [self.vertex(Vector(base) + x * (radius * math.sin(i * math.tau / sides)) + z * (radius * math.cos(i * math.tau / sides))) for i in range(sides)]
        point = self.vertex(tip)
        for i in range(sides): self.face([rim[i], rim[(i + 1) % sides], point], material)
    def finish(self, scene, root):
        names = sorted(set(self.materials))
        mesh = bpy.data.meshes.new(root.name + ' ' + self.role)
        mesh.from_pydata([xyz(Vector(p) - Vector(self.pivot)) for p in self.vertices], [], self.faces)
        mesh.update()
        for name in names: mesh.materials.append(surface_material(name))
        for polygon, material in zip(mesh.polygons, self.materials): polygon.material_index = names.index(material)
        obj = bpy.data.objects.new(root.name + ' ' + self.role, mesh)
        scene.collection.objects.link(obj)
        obj.parent = root; obj.location = xyz(self.pivot)
        obj['tlb_role'] = self.role; obj['game_pivot'] = list(self.pivot)
        mesh.calc_loop_triangles()
        print(self.role, len(mesh.loop_triangles), 'triangles')
        return obj

def begin_scene(title, root_name, game_scale):
    """Create or clear a generated scene and return it with the export root."""
    scene = bpy.data.scenes.get(title)
    if scene is None:
        scene = bpy.data.scenes.new(title); scene['tlb_generated'] = True
    else:
        assert scene.get('tlb_generated'), 'Unrelated scene'
        for obj in list(scene.objects): bpy.data.objects.remove(obj, do_unlink=True)
    root = bpy.data.objects.new(root_name, None)
    scene.collection.objects.link(root)
    root['tlb_export_root'] = True; root['game_scale'] = game_scale
    return scene, root

def study_setup(scene, center_height=8., ortho=21.):
    """Lights and an orthographic camera for preview renders. Not exported."""
    world = bpy.data.worlds.get('TLB Unit Studio') or bpy.data.worlds.new('TLB Unit Studio')
    world.use_nodes = True
    background = next(n for n in world.node_tree.nodes if n.type == 'BACKGROUND')
    background.inputs['Color'].default_value = (.42, .5, .52, 1); background.inputs['Strength'].default_value = .9
    scene.world = world
    for name, location, power, size in [('Key', (-9, -12, 22), 2500, 9), ('Rim', (2, 8, 20), 1800, 7)]:
        light = bpy.data.lights.new(scene.name + ' ' + name, 'AREA'); light.energy = power; light.size = size
        obj = bpy.data.objects.new(scene.name + ' ' + name, light); scene.collection.objects.link(obj)
        obj.location = location
        obj.rotation_euler = (Vector((0, 0, center_height)) - obj.location).to_track_quat('-Z', 'Y').to_euler()
    data = bpy.data.cameras.new(scene.name + ' Camera'); data.type = 'ORTHO'; data.ortho_scale = ortho
    camera = bpy.data.objects.new(scene.name + ' Camera', data); scene.collection.objects.link(camera)
    camera.location = (14, -42, 22)
    camera.rotation_euler = (Vector((0, 0, center_height)) - camera.location).to_track_quat('-Z', 'Y').to_euler()
    scene.camera = camera
    scene.render.resolution_x = scene.render.resolution_y = 1000
