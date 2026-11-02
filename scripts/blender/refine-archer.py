"""Author a hooded war-bow archer in Blender, showing at most 539 triangles at once.
Game coordinates: X right, Y up, Z forward. Five batched parts; the upper-body aiming pivot is at the waist.
Rebuilds only the generated study scene. The design does not import the previous model.
"""
import bpy, math
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parents[2]
scene=bpy.data.scenes.get('TLB Archer Study')
if scene is None:
    scene=bpy.data.scenes.new('TLB Archer Study');scene['tlb_generated']=True
else:
    assert scene.get('tlb_generated'), 'Unrelated scene'
    for obj in list(scene.objects): bpy.data.objects.remove(obj,do_unlink=True)
bpy.context.window.scene=scene
PALETTE={
    'skin':0xc29c7e, 'shaft':0xb7a482, 'feather':0xc4d0d0, 'steel':0x627886, 'edge':0xb1c3cb, 'iron':0x344550,
    'cloth':0x263747, 'faction':0x6f9be8, 'leather':0x6d5540,
    'boot':0x292c30, 'gold':0xb29660, 'wood':0x58452f, 'dark':0x151e26,
}
def linear(v): return v/12.92 if v<=.04045 else ((v+.055)/1.055)**2.4
materials={}
for name,value in PALETTE.items():
    mat=bpy.data.materials.get('TLB Archer '+name) or bpy.data.materials.new('TLB Archer '+name)
    mat.use_nodes=True
    color=[linear((value>>shift&255)/255) for shift in [16,8,0]]
    if name=='faction': color=[c*.65 for c in color]
    mat.diffuse_color=(*color,1)
    shader=next(n for n in mat.node_tree.nodes if n.type=='BSDF_PRINCIPLED')
    shader.inputs['Base Color'].default_value=(*color,1)
    shader.inputs['Roughness'].default_value=.72;shader.inputs['Metallic'].default_value=.12
    mat['tlb_palette']=name;materials[name]=mat

def xyz(p): return (p[0],-p[2],p[1])
root=bpy.data.objects.new('Archer Refined',None);scene.collection.objects.link(root)
root['tlb_export_root']=True;root['game_scale']=.43
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
        mesh=bpy.data.meshes.new('Archer '+self.role)
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

# Lower coat and belt remain on the hips; the aiming assembly bends above them.
body=Part('body',(0,0,0))
body.rings([(8.35,1.40,.87,0,0),(9.25,1.0,.45,0,0)],8,'cloth')
body.rings([(7.45,1.9,1.04,0,0),(8.70,1.56,.94,0,0)],8,'cloth',smooth=False)
body.rings([(8.38,1.66,1.02,0,0),(8.73,1.66,1.02,0,0)],8,'leather',smooth=False)
body.patch([(-.22,8.39,1.04),(.22,8.39,1.04),(.22,8.73,1.04),(-.22,8.73,1.04)],'gold')
for side in [-1,1]:
    body.patch([(side*.16,7.8,1.08),(side*1.4,7.8,1.00),(side*1.52,6.3,1.13),(side*.35,6.05,1.18)],'faction')
body.box((1.62,7.96,.14),(.78,.85,.88),'leather')
objects=[]
for role,sign in [('legL',-1),('legR',1)]:
    leg=Part(role,(sign*1.12,7.8,0))
    front=.36 if sign<0 else -.25
    leg.rings([(-6.25,.40,.45,sign*.20,front),(-4.6,.55,.60,sign*.16,front),(-2.7,.59,.64,sign*.08,.12),(0,.65,.71,0,0)],6,['boot','cloth','cloth'])
    leg.rings([(-7.58,.57,1.02,sign*.20,.36+front),(-7.02,.61,1.08,sign*.20,.39+front),(-6.10,.42,.49,sign*.20,front)],6,'boot',(True,True),smooth=False)
    objects.append(leg.finish())

# All upper-body coordinates are authored in the neutral drawn pose, then made local.
body.rings([(8.40,1.48,.91,0,0),(10.8,1.89,1.17,0,0),(12.65,1.66,.92,0,-.05)],8,'leather',(False,True),smooth=False)
body.rings([(12.3,.77,.66,0,-.10),(13.6,.50,.49,0,-.05)],6,'cloth')
# Hooded face with a leather scarf across the lower jaw.
body.rings([(13.45,.56,.61,0,.12),(14.35,.87,.82,0,.16),(15.32,.83,.79,0,.08)],6,'skin',(False,True))
body.patch([(-.56,13.48,.68),(.56,13.48,.68),(.72,14.02,.88),(-.72,14.02,.88)],'cloth')
for sign in [-1,1]:
    body.patch([(sign*.20,14.72,.93),(sign*.57,14.72,.89),(sign*.57,14.83,.89),(sign*.20,14.83,.93)],'dark')
    body.patch([(0,14.83,.94),(sign*.14,14.20,.91),(0,14.20,1.16)],'skin')
