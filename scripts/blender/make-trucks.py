"""
Bump Stop's three trucks, built by script. No Blender window needed.

Run it with the Blender Python module (`pip install bpy==5.1.2`):

    python scripts/blender/make-trucks.py

or with Blender itself:

    blender --background --python scripts/blender/make-trucks.py

Add `-- light4x4` (or heavy, sxs) to build just one. It writes
public/models/truck-light4x4.glb.gz, truck-heavy.glb.gz and truck-sxs.glb.gz
(ordinary .glb models, zipped). Commit those files: the game loads them, and
the build never runs Blender.

All three trucks come from one shared kit of parts (tires, rims, shocks,
springs, bump stops, bars, axles, guards, spares) with each class's own body
on top. The game moves the parts itself (src/render/truckModel.ts), so every
moving part is its own named node:

    Body                 everything the springs hold up (cab, frame, cage)
      MountTop_FL ...    where each shock bolts to the body (an empty)
      Arm_FL_Lower ...   arms that swing from the body: wishbones, trailing
                         arms, radius rods, tie rods, half-shafts
        MountLow_FL_...  a layout's shock bottom, when it sits on an arm
    Hub_FL ...           each wheel's upright: moves up and down
      Wheel_FL ...       the wheel and tire: spins
      MountLow_FL ...    where the shock bolts to the axle or hub (an empty)
      ArmEnd_FL_Lower .. where each arm meets the upright (it points here)
    Axle_F, Axle_R       light 4x4 and heavy truck: the solid axle beams

SUSPENSION LAYOUTS. Where a truck offers more than one layout at an end
(the light 4x4's beam axle or double wishbones), each layout's parts sit in
a group the game shows like a bolt-on, and the extra layouts have their own
shock mounts at the stock shock length. See LAYOUTS below.
    ShockBody_FL ...     the shock's body, from the top mount downwards
    ShockShaft_FL ...    the shock's shaft, from the bottom mount upwards
    Spring_FL ...        the coil spring, from the top mount, squashed to fit

Corners: FL front left, FR front right, RL rear left, RR rear right.

THE PARTS YOU FIT. A model holds every part a player can bolt on, and the
game shows only the ones in the build. Those nodes are named

    Fit_<slot>_<part>[-<part>...]_<where>

for example `Fit_dampers_bypass_FL` (the bypass shock body on the front
left) or `Fit_frontSusp_solidAxleCoil-wishbone_SpringFL` (a coil spring
shown for either of those two front suspensions). The slot and part names
are the ones in src/data/parts.ts. A part with nothing to see (no guards, no
spares, no anti-roll bars) simply has no node. Wheels and tires are made
once and shared by all four corners, so the file stays small.

Coordinates (Blender): X forward, Y left, Z up, metres. The origin is on the
ground under the centre of mass, at rest. The wheel positions match the test
mules in src/data/ride.ts (cgToFront, cgToRear, track); tests/models.test.ts
checks that. glTF turns this into three.js's Y up: X forward, Y up, Z right.

No real brands, logos or people: plain fictional trucks.
"""

