"""Author a shielded heavy pikeman in Blender, within 684 triangles.
Game coordinates: X right, Y up, Z forward. Four existing pivots remain compatible.
Rebuilds only the generated study scene. The design does not import the previous model.
"""
import bpy, math
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parents[2]
scene=bpy.data.scenes.get('TLB Pikeman Study')
if scene is None:
    scene=bpy.data.scenes.new('TLB Pikeman Study');scene['tlb_generated']=True
else:
    assert scene.get('tlb_generated'), 'Unrelated scene'
    for obj in list(scene.objects): bpy.data.objects.remove(obj,do_unlink=True)
bpy.context.window.scene=scene
PALETTE={
    'steel':0x627886, 'edge':0xb1c3cb, 'iron':0x344550,
    'cloth':0x263747, 'faction':0x6f9be8, 'leather':0x514032,
    'boot':0x292c30, 'gold':0xb29660, 'wood':0x58452f, 'dark':0x151e26,
}
def linear(v): return v/12.92 if v<=.04045 else ((v+.055)/1.055)**2.4
materials={}
for name,value in PALETTE.items():
    mat=bpy.data.materials.get('TLB Pikeman '+name) or bpy.data.materials.new('TLB Pikeman '+name)
    mat.use_nodes=True
    color=[linear((value>>shift&255)/255) for shift in [16,8,0]]
    if name=='faction': color=[c*.65 for c in color]
    mat.diffuse_color=(*color,1)
    shader=next(n for n in mat.node_tree.nodes if n.type=='BSDF_PRINCIPLED')
    shader.inputs['Base Color'].default_value=(*color,1)
    shader.inputs['Roughness'].default_value=.72;shader.inputs['Metallic'].default_value=.12
    mat['tlb_palette']=name;materials[name]=mat

def xyz(p): return (p[0],-p[2],p[1])
root=bpy.data.objects.new('Pikeman Refined',None);scene.collection.objects.link(root)
root['tlb_export_root']=True;root['game_scale']=.44
class Part:
    def __init__(self, role, pivot):
        self.role, self.pivot = role, pivot
        self.vertices, self.faces, self.materials, self.smooth = [], [], [], []
    def vertex(self, p):
        self.vertices.append(p)
        return len(self.vertices) - 1
    def face(self, ids, material, smooth=False, normal=None):
        ids = list(ids)
        if normal is not None:
            a, b, c = [Vector(self.vertices[i]) for i in ids[:3]]
            if (b-a).cross(c-a).dot(Vector(normal)) < 0: ids.reverse()
        self.faces.append(ids); self.materials.append(material); self.smooth.append(smooth)
    def rings(self, rows, sides, material, caps=(False, False), smooth=True, phase=.5):
        loops = []
        for y, rx, rz, x, z in rows:
            loops.append([self.vertex((x + rx*math.sin((i+phase)*2*math.pi/sides), y, z + rz*math.cos((i+phase)*2*math.pi/sides))) for i in range(sides)])
        for j in range(len(loops)-1):
            mat = material[j] if isinstance(material, list) else material
            for i in range(sides):
                k = (i+1) % sides
                self.face([loops[j][i], loops[j][k], loops[j+1][k], loops[j+1][i]], mat, smooth)
        if caps[0]: self.face(reversed(loops[0]), material[0] if isinstance(material,list) else material)
        if caps[1]: self.face(loops[-1], material[-1] if isinstance(material,list) else material)
    def patch(self, points, material, normal=(0,0,1)):
        self.face([self.vertex(p) for p in points], material, False, normal)
    def box(self, center, size, material):
        x,y,z=center; a,b,c=[v/2 for v in size]
        v=[self.vertex((x+dx*a,y+dy*b,z+dz*c)) for dx,dy,dz in [(-1,-1,-1),(1,-1,-1),(1,1,-1),(-1,1,-1),(-1,-1,1),(1,-1,1),(1,1,1),(-1,1,1)]]
        for face in [(0,3,2,1),(4,5,6,7),(0,1,5,4),(3,7,6,2),(0,4,7,3),(1,2,6,5)]: self.face([v[i] for i in face],material)
    def finish(self):
        mesh=bpy.data.meshes.new('Pikeman '+self.role)
        mesh.from_pydata([xyz(p) for p in self.vertices],[],self.faces)
        mesh.update()
        keys=list(PALETTE)
        for key in keys: mesh.materials.append(materials[key])
        for polygon,mat,smooth in zip(mesh.polygons,self.materials,self.smooth):
            polygon.material_index=keys.index(mat); polygon.use_smooth=smooth
        obj=bpy.data.objects.new('Refined '+self.role,mesh); scene.collection.objects.link(obj)
        obj.parent=root; obj.location=xyz(self.pivot)
        obj['tlb_role']=self.role; obj['game_pivot']=self.pivot
        mesh.calc_loop_triangles()
        print(self.role, len(mesh.loop_triangles), 'triangles')
        return obj

