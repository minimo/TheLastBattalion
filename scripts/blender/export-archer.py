"""Export the five edited Blender parts to the game's indexed, vertex-coloured mesh.
Run with __file__ set to this script's path. No generators or external libraries required.
"""
import bpy, json, math
from pathlib import Path
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[2]
scene = bpy.data.scenes['TLB Archer Study']
root = next(o for o in scene.objects if o.get('tlb_export_root'))
roles = ['body', 'legL', 'legR', 'weapon', 'nock']
expected_pivots = {'body': [0,0,0], 'legL': [-1.12,7.8,0], 'legR': [1.12,7.8,0], 'weapon': [0,8.5,0], 'nock': [0,8.5,0]}
bpy.context.window.scene = scene
bpy.context.view_layer.update()
parts = {o.get('tlb_role'):o for o in root.children if o.type == 'MESH'}
assert set(parts) == set(roles), 'The model must have exactly five game parts'
palette, palette_ids = [], {}
def game(p): return (p[0],p[2],-p[1])
def rounded(values, digits=6): return [round(v,digits)+0.0 for v in values]
def color_id(mat):
    if mat.name not in palette_ids:
        node = next(n for n in mat.node_tree.nodes if n.type=='BSDF_PRINCIPLED')
        assert not node.inputs['Base Color'].is_linked, 'Bake colour textures before exporting'
        palette_ids[mat.name] = len(palette)
        palette.append({'name':mat.get('tlb_palette',mat.name), 'linear':rounded(node.inputs['Base Color'].default_value[:3])})
    return palette_ids[mat.name]

depsgraph = bpy.context.evaluated_depsgraph_get()
asset = {'version':1, 'scale':float(root['game_scale']), 'factionScale':.65, 'triangles':0, 'palette':palette, 'parts':[]}
for role in roles:
    obj=parts[role]; pivot=list(obj['game_pivot'])
    assert all(abs(a-b)<1e-6 for a,b in zip(pivot,expected_pivots[role])), f'Changed joint: {role}'
    evaluated=obj.evaluated_get(depsgraph)
    mesh=evaluated.to_mesh(preserve_all_data_layers=True, depsgraph=depsgraph)
    mesh.calc_loop_triangles()
    transform=root.matrix_world.inverted() @ evaluated.matrix_world
    assert transform.to_3x3().determinant() > 0, 'Apply mirrored transforms and recalculate normals first'
    normal_matrix=transform.to_3x3().inverted().transposed()
    positions, normals, colors, indices, unique = [],[],[],[],{}
    for triangle in mesh.loop_triangles:
        palette_index=color_id(mesh.materials[mesh.polygons[triangle.polygon_index].material_index])
        assert triangle.area > 1e-10, f'Degenerate triangle in {role}'
        for loop_index in triangle.loops:
            loop=mesh.loops[loop_index]
            p=game(transform @ mesh.vertices[loop.vertex_index].co)
            position=rounded([p[i]-pivot[i] for i in range(3)],5)
            normal=rounded(game((normal_matrix @ mesh.corner_normals[loop_index].vector).normalized()))
            assert all(math.isfinite(v) for v in position+normal)
            key=tuple(position+normal+[palette_index])
            if key not in unique:
                unique[key]=len(colors)
                positions.extend(position);normals.extend(normal);colors.append(palette_index)
            indices.append(unique[key])
    asset['triangles'] += len(indices)//3
    asset['parts'].append({'role':role,'pivot':pivot,'positions':positions,'normals':normals,'colors':colors,'indices':indices})
    print(role, len(indices)//3, 'triangles,', len(colors), 'vertices')
    evaluated.to_mesh_clear()
assert asset['triangles'] <= 624, f"Over budget: {asset['triangles']}"
assert abs(asset['scale']-.43)<1e-6
output=ROOT/'app/render/three/assets/humanArcher.json'
output.parent.mkdir(parents=True,exist_ok=True)
output.write_text(json.dumps(asset,separators=(',',':'))+'\n')
root['triangles']=asset['triangles']
print('Exported',asset['triangles'],'triangles to',str(output))