import gzip
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
# roadbook palette, and the blue anodised alloy is the trace's "cool" blue.
# name: (colour, metallic, roughness, glow)
KIT_MATERIALS = {
    'Graphite': ('#25272B', 0.1, 0.65, 0),
    'Rubber': ('#1B1C1E', 0.0, 0.92, 0),
    'Steel': ('#9AA0A7', 0.35, 0.4, 0),
    'Chrome': ('#E2E5E9', 0.5, 0.2, 0),
    'Alloy': ('#C9CED4', 0.4, 0.3, 0),
    'WheelPaint': ('#E4DFD2', 0.1, 0.5, 0),
    'Anodised': ('#2D74BC', 0.3, 0.35, 0),
    'Urethane': ('#E8962A', 0.0, 0.55, 0),
    'Jerry': ('#C0262D', 0.1, 0.5, 0),
    'Glass': ('#24303A', 0.3, 0.1, 0),
    'Lamp': ('#FFF4D6', 0.0, 0.3, 2.0),
    'TailLamp': ('#D8343B', 0.0, 0.35, 0.8),
    'Amber': ('#F0AE45', 0.0, 0.4, 0.6),
    'Board': ('#FBFAF5', 0.0, 0.7, 0),
    'Magenta': ('#FF4FB2', 0.05, 0.45, 0),
    'Seat': ('#3A3B41', 0.0, 0.85, 0),
    # The driveline: cast iron for engine blocks (a shade lighter than the
    # frame, so it reads against it) and heat-browned steel for exhausts.
    'Cast': ('#565B63', 0.25, 0.55, 0),
    'Pipe': ('#8A6E5C', 0.3, 0.6, 0),
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
# Each node is one mesh built from many simple shapes, so a truck is only a
# few dozen draw calls on a phone. Hard edges get a small bevel: it catches
# the light like real pressed metal, for very few extra triangles.

V = Vector


class Part:
    def __init__(self, name):
        self.name = name
        self.bm = bmesh.new()
        self.mats = []

    def mat(self, name):
        if name not in self.mats:
            self.mats.append(name)
        return self.mats.index(name)

    def _paint(self, faces, mat, smooth=False):
        mi = self.mat(mat)
        for f in faces:
            f.material_index = mi
            f.smooth = smooth

    def _bevel(self, verts, bevel, mat):
        if bevel <= 0:
            return
        edges = list({e for v in verts for e in v.link_edges})
        out = bmesh.ops.bevel(self.bm, geom=list(verts) + edges, offset=bevel, offset_type='OFFSET',
                              segments=1, profile=0.5, affect='EDGES', clamp_overlap=True)
        self._paint(out['faces'], mat)

    def box(self, centre, size, mat, rot=None, bevel=0.0):
        """A box: centre (x, y, z), size (x, y, z), optional rotation matrix."""
        m = Matrix.Translation(V(centre))
        if rot is not None:
            m = m @ rot.to_4x4()
        m = m @ Matrix.Diagonal(V((*size, 1.0)))
        out = bmesh.ops.create_cube(self.bm, size=1.0, matrix=m)
        verts = out['verts']
        self._paint({f for v in verts for f in v.link_faces}, mat)
        self._bevel(verts, min(bevel, min(size) * 0.45), mat)

    def convex(self, points, mat, bevel=0.0):
        """The smallest solid that wraps the points: wedges, cabs, bonnets, plates."""
        bm = self.bm
        verts = [bm.verts.new(p) for p in points]
        out = bmesh.ops.convex_hull(bm, input=verts, use_existing_faces=False)
        junk = [g for g in out['geom_interior'] + out['geom_unused'] if isinstance(g, bmesh.types.BMVert)]
        if junk:
            bmesh.ops.delete(bm, geom=junk, context='VERTS')
        faces = [g for g in out['geom'] if isinstance(g, bmesh.types.BMFace) and g.is_valid]
        hull_verts = list({v for f in faces for v in f.verts})
        # Merge the hull's triangles back into flat faces, so the bevel runs round the real edges.
        bmesh.ops.dissolve_limit(bm, angle_limit=0.02, verts=hull_verts,
                                 edges=list({e for v in hull_verts for e in v.link_edges}))
        hull_verts = [v for v in hull_verts if v.is_valid]
        faces = list({f for v in hull_verts for f in v.link_faces})
        bmesh.ops.recalc_face_normals(bm, faces=faces)
        self._paint(faces, mat)
        self._bevel(hull_verts, bevel, mat)

    def panel(self, quad, mat, centre, lift=0.004, thick=0.008):
        """A thin plate lying on a body surface (a window, a door board): the
        four corners go round the plate; it's lifted off the surface, away
        from `centre` (a point inside the body)."""
        p = [V(q) for q in quad]
        n = (p[1] - p[0]).cross(p[3] - p[0]).normalized()
        mid = sum(p, V()) / 4
        if n.dot(mid - V(centre)) < 0:
            n = -n
        self.convex([q + n * lift for q in p] + [q + n * (lift + thick) for q in p], mat)

    def tube(self, a, b, r, mat, segments=8, smooth=True, r2=None):
        """A round bar from point a to point b (a cone if r2 is given)."""
        a, b = V(a), V(b)
        d = b - a
        length = d.length
        rot = V((0, 0, 1)).rotation_difference(d.normalized()).to_matrix().to_4x4()
        m = Matrix.Translation((a + b) / 2) @ rot
        out = bmesh.ops.create_cone(self.bm, cap_ends=True, segments=segments, radius1=r,
                                    radius2=r if r2 is None else r2, depth=length, matrix=m)
        self._paint({f for v in out['verts'] for f in v.link_faces}, mat, smooth)

    def lathe(self, profile, mat, segments=28, centre=(0, 0, 0), smooth=True, closed=True, axis='Y'):
        """Spin a profile of (radius, h) points round an axis through `centre`:
        tires, rims and hubs round Y (left-right, h runs inner side outwards);
        bump stops and cans round Z (h runs upwards)."""
        bm = self.bm
        cx, cy, cz = centre
        rings = []
        for (r, h) in profile:
            ring = []
            for k in range(segments):
                ang = 2 * math.pi * k / segments
                if axis == 'Y':
                    ring.append(bm.verts.new((cx + r * math.cos(ang), cy + h, cz + r * math.sin(ang))))
                elif axis == 'Z':
                    ring.append(bm.verts.new((cx + r * math.cos(ang), cy + r * math.sin(ang), cz + h)))
                else:
                    ring.append(bm.verts.new((cx + h, cy + r * math.cos(ang), cz + r * math.sin(ang))))
            rings.append(ring)
        new_faces = []
        for i in range(len(rings) - 1):
            for k in range(segments):
                k2 = (k + 1) % segments
                new_faces.append(bm.faces.new([rings[i][k], rings[i][k2], rings[i + 1][k2], rings[i + 1][k]]))
        if closed:
            for idx in (0, -1):
                if profile[idx][0] > 1e-4:
                    new_faces.append(bm.faces.new(rings[idx]))
        bmesh.ops.recalc_face_normals(bm, faces=new_faces)
        self._paint(new_faces, mat, smooth)

    def arch(self, cx, cz, r_in, r_out, y0, y1, a0, a1, mat, segs=10):
        """A curved band round a wheel (a flare or a fender), in the side view:
        angles in degrees, 0 = forward, 90 = straight up."""
        bm = self.bm
        rings = []
        for i in range(segs + 1):
            a = math.radians(a0 + (a1 - a0) * i / segs)
            c, s = math.cos(a), math.sin(a)
            rings.append([bm.verts.new((cx + rr * c, y, cz + rr * s))
                          for (rr, y) in ((r_in, y0), (r_out, y0), (r_out, y1), (r_in, y1))])
        faces = []
        for i in range(segs):
            for k in range(4):
                k2 = (k + 1) % 4
                faces.append(bm.faces.new([rings[i][k], rings[i][k2], rings[i + 1][k2], rings[i + 1][k]]))
        faces.append(bm.faces.new(rings[0]))
        faces.append(bm.faces.new(rings[-1][::-1]))
        bmesh.ops.recalc_face_normals(bm, faces=faces)
        self._paint(faces, mat)

    def helix(self, top, length, radius, wire, turns, mat, steps=12, sides=6):
        """A coil spring hanging down from `top` along -Z, with flat-ground ends."""
        bm = self.bm
        tx, ty, tz = top
        n = int(turns * steps)
        rings = []
        for i in range(n + 1):
            u = i / n
            ang = 2 * math.pi * turns * u
            # The first and last turns lie flat, like a real spring's ground ends.
            e = 1.0 / turns
            if u < e:
                drop = 0.35 * u
            elif u > 1 - e:
                drop = 1 - 0.35 * (1 - u)
            else:
                drop = 0.35 * e + (u - e) * (1 - 0.7 * e) / (1 - 2 * e)
            centre = V((tx + radius * math.cos(ang), ty + radius * math.sin(ang), tz - length * drop))
            radial = V((math.cos(ang), math.sin(ang), 0))
            up = V((0, 0, 1))
            rings.append([bm.verts.new(centre + wire * (math.cos(2 * math.pi * s / sides) * radial +
                                                         math.sin(2 * math.pi * s / sides) * up))
                          for s in range(sides)])
        faces = []
        for i in range(n):
            for s in range(sides):
                s2 = (s + 1) % sides
                faces.append(bm.faces.new([rings[i][s], rings[i][s2], rings[i + 1][s2], rings[i + 1][s]]))
        bmesh.ops.recalc_face_normals(bm, faces=faces)
        self._paint(faces, mat, True)

    def empty_part(self):
        return len(self.bm.verts) == 0

    def to_mesh(self, materials):
        mesh = bpy.data.meshes.new(self.name)
        bmesh.ops.remove_doubles(self.bm, verts=self.bm.verts, dist=1e-5)
        self.bm.to_mesh(mesh)
        self.bm.free()
        for name in self.mats:
            mesh.materials.append(materials[name])
        return mesh

    def finish(self, materials):
        return link(self.name, self.to_mesh(materials))


def link(name, mesh):
    """A node for a mesh. Several nodes can share one mesh (all four tires)."""
    obj = bpy.data.objects.new(name, mesh)
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


def place(obj, parent, loc, rot=None):
    """Put obj at loc in its parent's space (no hidden parent offset)."""
    if parent is not None:
        obj.parent = parent
        obj.matrix_parent_inverse = Matrix.Identity(4)
    obj.location = loc
    if rot is not None:
        obj.rotation_euler = rot
    return obj


def fit_name(slot, parts, where=''):
    """`Fit_<slot>_<part>[-<part>...]_<where>`: shown only when the build has one of those parts.

    A part's TWINS (parts that look the same) are added to the name, so the
    same mesh shows for them too.
    """
    parts = list(parts) + [tw for p in parts for tw in TWINS.get(p, []) if tw not in parts]
    name = f'Fit_{slot}_{"-".join(parts)}'
    return f'{name}_{where}' if where else name


# --- The trucks -------------------------------------------------------------
# Wheelbase and track match TEST_MULES in src/data/ride.ts. `radius` and
# `tire` are the tire's size; `paint` and `trim` the class's colours.

TRUCKS = {
    'light4x4': dict(cg_front=1.3, cg_rear=1.5, track=1.65, radius=0.40, tire=0.30,
                     paint='#ECE8DC', trim='#25272B'),
    'heavy': dict(cg_front=2.1, cg_rear=1.9, track=2.1, radius=0.62, tire=0.42,
                  paint='#5A6E80', trim='#ECE8DC'),
    'sxs': dict(cg_front=1.15, cg_rear=1.2, track=1.6, radius=0.37, tire=0.27,
                paint='#F4F1E8', trim='#25272B'),
}

# Each end's suspension layouts, as (kind, the suspension parts drawn that
# way). The first is the stock layout: its shock mounts are the plain
# MountTop_FL / MountLow_FL. The others get their own mounts, named after
# their parts (MountTop_FL_wishbone), placed so the shock is exactly as long
# at rest as the stock one: every shock body and spring then fits every
# layout, and the game hangs the shocks on the build's own mounts. When an
# end has more than one layout, each one's parts on the body sit in a
# `Fit_<slot>_<parts>_Rig<F|R>` group (and a solid axle in
# `Fit_<slot>_<parts>_Axle<F|R>`), so the game shows only the build's own.
LAYOUTS = {
    'light4x4': {'F': [('axle', ['solidAxleCoil', 'solidAxleLeaf']), ('wishbone', ['wishbone'])],
                 'R': [('axle', ['coilLink', 'leafAxle']), ('trailingArm', ['trailingArm'])]},
    'heavy': {'F': [('axle', ['beamLeaf', 'beamCoil'])],
              'R': [('axle', ['rearBeamLeaf', 'rearBeamCoil'])]},
    'sxs': {'F': [('arms', ['sxsWishbone']), ('longArms', ['longArms'])],
            'R': [('trailing', ['sxsTrailing']), ('longTrailing', ['longTrailing'])]},
}

# Which suspension parts show coil springs round the shocks (the rest are on
# leaf springs), and which solid axles are held by coil-sprung links.
COIL = {
    'light4x4': {'F': ['solidAxleCoil', 'wishbone'], 'R': ['coilLink', 'trailingArm']},
    'heavy': {'F': ['beamCoil'], 'R': ['rearBeamCoil']},
}
LINKS = {
    'light4x4': {'F': ['solidAxleCoil'], 'R': ['coilLink']},
    'heavy': {'F': ['beamCoil'], 'R': ['rearBeamCoil']},
}
LEAF = {
    'light4x4': {'F': ['solidAxleLeaf'], 'R': ['leafAxle']},
    'heavy': {'F': ['beamLeaf'], 'R': ['rearBeamLeaf']},
}

DAMPERS = ['twinTube', 'monotube', 'remoteReservoir', 'bypass', 'internalBypass', 'electronic', 'spoolValve']
BUMP_STOPS = ['rubber', 'urethane', 'hydraulic']
AXLES = ['standardAxles', 'heavyDutyAxles', 'chromolyAxles']
WHEELS = ['steelWheels', 'alloyWheels', 'beadlocks']
TIRES = ['allTerrain', 'rallyTires', 'heavyPly']
# Parts drawn exactly like another, so they share its mesh (`fit_name` adds
# them): studded tires (plan PR 10) use the same casing as their plain twin
# (the studs are too small to see), and most of the 2017 to 2025 parts look
# like the part they grew out of. The spool-valve dampers get their own body.
TWINS = {
    'rallyTires': ['studdedRally', 'aramidRally', 'studdedAramid'],
    'heavyPly': ['studdedPly'],
    'beadlocks': ['forgedBeadlocks'],
    'hydraulic': ['gasCharged'],
    'turboDiesel': ['twinTurboV6'],
    'turboDieselSix': ['twinTurboDieselSix'],
}


def corner_pos(t, c):
    x = t['cg_front'] if c[0] == 'F' else -t['cg_rear']
    y = t['track'] / 2 if c[1] == 'L' else -t['track'] / 2
    return x, y


# --- The kit: tires ------------------------------------------------------------
# Every tire is the same size (the sim's), so a swap never moves the truck.
# They differ in tread, shoulder and sidewall: an all-terrain has fine,
# shallow blocks; a rally tire big square ones; heavy ply chunky lugs that
# wrap onto a fat sidewall.

def kit_tire(name, t, kind):
    r, w = t['radius'], t['tire']
    p = Part(name)
    spec = {
        # lugs round, rows, (radial, axial, round-the-tire) size, row offsets, bulge
        'allTerrain': (30, 3, (0.035, 0.2, 0.085), (-0.3, 0.0, 0.3), 0.47),
        'rallyTires': (18, 2, (0.06, 0.3, 0.15), (-0.2, 0.2), 0.5),
        'heavyPly': (14, 2, (0.085, 0.4, 0.17), (-0.18, 0.18), 0.54),
    }[kind]
    lugs, rows, (lr, la, lt), offsets, bulge = spec
    rc = r - lr * r / 2  # the lugs' tops land on the tire's real radius
    rim_r = r * 0.58
    p.lathe([(rim_r, -w * 0.46), (r * 0.82, -w * bulge), (rc * 0.97, -w * 0.44), (rc, -w * 0.3),
             (rc, w * 0.3), (rc * 0.97, w * 0.44), (r * 0.82, w * bulge), (rim_r, w * 0.46)],
            'Rubber', segments=36, closed=False)
    for k in range(lugs):
        for row in range(rows):
            stagger = 0.5 if (row % 2) else 0.0
            a = 2 * math.pi * (k + 0.5 + stagger * 0.5) / lugs
            rot = Matrix.Rotation(-a, 3, 'Y')
            off = offsets[row] * w + (w * 0.04 if k % 2 else -w * 0.04)
            c = V((rc * math.cos(a), off, rc * math.sin(a)))
            p.box(c, (lr * r, la * w, lt * r), 'Rubber', rot=rot)
    if kind == 'heavyPly':
        # Shoulder lugs that climb onto the sidewall.
        for k in range(lugs):
            a = 2 * math.pi * k / lugs
            rot = Matrix.Rotation(-a, 3, 'Y')
            for side in (-1, 1):
                c = V((r * 0.9 * math.cos(a), side * w * 0.47, r * 0.9 * math.sin(a)))
                p.box(c, (r * 0.13, w * 0.08, r * 0.1), 'Rubber', rot=rot)
    elif kind == 'rallyTires':
        # Small centre blocks between the big ones.
        for k in range(lugs):
            a = 2 * math.pi * k / lugs
            c = V((rc * math.cos(a), 0, rc * math.sin(a)))
            p.box(c, (lr * r * 0.8, w * 0.1, lt * r * 0.6), 'Rubber', rot=Matrix.Rotation(-a, 3, 'Y'))
    return p


# --- The kit: rims -------------------------------------------------------------
# Steel wheels are a painted dish with round holes; alloys are silver with
# spokes; beadlocks have a bolted ring clamping the tire on the outside.

def kit_rim(name, t, kind):
    r, w = t['radius'], t['tire']
    rr = r * 0.58
    p = Part(name)
    body = {'steelWheels': 'WheelPaint', 'alloyWheels': 'Alloy', 'beadlocks': 'Graphite'}[kind]
    # The barrel and the lip.
    p.lathe([(rr, -w * 0.44), (rr, w * 0.34), (rr * 1.05, w * 0.37), (rr * 1.05, w * 0.42), (rr * 0.95, w * 0.42)],
            body, segments=28, closed=False)
    # A dark disc deep inside, so you can't see through the wheel.
    p.lathe([(0.0, -w * 0.1), (rr * 0.98, -w * 0.1)], 'Graphite', segments=20, closed=False)
    if kind == 'steelWheels':
        p.lathe([(rr * 0.95, w * 0.42), (rr * 0.7, w * 0.32), (rr * 0.4, w * 0.3), (rr * 0.32, w * 0.36),
                 (0.0, w * 0.36)], body, segments=28, closed=False)
        for k in range(8):
            a = 2 * math.pi * (k + 0.5) / 8
            c = (rr * 0.62 * math.cos(a), w * 0.33, rr * 0.62 * math.sin(a))
            p.lathe([(0.0, w * 0.322 - c[1]), (rr * 0.1, w * 0.322 - c[1])], 'Graphite', segments=10,
                    centre=(c[0], c[1] + 0.003, c[2]), closed=False)
        cap = 'Steel'
    elif kind == 'alloyWheels':
        p.lathe([(rr * 0.95, w * 0.42), (rr * 0.88, w * 0.3), (rr * 0.3, w * 0.24), (rr * 0.26, w * 0.34),
                 (0.0, w * 0.34)], 'Graphite', segments=28, closed=False)
        for k in range(7):
            a = 2 * math.pi * k / 7
            for d in (-0.07, 0.07):
                aa = a + d
                c = V((rr * 0.6 * math.cos(aa), w * 0.33, rr * 0.6 * math.sin(aa)))
                p.box(c, (rr * 0.66, w * 0.08, rr * 0.08), 'Alloy', rot=Matrix.Rotation(-aa, 3, 'Y'))
        cap = 'Graphite'
    else:
        p.lathe([(rr * 0.95, w * 0.42), (rr * 0.8, w * 0.32), (rr * 0.36, w * 0.3), (rr * 0.3, w * 0.36),
                 (0.0, w * 0.36)], body, segments=28, closed=False)
        # The beadlock ring and its bolts.
        p.lathe([(rr * 0.9, w * 0.42), (rr * 0.9, w * 0.48), (rr * 1.16, w * 0.48), (rr * 1.16, w * 0.42)],
                'Alloy', segments=28, closed=False, smooth=False)
        for k in range(16):
            a = 2 * math.pi * k / 16
            c = (rr * 1.03 * math.cos(a), w * 0.48, rr * 1.03 * math.sin(a))
            p.tube(c, (c[0], w * 0.5, c[2]), rr * 0.025, 'Chrome', segments=6, smooth=False)
        for k in range(6):
            a = 2 * math.pi * (k + 0.5) / 6
            c = (rr * 0.6 * math.cos(a), w * 0.315, rr * 0.6 * math.sin(a))
            p.lathe([(0.0, 0.0), (rr * 0.13, 0.0)], 'Rubber', segments=10, centre=(c[0], c[1] + 0.004, c[2]),
                    closed=False)
        cap = 'Steel'
    # Wheel nuts and the centre cap.
    for k in range(6):
        a = 2 * math.pi * k / 6
        c = (rr * 0.2 * math.cos(a), w * 0.35, rr * 0.2 * math.sin(a))
        p.tube(c, (c[0], w * 0.39, c[2]), rr * 0.035, 'Chrome', segments=6, smooth=False)
    p.lathe([(rr * 0.12, w * 0.36), (rr * 0.12, w * 0.4), (rr * 0.08, w * 0.42), (0.0, w * 0.42)], cap,
            segments=14, closed=False)
    return p


# --- The kit: shocks -------------------------------------------------------------
# The shock's body hangs down from its top eye and its shaft stands up from
# its bottom eye; the game slides them past each other. The bodies get
# bigger and busier up the price list: a plain black twin-tube, a silver
# monotube, a remote reservoir on a hose, a fat bypass with its outside
# tubes and blue adjusters, an internal bypass with a piggyback can, an
# electronic shock with its valve box and wire, and the spool-valve shock
# (2017): a black body with a square valve block under its top eye, three
# amber spool caps in a row on the block, and a piggyback can.

def kit_shock_body(name, length, s, kind):
    body_len = length * 0.62
    br = 0.032 * s
    p = Part(name)
    L = body_len

    def eye(mat='Steel'):
        p.tube((0, -br * 0.9, 0), (0, br * 0.9, 0), br * 0.55, mat, segments=10)
        p.tube((0, 0, 0), (0, 0, -br * 1.2), br * 0.45, mat, segments=8)

    if kind == 'twinTube':
        eye('Graphite')
        p.tube((0, 0, -br), (0, 0, -L), br * 0.85, 'Graphite', segments=12)
        p.tube((0, 0, -L * 0.82), (0, 0, -L), br * 0.92, 'Rubber', segments=12)
    elif kind == 'monotube':
        eye()
        p.tube((0, 0, -br), (0, 0, -L), br, 'Steel', segments=14)
        p.tube((0, 0, -br * 0.8), (0, 0, -br * 2.2), br * 1.08, 'Graphite', segments=14)
        p.tube((0, 0, -L * 0.9), (0, 0, -L), br * 1.1, 'Graphite', segments=14)
    elif kind == 'remoteReservoir':
        eye()
        p.tube((0, 0, -br), (0, 0, -L), br * 1.05, 'Steel', segments=14)
        p.tube((0, 0, -br * 0.8), (0, 0, -br * 2.4), br * 1.14, 'Anodised', segments=14)
        p.tube((0, 0, -L * 0.88), (0, 0, -L), br * 1.15, 'Anodised', segments=14)
        # The separate can of oil and its hose.
        cx = br * 3.6
        p.tube((cx, 0, -L * 0.05), (cx, 0, -L * 0.62), br * 0.8, 'Steel', segments=12)
        p.tube((cx, 0, -L * 0.02), (cx, 0, -L * 0.12), br * 0.86, 'Anodised', segments=12)
        p.tube((cx, 0, -L * 0.56), (cx, 0, -L * 0.64), br * 0.86, 'Anodised', segments=12)
        hose = [(br * 0.6, 0, -br * 1.6), (br * 1.6, 0, -br * 0.4), (br * 2.8, 0, br * 0.2), (cx, 0, -L * 0.02)]
        for a, b in zip(hose, hose[1:]):
            p.tube(a, b, br * 0.2, 'Rubber', segments=6)
    elif kind == 'bypass':
        eye()
        p.tube((0, 0, -br), (0, 0, -L), br * 1.35, 'Steel', segments=16)
        p.tube((0, 0, -br * 0.8), (0, 0, -br * 2.6), br * 1.45, 'Anodised', segments=16)
        p.tube((0, 0, -L * 0.9), (0, 0, -L), br * 1.45, 'Anodised', segments=16)
        # The outside bypass tubes, each with a blue adjuster at both ends.
        for k, ang in enumerate((-0.9, 0.0, 0.9)):
            x, y = br * 1.62 * math.cos(ang), br * 1.62 * math.sin(ang)
            top, bot = -L * (0.16 + 0.04 * k), -L * (0.72 + 0.04 * k)
            p.tube((x, y, top), (x, y, bot), br * 0.24, 'Steel', segments=8)
            for z in (top, bot):
                p.tube((x, y, z + br * 0.25), (x, y, z - br * 0.25), br * 0.38, 'Anodised', segments=8)
        # A piggyback can on the inner side for the extra oil.
        p.tube((-br * 2.3, 0, -L * 0.04), (-br * 2.3, 0, -L * 0.5), br * 0.85, 'Steel', segments=12)
        p.tube((-br * 2.3, 0, -L * 0.04), (-br * 2.3, 0, -L * 0.12), br * 0.92, 'Anodised', segments=12)
        p.box((-br * 1.2, 0, -br * 1.6), (br * 2.2, br * 0.9, br * 1.2), 'Steel')
    elif kind == 'internalBypass':
        eye()
        p.tube((0, 0, -br), (0, 0, -L), br * 1.2, 'Graphite', segments=16)
        p.tube((0, 0, -br * 0.8), (0, 0, -br * 2.4), br * 1.3, 'Anodised', segments=16)
        p.tube((0, 0, -L * 0.9), (0, 0, -L), br * 1.3, 'Anodised', segments=16)
        # Adjuster rings round the body show the tuning inside.
        for z in (0.35, 0.5):
            p.tube((0, 0, -L * z), (0, 0, -L * z - br * 0.3), br * 1.28, 'Steel', segments=16)
        p.tube((br * 2.2, 0, -L * 0.04), (br * 2.2, 0, -L * 0.48), br * 0.78, 'Graphite', segments=12)
        p.tube((br * 2.2, 0, -L * 0.04), (br * 2.2, 0, -L * 0.12), br * 0.85, 'Anodised', segments=12)
        p.tube((br * 2.2, 0, -L * 0.48), (br * 2.2, 0, -L * 0.54), br * 0.5, 'Anodised', segments=10)
        p.box((br * 1.1, 0, -br * 1.6), (br * 2.0, br * 0.9, br * 1.2), 'Graphite')
    elif kind == 'spoolValve':
        eye()
        p.tube((0, 0, -br * 2.6), (0, 0, -L), br * 1.2, 'Graphite', segments=14)
        p.tube((0, 0, -L * 0.9), (0, 0, -L), br * 1.28, 'Steel', segments=14)
        # The valve block, and its three spools' caps in a row on the outside face.
        p.box((br * 0.5, 0, -br * 1.9), (br * 3.4, br * 2.4, br * 1.6), 'Graphite', bevel=br * 0.15)
        for k in (-1, 0, 1):
            p.tube((br * 0.5 + k * br * 1.05, br * 1.2, -br * 1.9), (br * 0.5 + k * br * 1.05, br * 1.55, -br * 1.9),
                   br * 0.36, 'Urethane', segments=8)
        # The piggyback can off the block.
        p.tube((br * 2.4, 0, -br * 2.6), (br * 2.4, 0, -L * 0.5), br * 0.8, 'Graphite', segments=12)
        p.tube((br * 2.4, 0, -L * 0.5), (br * 2.4, 0, -L * 0.55), br * 0.86, 'Steel', segments=12)
    else:  # electronic
        eye()
        p.tube((0, 0, -br), (0, 0, -L), br * 1.2, 'Graphite', segments=16)
        p.tube((0, 0, -br * 0.8), (0, 0, -br * 2.4), br * 1.28, 'Chrome', segments=16)
        p.tube((0, 0, -L * 0.9), (0, 0, -L), br * 1.28, 'Chrome', segments=16)
        # The valve box and its wire.
        p.box((br * 1.6, 0, -L * 0.3), (br * 1.4, br * 1.6, br * 2.2), 'Urethane', bevel=br * 0.2)
        p.box((br * 2.35, 0, -L * 0.3), (br * 0.2, br * 1.0, br * 1.2), 'Graphite')
        wire = [(br * 1.8, 0, -L * 0.3 + br * 1.1), (br * 2.4, 0, -L * 0.1), (br * 2.0, 0, -br * 0.5),
                (br * 0.8, br * 0.8, br * 0.6)]
        for a, b in zip(wire, wire[1:]):
            p.tube(a, b, br * 0.12, 'Rubber', segments=6)
    return p


def kit_shaft(name, length, s):
    br = 0.032 * s
    p = Part(name)
    p.tube((0, 0, 0), (0, 0, length * 0.62), br * 0.45, 'Chrome', segments=10)
    p.tube((0, -br * 0.9, 0), (0, br * 0.9, 0), br * 0.55, 'Steel', segments=10)
    p.tube((0, 0, br * 0.4), (0, 0, br * 1.4), br * 0.7, 'Steel', segments=10)
    return p


def kit_spring(name, length, s):
    br = 0.032 * s
    p = Part(name)
    # Wide enough to clear the fattest shock body.
    p.helix((0, 0, -length * 0.08), length * 0.8, br * 2.25, 0.011 * s, 7, 'Magenta')
    # The spring's top hat and bottom perch.
    p.lathe([(br * 1.4, 0.004 * s), (br * 2.6, 0.0), (br * 2.6, -0.012 * s), (br * 1.4, -0.016 * s)], 'Graphite',
            segments=16, centre=(0, 0, -length * 0.06), axis='Z')
    return p


# --- The kit: bump stops --------------------------------------------------------
# Hanging down from the frame over each wheel, where the axle or arm hits at
# full bump: a black rubber cone, an amber urethane stack, or a hydraulic
# bump stop (a tiny damper of its own, with a blue cap).

def bump_stop(p, top, s, kind):
    x, y, z = top
    L = 0.09 * s
    p.box((x, y, z - 0.006 * s), (0.09 * s, 0.09 * s, 0.012 * s), 'Steel')
    if kind == 'rubber':
        p.lathe([(0.03 * s, 0), (0.03 * s, -L * 0.3), (0.024 * s, -L * 0.4), (0.026 * s, -L * 0.6),
                 (0.017 * s, -L * 0.75), (0.01 * s, -L * 0.8)], 'Rubber', segments=12,
                centre=(x, y, z - 0.012 * s), axis='Z')
    elif kind == 'urethane':
        p.lathe([(0.034 * s, 0), (0.034 * s, -L * 0.2), (0.026 * s, -L * 0.28), (0.032 * s, -L * 0.4),
                 (0.026 * s, -L * 0.52), (0.03 * s, -L * 0.64), (0.024 * s, -L * 0.76), (0.0, -L * 0.8)],
                'Urethane', segments=12, centre=(x, y, z - 0.012 * s), axis='Z')
        p.lathe([(0.04 * s, 0), (0.04 * s, -L * 0.18), (0.0, -L * 0.18)], 'Steel', segments=12,
                centre=(x, y, z - 0.012 * s), axis='Z')
    else:
        p.lathe([(0.032 * s, 0), (0.032 * s, -L * 0.75), (0.0, -L * 0.75)], 'Steel', segments=12,
                centre=(x, y, z - 0.012 * s), axis='Z')
        p.lathe([(0.035 * s, 0), (0.035 * s, -L * 0.16), (0.0, -L * 0.16)], 'Anodised', segments=12,
                centre=(x, y, z - 0.012 * s), axis='Z')
        p.tube((x, y, z - L * 0.75), (x, y, z - L * 1.05), 0.012 * s, 'Chrome', segments=8)
        p.lathe([(0.022 * s, 0), (0.022 * s, -L * 0.1), (0.0, -L * 0.12)], 'Rubber', segments=10,
                centre=(x, y, z - L * 1.05), axis='Z')


# --- The kit: anti-roll bars ---------------------------------------------------------
# A bar across the frame, arms running back to the axle, and drop links down
# to it. The adjustable kind has flat blue blade arms with holes.

def roll_bar(p, x, half, z, arm, link_to, s, adjustable, flip=1):
    r = 0.017 * s
    p.tube((x, -half, z), (x, half, z), r, 'Graphite', segments=8)
    for side in (-1, 1):
        y = side * half
        p.box((x, side * (half - 0.08 * s), z), (0.05 * s, 0.05 * s, 0.05 * s), 'Rubber')
        end = (x - flip * arm, y, z)
        if adjustable:
            p.box((x - flip * arm / 2, y, z), (arm, 0.012 * s, 0.05 * s), 'Anodised')
            for k in range(3):
                p.box((x - flip * arm * (0.5 + 0.15 * k), y + side * 0.007 * s, z), (0.014 * s, 0.003, 0.014 * s),
                      'Graphite')
        else:
            p.tube((x, y, z), end, r, 'Graphite', segments=8)
        p.tube(end, (end[0], y, link_to), 0.008 * s, 'Steel', segments=6)


# --- The kit: spares ------------------------------------------------------------------
# A plain spare wheel, a crate of parts and a jerry can of fuel.

def spare_wheel(p, centre, t, axis='Z', scale=1.0):
    """A spare tire on a rim, lying flat (axis Z) or standing up facing sideways (axis Y)."""
    r, w = t['radius'] * scale, t['tire'] * scale
    rr = r * 0.58
    prof_tire = [(rr, -w * 0.46), (r * 0.82, -w * 0.5), (r * 0.97, -w * 0.42), (r, -w * 0.25),
                 (r, w * 0.25), (r * 0.97, w * 0.42), (r * 0.82, w * 0.5), (rr, w * 0.46)]
    prof_rim = [(rr, -w * 0.42), (rr, w * 0.4), (rr * 0.4, w * 0.32), (0.0, w * 0.32)]
    p.lathe(prof_tire, 'Rubber', segments=24, centre=centre, closed=False, axis=axis)
    p.lathe(prof_rim, 'Steel', segments=16, centre=centre, closed=True, axis=axis)
    # Blocky tread, so it reads as a tire, not a ring.
    for k in range(14):
        a = 2 * math.pi * k / 14
        if axis == 'Z':
            c = V(centre) + V((r * math.cos(a), r * math.sin(a), 0))
            p.box(c, (r * 0.06, r * 0.13, w * 0.7), 'Rubber', rot=Matrix.Rotation(a, 3, 'Z'))
        else:
            c = V(centre) + V((r * math.cos(a), 0, r * math.sin(a)))
            p.box(c, (r * 0.06, w * 0.7, r * 0.13), 'Rubber', rot=Matrix.Rotation(-a, 3, 'Y'))


def crate(p, centre, size, s):
    x, y, z = centre
    p.box(centre, size, 'Graphite', bevel=0.015 * s)
    p.box((x, y, z + size[2] / 2), (size[0] + 0.01, size[1] + 0.01, 0.02 * s), 'Steel')
    # Clasps and a magenta label strip, like the shop's own crates.
    p.box((x + size[0] / 2, y, z + size[2] * 0.15), (0.012, size[1] * 0.6, 0.04 * s), 'Magenta')


def jerry_can(p, centre, s, yaw=0.0):
    x, y, z = centre
    rot = Matrix.Rotation(yaw, 3, 'Z')
    p.box(centre, (0.17 * s, 0.32 * s, 0.45 * s), 'Jerry', rot=rot, bevel=0.02 * s)
    p.box((x, y, z + 0.25 * s), (0.08 * s, 0.22 * s, 0.04 * s), 'Jerry', rot=rot)
    p.tube((x, y, z + 0.22 * s), (x, y, z + 0.27 * s), 0.025 * s, 'Graphite', segments=8)


# --- Building one truck --------------------------------------------------------------

class Build:
    """What a body builder needs: the class, its numbers and a way to add parts."""

    def __init__(self, cls, t, materials):
        self.cls, self.t, self.materials = cls, t, materials
        self.r = t['radius']
        self.s = self.r / 0.4  # parts sized for the light 4x4, scaled for the others
        self.body = empty('Body', None, (0, 0, 0))
        self.shell = Part('BodyShell')
        self.axles = {}
        self.groups = {}
        self.tops = {}
        self.rig_parts = {}
        # The driveline: where each solid axle's pinion is, and where the
        # transfer case's two outputs are (see "The driveline" below).
        self.pinions = {}
        self.outputs = {}
        # The driveline is drawn into the body's own mesh (no extra draw
        # calls). Set BUMP_SPLIT=1 to give it a node of its own, `Driveline`,
        # for looking at it without the body while working on the models;
        # don't commit models built that way.
        self.drive = Part('Driveline') if os.environ.get('BUMP_SPLIT') else self.shell

    def layouts(self, key):
        """The layouts at one end ('F' or 'R'), stock first."""
        return LAYOUTS[self.cls][key]

    def rig(self, key, kind):
        """Where one layout's parts on the body go: a group of its own the game
        can hide, or the body itself when that end has only one layout."""
        layouts = self.layouts(key)
        if len(layouts) == 1:
            return self.body
        if (key, kind) not in self.groups:
            parts = dict(layouts)[kind]
            slot = 'frontSusp' if key == 'F' else 'rearSusp'
            self.groups[(key, kind)] = empty(fit_name(slot, parts, 'Rig' + key), self.body, (0, 0, 0))
        return self.groups[(key, kind)]

    def rig_part(self, key, kind):
        """One shared Part for a layout's brackets on the body, from all its
        corners (one node, so one draw call)."""
        if (key, kind) not in self.rig_parts:
            self.rig_parts[(key, kind)] = Part(f'Brackets{key}_{kind}')
        return self.rig_parts[(key, kind)]

    def fit(self, slot, parts, where=''):
        """A new Part for one or more fitted parts, on the body unless placed elsewhere."""
        return Part(fit_name(slot, parts, where))

    def add(self, part, parent=None, loc=(0, 0, 0)):
        if part.empty_part():
            part.bm.free()
            return None
        return place(part.finish(self.materials), parent if parent is not None else self.body, loc)


# --- Suspension layouts --------------------------------------------------------------
# What each wheel hangs on. A layout draws its arms and says where its shock
# bolts on: the bottom (on the hub or on an arm) and the top (on the body).
# Arms are drawn in their pivot's space and named Arm_<corner>_<what>; the
# game turns each one to point at its ArmEnd_<corner>_<what>, an empty on the
# hub, so the arms follow the wheel.

def plate_y(p, x0, x1, y, z0, z1, th=0.012):
    """A flat bracket standing along the truck at `y`."""
    p.box(((x0 + x1) / 2, y, (z0 + z1) / 2), (x1 - x0, th, z1 - z0), 'Graphite', bevel=0.003)


def solve_top(low, x, y, length):
    """A top mount at (x, y) over the bottom mount, just high enough for the
    shock to be `length` long."""
    flat = (x - low[0]) ** 2 + (y - low[1]) ** 2
    return V((x, y, low[2] + math.sqrt(max(length * length - flat, 0.0))))


def wishbone(p, rel, spread, rad, mat, s, plate=True):
    """An A-shaped arm: rubber bushings on the body at (±spread, 0, 0), a ball
    joint on the upright at `rel`, and a plate across the middle."""
    for px in (spread, -spread):
        p.tube((px, 0, 0), tuple(rel), rad, mat, segments=8)
        p.tube((px - 0.035 * s, 0, 0), (px + 0.035 * s, 0, 0), rad * 1.35, 'Rubber', segments=8)
    p.tube(tuple(rel - V((0, 0, 0.025 * s))), tuple(rel + V((0, 0, 0.025 * s))), rad * 1.5, 'Steel', segments=8)
    if plate:
        a, b = V((spread, 0, 0)).lerp(rel, 0.5), V((-spread, 0, 0)).lerp(rel, 0.5)
        tip = rel * 0.92
        lift = V((0, 0, rad * 0.5))
        p.convex([a + lift, b + lift, tip + lift, a - lift, b - lift, tip - lift], mat)


def boxed_wishbone(p, rel, spread, s, mat):
    """A long-travel lower arm: one deep boxed plate from wide bushings to a
    chrome heim joint, with a tube along each edge."""
    th = 0.022 * s
    p.convex([(spread, 0, th), (-spread, 0, th), (spread, 0, -th), (-spread, 0, -th),
              tuple(rel + V((0.035 * s, 0, th))), tuple(rel + V((-0.035 * s, 0, th))),
              tuple(rel + V((0.035 * s, 0, -th))), tuple(rel + V((-0.035 * s, 0, -th)))], mat, bevel=0.004 * s)
    for px in (spread, -spread):
        p.tube((px, 0, 0), tuple(rel), 0.02 * s, mat, segments=8)
        p.tube((px - 0.04 * s, 0, 0), (px + 0.04 * s, 0, 0), 0.03 * s, 'Rubber', segments=8)
    p.tube(tuple(rel - V((0, 0, 0.03 * s))), tuple(rel + V((0, 0, 0.03 * s))), 0.034 * s, 'Chrome', segments=10)


def boxed_trailing(p, rel, s, mat, width, deep, brace):
    """A trailing arm: a boxed beam from the bushing on the body back to the
    upright, deeper at the wheel end, and a brace to a second bushing
    inboard (`brace` is that bushing's offset across the truck)."""
    w, d = width * s, deep * s
    p.convex([(0, -w * 0.8, d * 0.45), (0, w * 0.8, d * 0.45), (0, -w * 0.8, -d * 0.45), (0, w * 0.8, -d * 0.45),
              tuple(rel + V((0.05 * s, -w, d))), tuple(rel + V((0.05 * s, w, d))),
              tuple(rel + V((0.05 * s, -w, -d * 0.85))), tuple(rel + V((0.05 * s, w, -d * 0.85)))],
             mat, bevel=0.006 * s)
    p.tube((0, -w * 1.4, 0), (0, w * 1.4, 0), 0.035 * s, 'Rubber', segments=8)
    if brace:
        p.tube((0, brace, 0), tuple(rel * 0.6), 0.022 * s, mat, segments=8)
        p.tube((-0.03 * s, brace, 0), (0.03 * s, brace, 0), 0.03 * s, 'Rubber', segments=8)


def rod(p, rel, s, mat='Graphite'):
    """A plain link with a chrome rod end at each end."""
    p.tube((0, 0, 0), tuple(rel), 0.016 * s, mat, segments=8)
    d = rel.normalized()
    for pnt in (V((0, 0, 0)), rel):
        p.tube(tuple(pnt - d * 0.03 * s), tuple(pnt + d * 0.03 * s), 0.022 * s, 'Chrome', segments=8)


def drive_shaft(p, a, e, k, s):
    """A half-shaft with a rubber boot at each joint: thicker for heavy-duty
    axles, chrome with blue boots for chromoly."""
    a, e = V(a), V(e)
    rad = {'standardAxles': 0.016, 'heavyDutyAxles': 0.022, 'chromolyAxles': 0.015}[k] * s
    boot = {'standardAxles': 'Rubber', 'heavyDutyAxles': 'Rubber', 'chromolyAxles': 'Anodised'}[k]
    p.tube(tuple(a), tuple(e), rad, 'Chrome' if k == 'chromolyAxles' else 'Steel', segments=8)
    d = (e - a).normalized()
    for pnt in (a + d * 0.05 * s, e - d * 0.05 * s):
        p.tube(tuple(pnt - d * 0.045 * s), tuple(pnt + d * 0.045 * s), rad * 2.4, boot, segments=10, r2=rad * 1.4)


def diff_cover(p, k, centre, s):
    """The cover on the back of a diff (round Y, facing +Y): plain, finned
    steel for heavy-duty, blue for chromoly."""
    cx, cy, cz = centre
    if k == 'heavyDutyAxles':
        p.lathe([(0.13 * s, 0.0), (0.13 * s, 0.03 * s), (0.1 * s, 0.06 * s), (0.0, 0.065 * s)], 'Steel',
                segments=16, centre=centre, closed=False, smooth=False)
        for fin in range(-2, 3):
            p.box((cx, cy + 0.06 * s, cz + fin * 0.035 * s), (0.2 * s, 0.012 * s, 0.01 * s), 'Steel')
    else:
        p.lathe([(0.11 * s, 0.0), (0.11 * s, 0.03 * s), (0.08 * s, 0.05 * s), (0.0, 0.055 * s)],
                'Anodised' if k == 'chromolyAxles' else 'Graphite', segments=16, centre=centre, closed=False,
                smooth=False)


class Corner:
    """One corner while it's built: where its wheel is, and a way to add arms."""

    def __init__(self, b, c, hub):
        t = b.t
        self.b, self.c, self.hub = b, c, hub
        self.x, self.y = corner_pos(t, c)
        self.r, self.s = b.r, b.s
        self.side = 1 if c[1] == 'L' else -1
        self.key = c[0]
        self.half = t['track'] / 2
        self.hub_world = V((self.x, self.y, self.r))

    def at(self, dx, out, z):
        """A point by this corner: `dx` along the truck from the axle line,
        `out` from the centre line towards this wheel, `z` up from the ground."""
        return V((self.x + dx, self.side * out, z))

    def arm(self, group, what, pivot, end, draw=None):
        """An arm from the body at `pivot` to the upright at `end` (world
        positions, at rest). `draw(part, rel)` draws it in the pivot's space,
        `rel` being the end. Returns the arm and `rel`."""
        name = f'Arm_{self.c}_{what}'
        pivot = V(pivot)
        rel = V(end) - pivot
        part = Part(name)
        if draw is not None:
            draw(part, rel)
        if part.empty_part():
            part.bm.free()
            obj = place(empty(name, None, (0, 0, 0)), group, tuple(pivot))
        else:
            obj = place(part.finish(self.b.materials), group, tuple(pivot))
        empty(f'ArmEnd_{self.c}_{what}', self.hub, tuple(V(end) - self.hub_world))
        return obj, rel

    def on_arm(self, pivot, rel, f, lift=(0, 0, 0)):
        """A point a fraction `f` of the way down an arm, nudged by `lift`."""
        return V(pivot) + rel * f + V(lift)


def layout_corner(b, k, kind, group):
    """Draw one layout at one corner. Returns where its shock bolts on, in
    world space at rest: `low` on `parent` (whose own origin is `origin`), and
    either `top`, or `top_xy` for the top to sit over it at the stock shock's
    length."""
    t, s, r = b.t, k.s, k.r
    side, tire = k.side, t['tire']
    inboard = tire * 0.75 + 0.05 * s

    if kind == 'axle':
        # Stock beam axle: the shock from the hub, just inboard of the wheel, up to the frame.
        low = k.hub_world + V((0.0, -side * inboard, -0.02 * s))
        top = k.at(0.08 * s if k.key == 'F' else -0.08 * s, k.half - inboard, r + 0.58 * s)
        return dict(parent=k.hub, origin=k.hub_world, low=low, top=top)

    if kind == 'arms':
        # Stock side-by-side double wishbones; the shock stands on the hub and leans in.
        ball = k.half - tire * 0.55
        k.arm(group, 'Lower', k.at(0, 0.32 * s, r - 0.06 * s), k.at(0, ball, r - 0.06 * s),
              lambda p, rel: wishbone(p, rel, 0.18 * s, 0.022 * s, 'Graphite', s))
        k.arm(group, 'Upper', k.at(0, 0.32 * s, r + 0.2 * s), k.at(0, ball, r + 0.2 * s),
              lambda p, rel: wishbone(p, rel, 0.2 * s, 0.018 * s, 'Graphite', s, plate=False))
        plate_y(b.rig_part(k.key, kind), k.x - 0.23 * s, k.x + 0.23 * s, side * 0.29 * s, r - 0.1 * s, r + 0.24 * s)
        low = k.hub_world + V((0.0, -side * inboard, -0.02 * s))
        top = k.at(-0.05 * s, k.half - inboard - 0.32 * s, r + 0.95 * s)
        return dict(parent=k.hub, origin=k.hub_world, low=low, top=top)

    if kind == 'longArms':
        # Long-travel arms: pivots near the middle of the truck, so the arms are
        # half as long again and swing through a flatter arc. Boxed alloy lower
        # arms with chrome heim joints; the shock sits on the lower arm.
        ball = k.half - tire * 0.55
        lp = k.at(0, 0.12 * s, r - 0.09 * s)
        lower, rel = k.arm(group, 'LongLower', lp, k.at(0, ball, r - 0.06 * s),
                           lambda p, rel: boxed_wishbone(p, rel, 0.24 * s, s, 'Alloy'))
        k.arm(group, 'LongUpper', k.at(0, 0.16 * s, r + 0.24 * s), k.at(0, ball, r + 0.2 * s),
              lambda p, rel: wishbone(p, rel, 0.24 * s, 0.019 * s, 'Alloy', s, plate=False))
        plate_y(b.rig_part(k.key, kind), k.x - 0.28 * s, k.x + 0.28 * s, side * 0.09 * s, r - 0.13 * s, r + 0.28 * s)
        low = k.on_arm(lp, rel, 0.8, (0, 0, 0.04 * s))
        return dict(parent=lower, origin=lp, low=low, top_xy=(k.x - 0.05 * s, side * (abs(low.y) - 0.3 * s)))

    if kind == 'trailing':
        # Stock side-by-side rear: a trailing arm from ahead of the wheel and two radius rods.
        end = k.at(0, k.half - tire * 0.6, r - 0.04 * s)
        k.arm(group, 'Trailing', k.at(0.7 * s, 0.38 * s, r - 0.02 * s), end,
              lambda p, rel: boxed_trailing(p, rel, s, 'Graphite', 0.02, 0.07, None))
        for what, dx, z in (('RodUpper', -0.05, 0.12), ('RodLower', 0.05, -0.1)):
            k.arm(group, what, k.at(dx * s, 0.22 * s, r + z * s), k.at(dx * s, k.half - tire * 0.62, r + z * s),
                  lambda p, rel: rod(p, rel, s))
        br = b.rig_part(k.key, kind)
        br.box(tuple(k.at(0.7 * s, 0.38 * s, (r + 0.42) / 2)), (0.07 * s, 0.09 * s, 0.42 - r + 0.04 * s), 'Graphite')
        plate_y(br, k.x - 0.1 * s, k.x + 0.1 * s, side * 0.2 * s, r - 0.13 * s, r + 0.15 * s)
        low = k.hub_world + V((-0.06 * s, -side * inboard, -0.02 * s))
        top = k.at(0.1 * s, k.half - inboard - 0.27 * s, r + 0.95 * s)
        return dict(parent=k.hub, origin=k.hub_world, low=low, top=top)

    if kind == 'longTrailing':
        # Long-travel rear: a longer, deeper alloy trailing arm reaching under
        # the seats, longer radius rods, and the shock on the arm.
        end = k.at(0, k.half - tire * 0.6, r - 0.04 * s)
        ap = k.at(1.0 * s, 0.4 * s, r - 0.03 * s)
        arm, rel = k.arm(group, 'LongTrailing', ap, end,
                         lambda p, rel: boxed_trailing(p, rel, s, 'Alloy', 0.028, 0.1, -side * 0.16 * s))
        for what, dx, z in (('LongRodUpper', -0.05, 0.12), ('LongRodLower', 0.05, -0.1)):
            k.arm(group, what, k.at(dx * s, 0.12 * s, r + z * s), k.at(dx * s, k.half - tire * 0.62, r + z * s),
                  lambda p, rel: rod(p, rel, s, 'Alloy'))
        br = b.rig_part(k.key, kind)
        for out in (0.4, 0.4 - 0.16):
            br.box(tuple(k.at(1.0 * s, out * s, (r + 0.42) / 2)), (0.07 * s, 0.05 * s, 0.42 - r + 0.04 * s), 'Graphite')
        plate_y(br, k.x - 0.1 * s, k.x + 0.1 * s, side * 0.1 * s, r - 0.13 * s, r + 0.15 * s)
        low = k.on_arm(ap, rel, 0.9, (0, 0, 0.06 * s))
        return dict(parent=arm, origin=ap, low=low, top_xy=(low.x + 0.08 * s, side * (abs(low.y) - 0.26 * s)))

    if kind == 'wishbone':
        # The light 4x4's double wishbones: a long lower arm from a crossmember
        # under the frame, a shorter upper arm from the frame rail, the
        # coilover on a bracket at the back of the lower arm (behind the upper
        # arm, outboard of the rail), a tie rod from the steering rack, and a
        # half-shaft from the diff, which is bolted to the frame.
        ball = k.half - tire * 0.55
        lp = k.at(0, 0.2 * s, r - 0.1 * s)
        lbj = k.at(0, ball - 0.02 * s, r - 0.13 * s)

        def lower_arm(p, rel):
            wishbone(p, rel, 0.22 * s, 0.026 * s, 'Graphite', s)
            # The shock bracket, reaching back from the arm near the ball joint.
            a = rel * 0.86
            p.convex([a + V((0.0, 0, 0.012 * s)), a + V((-0.17 * s, 0, 0.012 * s)), a + V((0.0, -side * 0.05 * s, 0.012 * s)),
                      a + V((0.0, 0, -0.012 * s)), a + V((-0.17 * s, 0, -0.012 * s)),
                      a + V((0.0, -side * 0.05 * s, -0.012 * s))], 'Graphite')
            p.tube(tuple(a + V((-0.15 * s, -0.03 * s, 0.03 * s))), tuple(a + V((-0.15 * s, 0.03 * s, 0.03 * s))),
                   0.018 * s, 'Steel', segments=8)

        lower, rel = k.arm(group, 'Lower', lp, lbj, lower_arm)
        # The upper arm pivots on brackets on top of the frame rail and reaches
        # down to a tall knuckle on the upright.
        k.arm(group, 'Upper', k.at(-0.02 * s, 0.4 * s, r + 0.4 * s), k.at(-0.02 * s, ball - 0.07 * s, r + 0.25 * s),
              lambda p, rel: wishbone(p, rel, 0.16 * s, 0.022 * s, 'Graphite', s, plate=False))
        knuckle = b.fit('frontSusp', ['wishbone'], 'Knuckle' + k.c)
        iy = -side * tire * 0.55
        knuckle.convex([(0.035 * s, iy + 0.025 * s, 0.1 * s), (-0.035 * s, iy + 0.025 * s, 0.1 * s),
                        (0.035 * s, iy - 0.025 * s, 0.1 * s), (-0.035 * s, iy - 0.025 * s, 0.1 * s),
                        (0.01 * s, iy - side * 0.045 * s, 0.27 * s), (-0.05 * s, iy - side * 0.045 * s, 0.27 * s),
                        (0.01 * s, iy - side * 0.085 * s, 0.27 * s), (-0.05 * s, iy - side * 0.085 * s, 0.27 * s)],
                       'Graphite', bevel=0.006 * s)
        b.add(knuckle, k.hub)
        k.arm(group, 'Tie', k.at(0.14 * s, 0.25 * s, r + 0.02 * s), k.at(0.07 * s, ball - 0.02 * s, r + 0.02 * s),
              lambda p, rel: rod(p, rel, s, 'Steel'))
        low = k.on_arm(lp, rel, 0.86, (-0.15 * s, 0, 0.03 * s))
        return dict(parent=lower, origin=lp, low=low, top_xy=(low.x - 0.02 * s, side * (abs(low.y) - 0.01 * s)))

    if kind == 'trailingArm':
        # The light 4x4's independent rear: a boxed trailing arm on each side,
        # pivoting on a hanger under the frame rail, braced to a second
        # bushing inboard; the coilover on a bracket on the arm's inner side,
        # and a half-shaft from the diff on the frame.
        end = k.at(0, k.half - tire * 0.6, r - 0.04 * s)
        ap = k.at(0.8 * s, 0.5 * s, r + 0.04 * s)

        def trailing_arm(p, rel):
            boxed_trailing(p, rel, s, 'Graphite', 0.03, 0.09, -side * 0.2 * s)
            a = rel * 0.9
            p.box(tuple(a + V((0, -side * 0.05 * s, 0))), (0.09 * s, 0.07 * s, 0.05 * s), 'Graphite', bevel=0.006 * s)

        arm, rel = k.arm(group, 'Trailing', ap, end, trailing_arm)
        low = k.on_arm(ap, rel, 0.9, (0, -side * 0.065 * s, 0.0))
        return dict(parent=arm, origin=ap, low=low, top_xy=(low.x + 0.04 * s, low.y))

    raise ValueError(kind)


def independent_extras(b, key, kind, group):
    """The body-side parts of an independent layout on a truck that also has
    a beam axle there: the diff bolted to the frame (with each axle part's
    cover), the frame brackets the arms hang on, the steering rack, bump
    stops, an anti-roll bar and full armour's diff guard."""
    t, s, r = b.t, b.s, b.r
    x = t['cg_front'] if key == 'F' else -t['cg_rear']
    slot = 'frontSusp' if key == 'F' else 'rearSusp'
    zc = r + (0.0 if key == 'F' else 0.03)
    p = Part(f'Diff{key}_' + kind)
    p.lathe([(0.0, -0.1 * s), (0.12 * s, -0.08 * s), (0.14 * s, 0.0), (0.12 * s, 0.08 * s), (0.0, 0.1 * s)],
            'Graphite', segments=16, centre=(x, 0.0, zc), closed=False)
    for sd in (-1, 1):
        p.tube((x, sd * 0.08 * s, zc), (x, sd * 0.17 * s, zc), 0.045 * s, 'Graphite', segments=10)
    # The pinion's nose and a prop shaft to the transfer case. Both ends are
    # bolted to the frame here, so the shaft doesn't move.
    towards = -1 if key == 'F' else 1
    nose = V((x + towards * 0.24 * s, 0.0, zc + 0.02))
    p.tube((x + towards * 0.1 * s, 0.0, zc), tuple(nose), 0.075 * s, 'Graphite', segments=10, r2=0.05 * s)
    if key in b.outputs:
        fixed_prop(p, nose, b.outputs[key], s)
    rail_y, rail_low = 0.45, 0.54
    if kind == 'wishbone':
        # Crossmembers under the lower arm bushings, dropped from the rails.
        for dx in (0.22, -0.22):
            p.box((x + dx * s, 0, r - 0.1 * s), (0.07 * s, 0.5 * s, 0.06 * s), 'Graphite', bevel=0.008)
            for sd in (-1, 1):
                p.convex([(x + dx * s - 0.03, sd * 0.2 * s, r - 0.13 * s), (x + dx * s + 0.03, sd * 0.2 * s, r - 0.13 * s),
                          (x + dx * s - 0.03, sd * rail_y, rail_low), (x + dx * s + 0.03, sd * rail_y, rail_low),
                          (x + dx * s - 0.03, sd * (rail_y - 0.05), rail_low), (x + dx * s + 0.03, sd * (rail_y - 0.05), rail_low)],
                         'Graphite')
        for sd in (-1, 1):
            # Upper arm brackets standing on the rail, and a shock tower behind
            # the upper arm with a plate out to the top mount.
            for dx in (0.14, -0.18):
                p.box((x + dx * s, sd * 0.42 * s, r + 0.36 * s), (0.05 * s, 0.07 * s, 0.13 * s), 'Graphite')
            top = b.tops[(key + ('L' if sd > 0 else 'R'), kind)]
            tz = top.z + 0.03 * s
            p.convex([(x - 0.36 * s, sd * 0.47, 0.64), (x - 0.22 * s, sd * 0.47, 0.64),
                      (x - 0.36 * s, sd * 0.47, tz), (x - 0.24 * s, sd * 0.47, tz),
                      (x - 0.36 * s, sd * 0.5, 0.64), (x - 0.22 * s, sd * 0.5, 0.64),
                      (x - 0.36 * s, sd * 0.5, tz), (x - 0.24 * s, sd * 0.5, tz)], 'Graphite', bevel=0.006)
            plate = []
            for z in (tz, tz + 0.014):
                plate += [(x - 0.36 * s, sd * 0.47, z), (top.x - 0.06 * s, top.y + sd * 0.05 * s, z),
                          (top.x + 0.05 * s, top.y + sd * 0.05 * s, z), (top.x + 0.05 * s, sd * 0.47, z)]
            p.convex(plate, 'Graphite')
        # The steering rack and its boots.
        p.tube((x + 0.14 * s, -0.25 * s, r + 0.02 * s), (x + 0.14 * s, 0.25 * s, r + 0.02 * s), 0.03 * s, 'Graphite')
        for sd in (-1, 1):
            p.tube((x + 0.14 * s, sd * 0.17 * s, r + 0.02 * s), (x + 0.14 * s, sd * 0.25 * s, r + 0.02 * s), 0.036 * s,
                   'Rubber', segments=10, r2=0.022 * s)
    else:
        # Hangers for the trailing arms' bushings, under the rails.
        for sd in (-1, 1):
            for yy in (0.5, 0.3):
                p.convex([(x + 0.76 * s, sd * yy * s, r + 0.0), (x + 0.84 * s, sd * yy * s, r + 0.0),
                          (x + 0.72 * s, sd * yy * s, rail_low), (x + 0.88 * s, sd * yy * s, rail_low),
                          (x + 0.76 * s, sd * (yy - 0.02) * s, r + 0.0), (x + 0.84 * s, sd * (yy - 0.02) * s, r + 0.0),
                          (x + 0.72 * s, sd * (yy - 0.02) * s, rail_low), (x + 0.88 * s, sd * (yy - 0.02) * s, rail_low)],
                         'Graphite')
            # A bracket off the rail for the top of the shock.
            top = b.tops[(key + ('L' if sd > 0 else 'R'), kind)]
            tz = top.z + 0.03 * s
            p.box((top.x, sd * (abs(top.y) + 0.45) / 2 + sd * 0.03, tz), (0.12 * s, abs(top.y) - 0.39, 0.014), 'Graphite')
            p.box((top.x, sd * 0.47, (tz + 0.7) / 2), (0.1 * s, 0.03, tz - 0.7), 'Graphite')
        # A crossmember the diff hangs from.
        p.box((x, 0, 0.62), (0.12 * s, 0.9, 0.1), 'Graphite', bevel=0.01)
    b.add(p, group)

    for k in AXLES:
        p = b.fit('axles', [k], 'Diff' + key)
        diff_cover(p, k, (x, 0.08 * s, zc), s)
        b.add(p, group)

    # Bump stops: over the upper arm at the front, over the trailing arm at the back.
    for kb in BUMP_STOPS:
        p = b.fit('bumpStops', [kb], 'Ifs' + key)
        for sd in (-1, 1):
            if kind == 'wishbone':
                # Over the lower arm's back leg, hanging from the rail.
                pnt = (x - 0.07 * s, sd * 0.5, 0.5)
                bump_stop(p, pnt, s, kb)
                p.box((pnt[0], sd * 0.48, 0.52), (0.07 * s, 0.07, 0.04), 'Steel')
            else:
                pnt = (x + 0.2 * s, sd * 0.58, 0.62)
                bump_stop(p, pnt, s, kb)
                p.box((pnt[0], sd * 0.51, pnt[2] + 0.006), (0.06 * s, 0.1, 0.012), 'Steel')
        b.add(p, group)

    for kr, adj in (('fixedBars', False), ('adjustableBars', True)):
        p = b.fit('antiRoll', [kr], 'Ifs' + key)
        if kind == 'wishbone':
            roll_bar(p, x + 0.42, 0.42, 0.56, 0.42, r - 0.07, s, adj, flip=1)
        else:
            roll_bar(p, x + 0.45, 0.58, 0.5, 0.3, r + 0.02, s, adj, flip=1)
        b.add(p, group)

    p = b.fit('protection', ['fullArmour'], 'Diff' + key)
    p.box((x, 0, zc - 0.19 * s), (0.42 * s, 0.46 * s, 0.02), 'Steel', bevel=0.005)
    for sd in (-1, 1):
        p.box((x, sd * 0.22 * s, zc - 0.1 * s), (0.36 * s, 0.02, 0.18 * s), 'Steel')
    b.add(p, group)


def build_truck(cls, t, materials):
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    for mesh in list(bpy.data.meshes):
        bpy.data.meshes.remove(mesh)

    b = Build(cls, t, materials)
    r, s = b.r, b.s

    # Wheels and tires: one mesh each, shared by all four corners.
    tires = {k: kit_tire('Tire_' + k, t, k).to_mesh(materials) for k in TIRES}
    meshes = {}
    rims = {k: kit_rim('Rim_' + k, t, k).to_mesh(materials) for k in WHEELS}

    for c in CORNERS:
        x, y = corner_pos(t, c)
        side = 1 if c[1] == 'L' else -1

        hub = empty('Hub_' + c, None, (x, y, r))
        wh = empty('Wheel_' + c, hub, (0, 0, 0))
        place(wh, hub, (0, 0, 0))
        if side < 0:
            wh.rotation_euler = (0, 0, math.pi)
        for k in TIRES:
            place(link(fit_name('tires', [k], c), tires[k]), wh, (0, 0, 0))
        for k in WHEELS:
            place(link(fit_name('wheels', [k], c), rims[k]), wh, (0, 0, 0))

        # The upright behind the wheel, with the brake disc and caliper.
        up = Part('Upright_' + c)
        inner = -side * t['tire'] * 0.55
        # Taller on the side-by-side, whose wishbones' ball joints sit further apart.
        up.box((0, inner, 0), (0.08 * s, 0.06 * s, 0.42 * s if cls == 'sxs' else r * 0.75), 'Graphite', bevel=0.01 * s)
        up.lathe([(0.0, 0.0), (r * 0.42, 0.0), (r * 0.42, 0.018 * s), (0.0, 0.018 * s)], 'Steel', segments=18,
                 centre=(0, inner + side * 0.06 * s, 0), smooth=False)
        up.box((r * 0.28, inner + side * 0.07 * s, r * 0.22), (0.07 * s, 0.05 * s, 0.12 * s), 'Graphite',
               rot=Matrix.Rotation(-0.6, 3, 'Y'), bevel=0.01 * s)
        place(up.finish(materials), hub, (0, 0, 0))

        # What the wheel hangs on, in each layout at this end. The stock
        # layout's shock length is every layout's, so one set of shocks fits all.
        k = Corner(b, c, hub)
        stock = None
        for kind, lparts in b.layouts(c[0]):
            got = layout_corner(b, k, kind, b.rig(c[0], kind))
            low = V(got['low'])
            if stock is None:
                top = V(got['top'])
                stock = (top, low, (top - low).length)
                tag = ''
            else:
                top = solve_top(low, *got['top_xy'], stock[2])
                tag = '_' + '-'.join(lparts)
            b.tops[(c, kind)] = top
            empty('MountLow_' + c + tag, got['parent'], tuple(low - V(got['origin'])))
            empty('MountTop_' + c + tag, b.body, tuple(top))
        top_world, low_world, length = stock

        # The shock body: one variant per damper part, all hanging from the top mount.
        # The left and right shocks at each end are the same length, so they share meshes.
        key = round(length, 4)

        def shared(what, make):
            if (what, key) not in meshes:
                meshes[(what, key)] = make().to_mesh(materials)
            return meshes[(what, key)]

        sb = empty('ShockBody_' + c, None, tuple(top_world))
        for kd in DAMPERS:
            mesh = shared('damper-' + kd, lambda: kit_shock_body('Damper_' + kd, length, s, kd))
            place(link(fit_name('dampers', [kd], c), mesh), sb, (0, 0, 0))
        place(link('ShockShaft_' + c, shared('shaft', lambda: kit_shaft('Shaft', length, s))), None, tuple(low_world))
        spring = empty('Spring_' + c, None, tuple(top_world))
        coil = COIL.get(cls, {}).get(c[0])
        name = fit_name('frontSusp' if c[0] == 'F' else 'rearSusp', coil, 'Spring' + c) if coil else 'Coil_' + c
        place(link(name, shared('spring', lambda: kit_spring('Spring', length, s))), spring, (0, 0, 0))

        # Half-shafts from the diff out to the wheel, for the independent
        # layouts: thicker for heavy-duty axles, chrome with blue boots for
        # chromoly. The side-by-side's serve both of its layouts.
        kinds = [kd for kd, _ in b.layouts(c[0])]
        shaft = None
        if cls == 'sxs' and c[0] == 'F':
            shaft = (b.body, k.at(0, 0.32 * s, r + 0.02 * s), k.at(0, t['track'] / 2 - t['tire'] * 0.55, r + 0.02 * s))
        elif cls == 'sxs':
            shaft = (b.body, k.at(0.02 * s, 0.22 * s, r + 0.02 * s), k.at(0, t['track'] / 2 - t['tire'] * 0.6, r))
        elif 'wishbone' in kinds:
            shaft = (b.rig('F', 'wishbone'), k.at(0, 0.17 * s, r), k.at(0, t['track'] / 2 - t['tire'] * 0.55, r))
        elif 'trailingArm' in kinds:
            shaft = (b.rig('R', 'trailingArm'), k.at(0, 0.17 * s, r + 0.03), k.at(0, t['track'] / 2 - t['tire'] * 0.6, r))
        if shaft:
            obj, rel = k.arm(shaft[0], 'Shaft', shaft[1], shaft[2])
            for ka in AXLES:
                p = b.fit('axles', [ka], 'Shaft' + c)
                drive_shaft(p, (0, 0, 0), rel, ka, s)
                b.add(p, obj)

    # Solid axles: a beam between the two hubs with the diff in the middle.
    for key in ('F', 'R'):
        axle_parts = dict(b.layouts(key)).get('axle')
        if axle_parts is None:
            continue
        x = t['cg_front'] if key == 'F' else -t['cg_rear']
        half = t['track'] / 2 - t['tire'] * 0.55
        axle = Part('Axle_' + key)
        axle.tube((0, -half, 0), (0, half, 0), 0.045 * s, 'Graphite', segments=12)
        off = 0.12 * s
        axle.lathe([(0.0, -0.12 * s), (0.13 * s, -0.1 * s), (0.15 * s, 0.0), (0.13 * s, 0.1 * s), (0.0, 0.12 * s)],
                   'Graphite', segments=18, centre=(0, off, 0), closed=False)
        # Knuckle balls at the ends and the drive shaft forward or back to the gearbox.
        for sd in (-1, 1):
            axle.lathe([(0.0, -0.06 * s), (0.07 * s, -0.03 * s), (0.07 * s, 0.03 * s), (0.0, 0.06 * s)], 'Graphite',
                       segments=12, centre=(0, sd * half, 0), closed=False)
        # The pinion's nose, pointing at the transfer case, and the flange its
        # prop shaft bolts to (the shaft itself is added with the driveline).
        towards = -1 if key == 'F' else 1
        axle.tube((towards * 0.08 * s, off, 0.0), (towards * 0.25 * s, off, 0.015 * s), 0.08 * s, 'Graphite',
                  segments=10, r2=0.05 * s)
        axle.tube((towards * 0.25 * s, off, 0.015 * s), (towards * 0.275 * s, off, 0.018 * s), 0.06 * s, 'Steel',
                  segments=10)
        if key == 'F':
            # The steering tie rod in front of the beam.
            axle.tube((0.16 * s, -half + 0.05, -0.03 * s), (0.16 * s, half - 0.05, -0.03 * s), 0.018 * s, 'Steel')
            for sd in (-1, 1):
                axle.tube((0, sd * (half - 0.05), 0), (0.16 * s, sd * (half - 0.05), -0.03 * s), 0.02 * s, 'Graphite')
        # With independent arms to choose from, the axle sits in a group the game can hide.
        group = None
        if len(b.layouts(key)) > 1:
            group = empty(fit_name('frontSusp' if key == 'F' else 'rearSusp', axle_parts, 'Axle' + key), None, (0, 0, 0))
        axle_obj = place(axle.finish(materials), group, (x, 0, r))
        b.axles[key] = (axle_obj, half)
        b.pinions[key] = (axle_obj, V((x, 0, r)), V((x + towards * 0.31 * s, off, r + 0.02 * s)))

        # The axle parts: housings and diff covers get beefier with the price.
        for k in AXLES:
            p = b.fit('axles', [k], key)
            if k == 'standardAxles':
                p.lathe([(0.11 * s, 0.0), (0.11 * s, 0.03 * s), (0.08 * s, 0.05 * s), (0.0, 0.055 * s)], 'Graphite',
                        segments=16, centre=(0, off + 0.1 * s, 0), closed=False, smooth=False)
            elif k == 'heavyDutyAxles':
                for sd in (-1, 1):
                    p.tube((0, sd * 0.2 * s, 0), (0, sd * (half - 0.08), 0), 0.056 * s, 'Graphite', segments=12)
                p.box((0, 0, 0.065 * s), (0.05 * s, 2 * half - 0.2, 0.03 * s), 'Steel', bevel=0.006 * s)
                p.lathe([(0.13 * s, 0.0), (0.13 * s, 0.03 * s), (0.1 * s, 0.06 * s), (0.0, 0.065 * s)], 'Steel',
                        segments=16, centre=(0, off + 0.1 * s, 0), closed=False, smooth=False)
                for fin in range(-2, 3):
                    p.box((0, off + 0.16 * s, fin * 0.035 * s), (0.2 * s, 0.012 * s, 0.01 * s), 'Steel')
            else:
                p.lathe([(0.11 * s, 0.0), (0.11 * s, 0.03 * s), (0.08 * s, 0.05 * s), (0.0, 0.055 * s)], 'Anodised',
                        segments=16, centre=(0, off + 0.1 * s, 0), closed=False, smooth=False)
                for sd in (-1, 1):
                    p.lathe([(0.0, 0.0), (0.075 * s, 0.0), (0.075 * s, 0.015 * s), (0.0, 0.015 * s)], 'Chrome',
                            segments=14, centre=(0, sd * (half + 0.02 * s) - (0.0075 * s if sd > 0 else -0.0075 * s), 0),
                            smooth=False)
                p.box((0, 0, 0.06 * s), (0.03 * s, 2 * half - 0.3, 0.025 * s), 'Anodised')
            b.add(p, axle_obj)

        # Leaf springs or coil links, by the suspension part.
        rail = 0.45 if cls == 'light4x4' else 0.5
        leaf = LEAF[cls][key]
        p = b.fit('frontSusp' if key == 'F' else 'rearSusp', leaf, 'Leaf' + key)
        n = 4 if cls == 'light4x4' else 6
        lead = 1.15 * s if cls == 'light4x4' else 1.0 * s
        for sd in (-1, 1):
            y = sd * rail
            for k in range(n):
                ln = lead * (1 - k * 0.14)
                z = 0.05 * s + 0.024 * s * (n - k)
                # The main leaf, on top, is magenta: Bump Stop's springs are all highlighter pink.
                p.box((0, y, z), (ln, 0.065 * s, 0.018 * s), 'Magenta' if k == 0 else 'Steel')
            for dx in (-0.06 * s, 0.06 * s):
                p.tube((dx, y - 0.04 * s, -0.05 * s), (dx, y - 0.04 * s, 0.07 * s + 0.024 * s * n), 0.008 * s, 'Steel',
                       segments=6)
                p.tube((dx, y + 0.04 * s, -0.05 * s), (dx, y + 0.04 * s, 0.07 * s + 0.024 * s * n), 0.008 * s, 'Steel',
                       segments=6)
            p.box((0, y, -0.05 * s), (0.17 * s, 0.11 * s, 0.02 * s), 'Steel')
            # Shackle eyes at each end.
            for ex in (-lead / 2, lead / 2):
                p.tube((ex, y - 0.04 * s, 0.05 * s + 0.024 * s * n), (ex, y + 0.04 * s, 0.05 * s + 0.024 * s * n),
                       0.022 * s, 'Graphite', segments=8)
        b.add(p, axle_obj)

        p = b.fit('frontSusp' if key == 'F' else 'rearSusp', LINKS[cls][key], 'Links' + key)
        back = -1 if key == 'F' else 1
        for sd in (-1, 1):
            y = sd * rail * 0.9
            # Lower links (radius arms) running towards the middle of the truck, and their brackets.
            p.tube((0, y, -0.03 * s), (back * -0.85 * s, y * 0.95, 0.12 * s), 0.024 * s, 'Graphite', segments=8)
            p.box((0, y, -0.02 * s), (0.12 * s, 0.03 * s, 0.1 * s), 'Graphite')
            if key == 'R':
                p.tube((0, y * 0.5, 0.07 * s), (0.6 * s, y * 0.45, 0.2 * s), 0.02 * s, 'Graphite', segments=8)
            # A coil seat on the beam.
            p.lathe([(0.0, 0.0), (0.075 * s, 0.0), (0.075 * s, 0.015 * s), (0.0, 0.015 * s)], 'Graphite', segments=14,
                    centre=(0, sd * (half - 0.02), 0.05 * s), axis='Z', smooth=False)
        # The track bar that stops the axle sliding sideways.
        p.tube((back * 0.1 * s, -half + 0.1, 0.02 * s), (back * 0.1 * s, half - 0.25, 0.22 * s), 0.02 * s, 'Steel',
               segments=8)
        b.add(p, axle_obj)

    # The class's own body, frame and bolt-ons.
    {'light4x4': pickup, 'heavy': cabover, 'sxs': buggy}[cls](b)

    for (key, kd), part in b.rig_parts.items():
        b.add(part, b.rig(key, kd))

    # The body-side parts of the light 4x4's independent layouts.
    for key in ('F', 'R'):
        kinds = [kd for kd, _ in b.layouts(key)]
        for kd in kinds:
            if kd in ('wishbone', 'trailingArm'):
                independent_extras(b, key, kd, b.rig(key, kd))

    if b.drive is not b.shell:
        b.add(b.drive)
    shell = b.shell.finish(materials)
    place(shell, b.body, (0, 0, 0))

    path = os.path.join(OUT_DIR, f'truck-{cls}.glb')
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format='GLB',
        use_selection=True,
        export_yup=True,
        export_apply=False,
        export_animations=False,
        export_cameras=False,
        export_lights=False,
        export_extras=False,
        export_materials='EXPORT',
        export_texcoords=False,
    )
    # Zip it: the game unzips it in the browser (src/render/truckModel.ts). The
    # mesh numbers repeat a lot, so this makes the download about a fifth the
    # size. A fixed timestamp keeps the file the same when nothing changed.
    with open(path, 'rb') as f:
        raw = f.read()
    with open(path + '.gz', 'wb') as f:
        f.write(gzip.compress(raw, compresslevel=9, mtime=0))
    os.remove(path)
    print(f'wrote {path}.gz ({os.path.getsize(path + ".gz") // 1024} KB, {len(raw) // 1024} KB unzipped)')