# Tubes follow joint centres; each section is perpendicular to the limb, not world-up.
def tube(part, rows, sides, material, caps=(False,False), smooth=True):
    loops=[]
    for j,(position,rx,rz) in enumerate(rows):
        center=Vector(position)
        a=Vector(rows[max(0,j-1)][0]);b=Vector(rows[min(len(rows)-1,j+1)][0])
        axis=(b-a).normalized();x=Vector((1,0,0))
        if abs(axis.dot(x))>.95: x=Vector((0,0,1))
        x=(x-axis*x.dot(axis)).normalized();z=x.cross(axis)
        loops.append([part.vertex(tuple(center+x*(rx*math.sin((i+.5)*2*math.pi/sides))+z*(rz*math.cos((i+.5)*2*math.pi/sides)))) for i in range(sides)])
    for j in range(len(loops)-1):
        mat=material[j] if isinstance(material,list) else material
        for i in range(sides):
            k=(i+1)%sides
            part.face([loops[j][i],loops[j][k],loops[j+1][k],loops[j+1][i]],mat,smooth)
    if caps[0]: part.face(reversed(loops[0]),material[0] if isinstance(material,list) else material)
    if caps[1]: part.face(loops[-1],material[-1] if isinstance(material,list) else material)

def plate(part,outline,center,material):
    rim=[part.vertex(p) for p in outline];middle=part.vertex(center)
    for i in range(len(rim)): part.face([rim[i],rim[(i+1)%len(rim)],middle],material,normal=(0,0,1))

body=Part('body',(0,0,0))
# A tapered cuirass with a pronounced central ridge rather than a spherical torso.
body.rings([(8.45,1.56,.97,0,0),(10.0,1.70,1.12,0,0),(11.75,2.18,1.44,0,0),(13.0,1.68,1.02,0,-.10)],8,'steel',(False,True),smooth=False,phase=0)
# The front ring vertex forms the breastplate ridge without overlapping patches.
# Fauld, belt and two separate hanging cloth panels, not a bell-shaped skirt.
body.rings([(7.85,1.90,1.16,0,0),(8.6,1.70,1.12,0,0)],8,'iron',smooth=False,phase=0)
body.rings([(8.55,1.72,1.15,0,0),(8.86,1.72,1.15,0,0)],8,'leather',smooth=False,phase=0)
body.patch([(-.23,8.54,1.16),(.23,8.54,1.16),(.23,8.88,1.16),(-.23,8.88,1.16)],'gold')
for sign in [-1,1]:
    body.patch([(sign*.18,8.0,1.15),(sign*1.40,8.0,1.05),(sign*1.58,6.45,1.17),(sign*.32,6.05,1.30)],'faction')
    plate(body,[(sign*.35,8.15,1.18),(sign*1.65,8.10,.92),(sign*1.70,7.20,1.04),(sign*.45,7.10,1.34)],(sign*1.0,7.70,1.35),'steel')
# High armoured collar merges into a closed, angular helmet.
body.rings([(12.7,.95,.77,0,-.08),(13.61,.65,.63,0,-.08),(13.8,.62,.61,0,-.08)],6,['iron','edge'])
body.rings([(13.95,.90,1.00,0,-.10),(15.45,1.06,1.04,0,-.10),(16.35,.38,.52,0,-.19)],8,'steel',(False,True),smooth=False)
# Visor's centre ridge, tapered jaw and narrow dark sight line.
plate(body,[(-.91,14.91,.91),(0,14.95,1.20),(.91,14.91,.91),(.62,13.92,.79),(0,13.68,1.00),(-.62,13.92,.79)],(0,14.40,1.36),'iron')
for sign in [-1,1]:
    body.patch([(0,14.97,1.23),(sign*.94,14.94,.94),(sign*.94,15.13,.95),(0,15.15,1.24)],'dark')
    body.patch([(0,15.15,1.25),(sign*.96,15.13,.96),(sign*.90,15.32,.94),(0,15.35,1.22)],'edge')
    body.patch([(sign*.14,14.15,1.25),(sign*.61,14.24,1.03),(sign*.58,14.32,1.04),(sign*.14,14.23,1.28)],'dark')
