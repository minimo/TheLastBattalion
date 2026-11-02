"""Author a new sword-and-shield infantry design in Blender, within 708 triangles.
Game coordinates: X right, Y up, Z forward. Four existing pivots remain compatible.
Rebuilds only the generated study scene. The design does not import the previous model.
"""
import bpy, math
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parents[2]
scene=bpy.data.scenes.get('TLB Infantry Study')
if scene is None:
    scene=bpy.data.scenes.new('TLB Infantry Study');scene['tlb_generated']=True
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
    mat=bpy.data.materials.get('TLB Infantry '+name) or bpy.data.materials.new('TLB Infantry '+name)
    mat.use_nodes=True
    color=[linear((value>>shift&255)/255) for shift in [16,8,0]]
    if name=='faction': color=[c*.65 for c in color]
    mat.diffuse_color=(*color,1)
    shader=next(n for n in mat.node_tree.nodes if n.type=='BSDF_PRINCIPLED')
    shader.inputs['Base Color'].default_value=(*color,1)
    shader.inputs['Roughness'].default_value=.72;shader.inputs['Metallic'].default_value=.12
    mat['tlb_palette']=name;materials[name]=mat

def xyz(p): return (p[0],-p[2],p[1])
root=bpy.data.objects.new('Infantry Refined',None);scene.collection.objects.link(root)
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
        mesh=bpy.data.meshes.new('Infantry '+self.role)
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
body.rings([(13.95,.90,1.00,0,-.10),(15.45,1.06,1.04,0,-.10),(16.25,.34,.48,0,-.19)],8,'steel',(False,True),smooth=False)
# Visor's centre ridge, tapered jaw and narrow dark sight line.
plate(body,[(-.91,14.91,.91),(0,14.95,1.20),(.91,14.91,.91),(.62,13.92,.79),(0,13.68,1.00),(-.62,13.92,.79)],(0,14.40,1.36),'iron')
for sign in [-1,1]:
    body.patch([(0,14.97,1.23),(sign*.94,14.94,.94),(sign*.94,15.13,.95),(0,15.15,1.24)],'dark')
    body.patch([(0,15.15,1.25),(sign*.96,15.13,.96),(sign*.90,15.32,.94),(0,15.35,1.22)],'edge')
    body.patch([(sign*.14,14.15,1.25),(sign*.61,14.24,1.03),(sign*.58,14.32,1.04),(sign*.14,14.23,1.28)],'dark')
# Swept back lower helmet, cut from the rear half only.
body.patch([(-.84,14.65,-.80),(.84,14.65,-.80),(.93,13.92,-1.37),(-.93,13.92,-1.37)],'iron',(0,0,-1))
# Shield-side shoulder armour is broader; sword-side shoulder leaves room to lift the arm.
body.rings([(11.65,.93,1.08,-2.20,.13),(12.35,1.15,1.24,-2.12,.08),(13.0,.56,.75,-1.96,-.02)],8,['iron','steel'],(False,True),smooth=False)
body.rings([(11.75,.74,.94,2.24,-.07),(12.45,.89,1.05,2.12,-.08),(12.86,.40,.63,1.98,-.10)],8,['iron','steel'],(False,True),smooth=False)
# Bent shield arm: upper arm down, forearm across the torso, hand behind the shield.
tube(body,[((-2.60,12,.05),.60,.61),((-2.85,10.45,.42),.51,.53),((-1.95,10.65,1.65),.40,.44)],5,['cloth','steel'])
tube(body,[((-2.0,10.62,1.55),.40,.43),((-1.80,10.68,1.95),.43,.46)],4,'leather',(True,True),smooth=False)
# Broad heater shield held forward, turned toward the protected side.
outline=[(-1.68,1.85),(1.68,1.85),(1.47,-.50),(0,-2.65),(-1.47,-.50)]
center=Vector((-2.55,10.25,2.05));side=Vector((.973,0,.23));normal=Vector((-.23,0,.973))
def shield_point(x,y,depth): return tuple(center+side*x+Vector((0,y,0))+normal*depth)
outer=[body.vertex(shield_point(x,y,0)) for x,y in outline]
inner=[body.vertex(shield_point(x*.88,y*.90,.15)) for x,y in outline]
back=[body.vertex(shield_point(x,y,-.22)) for x,y in outline]
mid=body.vertex(shield_point(0,0,.43))
for i in range(5):
    k=(i+1)%5
    body.face([outer[i],outer[k],inner[k],inner[i]],'gold',normal=normal)
    body.face([inner[i],inner[k],mid],'faction',normal=normal)
    body.face([outer[i],back[i],back[k],outer[k]],'iron',normal=side*(outline[i][0]+outline[k][0])+Vector((0,outline[i][1]+outline[k][1],0)))
body.face(back,'wood',normal=-normal)
# An angular falcon device follows the convex shield face.
for points,material in [([(-.95,.45),(-.20,.16),(0,-.42),(.20,.16),(.95,.45),(.51,-.20),(0,-1.00),(-.51,-.20)],'edge'), ([(-.18,.65),(0,.94),(.18,.65),(0,.39)],'gold')]:
    body.patch([shield_point(x,y,.455-abs(y)*.06) for x,y in points],material,normal)
# Short asymmetric mantle, fully double-sided without extra materials/draw calls.
rows=[ [(-1.95,12.8,-1.20),(0,12.95,-1.42),(1.25,12.6,-1.26)],
       [(-2.25,10.4,-1.57),(-.3,10.4,-1.72),(1.25,10.5,-1.43)],
       [(-2.5,7.1,-1.95),(-.5,6.65,-2.02),(1.0,7.65,-1.70)] ]