# --- The driveline -------------------------------------------------------------
# What turns the wheels: the engine's block and sump, the gearbox, the
# transfer case and the prop shafts out to the diffs, plus the exhaust. It
# all sits between the frame rails, inboard of the springs and shocks, so
# the suspension stays in plain view from the side.
#
# A prop shaft to a solid axle has to follow the axle up and down, so it is
# two arms the game already knows how to move (see `Arm_...` at the top):
#
#     Arm_F_Prop       on the body, from the transfer case, pointing at the
#                      axle's pinion (ArmEnd_F_Prop, on the axle)
#     Arm_F_PropSlip   on the axle, from the pinion, pointing back at the
#                      transfer case (ArmEnd_F_PropSlip, on the body)
#
# The thin one slides inside the fat one, like a real shaft's slip joint, so
# the shaft gets longer and shorter as the axle moves without either arm
# having to stretch. (F is the front axle, R the rear.)

def pipe_run(p, points, rad, mat, segments=8):
    """A pipe through a list of points; each length runs a little into the
    next, so the bends close up."""
    pts = [V(q) for q in points]
    for a, c in zip(pts, pts[1:]):
        d = (c - a).normalized()
        p.tube(tuple(a - d * rad * 0.4), tuple(c + d * rad * 0.4), rad, mat, segments=segments)


