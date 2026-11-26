"""
Bump Stop's three trucks, built by script (plan PR 5). No Blender UI needed.

Run it with the Blender Python module (`pip install bpy==5.1.2`):

    python scripts/blender/make-trucks.py

or with Blender itself:

    blender --background --python scripts/blender/make-trucks.py

It writes public/models/truck-light4x4.glb, truck-heavy.glb and truck-sxs.glb.
Commit those files: the game loads them, and the build never runs Blender.

All three trucks are made from one shared kit of parts (wheels, shocks,
springs, arms, axles, tubes, lamps) with each class's own body on top. The
game moves the parts itself (src/render/truckModel.ts), so every moving part
is its own named node:

    Body                 everything the springs hold up (cab, frame, cage)
      MountTop_FL ...    where each shock bolts to the body (an empty)
      Arm_FL ...         side-by-side only: arms that swing from the body
    Hub_FL ...           each wheel's upright: moves up and down
      Wheel_FL ...       the wheel and tire: spins
      MountLow_FL ...    where the shock bolts to the axle or arm (an empty)
      ArmEnd_FL ...      side-by-side only: where the arm meets the upright
    Axle_F, Axle_R       light 4x4 and heavy truck: the solid axle beams
    ShockBody_FL ...     the shock's body, from the top mount downwards
    ShockShaft_FL ...    the shock's shaft, from the bottom mount upwards
    Spring_FL ...        the coil spring, from the top mount, squashed to fit

Corners: FL front left, FR front right, RL rear left, RR rear right.

Coordinates (Blender): X forward, Y left, Z up, metres. The origin is on the
ground under the centre of mass, at rest. The wheel positions match the test
mules in src/data/ride.ts (cgToFront, cgToRear, track); tests/models.test.ts
checks that. glTF turns this into three.js's Y up: X forward, Y up, Z right.

No real brands, logos or people: plain fictional trucks.
"""

import math
import os
import sys

import bpy  # first: the bmesh module comes with it
import bmesh
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = os.path.normpath(os.path.join(HERE, '..', '..', 'public', 'models'))

CORNERS = ['FL', 'FR', 'RL', 'RR']


# --- Colours ----------------------------------------------------------------
# Hex as on screen (sRGB). Blender and glTF want linear numbers, so we convert.

def srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hex_rgba(h):
    h = h.lstrip('#')
    return tuple(srgb_to_linear(int(h[i:i + 2], 16) / 255) for i in (0, 2, 4)) + (1.0,)


# The kit's shared materials. Magenta springs are Bump Stop's signature
# (the game's highlighter colour); graphite and birch-white come from the
# roadbook palette. name: (colour, metallic, roughness, glow)
KIT_MATERIALS = {
    'Graphite': ('#25272B', 0.1, 0.65, 0),
    'Rubber': ('#1B1C1E', 0.0, 0.92, 0),
    'Steel': ('#8E949B', 0.75, 0.42, 0),
    'Chrome': ('#D6DADF', 0.95, 0.18, 0),
    'Glass': ('#24303A', 0.2, 0.12, 0),
    'Lamp': ('#FFF4D6', 0.0, 0.3, 2.0),
    'Board': ('#FBFAF5', 0.0, 0.7, 0),
    'Magenta': ('#FF4FB2', 0.05, 0.45, 0),
    'Seat': ('#3A3B41', 0.0, 0.85, 0),
    'Amber': ('#F0AE45', 0.0, 0.4, 0.6),
}


def make_material(name, colour, metallic, roughness, glow):
    mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get('Principled BSDF')
    rgba = hex_rgba(colour)
    bsdf.inputs['Base Color'].default_value = rgba
    bsdf.inputs['Metallic'].default_value = metallic
    bsdf.inputs['Roughness'].default_value = roughness
    if glow > 0:
        bsdf.inputs['Emission Color'].default_value = rgba
        bsdf.inputs['Emission Strength'].default_value = glow
    return mat


# --- A tiny mesh builder ------------------------------------------------------
# Each moving node is one mesh built from many simple shapes, so a truck is
# only a few dozen draw calls on a phone.