for j in range(2):
    for i in range(2):
        points=[rows[j][i],rows[j][i+1],rows[j+1][i+1],rows[j+1][i]]
        body.patch([(x,y,z-.04) for x,y,z in points],'cloth',(0,0,-1))
        body.patch([(x,y,z+.04) for x,y,z in points],'cloth',(0,0,1))
objects=[body.finish()]
for role,sign in [('legL',-1),('legR',1)]:
    leg=Part(role,(sign*1.12,7.8,0))
    advance=.42 if sign<0 else -.30
    leg.rings([(-6.5,.39,.48,sign*.16,advance),(-5.0,.56,.63,sign*.13,advance),(-3.45,.55,.60,sign*.08,.28),(-1.75,.71,.76,0,.08),(0,.63,.65,0,0)],6,['steel','steel','cloth','cloth'])
    plate(leg,[(-.44,-3.12,.80),(.44,-3.12,.80),(.51,-3.55,.81),(.28,-3.94,.80),(-.28,-3.94,.80),(-.51,-3.55,.81)],(0,-3.5,1.0),'iron')
    leg.rings([(-7.58,.58,1.04,sign*.17,.40+advance),(-7.03,.63,1.12,sign*.17,.40+advance),(-6.25,.42,.52,sign*.15,advance)],6,'boot',(True,True),smooth=False)
    objects.append(leg.finish())
weapon=Part('weapon',(2.65,12,0))
# The elbow is below the shoulder; the forearm reaches forward into a closed fist.
elbow=Vector((.53,-1.9,-.23));wrist=Vector((.42,-1.56,1.47));hand=Vector((.40,-1.36,1.99))
tube(weapon,[((0,-.05,0),.57,.59),(tuple(elbow),.48,.50),(tuple(wrist),.36,.40)],6,['cloth','steel'])
# Sword-local frame: one axis shared by grip, glove, guard and blade.
a=Vector((.30,.91,.28)).normalized();b=Vector((1,0,0));b=(b-a*b.dot(a)).normalized();c=b.cross(a)
def sword_point(x,y,z): return tuple(hand+b*x+a*y+c*z)
# Compact grip: the entire middle of the handle is enclosed by the fist.
tube(weapon,[(sword_point(0,-.65,0),.18,.18),(sword_point(0,.63,0),.18,.18)],6,'leather')
loops=[]
for y,rx,rz in [(-.38,.38,.43),(.30,.43,.46)]:
    loops.append([weapon.vertex(sword_point(rx*math.sin((i+.5)*math.pi/3),y,rz*math.cos((i+.5)*math.pi/3))) for i in range(6)])
for i in range(6):
    k=(i+1)%6;weapon.face([loops[0][i],loops[0][k],loops[1][k],loops[1][i]],'iron')
weapon.face(reversed(loops[0]),'leather');weapon.face(loops[1],'iron')
# Thumb crossing the grip is visible beside the knuckles.
weapon.patch([sword_point(-.38,-.08,.20),sword_point(-.28,.38,.28),sword_point(.12,.27,.45),sword_point(.04,.06,.49)],'edge',c)
# Swept crossguard, shaped in the sword frame rather than detached from the wrist.
coords=[(-1.05,.55,-.15),(1.05,.55,-.15),(1.05,.75,-.15),(-1.05,.75,-.15),(-1.05,.55,.15),(1.05,.55,.15),(1.05,.75,.15),(-1.05,.75,.15)]
v=[weapon.vertex(sword_point(*p)) for p in coords]
for f in [(0,3,2,1),(4,5,6,7),(0,1,5,4),(3,7,6,2),(0,4,7,3),(1,2,6,5)]:weapon.face([v[i] for i in f],'gold')
# Small wheel-like pommel; the grip ends just below the hand.
tube(weapon,[(sword_point(0,-.90,0),.25,.25),(sword_point(0,-.62,0),.25,.25)],4,'gold',(True,True),smooth=False)
# Diamond section blade, broad at the root and tapering toward the point.
loops=[]
for y,w in [(.77,.36),(6.1,.23)]:loops.append([weapon.vertex(sword_point(dx*w,y,dz*.11)) for dx,dz in [(0,1),(1,0),(0,-1),(-1,0)]])
for i in range(4):
    k=(i+1)%4;weapon.face([loops[0][i],loops[0][k],loops[1][k],loops[1][i]],'edge')
tip=weapon.vertex(sword_point(0,6.95,0))
for i in range(4):weapon.face([loops[1][i],loops[1][(i+1)%4],tip],'edge')
objects.append(weapon.finish())
root['triangles']=sum(len(o.data.loop_triangles) for o in objects)
print('TOTAL',root['triangles'],'/708')
assert root['triangles']<=708

world=bpy.data.worlds.new('TLB Infantry Studio');scene.world=world;world.use_nodes=True
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
cam.location=(23,-42,22);cam.rotation_euler=(Vector((0,0,8))-cam.location).to_track_quat('-Z','Y').to_euler()
enum(camdata,'type','ORTHO');camdata.ortho_scale=21;scene.camera=cam
scene.render.resolution_x=1100;scene.render.resolution_y=1100;scene.render.resolution_percentage=100
for obj in bpy.context.selected_objects:obj.select_set(False)
for obj in objects:obj.select_set(True)
bpy.context.view_layer.objects.active=objects[0]
for area in bpy.context.screen.areas:
    if area.type=='VIEW_3D':
        area.spaces.active.region_3d.view_distance=26
        area.spaces.active.region_3d.view_location=(0,0,8)
        area.spaces.active.region_3d.view_rotation=cam.rotation_euler.to_quaternion()
        enum(area.spaces.active.shading,'type','MATERIAL')
print('New infantry design ready.')