def u_joint(p, at, along, s):
    """A universal joint on a shaft running `along`: a collar and the cross."""
    at, d = V(at), V(along).normalized()
    side = d.cross(V((0, 0, 1))).normalized()
    up = d.cross(side)
    p.tube(tuple(at - d * 0.035 * s), tuple(at + d * 0.035 * s), 0.042 * s, 'Graphite', segments=8)
    p.tube(tuple(at - side * 0.052 * s), tuple(at + side * 0.052 * s), 0.016 * s, 'Steel', segments=6)
    p.tube(tuple(at - up * 0.052 * s), tuple(at + up * 0.052 * s), 0.016 * s, 'Steel', segments=6)


def fixed_prop(p, a, e, s):
    """A prop shaft between two points that never move apart (both on the body)."""
    a, e = V(a), V(e)
    d = (e - a).normalized()
    p.tube(tuple(a + d * 0.05 * s), tuple(e - d * 0.05 * s), 0.028 * s, 'Steel', segments=10)
    u_joint(p, a + d * 0.04 * s, d, s)
    u_joint(p, e - d * 0.04 * s, d, s)


def moving_prop(b, key, parent, output):
    """The two-piece prop shaft from the transfer case's `output` (on the
    body, under `parent`) to the solid axle's pinion at end `key`."""
    s = b.s
    axle_obj, axle_at, pinion = b.pinions[key]
    output = V(output)
    rel = pinion - output
    d, length = rel.normalized(), rel.length
    # The body's half: the fat tube, with the slip joint's seal at its open end.
    part = Part(f'Arm_{key}_Prop')
    u_joint(part, d * 0.04 * s, d, s)
    part.tube(tuple(d * 0.06 * s), tuple(d * length * 0.56), 0.032 * s, 'Steel', segments=10)
    part.tube(tuple(d * (length * 0.56 - 0.035 * s)), tuple(d * length * 0.56), 0.039 * s, 'Graphite', segments=10)
    place(part.finish(b.materials), parent, tuple(output))
    empty(f'ArmEnd_{key}_Prop', axle_obj, tuple(pinion - axle_at))
    # The axle's half: the thin splined shaft that slides inside it.
    part = Part(f'Arm_{key}_PropSlip')
    u_joint(part, -d * 0.04 * s, d, s)
    part.tube(tuple(-d * 0.06 * s), tuple(-d * length * 0.62), 0.021 * s, 'Chrome', segments=8)
    place(part.finish(b.materials), axle_obj, tuple(pinion - axle_at))
    empty(f'ArmEnd_{key}_PropSlip', parent, tuple(output))