class Part:
    def __init__(self, name):
        self.name = name
        self.bm = bmesh.new()
        self.mats = []

    def mat(self, name):
        if name not in self.mats:
            self.mats.append(name)
        return self.mats.index(name)

    def _paint(self, verts, mat, smooth=False):
        mi = self.mat(mat)
        faces = {f for v in verts for f in v.link_faces}
        for f in faces:
            f.material_index = mi
            f.smooth = smooth

    def box(self, centre, size, mat, rot=None):
        """A box: centre (x, y, z), size (x, y, z), optional rotation matrix."""
        m = Matrix.Translation(Vector(centre))
        if rot is not None:
            m = m @ rot.to_4x4()
        m = m @ Matrix.Diagonal(Vector((*size, 1.0)))
        out = bmesh.ops.create_cube(self.bm, size=1.0, matrix=m)
        self._paint(out['verts'], mat)

    def hull(self, bottom, top, mat):
        """A six-sided block from four bottom and four top corners, each listed
        front-left, front-right, back-right, back-left (seen from above)."""
        bm = self.bm
        vb = [bm.verts.new(p) for p in bottom]
        vt = [bm.verts.new(p) for p in top]
        faces = [vb[::-1], vt]
        for i in range(4):
            j = (i + 1) % 4
            faces.append([vb[i], vb[j], vt[j], vt[i]])
        for f in faces:
            face = bm.faces.new(f)
            face.material_index = self.mat(mat)
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces[-6:])

    def tube(self, a, b, r, mat, segments=8, smooth=True):
        """A round bar from point a to point b."""
        a, b = Vector(a), Vector(b)
        d = b - a
        length = d.length
        rot = Vector((0, 0, 1)).rotation_difference(d.normalized()).to_matrix().to_4x4()
        m = Matrix.Translation((a + b) / 2) @ rot
        out = bmesh.ops.create_cone(self.bm, cap_ends=True, segments=segments, radius1=r, radius2=r,
                                    depth=length, matrix=m)
        self._paint(out['verts'], mat, smooth)

    def lathe(self, profile, mat, segments=28, centre=(0, 0, 0), smooth=True, closed=True):
        """Spin a profile of (radius, y) points round the Y axis (left-right):
        tires, rims and hubs. Point order runs from the inner side outwards."""
        bm = self.bm
        cx, cy, cz = centre
        rings = []
        for (r, y) in profile:
            ring = []
            for k in range(segments):
                ang = 2 * math.pi * k / segments
                ring.append(bm.verts.new((cx + r * math.cos(ang), cy + y, cz + r * math.sin(ang))))
            rings.append(ring)
        mi = self.mat(mat)
        new_faces = []
        for i in range(len(rings) - 1):
            for k in range(segments):
                k2 = (k + 1) % segments
                f = bm.faces.new([rings[i][k], rings[i][k2], rings[i + 1][k2], rings[i + 1][k]])
                new_faces.append(f)
        if closed:
            for ring in (rings[0], rings[-1]):
                if profile[rings.index(ring)][0] > 1e-4:
                    new_faces.append(bm.faces.new(ring))
        for f in new_faces:
            f.material_index = mi
            f.smooth = smooth
        bmesh.ops.recalc_face_normals(bm, faces=new_faces)

    def helix(self, top, length, radius, wire, turns, mat, steps=14, sides=6):
        """A coil spring hanging down from `top` along -Z."""
        bm = self.bm
        tx, ty, tz = top
        n = int(turns * steps)
        rings = []
        for i in range(n + 1):
            u = i / n
            ang = 2 * math.pi * turns * u
            centre = Vector((tx + radius * math.cos(ang), ty + radius * math.sin(ang), tz - length * u))
            # Ring around the wire: in the plane of the radial direction and Z.
            radial = Vector((math.cos(ang), math.sin(ang), 0))
            up = Vector((0, 0, 1))
            ring = []
            for s in range(sides):
                a = 2 * math.pi * s / sides
                ring.append(bm.verts.new(centre + wire * (math.cos(a) * radial + math.sin(a) * up)))
            rings.append(ring)
        mi = self.mat(mat)
        faces = []
        for i in range(n):
            for s in range(sides):
                s2 = (s + 1) % sides
                faces.append(bm.faces.new([rings[i][s], rings[i][s2], rings[i + 1][s2], rings[i + 1][s]]))
        for f in faces:
            f.material_index = mi
            f.smooth = True
        bmesh.ops.recalc_face_normals(bm, faces=faces)

    def finish(self, materials):
        mesh = bpy.data.meshes.new(self.name)
        bmesh.ops.remove_doubles(self.bm, verts=self.bm.verts, dist=1e-5)
        self.bm.to_mesh(mesh)
        self.bm.free()
        for name in self.mats:
            mesh.materials.append(materials[name])
        obj = bpy.data.objects.new(self.name, mesh)
        bpy.context.scene.collection.objects.link(obj)
        return obj


def empty(name, parent, loc):
    obj = bpy.data.objects.new(name, None)
    bpy.context.scene.collection.objects.link(obj)
    obj.empty_display_size = 0.05
    if parent is not None:
        obj.parent = parent
    obj.location = loc
    return obj


def place(obj, parent, loc):
    """Put obj at loc in its parent's space (no hidden parent offset)."""
    if parent is not None:
        obj.parent = parent
        obj.matrix_parent_inverse = Matrix.Identity(4)
    obj.location = loc
    return obj


# --- The trucks -------------------------------------------------------------
# Wheelbase and track match TEST_MULES in src/data/ride.ts. `radius` and
# `tire` are the tire's size; `paint` and `trim` the class's colours.

