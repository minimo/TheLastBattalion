"""Author a armoured lancer and horse in Blender, within 744 triangles.
Game coordinates: X right, Y up, Z forward. Four existing pivots remain compatible.
Rebuilds only the generated study scene. The design does not import the previous model.
"""
import bpy, math
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parents[2]
scene=bpy.data.scenes.get('TLB Cavalry Study')
if scene is None:
    scene=bpy.data.scenes.new('TLB Cavalry Study');scene['tlb_generated']=True
else:
    assert scene.get('tlb_generated'), 'Unrelated scene'
    for obj in list(scene.objects): bpy.data.objects.remove(obj,do_unlink=True)
bpy.context.window.scene=scene
PALETTE={
    'coat':0x76503b, 'muzzle':0x46382e, 'mane':0x25282b, 'steel':0x627886, 'edge':0xb1c3cb, 'iron':0x344550,
    'cloth':0x263747, 'faction':0x6f9be8, 'leather':0x514032,
    'boot':0x292c30, 'gold':0xb29660, 'wood':0x58452f, 'dark':0x151e26,
}
def linear(v): return v/12.92 if v<=.04045 else ((v+.055)/1.055)**2.4
materials={}
for name,value in PALETTE.items():
    mat=bpy.data.materials.get('TLB Cavalry '+name) or bpy.data.materials.new('TLB Cavalry '+name)
    mat.use_nodes=True
    color=[linear((value>>shift&255)/255) for shift in [16,8,0]]
    if name=='faction': color=[c*.65 for c in color]
    mat.diffuse_color=(*color,1)
    shader=next(n for n in mat.node_tree.nodes if n.type=='BSDF_PRINCIPLED')
    shader.inputs['Base Color'].default_value=(*color,1)
    shader.inputs['Roughness'].default_value=.72;shader.inputs['Metallic'].default_value=.12
    mat['tlb_palette']=name;materials[name]=mat

def xyz(p): return (p[0],-p[2],p[1])
root=bpy.data.objects.new('Cavalry Refined',None);scene.collection.objects.link(root)
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
        mesh=bpy.data.meshes.new('Cavalry '+self.role)
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
# Horse barrel and haunches: longitudinal sections, with a tapered chest and croup.
tube(body,[((0,9.55,-5.0),1.45,1.75),((0,10.0,-3.5),2.22,2.44),((0,10.0,.4),2.30,2.48),((0,10.1,3.8),1.80,2.32)],6,'coat',(True,True))
# Upright neck sweeps forward into a sloping forehead and a narrower muzzle.
tube(body,[((0,10.4,3.35),1.35,1.75),((0,13.0,4.75),1.04,1.42),((0,15.15,5.35),.77,1.0)],6,'coat',(False,True))
tube(body,[((0,15.3,5.55),.83,1.02),((0,14.85,6.65),.80,.86),((0,13.65,8.25),.66,.65)],6,['coat','coat'],(True,True),smooth=False)
tube(body,[((0,13.90,7.9),.69,.69),((0,13.47,8.53),.64,.52)],6,'muzzle',(False,True))
for sign in [-1,1]:
    v=[body.vertex(p) for p in [(sign*.40,15.75,5.30),(sign*.81,15.75,5.25),(sign*.63,15.85,5.92),(sign*.69,17.0,5.40)]]
    for f in [(0,2,1),(0,1,3),(1,2,3),(2,0,3)]:body.face([v[i] for i in f],'coat')
    body.patch([(sign*.77,15.25,6.15),(sign*.77,15.16,6.61),(sign*.79,15.42,6.40)],'dark',(sign,0,0))
    body.patch([(sign*.62,13.78,8.12),(sign*.62,13.55,8.42),(sign*.65,13.88,8.40)],'dark',(sign,0,0))
# Low black mane along the rear neck, plus a tapered tail.
for a,b in [((14.9,4.43),(13.2,3.62)),((13.2,3.62),(11.5,2.45))]:
    for sign in [-1,1]:
        body.patch([(sign*.15,a[0],a[1]),(sign*.15,b[0],b[1]),(sign*.15,b[0]-.05,b[1]-.50),(sign*.15,a[0]+.12,a[1]-.40)],'mane',(sign,0,0))