def gear_case(p, x0, x1, section, mat, bevel=0.012):
    """A cast housing: the same outline (a list of (y, z) points) from x0 to x1."""
    p.convex([(x, y, z) for x in (x0, x1) for (y, z) in section], mat, bevel=bevel)


def pickup_driveline(b):
    """The light 4x4: a straight six over the front axle, leaning back a
    little, a gearbox, and a transfer case that drops to the left, where
    both diffs are. The exhaust runs down the right, inside the rail."""
    t, s, r, p = b.t, b.s, b.r, b.drive
    off = 0.12 * s
    lean = 0.07  # radians the engine and gearbox lean back
    tilt = Matrix.Rotation(-lean, 3, 'Y')
    nose = V((1.92, 0, 0.9))
    back = V((-math.cos(lean), 0, -math.sin(lean)))
    up = V((-math.sin(lean), 0, math.cos(lean)))

    def at(along, lift=0.0, y=0.0):
        """A point `along` the crankshaft's line from the engine's nose, `lift` above it."""
        return tuple(nose + back * along + up * lift + V((0, y, 0)))

    # The block (its top is hidden under the bonnet), the sump ahead of the
    # axle, where the diff can't reach it at full bump, and an oil filter.
    p.box(at(0.42, 0.02), (0.84, 0.36, 0.3), 'Cast', rot=tilt, bevel=0.02)
    p.box(at(0.2, -0.2), (0.38, 0.26, 0.15), 'Cast', rot=tilt, bevel=0.03)
    p.tube(at(0.2, -0.275), at(0.2, -0.3), 0.02, 'Chrome', segments=6)
    p.tube(at(0.36, -0.04, 0.18), at(0.36, -0.04, 0.3), 0.045, 'Urethane', segments=10)
    # The crank pulley, the fan and the radiator behind the grille.
    p.tube(at(-0.01), at(-0.05), 0.09, 'Graphite', segments=12)
    p.tube(at(-0.05, 0.12), at(-0.07, 0.12), 0.17, 'Graphite', segments=12)
    p.box((2.1, 0, 0.9), (0.05, 0.62, 0.36), 'Alloy', bevel=0.01)
    p.box((2.1, 0, 0.7), (0.07, 0.66, 0.05), 'Graphite')
    # Bellhousing and gearbox, resting on the frame's cross member.
    p.tube(at(0.84), at(1.0), 0.19, 'Alloy', segments=12, r2=0.13)
    p.tube(at(1.0), at(1.5), 0.12, 'Alloy', segments=10, r2=0.1)
    for along in (1.12, 1.3):
        p.tube(at(along), at(along + 0.02), 0.128, 'Alloy', segments=10)
    p.box((0.6, 0, 0.695), (0.1, 0.18, 0.03), 'Rubber')
    # The transfer case: in from the gearbox at the top, out to both prop
    # shafts lower down on the left.
    out_z = 0.53
    gear_case(p, 0.1, 0.43, [(-0.1, 0.86), (0.1, 0.88), (0.25, 0.64), (0.24, 0.46), (0.06, 0.44), (-0.09, 0.66)], 'Alloy')
    for x0, x1 in ((0.43, 0.46), (0.07, 0.1)):
        p.tube((x0, off, out_z), (x1, off, out_z), 0.06, 'Steel', segments=10)
    b.outputs = {'F': V((0.47, off, out_z)), 'R': V((0.06, off, out_z))}
    for key in ('F', 'R'):
        moving_prop(b, key, b.rig(key, 'axle'), b.outputs[key])

    # The exhaust: down from the manifold on the right of the block, over the
    # cross members, through a silencer, and over the rear axle. Each engine
    # adds its own tailpipe from there (see the engine parts).
    y = -0.3
    pipe_run(p, [(1.45, -0.19, 0.92), (1.15, y + 0.03, 0.8), (0.75, y, 0.74), (0.45, y, 0.74), (0.3, y, 0.64)], 0.028, 'Pipe')
    p.tube((0.3, y, 0.63), (-0.3, y, 0.63), 0.08, 'Pipe', segments=12)
    for x in (0.3, -0.3):
        p.tube((x, y, 0.63), (x + (0.03 if x > 0 else -0.03), y, 0.63), 0.05, 'Pipe', segments=12)
    pipe_run(p, [(-0.3, y, 0.64), (-0.45, y, 0.74), EXHAUST_END], 0.028, 'Pipe')
    for x in (0.0, -1.0):
        p.tube((x, y, 0.72), (x, y - 0.1, 0.68), 0.008, 'Graphite', segments=4)

    # The fuel tank, strapped between the rails behind the rear axle.
    p.box((-1.95, 0.08, 0.6), (0.56, 0.5, 0.17), 'Graphite', bevel=0.03)
    for x in (-1.8, -2.1):
        p.box((x, 0.08, 0.6), (0.03, 0.51, 0.18), 'Steel')
    # Body mounts: the rubber blocks the cab and the bed sit on.
    for x in (0.95, 0.2, -0.45, -0.95, -2.15):
        for sd in (-1, 1):
            p.tube((x, sd * 0.45, 0.7), (x, sd * 0.45, 1.0), 0.04, 'Graphite', segments=8)
            p.tube((x, sd * 0.45, 0.83), (x, sd * 0.45, 0.87), 0.055, 'Rubber', segments=8)


# Where the light 4x4's shared exhaust ends, behind the rear axle; each
# engine's own tailpipe starts here.
EXHAUST_END = (-1.78, -0.3, 0.74)


def cabover_driveline(b):
    """The heavy truck: a big diesel under the cab, a gearbox behind it, and
    a transfer case of its own in the middle of the frame, with a prop shaft
    to each axle."""
    t, s, r, p = b.t, b.s, b.r, b.drive
    off = 0.12 * s
    crank = 1.38
    # The block, with its sump ahead of the front axle, and an oil filter.
    p.box((2.25, 0, 1.5), (1.25, 0.52, 0.62), 'Cast', bevel=0.03)
    p.box((2.52, 0, 1.1), (0.36, 0.38, 0.22), 'Cast', bevel=0.04)
    p.tube((2.2, 0.26, 1.3), (2.2, 0.4, 1.3), 0.07, 'Urethane', segments=10)
    # Bellhousing and gearbox, resting on a cross member.
    p.tube((1.625, 0, crank), (1.45, 0, crank), 0.3, 'Alloy', segments=14, r2=0.22)
    p.tube((1.45, 0, crank), (0.78, 0, crank), 0.2, 'Alloy', segments=12, r2=0.17)
    for x in (1.3, 1.05):
        p.tube((x, 0, crank), (x - 0.03, 0, crank), 0.21, 'Alloy', segments=12)
    # A short shaft back to the transfer case, which drops to the left.
    out_z = 0.8
    fixed_prop(p, (0.78, 0, crank), (0.5, 0, crank - 0.02), s * 0.8)
    gear_case(p, 0.08, 0.5, [(-0.15, 1.5), (0.15, 1.52), (0.38, 1.0), (0.36, 0.7), (0.05, 0.67), (-0.17, 1.02)], 'Alloy',
              bevel=0.02)
    for x0, x1 in ((0.5, 0.54), (0.04, 0.08)):
        p.tube((x0, off, out_z), (x1, off, out_z), 0.09, 'Steel', segments=10)
    b.outputs = {'F': V((0.55, off, out_z)), 'R': V((0.03, off, out_z))}
    for key in ('F', 'R'):
        moving_prop(b, key, b.body, b.outputs[key])
    # The cab sits on four mounts, and the service box on two bearers along
    # the rails.
    for x in (3.0, 1.62):
        for sd in (-1, 1):
            p.box((x, sd * 0.5, 1.35), (0.16, 0.14, 0.27), 'Graphite', bevel=0.02)
            p.box((x, sd * 0.5, 1.38), (0.19, 0.17, 0.05), 'Rubber')
    side_pair(p, -1.08, 0.5, 1.33, (3.7, 0.1, 0.22), 'Graphite', bevel=0.012)
    # Air tanks for the brakes, across the frame behind the transfer case.
    for x in (-0.38, -0.62):
        p.tube((x, -0.4, 1.02), (x, 0.4, 1.02), 0.1, 'Steel', segments=12)
        for sd in (-1, 1):
            p.tube((x, sd * 0.3, 1.02), (x, sd * 0.33, 1.02), 0.105, 'Graphite', segments=12)


def buggy_driveline(b):
    """The side-by-side: the engine sits over the rear wheels and drives a
    gearcase between them; a thin prop shaft runs forward under the floor to
    a small diff between the front wheels."""
    t, s, r, p = b.t, b.s, b.r, b.drive
    fx, rx = t['cg_front'], -t['cg_rear']
    z0 = r + 0.02 * s  # the half-shafts' height
    # The front diff, with a tube out to each half-shaft's inner joint.
    p.lathe([(0.0, -0.09 * s), (0.075 * s, -0.07 * s), (0.092 * s, 0.0), (0.075 * s, 0.07 * s), (0.0, 0.09 * s)], 'Alloy',
            segments=14, centre=(fx, 0, z0), closed=False)
    for sd in (-1, 1):
        p.tube((fx, sd * 0.07 * s, z0), (fx, sd * 0.29 * s, z0), 0.032 * s, 'Graphite', segments=8)
        p.tube((fx, sd * 0.27 * s, z0), (fx, sd * 0.31 * s, z0), 0.05 * s, 'Steel', segments=10)
    p.tube((fx - 0.06, 0, z0), (fx - 0.2, 0, z0), 0.045, 'Alloy', segments=10, r2=0.032)
    # The rear gearcase under the engine, with a cup for each half-shaft.
    gear_case(p, rx - 0.17, rx + 0.2, [(-0.15, 0.5), (0.15, 0.5), (0.17, 0.34), (0.1, 0.27), (-0.1, 0.27), (-0.17, 0.34)], 'Alloy',
              bevel=0.02)
    for sd in (-1, 1):
        p.tube((rx + 0.02 * s, sd * 0.15, z0), (rx + 0.02 * s, sd * 0.2 * s, z0), 0.05 * s, 'Steel', segments=10)
    p.tube((rx + 0.2, 0, z0), (rx + 0.28, 0, z0), 0.045, 'Alloy', segments=10, r2=0.032)
    # The prop shaft, dipping under the floor, with a bearing where it bends.
    low = 0.374
    pts = [V((fx - 0.2, 0, z0)), V((0.93, 0, low)), V((-0.93, 0, low)), V((rx + 0.28, 0, z0))]
    for a, e in zip(pts, pts[1:]):
        d = (e - a).normalized()
        p.tube(tuple(a), tuple(e), 0.017, 'Steel', segments=8)
        u_joint(p, a + d * 0.03, d, s * 0.7)
    u_joint(p, pts[-1] - V((0.03, 0, 0)), V((1, 0, 0)), s * 0.7)