TRUCKS = {
    'light4x4': dict(cg_front=1.3, cg_rear=1.5, track=1.65, radius=0.40, tire=0.30,
                     front='axle', rear='axle', paint='#ECE8DC', trim='#25272B'),
    'heavy': dict(cg_front=2.1, cg_rear=1.9, track=2.1, radius=0.62, tire=0.42,
                  front='axle', rear='axle', paint='#5A6E80', trim='#ECE8DC'),
    'sxs': dict(cg_front=1.15, cg_rear=1.2, track=1.6, radius=0.37, tire=0.27,
                front='arms', rear='trailing', paint='#F4F1E8', trim='#25272B'),
}


def corner_pos(t, c):
    x = t['cg_front'] if c[0] == 'F' else -t['cg_rear']
    y = t['track'] / 2 if c[1] == 'L' else -t['track'] / 2
    return x, y


def wheel(name, t):
    """One wheel and tire, centred on the origin, axle along Y, outer face at +Y."""
    r, w = t['radius'], t['tire']
    p = Part(name)
    # The tire: a rounded rubber ring, inner side (-Y) to outer side (+Y).
    rim_r = r * 0.58
    p.lathe([(rim_r, -w * 0.46), (r * 0.9, -w * 0.5), (r * 0.98, -w * 0.42), (r, -w * 0.25),
             (r, w * 0.25), (r * 0.98, w * 0.42), (r * 0.9, w * 0.5), (rim_r, w * 0.46)],
            'Rubber', segments=32, closed=False)
    # Tread blocks, so the wheel is seen to turn.
    lugs = 18
    for k in range(lugs):
        a = 2 * math.pi * (k + 0.5) / lugs
        rot = Matrix.Rotation(-a, 3, 'Y')
        for side in (-1, 1):
            off = side * w * 0.2 + (w * 0.06 if k % 2 else -w * 0.06)
            c = Vector((r * math.cos(a), off, r * math.sin(a)))
            p.box(c, (r * 0.07, w * 0.28, r * 0.16), 'Rubber', rot=rot)
    # The rim: a dish with a hub, in the class's trim colour.
    p.lathe([(rim_r, -w * 0.44), (rim_r, w * 0.38), (rim_r * 0.92, w * 0.38), (rim_r * 0.4, w * 0.3),
             (rim_r * 0.32, w * 0.42), (0.0, w * 0.42)], 'Trim', segments=24, closed=True)
    # Five spokes across the dish make the turning easy to see.
    for k in range(5):
        a = 2 * math.pi * k / 5
        c = Vector((rim_r * 0.66 * math.cos(a), w * 0.38, rim_r * 0.66 * math.sin(a)))
        p.box(c, (rim_r * 0.5, w * 0.06, rim_r * 0.16), 'Steel', rot=Matrix.Rotation(-a, 3, 'Y'))
    # The inner side gets a dark disc so you can't see through the wheel.
    p.lathe([(0.0, -w * 0.3), (rim_r, -w * 0.3)], 'Graphite', segments=24, closed=False)
    return p


def shock_parts(name_c, t, length, scale):
    """The shock's body (hangs down from its top eye) and shaft (stands up from
    its bottom eye), plus the coil spring around it. Lengths in metres at rest."""
    body_len = length * 0.62
    shaft_len = length * 0.62
    br = 0.032 * scale
    body = Part('ShockBody_' + name_c)
    body.tube((0, 0, 0), (0, 0, -body_len), br, 'Graphite', segments=12)
    body.tube((0, 0, 0.02 * scale), (0, 0, -0.02 * scale), br * 0.8, 'Steel', segments=10)
    # A remote reservoir clamped on the side, and the oil cap ring.
    body.tube((br * 1.9, 0, -body_len * 0.1), (br * 1.9, 0, -body_len * 0.65), br * 0.7, 'Graphite', segments=10)
    body.tube((0, 0, -body_len * 0.88), (0, 0, -body_len), br * 1.12, 'Steel', segments=12)
    shaft = Part('ShockShaft_' + name_c)
    shaft.tube((0, 0, 0), (0, 0, shaft_len), br * 0.45, 'Chrome', segments=10)
    shaft.tube((0, 0, -0.02 * scale), (0, 0, 0.03 * scale), br * 0.9, 'Steel', segments=10)
    spring = Part('Spring_' + name_c)
    spring.helix((0, 0, -length * 0.06), length * 0.84, br * 1.75, 0.011 * scale, 7, 'Magenta')
    return body, shaft, spring