# Swept back lower helmet, cut from the rear half only.
body.patch([(-.84,14.65,-.80),(.84,14.65,-.80),(.93,13.92,-1.37),(-.93,13.92,-1.37)],'iron',(0,0,-1))
# Raised sagittal comb and flared brow distinguish the line infantry helmet.
v=[body.vertex(p) for p in [(-.12,15.8,1.03),(.12,15.8,1.03),(-.12,16.9,-.12),(.12,16.9,-.12),(-.12,15.7,-1.17),(.12,15.7,-1.17)]]
for f in [(0,2,4),(1,5,3),(0,1,3,2),(2,3,5,4),(4,5,1,0)]:body.face([v[i] for i in f],'edge')
for sign in [-1,1]:
    body.patch([(0,15.40,1.20),(sign*.95,15.32,.95),(sign*1.31,15.14,.94),(0,15.24,1.41)],'steel')
# Broad layered shoulders, with the spear-side sleeve seated deeply in its socket.
for sign in [-1,1]:
    body.rings([(11.40,.90,1.14,sign*2.23,.03),(12.23,1.16,1.31,sign*2.13,-.04),(13.05,.54,.72,sign*1.95,-.10)],8,['iron','steel'],(False,True),smooth=False)
    body.patch([(sign*1.65,11.70,1.0),(sign*2.83,11.7,.85),(sign*2.91,11.38,.85),(sign*1.65,11.38,1.0)],'edge')
# Left forearm reaches the horizontal handle inside the tall shield.
tube(body,[((-2.55,11.95,.05),.60,.62),((-2.90,10.0,.42),.51,.54),((-2.35,10.20,1.72),.40,.44)],5,['cloth','steel'])
tube(body,[((-2.40,10.18,1.55),.42,.45),((-2.22,10.23,1.98),.43,.45)],4,'leather',(True,True),smooth=False)
# Chamfered tower shield with a central ridge. Thickness and rear face are real geometry.
outline=[(-1.38,3.05),(1.38,3.05),(1.80,2.57),(1.64,-2.67),(.98,-3.20),(-.98,-3.20),(-1.64,-2.67),(-1.80,2.57)]
center=Vector((-2.60,9.40,2.15));side=Vector((.985,0,.172));normal=Vector((-.172,0,.985))
def shield_point(x,y,d):return tuple(center+side*x+Vector((0,y,0))+normal*d)
outer=[body.vertex(shield_point(x,y,0)) for x,y in outline]
inner=[body.vertex(shield_point(x*.87,y*.94,.13)) for x,y in outline]
back=[body.vertex(shield_point(x,y,-.23)) for x,y in outline]
mid=body.vertex(shield_point(0,0,.46))
for i in range(len(outline)):
    k=(i+1)%len(outline)
    body.face([outer[i],outer[k],inner[k],inner[i]],'edge',normal=normal)
    body.face([inner[i],inner[k],mid],'faction',normal=normal)
    body.face([outer[i],back[i],back[k],outer[k]],'iron',normal=side*(outline[i][0]+outline[k][0])+Vector((0,outline[i][1]+outline[k][1],0)))
body.face(back,'wood',normal=-normal)
# Pale spearhead heraldry follows the convex face, visible from the battle camera.
for points,material in [([(-.12,-2.20),(.12,-2.20),(.12,0),(-.12,0)],'gold'),([(-.12,0),(.12,0),(.12,.60),(-.12,.60)],'gold'),([(-.74,.47),(0,2.28),(.74,.47),(0,.84)],'edge')]:
    body.patch([shield_point(x,y,.50-.11*abs(y)-.05*abs(x)) for x,y in points],material,normal)
# Two leather straps are visible on the rear of the shield.
for y in [-.60,.60]:
    body.patch([shield_point(-1.05,y-.14,-.25),shield_point(1.05,y-.14,-.25),shield_point(1.05,y+.14,-.25),shield_point(-1.05,y+.14,-.25)],'leather',-normal)
objects=[body.finish()]
for role,sign in [('legL',-1),('legR',1)]:
    leg=Part(role,(sign*1.12,7.8,0))
    advance=.42 if sign<0 else -.30
    leg.rings([(-6.5,.39,.48,sign*.16,advance),(-5.0,.56,.63,sign*.13,advance),(-3.45,.55,.60,sign*.08,.28),(-1.75,.71,.76,0,.08),(0,.63,.65,0,0)],6,['steel','steel','cloth','cloth'])
    plate(leg,[(-.44,-3.12,.80),(.44,-3.12,.80),(.51,-3.55,.81),(.28,-3.94,.80),(-.28,-3.94,.80),(-.51,-3.55,.81)],(0,-3.5,1.0),'iron')
    leg.rings([(-7.58,.58,1.04,sign*.17,.40+advance),(-7.03,.63,1.12,sign*.17,.40+advance),(-6.25,.42,.52,sign*.15,advance)],6,'boot',(True,True),smooth=False)
    objects.append(leg.finish())