# --- Bodies -----------------------------------------------------------------
# Each body is built round the wheels: bodywork starts above full bump, so a
# wheel at the end of its travel just reaches the arch.

def side_pair(p, x, y, z, size, mat, bevel=0.0):
    for s in (-1, 1):
        p.box((x, s * y, z), size, mat, bevel=bevel)


def lamp_bar(p, x, z, width, n, scale=1.0, face=1):
    """A bar of round lamps; `face` 1 points them forwards, -1 backwards."""
    p.box((x, 0, z), (0.09 * scale, width, 0.12 * scale), 'Graphite', bevel=0.015 * scale)
    for k in range(n):
        y = -width / 2 + width * (k + 0.5) / n
        rad = min(width / n * 0.38, 0.05 * scale)
        p.tube((x + face * 0.04 * scale, y, z), (x + face * 0.055 * scale, y, z), rad, 'Lamp', segments=12, smooth=False)
        p.tube((x + face * 0.035 * scale, y, z), (x + face * 0.05 * scale, y, z), rad * 1.2, 'Steel', segments=12,
               smooth=False)


def round_lamp(p, x, y, z, rad, face=1, mat='Lamp', rim='Graphite'):
    p.tube((x - face * 0.04, y, z), (x + face * 0.01, y, z), rad * 1.25, rim, segments=12, smooth=False)
    p.tube((x, y, z), (x + face * 0.016, y, z), rad, mat, segments=12, smooth=False)


def flare(p, x, r, y_out, z_floor, width, depth, mat):
    """A wheel-arch flare on both sides, over a wheel at `x`, down to `z_floor`."""
    r_in = z_floor - r + 0.12  # the arch's top sits a little above the sill
    a = math.degrees(math.asin(max(-1.0, min(1.0, (z_floor - 0.1 - r) / (r_in + depth)))))
    for s in (-1, 1):
        y0, y1 = s * (y_out - width), s * (y_out + 0.02)
        p.arch(x, r, r_in, r_in + depth, min(y0, y1), max(y0, y1), a, 180 - a, mat, segs=12)


def pickup(b):
    """The light 4x4: a lifted single-cab pickup with a roof lamp bar, a bull
    bar and a sport bar over the bed."""
    t, s, body = b.t, b.s, b.shell
    w = 1.84
    sill = 1.02  # bodywork starts here, above the wheels at full bump
    belt = 1.48
    xb, xf, top = -0.55, 1.15, 2.02
    xr = -2.4
    centre = (0.3, 0, 1.4)

    # The cab: a box that leans in towards the roof, with a raked windscreen.
    body.convex([(xf, w / 2, sill), (xf, -w / 2, sill), (xb, -w / 2, sill), (xb, w / 2, sill),
                 (xf, w / 2, belt), (xf, -w / 2, belt), (xb, -w / 2, belt), (xb, w / 2, belt),
                 (xf - 0.58, w / 2 - 0.12, top), (xf - 0.58, -w / 2 + 0.12, top),
                 (xb + 0.04, -w / 2 + 0.12, top), (xb + 0.04, w / 2 - 0.12, top)], 'Paint', bevel=0.035)

    def screen(u, sd, inset):
        """A point on the windscreen: u from the bonnet (0) to the roof (1)."""
        a = V((xf, sd * w / 2, belt))
        c = V((xf - 0.58, sd * (w / 2 - 0.12), top))
        pnt = a.lerp(c, u)
        pnt.y -= sd * inset
        return pnt

    body.panel([screen(0.08, 1, 0.1), screen(0.08, -1, 0.1), screen(0.92, -1, 0.1), screen(0.92, 1, 0.1)], 'Glass',
               centre)

    def side(x, u, sd):
        return V((x, sd * (w / 2 - 0.12 * u), belt + (top - belt) * u))

    for sd in (-1, 1):
        u0, u1 = 0.1, 0.88
        # The door window and the small rear quarter window, split by the B pillar.
        body.panel([side(0.06, u0, sd), side(xf - 0.58 * u0 - 0.1, u0, sd), side(xf - 0.58 * u1 - 0.07, u1, sd),
                    side(0.06, u1, sd)], 'Glass', centre)
        body.panel([side(xb + 0.1, u0, sd), side(-0.08, u0, sd), side(-0.08, u1, sd), side(xb + 0.1, u1, sd)], 'Glass',
                   centre)
    body.panel([(xb, 0.62, belt + 0.1), (xb, -0.62, belt + 0.1), (xb + 0.035, -0.58, top - 0.08),
                (xb + 0.035, 0.58, top - 0.08)], 'Glass', centre)

    # The bonnet, sloping a little to the grille, with a raised centre.
    body.convex([(xf, w / 2, sill), (xf, -w / 2, sill), (2.22, w / 2 - 0.05, sill + 0.02),
                 (2.22, -w / 2 + 0.05, sill + 0.02), (xf, w / 2 - 0.01, belt), (xf, -w / 2 + 0.01, belt),
                 (2.2, w / 2 - 0.09, 1.37), (2.2, -w / 2 + 0.09, 1.37)], 'Paint', bevel=0.035)
    body.convex([(xf, 0.42, belt + 0.01), (xf, -0.42, belt + 0.01), (2.1, 0.36, 1.39), (2.1, -0.36, 1.39),
                 (xf, 0.48, belt - 0.03), (xf, -0.48, belt - 0.03), (2.1, 0.42, 1.36), (2.1, -0.42, 1.36)],
                'Paint', bevel=0.015)
    # Grille with slats, round headlamps and indicators.
    body.box((2.225, 0, 1.2), (0.03, 1.12, 0.3), 'Graphite')
    for k in range(4):
        body.box((2.245, 0, 1.1 + k * 0.065), (0.02, 1.0, 0.025), 'Trim')
    for sd in (-1, 1):
        round_lamp(body, 2.24, sd * 0.72, 1.22, 0.085)
        body.box((2.235, sd * 0.86, 1.08), (0.03, 0.08, 0.05), 'Amber')
    # Front bumper with magenta tow hooks.
    body.box((2.3, 0, 0.98), (0.2, w + 0.02, 0.18), 'Trim', bevel=0.03)
    for sd in (-1, 1):
        body.tube((2.42, sd * 0.42, 0.92), (2.42, sd * 0.42, 1.0), 0.02, 'Magenta', segments=6)
    # The bull bar, bolted through to the frame.
    for sd in (-1, 1):
        body.tube((2.36, sd * 0.55, 1.05), (2.36, sd * 0.55, 1.44), 0.035, 'Graphite')
        body.tube((2.36, sd * 0.55, 1.44), (2.3, sd * 0.32, 1.5), 0.035, 'Graphite')
        body.tube((2.36, sd * 0.5, 1.06), (2.15, sd * 0.45, 0.68), 0.03, 'Graphite')
    body.tube((2.3, -0.32, 1.5), (2.3, 0.32, 1.5), 0.035, 'Graphite')
    body.tube((2.36, -0.55, 1.28), (2.36, 0.55, 1.28), 0.025, 'Graphite')
    for sd in (-1, 1):
        round_lamp(body, 2.38, sd * 0.3, 1.32, 0.07)

    # Door shut lines, handles, mirrors, number boards and the magenta stripe.
    for sd in (-1, 1):
        y = sd * (w / 2 + 0.003)
        body.box((xf - 0.06, y, (sill + belt) / 2), (0.012, 0.006, belt - sill - 0.08), 'Graphite')
        body.box((-0.02, y, (sill + belt) / 2), (0.012, 0.006, belt - sill - 0.08), 'Graphite')
        body.box((0.08, sd * (w / 2 + 0.012), belt - 0.1), (0.12, 0.02, 0.035), 'Trim', bevel=0.008)
        body.tube((xf - 0.12, sd * (w / 2 - 0.02), belt + 0.05), (xf - 0.08, sd * (w / 2 + 0.12), belt + 0.12), 0.015,
                  'Graphite', segments=6)
        body.box((xf - 0.08, sd * (w / 2 + 0.16), belt + 0.14), (0.05, 0.14, 0.11), 'Trim', bevel=0.012)
        body.box((-0.08, sd * (w / 2 + 0.006), sill + 0.2), (4.6, 0.012, 0.07), 'Magenta')
        body.box((0.55, sd * (w / 2 + 0.008), sill + 0.38), (0.5, 0.012, 0.26), 'Board')
    # A whip aerial on the cab corner.
    body.tube((xf - 0.1, w / 2 - 0.05, belt + 0.02), (xf - 0.3, w / 2 - 0.05, top + 0.6), 0.006, 'Graphite', segments=4)

    # The bed: a floor and three walls with capped rails, open on top.
    xbf = xb - 0.08
    body.box(((xbf + xr) / 2, 0, sill + 0.03), (xbf - xr, w, 0.06), 'Paint')
    for sd in (-1, 1):
        body.box(((xbf + xr) / 2, sd * (w / 2 - 0.03), sill + 0.27), (xbf - xr, 0.06, 0.48), 'Paint', bevel=0.02)
        body.box(((xbf + xr) / 2, sd * (w / 2 - 0.03), sill + 0.52), (xbf - xr + 0.02, 0.09, 0.03), 'Trim', bevel=0.01)
        # Stake pockets along the rail.
        for k in range(3):
            body.box((xbf - 0.25 - k * 0.6, sd * (w / 2 - 0.03), sill + 0.535), (0.06, 0.05, 0.01), 'Graphite')
    body.box((xbf + 0.03, 0, sill + 0.27), (0.06, w, 0.48), 'Paint')
    # The tailgate, with its handle and tail lamps.
    body.box((xr + 0.03, 0, sill + 0.27), (0.06, w - 0.02, 0.48), 'Paint', bevel=0.02)
    body.box((xr - 0.005, 0, sill + 0.4), (0.02, 0.24, 0.05), 'Graphite')
    for sd in (-1, 1):
        body.box((xr - 0.005, sd * (w / 2 - 0.08), sill + 0.3), (0.025, 0.1, 0.24), 'TailLamp', bevel=0.01)
    body.box((xr - 0.06, 0, sill - 0.04), (0.12, w - 0.1, 0.12), 'Trim', bevel=0.02)

    # The sport bar over the bed, with two lamps facing back.
    bx = xbf - 0.2
    for sd in (-1, 1):
        body.tube((bx, sd * 0.84, sill + 0.55), (bx, sd * 0.72, top + 0.06), 0.035, 'Trim')
        body.tube((bx, sd * 0.78, top - 0.15), (bx - 0.7, sd * 0.84, sill + 0.55), 0.03, 'Trim')
    body.tube((bx, -0.72, top + 0.06), (bx, 0.72, top + 0.06), 0.035, 'Trim')
    for sd in (-1, 1):
        round_lamp(body, bx - 0.04, sd * 0.4, top + 0.13, 0.06, face=-1)

    # Wheel arch flares over each wheel, and mud flaps behind the rears.
    for x in (t['cg_front'], -t['cg_rear']):
        flare(body, x, b.r, w / 2 + 0.06, sill, 0.16, 0.06, 'Trim')
    for sd in (-1, 1):
        body.box((-t['cg_rear'] - 0.62, sd * (t['track'] / 2), 0.62), (0.02, 0.32, 0.42), 'Rubber')
    # Roof lamp bar and its brackets.
    lamp_bar(body, xf - 0.66, top + 0.1, 1.4, 5)
    for sd in (-1, 1):
        body.tube((xf - 0.66, sd * 0.6, top + 0.04), (xf - 0.66, sd * 0.6, top), 0.012, 'Graphite', segments=6)

    pickup_driveline(b)
    pickup_frames(b, sill)
    pickup_bolt_ons(b, sill, w, xb, xf, top, xr)


def pickup_frames(b, sill):
    s = b.s
    rail_z, rail_y = 0.62, 0.45
    # Ladder: two plain rails and cross members.
    p = b.fit('frame', ['ladder'])
    side_pair(p, -0.1, rail_y, rail_z, (4.4, 0.1, 0.16), 'Graphite', bevel=0.01)
    for x in (1.7, 0.6, -0.6, -1.9):
        p.box((x, 0, rail_z), (0.1, 0.9, 0.12), 'Graphite', bevel=0.01)
    b.add(p)
    # Boxed ladder: deeper rails boxed in with plate, and gussets at every cross member.
    p = b.fit('frame', ['boxedLadder'])
    side_pair(p, -0.1, rail_y, rail_z, (4.4, 0.11, 0.2), 'Graphite', bevel=0.012)
    side_pair(p, -0.1, rail_y + 0.058, rail_z, (4.2, 0.008, 0.17), 'Steel')
    for x in (1.7, 0.6, -0.6, -1.9):
        p.box((x, 0, rail_z), (0.12, 0.9, 0.14), 'Graphite', bevel=0.01)
        for sd in (-1, 1):
            p.convex([(x - 0.15, sd * (rail_y - 0.05), rail_z + 0.06), (x + 0.15, sd * (rail_y - 0.05), rail_z + 0.06),
                      (x, sd * (rail_y - 0.2), rail_z + 0.06), (x - 0.15, sd * (rail_y - 0.05), rail_z + 0.05),
                      (x + 0.15, sd * (rail_y - 0.05), rail_z + 0.05), (x, sd * (rail_y - 0.2), rail_z + 0.05)], 'Steel')
    b.add(p)
    # Spaceframe: welded tubes, triangulated, with the bed frame showing.
    p = b.fit('frame', ['spaceframe'])
    for sd in (-1, 1):
        y = sd * rail_y
        p.tube((2.1, y, rail_z - 0.03), (-2.3, y, rail_z - 0.03), 0.04 * s, 'Trim', segments=8)
        p.tube((1.9, y * 1.7, sill - 0.04), (-2.3, y * 1.7, sill - 0.04), 0.032 * s, 'Trim', segments=8)
        for k in range(6):
            x0 = 1.9 - k * 0.7
            x1 = x0 - 0.7
            p.tube((x0, y, rail_z - 0.03), (x1, y * 1.7, sill - 0.04), 0.024 * s, 'Trim', segments=6)
            p.tube((x0, y, rail_z - 0.03), (x0, y * 1.7, sill - 0.04), 0.024 * s, 'Trim', segments=6)
    for x in (1.7, 0.6, -0.6, -1.9):
        p.tube((x, -rail_y, rail_z - 0.03), (x, rail_y, rail_z - 0.03), 0.032 * s, 'Trim', segments=8)
    b.add(p)


def pickup_bolt_ons(b, sill, w, xb, xf, top, xr):
    t, s, r = b.t, b.s, b.r
    fx, rx = t['cg_front'], -t['cg_rear']

    # Bump stops under the frame rails, over each end of the axles. (The
    # independent layouts have their own: see independent_extras.)
    for k in BUMP_STOPS:
        for key, x in (('F', fx), ('R', rx)):
            p = b.fit('bumpStops', [k], key)
            for sd in (-1, 1):
                bump_stop(p, (x, sd * 0.45, 0.54), s, k)
            b.add(p, b.rig(key, 'axle'))

    # Anti-roll bars across the frame, with links down to the axles.
    for k, adj in (('fixedBars', False), ('adjustableBars', True)):
        for key in ('F', 'R'):
            p = b.fit('antiRoll', [k], key)
            if key == 'F':
                roll_bar(p, fx + 0.42, 0.42, 0.56, 0.42, r + 0.06, s, adj, flip=1)
            else:
                roll_bar(p, rx - 0.42, 0.42, 0.56, 0.42, r + 0.06, s, adj, flip=-1)
            b.add(p, b.rig(key, 'axle'))

    # Guards: plates under the nose and the gearbox; full armour adds rock
    # sliders down the sills, a guard for the tank and plates on the diffs.
    for k in ('skidPlates', 'fullArmour'):
        heavy = k == 'fullArmour'
        th = 0.012 if not heavy else 0.02
        p = b.fit('protection', [k])
        p.convex([(2.36, 0.5, 0.86), (2.36, -0.5, 0.86), (1.8, 0.45, 0.5), (1.8, -0.45, 0.5),
                  (2.36, 0.5, 0.86 + th), (2.36, -0.5, 0.86 + th), (1.8, 0.45, 0.5 + th), (1.8, -0.45, 0.5 + th)],
                 'Steel', bevel=0.006)
        # The gearbox plate: under the transfer case, hung from the rails.
        p.box((0.28, 0, 0.42), (0.9, 0.8, th), 'Steel', bevel=0.005)
        for x in (0.66, -0.1):
            for sd in (-1, 1):
                p.tube((x, sd * 0.38, 0.42), (x, sd * 0.43, 0.56), 0.014, 'Graphite', segments=6)
        if heavy:
            for sd in (-1, 1):
                y = sd * (w / 2 + 0.02)
                p.tube((xf - 0.05, y, sill - 0.06), (xb + 0.05, y, sill - 0.06), 0.04, 'Graphite', segments=10)
                for x in (xf - 0.15, 0.3, xb + 0.15):
                    p.tube((x, y, sill - 0.06), (x, sd * 0.5, 0.62), 0.03, 'Graphite', segments=8)
            p.box((-1.95, 0, 0.5), (0.7, 0.7, th), 'Steel', bevel=0.005)
            p.box((-1.95, 0, 0.62), (0.7, 0.9, 0.04), 'Graphite')
            for key in ('F', 'R'):
                axle_obj, half = b.axles[key]
                d = b.fit('protection', [k], 'Axle' + key)
                off = 0.12 * s
                d.convex([(0.16 * s, off + 0.14 * s, -0.04 * s), (-0.16 * s, off + 0.14 * s, -0.04 * s),
                          (0.16 * s, off - 0.12 * s, -0.04 * s), (-0.16 * s, off - 0.12 * s, -0.04 * s),
                          (0.12 * s, off + 0.1 * s, -0.17 * s), (-0.12 * s, off + 0.1 * s, -0.17 * s),
                          (0.12 * s, off - 0.08 * s, -0.17 * s), (-0.12 * s, off - 0.08 * s, -0.17 * s)],
                         'Steel', bevel=0.008 * s)
                b.add(d, axle_obj)
        b.add(p)

    # Spares: one wheel and a crate in the bed, or two wheels on a carrier, a
    # bigger crate and jerry cans.
    p = b.fit('spares', ['lightKit'])
    spare_wheel(p, (-1.6, 0.25, sill + 0.21), t)
    crate(p, (-2.05, -0.55, sill + 0.17), (0.4, 0.5, 0.22), s)
    b.add(p)
    p = b.fit('spares', ['fullKit'])
    for sd in (-1, 1):
        spare_wheel(p, (xb - 0.42, sd * 0.42, sill + 0.48), t, axis='X')
        p.tube((xb - 0.42 + 0.17, sd * 0.42, sill + 0.48), (xb - 0.2, sd * 0.42, sill + 0.48), 0.03, 'Graphite')
    crate(p, (-1.85, 0.4, sill + 0.19), (0.7, 0.55, 0.26), s)
    crate(p, (-1.85, -0.35, sill + 0.17), (0.5, 0.45, 0.22), s)
    for k in range(2):
        jerry_can(p, (-2.2, -0.5 + k * 0.36, sill + 0.29), s)
    b.add(p)

    # The engine shows on the outside: the V8 has a bonnet scoop and twin
    # pipes, the diesels a snorkel, the turbo diesel an intercooler too.
    # (The block, gearbox and the rest of the exhaust are the same for all:
    # see pickup_driveline.)
    # Every engine has its own tailpipe, from where the shared exhaust ends
    # behind the rear axle: the six a single pipe under the bumper, the V8
    # one out to each corner, the diesels a side exit behind the wheel.
    p = b.fit('engine', ['petrolSix'])
    pipe_run(p, [EXHAUST_END, (-2.2, -0.3, 0.66), (xr - 0.02, -0.3, 0.64)], 0.028, 'Pipe')
    p.tube((xr - 0.02, -0.3, 0.64), (xr - 0.12, -0.3, 0.64), 0.035, 'Chrome', segments=10)
    b.add(p)
    p = b.fit('engine', ['petrolV8'])
    p.convex([(1.6, 0.26, 1.42), (1.6, -0.26, 1.42), (1.25, 0.3, 1.47), (1.25, -0.3, 1.47),
              (1.55, 0.22, 1.5), (1.55, -0.22, 1.5), (1.25, 0.26, 1.58), (1.25, -0.26, 1.58)], 'Graphite', bevel=0.012)
    p.box((1.57, 0, 1.47), (0.02, 0.4, 0.07), 'Rubber')
    for sd in (-1, 1):
        pipe_run(p, [EXHAUST_END, (-2.05, sd * 0.3 - 0.0, 0.8), (-2.25, sd * 0.55, sill - 0.12), (xr - 0.02, sd * 0.55, sill - 0.12)],
                 0.028, 'Pipe')
        p.tube((xr - 0.02, sd * 0.55, sill - 0.12), (xr - 0.12, sd * 0.55, sill - 0.12), 0.035, 'Chrome', segments=10)
    b.add(p)
    for k in ('dieselFour', 'turboDiesel'):
        p = b.fit('engine', [k])
        y = -(w / 2 + 0.05)
        pts = [(xf + 0.35, y, sill + 0.08), (xf + 0.05, y, 1.46), (xf - 0.52, y + 0.02, top - 0.04),
               (xf - 0.62, y + 0.02, top + 0.18)]
        for a, c in zip(pts, pts[1:]):
            p.tube(a, c, 0.045, 'Graphite', segments=10)
        p.convex([(xf - 0.55, y - 0.06, top + 0.18), (xf - 0.55, y + 0.1, top + 0.18), (xf - 0.75, y - 0.06, top + 0.18),
                  (xf - 0.75, y + 0.1, top + 0.18), (xf - 0.52, y - 0.05, top + 0.34), (xf - 0.52, y + 0.09, top + 0.34),
                  (xf - 0.72, y - 0.05, top + 0.3), (xf - 0.72, y + 0.09, top + 0.3)], 'Graphite', bevel=0.015)
        pipe_run(p, [EXHAUST_END, (rx - 0.44, -0.3, 0.5), (rx - 0.5, -0.6, 0.5)], 0.028, 'Pipe')
        p.tube((rx - 0.5, -0.6, 0.5), (rx - 0.5, -0.6 - 0.25, 0.48), 0.03, 'Steel', segments=8)
        if k == 'turboDiesel':
            p.box((2.25, 0, 1.0), (0.04, 0.8, 0.12), 'Alloy', bevel=0.01)
            for sd in (-1, 1):
                p.box((1.75, sd * 0.22, 1.415), (0.3, 0.12, 0.02), 'Graphite')
        b.add(p)