def build_truck(cls, t, materials):
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    for mesh in list(bpy.data.meshes):
        bpy.data.meshes.remove(mesh)

    r = t['radius']
    scale = r / 0.4  # parts sized for the light 4x4, scaled for the others
    body_obj = empty('Body', None, (0, 0, 0))
    body = Part('BodyShell')

    if cls == 'light4x4':
        pickup(body, t)
    elif cls == 'heavy':
        cabover(body, t)
    else:
        buggy(body, t)

    for c in CORNERS:
        x, y = corner_pos(t, c)
        side = 1 if c[1] == 'L' else -1
        end = 'front' if c[0] == 'F' else 'rear'
        kind = t[end]

        hub = empty('Hub_' + c, None, (x, y, r))
        wh = wheel('Wheel_' + c, t).finish(materials)
        place(wh, hub, (0, 0, 0))
        if side < 0:
            wh.rotation_euler = (0, 0, math.pi)
        # The upright / knuckle behind the wheel, part of the hub.
        up = Part('Upright_' + c)
        inner = -side * t['tire'] * 0.55
        up.box((0, inner, 0), (0.08 * scale, 0.06 * scale, r * 0.75), 'Graphite')
        up_obj = up.finish(materials)
        place(up_obj, hub, (0, 0, 0))

        # Shock mounts: on the hub just inboard of the wheel, and up on the body.
        inboard = t['tire'] * 0.75 + 0.05 * scale
        low_local = (0.0 if kind != 'trailing' else -0.06 * scale, -side * inboard, -0.02 * scale)
        if kind == 'arms':
            # Long-travel shocks stand tall and lean in, so they poke up through the bonnet like a real one's.
            top_world = (x - 0.05 * scale, side * (t['track'] / 2 - inboard - 0.32 * scale), r + 0.95 * scale)
        elif kind == 'trailing':
            top_world = (x + 0.1 * scale, side * (t['track'] / 2 - inboard - 0.27 * scale), r + 0.95 * scale)
        else:
            top_world = (x + (0.08 if end == 'front' else -0.08) * scale, side * (t['track'] / 2 - inboard),
                         r + 0.58 * scale)
        empty('MountLow_' + c, hub, low_local)
        empty('MountTop_' + c, body_obj, top_world)

        low_world = Vector((x, y, r)) + Vector(low_local)
        length = (Vector(top_world) - low_world).length
        sb, ss, sp = shock_parts(c, t, length, scale)
        place(sb.finish(materials), None, top_world)
        place(ss.finish(materials), None, tuple(low_world))
        place(sp.finish(materials), None, top_world)

        if kind == 'arms':
            # Upper and lower wishbones from the body out to the upright.
            pivot = (x, side * 0.32 * scale, r - 0.06 * scale)
            end_world = Vector((x, side * (t['track'] / 2 - t['tire'] * 0.55), r - 0.06 * scale))
            arm = Part('Arm_' + c)
            rel = end_world - Vector(pivot)
            arm.tube((0.18 * scale, 0, 0), tuple(rel), 0.022 * scale, 'Graphite')
            arm.tube((-0.18 * scale, 0, 0), tuple(rel), 0.022 * scale, 'Graphite')
            arm.tube(tuple(rel + Vector((0, 0, 0.26 * scale))), (0.12 * scale, 0, 0.26 * scale), 0.018 * scale, 'Graphite')
            arm.tube(tuple(rel + Vector((0, 0, 0.26 * scale))), (-0.12 * scale, 0, 0.26 * scale), 0.018 * scale, 'Graphite')
            # The drive shaft (CV) to the wheel.
            arm.tube((0, 0, 0.1 * scale), tuple(rel + Vector((0, 0, 0.06 * scale))), 0.02 * scale, 'Steel')
            place(arm.finish(materials), body_obj, pivot)
            empty('ArmEnd_' + c, hub, tuple(end_world - Vector((x, y, r))))
        elif kind == 'trailing':
            # A long trailing arm from the body, ahead of the wheel, back to the upright.
            pivot = (x + 0.7 * scale, side * 0.38 * scale, r - 0.02 * scale)
            end_world = Vector((x, side * (t['track'] / 2 - t['tire'] * 0.6), r - 0.04 * scale))
            arm = Part('Arm_' + c)
            rel = end_world - Vector(pivot)
            arm.tube((0, 0, 0), tuple(rel), 0.03 * scale, 'Graphite', segments=6, smooth=False)
            arm.tube((0, 0, 0.12 * scale), tuple(rel + Vector((0, 0, 0.1 * scale))), 0.02 * scale, 'Graphite')
            arm.tube((0, side * -0.05, 0.1 * scale), tuple(rel + Vector((0, 0, 0.04 * scale))), 0.02 * scale, 'Steel')
            place(arm.finish(materials), body_obj, pivot)
            empty('ArmEnd_' + c, hub, tuple(end_world - Vector((x, y, r))))

    # Solid axles: a beam between the two hubs with the diff in the middle.
    for end, key in (('front', 'F'), ('rear', 'R')):
        if t[end] != 'axle':
            continue
        x = t['cg_front'] if key == 'F' else -t['cg_rear']
        half = t['track'] / 2 - t['tire'] * 0.55
        axle = Part('Axle_' + key)
        axle.tube((0, -half, 0), (0, half, 0), 0.045 * scale, 'Graphite', segments=10)
        off = 0.12 * scale
        axle.lathe([(0.0, -0.12 * scale), (0.13 * scale, -0.1 * scale), (0.15 * scale, 0.0),
                    (0.13 * scale, 0.1 * scale), (0.0, 0.12 * scale)], 'Graphite', segments=16,
                   centre=(0, off, 0), closed=False)
        # The drive shaft forward or back to the gearbox.
        towards = -1 if key == 'F' else 1
        axle.tube((towards * 0.1 * scale, off, 0.02), (towards * 0.7 * scale, off, 0.12 * scale), 0.03 * scale, 'Steel')
        if cls == 'heavy':
            # Leaf spring packs on top of the axle under each frame rail.
            for s in (-1, 1):
                for k in range(4):
                    ln = (1.25 - k * 0.22) * scale
                    axle.box((0, s * 0.5, 0.07 + k * 0.035 * scale), (ln, 0.08 * scale, 0.03 * scale), 'Steel')
        place(axle.finish(materials), None, (x, 0, r))

    shell = body.finish(materials)
    place(shell, body_obj, (0, 0, 0))

    path = os.path.join(OUT_DIR, f'truck-{cls}.glb')
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format='GLB',
        use_selection=True,
        export_yup=True,
        export_apply=True,
        export_animations=False,
        export_cameras=False,
        export_lights=False,
        export_extras=False,
        export_materials='EXPORT',
    )
    print(f'wrote {path} ({os.path.getsize(path) // 1024} KB)')