weapon=Part('weapon',(2.6,12,0))
# Lowered elbow, forearm extended forward. The sleeve overlaps the fixed shoulder armour.
tube(weapon,[((0,-.12,-.65),.57,.59),((.55,-2.20,-.35),.49,.53),((.30,-2.40,1.65),.37,.41)],6,['cloth','steel'])
# Every grip section is centred on the horizontal shaft, including the closed gauntlet.
tube(weapon,[((.30,-2.40,1.68),.43,.47),((.30,-2.40,2.58),.44,.47)],6,'iron',(True,True),smooth=False)
weapon.patch([(-.04,-1.94,1.92),(.32,-1.91,1.93),(.60,-2.11,2.22),(.25,-2.0,2.29)],'edge',(0,1,0))
tube(weapon,[((.30,-2.40,-7.0),.19,.19),((.30,-2.40,16.8),.19,.19)],6,'wood',(True,False),smooth=False)
# Leather grip extends just beyond the fist; no floating handle or disconnected hand.
for start,end in [(1.35,1.70),(2.57,2.92)]:
    tube(weapon,[((.30,-2.40,start),.24,.24),((.30,-2.40,end),.24,.24)],6,'leather',smooth=False)
tube(weapon,[((.30,-2.40,-7.20),.24,.24),((.30,-2.40,-6.50),.24,.24)],4,'iron',(True,False),smooth=False)
tube(weapon,[((.30,-2.40,16.4),.25,.25),((.30,-2.40,17.10),.22,.22)],6,'iron',smooth=False)
# Narrow diamond-section leaf blade with a clear central ridge.
loops=[]
for z,w,h in [(17.0,.20,.13),(17.55,.49,.17)]:
    loops.append([weapon.vertex((.30+dx*w,-2.40+dy*h,z)) for dx,dy in [(0,1),(1,0),(0,-1),(-1,0)]])
for i in range(4):
    k=(i+1)%4;weapon.face([loops[0][i],loops[0][k],loops[1][k],loops[1][i]],'edge',normal=((1 if i<2 else -1), (1 if i in [0,3] else -1),0))
tip=weapon.vertex((.30,-2.40,19.2))
for i in range(4):weapon.face([loops[1][i],loops[1][(i+1)%4],tip],'edge',normal=(0,0,1))
objects.append(weapon.finish())
root['triangles']=sum(len(o.data.loop_triangles) for o in objects)
print('TOTAL',root['triangles'],'/684')
assert root['triangles']<=684

world=bpy.data.worlds.new('TLB Pikeman Studio');scene.world=world;world.use_nodes=True
bg=next(n for n in world.node_tree.nodes if n.type=='BACKGROUND');bg.inputs['Color'].default_value=(.08,.11,.16,1);bg.inputs['Strength'].default_value=.65
# Enum values are checked against this Blender build before assigning them.
def enum(owner,prop,value):
    valid=[i.identifier for i in owner.bl_rna.properties[prop].enum_items]
    assert value in valid,(prop,value,valid)
    setattr(owner,prop,value)
for name,location,power,size in [('Key',(-9,-12,22),2500,9),('Fill',(9,-8,12),1400,8),('Rim',(2,8,20),2800,7)]:
    light=bpy.data.lights.new('TLB '+name,'AREA');light.energy=power;enum(light,'shape','DISK');light.size=size
    obj=bpy.data.objects.new('TLB '+name,light);scene.collection.objects.link(obj);obj.location=location
    obj.rotation_euler=(Vector((0,0,9))-obj.location).to_track_quat('-Z','Y').to_euler()
camdata=bpy.data.cameras.new('TLB Study Camera');cam=bpy.data.objects.new('TLB Study Camera',camdata);scene.collection.objects.link(cam)
cam.location=(31,-39,25);cam.rotation_euler=(Vector((0,-3,8))-cam.location).to_track_quat('-Z','Y').to_euler()
enum(camdata,'type','ORTHO');camdata.ortho_scale=29;scene.camera=cam
scene.render.resolution_x=1100;scene.render.resolution_y=1100;scene.render.resolution_percentage=100
for obj in bpy.context.selected_objects:obj.select_set(False)
for obj in objects:obj.select_set(True)
bpy.context.view_layer.objects.active=objects[0]
for area in bpy.context.screen.areas:
    if area.type=='VIEW_3D':
        area.spaces.active.region_3d.view_distance=37
        area.spaces.active.region_3d.view_location=(0,-3,8)
        area.spaces.active.region_3d.view_rotation=cam.rotation_euler.to_quaternion()
        enum(area.spaces.active.shading,'type','MATERIAL')
print('Pikeman design ready; earlier scenes preserved.')