def cabover(b):
    """The heavy truck: a cab-over rally truck with a service box, sand
    ladders and a roof deflector."""
    t, s, body = b.t, b.s, b.shell
    w = 2.36
    sill = 1.48
    xb, xf, top = 1.45, 3.25, 3.4
    xr = -3.05
    centre = (2.3, 0, 2.4)

    # The cab over the front axle, rounded at the corners, with a raked top front edge.
    body.convex([(xf, w / 2, sill), (xf, -w / 2, sill), (xb, -w / 2, sill), (xb, w / 2, sill),
                 (xf, w / 2 - 0.04, top - 0.55), (xf, -w / 2 + 0.04, top - 0.55),
                 (xf - 0.22, w / 2 - 0.1, top), (xf - 0.22, -w / 2 + 0.1, top),
                 (xb, -w / 2 + 0.06, top), (xb, w / 2 - 0.06, top)], 'Paint', bevel=0.06)
    # A roof deflector to push air over the box.
    body.convex([(xf - 0.4, w / 2 - 0.2, top), (xf - 0.4, -w / 2 + 0.2, top), (xb + 0.05, -w / 2 + 0.15, top),
                 (xb + 0.05, w / 2 - 0.15, top), (xb + 0.05, w / 2 - 0.18, top + 0.42),
                 (xb + 0.05, -w / 2 + 0.18, top + 0.42), (xb + 0.35, w / 2 - 0.2, top + 0.4),
                 (xb + 0.35, -w / 2 + 0.2, top + 0.4)], 'Paint', bevel=0.04)

    def slope(u, sd, y):
        """A point on the cab's raked top front edge: u from where it starts (0) to the roof (1)."""
        a = V((xf, sd * (w / 2 - 0.04), top - 0.55))
        c = V((xf - 0.22, sd * (w / 2 - 0.1), top))
        pnt = a.lerp(c, u)
        pnt.y = sd * y
        return pnt

    # A big split windscreen in two panes (each part upright, part raked), side windows and a sun visor.
    for sd in (-1, 1):
        lo = top - 0.55
        body.panel([(xf, sd * 0.05, 2.3), (xf, sd * (w / 2 - 0.16), 2.3), (xf, sd * (w / 2 - 0.16), lo),
                    (xf, sd * 0.05, lo)], 'Glass', centre)
        body.panel([slope(0.0, sd, 0.05), slope(0.0, sd, w / 2 - 0.16), slope(0.6, sd, w / 2 - 0.2),
                    slope(0.6, sd, 0.05)], 'Glass', centre)
        body.panel([(xf - 0.2, sd * (w / 2), 2.25), (xb + 0.65, sd * (w / 2), 2.25), (xb + 0.65, sd * (w / 2 - 0.06), 3.1),
                    (xf - 0.2, sd * (w / 2 - 0.05), 3.1)], 'Glass', centre)
    body.convex([(xf + 0.3, w / 2 - 0.1, top - 0.16), (xf + 0.3, -w / 2 + 0.1, top - 0.16),
                 (xf - 0.05, w / 2 - 0.1, top - 0.05), (xf - 0.05, -w / 2 + 0.1, top - 0.05),
                 (xf + 0.3, w / 2 - 0.1, top - 0.13), (xf + 0.3, -w / 2 + 0.1, top - 0.13),
                 (xf - 0.05, w / 2 - 0.1, top), (xf - 0.05, -w / 2 + 0.1, top)], 'Trim', bevel=0.01)
    lamp_bar(body, xf + 0.18, top + 0.05, 1.9, 6, 1.4)

    # Grille with slats, a heavy bumper with round lamps and tow eyes, and the cab steps.
    body.box((xf + 0.01, 0, 1.95), (0.03, 1.6, 0.62), 'Graphite')
    for k in range(6):
        body.box((xf + 0.03, 0, 1.7 + k * 0.1), (0.02, 1.5, 0.035), 'Trim')
    body.box((xf + 0.12, 0, 1.45), (0.24, w + 0.04, 0.34), 'Trim', bevel=0.04)
    for sd in (-1, 1):
        round_lamp(body, xf + 0.245, sd * 0.85, 1.48, 0.09)
        round_lamp(body, xf + 0.245, sd * 0.6, 1.48, 0.07)
        body.box((xf + 0.245, sd * 1.05, 1.48), (0.02, 0.08, 0.08), 'Amber')
        body.tube((xf + 0.25, sd * 0.3, 1.32), (xf + 0.4, sd * 0.3, 1.32), 0.035, 'Magenta', segments=8)
        for k, z in enumerate((1.22, 0.95)):
            body.box((xf - 0.85, sd * (w / 2 - 0.12), z), (0.5, 0.28, 0.04), 'Steel', bevel=0.008)
        body.box((xf - 0.85, sd * (w / 2 - 0.02), 1.1), (0.52, 0.02, 0.36), 'Graphite')
        # Door lines, handle, magenta stripe and the number board.
        y = sd * (w / 2 + 0.003)
        body.box((xf - 0.15, y, 2.2), (0.014, 0.006, 1.3), 'Graphite')
        body.box((xb + 0.55, y, 2.2), (0.014, 0.006, 1.3), 'Graphite')
        body.box((xb + 0.7, sd * (w / 2 + 0.012), 2.15), (0.16, 0.02, 0.04), 'Trim', bevel=0.008)
        body.box((xf - 0.7, sd * (w / 2 + 0.006), sill + 0.35), (1.6, 0.012, 0.1), 'Magenta')
        body.box((xf - 0.85, sd * (w / 2 + 0.008), sill + 0.72), (0.7, 0.012, 0.42), 'Board')
        # Big mirrors on arms.
        body.tube((xf - 0.1, sd * (w / 2), 2.75), (xf + 0.1, sd * (w / 2 + 0.28), 2.8), 0.022, 'Graphite')
        body.tube((xf - 0.1, sd * (w / 2), 2.35), (xf + 0.1, sd * (w / 2 + 0.28), 2.5), 0.022, 'Graphite')
        body.box((xf + 0.1, sd * (w / 2 + 0.3), 2.62), (0.07, 0.2, 0.38), 'Graphite', bevel=0.02)
    # Front wheel arches built into the cab's lower corners.
    flare(body, t['cg_front'], b.r, w / 2 + 0.05, sill, 0.2, 0.08, 'Trim')

    # The service box over the rear: roller shutters, side lockers, a ladder and sand ladders.
    bf = xb - 0.6
    box_len = bf - xr
    bx = (bf + xr) / 2
    body.box((bx, 0, 2.3), (box_len, w, 1.65), 'Paint', bevel=0.05)
    body.box((bx, 0, 3.15), (box_len + 0.03, w + 0.03, 0.06), 'Trim', bevel=0.015)
    body.box((bx, 0, 1.47), (box_len + 0.03, w + 0.03, 0.06), 'Trim', bevel=0.015)
    for sd in (-1, 1):
        y = sd * (w / 2 + 0.004)
        body.box((bx, sd * (w / 2 + 0.006), 1.95), (box_len - 0.2, 0.012, 0.1), 'Magenta')
        # The roller shutter: a frame and many slats.
        body.box((-1.3, sd * (w / 2 + 0.01), 2.45), (1.5, 0.02, 1.1), 'Graphite')
        for k in range(11):
            body.box((-1.3, sd * (w / 2 + 0.022), 2.0 + k * 0.09), (1.42, 0.008, 0.05), 'Steel')
        body.box((-1.3, sd * (w / 2 + 0.03), 1.92), (0.3, 0.02, 0.05), 'Trim')
        # Sand ladders clamped above the rear wheel.
        body.box((-2.35, sd * (w / 2 + 0.03), 2.6), (1.3, 0.03, 0.34), 'Urethane', bevel=0.01)
        for k in range(9):
            body.box((-2.95 + k * 0.15, sd * (w / 2 + 0.05), 2.6), (0.04, 0.02, 0.3), 'Urethane')
        for x in (-2.85, -1.85):
            body.box((x, sd * (w / 2 + 0.055), 2.6), (0.05, 0.02, 0.44), 'Graphite')
        body.box((xr + 0.3, y, 2.95), (0.3, 0.012, 0.1), 'TailLamp')
    # A ladder up the back and rear lamps.
    for sd in (-1, 1):
        body.tube((xr - 0.06, sd * 0.25, 1.3), (xr - 0.06, sd * 0.25, 3.2), 0.02, 'Steel', segments=6)
        body.box((xr - 0.005, sd * 0.95, 1.7), (0.03, 0.26, 0.16), 'TailLamp', bevel=0.01)
        body.box((xr - 0.005, sd * 0.72, 1.7), (0.03, 0.14, 0.16), 'Amber', bevel=0.01)
    for k in range(7):
        body.tube((xr - 0.06, -0.25, 1.4 + k * 0.27), (xr - 0.06, 0.25, 1.4 + k * 0.27), 0.015, 'Steel', segments=6)
    body.box((xr + 0.05, 0, 1.25), (0.2, w - 0.2, 0.16), 'Trim', bevel=0.02)
    flare(body, -t['cg_rear'], b.r, w / 2 + 0.05, sill, 0.2, 0.08, 'Trim')
    # Mud flaps behind both axles.
    for sd in (-1, 1):
        body.box((-t['cg_rear'] - 0.8, sd * (t['track'] / 2), 0.85), (0.03, 0.45, 0.55), 'Rubber')
        body.box((t['cg_front'] - 0.8, sd * (t['track'] / 2), 1.0), (0.03, 0.45, 0.4), 'Rubber')
    # Fuel tanks slung along the frame between the wheels, with straps.
    for sd in (-1, 1):
        body.tube((-0.5, sd * 0.82, 1.02), (0.9, sd * 0.82, 1.02), 0.28, 'Steel', segments=16)
        for x in (-0.25, 0.65):
            body.tube((x - 0.02, sd * 0.82, 1.02), (x + 0.02, sd * 0.82, 1.02), 0.29, 'Graphite', segments=16)
        body.tube((0.95, sd * 0.82, 1.18), (0.95, sd * 0.82, 1.28), 0.06, 'Graphite', segments=8)

    cabover_driveline(b)
    cabover_frames(b)
    cabover_bolt_ons(b, sill, w, xb, xf, top, xr)


def cabover_frames(b):
    rail_z, rail_y = 1.08, 0.5
    p = b.fit('frame', ['ladder'])
    side_pair(p, 0.0, rail_y, rail_z, (6.2, 0.12, 0.28), 'Graphite', bevel=0.015)
    for x in (2.8, 1.2, 0.0, -1.2, -2.6):
        p.box((x, 0, rail_z), (0.12, 1.0, 0.18), 'Graphite', bevel=0.01)
    b.add(p)
    p = b.fit('frame', ['boxedLadder'])
    side_pair(p, 0.0, rail_y, rail_z, (6.2, 0.13, 0.32), 'Graphite', bevel=0.015)
    side_pair(p, 0.0, rail_y + 0.07, rail_z, (5.8, 0.01, 0.26), 'Steel')
    for x in (2.8, 1.2, 0.0, -1.2, -2.6):
        p.box((x, 0, rail_z), (0.14, 1.0, 0.22), 'Graphite', bevel=0.01)
        for sd in (-1, 1):
            p.convex([(x - 0.22, sd * (rail_y - 0.06), rail_z + 0.1), (x + 0.22, sd * (rail_y - 0.06), rail_z + 0.1),
                      (x, sd * (rail_y - 0.28), rail_z + 0.1), (x - 0.22, sd * (rail_y - 0.06), rail_z + 0.08),
                      (x + 0.22, sd * (rail_y - 0.06), rail_z + 0.08), (x, sd * (rail_y - 0.28), rail_z + 0.08)],
                     'Steel')
    b.add(p)


def cabover_bolt_ons(b, sill, w, xb, xf, top, xr):
    t, s, r = b.t, b.s, b.r
    fx, rx = t['cg_front'], -t['cg_rear']

    for k in BUMP_STOPS:
        p = b.fit('bumpStops', [k])
        for x in (fx, rx):
            for sd in (-1, 1):
                bump_stop(p, (x, sd * 0.5, 0.94), s * 0.8, k)
        b.add(p)

    for k, adj in (('fixedBars', False), ('adjustableBars', True)):
        p = b.fit('antiRoll', [k])
        roll_bar(p, fx + 0.6, 0.62, 0.98, 0.55, r + 0.08, s * 0.8, adj, flip=1)
        roll_bar(p, rx - 0.6, 0.62, 0.98, 0.55, r + 0.08, s * 0.8, adj, flip=-1)
        b.add(p)

    for k in ('skidPlates', 'fullArmour'):
        heavy = k == 'fullArmour'
        th = 0.02 if not heavy else 0.03
        p = b.fit('protection', [k])
        p.convex([(xf + 0.3, 0.6, 1.25), (xf + 0.3, -0.6, 1.25), (xf - 0.6, 0.55, 0.88), (xf - 0.6, -0.55, 0.88),
                  (xf + 0.3, 0.6, 1.25 + th), (xf + 0.3, -0.6, 1.25 + th), (xf - 0.6, 0.55, 0.88 + th),
                  (xf - 0.6, -0.55, 0.88 + th)], 'Steel', bevel=0.01)
        # The belly plate under the transfer case, hung from the rails.
        p.box((0.3, 0, 0.6), (1.0, 0.92, th), 'Steel', bevel=0.008)
        for x in (0.7, -0.1):
            for sd in (-1, 1):
                p.tube((x, sd * 0.43, 0.6), (x, sd * 0.47, 0.95), 0.022, 'Graphite', segments=6)
        if heavy:
            # Tank guards, side under-run bars and diff guards.
            for sd in (-1, 1):
                p.box((0.2, sd * 1.1, 1.02), (1.6, 0.03, 0.56), 'Steel', bevel=0.01)
                p.tube((-0.9, sd * (w / 2), 1.2), (-2.6, sd * (w / 2), 1.2), 0.05, 'Graphite', segments=10)
                p.tube((-0.9, sd * (w / 2), 1.0), (-2.6, sd * (w / 2), 1.0), 0.05, 'Graphite', segments=10)
            for key in ('F', 'R'):
                axle_obj, half = b.axles[key]
                d = b.fit('protection', [k], 'Axle' + key)
                off = 0.12 * s
                d.convex([(0.16 * s, off + 0.14 * s, -0.04 * s), (-0.16 * s, off + 0.14 * s, -0.04 * s),
                          (0.16 * s, off - 0.12 * s, -0.04 * s), (-0.16 * s, off - 0.12 * s, -0.04 * s),
                          (0.12 * s, off + 0.1 * s, -0.17 * s), (-0.12 * s, off + 0.1 * s, -0.17 * s),
                          (0.12 * s, off - 0.08 * s, -0.17 * s), (-0.12 * s, off - 0.08 * s, -0.17 * s)],
                         'Steel', bevel=0.008 * s)
                b.add(d, axle_obj)
        b.add(p)

    # Spares stand between the cab and the box.
    p = b.fit('spares', ['lightKit'])
    spare_wheel(p, (xb - 0.32, 0.55, 2.25), t, axis='X', scale=1.0)
    crate(p, (xb - 0.3, -0.6, 1.62), (0.4, 0.6, 0.3), 1.0)
    b.add(p)
    p = b.fit('spares', ['fullKit'])
    for sd in (-1, 1):
        spare_wheel(p, (xb - 0.32, sd * 0.6, 2.25), t, axis='X', scale=1.0)
    for sd in (-1, 1):
        # Lockers under the box, ahead of the rear wheels.
        p.box((-0.75, sd * 1.0, 1.25), (0.8, 0.3, 0.4), 'Graphite', bevel=0.02)
        p.box((-0.75, sd * 1.155, 1.25), (0.7, 0.01, 0.3), 'Steel')
        p.box((-0.75, sd * 1.165, 1.38), (0.25, 0.01, 0.04), 'Magenta')
    for k in range(3):
        jerry_can(p, (xr + 0.35 + k * 0.25, 0.0, 3.41), 1.0)
    b.add(p)

    # Engines: the exhaust stacks and air intakes behind the cab.
    for k in ('dieselSix', 'turboDieselSix', 'dieselV8'):
        p = b.fit('engine', [k])
        stacks = (-1,) if k != 'dieselV8' else (-1, 1)
        for sd in stacks:
            y = sd * (w / 2 - 0.12)
            p.tube((xb - 0.1, y, 1.5), (xb - 0.1, y, top + 0.35), 0.06, 'Chrome', segments=12)
            p.tube((xb - 0.1, y, 2.0), (xb - 0.1, y, 2.6), 0.085, 'Steel', segments=12)
            p.tube((xb - 0.1, y, top + 0.35), (xb - 0.04, y, top + 0.45), 0.06, 'Chrome', segments=12, r2=0.065)
            # The pipe from the block, over the rail and out to the foot of the stack.
            pipe_run(p, [(1.95, sd * 0.27, 1.32), (1.6, sd * 0.42, 1.32), (1.4, sd * 0.9, 1.36), (xb - 0.1, y, 1.52)], 0.055,
                     'Pipe')
        if k != 'dieselSix':
            y = w / 2 - 0.12
            p.tube((xb - 0.15, y, 1.6), (xb - 0.15, y, top - 0.1), 0.12, 'Graphite', segments=14)
            p.tube((xb - 0.15, y, top - 0.1), (xb - 0.15, y, top + 0.05), 0.15, 'Graphite', segments=14)
            p.tube((xb - 0.15, y, top + 0.05), (xb - 0.15, y, top + 0.1), 0.12, 'Steel', segments=14)
        b.add(p)