# --- Bodies -----------------------------------------------------------------
# Each body is built round the wheels: bodywork starts above full bump, so a
# wheel at the end of its travel just reaches the arch.

def side_pair(body, x, y, z, size, mat):
    for s in (-1, 1):
        body.box((x, s * y, z), size, mat)


def lamp_bar(body, x, z, width, n, scale=1.0):
    body.box((x, 0, z), (0.08 * scale, width, 0.1 * scale), 'Graphite')
    for k in range(n):
        y = -width / 2 + width * (k + 0.5) / n
        body.box((x + 0.045 * scale, y, z), (0.02, width / n * 0.72, 0.075 * scale), 'Lamp')


def pickup(body, t):
    """The light 4x4: a lifted pickup with a roof lamp bar, a bull bar, and a
    spare in the bed."""
    w = 1.84
    sill = 1.02  # bodywork starts here, above the wheels at full bump
    # Frame rails and cross members, low between the wheels.
    side_pair(body, -0.1, 0.45, 0.62, (4.4, 0.1, 0.16), 'Graphite')
    for x in (1.7, 0.6, -0.6, -1.9):
        body.box((x, 0, 0.62), (0.1, 0.9, 0.12), 'Graphite')
    # Skid plate under the nose.
    body.box((1.55, 0, 0.5), (1.0, 0.9, 0.04), 'Steel')
    # Rock sliders along the sills.
    side_pair(body, 0.35, 0.86, sill - 0.04, (1.5, 0.1, 0.08), 'Graphite')
    # Cab with a raked windscreen.
    xb, xf, top = -0.55, 1.15, 2.02
    body.hull([(xf, w / 2, sill), (xf, -w / 2, sill), (xb, -w / 2, sill), (xb, w / 2, sill)],
              [(xf - 0.55, w / 2 - 0.08, top), (xf - 0.55, -w / 2 + 0.08, top), (xb, -w / 2 + 0.08, top),
               (xb, w / 2 - 0.08, top)], 'Paint')
    # Windows: windscreen, side windows, back window (thin dark plates on the cab).
    body.hull([(xf - 0.02, w / 2 - 0.06, 1.5), (xf - 0.02, -w / 2 + 0.06, 1.5),
               (xf - 0.06, -w / 2 + 0.06, 1.5), (xf - 0.06, w / 2 - 0.06, 1.5)],
              [(xf - 0.52, w / 2 - 0.12, top - 0.04), (xf - 0.52, -w / 2 + 0.12, top - 0.04),
               (xf - 0.56, -w / 2 + 0.12, top - 0.04), (xf - 0.56, w / 2 - 0.12, top - 0.04)], 'Glass')
    for s in (-1, 1):
        body.hull([(xf - 0.12, s * (w / 2 + 0.005), 1.52), (xf - 0.12, s * (w / 2 - 0.01), 1.52),
                   (xb + 0.12, s * (w / 2 - 0.01), 1.52), (xb + 0.12, s * (w / 2 + 0.005), 1.52)],
                  [(xf - 0.55, s * (w / 2 - 0.07), top - 0.06), (xf - 0.55, s * (w / 2 - 0.085), top - 0.06),
                   (xb + 0.12, s * (w / 2 - 0.085), top - 0.06), (xb + 0.12, s * (w / 2 - 0.07), top - 0.06)],
                  'Glass')
    body.box((xb - 0.005, 0, 1.75), (0.02, w - 0.4, 0.34), 'Glass')
    # Bonnet, sloping a little to the grille.
    body.hull([(2.22, w / 2 - 0.04, sill), (2.22, -w / 2 + 0.04, sill), (xf, -w / 2, sill), (xf, w / 2, sill)],
              [(2.2, w / 2 - 0.08, 1.38), (2.2, -w / 2 + 0.08, 1.38), (xf, -w / 2 + 0.02, 1.5),
               (xf, w / 2 - 0.02, 1.5)], 'Paint')
    # Grille, headlamps and the bull bar.
    body.box((2.23, 0, 1.2), (0.03, 1.2, 0.26), 'Graphite')
    for s in (-1, 1):
        body.box((2.235, s * 0.72, 1.22), (0.03, 0.22, 0.16), 'Lamp')
        body.tube((2.32, s * 0.55, 0.88), (2.32, s * 0.55, 1.42), 0.035, 'Graphite')
        # Brackets back to the frame rails, so the bar is bolted on.
        body.tube((2.32, s * 0.5, 0.92), (2.05, s * 0.45, 0.66), 0.03, 'Graphite')
    body.tube((2.32, -0.62, 1.42), (2.32, 0.62, 1.42), 0.035, 'Graphite')
    body.tube((2.32, -0.8, 0.95), (2.32, 0.8, 0.95), 0.04, 'Graphite')
    # The bed: a floor and three walls, open on top.
    xr = -2.35
    body.box(((xb - 0.05 + xr) / 2, 0, sill + 0.03), (xb - 0.05 - xr, w, 0.06), 'Paint')
    side_pair(body, (xb - 0.05 + xr) / 2, w / 2 - 0.03, sill + 0.26, (xb - 0.05 - xr, 0.06, 0.46), 'Paint')
    body.box((xr + 0.03, 0, sill + 0.26), (0.06, w, 0.46), 'Paint')
    # Spare wheel lying in the bed, and a roll bar behind the cab.
    body.lathe([(0.0, -0.1), (0.3, -0.13), (0.4, -0.08), (0.4, 0.08), (0.3, 0.13), (0.0, 0.1)], 'Rubber',
               segments=20, centre=(-1.55, 0, sill + 0.18), closed=False)
    for s in (-1, 1):
        body.tube((xb - 0.15, s * 0.8, sill + 0.06), (xb - 0.15, s * 0.7, top + 0.05), 0.035, 'Trim')
    body.tube((xb - 0.15, -0.7, top + 0.05), (xb - 0.15, 0.7, top + 0.05), 0.035, 'Trim')
    # Wheel arch flares, over each wheel.
    for x in (t['cg_front'], -t['cg_rear']):
        side_pair(body, x, w / 2 + 0.03, sill + 0.03, (1.0, 0.08, 0.08), 'Trim')
    # Roof lamp bar, mirrors, a magenta stripe and the number board on each door.
    lamp_bar(body, xf - 0.62, top + 0.09, 1.4, 4)
    side_pair(body, xf - 0.1, w / 2 + 0.08, 1.62, (0.12, 0.08, 0.1), 'Trim')
    for s in (-1, 1):
        body.box((-0.08, s * (w / 2 + 0.006), sill + 0.2), (4.5, 0.012, 0.07), 'Magenta')
        body.box((0.3, s * (w / 2 + 0.008), sill + 0.42), (0.55, 0.012, 0.3), 'Board')
    # Tail lamps.
    for s in (-1, 1):
        body.box((xr - 0.005, s * 0.78, sill + 0.36), (0.02, 0.14, 0.1), 'Amber')