tube(body,[((0,10.65,-4.90),.41,.44),((0,8.2,-6.05),.50,.47),((0,5.0,-6.55),.18,.22)],4,'mane',(False,True))
# Split caparison panels leave the horse's anatomy and lower legs readable.
for sign in [-1,1]:
    panels=[[(sign*2.52,11.2,-3.5),(sign*2.56,11.2,.5),(sign*2.56,8.1,.5),(sign*2.52,7.6,-3.4)],[(sign*2.56,11.2,.5),(sign*2.40,11.2,2.75),(sign*2.43,8.0,2.5),(sign*2.56,8.1,.5)]]
    for pts in panels:
        body.patch(pts,'faction',(sign,0,0))
        body.patch([(x-sign*.04,y,z) for x,y,z in pts],'cloth',(-sign,0,0))
    body.patch([(sign*2.60,9.85,-2.6),(sign*2.60,10.5,-1.5),(sign*2.60,9.85,-.4),(sign*2.60,8.6,-1.5)],'edge',(sign,0,0))
# Raised saddle, cantle and leather girth.
body.box((0,12.36,-.55),(2.9,.48,3.1),'leather')
body.box((0,12.86,-1.96),(2.85,.75,.37),'leather')
for sign in [-1,1]:
    body.patch([(sign*2.64,11.0,-.4),(sign*2.64,11.0,.05),(sign*2.64,7.9,.05),(sign*2.64,7.9,-.4)],'leather',(sign,0,0))
# Rider sits astride the saddle, knees bent forward and boots below the hips.
for sign in [-1,1]:
    tube(body,[((sign*.95,13.1,-.55),.63,.66),((sign*2.65,11.8,1.05),.59,.62),((sign*2.65,9.80,.43),.38,.43)],5,['cloth','steel'])
    body.box((sign*2.66,9.35,.92),(.86,.65,1.55),'boot')
    # Stirrups and their leather hangers are narrow, double-sided strips.
    for mat,pts in [('leather',[(sign*2.86,12.25,-.50),(sign*2.86,12.25,-.28),(sign*2.99,9.1,.45),(sign*2.99,9.1,.23)]),('iron',[(sign*2.18,9.0,.48),(sign*3.08,9.0,.48),(sign*3.08,9.0,1.18),(sign*2.18,9.0,1.18)])]:
        body.patch(pts,mat,(0,1,0) if mat=='iron' else (sign,0,0))
        body.patch(pts,mat,(0,-1,0) if mat=='iron' else (-sign,0,0))
body.rings([(12.85,1.38,.90,0,-.55),(15.35,1.80,1.18,0,-.35),(17.75,1.55,.91,0,-.35)],6,'steel',(False,True),smooth=False,phase=0)
body.rings([(12.75,1.42,.93,0,-.55),(13.10,1.42,.93,0,-.55)],6,'leather',smooth=False)
body.rings([(17.55,.77,.69,0,-.35),(18.65,.57,.56,0,-.35)],6,'iron')
# Angular closed helm in the infantry's visual language.
body.rings([(18.65,.86,.90,0,-.35),(20.2,1.03,1.01,0,-.35),(21.0,.30,.40,0,-.48)],8,'steel',(False,True),smooth=False)
plate(body,[(-.85,19.74,.57),(0,19.8,.88),(.85,19.74,.57),(.57,18.65,.50),(0,18.48,.75),(-.57,18.65,.50)],(0,19.2,1.03),'iron')
for sign in [-1,1]:
    body.patch([(0,19.82,.90),(sign*.91,19.77,.60),(sign*.91,19.97,.60),(0,20.03,.91)],'dark')
    body.patch([(0,20.03,.93),(sign*.94,19.97,.62),(sign*.85,20.15,.61),(0,20.24,.89)],'edge')
    body.rings([(16.65,.76,.95,sign*2.02,-.32),(17.35,.95,1.09,sign*1.97,-.34),(17.9,.35,.52,sign*1.83,-.37)],5,['iron','steel'],(False,True),smooth=False)
# Small swept plume: a clear cavalry silhouette without a separate animation batch.
tube(body,[((0,20.85,-.50),.23,.24),((0,21.65,-.95),.45,.55),((0,21.0,-2.0),.12,.25)],4,'faction',(False,True),smooth=False)
# Left arm holds both reins above the withers.
tube(body,[((-2.27,17.0,-.20),.52,.55),((-2.55,15.05,.55),.43,.46),((-1.05,14.95,2.10),.32,.35)],5,['cloth','steel'])
body.box((-1.0,14.95,2.12),(.72,.65,.77),'leather')
for sign in [-1,1]:
    tube(body,[((-1.0,14.95,2.12),.04,.04),((sign*1.3,13.6,4.4),.04,.04),((sign*.75,13.95,8.12),.04,.04)],3,'leather',smooth=False)
    body.patch([(sign*.83,15.0,6.40),(sign*.85,14.86,6.40),(sign*.73,13.82,8.20),(sign*.73,14.02,8.20)],'leather',(sign,0,0))