def buggy(b):
    """The side-by-side: a tube cage on a small chassis, mid-engine, two
    seats, half doors and a safety flag."""
    t, s, body = b.t, b.s, b.shell
    tw = 0.62  # cage half-width
    floor = 0.42

    # Floor pan, chassis tubes and the rocker panels.
    body.box((0.0, 0, floor), (1.9, 1.15, 0.04), 'Graphite')
    side_pair(body, 0.05, 0.55, floor + 0.05, (2.4, 0.05, 0.06), 'Graphite', bevel=0.01)
    # Seats with headrests and magenta harnesses.
    for sd in (-1, 1):
        y = sd * 0.3
        body.box((-0.15, y, floor + 0.17), (0.48, 0.44, 0.1), 'Seat', bevel=0.03)
        side_pair_bolster = [(-0.15, y + 0.2, floor + 0.25), (-0.15, y - 0.2, floor + 0.25)]
        for (bx_, by_, bz_) in side_pair_bolster:
            body.box((bx_, by_, bz_), (0.44, 0.05, 0.08), 'Seat', bevel=0.02)
        body.convex([(-0.34, y + 0.21, floor + 0.2), (-0.34, y - 0.21, floor + 0.2),
                     (-0.46, y - 0.21, floor + 0.2), (-0.46, y + 0.21, floor + 0.2),
                     (-0.47, y + 0.19, floor + 0.86), (-0.47, y - 0.19, floor + 0.86),
                     (-0.57, y - 0.19, floor + 0.86), (-0.57, y + 0.19, floor + 0.86)], 'Seat', bevel=0.03)
        body.box((-0.53, y, floor + 0.98), (0.1, 0.24, 0.18), 'Seat', bevel=0.03)
        for dy in (-0.09, 0.09):
            body.box((-0.36, y + dy, floor + 0.55), (0.02, 0.05, 0.62), 'Magenta', rot=Matrix.Rotation(-0.2, 3, 'Y'))
        body.box((-0.22, y, floor + 0.36), (0.02, 0.2, 0.05), 'Magenta')

    # The roll cage: hoops, roof and the A-pillars down to the nose, with joints.
    hoop_x, roof_front, roof_back, roof_z = -0.6, 0.35, -0.65, 1.72
    rt = 0.028
    for sd in (-1, 1):
        body.tube((hoop_x, sd * tw, floor), (roof_back, sd * tw * 0.95, roof_z), rt, 'Magenta')
        body.tube((roof_back, sd * tw * 0.95, roof_z), (roof_front, sd * tw * 0.95, roof_z), rt, 'Magenta')
        body.tube((roof_front, sd * tw * 0.95, roof_z), (0.85, sd * tw, floor + 0.45), rt, 'Magenta')
        body.tube((0.85, sd * tw, floor + 0.45), (0.85, sd * tw, floor), rt, 'Magenta')
        # Door bars and a diagonal.
        body.tube((0.8, sd * tw, floor + 0.32), (hoop_x + 0.05, sd * tw, floor + 0.32), 0.022, 'Magenta')
        body.tube((hoop_x, sd * tw, floor), (-1.35, sd * 0.45, floor + 0.35), 0.022, 'Magenta')
        body.tube((roof_back, sd * tw * 0.95, roof_z), (-1.35, sd * 0.45, floor + 0.35), 0.022, 'Magenta')
        for pnt in ((roof_back, sd * tw * 0.95, roof_z), (roof_front, sd * tw * 0.95, roof_z), (0.85, sd * tw, floor + 0.45)):
            body.lathe([(0.0, -0.032), (rt * 1.3, -0.02), (rt * 1.3, 0.02), (0.0, 0.032)], 'Magenta', segments=10,
                       centre=pnt, closed=False)
        # Half doors and a window net.
        body.convex([(0.62, sd * (tw + 0.01), floor + 0.05), (-0.45, sd * (tw + 0.01), floor + 0.05),
                     (0.6, sd * (tw + 0.01), floor + 0.3), (-0.45, sd * (tw + 0.01), floor + 0.3),
                     (0.62, sd * (tw + 0.04), floor + 0.05), (-0.45, sd * (tw + 0.04), floor + 0.05),
                     (0.6, sd * (tw + 0.04), floor + 0.3), (-0.45, sd * (tw + 0.04), floor + 0.3)], 'Paint', bevel=0.01)
        for k in range(5):
            x = 0.45 - k * 0.2
            body.box((x, sd * (tw - 0.005), floor + 0.62), (0.012, 0.008, 0.55), 'Graphite')
        for k in range(4):
            body.box((-0.0, sd * (tw - 0.005), floor + 0.4 + k * 0.15), (0.85, 0.008, 0.012), 'Graphite')
    body.tube((roof_back, -tw * 0.95, roof_z), (roof_back, tw * 0.95, roof_z), rt, 'Magenta')
    body.tube((roof_front, -tw * 0.95, roof_z), (roof_front, tw * 0.95, roof_z), rt, 'Magenta')
    body.tube((hoop_x, -tw, floor + 0.9), (hoop_x - 0.04, tw, floor + 0.9), 0.022, 'Magenta')
    body.tube((0.85, -tw, floor + 0.45), (0.85, tw, floor + 0.45), 0.024, 'Magenta')
    # Roof panel and a lamp bar.
    body.box(((roof_front + roof_back) / 2, 0, roof_z + 0.03), (roof_front - roof_back + 0.04, tw * 1.84, 0.025), 'Paint',
             bevel=0.01)
    lamp_bar(body, roof_front - 0.03, roof_z + 0.11, 0.9, 4, 0.8)
    # A safety whip with a magenta flag.
    body.tube((-1.3, 0.45, floor + 0.35), (-1.32, 0.45, roof_z + 0.95), 0.006, 'Graphite', segments=4)
    body.convex([(-1.32, 0.45, roof_z + 0.95), (-1.32, 0.45, roof_z + 0.75), (-1.6, 0.45, roof_z + 0.85),
                 (-1.32, 0.454, roof_z + 0.95), (-1.32, 0.454, roof_z + 0.75), (-1.6, 0.454, roof_z + 0.85)], 'Magenta')

    # The nose: a short bonnet between the front wheels, with headlamps and a bumper.
    body.convex([(1.62, 0.42, 0.62), (1.62, -0.42, 0.62), (0.85, -0.6, floor + 0.05), (0.85, 0.6, floor + 0.05),
                 (1.58, 0.36, 0.86), (1.58, -0.36, 0.86), (0.85, -0.55, 1.05), (0.85, 0.55, 1.05)], 'Paint', bevel=0.03)
    for sd in (-1, 1):
        body.convex([(1.6, sd * 0.32, 0.8), (1.6, sd * 0.16, 0.8), (1.6, sd * 0.32, 0.72), (1.6, sd * 0.16, 0.72),
                     (1.63, sd * 0.31, 0.79), (1.63, sd * 0.17, 0.79), (1.63, sd * 0.31, 0.73), (1.63, sd * 0.17, 0.73)],
                    'Lamp')
    body.box((1.64, 0, 0.68), (0.03, 0.22, 0.08), 'Graphite')
    body.tube((1.72, -0.5, 0.55), (1.72, 0.5, 0.55), 0.03, 'Graphite', segments=10)
    for sd in (-1, 1):
        body.tube((1.72, sd * 0.5, 0.55), (1.45, sd * 0.45, 0.48), 0.028, 'Graphite', segments=8)
        body.tube((1.72, sd * 0.3, 0.55), (1.6, sd * 0.3, 0.78), 0.024, 'Graphite', segments=8)
    # Dash, steering wheel and a mirror.
    body.box((0.75, 0, floor + 0.5), (0.14, 1.1, 0.2), 'Graphite', bevel=0.03)
    body.lathe([(0.15, -0.02), (0.17, 0.0), (0.15, 0.02)], 'Graphite', segments=14,
               centre=(0.55, 0.3, floor + 0.55), closed=False)
    body.tube((0.55, 0.3, floor + 0.55), (0.72, 0.3, floor + 0.5), 0.015, 'Graphite', segments=6)
    body.box((roof_front - 0.02, 0, roof_z - 0.08), (0.03, 0.26, 0.07), 'Graphite', bevel=0.01)
    # Fenders over all four wheels: thin panels the wheels just reach at full bump.
    for x in (t['cg_front'], -t['cg_rear']):
        for sd in (-1, 1):
            p_in, p_out = sd * 0.62, sd * 0.95
            body.arch(x, b.r, 0.66, 0.69, min(p_in, p_out), max(p_in, p_out), 50, 130, 'Trim', segs=10)
    # The engine bay, a rear deck, rear lamps and number boards.
    body.box((-1.15, 0, floor + 0.32), (0.75, 0.74, 0.5), 'Cast', bevel=0.02)
    # The belt cover on the engine's front face, behind the seats.
    body.tube((-0.775, -0.14, floor + 0.3), (-0.74, -0.14, floor + 0.3), 0.15, 'Alloy', segments=12)
    body.tube((-0.775, 0.16, floor + 0.36), (-0.74, 0.16, floor + 0.36), 0.11, 'Alloy', segments=12)
    body.box((-1.15, 0, floor + 0.585), (0.78, 0.98, 0.03), 'Paint', bevel=0.01)
    for k in range(5):
        body.box((-0.95 - k * 0.08, 0, floor + 0.605), (0.035, 0.7, 0.012), 'Graphite')
    for sd in (-1, 1):
        body.box((0.1, sd * (tw + 0.045), floor + 0.18), (0.45, 0.012, 0.22), 'Board')
        body.box((-1.53, sd * 0.38, floor + 0.45), (0.025, 0.12, 0.08), 'TailLamp', bevel=0.008)
    body.box((1.2, 0, 0.97), (0.7, 0.16, 0.01), 'Magenta')
    lamp_bar(body, -1.56, floor + 0.62, 0.6, 3, 0.6, face=-1)

    buggy_driveline(b)
    buggy_frames(b, hoop_x, roof_front, roof_back, roof_z, tw, floor)
    buggy_bolt_ons(b, floor, tw)


def buggy_frames(b, hoop_x, roof_front, roof_back, roof_z, tw, floor):
    # The plain tube frame is the cage above; gussets add plates in the
    # joints, and chromoly adds extra bracing (thinner tubes do more work).
    p = b.fit('frame', ['tubeFrame', 'gussetedTube', 'chromolyTube'])
    for sd in (-1, 1):
        p.tube((1.5, sd * 0.35, floor + 0.08), (-1.5, sd * 0.4, floor + 0.08), 0.03, 'Graphite', segments=8)
    for x in (1.2, 0.6, -0.6, -1.3):
        p.tube((x, -0.4, floor + 0.08), (x, 0.4, floor + 0.08), 0.025, 'Graphite', segments=8)
    b.add(p)
    p = b.fit('frame', ['gussetedTube'])
    for sd in (-1, 1):
        for (x, z) in ((roof_back, roof_z), (roof_front, roof_z)):
            y = sd * tw * 0.95
            p.convex([(x, y, z), (x + (0.14 if x < 0 else -0.14), y, z), (x, y, z - 0.14),
                      (x, y + 0.006, z), (x + (0.14 if x < 0 else -0.14), y + 0.006, z), (x, y + 0.006, z - 0.14)],
                     'Steel')
        p.convex([(0.85, sd * tw, floor + 0.45), (0.85, sd * tw, floor + 0.3), (0.7, sd * tw, floor + 0.45),
                  (0.85, sd * (tw + 0.006), floor + 0.45), (0.85, sd * (tw + 0.006), floor + 0.3),
                  (0.7, sd * (tw + 0.006), floor + 0.45)], 'Steel')
        p.convex([(hoop_x, sd * tw, floor + 0.9), (hoop_x, sd * tw, floor + 0.75), (hoop_x, sd * (tw - 0.15), floor + 0.9),
                  (hoop_x + 0.006, sd * tw, floor + 0.9), (hoop_x + 0.006, sd * tw, floor + 0.75),
                  (hoop_x + 0.006, sd * (tw - 0.15), floor + 0.9)], 'Steel')
    b.add(p)
    p = b.fit('frame', ['chromolyTube'])
    y = tw * 0.95
    p.tube((roof_back, -y, roof_z), (roof_front, y, roof_z), 0.018, 'Magenta')
    p.tube((roof_back, y, roof_z), (roof_front, -y, roof_z), 0.018, 'Magenta')
    p.tube((hoop_x, -tw, floor + 0.05), (hoop_x - 0.03, tw, floor + 0.88), 0.018, 'Magenta')
    for sd in (-1, 1):
        p.tube((0.85, sd * tw, floor + 0.05), (roof_front - 0.25, sd * tw * 0.96, roof_z - 0.25), 0.018, 'Magenta')
    b.add(p)


def buggy_bolt_ons(b, floor, tw):
    t, s, r = b.t, b.s, b.r
    fx, rx = t['cg_front'], -t['cg_rear']

    for k in BUMP_STOPS:
        p = b.fit('bumpStops', [k])
        for x in (fx, rx):
            for sd in (-1, 1):
                bump_stop(p, (x + (0.15 if x > 0 else 0.25), sd * 0.5, r + 0.3), s * 0.8, k)
        b.add(p)

    for k, adj in (('fixedBars', False), ('adjustableBars', True)):
        p = b.fit('antiRoll', [k])
        roll_bar(p, fx - 0.22, 0.36, floor + 0.12, 0.2, r + 0.02, s * 0.8, adj, flip=-1)
        roll_bar(p, rx + 0.3, 0.36, floor + 0.12, 0.2, r + 0.02, s * 0.8, adj, flip=-1)
        b.add(p)

    for k in ('skidPlates', 'fullArmour'):
        heavy = k == 'fullArmour'
        p = b.fit('protection', [k])
        # Under the floor and the prop shaft, between the two diffs.
        p.box((0.0, 0, floor - 0.08), (2.0, 1.1, 0.015 if not heavy else 0.025), 'Steel', bevel=0.005)
        p.convex([(1.72, 0.45, 0.5), (1.72, -0.45, 0.5), (1.3, 0.5, floor - 0.08), (1.3, -0.5, floor - 0.08),
                  (1.72, 0.45, 0.515), (1.72, -0.45, 0.515), (1.3, 0.5, floor - 0.065), (1.3, -0.5, floor - 0.065)],
                 'Steel', bevel=0.004)
        if heavy:
            for sd in (-1, 1):
                y = sd * (tw + 0.14)
                p.tube((0.75, y, floor + 0.08), (-0.6, y, floor + 0.08), 0.03, 'Graphite', segments=8)
                for x in (0.75, -0.6):
                    p.tube((x, y, floor + 0.08), (x, sd * 0.56, floor + 0.05), 0.026, 'Graphite', segments=8)
                p.box((-1.2, sd * 0.5, floor + 0.2), (0.6, 0.02, 0.28), 'Steel', bevel=0.005)
            p.box((1.74, 0, 0.62), (0.03, 0.9, 0.16), 'Steel', bevel=0.006)
        b.add(p)

    p = b.fit('spares', ['lightKit'])
    spare_wheel(p, (-1.2, 0, floor + 0.72), t)
    for sd in (-1, 1):
        p.box((-1.2, sd * 0.2, floor + 0.73), (0.85, 0.04, 0.012), 'Magenta')
    b.add(p)
    p = b.fit('spares', ['fullKit'])
    spare_wheel(p, (-1.2, 0, floor + 0.72), t)
    spare_wheel(p, (-0.72, 0, 1.25), t, axis='X')
    for sd in (-1, 1):
        p.box((-1.2, sd * 0.2, floor + 0.73), (0.85, 0.04, 0.012), 'Magenta')
    crate(p, (-1.2, 0, floor + 0.98), (0.4, 0.5, 0.2), 1.0)
    b.add(p)

    # Engines: one pipe for the twin, two for the triple, a turbo, intercooler and air box for the turbo twin.
    for k in ('twin', 'triple', 'turboTwin'):
        p = b.fit('engine', [k])
        pipes = {'twin': (0.0,), 'triple': (-0.18, 0.18), 'turboTwin': (-0.18, 0.18)}[k]
        for y in pipes:
            p.tube((-1.45, y + 0.2, floor + 0.38), (-1.62, y + 0.2, floor + 0.42), 0.035, 'Chrome', segments=10)
            p.tube((-1.3, y + 0.2, floor + 0.36), (-1.5, y + 0.2, floor + 0.4), 0.06, 'Steel', segments=12)
        if k == 'turboTwin':
            p.tube((-0.8, -0.35, floor + 0.62), (-0.8, -0.35, 1.45), 0.05, 'Graphite', segments=10)
            p.tube((-0.8, -0.35, 1.45), (-0.8, -0.35, 1.6), 0.08, 'Graphite', segments=12)
            p.box((-0.92, 0.2, floor + 0.66), (0.22, 0.4, 0.1), 'Alloy', bevel=0.01)
            p.lathe([(0.0, -0.05), (0.07, -0.04), (0.07, 0.04), (0.0, 0.05)], 'Steel', segments=12,
                    centre=(-1.3, 0.3, floor + 0.66), closed=False)
        elif k == 'triple':
            p.box((-0.92, -0.25, floor + 0.65), (0.25, 0.25, 0.08), 'Graphite', bevel=0.01)
        b.add(p)


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