def cabover(body, t):
    """The heavy truck: a cab-over rally truck with a service box and two
    spare wheels standing behind the cab."""
    w = 2.36
    sill = 1.48
    # Frame rails, high and straight.
    side_pair(body, 0.0, 0.5, 1.08, (6.2, 0.12, 0.28), 'Graphite')
    for x in (2.8, 1.2, 0.0, -1.2, -2.6):
        body.box((x, 0, 1.08), (0.12, 1.0, 0.18), 'Graphite')
    # Fuel tanks slung along the frame between the wheels.
    for s in (-1, 1):
        body.tube((-0.5, s * 0.82, 1.02), (0.9, s * 0.82, 1.02), 0.28, 'Steel', segments=16)
    # The cab over the front axle, with a raked top front edge.
    xb, xf, top = 1.45, 3.25, 3.4
    body.hull([(xf, w / 2, sill), (xf, -w / 2, sill), (xb, -w / 2, sill), (xb, w / 2, sill)],
              [(xf - 0.2, w / 2 - 0.06, top), (xf - 0.2, -w / 2 + 0.06, top), (xb, -w / 2 + 0.06, top),
               (xb, w / 2 - 0.06, top)], 'Paint')
    # A big split windscreen and side windows.
    body.hull([(xf + 0.005, w / 2 - 0.12, 2.35), (xf + 0.005, -w / 2 + 0.12, 2.35),
               (xf - 0.02, -w / 2 + 0.12, 2.35), (xf - 0.02, w / 2 - 0.12, 2.35)],
              [(xf - 0.14, w / 2 - 0.16, top - 0.15), (xf - 0.14, -w / 2 + 0.16, top - 0.15),
               (xf - 0.17, -w / 2 + 0.16, top - 0.15), (xf - 0.17, w / 2 - 0.16, top - 0.15)], 'Glass')
    body.box((xf - 0.06, 0, 2.85), (0.02, 0.06, 1.0), 'Paint')
    side_pair(body, xf - 0.55, w / 2 - 0.02, 2.8, (0.8, 0.03, 0.75), 'Glass')
    # Grille, bumper, lamps, a magenta stripe and the number board on each door.
    body.box((xf + 0.01, 0, 1.95), (0.03, 1.6, 0.6), 'Graphite')
    body.box((xf + 0.1, 0, 1.45), (0.2, w + 0.04, 0.3), 'Trim')
    for s in (-1, 1):
        body.box((xf + 0.205, s * 0.9, 1.5), (0.02, 0.3, 0.14), 'Lamp')
        body.box((xf - 0.7, s * (w / 2 + 0.006), sill + 0.35), (1.6, 0.012, 0.1), 'Magenta')
        body.box((xf - 0.8, s * (w / 2 + 0.008), sill + 0.75), (0.7, 0.012, 0.45), 'Board')
        # Mirrors on arms.
        body.tube((xf - 0.1, s * (w / 2), 2.7), (xf + 0.05, s * (w / 2 + 0.25), 2.75), 0.02, 'Graphite')
        body.box((xf + 0.05, s * (w / 2 + 0.28), 2.6), (0.06, 0.18, 0.32), 'Graphite')
        # Steps up to the door.
        body.box((xf - 0.8, s * (w / 2 - 0.1), 1.25), (0.5, 0.25, 0.04), 'Steel')
    lamp_bar(body, xf - 0.35, top + 0.1, 1.9, 6, 1.4)
    # Front wheel arches built into the cab's lower corners.
    side_pair(body, t['cg_front'], w / 2 + 0.03, sill + 0.03, (1.5, 0.08, 0.1), 'Trim')
    # The service box over the rear, with a ladder of spare wheels.
    xr = -3.05
    body.box(((xb - 0.6 + xr) / 2, 0, 2.3), (xb - 0.6 - xr, w, 1.65), 'Paint')
    body.box(((xb - 0.6 + xr) / 2, 0, 3.15), (xb - 0.6 - xr + 0.02, w + 0.02, 0.06), 'Trim')
    for s in (-1, 1):
        body.box(((xb - 0.6 + xr) / 2, s * (w / 2 + 0.006), 1.95), (xb - 0.6 - xr - 0.2, 0.012, 0.1), 'Magenta')
        # Roller shutter lines on the box sides.
        for k in range(5):
            body.box((-1.3 + k * 0.03, s * (w / 2 + 0.004), 2.3), (0.02, 0.01, 1.4), 'Graphite')
    side_pair(body, -t['cg_rear'], w / 2 + 0.03, sill + 0.03, (1.5, 0.08, 0.1), 'Trim')
    for s in (-1, 1):
        body.lathe([(0.0, -0.17), (0.45, -0.2), (0.62, -0.13), (0.62, 0.13), (0.45, 0.2), (0.0, 0.17)],
                   'Rubber', segments=20, centre=(xb - 0.32, s * 0.6, 2.25), closed=False)
    # Rear lamps and mud flaps.
    for s in (-1, 1):
        body.box((xr - 0.005, s * 0.95, 1.7), (0.02, 0.2, 0.14), 'Amber')
        body.box((-t['cg_rear'] - 0.8, s * (t['track'] / 2), 0.85), (0.03, 0.45, 0.55), 'Rubber')