# Open the front of the hood, retaining its sides, rear and crown.
first=len(body.faces)
body.rings([(13.35,1.17,.96,0,-.12),(15.38,1.21,1.10,0,-.18),(16.36,.28,.40,0,-.42)],8,'faction',(False,True),smooth=False)
remove={first+j*8+i for j in range(2) for i in [0,6,7]}
for attribute in ['faces','materials','smooth']:
    values=getattr(body,attribute);setattr(body,attribute,[value for i,value in enumerate(values) if i not in remove])
# Hood lining closes the gap beside the face; back faces are not drawn, so the hood's inside would show the background.
for sign in [-1,1]:
    body.patch([(sign*1.08,13.35,.25),(sign*1.12,15.38,.24),(sign*.76,15.3,.55),(sign*.78,13.5,.55)],'cloth')
# Folded brow projects past the face, giving the hood depth and a sharper silhouette.
for sign in [-1,1]:
    body.patch([(sign*1.10,15.38,.65),(sign*.87,15.22,1.02),(0,15.68,1.12),(0,16.18,.12)],'faction')
# Short shoulder cape and the cross-body quiver strap.
for side in [-1,1]:
    body.patch([(side*.55,13.12,-.02),(side*2.06,12.42,-.05),(side*2.1,11.35,-1.0),(side*.62,11.6,-1.22)],'cloth',(side,0,-1))
    body.patch([(side*.55,13.12,.04),(side*2.06,12.42,.01),(side*2.1,11.35,-.94),(side*.62,11.6,-1.16)],'cloth',(-side,0,1))
body.patch([(-1.15,12.25,.84),(-.85,12.4,.88),(.65,10.75,1.14),(.32,10.68,1.18)],'boot')
body.patch([(.32,10.68,1.18),(.65,10.75,1.14),(1.24,9.2,.77),(.99,9.1,.84)],'boot')
body.patch([(-.22,11.38,1.20),(.03,11.57,1.20),(.25,11.36,1.20),(0,11.17,1.20)],'gold')
# Quiver on the back with two visible feathered arrows.
q0=Vector((.65,9.4,-1.25));q1=Vector((1.65,12.85,-1.65));qa=(q1-q0).normalized()
tube(body,[(tuple(q0),.50,.53),(tuple(q1),.61,.64)],5,'leather',(True,False),smooth=False)
tube(body,[(tuple(q1-qa*.18),.65,.68),(tuple(q1+qa*.12),.65,.68)],5,'gold',smooth=False)
for dx in [-.23,.23]:
    bottom=q1+Vector((dx,0,0));top=bottom+qa*(1.3+dx)
    tube(body,[(tuple(bottom),.06,.06),(tuple(top),.06,.06)],3,'shaft',smooth=False)
    for side in [-1,1]:
        p0=top-qa*.55; p1=top-qa*.1
        body.patch([tuple(p0),tuple(p1),tuple(p1+Vector((side*.20,0,0))),tuple(p0+Vector((side*.15,0,0)))],'feather',(0,0,1))
        body.patch([tuple(p0+Vector((0,0,.01))),tuple(p1+Vector((0,0,.01))),tuple(p1+Vector((side*.20,0,.01))),tuple(p0+Vector((side*.15,0,.01)))],'feather',(0,0,-1))
objects.insert(0,body.finish())
# Only the arms and the bow change between aiming and carrying. Both aim parts pivot at the shoulders.
weapon=Part('weapon',(0,12.3,0))
# Left arm pushes the bow away; right elbow stays out and the draw fingers anchor at the cheek.
bow_hand=Vector((1.0,14.10,5.30));draw_hand=Vector((1.0,14.10,.42))
tube(weapon,[((-1.55,12.35,.45),.55,.58),((-.45,13.35,2.85),.44,.47),(tuple(bow_hand-Vector((0,0,.42))),.32,.35)],5,['cloth','leather'])
# Upper arm and forearm are separate tubes, so the sharp elbow does not pinch into a spike.
tube(weapon,[((1.6,12.35,-.4),.54,.57),((2.85,13.95,-1.75),.42,.44)],5,'cloth',(False,True))
tube(weapon,[((2.95,14.1,-1.85),.42,.42),((1.25,14.1,.12),.29,.31)],5,'leather')
tube(weapon,[(tuple(bow_hand-Vector((0,.35,0))),.37,.40),(tuple(bow_hand+Vector((0,.32,0))),.35,.37)],4,'leather',(True,True),smooth=False)
tube(weapon,[((1.2,14.10,.05),.3,.33),(tuple(draw_hand),.27,.31)],4,'leather',(True,True),smooth=False)
# Recurved war bow. Its grip, string apex and arrow all share the same aiming plane.
bow_path=[(-5.20,3.70),(-3.70,4.00),(-1.75,5.02),(0,5.30),(1.75,5.02),(3.70,4.00),(5.20,3.70)]
rows=[((1.0,14.10+y,z),.14 if y else .22,.20 if y else .25) for y,z in bow_path]
tube(weapon,rows,4,'wood',(True,True),smooth=False)
for sign in [-1,1]:
    tip=(1.0,14.10+sign*5.20,3.70)
    tube(weapon,[(tip,.026,.026),(tuple(draw_hand),.026,.026)],3,'shaft',smooth=False)
