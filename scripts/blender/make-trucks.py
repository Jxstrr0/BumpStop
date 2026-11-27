"""
Bump Stop's three trucks, built by script. No Blender window needed.

Run it with the Blender Python module (`pip install bpy==5.1.2`):

    python scripts/blender/make-trucks.py

or with Blender itself:

    blender --background --python scripts/blender/make-trucks.py

Add `-- light4x4` (or heavy, sxs) to build just one, and `full` or `lite`
for just that build of it. It writes two files per truck to public/models/:
truck-light4x4.glb.gz and the lighter truck-light4x4-lite.glb.gz for the
game's Lite graphics tier (ordinary .glb models, zipped). Commit those
files: the game loads them, and the build never runs Blender.

How the trucks get their look (the HD pass, v1.16; docs/3D.md has more):
colours and finishes are painted onto the meshes so nearly everything shares
one material (see COLOURS AND FINISHES), soft shadows are worked out here
and painted in too (see `bake_shade`), and bodies are skinned from
cross-sections (`Part.loft`) rather than stacked from boxes.

All three trucks come from one shared kit of parts (tires, rims, shocks,
springs, bump stops, bars, axles, guards, spares) with each class's own body
on top. The game moves the parts itself (src/render/truckModel.ts), so every
moving part is its own named node:

    Body                 everything the springs hold up (cab, frame, cage)
      MountTop_FL ...    where each shock bolts to the body (an empty)
      Arm_FL_Lower ...   arms that swing from the body: wishbones, trailing
                         arms, radius rods, tie rods, half-shafts, a solid
                         axle's links and track bar, each half of a leaf spring
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
import json
import math
import os
import struct
import sys
import zlib

import bpy  # first: the bmesh module comes with it
import bmesh
import numpy as np
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = os.path.normpath(os.path.join(HERE, '..', '..', 'public', 'models'))

CORNERS = ['FL', 'FR', 'RL', 'RR']

# Two builds of every truck: the full one, and a lighter one for the game's
# Lite graphics tier (`truck-<class>-lite.glb.gz`): the same parts and the
# same node names, with rounder things made of fewer sides and the smallest
# details (bolts, ribs, tread sipes) left off. `HD` is switched by `main`.
HD = True


def seg(n, lite=None):
    """How many sides a round thing gets: `n` in the full build, fewer in the lite one."""
    if HD:
        return n
    return lite if lite is not None else max(6, int(n * 0.55))


# --- Colours ----------------------------------------------------------------
# Hex as on screen (sRGB). Blender and glTF want linear numbers, so we convert.

def srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hex_rgba(h):
    h = h.lstrip('#')
    return tuple(srgb_to_linear(int(h[i:i + 2], 16) / 255) for i in (0, 2, 4)) + (1.0,)


# COLOURS AND FINISHES. A phone pays for every material a mesh uses (each
# one is a separate "draw call"), so nearly the whole truck is ONE material,
# "Truck". What differs from part to part is painted onto the mesh itself:
#   - the colour, on the mesh's corners ("vertex colours"), together with
#     the soft shadows where parts meet (see `bake_shade`);
#   - the finish (how rough, how metallic), as a pair of numbers on each
#     corner that the material looks up in a tiny picture (`finish_png`).
# So a shock that is black rubber, zinc and blue alloy is still one draw.
#
# Magenta springs are Bump Stop's signature (the game's highlighter colour);
# graphite and birch-white come from the roadbook palette, and the blue
# anodised alloy is the trace's "cool" blue.

# finish: (metallic, roughness)
FINISHES = {
    'matte': (0.0, 0.9),
    'satin': (0.15, 0.5),
    'gloss': (0.0, 0.28),
    'metal': (0.9, 0.36),
    'chrome': (1.0, 0.1),
}
# name: (colour, finish)
PALETTE = {
    'Graphite': ('#2A2C31', 'satin'),
    'Rubber': ('#1D1E20', 'matte'),
    'Steel': ('#A4A9AF', 'metal'),
    'Chrome': ('#E6E8EB', 'chrome'),
    'Alloy': ('#CDD1D6', 'metal'),
    'WheelPaint': ('#E4DFD2', 'gloss'),
    'Anodised': ('#2D74BC', 'metal'),
    'Urethane': ('#E8962A', 'satin'),
    'Jerry': ('#C0262D', 'satin'),
    'Board': ('#FBFAF5', 'matte'),
    'Magenta': ('#FF4FB2', 'gloss'),
    'Seat': ('#3A3B41', 'matte'),
    # The driveline: cast iron for engine blocks (a shade lighter than the
    # frame, so it reads against it) and heat-browned steel for exhausts.
    'Cast': ('#5A5F67', 'metal'),
    'Pipe': ('#8A6E5C', 'metal'),
    # Brake discs (bare, turned steel), braided hose, and the dark inside of holes and wheels.
    'Disc': ('#8E9399', 'metal'),
    'Hose': ('#70757C', 'metal'),
    'Shadow': ('#0E0F10', 'matte'),
}
# Glass and the lamps keep a material each (they glow, or will be see-through).
# name: (colour, metallic, roughness, glow)
OWN_MATERIALS = {
    'Glass': ('#1A242C', 0.6, 0.05, 0),
    'Lamp': ('#FFF4D6', 0.0, 0.2, 2.0),
    'TailLamp': ('#D8343B', 0.0, 0.25, 0.8),
    'Amber': ('#F0AE45', 0.0, 0.3, 0.6),
}
# The one shared material's name (`pack_model` gives it the finish picture).
SHARED = 'Truck'


def make_material(name, rgba, metallic, roughness, glow=0):
    mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = rgba
    bsdf.inputs['Metallic'].default_value = metallic
    bsdf.inputs['Roughness'].default_value = roughness
    if glow > 0:
        bsdf.inputs['Emission Color'].default_value = rgba
        bsdf.inputs['Emission Strength'].default_value = glow
    return mat


def make_materials(extra):
    """Every colour name a part can use, as (material, colour, roughness,
    metallic). `extra` adds a truck's own colours (its paint and trim)."""
    out = {}
    shared = make_material(SHARED, (1.0, 1.0, 1.0, 1.0), 1.0, 1.0)
    for name, (colour, finish) in {**PALETTE, **extra}.items():
        metallic, roughness = FINISHES[finish]
        out[name] = (shared, hex_rgba(colour)[:3], roughness, metallic)
    for name, (colour, metallic, roughness, glow) in OWN_MATERIALS.items():
        out[name] = (make_material(name, hex_rgba(colour), metallic, roughness, glow), (1.0, 1.0, 1.0), 0.5, 0.0)
    return out


# --- A tiny mesh builder ------------------------------------------------------
# Each node is one mesh built from many simple shapes, so a truck is only a
# few dozen draw calls on a phone. Hard edges get a small bevel: it catches
# the light like real pressed metal, for very few extra triangles.

V = Vector

# Edges gentler than this many degrees are shaded as one smooth surface;
# sharper ones stay crisp. A bevel (45 degrees) blends; a box's corner doesn't.
SOFT_ANGLE = 50.0
# Thin bars have few sides, so their sides blend across sharper edges (their ends stay crisp).
SOFT_ROUND = 80.0