def buggy(body, t):
    """The side-by-side: a tube cage on a small chassis, mid-engine, two seats."""
    tw = 0.62  # cage half-width
    floor = 0.42
    # Floor pan and chassis tubes.
    body.box((0.0, 0, floor), (1.9, 1.15, 0.04), 'Graphite')
    side_pair(body, 0.05, 0.55, floor + 0.05, (2.4, 0.05, 0.06), 'Graphite')
    # Seats.
    for s in (-1, 1):
        body.box((-0.15, s * 0.3, floor + 0.2), (0.45, 0.42, 0.12), 'Seat')
        body.hull([(-0.32, s * 0.3 + 0.2, floor + 0.25), (-0.32, s * 0.3 - 0.2, floor + 0.25),
                   (-0.44, s * 0.3 - 0.2, floor + 0.25), (-0.44, s * 0.3 + 0.2, floor + 0.25)],
                  [(-0.45, s * 0.3 + 0.2, floor + 0.85), (-0.45, s * 0.3 - 0.2, floor + 0.85),
                   (-0.55, s * 0.3 - 0.2, floor + 0.85), (-0.55, s * 0.3 + 0.2, floor + 0.85)], 'Seat')
    # The roll cage: hoops, roof and the A-pillars down to the nose.
    hoop_x, roof_front, roof_back, roof_z = -0.6, 0.35, -0.65, 1.72
    for s in (-1, 1):
        body.tube((hoop_x, s * tw, floor), (roof_back, s * tw * 0.95, roof_z), 0.028, 'Magenta')
        body.tube((roof_back, s * tw * 0.95, roof_z), (roof_front, s * tw * 0.95, roof_z), 0.028, 'Magenta')
        body.tube((roof_front, s * tw * 0.95, roof_z), (0.85, s * tw, floor + 0.45), 0.028, 'Magenta')
        body.tube((0.85, s * tw, floor + 0.45), (0.85, s * tw, floor), 0.028, 'Magenta')
        # Door bars and a diagonal.
        body.tube((0.8, s * tw, floor + 0.32), (hoop_x + 0.05, s * tw, floor + 0.32), 0.022, 'Magenta')
        body.tube((hoop_x, s * tw, floor), (-1.35, s * 0.45, floor + 0.35), 0.022, 'Magenta')
        body.tube((roof_back, s * tw * 0.95, roof_z), (-1.35, s * 0.45, floor + 0.35), 0.022, 'Magenta')
    body.tube((roof_back, -tw * 0.95, roof_z), (roof_back, tw * 0.95, roof_z), 0.028, 'Magenta')
    body.tube((roof_front, -tw * 0.95, roof_z), (roof_front, tw * 0.95, roof_z), 0.028, 'Magenta')
    body.tube((hoop_x, -tw, floor + 0.9), (hoop_x - 0.04, tw, floor + 0.9), 0.022, 'Magenta')
    # Roof panel and a lamp bar.
    body.box(((roof_front + roof_back) / 2, 0, roof_z + 0.03), (roof_front - roof_back, tw * 1.8, 0.02), 'Paint')
    lamp_bar(body, roof_front - 0.05, roof_z + 0.1, 0.9, 3, 0.8)
    # The nose: a short bonnet between the front wheels, with headlamps.
    body.hull([(1.62, 0.42, 0.62), (1.62, -0.42, 0.62), (0.85, -0.6, floor + 0.05), (0.85, 0.6, floor + 0.05)],
              [(1.58, 0.36, 0.86), (1.58, -0.36, 0.86), (0.85, -0.55, 1.05), (0.85, 0.55, 1.05)], 'Paint')
    for s in (-1, 1):
        body.box((1.615, s * 0.24, 0.76), (0.02, 0.16, 0.08), 'Lamp')
    body.box((1.66, 0, 0.55), (0.12, 1.0, 0.08), 'Graphite')
    # Dash and steering wheel.
    body.box((0.75, 0, floor + 0.5), (0.12, 1.1, 0.18), 'Graphite')
    body.lathe([(0.15, -0.02), (0.17, 0.0), (0.15, 0.02)], 'Graphite', segments=14,
               centre=(0.55, 0.3, floor + 0.55), closed=False)
    # Fenders over all four wheels: thin panels the wheels just reach at full bump.
    for x in (t['cg_front'], -t['cg_rear']):
        for s in (-1, 1):
            body.hull([(x + 0.32, s * 0.64, 1.06), (x + 0.32, s * 0.94, 1.0), (x - 0.32, s * 0.94, 1.0),
                       (x - 0.32, s * 0.64, 1.06)],
                      [(x + 0.3, s * 0.64, 1.09), (x + 0.3, s * 0.94, 1.03), (x - 0.3, s * 0.94, 1.03),
                       (x - 0.3, s * 0.64, 1.09)], 'Trim')
    # The engine box and a spare wheel strapped on top of the rear deck.
    body.box((-1.15, 0, floor + 0.32), (0.75, 0.95, 0.5), 'Graphite')
    body.box((-1.15, 0, floor + 0.585), (0.78, 0.98, 0.03), 'Paint')
    body.lathe([(0.0, -0.09), (0.26, -0.12), (0.36, -0.07), (0.36, 0.07), (0.26, 0.12), (0.0, 0.09)], 'Rubber',
               segments=18, centre=(-1.2, 0, floor + 0.72), closed=False)
    # Number boards on the cage sides, a magenta strip on the nose, tail lamps.
    for s in (-1, 1):
        body.box((0.1, s * (tw + 0.03), floor + 0.18), (0.45, 0.012, 0.25), 'Board')
        body.box((-1.53, s * 0.38, floor + 0.45), (0.02, 0.12, 0.08), 'Amber')
    body.box((1.2, 0, 0.97), (0.7, 0.16, 0.01), 'Magenta')


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    only = [a for a in sys.argv[sys.argv.index('--') + 1:]] if '--' in sys.argv else []
    for cls, t in TRUCKS.items():
        if only and cls not in only:
            continue
        materials = {name: make_material(name, *spec) for name, spec in KIT_MATERIALS.items()}
        materials['Paint'] = make_material('Paint_' + cls, t['paint'], 0.15, 0.5, 0)
        materials['Trim'] = make_material('Trim_' + cls, t['trim'], 0.2, 0.55, 0)
        build_truck(cls, t, materials)


main()