weapon.vertices=[(x,y-12.3,z) for x,y,z in weapon.vertices]
objects.append(weapon.finish())

# Carried pose, shown unless attacking: arms down, the bow held at the left side.
carry=Part('carry',(0,0,0))
tube(carry,[((1.72,12.3,0),.54,.57),((2.2,10.35,.02),.43,.45),((2.12,8.75,.55),.3,.32)],5,['cloth','leather'])
tube(carry,[((2.12,8.75,.55),.33,.36),((2.1,8.3,.7),.3,.33)],4,'leather',(True,True),smooth=False)
tube(carry,[((-1.72,12.3,0),.54,.57),((-2.25,10.4,-.05),.43,.45),((-2.42,9.15,.72),.3,.32)],5,['cloth','leather'])
tube(carry,[((-2.42,9.3,.85),.35,.38),((-2.42,8.72,.85),.33,.36)],4,'leather',(True,True),smooth=False)
tube(carry,[((-2.42,9.0+y,.85+z),.14 if y else .22,.2 if y else .25) for y,z in [(-5.2,-1.2),(-2.6,-.45),(0,0),(2.6,-.45),(5.2,-1.2)]],4,'wood',(True,True),smooth=False)
tube(carry,[((-2.42,3.8,-.35),.026,.026),((-2.42,14.2,-.35),.026,.026)],3,'shaft',smooth=False)
objects.append(carry.finish())

# Nocked arrow is its own batch so only the arrow disappears after release.
nock=Part('nock',(0,12.3,0))
tube(nock,[((1.0,14.18,.42),.047,.047),((1.0,14.18,6.10),.047,.047)],4,'shaft',smooth=False)
base=[nock.vertex((1.0+x,14.18+y,6.10)) for x,y in [(-.14,0),(0,.10),(.14,0),(0,-.10)]]
tip=nock.vertex((1.0,14.18,6.55))
for i in range(4):nock.face([base[i],base[(i+1)%4],tip],'edge',normal=(0,0,1))
for sign in [-1,1]:
    nock.patch([(1.0,14.18,.65),(1.0,14.18,1.15),(1.0+sign*.23,14.18,1.15),(1.0+sign*.15,14.18,.65)],'feather',(0,1,0))
    nock.patch([(1.0,14.17,.65),(1.0,14.17,1.15),(1.0+sign*.23,14.17,1.15),(1.0+sign*.15,14.17,.65)],'feather',(0,-1,0))
nock.vertices=[(x,y-12.3,z) for x,y,z in nock.vertices]
objects.append(nock.finish())
# The archer shows either its aiming parts or its carrying ones, never both.
root['triangles']=sum(len(o.data.loop_triangles) for o in objects if o['tlb_role']!='carry')
print('TOTAL',root['triangles'],'/539')
assert root['triangles']<=539

world=bpy.data.worlds.new('TLB Archer Studio');scene.world=world;world.use_nodes=True
bg=next(n for n in world.node_tree.nodes if n.type=='BACKGROUND');bg.inputs['Color'].default_value=(.08,.11,.16,1);bg.inputs['Strength'].default_value=.65
for name,location,power,size in [('Key',(-9,-12,22),2500,9),('Fill',(9,-8,12),1400,8),('Rim',(2,8,20),2800,7)]:
    light=bpy.data.lights.new('Archer '+name,'AREA');light.energy=power;light.size=size
    obj=bpy.data.objects.new('Archer '+name,light);scene.collection.objects.link(obj);obj.location=location
    obj.rotation_euler=(Vector((0,-1,10))-obj.location).to_track_quat('-Z','Y').to_euler()
camdata=bpy.data.cameras.new('Archer Study Camera');cam=bpy.data.objects.new('Archer Study Camera',camdata);scene.collection.objects.link(cam)
cam.location=(28,-35,22);cam.rotation_euler=(Vector((0,-1.5,9))-cam.location).to_track_quat('-Z','Y').to_euler()
assert 'ORTHO' in [i.identifier for i in camdata.bl_rna.properties['type'].enum_items]
camdata.type='ORTHO';camdata.ortho_scale=23;scene.camera=cam
scene.render.resolution_x=1100;scene.render.resolution_y=1100;scene.render.resolution_percentage=100
for obj in bpy.context.selected_objects:obj.select_set(False)
for obj in objects:obj.select_set(True)
bpy.context.view_layer.objects.active=objects[0]
for area in bpy.context.screen.areas:
    if area.type=='VIEW_3D':
        area.spaces.active.region_3d.view_distance=29
        area.spaces.active.region_3d.view_location=(0,-1.5,9)
        area.spaces.active.region_3d.view_rotation=cam.rotation_euler.to_quaternion()
print('Archer scene ready; infantry scene preserved.')