class Part:
    def __init__(self, name):
        self.name = name
        self.bm = bmesh.new()
        self.mats = []
        # Per face: the sharpest edge (degrees) it still shades smoothly across.
        self.soft = self.bm.faces.layers.float.new('soft')

    def mat(self, name):
        if name not in self.mats:
            self.mats.append(name)
        return self.mats.index(name)

    def _paint(self, faces, mat, smooth=True, soft=SOFT_ANGLE):
        """Give faces their material. `smooth=False` keeps every one of them
        flat (facets on purpose: a hex nut, a bolted ring); `soft` is the
        sharpest edge, in degrees, they still shade smoothly across."""
        mi = self.mat(mat)
        for f in faces:
            f.material_index = mi
            f.smooth = smooth
            f[self.soft] = soft if smooth else 0.0

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
        junk = list({g for g in out['geom_interior'] + out['geom_unused'] if isinstance(g, bmesh.types.BMVert)})
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
        self._paint({f for v in out['verts'] for f in v.link_faces}, mat, smooth, SOFT_ROUND)

    def lathe(self, profile, mat, segments=28, centre=(0, 0, 0), smooth=True, closed=True, axis='Y', side=None,
              soft=SOFT_ANGLE):
        """Spin a profile of (radius, h) points round an axis through `centre`:
        tires, rims and hubs round Y (left-right, h runs inner side outwards);
        bump stops and cans round Z (h runs upwards); shafts round X.

        Blender works out which way the skin faces. For an open skin that
        can go wrong (the inside of a wheel's barrel), so `side` can say:
        draw the profile with radius across and h up, and 'right' faces the
        skin to the right of the way the profile runs, 'left' to the left."""
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
        # Round Z and X this winding faces 'right'; round Y it faces 'left'.
        flip = side is not None and (side == 'left') != (axis == 'Y')
        new_faces = []
        for i in range(len(rings) - 1):
            if abs(profile[i][0]) < 1e-6 and abs(profile[i + 1][0]) < 1e-6:
                continue
            for k in range(segments):
                k2 = (k + 1) % segments
                quad = [rings[i][k], rings[i][k2], rings[i + 1][k2], rings[i + 1][k]]
                new_faces.append(bm.faces.new(quad[::-1] if flip else quad))
        if closed:
            for idx in (0, -1):
                if profile[idx][0] > 1e-4:
                    new_faces.append(bm.faces.new(rings[idx]))
        if side is None:
            bmesh.ops.recalc_face_normals(bm, faces=new_faces)
        self._paint(new_faces, mat, smooth, soft)

    def ring(self, r_in, r_out, h0, h1, mat, segments=16, centre=(0, 0, 0), axis='Y', smooth=True):
        """A washer or a collar: a band from r_in to r_out, between h0 and h1 along the axis."""
        self.lathe([(r_in, h0), (r_out, h0), (r_out, h1), (r_in, h1), (r_in, h0)], mat, segments=segments,
                   centre=centre, axis=axis, smooth=smooth, closed=False)

    def torus(self, big, small, mat, centre=(0, 0, 0), axis='Y', segments=16, sides=8, h=0.0):
        """A ring of round bar: `big` is the ring's radius, `small` the bar's."""
        prof = [(big + small * math.cos(2 * math.pi * k / sides), h + small * math.sin(2 * math.pi * k / sides))
                for k in range(sides + 1)]
        self.lathe(prof, mat, segments=segments, centre=centre, axis=axis, closed=False, soft=SOFT_ROUND)

    def sweep(self, points, r, mat, sides=8, curve=0, caps=True, bend=0.0):
        """A bent pipe or a hose through the points, in one skin (no joints
        to see). `curve` adds that many points between each pair, rounding
        the bends (a hose); 0 leaves them as mitred corners. `bend` instead
        rounds each corner to about that radius and keeps the runs between
        them straight (a bent steel tube: a roll cage, a bull bar)."""
        pts = [V(q) for q in points]
        if bend > 0 and len(pts) > 2:
            # A bent bar: straight runs, with each corner swapped for a short arc.
            steps = 4 if HD else 1
            out = [pts[0]]
            for i in range(1, len(pts) - 1):
                a, c, e = pts[i - 1], pts[i], pts[i + 1]
                d0 = min(bend, (a - c).length * 0.45)
                d1 = min(bend, (e - c).length * 0.45)
                p0, p1 = c + (a - c).normalized() * d0, c + (e - c).normalized() * d1
                for k in range(steps + 1):
                    u = k / steps
                    out.append(p0 * (1 - u) ** 2 + c * (2 * u * (1 - u)) + p1 * u ** 2)
            pts = out + [pts[-1]]
        if curve > 0 and len(pts) > 2:
            ext = [pts[0] * 2 - pts[1]] + pts + [pts[-1] * 2 - pts[-2]]
            out = []
            for i in range(1, len(ext) - 2):
                p0, p1, p2, p3 = ext[i - 1], ext[i], ext[i + 1], ext[i + 2]
                for k in range(curve + 1):
                    u = k / (curve + 1)
                    # Catmull-Rom: a smooth line that passes through every point.
                    out.append(0.5 * ((2 * p1) + (-p0 + p2) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u * u +
                                      (-p0 + 3 * p1 - 3 * p2 + p3) * u ** 3))
            pts = out + [pts[-1]]
        bm = self.bm
        # Carry a frame along the line so the skin doesn't twist.
        d0 = (pts[1] - pts[0]).normalized()
        ref = V((0, 0, 1)) if abs(d0.z) < 0.9 else V((1, 0, 0))
        u = d0.cross(ref).normalized()
        rings = []
        for i, pnt in enumerate(pts):
            if i == 0:
                d = d0
            elif i == len(pts) - 1:
                d = (pts[i] - pts[i - 1]).normalized()
            else:
                d = ((pts[i] - pts[i - 1]).normalized() + (pts[i + 1] - pts[i]).normalized()).normalized()
            u = (u - d * u.dot(d)).normalized()
            w = d.cross(u)
            # At a mitred corner the ring is stretched so the pipe keeps its width.
            fat = 1.0
            if 0 < i < len(pts) - 1:
                c = max(0.35, d.dot((pts[i] - pts[i - 1]).normalized()))
                fat = 1.0 / c
            rings.append([bm.verts.new(pnt + (u * math.cos(2 * math.pi * k / sides) +
                                               w * math.sin(2 * math.pi * k / sides)) * r * fat)
                          for k in range(sides)])
        faces = []
        for a, b in zip(rings, rings[1:]):
            for k in range(sides):
                k2 = (k + 1) % sides
                faces.append(bm.faces.new([a[k], a[k2], b[k2], b[k]]))
        if caps:
            faces.append(bm.faces.new(rings[0][::-1]))
            faces.append(bm.faces.new(rings[-1]))
        bmesh.ops.recalc_face_normals(bm, faces=faces)
        self._paint(faces, mat, True, SOFT_ROUND)

    def lug(self, centre, out, across, along, size, mat, taper=0.8):
        """A tread block: a box that narrows to its top. `out`, `across` and
        `along` are its three directions; `size` its height, width and length."""
        c, o, a, t = V(centre), V(out), V(across), V(along)
        h, w, ln = size
        base = [c + a * (sa * w / 2) + t * (st * ln / 2) for sa, st in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
        top = [c + o * h + a * (sa * w / 2 * taper) + t * (st * ln / 2 * taper)
               for sa, st in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
        bv = [self.bm.verts.new(q) for q in base]
        tv = [self.bm.verts.new(q) for q in top]
        faces = [self.bm.faces.new(tv)]
        for k in range(4):
            k2 = (k + 1) % 4
            faces.append(self.bm.faces.new([bv[k], bv[k2], tv[k2], tv[k]]))
        bmesh.ops.recalc_face_normals(self.bm, faces=faces)
        self._paint(faces, mat, False)

    def beam(self, a, b, up, w0, t0, mat, w1=None, t1=None, smooth=True):
        """A flat bar from a to b that can narrow along its length: `up` is
        the way its thickness (t) points; its width (w) lies across. Spokes,
        links, brackets."""
        a, b, up = V(a), V(b), V(up)
        w1 = w0 if w1 is None else w1
        t1 = t0 if t1 is None else t1
        d = (b - a).normalized()
        up = (up - d * up.dot(d)).normalized()
        across = d.cross(up)
        ends = []
        for c, w, th in ((a, w0, t0), (b, w1, t1)):
            ends.append([self.bm.verts.new(c + across * (sx * w / 2) + up * (sz * th / 2))
                         for sx, sz in ((-1, -1), (1, -1), (1, 1), (-1, 1))])
        faces = [self.bm.faces.new(ends[0][::-1]), self.bm.faces.new(ends[1])]
        for k in range(4):
            k2 = (k + 1) % 4
            faces.append(self.bm.faces.new([ends[0][k], ends[0][k2], ends[1][k2], ends[1][k]]))
        bmesh.ops.recalc_face_normals(self.bm, faces=faces)
        self._paint(faces, mat, smooth)

    def rail(self, path, y, w, h, mat, bevel=0.0):
        """A box-section rail along a path of (x, z) points in the side view,
        at `y` across the truck, `w` wide and `h` deep, mitred at each bend."""
        pts = [V((x, 0, z)) for x, z in path]
        rings = []
        for i, pnt in enumerate(pts):
            d_in = (pts[i] - pts[i - 1]).normalized() if i > 0 else None
            d_out = (pts[i + 1] - pts[i]).normalized() if i < len(pts) - 1 else None
            d = ((d_in or d_out) + (d_out or d_in)).normalized()
            n = V((-d.z, 0, d.x))
            fat = 1.0 / max(0.4, d.dot(d_in or d_out))
            rings.append([self.bm.verts.new(pnt + n * (sz * h / 2 * fat) + V((0, y + sy * w / 2, 0)))
                          for sy, sz in ((-1, -1), (1, -1), (1, 1), (-1, 1))])
        faces = [self.bm.faces.new(rings[0]), self.bm.faces.new(rings[-1][::-1])]
        for a, c in zip(rings, rings[1:]):
            for k in range(4):
                k2 = (k + 1) % 4
                faces.append(self.bm.faces.new([a[k], a[k2], c[k2], c[k]]))
        bmesh.ops.recalc_face_normals(self.bm, faces=faces)
        self._paint(faces, mat)
        self._bevel([v for ring in rings for v in ring], bevel, mat)

    def bolts(self, n, radius, h0, h1, size, mat, centre=(0, 0, 0), axis='Y', start=0.0):
        """A circle of hex bolt heads round an axis, standing from h0 to h1."""
        cx, cy, cz = centre
        for k in range(n):
            a = start + 2 * math.pi * k / n
            if axis == 'Y':
                p0, p1 = (cx + radius * math.cos(a), cy + h0, cz + radius * math.sin(a)), (cx + radius * math.cos(a), cy + h1, cz + radius * math.sin(a))
            elif axis == 'Z':
                p0, p1 = (cx + radius * math.cos(a), cy + radius * math.sin(a), cz + h0), (cx + radius * math.cos(a), cy + radius * math.sin(a), cz + h1)
            else:
                p0, p1 = (cx + h0, cy + radius * math.cos(a), cz + radius * math.sin(a)), (cx + h1, cy + radius * math.cos(a), cz + radius * math.sin(a))
            self.tube(p0, p1, size, mat, segments=6, smooth=False)

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
        faces.append(bm.faces.new(rings[0]))
        faces.append(bm.faces.new(rings[-1][::-1]))
        bmesh.ops.recalc_face_normals(bm, faces=faces)
        self._paint(faces, mat, True, SOFT_ROUND)

    def loft(self, stations, mat, ends=(True, True)):
        """A body shell: skin a row of cross-sections into one solid.

        `stations` is a list of (x, half), front to back or back to front.
        Each `half` is the left half of that slice of the body as (y, z)
        points, from the bottom on the centre-line, out round the side and
        back to the centre-line on top; every slice has the same number of
        points, and the right half is mirrored. Returns the faces as
        {(slice, point, side): face}, side 1 = left and -1 = right, so the
        caller can paint stripes or turn some into windows: face (i, j, sd)
        runs from slice i to i + 1, between points j and j + 1."""
        bm = self.bm
        n = len(stations[0][1])
        rings = []
        for x, half in stations:
            assert len(half) == n
            left = [bm.verts.new((x, y, z)) for (y, z) in half]
            right = [bm.verts.new((x, -y, z)) for (y, z) in half[1:-1]]
            rings.append((left, [left[0]] + right + [left[-1]]))
        faces = {}
        for i in range(len(rings) - 1):
            for sd, k in ((1, 0), (-1, 1)):
                a, c = rings[i][k], rings[i + 1][k]
                for j in range(n - 1):
                    quad = [v for v in (a[j], a[j + 1], c[j + 1], c[j])]
                    # Slices can pinch together at a point (a corner of a window): skip doubled corners.
                    quad = [v for q, v in enumerate(quad) if (v.co - quad[q - 1].co).length > 1e-6]
                    if len(quad) >= 3:
                        faces[(i, j, sd)] = bm.faces.new(quad)
        caps = []
        for idx, want in ((0, ends[0]), (-1, ends[1])):
            if want:
                left, right = rings[idx]
                caps.append(bm.faces.new(left + right[-2:0:-1]))
        every = list(faces.values()) + caps
        bmesh.ops.recalc_face_normals(bm, faces=every)
        self._paint(every, mat)
        return faces

    def window(self, faces, frame, depth=0.012, glass='Glass', seal='Rubber'):
        """Turn a patch of a body's faces into a window: a rubber seal
        `frame` wide round the edge, and the glass set back by `depth`."""
        faces = [f for f in faces if f is not None and f.is_valid]
        out = bmesh.ops.inset_region(self.bm, faces=faces, thickness=frame, depth=-depth, use_even_offset=True,
                                     use_boundary=True)
        self._paint(out['faces'], seal, soft=0.0)
        self._paint(faces, glass)

    def recess(self, faces, frame, depth, mat=None):
        """Press a patch of faces in by `depth`, `frame` in from its edge (a
        stamped tailgate, a grille opening). `mat` repaints the sunken part."""
        faces = [f for f in faces if f is not None and f.is_valid]
        out = bmesh.ops.inset_region(self.bm, faces=faces, thickness=frame, depth=-depth, use_even_offset=True,
                                     use_boundary=True)
        if mat is not None:
            self._paint(faces, mat)
        for f in out['faces']:
            f.material_index = faces[0].material_index if mat is None else f.material_index
            f.smooth = True
            f[self.soft] = SOFT_ANGLE
        return faces

    def round_edges(self, radius, sharper=24.0, only=('Paint',), segments=None):
        """Round off this part's hard edges, the way pressed steel really
        folds: every edge sharper than `sharper` degrees between two faces
        painted one of the `only` colours gets a small radius."""
        bm = self.bm
        bm.normal_update()
        keep = {self.mats.index(m) for m in only if m in self.mats}
        edges = [e for e in bm.edges if len(e.link_faces) == 2 and
                 all(f.material_index in keep for f in e.link_faces) and
                 math.degrees(e.link_faces[0].normal.angle(e.link_faces[1].normal, 0.0)) > sharper]
        if not edges:
            return
        if segments is None:
            segments = 2 if HD else 1
        mats = {}
        for e in edges:
            for f in e.link_faces:
                mats[f.material_index] = mats.get(f.material_index, 0) + 1
        out = bmesh.ops.bevel(bm, geom=edges, offset=radius, offset_type='OFFSET', segments=segments, profile=0.5,
                              affect='EDGES', clamp_overlap=True)
        mi = max(mats, key=mats.get)
        for f in out['faces']:
            f.material_index = mi
            f.smooth = True
            f[self.soft] = SOFT_ROUND

    def cut(self, cutter):
        """Cut another part's solid out of this one (Blender's boolean), and
        throw the cutter away. Both should be closed solids. The cut faces
        take the cutter's material."""
        for f in cutter.bm.faces:
            f.material_index = self.mat(cutter.mats[f.material_index])
        objs = []
        for part in (self, cutter):
            bmesh.ops.remove_doubles(part.bm, verts=part.bm.verts, dist=1e-5)
            mesh = bpy.data.meshes.new('Cut')
            part.bm.to_mesh(mesh)
            obj = bpy.data.objects.new('Cut', mesh)
            bpy.context.scene.collection.objects.link(obj)
            objs.append(obj)
        mod = objs[0].modifiers.new('Cut', 'BOOLEAN')
        mod.operation = 'DIFFERENCE'
        mod.solver = 'EXACT'
        mod.material_mode = 'INDEX'
        mod.object = objs[1]
        done = bpy.data.meshes.new_from_object(objs[0].evaluated_get(bpy.context.evaluated_depsgraph_get()))
        self.bm.clear()
        self.bm.from_mesh(done)
        self.soft = self.bm.faces.layers.float.get('soft') or self.bm.faces.layers.float.new('soft')
        cutter.bm.free()
        for obj in objs:
            mesh = obj.data
            bpy.data.objects.remove(obj, do_unlink=True)
            bpy.data.meshes.remove(mesh)
        bpy.data.meshes.remove(done)

    def join(self, other):
        """Take another part's shapes into this one."""
        for f in other.bm.faces:
            f.material_index = self.mat(other.mats[f.material_index])
        mesh = bpy.data.meshes.new('Join')
        other.bm.to_mesh(mesh)
        other.bm.free()
        self.bm.from_mesh(mesh)
        self.soft = self.bm.faces.layers.float.get('soft') or self.bm.faces.layers.float.new('soft')
        bpy.data.meshes.remove(mesh)

    def empty_part(self):
        return len(self.bm.verts) == 0

    def to_mesh(self, materials):
        """Blender's mesh for this part. `materials` (from make_materials)
        turns each colour name into a material plus the colour and finish
        painted on the mesh's corners, so nearly everything shares a material."""
        bm = self.bm
        mesh = bpy.data.meshes.new(self.name)
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
        col = bm.loops.layers.float_color.new('Col')
        fin = bm.loops.layers.uv.new('Fin')
        used = []
        for f in bm.faces:
            mat, rgb, roughness, metallic = materials[self.mats[f.material_index]]
            if mat not in used:
                used.append(mat)
            f.material_index = used.index(mat)
            for l in f.loops:
                l[col] = (*rgb, 1.0)
                # (The exporter flips a picture's up and down, so flip it first.)
                l[fin].uv = (roughness, 1.0 - metallic)
        normals = soft_normals(bm)
        bm.to_mesh(mesh)
        bm.free()
        mesh.polygons.foreach_set('use_smooth', [True] * len(mesh.polygons))
        mesh.normals_split_custom_set(normals)
        for mat in used:
            mesh.materials.append(mat)
        return mesh

    def finish(self, materials):
        return link(self.name, self.to_mesh(materials))


def soft_normals(bm):
    """A normal for every face corner, in the order the mesh keeps them.

    Round things (tubes, tires, cans) shade smooth; corners sharper than
    SOFT_ANGLE stay crisp; and where a big flat face meets a small bevel the
    big face wins, so flat panels stay flat and only the bevel catches the
    light (what Blender's "weighted normals" does).
    """
    bm.normal_update()
    bm.verts.index_update()
    bm.faces.index_update()
    soft = bm.faces.layers.float['soft']
    out = []
    cache = {}
    for f in bm.faces:
        for l in f.loops:
            v = l.vert
            key = (v.index, f.index)
            if key not in cache:
                # The faces round this corner that f blends into: walk across the gentle edges.
                group, todo = {f}, [f]
                while todo:
                    g = todo.pop()
                    for e in g.edges:
                        if v not in e.verts or len(e.link_faces) != 2:
                            continue
                        o = e.link_faces[0] if e.link_faces[1] is g else e.link_faces[1]
                        if o in group:
                            continue
                        if math.degrees(g.normal.angle(o.normal, 0.0)) < min(g[soft], o[soft]):
                            group.add(o)
                            todo.append(o)
                n = V((0, 0, 0))
                for g in group:
                    corner = next(ll for ll in g.loops if ll.vert is v)
                    n += g.normal * (g.calc_area() * max(corner.calc_angle(), 1e-4))
                n = n.normalized() if n.length > 1e-12 else f.normal.copy()
                for g in group:
                    cache[(v.index, g.index)] = n
            out.append(cache[key])
    return [tuple(n) for n in out]


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

# The frame rails of the two trucks that have them: `y` out from the centre
# line, `w` wide, `h` deep, their middle at height `z`, from `front` to
# `rear`. Slim enough to clear the coil springs standing beside them.
#
# Over each axle the light 4x4's rails `kick` up, as a real truck's do, so a
# beam axle has room to rise to the bump stop: (how far the flat top runs
# each side of the axle, the length of the ramp, the rise). The heavy
# truck's rails sit high enough to run straight.
FRAME = {
    'light4x4': dict(y=0.43, w=0.07, h=0.16, z=0.62, front=2.1, rear=-2.3, kick=(0.22, 0.2, 0.14)),
    'heavy': dict(y=0.47, w=0.1, h=0.28, z=1.08, front=3.1, rear=-3.1, kick=None),
}


def rail_rise(cls, t, x, kicked=('F', 'R')):
    """How far a rail has kicked up at `x` along the truck."""
    f = FRAME[cls]
    if not f['kick']:
        return 0.0
    flat, ramp, rise = f['kick']
    best = 0.0
    for key in kicked:
        d = abs(x - (t['cg_front'] if key == 'F' else -t['cg_rear']))
        best = max(best, rise * min(1.0, max(0.0, (flat + ramp - d) / ramp)))
    return best


def rail_path(cls, t, x0, x1, kicked=('F', 'R')):
    """A rail's line in the side view from x0 back to x1, kicking up over the axles in `kicked`."""
    f = FRAME[cls]
    xs = [x0, x1]
    if f['kick']:
        flat, ramp, _ = f['kick']
        for key in kicked:
            xc = t['cg_front'] if key == 'F' else -t['cg_rear']
            xs += [x for x in (xc + flat + ramp, xc + flat, xc - flat, xc - flat - ramp) if x1 < x < x0]
    return [(x, f['z'] + rail_rise(cls, t, x, kicked)) for x in sorted(set(xs), reverse=True)]


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
# They differ in tread, shoulder and sidewall: an all-terrain has four rows
# of small angled blocks; a rally tire big square ones with a rib of small
# blocks down the middle; heavy ply two rows of chunky angled lugs that
# climb onto a fat sidewall.
#
# A tire is a smooth casing (bead, rim protector, sidewall, shoulder) with
# its tread blocks standing on it; each block narrows to its top, so its
# edges catch the light. The full build adds raised bars round the outer
# sidewall.

TIRE_SPEC = {
    # depth: tread depth as a share of the radius. pitches: blocks round the
    # tire (full, lite). bulge: how far the sidewall swells (share of width).
    # rows: (where across, -0.5 to 0.5; width; length as a share of the gap
    # to the next block; skew in radians). shoulder: (height, width, length)
    # of the blocks that wrap onto the sidewall, as shares of the radius.
    'allTerrain': dict(depth=0.028, pitches=(40, 22), bulge=0.49,
                       rows=[(-0.3, 0.2, 0.74, 0.3), (-0.1, 0.17, 0.72, -0.3), (0.1, 0.17, 0.72, 0.3),
                             (0.3, 0.2, 0.74, -0.3)],
                       shoulder=(0.014, 0.06, 0.68)),
    'rallyTires': dict(depth=0.042, pitches=(26, 16), bulge=0.51,
                       rows=[(-0.25, 0.31, 0.7, 0.0), (0.0, 0.14, 0.5, 0.0), (0.25, 0.31, 0.7, 0.0)],
                       shoulder=(0.02, 0.09, 0.66)),
    'heavyPly': dict(depth=0.06, pitches=(18, 12), bulge=0.55,
                     rows=[(-0.2, 0.38, 0.6, 0.42), (0.2, 0.38, 0.6, -0.42)],
                     shoulder=(0.032, 0.15, 0.6)),
}


def kit_tire(name, t, kind):
    r, w = t['radius'], t['tire']
    p = Part(name)
    spec = TIRE_SPEC[kind]
    depth, bulge = spec['depth'] * r, spec['bulge']
    pitches = spec['pitches'][0 if HD else 1]
    rb = r - depth  # the casing under the tread
    rim_r = r * 0.58
    # The casing, from the inner bead round to the outer one.
    half = [(rim_r * 0.99, 0.42), (rim_r * 1.1, 0.462), (rim_r * 1.19, 0.492), (rim_r * 1.25, 0.474)]
    if HD:
        half.append((r * 0.7, bulge - 0.02))
    half += [(r * 0.8, bulge), (r * 0.9, bulge - 0.02), (rb * 0.985, 0.452), (rb, 0.37)]
    if HD:
        half.append((rb, 0.18))
    profile = [(rr, -h * w) for rr, h in half] + [(rb, 0.0)] + [(rr, h * w) for rr, h in reversed(half)]
    p.lathe(profile, 'Rubber', segments=seg(48, 28), closed=False, side='right')

    step = 2 * math.pi * rb / pitches  # from one block to the next, round the tire
    for row, (pos, width, length, skew) in enumerate(spec['rows']):
        for k in range(pitches):
            a = 2 * math.pi * (k + (0.5 if row % 2 else 0.0)) / pitches
            out = V((math.cos(a), 0, math.sin(a)))
            tangent = V((-math.sin(a), 0, math.cos(a)))
            across = (V((0, 1, 0)) * math.cos(skew) + tangent * math.sin(skew)).normalized()
            p.lug(out * (rb - 0.004 * r) + V((0, pos * w, 0)), out, across, out.cross(across),
                  (depth + 0.004 * r, width * w, length * step), 'Rubber')
    # Shoulder blocks, leaning out over the sidewall, every other one longer.
    sh, sw, sl = spec['shoulder']
    for k in range(pitches):
        a = 2 * math.pi * (k + 0.25) / pitches
        radial = V((math.cos(a), 0, math.sin(a)))
        tangent = V((-math.sin(a), 0, math.cos(a)))
        for sd in (-1, 1):
            out = (radial * 0.55 + V((0, sd, 0)) * 0.84).normalized()
            down = (radial * -0.84 + V((0, sd, 0)) * 0.55).normalized()
            reach = sw * r * (1.35 if k % 2 else 1.0)
            c = radial * (rb * 0.975) + V((0, sd * 0.462 * w, 0)) + down * (reach * 0.3) - out * 0.006 * r
            p.lug(c, out, down, tangent, (sh * r + 0.006 * r, reach, sl * step), 'Rubber', taper=0.85)
    if HD:
        # Raised bars round the outer sidewall, where a real tire has its lettering.
        n = 30
        for k in range(n):
            if k % 5 == 4:
                continue
            a = 2 * math.pi * k / n
            radial = V((math.cos(a), 0, math.sin(a)))
            c = radial * (r * 0.75) + V((0, (bulge - 0.012) * w, 0))
            p.lug(c, V((0, 1, 0)), radial, V((-math.sin(a), 0, math.cos(a))), (0.007 * r, 0.085 * r, 0.05 * r), 'Rubber',
                  taper=0.8)
    return p


# --- The kit: rims -------------------------------------------------------------
# Steel wheels are a painted, pressed dish with round holes; alloys are
# silver with open twin spokes (you can see the brake through them);
# beadlocks are black, with short stout spokes and a bright bolted ring
# clamping the tire on the outside.
#
# Each wheel also carries its brake disc, so the disc turns with it, and the
# hub in the middle is the class's own: a locking hub on the light 4x4, a
# big reduction hub on the heavy truck, a small cap on the side-by-side.

HUBS = {
    # nuts, the circle they sit on (share of the rim's radius), hub style
    'light4x4': (6, 0.3, 'locking'),
    'heavy': (10, 0.37, 'reduction'),
    'sxs': (4, 0.27, 'cap'),
}
# Where the brake disc sits across the wheel (share of the tire's width,
# from the middle outwards) and how big it is (share of the rim's radius).
DISC_AT, DISC_R = -0.15, 0.8


def kit_rim(name, t, kind, cls):
    r, w = t['radius'], t['tire']
    rr = r * 0.58
    p = Part(name)
    body = {'steelWheels': 'WheelPaint', 'alloyWheels': 'Alloy', 'beadlocks': 'Graphite'}[kind]
    n = seg(40, 24)
    yf = {'steelWheels': 0.27, 'alloyWheels': 0.3, 'beadlocks': 0.3}[kind] * w  # the wheel's face
    # The barrel: the outer lip, the wall down inside the wheel, and the inner lip.
    lip = [(rr * 1.0, 0.415 * w), (rr * 1.1, 0.43 * w), (rr * 1.1, 0.462 * w), (rr * 1.03, 0.47 * w),
           (rr * 0.955, 0.455 * w), (rr * 0.92, 0.42 * w)]
    back = [(rr * 0.9, yf), (rr * 0.92, -0.42 * w), (rr * 0.96, -0.47 * w), (rr * 1.09, -0.47 * w),
            (rr * 1.09, -0.44 * w)]
    p.lathe(lip + back, body, segments=n, closed=False, side='right')

    nuts, nut_r, hub = HUBS[cls]
    pad = yf + 0.1 * w  # the flat the wheel nuts sit on
    if kind == 'steelWheels':
        # The pressed dish, swelling out to the hub: a real sheet of steel
        # with round holes through it (you can see the brake behind).
        th = 0.022 * w
        front = [(rr * 0.9, yf), (rr * 0.82, yf + 0.012 * w), (rr * 0.56, yf + 0.075 * w), (rr * 0.46, yf + 0.082 * w),
                 (rr * 0.42, pad), (rr * 0.16, pad)]
        dish = Part('Dish')
        dish.lathe(front + [(q, h - th) for q, h in reversed(front)] + [front[0]], body, segments=n, closed=False)
        holes = Part('Holes')
        for k in range(8):
            a = 2 * math.pi * (k + 0.5) / 8
            c = V((rr * 0.69 * math.cos(a), yf + 0.045 * w, rr * 0.69 * math.sin(a)))
            holes.tube(tuple(c - V((0, 0.1 * w, 0))), tuple(c + V((0, 0.1 * w, 0))), rr * 0.085, body, segments=seg(14, 8))
        dish.cut(holes)
        p.join(dish)
    else:
        # Spokes from the hub out to the barrel, with open air between them.
        pad = yf + 0.06 * w
        p.lathe([(rr * 0.4, yf - 0.03 * w), (rr * 0.39, yf + 0.04 * w), (rr * 0.34, pad), (rr * 0.16, pad)], body,
                segments=n, closed=False, side='right')
        if kind == 'alloyWheels':
            pairs, gap, w0, w1, rise = 6, 0.115, 0.1, 0.065, 0.4
        else:
            pairs, gap, w0, w1, rise = 8, 0.0, 0.2, 0.16, 0.38
        for k in range(pairs):
            for d in ((-gap, gap) if gap else (0.0,)):
                a = 2 * math.pi * k / pairs + d
                a1 = a + d * 0.9  # twin spokes splay apart towards the rim
                p.beam((rr * 0.33 * math.cos(a), yf + 0.02 * w, rr * 0.33 * math.sin(a)),
                       (rr * 0.93 * math.cos(a1), rise * w, rr * 0.93 * math.sin(a1)), (0, 1, 0),
                       w0 * rr, 0.09 * w, body, w1=w1 * rr, t1=0.05 * w)
        if kind == 'beadlocks':
            # The beadlock ring and its bolts.
            p.ring(rr * 0.9, rr * 1.15, 0.44 * w, 0.488 * w, 'Alloy', segments=n)
            p.bolts(seg(24, 12), rr * 1.03, 0.485 * w, 0.505 * w, rr * 0.028, 'Chrome')
    # Wheel nuts on their studs, and the hub.
    p.bolts(nuts, rr * nut_r, pad - 0.005 * w, pad + 0.045 * w, rr * 0.042, 'Chrome', start=math.pi / nuts)
    if hub == 'locking':
        # A free-wheeling hub: a bright drum with a dial you turn to lock it.
        p.lathe([(rr * 0.2, pad), (rr * 0.2, pad + 0.13 * w), (rr * 0.17, pad + 0.15 * w), (0.0, pad + 0.15 * w)],
                'Steel', segments=seg(20, 12), closed=False, side='right')
        p.tube((0, pad + 0.15 * w, 0), (0, pad + 0.175 * w, 0), rr * 0.1, 'Graphite', segments=6, smooth=False)
        if HD:
            p.bolts(6, rr * 0.15, pad + 0.148 * w, pad + 0.158 * w, rr * 0.018, 'Graphite')
    elif hub == 'reduction':
        # The heavy truck's hub holds a set of gears: a big domed cover with a ring of bolts.
        p.lathe([(rr * 0.28, pad), (rr * 0.28, pad + 0.1 * w), (rr * 0.22, pad + 0.19 * w), (rr * 0.1, pad + 0.22 * w),
                 (0.0, pad + 0.22 * w)], 'Trim', segments=seg(24, 14), closed=False, side='right')
        p.bolts(seg(12, 6), rr * 0.25, pad + 0.1 * w, pad + 0.125 * w, rr * 0.022, 'Steel')
        p.tube((0, pad + 0.22 * w, 0), (0, pad + 0.24 * w, 0), rr * 0.045, 'Steel', segments=6, smooth=False)
    else:
        p.lathe([(rr * 0.15, pad), (rr * 0.15, pad + 0.05 * w), (rr * 0.11, pad + 0.08 * w), (0.0, pad + 0.085 * w)],
                'Steel', segments=seg(16, 10), closed=False, side='right')

    # The brake disc and its hat, behind the face.
    y0 = DISC_AT * w
    p.ring(rr * 0.34, rr * DISC_R, y0 - 0.022 * w, y0 + 0.022 * w, 'Disc', segments=seg(32, 18))
    p.lathe([(rr * 0.36, y0 + 0.02 * w), (rr * 0.36, yf - 0.03 * w)], 'Shadow', segments=seg(16, 10), closed=False,
            side='right')
    return p


def brake_caliper(p, t, side, s):
    """The caliper gripping the disc at the back of the wheel (it's on the
    upright, so it stays put while the disc turns)."""
    r, w = t['radius'], t['tire']
    rr = r * 0.58
    y = side * DISC_AT * w
    a = math.radians(145)  # up and to the rear, where it shows through the spokes
    c = V((rr * 0.66 * math.cos(a), y, rr * 0.66 * math.sin(a)))
    rot = Matrix.Rotation(-a, 3, 'Y')
    p.box(tuple(c), (rr * 0.3, 0.13 * w, rr * 0.5), 'Cast', rot=rot, bevel=0.012 * s)
    if HD:
        # The two pistons' bores on the inner side, and the bridge bolts.
        tangent = V((-math.sin(a), 0, math.cos(a)))
        for k in (-1, 1):
            q = c + tangent * (k * rr * 0.12)
            p.tube(tuple(q - V((0, side * 0.065 * w, 0))), tuple(q - V((0, side * 0.1 * w, 0))), rr * 0.085, 'Cast',
                   segments=10)
            p.tube(tuple(q + V((0, side * 0.06 * w, 0))), tuple(q + V((0, side * 0.075 * w, 0))), rr * 0.03, 'Steel',
                   segments=6, smooth=False)


# --- The kit: shocks -------------------------------------------------------------
# The shock's body hangs down from its top eye and its shaft stands up from
# its bottom eye; the game slides them past each other. The bodies get
# bigger and busier up the price list:
#
#   twin-tube         plain black, with a ribbed rubber boot over the shaft
#   monotube          a bare zinc body with black ends
#   remote reservoir  blue ends, and a separate can of oil on a braided hose
#   bypass            a fat silver body with three outside tubes, each with
#                     a blue adjuster at both ends, and a piggyback can
#   internal bypass   black with blue ends, adjuster rings and a piggyback can
#   electronic        black and chrome, with an amber valve box and its wire
#   spool valve       (2017) black, with a square valve block under the top
#                     eye, three amber spool caps a side, and a piggyback can
#
# A coil spring sits round the shock, so anything that hangs off the body
# (a can, a valve box) is carried on a bridge from the top cap, over the
# spring's top seat, and hangs down outside the coils.

SHOCK_R = 0.032  # a plain shock body's radius on the light 4x4 (m)
CAN_OUT = 4.1    # how far out a piggyback can hangs, in body radii (clear of the spring)


def shock_eye(p, br, mat='Steel', axis='Y'):
    """The eye a shock bolts through: a steel ring, its rubber bushing and the sleeve the bolt runs in."""
    along = V((0, 1, 0)) if axis == 'Y' else V((1, 0, 0))
    for rad, half, m, n in ((0.62, 0.72, mat, seg(14, 8)), (0.47, 0.82, 'Rubber', seg(12, 8)), (0.26, 0.95, 'Steel', 8)):
        if not HD and m == 'Rubber':
            continue
        p.tube(tuple(-along * half * br), tuple(along * half * br), rad * br, m, segments=n)


def piggyback(p, br, L, body, cap, reach=0.5):
    """A can of oil carried beside the shock on a bridge from the top cap."""
    cx = CAN_OUT * br
    p.box((cx / 2, 0, -0.62 * br), (cx, 0.95 * br, 0.62 * br), body, bevel=0.1 * br)
    n = seg(16, 10)
    p.lathe([(0.0, -0.2 * br), (0.5 * br, -0.2 * br), (0.84 * br, -0.5 * br), (0.84 * br, -L * reach), (0.6 * br, -L * reach - 0.25 * br),
             (0.0, -L * reach - 0.25 * br)], body, segments=n, centre=(cx, 0, 0), axis='Z', closed=False, side='right')
    p.ring(0.84 * br, 0.92 * br, -1.3 * br, -0.5 * br, cap, segments=n, centre=(cx, 0, 0), axis='Z')
    p.ring(0.84 * br, 0.92 * br, -L * reach, -L * reach + 0.5 * br, cap, segments=n, centre=(cx, 0, 0), axis='Z')
    if HD:
        # The gas valve on the bottom, and a label band.
        p.tube((cx, 0, -L * reach - 0.25 * br), (cx, 0, -L * reach - 0.55 * br), 0.12 * br, 'Steel', segments=6, smooth=False)
        p.ring(0.84 * br, 0.865 * br, -L * reach * 0.62, -L * reach * 0.38, 'Board', segments=n, centre=(cx, 0, 0), axis='Z')


def kit_shock_body(name, length, s, kind, eye_axis='Y'):
    L = length * 0.62
    br = SHOCK_R * s
    p = Part(name)
    # body radius (in plain-shock radii), body, end caps, eye
    R, body, cap, eye = {
        'twinTube': (0.9, 'Graphite', 'Graphite', 'Graphite'),
        'monotube': (1.0, 'Steel', 'Graphite', 'Steel'),
        'remoteReservoir': (1.05, 'Steel', 'Anodised', 'Steel'),
        'bypass': (1.35, 'Steel', 'Anodised', 'Steel'),
        'internalBypass': (1.2, 'Graphite', 'Anodised', 'Steel'),
        'electronic': (1.2, 'Graphite', 'Chrome', 'Steel'),
        'spoolValve': (1.2, 'Graphite', 'Steel', 'Steel'),
    }[kind]
    R *= br
    n = seg(18, 10)
    shock_eye(p, br, eye, eye_axis)
    # The neck under the eye, the top cap, the body, and the seal head the shaft comes out of.
    p.lathe([(0.0, -0.3 * br), (0.46 * br, -0.4 * br), (0.5 * br, -1.0 * br), (R * 1.07, -1.22 * br), (R * 1.07, -2.0 * br),
             (R, -2.1 * br)], cap, segments=n, axis='Z', closed=False, side='right')
    p.lathe([(R, -2.1 * br), (R, -L + 0.9 * br)], body, segments=n, axis='Z', closed=False, side='right')
    p.lathe([(R, -L + 0.9 * br), (R * 1.07, -L + 0.8 * br), (R * 1.07, -L + 0.12 * br), (R * 0.9, -L), (0.55 * br, -L),
             (0.55 * br, -L - 0.12 * br), (0.0, -L - 0.12 * br)], cap, segments=n, axis='Z', closed=False, side='right')

    if kind == 'twinTube':
        # A ribbed rubber boot over the shaft, hanging off the body's end.
        ribs = seg(6, 3)
        prof = [(R * 1.02, -L * 0.7)]
        for k in range(ribs):
            z0 = -L * 0.7 - (L * 0.3 + 1.6 * br) * k / ribs
            dz = (L * 0.3 + 1.6 * br) / ribs
            prof += [(R * 1.2, z0 - dz * 0.5), (R * 0.98, z0 - dz)]
        p.lathe(prof, 'Rubber', segments=n, axis='Z', closed=False, side='right')
    elif kind == 'monotube':
        if HD:
            p.ring(R, R * 1.03, -L * 0.42, -L * 0.42 + 0.14 * br, 'Graphite', segments=n, axis='Z')
            p.ring(R, R * 1.02, -L * 0.3, -L * 0.14, 'Board', segments=n, axis='Z')
    elif kind == 'remoteReservoir':
        # The separate can of oil, on a braided hose from a banjo on the top cap.
        cx = CAN_OUT * br
        top = -1.9 * br
        p.lathe([(0.0, top + 0.5 * br), (0.3 * br, top + 0.5 * br), (0.3 * br, top + 0.15 * br), (0.8 * br, top),
                 (0.8 * br, -L * 0.62), (0.55 * br, -L * 0.62 - 0.25 * br), (0.0, -L * 0.62 - 0.25 * br)], 'Steel',
                segments=seg(16, 10), centre=(cx, 0, 0), axis='Z', closed=False, side='right')
        for z0, z1 in ((top - 0.9 * br, top - 0.1 * br), (-L * 0.62, -L * 0.62 + 0.6 * br)):
            p.ring(0.8 * br, 0.88 * br, z0, z1, 'Anodised', segments=seg(16, 10), centre=(cx, 0, 0), axis='Z')
        p.tube((0.3 * br, 0, -0.7 * br), (0.95 * br, 0, -0.7 * br), 0.3 * br, 'Anodised', segments=8)
        p.sweep([(0.9 * br, 0, -0.7 * br), (2.0 * br, 0, -0.1 * br), (3.2 * br, 0, 0.1 * br), (cx, 0, -0.6 * br),
                 (cx, 0, top + 0.5 * br)], 0.2 * br, 'Hose', sides=seg(8, 6), curve=3 if HD else 1)
        if HD:
            p.tube((cx, 0, -L * 0.62 - 0.25 * br), (cx, 0, -L * 0.62 - 0.55 * br), 0.12 * br, 'Steel', segments=6, smooth=False)
            p.ring(0.8 * br, 0.825 * br, -L * 0.42, -L * 0.24, 'Board', segments=16, centre=(cx, 0, 0), axis='Z')
    elif kind == 'bypass':
        # The outside bypass tubes, each with a blue adjuster at both ends.
        for k, ang in enumerate((math.pi - 0.95, math.pi, math.pi + 0.95)):
            x, y = R * 1.2 * math.cos(ang), R * 1.2 * math.sin(ang)
            top, bot = -L * (0.2 + 0.05 * k), -L * (0.7 + 0.05 * k)
            p.tube((x, y, top), (x, y, bot), br * 0.2, 'Steel', segments=8)
            for z in (top, bot):
                p.tube((x, y, z + br * 0.28), (x, y, z - br * 0.28), br * 0.3, 'Anodised', segments=seg(10, 6))
                if HD:
                    out = V((math.cos(ang), math.sin(ang), 0))
                    q = V((x, y, z))
                    p.tube(tuple(q + out * 0.2 * br), tuple(q + out * 0.5 * br), br * 0.14, 'Chrome', segments=6, smooth=False)
        piggyback(p, br, L, 'Steel', 'Anodised', reach=0.55)
    elif kind == 'internalBypass':
        # Adjuster rings round the body show the tuning inside.
        for z in (0.38, 0.52):
            p.ring(R, R * 1.08, -L * z - br * 0.3, -L * z, 'Steel', segments=n, axis='Z')
        piggyback(p, br, L, 'Graphite', 'Anodised')
    elif kind == 'spoolValve':
        # The valve block beside the top cap, its three spools' caps in a row on each side face, and the can.
        p.box((1.9 * br, 0, -0.75 * br), (3.4 * br, 1.9 * br, 1.3 * br), 'Graphite', bevel=br * 0.14)
        for k in (-1, 0, 1):
            for sd in (-1, 1):
                x = 1.9 * br + k * br * 1.0
                p.tube((x, sd * 0.9 * br, -0.75 * br), (x, sd * 1.22 * br, -0.75 * br), br * 0.34, 'Urethane', segments=seg(10, 6))
                if HD:
                    p.tube((x, sd * 1.2 * br, -0.75 * br), (x, sd * 1.3 * br, -0.75 * br), br * 0.16, 'Graphite', segments=6,
                           smooth=False)
        piggyback(p, br, L, 'Graphite', 'Steel')
    else:  # electronic
        # The valve box on its bridge, outside the spring, and the wire up to the truck.
        cx = CAN_OUT * br
        p.box((cx / 2, 0, -0.62 * br), (cx, 0.95 * br, 0.62 * br), 'Graphite', bevel=0.1 * br)
        p.box((cx, 0, -1.9 * br), (1.5 * br, 1.7 * br, 2.6 * br), 'Urethane', bevel=br * 0.2)
        p.box((cx, 0, -3.35 * br), (1.0 * br, 1.1 * br, 0.5 * br), 'Graphite', bevel=br * 0.08)
        p.sweep([(cx, 0, -3.5 * br), (cx + 0.5 * br, 0, -4.6 * br), (cx + 1.4 * br, 0, -3.4 * br), (cx + 1.2 * br, 0, -0.6 * br),
                 (cx + 0.2 * br, 0.3 * br, 0.9 * br)], br * 0.11, 'Rubber', sides=6, curve=3 if HD else 1)
    return p


def kit_shaft(name, length, s, eye_axis='Y'):
    br = SHOCK_R * s
    p = Part(name)
    shock_eye(p, br, 'Steel', eye_axis)
    # The rod end and its lock nut, a rubber bump on the shaft, and the chromed shaft itself.
    p.lathe([(0.0, 0.3 * br), (0.5 * br, 0.4 * br), (0.5 * br, 1.0 * br)], 'Steel', segments=seg(12, 8), axis='Z', closed=False,
            side='right')
    p.tube((0, 0, 1.0 * br), (0, 0, 1.45 * br), 0.62 * br, 'Steel', segments=6, smooth=False)
    p.lathe([(0.45 * br, 1.45 * br), (0.8 * br, 1.55 * br), (0.8 * br, 2.3 * br), (0.5 * br, 2.9 * br)], 'Rubber',
            segments=seg(12, 8), axis='Z', closed=False, side='right')
    p.tube((0, 0, 1.4 * br), (0, 0, length * 0.62), br * 0.43, 'Chrome', segments=seg(12, 8))
    return p


def kit_spring(name, length, s, span=0.8):
    """A coil spring with its seats. `span` is the share of the shock's
    length it covers, from just under the top eye: a coilover's spring stops
    well short of the bottom eye, which leaves room for suspension arms."""
    br = SHOCK_R * s
    p = Part(name)
    top, run = -length * 0.08, length * span
    # Wide enough to clear the fattest shock body.
    p.helix((0, 0, top), run, br * 2.25, 0.011 * s, 7 if span > 0.7 else 6, 'Magenta', steps=seg(18, 10), sides=seg(8, 5))
    n = seg(20, 12)
    # The top seat, with the collar that sets the preload, and the bottom perch on the shaft's end.
    p.lathe([(br * 1.5, 0.0), (br * 1.5, 0.014 * s), (br * 2.7, 0.012 * s), (br * 2.75, 0.0), (br * 2.7, -0.008 * s),
             (br * 1.5, -0.008 * s), (br * 1.5, 0.0)], 'Graphite', segments=n, centre=(0, 0, top + 0.012 * s), axis='Z',
            closed=False)
    p.lathe([(br * 0.6, 0.0), (br * 0.6, 0.008 * s), (br * 2.7, 0.008 * s), (br * 2.75, 0.0), (br * 2.4, -0.014 * s),
             (br * 0.6, -0.014 * s), (br * 0.6, 0.0)], 'Graphite', segments=n, centre=(0, 0, top - run - 0.012 * s), axis='Z',
            closed=False)
    if HD:
        # Notches round the collar for the spanner.
        for k in range(8):
            a = 2 * math.pi * k / 8
            p.box((br * 2.7 * math.cos(a), br * 2.7 * math.sin(a), top + 0.014 * s), (0.4 * br, 0.5 * br, 0.016 * s), 'Steel',
                  rot=Matrix.Rotation(a, 3, 'Z'))
    return p


# --- The kit: bump stops --------------------------------------------------------
# Hanging down from the frame over each wheel, where the axle or arm hits at
# full bump: a black rubber cone, an amber urethane stack, or a hydraulic
# bump stop (a tiny damper of its own, with a blue cap).

def bump_stop(p, top, s, kind):
    x, y, z = top
    L = 0.09 * s
    n = seg(16, 10)
    c = (x, y, z - 0.012 * s)
    # The plate it bolts to the frame through.
    p.box((x, y, z - 0.006 * s), (0.1 * s, 0.09 * s, 0.012 * s), 'Steel', bevel=0.003 * s)
    if HD:
        for dx in (-0.036, 0.036):
            p.tube((x + dx * s, y, z - 0.012 * s), (x + dx * s, y, z - 0.02 * s), 0.008 * s, 'Chrome', segments=6, smooth=False)
    if kind == 'rubber':
        p.lathe([(0.03 * s, 0), (0.031 * s, -L * 0.28), (0.024 * s, -L * 0.38), (0.027 * s, -L * 0.55), (0.02 * s, -L * 0.72),
                 (0.012 * s, -L * 0.8), (0.0, -L * 0.82)], 'Rubber', segments=n, centre=c, axis='Z', closed=False, side='right')
    elif kind == 'urethane':
        p.lathe([(0.04 * s, 0), (0.04 * s, -L * 0.18), (0.034 * s, -L * 0.18)], 'Steel', segments=n, centre=c, axis='Z',
                closed=False, side='right')
        p.lathe([(0.034 * s, -L * 0.18), (0.035 * s, -L * 0.24), (0.026 * s, -L * 0.3), (0.033 * s, -L * 0.41), (0.026 * s, -L * 0.52),
                 (0.031 * s, -L * 0.63), (0.024 * s, -L * 0.74), (0.02 * s, -L * 0.8), (0.0, -L * 0.82)], 'Urethane', segments=n,
                centre=c, axis='Z', closed=False, side='right')
    else:
        p.lathe([(0.035 * s, 0), (0.036 * s, -L * 0.16), (0.032 * s, -L * 0.18)], 'Anodised', segments=n, centre=c, axis='Z',
                closed=False, side='right')
        p.lathe([(0.032 * s, -L * 0.18), (0.032 * s, -L * 0.7), (0.028 * s, -L * 0.75), (0.012 * s, -L * 0.75)], 'Steel', segments=n,
                centre=c, axis='Z', closed=False, side='right')
        p.tube((x, y, z - L * 0.75), (x, y, z - L * 1.05), 0.012 * s, 'Chrome', segments=8)
        p.lathe([(0.012 * s, 0.01 * s), (0.022 * s, 0), (0.022 * s, -L * 0.1), (0.0, -L * 0.13)], 'Rubber', segments=seg(12, 8),
                centre=(x, y, z - L * 1.05), axis='Z', closed=False, side='right')


# --- The kit: anti-roll bars ---------------------------------------------------------
# One bent bar: across the frame in two rubber bushings, then an arm running
# along each side, with a drop link down to the axle. The adjustable kind
# has flat blue blade arms with a row of holes for the link.

def roll_bar(p, x, half, z, arm, link_to, s, adjustable, flip=1):
    r = 0.017 * s
    ends = []
    for side in (-1, 1):
        ends.append(V((x - flip * arm, side * half, z)))
    if adjustable:
        p.tube((x, -half, z), (x, half, z), r, 'Graphite', segments=seg(10, 6))
    else:
        bend = 0.04 * s
        p.sweep([ends[0], (x - flip * bend, -half, z), (x, -half + bend, z), (x, half - bend, z), (x - flip * bend, half, z),
                 ends[1]], r, 'Graphite', sides=seg(10, 6))
    for side, end in zip((-1, 1), ends):
        y = side * half
        # The bushing and its clamp on the frame.
        by = side * (half - 0.09 * s)
        p.tube((x, by - 0.022 * s, z), (x, by + 0.022 * s, z), r * 1.7, 'Rubber', segments=seg(10, 6))
        p.box((x, by, z + r * 1.5), (0.07 * s, 0.03 * s, 0.012 * s), 'Steel')
        if adjustable:
            p.box((x - flip * arm / 2, y, z), (arm + 0.04 * s, 0.012 * s, 0.05 * s), 'Anodised', bevel=0.003 * s)
            for k in range(3):
                hx = x - flip * arm * (0.55 + 0.15 * k)
                p.tube((hx, y - 0.008 * s, z), (hx, y + 0.008 * s, z), 0.008 * s, 'Shadow', segments=8)
        # The drop link, with a small joint at each end.
        low = V((end.x, y, link_to))
        p.tube(tuple(end), tuple(low), 0.008 * s, 'Steel', segments=6)
        for q in (end, low):
            p.tube((q.x, y - 0.014 * s, q.z), (q.x, y + 0.014 * s, q.z), 0.014 * s, 'Steel', segments=seg(8, 6))


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


# --- The kit: recovery ----------------------------------------------------------------
# Traction boards (steel sand ladders or orange nylon boards), a high-lift jack
# and a winch (the recovery kit, src/data/recovery.ts). Boards and jacks are
# drawn in a frame of their own: `axes` names the world axis for the length,
# the width and the thickness, so one helper lays a board flat, on its side or
# upright.

STEEL_BOARDS = ['sandLadders', 'laddersJack', 'cableWinch']
NYLON_BOARDS = ['boardsJack', 'ropeWinch']
JACKS = ['laddersJack', 'cableWinch', 'boardsJack', 'ropeWinch']


def kit_frame(centre, axes):
    """Two helpers for a part drawn along `axes`: a point at (length, width,
    thickness) from `centre`, and a box size in that frame."""
    idx = {'X': 0, 'Y': 1, 'Z': 2}
    order = [idx[a] for a in axes]

    def at(u, v=0.0, w=0.0):
        c = list(centre)
        for k, d in zip(order, (u, v, w)):
            c[k] += d
        return tuple(c)

    def size(lu, lv, lw):
        out = [0.0, 0.0, 0.0]
        for k, d in zip(order, (lu, lv, lw)):
            out[k] = d
        return tuple(out)

    return at, size


def traction_board(p, centre, length, width, nylon, axes=('X', 'Z', 'Y'), out=1):
    """One board: a steel ladder (two rails and rungs) or a nylon board with
    rows of cleats and a handle slot at each end. `out` is the side that faces
    outwards (+1 or -1 along the thickness)."""
    at, size = kit_frame(centre, axes)
    if nylon:
        th = 0.024
        p.box(at(0), size(length, width, th), 'Urethane', bevel=0.01)
        n = seg(7, 4)
        for k in range(n):
            u = -length * 0.36 + length * 0.72 * k / (n - 1)
            p.box(at(u, 0, out * th * 0.6), size(0.028, width * 0.82, 0.014), 'Urethane', bevel=0.004)
        for u in (-length * 0.44, length * 0.44):
            p.box(at(u, 0, out * th * 0.52), size(0.03, width * 0.42, 0.004), 'Shadow')
    else:
        for v in (-width / 2 + 0.016, width / 2 - 0.016):
            p.box(at(0, v), size(length, 0.032, 0.034), 'Steel', bevel=0.006)
        n = seg(10, 6)
        for k in range(n):
            u = -length / 2 + 0.05 + (length - 0.1) * k / (n - 1)
            p.box(at(u, 0, out * 0.004), size(0.045, width - 0.03, 0.018), 'Steel', bevel=0.004)


def board_pair(p, centre, length, width, nylon, axes=('X', 'Z', 'Y'), out=1, strap='Graphite'):
    """Two boards stacked face to face, strapped down at two places."""
    at, size = kit_frame(centre, axes)
    gap = 0.03 if not nylon else 0.028
    for k in (0, 1):
        traction_board(p, at(0, 0, out * k * gap), length, width, nylon, axes, out)
    for u in (-length * 0.28, length * 0.28):
        p.box(at(u, 0, out * gap * 0.5), size(0.035, width + 0.02, gap + 0.05), strap)


def high_lift_jack(p, centre, length, axes=('Z', 'X', 'Y'), out=1):
    """A high-lift jack: the tall bar with its row of holes, the foot, the
    climbing jack and its handle folded along the bar, and the top clamp."""
    at, size = kit_frame(centre, axes)
    p.box(at(0), size(length, 0.055, 0.026), 'Jerry', bevel=0.004)
    n = seg(14, 0)
    for k in range(n):
        u = -length * 0.4 + length * 0.82 * k / max(1, n - 1)
        p.box(at(u, 0, out * 0.0135), size(0.02, 0.018, 0.004), 'Shadow')
    p.box(at(-length / 2 + 0.012), size(0.024, 0.16, 0.12), 'Graphite', bevel=0.006)
    p.box(at(-length * 0.18, 0, out * 0.03), size(0.17, 0.085, 0.06), 'Steel', bevel=0.008)
    p.box(at(-length * 0.18 + 0.1, 0.05, out * 0.03), size(0.06, 0.03, 0.03), 'Graphite')
    p.box(at(length * 0.12, 0, out * 0.068), size(length * 0.55, 0.026, 0.026), 'Steel', bevel=0.006)
    p.box(at(length / 2 - 0.02), size(0.04, 0.075, 0.045), 'Graphite', bevel=0.006)


def winch(p, centre, width, rope, s, face=1):
    """A winch facing forward (+X when `face` is 1): the drum with its cable or
    rope wound on, the motor on one end and the gearbox on the other, tie
    bars over the drum, the fairlead in front, the hook, and a cradle under it."""
    x, y, z = centre
    r = 0.06 * s
    h = width / 2
    p.tube((x, y - h * 0.52, z), (x, y + h * 0.52, z), r * 0.75, 'Graphite', segments=seg(14, 8))
    p.tube((x, y - h * 0.48, z), (x, y + h * 0.48, z), r, 'Magenta' if rope else 'Steel', segments=seg(16, 8))
    if HD:
        for k in range(7):
            yy = y - h * 0.42 + h * 0.84 * k / 6
            p.tube((x, yy - 0.004, z), (x, yy + 0.004, z), r * 1.04, 'Graphite' if not rope else 'Shadow', segments=16)
    p.tube((x, y + h * 0.5, z), (x, y + h, z), r * 1.1, 'Graphite', segments=seg(16, 8))
    p.tube((x, y + h, z), (x, y + h + 0.012 * s, z), r * 0.7, 'Steel', segments=seg(12, 6))
    p.box((x, y - h * 0.72, z), (r * 2.3, h * 0.42, r * 2.3), 'Graphite', bevel=0.012 * s)
    for dz in (-1, 1):
        p.tube((x - face * r * 0.6, y - h * 0.52, z + dz * r * 1.15), (x - face * r * 0.6, y + h * 0.5, z + dz * r * 1.15),
               0.008 * s, 'Steel', segments=6)
    fx = x + face * r * 1.6
    if rope:
        p.box((fx, y, z), (0.018 * s, 0.2 * s, 0.09 * s), 'Alloy', bevel=0.006 * s)
        p.box((fx + face * 0.01 * s, y, z), (0.01 * s, 0.11 * s, 0.03 * s), 'Shadow', bevel=0.004 * s)
    else:
        for dz in (-1, 1):
            p.tube((fx, y - 0.08 * s, z + dz * 0.025 * s), (fx, y + 0.08 * s, z + dz * 0.025 * s), 0.014 * s, 'Steel', segments=seg(10, 6))
        for dy in (-1, 1):
            p.tube((fx, y + dy * 0.035 * s, z - 0.05 * s), (fx, y + dy * 0.035 * s, z + 0.05 * s), 0.012 * s, 'Steel', segments=seg(10, 6))
        p.box((fx - face * 0.012 * s, y, z), (0.012 * s, 0.22 * s, 0.13 * s), 'Graphite', bevel=0.004 * s)
    p.box((fx + face * 0.035 * s, y, z - 0.01 * s), (0.04 * s, 0.018 * s, 0.06 * s), 'Magenta', bevel=0.006 * s)
    p.box((x, y, z - r * 1.25), (r * 2.8, width * 1.05, 0.012 * s), 'Graphite', bevel=0.004 * s)


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
        self.corner = {}
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


def shock_tower(p, cls, t, top, side, s):
    """What holds a shock's top eye on a beam-axle truck: a post standing on
    the frame rail, inboard of the spring, and a cap reaching out over the
    spring's top seat with two ears that grip the eye."""
    f = FRAME[cls]
    br = SHOCK_R * s
    x, y, z = top
    rail_top = f['z'] + f['h'] / 2 + rail_rise(cls, t, x)
    cap = z + 1.1 * br
    ry = side * f['y']
    p.box((x, ry, (rail_top + cap) / 2), (0.1 * s, f['w'] * 0.8, cap - rail_top), 'Graphite', bevel=0.006 * s)
    # A gusset each side of the post, down onto the rail.
    for dx in (-1, 1):
        p.convex([(x + dx * 0.05 * s, ry + sy * 0.006 * s, cap - 0.02 * s) for sy in (-1, 1)] +
                 [(x + dx * 0.05 * s, ry + sy * 0.006 * s, rail_top) for sy in (-1, 1)] +
                 [(x + dx * 0.19 * s, ry + sy * 0.006 * s, rail_top) for sy in (-1, 1)], 'Graphite')
    # The cap, and the two ears.
    y0, y1 = ry - side * f['w'] * 0.4, y + side * 1.5 * br
    p.box((x, (y0 + y1) / 2, cap + 0.006 * s), (0.11 * s, abs(y1 - y0), 0.012 * s), 'Graphite', bevel=0.003 * s)
    for sy in (-1, 1):
        p.convex([(x + dx * 0.045 * s, y + sy * 1.05 * br + th, cap) for dx in (-1, 1) for th in (-0.004 * s, 0.004 * s)] +
                 [(x + dx * 0.02 * s, y + sy * 1.05 * br + th, z - 0.9 * br) for dx in (-1, 1) for th in (-0.004 * s, 0.004 * s)],
                 'Graphite')
    if HD:
        p.tube((x, y - 1.25 * br, z), (x, y + 1.25 * br, z), 0.2 * br, 'Chrome', segments=6, smooth=False)


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
        # Stock beam axle: the shock from a bracket beside the axle tube, just
        # inboard of the wheel, up to a tower standing on the frame rail.
        fore = 1 if k.key == 'F' else -1
        low = k.hub_world + V((-fore * 0.085 * s, -side * inboard, 0.02 * s))
        top = k.at(fore * 0.02 * s, k.half - inboard, r + 0.58 * s)
        shock_tower(b.rig_part(k.key, kind), b.cls, t, top, side, s)
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
        diff_cover(p, k, (x, 0.08 * s, zc), s, face=1, axis='Y')
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


# --- Solid axles ---------------------------------------------------------------
# A beam axle: a tube each side of the diff's round centre section, the
# pinion's snout pointing at the transfer case, a knuckle ball at each end,
# and a bracket beside each end for the bottom of the shock. The front one
# carries the steering: a tie rod ahead of the beam and a small steering
# damper.
#
# The axle part bolts on the diff's back cover (and more: see AXLES), and
# the suspension part decides what holds the axle under the truck:
#
# - coil links: arms from brackets under the frame to the axle (a radius arm
#   a side at the front; two lower and two upper links at the back) and, at
#   the front, a track bar across the truck. Each is an `Arm_...` the game
#   swings, so they follow the axle up and down.
# - leaf springs: a pack of leaves a side, the top one magenta, each drawn
#   as two halves that hinge at the frame (a hanger at the front, a shackle
#   at the back) and meet on the axle under the U-bolts, so the pack flexes
#   as the axle moves.

def diff_cover(p, k, centre, s, face=1, axis='X'):
    """The cover on the back of a diff, facing `face` along `axis`: plain
    pressed steel, finned cast steel for heavy-duty, blue for chromoly."""
    n = seg(18, 10)
    cx, cy, cz = centre

    def at(h, y=0.0, z=0.0):
        if axis == 'X':
            return (cx + face * h, cy + y, cz + z)
        return (cx + y, cy + face * h, cz + z)

    side = 'right' if face > 0 else 'left'
    big = k == 'heavyDutyAxles'
    R = (0.135 if big else 0.125) * s
    mat = {'standardAxles': 'Graphite', 'heavyDutyAxles': 'Steel', 'chromolyAxles': 'Anodised'}[k]
    prof = [(R, 0.0), (R, 0.014 * s), (R * 0.9, 0.02 * s), (R * 0.78, 0.05 * s), (R * 0.4, 0.068 * s), (0.0, 0.07 * s)]
    p.lathe([(q, face * h) for q, h in prof], mat, segments=n, centre=centre, axis=axis, closed=False, side=side)
    p.bolts(seg(10, 6), R * 0.95, face * 0.012 * s, face * 0.024 * s, 0.011 * s, 'Chrome' if k == 'chromolyAxles' else 'Steel',
            centre=centre, axis=axis)
    if big:
        # Cooling fins across the cover.
        for fin in range(-2, 3):
            wide = 2 * R * 0.78 * math.cos(fin * 0.32)
            p.box(at(0.055 * s, 0.0, fin * 0.036 * s), (0.04 * s, wide, 0.01 * s) if axis == 'X' else (wide, 0.04 * s, 0.01 * s), 'Steel')
    if HD:
        p.tube(at(0.06 * s, 0, R * 0.45), at(0.078 * s, 0, R * 0.45), 0.014 * s, 'Steel', segments=6, smooth=False)


def solid_axle(b, key):
    cls, t, s, r, materials = b.cls, b.t, b.s, b.r, b.materials
    axle_parts = dict(b.layouts(key))['axle']
    slot = 'frontSusp' if key == 'F' else 'rearSusp'
    x = t['cg_front'] if key == 'F' else -t['cg_rear']
    half = t['track'] / 2 - t['tire'] * 0.55
    off = 0.12 * s  # the diff sits a little to the left
    towards = -1 if key == 'F' else 1  # the way to the transfer case
    frame = FRAME[cls]
    n = seg(16, 10)

    axle = Part('Axle_' + key)
    # The centre section, round the pinion's line: the bowl the gears sit in and the snout.
    prof = [(0.0, -0.07 * s), (0.125 * s, -0.07 * s), (0.15 * s, -0.035 * s), (0.155 * s, 0.02 * s), (0.125 * s, 0.085 * s),
            (0.085 * s, 0.125 * s), (0.07 * s, 0.25 * s), (0.0, 0.25 * s)]
    axle.lathe([(q, towards * h) for q, h in prof], 'Graphite', segments=seg(20, 12), centre=(0, off, 0), axis='X',
               closed=False, side='right' if towards > 0 else 'left')
    axle.tube((towards * 0.25 * s, off, 0), (towards * 0.275 * s, off, 0), 0.06 * s, 'Steel', segments=n)
    # The tubes out to the wheels, each swaged down from the centre section, with a welded ring at its end.
    for sd in (-1, 1):
        y0 = off + sd * 0.11 * s
        axle.tube((0, y0, 0), (0, y0 + sd * 0.14 * s, 0), 0.085 * s, 'Graphite', segments=n, r2=0.056 * s)
        axle.tube((0, y0 + sd * 0.14 * s, 0), (0, sd * half, 0), 0.056 * s, 'Graphite', segments=n, r2=0.05 * s)
        axle.tube((0, sd * (half - 0.06 * s), 0), (0, sd * (half - 0.035 * s), 0), 0.07 * s, 'Graphite', segments=n)
        # The knuckle's ball at the end.
        axle.lathe([(0.0, -0.075 * s), (0.045 * s, -0.06 * s), (0.075 * s, -0.025 * s), (0.075 * s, 0.025 * s), (0.045 * s, 0.06 * s),
                    (0.0, 0.075 * s)], 'Graphite', segments=n, centre=(0, sd * half, 0), closed=False)
        # The bracket for the bottom of the shock: two ears off the tube.
        fore = 1 if key == 'F' else -1
        ey = sd * (t['track'] / 2 - (t['tire'] * 0.75 + 0.05 * s))
        br = SHOCK_R * s
        for e in (-1, 1):
            axle.convex([(0.0, ey + e * 1.05 * br + th, z) for th in (-0.004 * s, 0.004 * s) for z in (0.05 * s, -0.045 * s)] +
                        [(-fore * 0.085 * s + dx, ey + e * 1.05 * br + th, 0.02 * s + z)
                         for th in (-0.004 * s, 0.004 * s) for dx, z in ((-fore * 0.03 * s, 0.02 * s), (-fore * 0.03 * s, -0.025 * s))],
                        'Graphite')
        if HD:
            axle.tube((-fore * 0.085 * s, ey - 1.25 * br, 0.02 * s), (-fore * 0.085 * s, ey + 1.25 * br, 0.02 * s), 0.2 * br, 'Chrome',
                      segments=6, smooth=False)
    if HD:
        # A breather on top of the tube and a drain plug under the bowl.
        axle.tube((0, off - 0.3 * s, 0.05 * s), (0, off - 0.3 * s, 0.085 * s), 0.008 * s, 'Steel', segments=6)
        axle.tube((0.02 * s * towards, off, -0.15 * s), (0.02 * s * towards, off, -0.165 * s), 0.016 * s, 'Steel', segments=6,
                  smooth=False)
    if key == 'F':
        # Steering: an arm forward off each knuckle, the tie rod between them, and a small damper.
        tx, tz = 0.17 * s, -0.03 * s
        for sd in (-1, 1):
            axle.beam((0.02 * s, sd * (half - 0.03 * s), -0.02 * s), (tx, sd * (half - 0.07 * s), tz), (0, 0, 1), 0.045 * s, 0.03 * s,
                      'Graphite', w1=0.035 * s, t1=0.022 * s)
            axle.tube((tx, sd * (half - 0.07 * s), tz - 0.03 * s), (tx, sd * (half - 0.07 * s), tz + 0.03 * s), 0.02 * s, 'Steel',
                      segments=seg(10, 6))
        axle.tube((tx, -half + 0.08 * s, tz), (tx, half - 0.08 * s, tz), 0.017 * s, 'Steel', segments=seg(10, 6))
        if HD:
            for sd in (-1, 1):
                axle.tube((tx, sd * (half - 0.16 * s), tz), (tx, sd * (half - 0.2 * s), tz), 0.024 * s, 'Steel', segments=6,
                          smooth=False)
        # The steering damper: body clamped to the tube, shaft out to the tie rod.
        axle.tube((0.09 * s, -0.42 * s, 0.03 * s), (0.11 * s, -0.12 * s, 0.01 * s), 0.024 * s, 'WheelPaint', segments=seg(12, 8))
        axle.tube((0.11 * s, -0.12 * s, 0.01 * s), (tx, 0.2 * s, tz), 0.009 * s, 'Chrome', segments=6)
        axle.box((0.05 * s, -0.42 * s, 0.03 * s), (0.09 * s, 0.03 * s, 0.03 * s), 'Graphite')
    # With independent arms to choose from, the axle sits in a group the game can hide.
    group = None
    if len(b.layouts(key)) > 1:
        group = empty(fit_name(slot, axle_parts, 'Axle' + key), None, (0, 0, 0))
    axle_obj = place(axle.finish(materials), group, (x, 0, r))
    b.axles[key] = (axle_obj, half)
    b.pinions[key] = (axle_obj, V((x, 0, r)), V((x + towards * 0.3 * s, off, r)))

    # The axle parts: housings and diff covers get beefier with the price.
    for k in AXLES:
        p = b.fit('axles', [k], key)
        diff_cover(p, k, (-towards * 0.07 * s, off, 0), s, face=-towards)
        if k == 'heavyDutyAxles':
            # Sleeves over the tubes and a truss along the top.
            for sd in (-1, 1):
                p.tube((0, off + sd * 0.26 * s, 0), (0, sd * (half - 0.08 * s), 0), 0.063 * s, 'Graphite', segments=n)
            p.box((0, 0, 0.1 * s), (0.04 * s, 2 * half - 0.3 * s, 0.03 * s), 'Steel', bevel=0.006 * s)
            for yy in (-0.75, -0.4, 0.4, 0.75):
                p.box((0, yy * half, 0.07 * s), (0.035 * s, 0.03 * s, 0.05 * s), 'Steel')
        elif k == 'chromolyAxles':
            for sd in (-1, 1):
                p.ring(0.05 * s, 0.085 * s, sd * (half - 0.1 * s) - 0.01 * s, sd * (half - 0.1 * s) + 0.01 * s, 'Chrome', segments=n)
            p.box((0, 0, 0.085 * s), (0.028 * s, 2 * half - 0.36 * s, 0.022 * s), 'Anodised', bevel=0.004 * s)
            for yy in (-0.7, 0.7):
                p.box((0, yy * half, 0.065 * s), (0.026 * s, 0.026 * s, 0.03 * s), 'Anodised')
        b.add(p, axle_obj)

    rig = b.rig(key, 'axle')
    rail_low = frame['z'] - frame['h'] / 2

    # --- Leaf springs ---
    leaf_parts = LEAF[cls][key]
    leaves = 4 if cls == 'light4x4' else 6
    pitch, thick, wide = 0.02 * s, 0.014 * s, 0.065 * s
    lead = (1.15 if cls == 'light4x4' else 1.0) * s  # eye to eye
    seat_z = 0.058 * s + pitch * (leaves - 0.5)  # the main leaf, above the axle's middle
    eye_z = min(rail_low - 0.03 * s, r + seat_z + 0.02 * s)
    arms = empty(fit_name(slot, leaf_parts, 'LeafArms' + key), rig, (0, 0, 0))
    hang = b.fit(slot, leaf_parts, 'Hangers' + key)
    for c in (key + 'L', key + 'R'):
        k = b.corner[c]
        y = k.side * frame['y']
        seat = V((x, y, r + seat_z))
        for what, ex in (('LeafFore', lead / 2), ('LeafAft', -lead / 2)):
            eye = V((x + ex, y, eye_z))

            def draw(p, rel):
                d = rel.normalized()
                for i in range(leaves):
                    a = rel * min(0.92, i * 0.17) if i else d * 0.012 * s
                    dz = V((0, 0, -i * pitch))
                    p.beam(a + dz, rel + d * 0.02 * s + dz, (0, 0, 1), wide, thick, 'Magenta' if i == 0 else 'Steel')
                # The eye rolled into the main leaf's end, and a clip round the pack.
                p.tube((0, -wide / 2, 0), (0, wide / 2, 0), 0.022 * s, 'Magenta', segments=seg(10, 6))
                if HD:
                    q = rel * 0.5
                    p.box(tuple(q + V((0, 0, -pitch * 0.8))), (0.03 * s, wide + 0.012 * s, pitch * 2.4), 'Graphite')

            k.arm(arms, what, eye, seat, draw)
            # On the frame: a hanger at the front eye, a shackle at the back one.
            top = rail_low + rail_rise(cls, t, eye.x)
            for e in (-1, 1):
                yy = y + e * (wide / 2 + 0.008 * s)
                if ex > 0:
                    hang.convex([(eye.x + dx, yy + th, z) for th in (-0.004 * s, 0.004 * s)
                                 for dx, z in ((-0.06 * s, top + 0.03 * s), (0.06 * s, top + 0.03 * s), (0.03 * s, eye_z - 0.03 * s), (-0.03 * s, eye_z - 0.03 * s))],
                                'Graphite')
                else:
                    hang.beam((eye.x - 0.05 * s, yy, top + 0.0 * s), (eye.x, yy, eye_z), (0, 1, 0), 0.04 * s, 0.008 * s, 'Graphite')
            if ex < 0:
                hang.tube((eye.x - 0.05 * s, y - wide * 0.7, top), (eye.x - 0.05 * s, y + wide * 0.7, top), 0.02 * s, 'Graphite',
                          segments=seg(10, 6))
            hang.tube((eye.x, y - wide * 0.75, eye_z), (eye.x, y + wide * 0.75, eye_z), 0.011 * s, 'Steel', segments=6, smooth=False)
    b.add(hang, rig)
    # On the axle: the seat, the plate on top, the U-bolts and their nuts.
    p = b.fit(slot, leaf_parts, 'Leaf' + key)
    for sd in (-1, 1):
        y = sd * frame['y']
        top = seat_z + thick / 2
        p.box((0, y, 0.054 * s), (0.16 * s, wide + 0.02 * s, 0.012 * s), 'Steel')
        p.box((0, y, top + 0.008 * s), (0.15 * s, wide + 0.03 * s, 0.016 * s), 'Steel', bevel=0.004 * s)
        p.box((0, y, (0.06 * s + top) / 2), (0.1 * s, wide + 0.004 * s, top - 0.06 * s), 'Steel')
        p.box((0, y, -0.06 * s), (0.17 * s, wide + 0.06 * s, 0.016 * s), 'Steel', bevel=0.004 * s)
        for dx in (-0.058 * s, 0.058 * s):
            for e in (-1, 1):
                yy = y + e * (wide / 2 + 0.018 * s)
                p.tube((dx, yy, -0.085 * s), (dx, yy, top + 0.015 * s), 0.008 * s, 'Steel', segments=6)
                p.tube((dx, yy, -0.068 * s), (dx, yy, -0.082 * s), 0.014 * s, 'Chrome', segments=6, smooth=False)
            p.tube((dx, y - wide / 2 - 0.018 * s, top + 0.015 * s), (dx, y + wide / 2 + 0.018 * s, top + 0.015 * s), 0.008 * s, 'Steel',
                   segments=6)
    b.add(p, axle_obj)

    # --- Coil links ---
    link_parts = LINKS[cls][key]
    arms = empty(fit_name(slot, link_parts, 'LinkArms' + key), rig, (0, 0, 0))
    hang = b.fit(slot, link_parts, 'LinkMounts' + key)
    onaxle = b.fit(slot, link_parts, 'Links' + key)
    back = -towards  # links run towards the middle of the truck
    ly = frame['y'] - 0.01 * s

    def link(p, rel, rad, deep=None):
        """A link with a bushed eye at each end; `deep` makes it a forged radius arm, deeper at the axle."""
        if deep:
            p.beam((0, 0, 0), tuple(rel), (0, 0, 1), 0.04 * s, 0.045 * s, 'Graphite', w1=0.045 * s, t1=deep)
        else:
            p.tube((0, 0, 0), tuple(rel), rad, 'Graphite', segments=seg(10, 6))
        for q in (V((0, 0, 0)), rel):
            p.tube(tuple(q - V((0, 0.03 * s, 0))), tuple(q + V((0, 0.03 * s, 0))), rad * 1.45, 'Graphite', segments=seg(10, 6))
            if HD:
                p.tube(tuple(q - V((0, 0.036 * s, 0))), tuple(q + V((0, 0.036 * s, 0))), rad * 0.55, 'Chrome', segments=6, smooth=False)

    for c in (key + 'L', key + 'R'):
        k = b.corner[c]
        y = k.side * ly
        pivot = V((x - back * 0.85 * s, y * 0.97, min(r + 0.12 * s, rail_low - 0.04 * s)))
        end = V((x - back * 0.03 * s, y, r - 0.06 * s))
        k.arm(arms, 'Link', pivot, end, lambda p, rel: link(p, rel, 0.024 * s, deep=0.075 * s if key == 'F' else None))
        # The bracket under the frame rail it swings from, and the one under the axle tube.
        for e in (-1, 1):
            yy = pivot.y + e * 0.036 * s
            hang.convex([(pivot.x + dx, yy + th, z) for th in (-0.004 * s, 0.004 * s)
                         for dx, z in ((-0.08 * s, rail_low + 0.02 * s), (0.08 * s, rail_low + 0.02 * s), (0.035 * s, pivot.z - 0.04 * s), (-0.035 * s, pivot.z - 0.04 * s))],
                        'Graphite')
            onaxle.box((-back * 0.03 * s, y + e * 0.036 * s, -0.05 * s), (0.08 * s, 0.008 * s, 0.09 * s), 'Graphite')
        if key == 'R':
            # Upper links, running in from the frame to a bracket over the diff.
            pivot = V((x + 0.62 * s, k.side * (frame['y'] - frame['w'] / 2 - 0.03 * s), r + 0.2 * s))
            end = V((x, k.side * 0.1 * s + off, r + 0.19 * s))
            k.arm(arms, 'UpperLink', pivot, end, lambda p, rel: link(p, rel, 0.02 * s))
            hang.box((pivot.x, pivot.y + k.side * 0.035 * s, (pivot.z + rail_low) / 2), (0.09 * s, 0.01 * s, rail_low - pivot.z + 0.1 * s),
                     'Graphite')
    if key == 'R':
        # The bracket on top of the diff the upper links bolt to.
        onaxle.box((0, off, 0.165 * s), (0.08 * s, 0.3 * s, 0.05 * s), 'Graphite', bevel=0.006 * s)
    else:
        # The track bar that stops the axle sliding sideways: from a drop
        # bracket on the right-hand rail down across to the axle's left end.
        pivot = V((x + 0.11 * s, -(frame['y'] - 0.02), r + 0.2 * s))
        end = V((x + 0.11 * s, half - 0.3 * s, r + 0.03 * s))
        part = Part(f'Arm_{key}_Track')
        rel = end - pivot
        part.tube((0, 0, 0), tuple(rel), 0.02 * s, 'Steel', segments=seg(10, 6))
        for q in (V((0, 0, 0)), rel):
            part.tube(tuple(q - V((0.03 * s, 0, 0))), tuple(q + V((0.03 * s, 0, 0))), 0.03 * s, 'Steel', segments=seg(10, 6))
        place(part.finish(materials), arms, tuple(pivot))
        empty(f'ArmEnd_{key}_Track', axle_obj, tuple(end - V((x, 0, r))))
        top = rail_low + rail_rise(cls, t, pivot.x)
        hang.convex([(pivot.x + dx, pivot.y + yy, z) for dx in (-0.045 * s, -0.035 * s)
                     for yy, z in ((-0.05 * s, top + 0.02 * s), (0.05 * s, top + 0.02 * s), (0.03 * s, pivot.z - 0.04 * s), (-0.03 * s, pivot.z - 0.04 * s))],
                    'Graphite')
        onaxle.box((0.07 * s, half - 0.3 * s, 0.03 * s), (0.02 * s, 0.07 * s, 0.1 * s), 'Graphite')
    b.add(hang, rig)
    b.add(onaxle, axle_obj)


def build_truck(cls, t, materials, lite=False):
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    for mesh in list(bpy.data.meshes):
        bpy.data.meshes.remove(mesh)

    b = Build(cls, t, materials)
    r, s = b.r, b.s

    # Wheels and tires: one mesh each, shared by all four corners.
    tires = {k: kit_tire('Tire_' + k, t, k).to_mesh(materials) for k in TIRES}
    meshes = {}
    rims = {k: kit_rim('Rim_' + k, t, k, cls).to_mesh(materials) for k in WHEELS}

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

        # The upright behind the wheel: the hub's bearing carrier, and the
        # brake caliper gripping the disc (the disc itself turns with the wheel).
        up = Part('Upright_' + c)
        inner = -side * t['tire'] * 0.55
        # Taller on the side-by-side, whose wishbones' ball joints sit further apart.
        tall = 0.42 * s if cls == 'sxs' else r * 0.75
        up.convex([(sx * 0.045 * s, inner + sy * 0.03 * s, sz * tall * 0.5) for sx in (-1, 1) for sy in (-1, 1) for sz in (-1, 1)] +
                  [(sx * 0.075 * s, inner + sy * 0.03 * s, sz * tall * 0.16) for sx in (-1, 1) for sy in (-1, 1) for sz in (-1, 1)],
                  'Graphite', bevel=0.008 * s)
        up.tube((0, inner, 0), (0, side * (DISC_AT * t['tire'] - 0.02 * t['tire']), 0), r * 0.58 * 0.3, 'Cast', segments=seg(14, 8))
        brake_caliper(up, t, side, s)
        place(up.finish(materials), hub, (0, 0, 0))

        # What the wheel hangs on, in each layout at this end. The stock
        # layout's shock length is every layout's, so one set of shocks fits all.
        k = Corner(b, c, hub)
        b.corner[c] = k
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

        # The eyes' bolts run across the truck, except on the side-by-side, whose shocks lean in.
        eye_axis = 'X' if cls == 'sxs' else 'Y'
        sb = empty('ShockBody_' + c, None, tuple(top_world))
        for kd in DAMPERS:
            mesh = shared('damper-' + kd, lambda: kit_shock_body('Damper_' + kd, length, s, kd, eye_axis))
            place(link(fit_name('dampers', [kd], c), mesh), sb, (0, 0, 0))
        place(link('ShockShaft_' + c, shared('shaft', lambda: kit_shaft('Shaft', length, s, eye_axis))), None, tuple(low_world))
        spring = empty('Spring_' + c, None, tuple(top_world))
        coil = COIL.get(cls, {}).get(c[0])
        name = fit_name('frontSusp' if c[0] == 'F' else 'rearSusp', coil, 'Spring' + c) if coil else 'Coil_' + c
        place(link(name, shared('spring', lambda: kit_spring('Spring', length, s, 0.6 if cls == 'sxs' else 0.8))), spring, (0, 0, 0))

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

    # Solid axles: a beam between the two hubs with the diff in the middle,
    # and the links or leaf springs that hold it under the frame.
    for key in ('F', 'R'):
        if dict(b.layouts(key)).get('axle') is not None:
            solid_axle(b, key)

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

    bake_shade(cls, s)

    path = os.path.join(OUT_DIR, f'truck-{cls}{"-lite" if lite else ""}.glb')
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
        export_texcoords=True,
        export_vertex_color='NAME',
        export_vertex_color_name='Col',
        export_all_vertex_colors=False,
    )
    # Zip it: the game unzips it in the browser (src/render/truckModel.ts). The
    # mesh numbers repeat a lot, so this makes the download about a fifth the
    # size. A fixed timestamp keeps the file the same when nothing changed.
    with open(path, 'rb') as f:
        raw = pack_model(f.read())
    with open(path + '.gz', 'wb') as f:
        f.write(gzip.compress(raw, compresslevel=9, mtime=0))
    os.remove(path)
    print(f'wrote {path}.gz ({os.path.getsize(path + ".gz") // 1024} KB, {len(raw) // 1024} KB unzipped)')


# --- Soft shadows ----------------------------------------------------------------
# Real parts are darker where they crowd together: inside a wheel, between
# tread blocks, where a bracket meets the frame. The game has no way to work
# that out live on a phone, so it's worked out here, once, and painted into
# each mesh's colours ("baked ambient occlusion"). Blender's Cycles renderer
# does the sum: from every corner of every mesh it looks out in all
# directions and measures how much of the view is blocked by nearby parts.

# What each truck wears from the factory (keep in step with STOCK in
# src/data/kit.ts). A part is shaded as it sits among these, so a stock
# frame darkens the engine tucked inside it, say.
STOCK = {
    'light4x4': ('ladder', 'solidAxleCoil', 'coilLink', 'monotube', 'rubber', 'fixedBars', 'standardAxles',
                 'steelWheels', 'rallyTires', 'skidPlates', 'petrolSix', 'noSpares', 'shovelOnly'),
    'heavy': ('ladder', 'beamLeaf', 'rearBeamLeaf', 'monotube', 'rubber', 'fixedBars', 'standardAxles',
              'steelWheels', 'rallyTires', 'skidPlates', 'dieselSix', 'noSpares', 'shovelOnly'),
    'sxs': ('tubeFrame', 'sxsWishbone', 'sxsTrailing', 'monotube', 'rubber', 'fixedBars', 'standardAxles',
            'steelWheels', 'rallyTires', 'skidPlates', 'twin', 'noSpares', 'shovelOnly'),
}
SHADE = {
    'samples': 192,    # looks per corner: more is smoother and slower
    'reach': 0.45,     # how far away (m, times the truck's scale) a part can still shade another
    'floor': 0.36,     # the darkest a fully crowded corner gets (1 = no shading at all)
    'buried': 0.55,    # corners that are inside another part see nothing: give them this instead
}
# Nodes the game turns, stretches or aims itself. They're shaded on their
# own, because here in Blender they aren't posed the way the game poses them.
SHADED_ALONE = ('Wheel_', 'ShockBody_', 'ShockShaft_', 'Spring_')
# ...and these are never counted as neighbours of anything else. (Wheels are
# left in: they're round, so they shade the arches the same however they turn.)
UNPOSED = ('ShockBody_', 'ShockShaft_', 'Spring_')


def bake_shade(cls, s):
    """Paint soft shadows into every mesh's colours (see the note above)."""
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'CPU'
    scene.cycles.samples = SHADE['samples']
    if scene.world is None:
        scene.world = bpy.data.worlds.new('World')
    scene.world.light_settings.distance = SHADE['reach'] * s
    scene.render.bake.target = 'VERTEX_COLORS'
    objects = [o for o in bpy.data.objects if o.type == 'MESH']

    def chain(o):
        while o is not None:
            yield o
            o = o.parent

    def worn(o):
        """The part choices this node only shows for: {slot: set of part ids}."""
        out = {}
        for n in chain(o):
            if n.name.startswith('Fit_'):
                bits = n.name.split('_')
                out.setdefault(bits[1], set(bits[2].split('.')[0].split('-')))
        return out

    def group(o, prefixes):
        return next((n for n in chain(o) if n.name.startswith(prefixes)), None)

    facts = {o: (worn(o), group(o, SHADED_ALONE), group(o, UNPOSED)) for o in objects}

    def neighbours(o):
        mine, alone, _ = facts[o]
        out = []
        for other in objects:
            theirs, their_alone, unposed = facts[other]
            if alone is not None and their_alone != alone:
                continue
            if alone is None and unposed is not None:
                continue
            if all((mine[slot] & parts) if slot in mine else any(p in STOCK[cls] for p in parts)
                   for slot, parts in theirs.items()):
                out.append(other)
        return out

    done = set()
    for o in objects:
        mesh = o.data
        if mesh.name in done or len(mesh.loops) == 0:
            continue
        done.add(mesh.name)
        seen = neighbours(o) + [o]
        for other in objects:
            other.hide_render = other not in seen
            other.select_set(False)
        o.select_set(True)
        bpy.context.view_layer.objects.active = o
        attr = mesh.color_attributes.new('AO', 'FLOAT_COLOR', 'CORNER')
        mesh.attributes.active_color = attr
        bpy.ops.object.bake(type='AO')

        n = len(mesh.loops)
        ao = np.empty(n * 4, dtype=np.float32)
        mesh.color_attributes['AO'].data.foreach_get('color', ao)
        ao = ao.reshape(n, 4)[:, 0].astype(np.float64)
        ao = np.where(ao < 0.03, SHADE['buried'], ao)
        col = np.empty(n * 4, dtype=np.float32)
        mesh.color_attributes['Col'].data.foreach_get('color', col)
        col = col.reshape(n, 4)
        # Corners that meet at one point of a smooth, one-colour surface must
        # stay equal (or the file would store that point once per corner), so
        # they share the average of what they saw.
        vert = np.empty(n, dtype=np.int32)
        mesh.loops.foreach_get('vertex_index', vert)
        normal = np.empty(n * 3, dtype=np.float32)
        mesh.corner_normals.foreach_get('vector', normal)
        uv = np.empty(n * 2, dtype=np.float32)
        mesh.uv_layers['Fin'].data.foreach_get('uv', uv)
        key = np.concatenate([vert.reshape(n, 1), np.round(normal.reshape(n, 3) * 100),
                              np.round(col[:, :3] * 1000), np.round(uv.reshape(n, 2) * 100)], axis=1)
        _, which = np.unique(key, axis=0, return_inverse=True)
        which = which.reshape(-1)
        ao = (np.bincount(which, weights=ao) / np.bincount(which))[which]
        shade = SHADE['floor'] + (1 - SHADE['floor']) * ao
        col[:, :3] *= shade.reshape(n, 1)
        mesh.color_attributes['Col'].data.foreach_set('color', col.reshape(-1))
        mesh.color_attributes.remove(mesh.color_attributes['AO'])
    for other in objects:
        other.hide_render = False


# --- Smaller files -------------------------------------------------------------

def finish_png():
    """The finish picture: four dots, two by two. Across it roughness goes
    from 0 to 1 (kept in green) and down it metallic goes from 0 to 1 (kept
    in blue), which is where the glTF format looks for them. A corner's pair
    of finish numbers picks a spot in it, and the blend between the dots
    gives exactly that roughness and metallic."""
    rows = b''
    for metallic in (0, 255):
        rows += b'\x00' + bytes((0, 0, metallic)) + bytes((0, 255, metallic))

    def chunk(kind, data):
        body = kind + data
        return struct.pack('>I', len(data)) + body + struct.pack('>I', zlib.crc32(body))

    return (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', 2, 2, 8, 2, 0, 0, 0)) +
            chunk(b'IDAT', zlib.compress(rows, 9)) + chunk(b'IEND', b''))


def pack_model(glb):
    """Tidy what Blender wrote. It stores each corner's colour and finish as
    big decimal numbers; whole numbers from 0 to 65535 are plenty and half
    the size. The shared material also gets its finish picture here."""
    magic, version, _ = struct.unpack_from('<III', glb, 0)
    assert magic == 0x46546C67 and version == 2
    jlen, jtype = struct.unpack_from('<II', glb, 12)
    assert jtype == 0x4E4F534A
    doc = json.loads(glb[20:20 + jlen])
    blen, btype = struct.unpack_from('<II', glb, 20 + jlen)
    assert btype == 0x004E4942
    data = glb[28 + jlen:28 + jlen + blen]
    views = doc['bufferViews']
    accessors = doc['accessors']
    shared = [i for i, m in enumerate(doc['materials']) if m['name'] == SHARED][0]

    def numbers(acc):
        view = views[acc['bufferView']]
        at = view.get('byteOffset', 0) + acc.get('byteOffset', 0)
        width = {'VEC2': 2, 'VEC3': 3, 'VEC4': 4}[acc['type']]
        fmt, scale = {5126: ('f', 1.0), 5123: ('H', 1 / 65535), 5121: ('B', 1 / 255)}[acc['componentType']]
        stride = view.get('byteStride') or struct.calcsize(fmt) * width
        return [[c * scale for c in struct.unpack_from('<' + fmt * width, data, at + k * stride)]
                for k in range(acc['count'])]

    def whole(x):
        return min(65535, max(0, round(x * 65535)))

    new_view = {}
    done = set()
    for mesh in doc['meshes']:
        for prim in mesh['primitives']:
            attrs = prim['attributes']
            if prim.get('material') != shared:
                # Glass and lamps have one finish each: no need for the pair.
                attrs.pop('TEXCOORD_0', None)
            for key in ('COLOR_0', 'TEXCOORD_0'):
                i = attrs.get(key)
                if i is None or i in done:
                    continue
                done.add(i)
                acc = accessors[i]
                out = bytearray()
                for px in numbers(acc):
                    if key == 'COLOR_0':
                        out += struct.pack('<4H', whole(px[0]), whole(px[1]), whole(px[2]), 65535)
                    else:
                        # The picture's dots sit a quarter of the way in from its edges.
                        out += struct.pack('<2H', whole(0.25 + 0.5 * px[0]), whole(0.25 + 0.5 * px[1]))
                assert acc['bufferView'] not in new_view
                new_view[acc['bufferView']] = bytes(out)
                acc.update(componentType=5123, normalized=True, byteOffset=0,
                           type='VEC4' if key == 'COLOR_0' else 'VEC2')
                acc.pop('min', None)
                acc.pop('max', None)

    # The finish picture rides along inside the file.
    png = finish_png()
    views.append({'buffer': 0, 'byteLength': len(png)})
    new_view[len(views) - 1] = png
    doc['images'] = [{'bufferView': len(views) - 1, 'mimeType': 'image/png', 'name': 'Finish'}]
    # Blend between the dots (9729), and never wrap round the edges (33071).
    doc['samplers'] = [{'magFilter': 9729, 'minFilter': 9729, 'wrapS': 33071, 'wrapT': 33071}]
    doc['textures'] = [{'sampler': 0, 'source': 0}]
    pbr = doc['materials'][shared].setdefault('pbrMetallicRoughness', {})
    pbr.update(metallicFactor=1.0, roughnessFactor=1.0, metallicRoughnessTexture={'index': 0})

    # Lay everything out again, one list after another, dropping lists nothing uses now.
    in_use = {a['bufferView'] for a in accessors} | {len(views) - 1}
    for mesh in doc['meshes']:
        for prim in mesh['primitives']:
            in_use |= {accessors[i]['bufferView'] for i in list(prim['attributes'].values()) + [prim['indices']]}
    packed = bytearray()
    for i, view in enumerate(views):
        chunk = new_view.get(i)
        if chunk is None:
            start = view.get('byteOffset', 0)
            chunk = data[start:start + view['byteLength']]
        else:
            view.pop('byteStride', None)
        while len(packed) % 4:
            packed.append(0)
        view['byteOffset'] = len(packed)
        view['byteLength'] = len(chunk)
        packed += chunk
    while len(packed) % 4:
        packed.append(0)
    doc['buffers'][0]['byteLength'] = len(packed)
    text = json.dumps(doc, separators=(',', ':')).encode('utf8')
    text += b' ' * (-len(text) % 4)
    total = 12 + 8 + len(text) + 8 + len(packed)
    return (struct.pack('<III', 0x46546C67, 2, total) + struct.pack('<II', len(text), 0x4E4F534A) + text +
            struct.pack('<II', len(packed), 0x004E4942) + bytes(packed))


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


def arch_cut(skin, x, r, radius, half, mat='Graphite'):
    """Cut a wheel arch up into a body shell: a round bite of `radius`
    centred on the wheel at (x, r), right across the body."""
    cutter = Part('ArchCut')
    cutter.tube((x, -half - 0.3, r), (x, half + 0.3, r), radius, mat, segments=seg(40, 22))
    skin.cut(cutter)


def arch_flare(p, x, r, radius, y0, y1, z_low, depth, mat):
    """A flare round a cut wheel arch, on both sides: a band `depth` thick
    from y0 out to y1, running down to `z_low` at each end."""
    a = math.degrees(math.asin(max(-1.0, min(1.0, (z_low - r) / (radius + depth)))))
    for sd in (-1, 1):
        ya, yb = sorted((sd * y0, sd * y1))
        p.arch(x, r, radius - 0.004, radius + depth, ya, yb, a, 180 - a, mat, segs=seg(20, 10))
    return a


def headlamp(p, x, y, z, rad, face=1, mat='Lamp'):
    """A round lamp in a chrome ring, with a domed lens."""
    p.lathe([(rad * 1.22, -face * 0.03), (rad * 1.22, face * 0.012), (rad * 1.02, face * 0.02), (rad * 1.0, face * 0.008)],
            'Chrome', segments=seg(18, 10), centre=(x, y, z), axis='X', closed=False, side='right' if face > 0 else 'left')
    p.lathe([(rad, face * 0.008), (rad * 0.8, face * 0.024), (rad * 0.4, face * 0.034), (0, face * 0.037)],
            mat, segments=seg(18, 10), centre=(x, y, z), axis='X', closed=False, side='right' if face > 0 else 'left')
    p.tube((x - face * 0.03, y, z), (x - face * 0.06, y, z), rad * 1.15, 'Graphite', segments=seg(14, 8))


def mix_section(a, c, u):
    """A slice part-way (u from 0 to 1) between two slices of a body."""
    return [(ya + (yc - ya) * u, za + (zc - za) * u) for (ya, za), (yc, zc) in zip(a, c)]


def pickup(b):
    """The light 4x4: a lifted single-cab pickup with a roof lamp bar, a bull
    bar and a sport bar over the bed."""
    t, s, body = b.t, b.s, b.shell
    w = 1.84
    half = w / 2
    sill = 1.02    # the floor: above the wheels at full bump
    skirt = 0.87   # the sills and the fenders' lower edges hang down to here
    belt = 1.48
    xb, xf, top = -0.55, 1.15, 2.02
    xr = -2.4
    nose = 2.24
    centre = (0.3, 0, 1.4)
    r = b.r
    arch_r = sill - r - 0.006  # the arches stop just under the floor
    stripe = (sill + 0.165, sill + 0.235)

    # --- The shell, as slices from the nose to the back of the cab ---------
    # Every slice has the same 14 points. 0 to 8 are the floor, the sill
    # hanging below it, and the side up to the crease at the belt line; 9 to
    # 13 go over the top (the bonnet on the nose, the windows and roof on the cab).
    def lower(edge):
        """Points 0 to 8; `edge` is how high the side's top crease is here."""
        bulge = 0.012
        return [(0, sill), (half - 0.15, sill), (half - 0.13, skirt), (half - 0.03, skirt), (half, skirt + 0.035),
                (half + bulge, stripe[0]), (half + bulge, stripe[1]), (half + 0.004, edge - 0.06), (half - 0.03, edge)]

    def bonnet(x):
        """A slice of the nose: the bonnet slopes down to the grille, with a raised centre."""
        u = (x - xf) / (nose - xf)
        edge = belt + 0.02 - 0.17 * u ** 1.6
        squeeze = 1 - 0.035 * u  # the nose narrows a touch towards the grille
        pts = lower(edge) + [(half - 0.1, edge + 0.014), (half * 0.6, edge + 0.03), (half * 0.5, edge + 0.052),
                             (0.24, edge + 0.06), (0, edge + 0.062)]
        return [(y * squeeze, z) for y, z in pts]

    cowl = lower(belt) + [(half - 0.06, belt + 0.03), (half - 0.06, belt + 0.03), (half - 0.17, belt + 0.04),
                          (0.4, belt + 0.05), (0, belt + 0.052)]
    cab = lower(belt) + [(half - 0.06, belt + 0.03), (half - 0.17, top - 0.075), (half - 0.26, top),
                         (0.4, top + 0.022), (0, top + 0.028)]
    roof_front = xf - 0.58

    def slice_at(x):
        if x > xf + 1e-6:
            return bonnet(x)
        if x > roof_front:
            return mix_section(cowl, cab, (xf - x) / (xf - roof_front))
        return cab

    seam = 0.012  # door shut lines are thin dark strips of the shell itself
    door_front, door_back = xf - 0.07, -0.015
    xs = [nose, 2.14, 2.0, 1.8, 1.6, 1.4, xf + 0.04, xf, door_front, door_front - seam, roof_front, 0.04, door_back,
          door_back - seam, -0.075, xb]
    skin = Part('Skin')
    faces = skin.loft([(x, slice_at(x)) for x in xs], 'Paint')

    def paint(x0, x1, rows, mat):
        """Repaint the faces between two slices (by their x), in rows of points."""
        for i in range(len(xs) - 1):
            if xs[i] <= x0 + 1e-6 and xs[i + 1] >= x1 - 1e-6:
                for j in rows:
                    for sd in (-1, 1):
                        f = faces.get((i, j, sd))
                        if f is not None:
                            skin._paint([f], mat)

    def patch(x0, x1, rows, sides=(-1, 1)):
        return [faces.get((i, j, sd)) for i in range(len(xs) - 1) if xs[i] <= x0 + 1e-6 and xs[i + 1] >= x1 - 1e-6
                for j in rows for sd in sides]

    paint(nose - 0.3, xb, [5], 'Magenta')                     # the stripe (it starts behind the headlamps)
    paint(door_front, door_front - seam, range(3, 8), 'Shadow')
    paint(door_back, door_back - seam, range(3, 8), 'Shadow')
    paint(xf + 0.04, xf, range(9, 13), 'Graphite')             # the vent panel under the wipers
    paint(nose, xb, [1, 2], 'Graphite')                        # inside the sills
    paint(nose, xb, [0], 'Graphite')                           # the floor, from underneath
    # Windows: the windscreen (both halves at once), then a door window and
    # a quarter window on each side, split by the pillar behind the door.
    skin.window(patch(xf, roof_front, [11, 12]), 0.04)
    for sd in (-1, 1):
        skin.window(patch(xf, 0.04, [9], (sd,)), 0.04)
        skin.window(patch(-0.075, xb, [9], (sd,)), 0.04)
    skin.round_edges(0.024)
    arch_cut(skin, t['cg_front'], r, arch_r, half)
    body.join(skin)
    # The back window, on the cab's back wall.
    body.panel([(xb, 0.6, belt + 0.12), (xb, -0.6, belt + 0.12), (xb, -0.56, top - 0.1), (xb, 0.56, top - 0.1)], 'Rubber',
               centre, lift=0.0, thick=0.006)
    body.panel([(xb, 0.57, belt + 0.15), (xb, -0.57, belt + 0.15), (xb, -0.53, top - 0.13), (xb, 0.53, top - 0.13)],
               'Glass', centre, lift=0.004, thick=0.006)

    # Wipers, parked on the glass.
    def screen(u, y):
        """A point on the windscreen: u from the bonnet (0) to the roof (1)."""
        return V((xf - 0.58 * u, y, belt + 0.05 + (top - belt - 0.03) * u)) + V((0.5, 0, 0.58)).normalized() * 0.012

    for y0, y1 in ((0.5, 0.05), (-0.12, -0.57)):
        body.tube(screen(0.02, y0), screen(0.1, y1), 0.007, 'Shadow', segments=5)
        body.tube(V((xf + 0.02, y0, belt + 0.045)), screen(0.02, y0), 0.011, 'Shadow', segments=5)

    # --- The front: grille, lamps, bumper and bull bar ---------------------
    gz = 1.2
    body.box((nose + 0.004, 0, gz), (0.03, 1.06, 0.2), 'Shadow', bevel=0.008)
    for k in range(seg(5, 3)):
        body.box((nose + 0.02, 0, gz - 0.07 + k * 0.14 / (seg(5, 3) - 1)), (0.02, 1.0, 0.014), 'Chrome')
    body.box((nose + 0.02, 0, gz), (0.022, 0.03, 0.19), 'Chrome')
    for sd in (-1, 1):
        # Each headlamp sits in a dark bucket, with an indicator outboard of it.
        body.box((nose + 0.004, sd * 0.7, gz), (0.03, 0.3, 0.2), 'Shadow', bevel=0.008)
        headlamp(body, nose + 0.02, sd * 0.69, gz, 0.078)
        body.box((nose + 0.012, sd * 0.84, gz - 0.02), (0.03, 0.06, 0.13), 'Amber', bevel=0.008)
    # The bumper: a pressed-steel beam with swept-back ends, and tow hooks.
    bz = 0.97
    body.convex([(nose + x, sd * y, bz + sz * hz) for x, y, hz in ((0.16, 0.6, 0.085), (0.02, 0.6, 0.1))
                 for sd in (-1, 1) for sz in (-1, 1)], 'Trim', bevel=0.022)
    for sd in (-1, 1):
        body.convex([(nose + x, sd * y, bz + sz * hz) for x, y, hz in ((0.16, 0.58, 0.085), (0.02, 0.58, 0.1), (0.03, half + 0.03, 0.07), (-0.12, half + 0.03, 0.08))
                     for sz in (-1, 1)], 'Trim', bevel=0.022)
        hook = [(nose + 0.14, sd * 0.4, bz - 0.03), (nose + 0.24, sd * 0.4, bz - 0.03), (nose + 0.27, sd * 0.4, bz),
                (nose + 0.24, sd * 0.4, bz + 0.03), (nose + 0.14, sd * 0.4, bz + 0.03)]
        body.sweep(hook, 0.013, 'Magenta', sides=seg(8, 5), curve=2 if HD else 0)
        body.box((nose + 0.165, sd * 0.25, bz), (0.012, 0.11, 0.07), 'Lamp', bevel=0.006) if sd > 0 else None
    # The bull bar: one bent hoop bolted through to the frame, with two more lamps.
    bar = [(2.18, -0.5, 0.7), (nose + 0.2, -0.55, 1.03), (nose + 0.2, -0.55, 1.4), (nose + 0.15, -0.4, 1.5),
           (nose + 0.15, 0.4, 1.5), (nose + 0.2, 0.55, 1.4), (nose + 0.2, 0.55, 1.03), (2.18, 0.5, 0.7)]
    body.sweep(bar, 0.033, 'Graphite', sides=seg(12, 6), bend=0.1)
    body.tube((nose + 0.2, -0.55, 1.27), (nose + 0.2, 0.55, 1.27), 0.024, 'Graphite', segments=seg(10, 6))
    for sd in (-1, 1):
        headlamp(body, nose + 0.24, sd * 0.3, 1.36, 0.068)
        body.box((nose + 0.2, sd * 0.3, 1.3), (0.03, 0.04, 0.06), 'Graphite')

    # --- Handles, mirrors, number boards, aerial ---------------------------
    for sd in (-1, 1):
        body.box((0.1, sd * (half + 0.012), belt - 0.11), (0.13, 0.022, 0.034), 'Chrome', bevel=0.01)
        body.box((0.1, sd * (half + 0.004), belt - 0.11), (0.17, 0.012, 0.06), 'Shadow', bevel=0.004)
        arm = [(xf - 0.2, sd * (half - 0.05), belt + 0.02), (xf - 0.16, sd * (half + 0.1), belt + 0.06),
               (xf - 0.14, sd * (half + 0.17), belt + 0.1)]
        body.sweep(arm, 0.012, 'Graphite', sides=6, bend=0.04)
        body.convex([(xf - 0.14 + dx, sd * (half + 0.17 + dy), belt + 0.13 + dz * 0.085) for dx, dy in
                     ((0.0, -0.06), (0.0, 0.07), (0.05, -0.045), (0.05, 0.055)) for dz in (-1, 1)], 'Trim', bevel=0.014)
        body.panel([(xf - 0.142, sd * (half + 0.12), belt + 0.065), (xf - 0.142, sd * (half + 0.23), belt + 0.065),
                    (xf - 0.142, sd * (half + 0.23), belt + 0.195), (xf - 0.142, sd * (half + 0.12), belt + 0.195)],
                   'Chrome', (xf, sd * (half + 0.17), belt + 0.13), lift=0.0, thick=0.003)
        body.box((0.58, sd * (half + 0.012), sill + 0.335), (0.46, 0.012, 0.17), 'Board', bevel=0.004)
        # The fuel filler, on the left only.
    body.tube((-0.36, half + 0.002, sill + 0.34), (-0.36, half + 0.014, sill + 0.34), 0.05, 'Shadow', segments=seg(14, 8))
    body.sweep([(xf - 0.1, half - 0.07, belt + 0.03), (xf - 0.2, half - 0.07, belt + 0.5), (xf - 0.42, half - 0.07, top + 0.62)],
               0.005, 'Shadow', sides=4, curve=2 if HD else 0)

    # --- The bed -----------------------------------------------------------
    rail = belt + 0.03
    bf = xb - 0.035

    def bed_slice():
        return lower(rail) + [(half - 0.05, rail + 0.01), (half - 0.11, rail + 0.012), (0.5, rail + 0.012),
                              (0.25, rail + 0.012), (0, rail + 0.012)]

    bxs = [bf, xr + 0.5, xr]
    bed = Part('Bed')
    bfaces = bed.loft([(x, bed_slice()) for x in bxs], 'Paint')
    for (i, j, sd), f in bfaces.items():
        if j == 5:
            bed._paint([f], 'Magenta')
        elif j in (0, 1, 2):
            bed._paint([f], 'Graphite')
    bed.round_edges(0.022)
    hollow = Part('BedCut')
    hollow.box(((bf + xr) / 2, 0, sill + 0.06 + 0.5), (bf - xr - 0.13, w - 0.19, 1.0), 'Paint')
    bed.cut(hollow)
    arch_cut(bed, -t['cg_rear'], r, arch_r, half)
    body.join(bed)
    # Ribs pressed into the bed floor, rail caps with stake pockets, tie-down hooks.
    for k in range(seg(7, 0)):
        y = -0.6 + 1.2 * k / 6
        body.box(((bf + xr) / 2, y, sill + 0.066), (bf - xr - 0.2, 0.07, 0.014), 'Paint', bevel=0.006)
    for sd in (-1, 1):
        body.box(((bf + xr) / 2, sd * (half - 0.05), rail + 0.018), (bf - xr - 0.02, 0.11, 0.022), 'Trim', bevel=0.008)
        for k in range(3):
            body.box((bf - 0.25 - k * 0.62, sd * (half - 0.05), rail + 0.03), (0.07, 0.045, 0.008), 'Shadow')
    body.box((bf - 0.045, 0, rail + 0.018), (0.1, w - 0.2, 0.022), 'Trim', bevel=0.008)
    # The tailgate: a pressed panel, its handle, hinges, and the tail lamps beside it.
    gate_z = (sill + 0.06 + rail) / 2
    body.box((xr - 0.004, 0, gate_z), (0.02, w - 0.36, rail - sill - 0.12), 'Paint', bevel=0.008)
    body.box((xr - 0.012, 0, gate_z - 0.02), (0.014, w - 0.6, rail - sill - 0.3), 'Paint', bevel=0.006)
    body.box((xr - 0.02, 0, rail - 0.1), (0.02, 0.2, 0.045), 'Shadow', bevel=0.006)
    for sd in (-1, 1):
        body.box((xr - 0.008, sd * (half - 0.085), gate_z + 0.02), (0.03, 0.1, 0.3), 'TailLamp', bevel=0.012)
        body.box((xr - 0.008, sd * (half - 0.085), gate_z - 0.17), (0.03, 0.1, 0.06), 'Amber', bevel=0.012)
        body.box((xr - 0.004, sd * (half - 0.085), gate_z - 0.03), (0.02, 0.13, 0.44), 'Shadow', bevel=0.008)
    # The rear bumper, with a step pad.
    body.box((xr - 0.09, 0, bz - 0.02), (0.16, w - 0.06, 0.13), 'Trim', bevel=0.025)
    body.box((xr - 0.09, 0, bz + 0.048), (0.12, 0.7, 0.008), 'Shadow')

    # The sport bar over the bed: one bent hoop and its stays, with two lamps facing back.
    bx = bf - 0.22
    feet = rail + 0.03
    hoop = [(bx, -half + 0.06, feet), (bx, -0.74, top - 0.02), (bx, -0.62, top + 0.07), (bx, 0.62, top + 0.07),
            (bx, 0.74, top - 0.02), (bx, half - 0.06, feet)]
    body.sweep(hoop, 0.034, 'Trim', sides=seg(12, 6), bend=0.1)
    for sd in (-1, 1):
        body.sweep([(bx, sd * 0.76, top - 0.12), (bx - 0.4, sd * 0.8, feet + 0.3), (bx - 0.72, sd * (half - 0.06), feet)],
                   0.028, 'Trim', sides=seg(10, 6), bend=0.1)
        body.tube((bx, sd * (half - 0.06), feet - 0.012), (bx, sd * (half - 0.06), feet + 0.012), 0.055, 'Trim', segments=seg(10, 6))
        headlamp(body, bx - 0.05, sd * 0.4, top + 0.14, 0.058, face=-1)
        body.box((bx - 0.01, sd * 0.4, top + 0.09), (0.03, 0.03, 0.05), 'Trim')

    # Flares round the arches, and mud flaps behind the rear wheels.
    for x in (t['cg_front'], -t['cg_rear']):
        arch_flare(body, x, r, arch_r, half - 0.1, half + 0.065, skirt + 0.01, 0.055, 'Trim')
    for sd in (-1, 1):
        body.box((-t['cg_rear'] - 0.6, sd * (t['track'] / 2), 0.66), (0.018, 0.34, 0.44), 'Rubber', bevel=0.004)
    # Roof lamp bar and its brackets.
    lamp_bar(body, xf - 0.66, top + 0.11, 1.4, 5)
    for sd in (-1, 1):
        body.tube((xf - 0.66, sd * 0.6, top + 0.06), (xf - 0.66, sd * 0.6, top), 0.012, 'Graphite', segments=6)

    pickup_driveline(b)
    pickup_frames(b, sill)
    pickup_bolt_ons(b, sill, w, xb, xf, top, xr, skirt, nose)


def ladder_rails(p, cls, t, kind, path, holes=()):
    """Both rails of a ladder frame along `path` (see rail_path): plain, or
    boxed (deeper, with a steel plate down the outside). `holes` are places
    along the truck to punch a lightening hole through both rails."""
    f = FRAME[cls]
    boxed = kind == 'boxedLadder'
    deep = f['h'] * (1.25 if boxed else 1.0)
    rails = Part('Rails')
    for sd in (-1, 1):
        rails.rail(path, sd * f['y'], f['w'], deep, 'Graphite', bevel=0.008)
    if HD and holes:
        cutter = Part('Holes')
        for x in holes:
            z = f['z'] + rail_rise(cls, t, x)
            cutter.tube((x, -f['y'] - f['w'], z), (x, f['y'] + f['w'], z), f['h'] * 0.24, 'Shadow', segments=12)
        rails.cut(cutter)
    p.join(rails)
    if boxed:
        for sd in (-1, 1):
            p.rail([(x, z) for x, z in path], sd * (f['y'] + f['w'] / 2 + 0.004), 0.008, deep * 0.72, 'Steel')


def cross_member(p, cls, x, z, kind, s=1.0):
    """A cross member between the rails: a round tube with a flange at each
    end on the plain ladder; a box with gusset plates on the boxed one."""
    f = FRAME[cls]
    inner = f['y'] - f['w'] / 2
    if kind == 'boxedLadder':
        p.box((x, 0, z), (0.12 * s, 2 * inner + 0.01, f['h'] * 0.8), 'Graphite', bevel=0.01)
        for sd in (-1, 1):
            p.convex([(x + dx, sd * yy, z + f['h'] * 0.4 + th) for th in (0.0, 0.008)
                      for dx, yy in ((-0.17 * s, inner), (0.17 * s, inner), (0.06 * s, inner - 0.16 * s), (-0.06 * s, inner - 0.16 * s))],
                     'Steel')
    else:
        p.tube((x, -inner, z), (x, inner, z), f['h'] * 0.3, 'Graphite', segments=seg(12, 8))
        for sd in (-1, 1):
            p.box((x, sd * (inner - 0.006), z), (0.14 * s, 0.012, f['h'] * 0.85), 'Graphite', bevel=0.004)
            if HD:
                for dx in (-0.05, 0.05):
                    for dz in (-0.3, 0.3):
                        p.tube((x + dx * s, sd * (inner - 0.012), z + dz * f['h']), (x + dx * s, sd * (inner - 0.022), z + dz * f['h']),
                               0.009, 'Steel', segments=6, smooth=False)


def pickup_frames(b, sill):
    """The light 4x4's frames. Each is in two pieces: everything behind the
    front axle (shown with the frame part), and the nose, which each front
    suspension brings its own copy of: kicked up over a beam axle, straight
    for double wishbones, whose arms hang where the kick would be."""
    cls, t, s = b.cls, b.t, b.s
    f = FRAME[cls]
    split = t['cg_front'] - 0.44  # where the nose piece starts
    for kind in ('ladder', 'boxedLadder', 'spaceframe'):
        pieces = [(b.fit('frame', [kind]), None, rail_path(cls, t, split, f['rear'], ('R',)), (0.6, -0.6, -1.9), (0.3, 0.0, -0.3, -0.9))]
        for lk, _ in b.layouts('F'):
            kicked = ('F',) if lk == 'axle' else ()
            pieces.append((b.fit('frame', [kind], 'Nose' + ('Axle' if lk == 'axle' else 'Ifs')), b.rig('F', lk),
                           rail_path(cls, t, f['front'], split, kicked), (1.7,), ()))
        for p, parent, path, crosses, holes in pieces:
            kicks = ('R',) if parent is None else (('F',) if 'Axle' in p.name else ())
            if kind == 'spaceframe':
                # Welded tubes, triangulated: a lower run where the rails would be and an upper one under the sills.
                for sd in (-1, 1):
                    y = sd * f['y']
                    p.sweep([(x, y, z - 0.03) for x, z in path], 0.04 * s, 'Trim', sides=seg(10, 6))
                    x0, x1 = path[0][0], path[-1][0]
                    p.tube((min(x0, 1.9), y * 1.7, sill - 0.04), (x1, y * 1.7, sill - 0.04), 0.032 * s, 'Trim', segments=seg(10, 6))
                    n = max(1, round((min(x0, 1.9) - x1) / 0.7))
                    for i in range(n):
                        xa = min(x0, 1.9) - (min(x0, 1.9) - x1) * i / n
                        xb = min(x0, 1.9) - (min(x0, 1.9) - x1) * (i + 1) / n
                        za = f['z'] - 0.03 + rail_rise(cls, t, xa, kicks)
                        p.tube((xa, y, za), (xb, y * 1.7, sill - 0.04), 0.024 * s, 'Trim', segments=6)
                        p.tube((xa, y, za), (xa, y * 1.7, sill - 0.04), 0.024 * s, 'Trim', segments=6)
                for x in crosses:
                    z = f['z'] - 0.03 + rail_rise(cls, t, x, kicks)
                    p.tube((x, -f['y'], z), (x, f['y'], z), 0.032 * s, 'Trim', segments=seg(10, 6))
            else:
                ladder_rails(p, cls, t, kind, path, holes)
                for x in crosses:
                    cross_member(p, cls, x, f['z'] + rail_rise(cls, t, x, kicks), kind)
            b.add(p, parent)


def pickup_bolt_ons(b, sill, w, xb, xf, top, xr, skirt, nose):
    t, s, r = b.t, b.s, b.r
    fx, rx = t['cg_front'], -t['cg_rear']
    frame = FRAME[b.cls]

    # Bump stops under the frame rails, over each end of the axles. (The
    # independent layouts have their own: see independent_extras.)
    for k in BUMP_STOPS:
        for key, x in (('F', fx), ('R', rx)):
            p = b.fit('bumpStops', [k], key)
            for sd in (-1, 1):
                bump_stop(p, (x, sd * frame['y'], frame['z'] - frame['h'] / 2 + rail_rise(b.cls, t, x)), s, k)
            b.add(p, b.rig(key, 'axle'))

    # Anti-roll bars across the frame, with links down to the axles.
    for k, adj in (('fixedBars', False), ('adjustableBars', True)):
        for key in ('F', 'R'):
            p = b.fit('antiRoll', [k], key)
            if key == 'F':
                roll_bar(p, fx + 0.46, frame['y'], 0.51, 0.4, r + 0.06, s, adj, flip=1)
            else:
                roll_bar(p, rx - 0.46, frame['y'], 0.51, 0.4, r + 0.06, s, adj, flip=-1)
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
                # Rock sliders: a rail under each sill, between the arches, braced to the frame.
                y = sd * (w / 2 + 0.01)
                z = skirt - 0.05
                p.sweep([(0.8, y - sd * 0.1, z), (0.72, y, z), (xb + 0.12, y, z), (xb + 0.04, y - sd * 0.1, z)], 0.04,
                        'Graphite', sides=seg(10, 6), bend=0.06)
                for x in (0.62, 0.1, xb + 0.2):
                    p.tube((x, y, z), (x, sd * 0.47, 0.64), 0.028, 'Graphite', segments=seg(8, 6))
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

    # Recovery kit: a winch on a cradle in front of the bumper, under the bull
    # bar; the boards clamped to the outside of the bed's left side (the side
    # the cameras see), and the high-lift jack on the right side.
    half = w / 2
    bed_x = (xb - 0.035 + xr) / 2
    for k, rope in (('cableWinch', False), ('ropeWinch', True)):
        p = b.fit('recovery', [k], 'Winch')
        winch(p, (nose + 0.25, 0.0, 0.95), 0.52, rope, s)
        b.add(p)
    for parts, nylon in ((STEEL_BOARDS, False), (NYLON_BOARDS, True)):
        p = b.fit('recovery', parts, 'Boards')
        board_pair(p, (bed_x, half + 0.022, sill + 0.29), 1.2, 0.31, nylon, axes=('X', 'Z', 'Y'), out=1)
        b.add(p)
    p = b.fit('recovery', JACKS, 'Jack')
    high_lift_jack(p, (bed_x, -half - 0.018, sill + 0.3), 1.12, axes=('X', 'Z', 'Y'), out=-1)
    for x in (bed_x - 0.4, bed_x + 0.4):
        p.box((x, -half - 0.01, sill + 0.3), (0.04, 0.03, 0.14), 'Graphite', bevel=0.006)
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
    p.tube((xr - 0.02, -0.3, 0.64), (xr - 0.12, -0.3, 0.64), 0.035, 'Chrome', segments=seg(16, 8))
    b.add(p)
    p = b.fit('engine', ['petrolV8'])
    p.convex([(1.62, 0.2, 1.5), (1.62, -0.2, 1.5), (1.22, 0.22, 1.53), (1.22, -0.22, 1.53),
              (1.57, 0.17, 1.585), (1.57, -0.17, 1.585), (1.24, 0.19, 1.63), (1.24, -0.19, 1.63)], 'Paint', bevel=0.014)
    p.box((1.6, 0, 1.55), (0.02, 0.3, 0.05), 'Shadow')
    for sd in (-1, 1):
        pipe_run(p, [EXHAUST_END, (-2.05, sd * 0.3 - 0.0, 0.8), (-2.25, sd * 0.55, sill - 0.12), (xr - 0.02, sd * 0.55, sill - 0.12)],
                 0.028, 'Pipe')
        p.tube((xr - 0.02, sd * 0.55, sill - 0.12), (xr - 0.12, sd * 0.55, sill - 0.12), 0.035, 'Chrome', segments=seg(16, 8))
    b.add(p)
    for k in ('dieselFour', 'turboDiesel'):
        p = b.fit('engine', [k])
        # The snorkel: out of the fender, up the screen pillar (which leans in), to a head above the roof.
        y = -(w / 2 + 0.035)
        yt = -(w / 2 - 0.15)
        pts = [(xf + 0.34, y + 0.06, 1.3), (xf + 0.3, y, 1.34), (xf + 0.06, y, 1.5), (xf - 0.5, yt, top - 0.07),
               (xf - 0.6, yt, top + 0.2)]
        p.sweep(pts, 0.045, 'Graphite', sides=seg(12, 6), bend=0.12)
        p.convex([(xf - 0.52, yt - 0.08, top + 0.18), (xf - 0.52, yt + 0.08, top + 0.18), (xf - 0.74, yt - 0.08, top + 0.18),
                  (xf - 0.74, yt + 0.08, top + 0.18), (xf - 0.5, yt - 0.07, top + 0.34), (xf - 0.5, yt + 0.07, top + 0.34),
                  (xf - 0.72, yt - 0.07, top + 0.3), (xf - 0.72, yt + 0.07, top + 0.3)], 'Graphite', bevel=0.015)
        p.box((xf - 0.495, yt, top + 0.26), (0.012, 0.11, 0.1), 'Shadow')
        pipe_run(p, [EXHAUST_END, (rx - 0.44, -0.3, 0.5), (rx - 0.5, -0.6, 0.5)], 0.028, 'Pipe')
        p.tube((rx - 0.5, -0.6, 0.5), (rx - 0.5, -0.6 - 0.25, 0.48), 0.03, 'Steel', segments=8)
        if k == 'turboDiesel':
            # The intercooler hangs under the bumper, with vents let into the bonnet above.
            p.box((nose + 0.07, 0, 0.82), (0.05, 0.8, 0.13), 'Alloy', bevel=0.01)
            for kk in range(seg(9, 5)):
                p.box((nose + 0.097, -0.36 + 0.72 * kk / (seg(9, 5) - 1), 0.82), (0.004, 0.012, 0.11), 'Shadow')
            for sd in (-1, 1):
                p.box((1.75, sd * 0.2, 1.497), (0.3, 0.1, 0.012), 'Shadow', bevel=0.004)
        b.add(p)


def mudguard(p, x, r, radius, y0, y1, mat, a0=12, a1=168, lip=0.05):
    """A mudguard over a wheel, on both sides: a curved sheet from y0 out to
    y1 with a turned-down lip along its outer edge."""
    for sd in (-1, 1):
        ya, yb = sorted((sd * y0, sd * y1))
        p.arch(x, r, radius, radius + 0.025, ya, yb, a0, a1, mat, segs=seg(20, 10))
        yl = sd * y1
        p.arch(x, r, radius - lip, radius + 0.025, min(yl, yl - sd * 0.025), max(yl, yl - sd * 0.025), a0, a1, mat,
               segs=seg(20, 10))


def cabover(b):
    """The heavy truck: a cab-over rally truck with a service box, sand
    ladders and a roof deflector."""
    t, s, body = b.t, b.s, b.shell
    w = 2.36
    half = w / 2
    sill = 1.48
    belt = 2.26
    xb, xf, top = 1.45, 3.25, 3.4
    xr = -3.05
    centre = (2.3, 0, 2.4)
    r = b.r
    stripe = (1.9, 2.0)  # level with the stripe along the box
    rake = 0.3  # how far the windscreen leans back, bottom to top

    # --- The cab, as slices from the front to its back wall ----------------
    # 12 points a slice: 0 to 6 are the floor and the side up to the belt
    # line, 7 and 8 the side window, 9 to 11 the roof. On the front slice the
    # top points all sit along the bottom of the windscreen, so the faces up
    # to the next slice ARE the screen.
    low = [(0, sill), (half - 0.05, sill), (half, sill + 0.05), (half + 0.012, stripe[0]), (half + 0.012, stripe[1]),
           (half, belt - 0.06), (half - 0.025, belt)]
    front = low + [(half - 0.05, belt + 0.03), (half - 0.05, belt + 0.03), (half - 0.14, belt + 0.035),
                   (0.55, belt + 0.04), (0, belt + 0.04)]
    cab = low + [(half - 0.05, belt + 0.03), (half - 0.1, top - 0.2), (half - 0.2, top - 0.02), (0.55, top + 0.02),
                 (0, top + 0.03)]

    def slice_at(x):
        if x > xf - rake:
            return mix_section(front, cab, (xf - x) / rake)
        return cab

    seam = 0.014
    door_front, door_back = xf - 0.14, xb + 0.56
    xs = [xf, door_front, door_front - seam, xf - rake, door_back + 0.08, door_back, door_back - seam, xb]
    skin = Part('Skin')
    faces = skin.loft([(x, slice_at(x)) for x in xs], 'Paint')

    def patch(fs, stations, x0, x1, rows, sides=(-1, 1)):
        return [fs.get((i, j, sd)) for i in range(len(stations) - 1)
                if stations[i] <= x0 + 1e-6 and stations[i + 1] >= x1 - 1e-6 for j in rows for sd in sides]

    skin._paint([f for f in patch(faces, xs, xf, xb, [3]) if f], 'Magenta')
    for x in (door_front, door_back):
        skin._paint([f for f in patch(faces, xs, x, x - seam, range(1, 6)) if f], 'Shadow')
    skin._paint([f for f in patch(faces, xs, xf, xb, [0]) if f], 'Graphite')
    for sd in (-1, 1):
        # A split windscreen (one pane a side) and a door window a side.
        skin.window(patch(faces, xs, xf, xf - rake, [9, 10], (sd,)), 0.045)
        skin.window(patch(faces, xs, xf, door_back + 0.08, [7], (sd,)), 0.045)
    skin.round_edges(0.05)
    body.join(skin)

    # A roof deflector to push air over the box.
    body.convex([(xf - 0.5, half - 0.25, top), (xf - 0.5, -half + 0.25, top), (xb + 0.05, -half + 0.2, top),
                 (xb + 0.05, half - 0.2, top), (xb + 0.05, half - 0.22, top + 0.42),
                 (xb + 0.05, -half + 0.22, top + 0.42), (xb + 0.35, half - 0.25, top + 0.4),
                 (xb + 0.35, -half + 0.25, top + 0.4)], 'Paint', bevel=0.05)
    # A sun visor over the screen, and the lamp bar on the roof's front edge.
    vz = top - 0.14
    body.convex([(xf - rake + 0.36, sd * (half - 0.12), vz - 0.1 + dz) for sd in (-1, 1) for dz in (0, 0.03)] +
                [(xf - rake + 0.02, sd * (half - 0.12), vz + 0.06 + dz) for sd in (-1, 1) for dz in (0, 0.03)], 'Trim',
                bevel=0.012)
    lamp_bar(body, xf - rake + 0.1, top + 0.1, 1.9, 6, 1.4)
    for sd in (-1, 1):
        body.tube((xf - rake + 0.1, sd * 0.8, top + 0.03), (xf - rake + 0.1, sd * 0.8, top), 0.018, 'Graphite', segments=6)
    # Wipers, hung from above the screen as on a real cab-over.
    for sd in (-1, 1):
        body.tube((xf - 0.03, sd * 0.3, belt + 0.12), (xf - 0.16, sd * 0.75, belt + 0.55), 0.01, 'Shadow', segments=5)

    # --- The front: grille, bumper, lamps, steps ---------------------------
    gz = (sill + belt) / 2 + 0.04
    body.box((xf + 0.004, 0, gz), (0.03, 1.66, 0.56), 'Shadow', bevel=0.012)
    n = seg(8, 5)
    for k in range(n):
        body.box((xf + 0.022, 0, gz - 0.22 + 0.44 * k / (n - 1)), (0.02, 1.56, 0.022), 'Trim')
    body.box((xf + 0.024, 0, gz), (0.024, 0.05, 0.52), 'Chrome')
    for sd in (-1, 1):
        body.box((xf + 0.008, sd * 1.0, gz + 0.1), (0.02, 0.2, 0.2), 'Shadow', bevel=0.01)
        body.box((xf + 0.016, sd * 1.0, gz + 0.1), (0.02, 0.14, 0.13), 'Amber', bevel=0.01)
    # A heavy bumper: a deep pressed beam with the lamps let into it, and tow eyes.
    bz = 1.42
    body.convex([(xf + x, sd * y, bz + sz * hz) for x, y, hz in ((0.26, 0.9, 0.16), (0.02, 0.9, 0.18)) for sd in (-1, 1)
                 for sz in (-1, 1)], 'Trim', bevel=0.035)
    for sd in (-1, 1):
        body.convex([(xf + x, sd * y, bz + sz * hz) for x, y, hz in ((0.26, 0.88, 0.16), (0.02, 0.88, 0.18),
                                                                  (0.08, half + 0.03, 0.13), (-0.14, half + 0.03, 0.15))
                     for sz in (-1, 1)], 'Trim', bevel=0.035)
        headlamp(body, xf + 0.27, sd * 0.7, bz + 0.02, 0.085)
        headlamp(body, xf + 0.27, sd * 0.47, bz + 0.02, 0.065)
        eye = [(xf + 0.24, sd * 0.22, bz - 0.06), (xf + 0.38, sd * 0.22, bz - 0.06), (xf + 0.42, sd * 0.22, bz - 0.01),
               (xf + 0.38, sd * 0.22, bz + 0.04), (xf + 0.24, sd * 0.22, bz + 0.04)]
        body.sweep(eye, 0.022, 'Magenta', sides=seg(8, 5), curve=2 if HD else 0)
        # Two steps up to the door, on hangers, ahead of the front wheel (clear of it at full bump).
        sx = xf - 0.2
        for z in (1.14, 0.86):
            body.box((sx, sd * (half - 0.13), z), (0.22, 0.26, 0.035), 'Steel', bevel=0.008)
            for k in range(seg(3, 0)):
                body.box((sx - 0.07 + k * 0.07, sd * (half - 0.13), z + 0.02), (0.018, 0.24, 0.012), 'Shadow')
        for x in (sx - 0.1, sx + 0.1):
            body.box((x, sd * (half - 0.015), 1.16), (0.025, 0.025, 0.64), 'Graphite')
        # Handle, number board, and big mirrors on arms.
        body.box((door_back + 0.12, sd * (half + 0.014), belt - 0.14), (0.16, 0.024, 0.04), 'Chrome', bevel=0.012)
        body.box((door_back + 0.12, sd * (half + 0.004), belt - 0.14), (0.2, 0.012, 0.075), 'Shadow', bevel=0.004)
        body.box((xf - 0.85, sd * (half + 0.012), sill + 0.23), (0.62, 0.012, 0.28), 'Board', bevel=0.005)
        hang = [(xf - 0.2, sd * (half - 0.05), belt + 0.75), (xf + 0.04, sd * (half + 0.22), belt + 0.72),
                (xf + 0.04, sd * (half + 0.22), belt + 0.12), (xf - 0.2, sd * (half - 0.03), belt + 0.06)]
        body.sweep(hang, 0.018, 'Graphite', sides=seg(8, 5), bend=0.06)
        body.box((xf + 0.05, sd * (half + 0.27), belt + 0.42), (0.06, 0.18, 0.4), 'Trim', bevel=0.022)
        body.box((xf + 0.018, sd * (half + 0.27), belt + 0.42), (0.004, 0.14, 0.34), 'Chrome')
    # Mudguards over the front wheels, under the cab.
    mudguard(body, t['cg_front'], r, r + 0.2, half - 0.34, half + 0.06, 'Trim')

    # --- The service box over the rear --------------------------------------
    bf = xb - 0.6
    z0, ztop = 1.44, 3.15
    shut = (-1.5, 0.4)   # the roller shutter and the locker under it run between these x
    rows = [(0, z0), (half - 0.04, z0), (half, z0 + 0.04), (half, 1.52), (half, 1.82), (half, 1.9), (half, 2.0),
            (half, 2.08), (half, 3.0), (half, ztop - 0.04), (half - 0.04, ztop), (0.5, ztop + 0.015), (0, ztop + 0.02)]
    bxs = [bf, shut[1], shut[0], xr]
    box = Part('Box')
    bfaces = box.loft([(x, rows) for x in bxs], 'Paint')
    box._paint([f for f in patch(bfaces, bxs, bf, xr, [5]) if f], 'Magenta')
    box._paint([f for f in patch(bfaces, bxs, bf, xr, [0]) if f], 'Graphite')
    for sd in (-1, 1):
        box.recess(patch(bfaces, bxs, shut[1], shut[0], [7], (sd,)), 0.035, 0.04, 'Graphite')
        box.recess(patch(bfaces, bxs, shut[1], shut[0], [3], (sd,)), 0.025, 0.014)
    box.round_edges(0.04)
    body.join(box)
    # Rub rails along the top and bottom edges, and a hatch and vent on the roof.
    for z in (ztop - 0.01, z0 + 0.02):
        for sd in (-1, 1):
            body.box(((bf + xr) / 2, sd * (half + 0.006), z), (bf - xr - 0.12, 0.03, 0.05), 'Trim', bevel=0.012)
    body.box((-0.4, 0, ztop + 0.04), (0.8, 0.8, 0.05), 'Trim', bevel=0.015)
    body.box((-2.2, 0.3, ztop + 0.06), (0.4, 0.4, 0.1), 'Graphite', bevel=0.02)
    mid = (shut[0] + shut[1]) / 2
    for sd in (-1, 1):
        # The roller shutter's slats and its pull handle; the locker's two handles.
        n = seg(13, 7)
        for k in range(n):
            body.box((mid, sd * (half - 0.028), 2.13 + 0.82 * k / (n - 1)), (shut[1] - shut[0] - 0.1, 0.02, 0.82 / n * 0.8),
                     'Steel', bevel=0.006)
        body.box((mid, sd * (half - 0.012), 2.13), (0.3, 0.022, 0.04), 'Trim', bevel=0.008)
        for x in (mid - 0.5, mid + 0.5):
            body.box((x, sd * (half - 0.004), 1.67), (0.12, 0.016, 0.035), 'Shadow', bevel=0.006)
        body.box((mid, sd * (half - 0.01), 1.67), (0.012, 0.01, 0.26), 'Shadow')
        # (The sand ladders that used to be clamped here are the recovery kit now: cabover_bolt_ons.)
        body.box((xr + 0.3, sd * (half + 0.004), 2.95), (0.3, 0.012, 0.09), 'TailLamp', bevel=0.004)
    # The back: two doors, a ladder, the lamps and an underrun bar.
    for sd in (-1, 1):
        body.box((xr - 0.006, sd * 0.55, 2.3), (0.02, 1.04, 1.5), 'Paint', bevel=0.012)
        body.box((xr - 0.02, sd * 0.1, 2.25), (0.02, 0.03, 0.5), 'Chrome', bevel=0.006)
        for z in (1.75, 2.85):
            body.box((xr - 0.016, sd * 1.02, z), (0.02, 0.08, 0.12), 'Graphite', bevel=0.006)
        body.tube((xr - 0.07, sd * 0.24 - 0.5, 1.3), (xr - 0.07, sd * 0.24 - 0.5, 3.22), 0.02, 'Steel', segments=seg(8, 6))
        body.box((xr - 0.012, sd * 0.96, 1.36), (0.03, 0.26, 0.13), 'TailLamp', bevel=0.012)
        body.box((xr - 0.012, sd * 0.72, 1.36), (0.03, 0.14, 0.13), 'Amber', bevel=0.012)
    for k in range(8):
        z = 1.4 + k * 0.25
        body.tube((xr - 0.07, -0.74, z), (xr - 0.07, -0.26, z), 0.015, 'Steel', segments=6)
    for z in (1.6, 3.0):
        body.tube((xr - 0.07, -0.5, z), (xr, -0.5, z), 0.012, 'Steel', segments=6)
    body.box((xr + 0.02, 0, 1.34), (0.1, w - 0.1, 0.2), 'Trim', bevel=0.025)
    body.box((xr - 0.02, 0, 1.02), (0.08, w - 0.3, 0.1), 'Trim', bevel=0.02)
    for sd in (-1, 1):
        body.box((xr + 0.02, sd * 0.6, 1.18), (0.06, 0.06, 0.3), 'Graphite')
    mudguard(body, -t['cg_rear'], r, r + 0.2, half - 0.34, half + 0.06, 'Trim')
    # Mud flaps behind both axles.
    for sd in (-1, 1):
        body.box((-t['cg_rear'] - 0.8, sd * (t['track'] / 2), 0.86), (0.03, 0.46, 0.56), 'Rubber', bevel=0.005)
        body.box((t['cg_front'] - 0.8, sd * (t['track'] / 2), 1.0), (0.03, 0.46, 0.4), 'Rubber', bevel=0.005)
    # Fuel tanks slung along the frame between the wheels: domed ends, straps and a filler.
    for sd in (-1, 1):
        y, z, rad = sd * 0.82, 1.02, 0.28
        body.lathe([(0, -0.74), (rad * 0.7, -0.725), (rad * 0.95, -0.68), (rad, -0.62), (rad, 0.62), (rad * 0.95, 0.68),
                    (rad * 0.7, 0.725), (0, 0.74)], 'Steel', segments=seg(24, 12), centre=(0.2, y, z), axis='X')
        for x in (-0.25, 0.65):
            body.ring(rad, rad + 0.012, x - 0.03, x + 0.03, 'Graphite', segments=seg(24, 12), centre=(0, y, z), axis='X')
        body.tube((0.75, y + sd * 0.1, z + 0.22), (0.75, y + sd * 0.16, z + 0.3), 0.055, 'Graphite', segments=seg(10, 6))
        body.tube((0.75, y + sd * 0.16, z + 0.3), (0.75, y + sd * 0.175, z + 0.32), 0.06, 'Chrome', segments=seg(10, 6))

    cabover_driveline(b)
    cabover_frames(b)
    cabover_bolt_ons(b, sill, w, xb, xf, top, xr)


def cabover_frames(b):
    cls, t = b.cls, b.t
    f = FRAME[cls]
    for kind in ('ladder', 'boxedLadder'):
        p = b.fit('frame', [kind])
        ladder_rails(p, cls, t, kind, rail_path(cls, t, f['front'], f['rear']), (-0.9, -1.5, -2.5))
        for x in (2.8, 1.2, 0.0, -1.2, -2.6):
            cross_member(p, cls, x, f['z'], kind, 1.4)
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

    # Recovery kit: a winch on a cradle under the front bumper, between the
    # tow eyes; boards clamped to both sides of the box above the rear wheel
    # (where the old always-on sand ladders were); the high-lift jack along the
    # left side under them.
    for k, rope in (('cableWinch', False), ('ropeWinch', True)):
        p = b.fit('recovery', [k], 'Winch')
        winch(p, (xf + 0.2, 0.0, 1.13), 0.66, rope, 1.6)
        b.add(p)
    half = w / 2
    lx0, lx1, lz = -2.92, -1.68, 2.58
    for parts, nylon in ((STEEL_BOARDS, False), (NYLON_BOARDS, True)):
        p = b.fit('recovery', parts, 'Boards')
        for sd in (-1, 1):
            traction_board(p, ((lx0 + lx1) / 2, sd * (half + 0.035), lz), lx1 - lx0, 0.34, nylon, axes=('X', 'Z', 'Y'), out=sd)
            for x in (lx0 + 0.25, lx1 - 0.25):
                p.box((x, sd * (half + 0.06), lz), (0.05, 0.03, 0.42), 'Graphite', bevel=0.008)
        b.add(p)
    p = b.fit('recovery', JACKS, 'Jack')
    high_lift_jack(p, ((lx0 + lx1) / 2, half + 0.04, lz - 0.34), 1.25, axes=('X', 'Z', 'Y'), out=1)
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
    body.box((0.0, 0, floor), (1.9, 1.15, 0.04), 'Graphite', bevel=0.012)
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
        # Each side is one bent tube: up the front pillar, along the roof, down the main hoop.
        side = [(0.85, sd * tw, floor), (0.85, sd * tw, floor + 0.45), (roof_front, sd * tw * 0.95, roof_z),
                (roof_back, sd * tw * 0.95, roof_z), (hoop_x, sd * tw, floor)]
        body.sweep(side, rt, 'Magenta', sides=seg(12, 6), bend=0.16)
        # Door bars and the stays down to the engine bay.
        body.tube((0.84, sd * tw, floor + 0.32), (hoop_x + 0.03, sd * tw, floor + 0.32), 0.022, 'Magenta', segments=seg(10, 6))
        body.tube((hoop_x, sd * tw, floor + 0.03), (-1.35, sd * 0.45, floor + 0.35), 0.022, 'Magenta', segments=seg(10, 6))
        body.tube((roof_back, sd * tw * 0.95, roof_z - 0.02), (-1.35, sd * 0.45, floor + 0.35), 0.022, 'Magenta',
                  segments=seg(10, 6))
        # Weld-on feet where the cage meets the floor.
        for x in (0.85, hoop_x):
            body.box((x, sd * tw, floor + 0.03), (0.1, 0.08, 0.012), 'Graphite', bevel=0.004)
        # Half doors and a window net.
        body.convex([(0.62, sd * (tw + 0.01), floor + 0.05), (-0.45, sd * (tw + 0.01), floor + 0.05),
                     (0.6, sd * (tw + 0.01), floor + 0.3), (-0.45, sd * (tw + 0.01), floor + 0.3),
                     (0.62, sd * (tw + 0.04), floor + 0.05), (-0.45, sd * (tw + 0.04), floor + 0.05),
                     (0.6, sd * (tw + 0.05), floor + 0.3), (-0.45, sd * (tw + 0.05), floor + 0.3)], 'Paint', bevel=0.016)
        body.box((0.08, sd * (tw + 0.047), floor + 0.26), (0.5, 0.012, 0.03), 'Magenta', bevel=0.004)
        body.box((-0.36, sd * (tw + 0.05), floor + 0.24), (0.08, 0.014, 0.03), 'Shadow', bevel=0.004)
        for k in range(5):
            x = 0.45 - k * 0.2
            body.box((x, sd * (tw - 0.005), floor + 0.62), (0.012, 0.008, 0.55), 'Graphite')
        for k in range(4):
            body.box((-0.0, sd * (tw - 0.005), floor + 0.4 + k * 0.15), (0.85, 0.008, 0.012), 'Graphite')
    body.tube((roof_back, -tw * 0.95, roof_z), (roof_back, tw * 0.95, roof_z), rt, 'Magenta', segments=seg(12, 6))
    body.tube((roof_front, -tw * 0.95, roof_z), (roof_front, tw * 0.95, roof_z), rt, 'Magenta', segments=seg(12, 6))
    body.tube((hoop_x, -tw, floor + 0.9), (hoop_x - 0.04, tw, floor + 0.9), 0.022, 'Magenta', segments=seg(10, 6))
    body.tube((0.85, -tw, floor + 0.45), (0.85, tw, floor + 0.45), 0.024, 'Magenta', segments=seg(10, 6))
    # Roof panel and a lamp bar.
    body.convex([(x, sd * y, roof_z + z) for x, y, z in
                 ((roof_front + 0.04, tw * 0.9, 0.028), (roof_back - 0.04, tw * 0.9, 0.028), (roof_front + 0.04, tw * 0.9, 0.05),
                  (roof_back - 0.04, tw * 0.9, 0.05), (roof_front, tw * 0.5, 0.068), (roof_back, tw * 0.5, 0.068))
                 for sd in (-1, 1)], 'Paint', bevel=0.012)
    lamp_bar(body, roof_front - 0.03, roof_z + 0.11, 0.9, 4, 0.8)
    # A safety whip with a magenta flag.
    body.tube((-1.3, 0.45, floor + 0.35), (-1.32, 0.45, roof_z + 0.95), 0.006, 'Graphite', segments=4)
    body.convex([(-1.32, 0.45, roof_z + 0.95), (-1.32, 0.45, roof_z + 0.75), (-1.6, 0.45, roof_z + 0.85),
                 (-1.32, 0.454, roof_z + 0.95), (-1.32, 0.454, roof_z + 0.75), (-1.6, 0.454, roof_z + 0.85)], 'Magenta')

    # The nose: a short, rounded bonnet between the front wheels, with a
    # magenta stripe down its middle, headlamps and a bumper.
    def nose_slice(yb, zb, zt):
        return [(0, zb), (yb - 0.04, zb), (yb, zb + 0.04), (yb + 0.012, (zb + zt) / 2), (yb - 0.02, zt - 0.06),
                (yb - 0.1, zt), (yb * 0.45, zt + 0.032), (0.08, zt + 0.04), (0, zt + 0.04)]

    # It's narrow, so the front shocks stand outside it in plain view, hung from a hoop of their own.
    nose = Part('Nose')
    nfaces = nose.loft([(1.66, nose_slice(0.2, 0.62, 0.8)), (1.5, nose_slice(0.22, 0.58, 0.87)),
                        (1.25, nose_slice(0.235, 0.53, 0.95)), (1.0, nose_slice(0.25, 0.5, 1.01)),
                        (0.95, nose_slice(0.58, 0.48, 1.03)), (0.85, nose_slice(0.6, floor + 0.05, 1.03))], 'Paint')
    for (i, j, sd), f in nfaces.items():
        if j == 7:
            nose._paint([f], 'Magenta')
        elif j == 0:
            nose._paint([f], 'Graphite')
    nose.round_edges(0.03)
    body.join(nose)
    for sd in (-1, 1):
        body.box((1.662, sd * 0.09, 0.735), (0.02, 0.15, 0.1), 'Shadow', bevel=0.01)
        headlamp(body, 1.675, sd * 0.09, 0.735, 0.04)
    body.box((1.665, 0, 0.66), (0.02, 0.2, 0.035), 'Shadow', bevel=0.008)
    # The front shock hoop: across the tops of the shocks, down to the frame ahead of them, and braced back to the cage.
    tops = [b.tops[(c, kind)] for c in ('FL', 'FR') for kind, _ in b.layouts('F')]
    hz = max(v.z for v in tops) + 0.05
    hx = tops[0].x
    hy = max(abs(v.y) for v in tops) + 0.06
    body.sweep([(1.52, -0.3, 0.5), (hx, -hy, hz), (hx, hy, hz), (1.52, 0.3, 0.5)], 0.026, 'Graphite', sides=seg(10, 6), bend=0.08)
    for sd in (-1, 1):
        body.tube((hx, sd * hy, hz - 0.03), (0.86, sd * tw, floor + 0.45), 0.02, 'Graphite', segments=seg(8, 6))
        for v in tops:
            if v.y * sd > 0:
                body.box((v.x, v.y, (v.z + hz) / 2 - 0.005), (0.05, 0.012, hz - v.z + 0.03), 'Graphite')
    hoop = [(1.42, -0.46, 0.47), (1.72, -0.5, 0.55), (1.76, -0.3, 0.57), (1.76, 0.3, 0.57), (1.72, 0.5, 0.55),
            (1.42, 0.46, 0.47)]
    body.sweep(hoop, 0.03, 'Graphite', sides=seg(10, 6), bend=0.1)
    for sd in (-1, 1):
        body.tube((1.75, sd * 0.3, 0.57), (1.62, sd * 0.3, 0.7), 0.022, 'Graphite', segments=seg(8, 6))
    # Dash, steering wheel and a mirror.
    body.box((0.75, 0, floor + 0.5), (0.14, 1.1, 0.2), 'Graphite', bevel=0.03)
    body.torus(0.16, 0.014, 'Shadow', segments=seg(20, 10), sides=seg(8, 5), centre=(0.55, 0.3, floor + 0.55), axis='X')
    body.tube((0.55, 0.3, floor + 0.55), (0.72, 0.3, floor + 0.5), 0.015, 'Graphite', segments=6)
    body.box((roof_front - 0.02, 0, roof_z - 0.08), (0.03, 0.26, 0.07), 'Graphite', bevel=0.01)
    # Fenders over all four wheels: thin panels the wheels just reach at full bump.
    for x in (t['cg_front'], -t['cg_rear']):
        for sd in (-1, 1):
            pass
        mudguard(body, x, b.r, 0.7, 0.62, 0.95, 'Trim', a0=42, a1=138, lip=0.03)
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
    lamp_bar(body, -1.56, floor + 0.62, 0.6, 3, 0.6, face=-1)

    buggy_driveline(b)
    buggy_frames(b, hoop_x, roof_front, roof_back, roof_z, tw, floor)
    buggy_bolt_ons(b, floor, tw)


def buggy_frames(b, hoop_x, roof_front, roof_back, roof_z, tw, floor):
    # The plain tube frame is the cage above; gussets add plates in the
    # joints, and chromoly adds extra bracing (thinner tubes do more work).
    p = b.fit('frame', ['tubeFrame', 'gussetedTube', 'chromolyTube'])
    for sd in (-1, 1):
        p.tube((1.5, sd * 0.35, floor + 0.08), (-1.5, sd * 0.36, floor + 0.08), 0.03, 'Graphite', segments=seg(10, 6))
    for x in (1.2, 0.6, -0.6, -1.3):
        p.tube((x, -0.36, floor + 0.08), (x, 0.36, floor + 0.08), 0.025, 'Graphite', segments=seg(10, 6))
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
                bx = x + (0.15 if x > 0 else 0.25)
                bump_stop(p, (bx, sd * 0.5, r + 0.3), s * 0.8, k)
                # A stub off the frame for it to hang from.
                p.tube((bx, sd * 0.5, r + 0.31), (bx, sd * 0.36, floor + 0.1), 0.016, 'Graphite', segments=6)
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
    crate(p, (-1.2, 0, floor + 1.0), (0.4, 0.5, 0.2), 1.0)
    b.add(p)

    # Recovery kit: a small winch tucked behind the front bumper hoop; the
    # boards and the high-lift jack strapped flat on the roof.
    for k, rope in (('cableWinch', False), ('ropeWinch', True)):
        p = b.fit('recovery', [k], 'Winch')
        winch(p, (1.64, 0.0, 0.52), 0.36, rope, 0.75)
        b.add(p)
    roof_z = 1.72
    for parts, nylon in ((STEEL_BOARDS, False), (NYLON_BOARDS, True)):
        p = b.fit('recovery', parts, 'Boards')
        board_pair(p, (-0.15, 0.17, roof_z + 0.04), 0.86, 0.3, nylon, axes=('X', 'Y', 'Z'), out=1)
        b.add(p)
    p = b.fit('recovery', JACKS, 'Jack')
    high_lift_jack(p, (-0.15, -0.3, roof_z + 0.035), 0.98, axes=('X', 'Y', 'Z'), out=1)
    b.add(p)

    # Engines: one pipe for the twin, two for the triple, a turbo, intercooler and air box for the turbo twin.
    for k in ('twin', 'triple', 'turboTwin'):
        p = b.fit('engine', [k])
        pipes = {'twin': (0.0,), 'triple': (-0.18, 0.18), 'turboTwin': (-0.18, 0.18)}[k]
        for y in pipes:
            p.tube((-1.45, y + 0.2, floor + 0.38), (-1.62, y + 0.2, floor + 0.42), 0.035, 'Chrome', segments=seg(16, 8))
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
    # `-- light4x4` builds just that truck; add `full` or `lite` for just that build of it.
    only = [a for a in sys.argv[sys.argv.index('--') + 1:]] if '--' in sys.argv else []
    builds = [a for a in only if a in ('full', 'lite')]
    only = [a for a in only if a not in ('full', 'lite')]
    skip = {'full', 'lite'} - set(builds) if builds else set()
    for cls, t in TRUCKS.items():
        if only and cls not in only:
            continue
        materials = make_materials({'Paint': (t['paint'], 'gloss'), 'Trim': (t['trim'], 'satin')})
        for lite in (False, True):
            if ('lite' if lite else 'full') in skip:
                continue
            global HD
            HD = not lite
            build_truck(cls, t, materials, lite)


main()