objects=[body.finish()]
# Each front/rear pair keeps the existing single pivot and stride animation.
for role,z in [('mountFront',3.8),('mountBack',-3.9)]:
    legs=Part(role,(0,8.2,z))
    for sign in [-1,1]:
        if role=='mountFront':rows=[((sign*1.3,1.7,-.25),.56,.65),((sign*1.4,-3.3,-.12),.34,.39),((sign*1.4,-6.6,.03),.25,.30)]
        else:rows=[((sign*1.3,1.7,.25),.65,.75),((sign*1.4,-3.1,1.05),.43,.47),((sign*1.4,-5.35,-.40),.26,.32),((sign*1.4,-6.6,-.12),.24,.28)]
        tube(legs,rows,4,'coat',smooth=True)
        legs.rings([(-8.0,.44,.67,sign*1.4,.22),(-7.35,.47,.68,sign*1.4,.20),(-6.5,.27,.33,sign*1.4,0)],4,['boot','coat'],(True,False),smooth=False)
    objects.append(legs.finish())
weapon=Part('weapon',(2.5,17.2,0))
# Bent elbow and a lance gripped under the arm, clear of the horse's neck.
tube(weapon,[((-.18,-.12,-.25),.53,.56),((.42,-1.95,-.35),.43,.48),((.35,-2.0,1.72),.34,.38)],5,['cloth','steel'])
hand=Vector((.35,-2.0,2.0));axis=Vector((0,.12,1)).normalized()
def lance(z):return tuple(hand+axis*z)
tube(weapon,[(lance(-.35),.42,.44),(lance(.42),.43,.44)],5,'iron',(True,True),smooth=False)
tube(weapon,[(lance(-6.8),.23,.23),(lance(12.5),.13,.13)],6,'wood',(True,False),smooth=False)
tube(weapon,[(lance(.48),.62,.62),(lance(1.07),.25,.25)],6,'steel',(True,False),smooth=False)
# Diamond section lance head.
center=Vector(lance(12.4));u=Vector((1,0,0));v=axis.cross(u)
base=[weapon.vertex(tuple(center+u*x+v*y)) for x,y in [(0,.13),(.32,0),(0,-.13),(-.32,0)]]
tip=weapon.vertex(lance(14.4))
for i in range(4):weapon.face([base[i],base[(i+1)%4],tip],'edge',normal=axis)
# Forked pennant, thin and double-sided, attached behind the spearhead.
pts=[lance(10.3),lance(12.2),tuple(Vector(lance(11.8))+Vector((0,-1.5,0))),tuple(Vector(lance(10.9))+Vector((0,-.82,0))),tuple(Vector(lance(10.0))+Vector((0,-1.5,0)))]
weapon.patch(pts,'faction',(1,0,0));weapon.patch(pts,'faction',(-1,0,0))
objects.append(weapon.finish())
root['triangles']=sum(len(o.data.loop_triangles) for o in objects)
print('TOTAL',root['triangles'],'/744')
assert root['triangles']<=744

world=bpy.data.worlds.new('TLB Cavalry Studio');scene.world=world;world.use_nodes=True
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
cam.location=(33,-42,27);cam.rotation_euler=(Vector((0,-2.5,11))-cam.location).to_track_quat('-Z','Y').to_euler()
enum(camdata,'type','ORTHO');camdata.ortho_scale=30;scene.camera=cam
scene.render.resolution_x=1100;scene.render.resolution_y=1100;scene.render.resolution_percentage=100
for obj in bpy.context.selected_objects:obj.select_set(False)
for obj in objects:obj.select_set(True)
bpy.context.view_layer.objects.active=objects[0]
for area in bpy.context.screen.areas:
    if area.type=='VIEW_3D':
        area.spaces.active.region_3d.view_distance=37
        area.spaces.active.region_3d.view_location=(0,-2.5,11)
        area.spaces.active.region_3d.view_rotation=cam.rotation_euler.to_quaternion()
        enum(area.spaces.active.shading,'type','MATERIAL')
print('Cavalry design ready; earlier scenes preserved.')
