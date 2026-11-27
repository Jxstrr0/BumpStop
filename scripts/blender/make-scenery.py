"""
Bump Stop's scenery, built by script. No Blender window needed.

Run it with the Blender Python module (`pip install bpy==5.1.2`):

    python scripts/blender/make-scenery.py

or with Blender itself:

    blender --background --python scripts/blender/make-scenery.py

It writes public/models/scenery.glb.gz: one ordinary .glb model, zipped,
holding every piece of scenery as its own named mesh. Commit that file: the
game loads it (src/render/scenery.ts) and the build never runs Blender.

The game plants the pieces itself, many copies of each, so every piece is

- ONE mesh with ONE material: its colours are painted on the corners
  (vertex colours), so a whole forest is a handful of draw calls;
- small: a tree is 100 to 300 triangles;
- standing on the ground at its origin, at its real size in metres.

What's in the file (the names are the ones src/data/scenery.ts lists):

    Spruce_A..D, Spruce_Young   boreal spruces: narrow, drooping tiers
    Spruce_Snow_A, _B           the same under snow, for winter stages
    Pine_A, Pine_B              tall bare trunks with a flat crown
    Birch_A..C, Birch_Gold      pale trunks with dark bands and a light crown
    Birch_Bare                  a leafless birch, for winter
    Snag                        a dead grey trunk
    Rock_A..D, Boulder          granite with lichen on top
    Shrub_A, Shrub_B, Heather   low bushes; heather is a purple-brown mound
    Grass_A, Grass_B, Reeds     tufts for the verge and the ditch
    Fireweed, Cotton            tall pink flower spikes; white cotton grass
    Stump, Log, Cairn           a cut stump, a fallen birch, a pile of stones
    Wall, Gate                  a length of dry-stone wall and a five-bar gate
    Post                        a roadside marker post with a pink band
    Board_1, _2, _3             roadbook caution boards: !, !! and !!!
    Arch, Hut, TireStack,       the test track's start line: a truss arch
    Pennant, Bale               with a chequered header, the timing hut,
                                painted tire stacks, flags and straw bales
    Pole                        a wooden power pole
    Bothy                       a small stone hut with a slate roof
    Ridge_0, _1, _2             the hills on the horizon, as three rings
    Cloud_A, _B, _C             low flat-bottomed clouds
    Shop                        the workshop round the shaker rig
    ShakerBase, ShakerPan       one of the rig's four posts and its wheel pan

Everything is made from a fixed list of random numbers (a seed per piece),
so running the script twice gives the same file.

Coordinates (Blender): X along the road, Y to the left, Z up, metres. glTF
turns this into three.js's Y up.

No real brands, logos, places or people.
"""

import gzip
import math
import os
import random

import bpy  # first: the bmesh module comes with it
import bmesh
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = os.path.normpath(os.path.join(HERE, '..', '..', 'public', 'models'))

V = Vector
TAU = 2 * math.pi


# --- Colours ------------------------------------------------------------------
# Hex as on screen (sRGB). The file stores linear numbers, so we convert at
# the last moment (in `Item._paint`).

def rgb(h):
    h = h.lstrip('#')
    return tuple(int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))


def mix(a, b, t):
    t = max(0.0, min(1.0, t))
    return tuple(a[i] + (b[i] - a[i]) * t for i in range(3))


def shade(c, k):
    """Lighter (k > 1) or darker (k < 1)."""
    return tuple(max(0.0, min(1.0, v * k)) for v in c)


def srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


# The scenery palette: muted, like the roadbook's paper, so the trucks and
# their magenta springs stay the brightest thing on screen.
C = {k: rgb(v) for k, v in {
    'spruce': '#35463B', 'spruceTip': '#4F6450', 'spruceDark': '#232F28',
    'pine': '#3F5443', 'pineTip': '#5B7256',
    'bark': '#5A4A3C', 'barkDark': '#3B3029', 'pineBark': '#A86A42',
    'birch': '#EDE8DC', 'birchBand': '#2E2B28', 'birchTwig': '#6A5B4E',
    'leaf': '#8E9460', 'leafTip': '#B5B26A', 'leafDark': '#6C7450',
    'gold': '#C9A54A', 'goldTip': '#E3C766', 'goldDark': '#A07F38',
    'granite': '#8F8B84', 'graniteDark': '#6B6862', 'graniteLight': '#B4AFA6', 'lichen': '#A9AE8C',
    'moss': '#6F7A4E', 'shrub': '#6F7B56', 'shrubTip': '#93A06C', 'dwarf': '#8A5E46', 'dwarfTip': '#B07A4E',
    'heather': '#7C5A78', 'heatherTip': '#A678A0', 'heatherDark': '#4C4238',
    'grass': '#8B8D5C', 'straw': '#CDBE8C', 'reed': '#A89C6A', 'reedHead': '#6A5540',
    'fireweed': '#E0559F', 'fireweedDark': '#B93C80', 'stalk': '#6E7A50', 'cotton': '#F4F1E8',
    'snow': '#EEF2F5', 'snowShade': '#C9D5DF',
    'wood': '#8A7359', 'woodDark': '#5F4E3C', 'woodPale': '#B9A483', 'woodGrey': '#8D877C',
    'graphite': '#25272B', 'paper': '#FBFAF5', 'paperDim': '#DAD6CB', 'magenta': '#FF4FB2', 'hot': '#C0262D',
    'cool': '#1F65A8', 'amber': '#F0AE45', 'rubber': '#1E1F21', 'steel': '#9AA0A7', 'steelDark': '#5B5D61',
    'tin': '#A9AEB2', 'tinDark': '#7C8286', 'slate': '#4A4F58', 'slateLight': '#626873', 'glass': '#2A3742',
    'glow': '#FFE7A6', 'bale': '#D2BC7C', 'baleDark': '#A8935A',
    'concrete': '#B9B4A8', 'concreteDark': '#8E8A80', 'block': '#D9D4C6', 'blockDark': '#B5B0A2',
    'hazard': '#F0C02E', 'chrome': '#D9DDE2',
}.items()}


# --- A tiny mesh builder ------------------------------------------------------

class Item:
    """One piece of scenery: one mesh, colours painted on the corners."""

    def __init__(self, name, seed=1):
        self.name = name
        self.bm = bmesh.new()
        self.col = self.bm.loops.layers.float_color.new('Col')
        self.rng = random.Random(f'{name}-{seed}')

    def _paint(self, faces, colour, smooth=False):
        """`colour` is one colour, or a function of (corner position, face normal)."""
        for f in faces:
            f.smooth = smooth
            n = f.normal.copy()
            for loop in f.loops:
                c = colour(loop.vert.co, n) if callable(colour) else colour
                loop[self.col] = (srgb_to_linear(c[0]), srgb_to_linear(c[1]), srgb_to_linear(c[2]), 1.0)

    def _new_faces(self, verts):
        # In a fixed order (a set's order changes from run to run, and the
        # colours that take a random shade would change with it).
        faces, seen = [], set()
        for v in verts:
            for f in v.link_faces:
                if f not in seen:
                    seen.add(f)
                    faces.append(f)
        bmesh.ops.recalc_face_normals(self.bm, faces=faces)
        for f in faces:
            f.normal_update()
        return faces

    def box(self, centre, size, colour, rot=None):
        m = Matrix.Translation(V(centre))
        if rot is not None:
            m = m @ rot.to_4x4()
        m = m @ Matrix.Diagonal(V((*size, 1.0)))
        out = bmesh.ops.create_cube(self.bm, size=1.0, matrix=m)
        self._paint(self._new_faces(out['verts']), colour)

    def tube(self, a, b, r, colour, sides=6, r2=None, smooth=True, caps=True):
        """A round bar from a to b (a cone if r2 is given)."""
        a, b = V(a), V(b)
        d = b - a
        rot = V((0, 0, 1)).rotation_difference(d.normalized()).to_matrix().to_4x4()
        m = Matrix.Translation((a + b) / 2) @ rot
        out = bmesh.ops.create_cone(self.bm, cap_ends=caps, segments=sides, radius1=r,
                                    radius2=r if r2 is None else r2, depth=d.length, matrix=m)
        self._paint(self._new_faces(out['verts']), colour, smooth)

    def loft(self, rings, colour, smooth=True, cap=True):
        """Skin a stack of rings: each is (centre, radius, colour or None)."""
        bm = self.bm
        made = []
        sides = None
        for centre, radius, _ in rings:
            n = 6 if sides is None else sides
            sides = n
            made.append([bm.verts.new((centre[0] + radius * math.cos(TAU * k / n),
                                       centre[1] + radius * math.sin(TAU * k / n), centre[2])) for k in range(n)])
        for i in range(len(made) - 1):
            faces = []
            for k in range(sides):
                k2 = (k + 1) % sides
                faces.append(bm.faces.new([made[i][k], made[i][k2], made[i + 1][k2], made[i + 1][k]]))
            bmesh.ops.recalc_face_normals(bm, faces=faces)
            for f in faces:
                f.normal_update()
            self._paint(faces, rings[i][2] or colour, smooth)
        if cap:
            f = bm.faces.new(made[-1])
            f.normal_update()
            if f.normal.z < 0:
                f.normal_flip()
            self._paint([f], rings[-1][2] or colour)

    def blob(self, centre, radii, colour, jitter=0.18, detail=1):
        """A lumpy ball: leaves, bushes, clouds. `detail` 1 is 20 flat faces, 2 is 80."""
        out = bmesh.ops.create_icosphere(self.bm, subdivisions=detail, radius=1.0)
        cx, cy, cz = centre
        for v in out['verts']:
            k = 1 + (self.rng.random() - 0.5) * 2 * jitter
            v.co = V((cx + v.co.x * radii[0] * k, cy + v.co.y * radii[1] * k, cz + v.co.z * radii[2] * k))
        self._paint(self._new_faces(out['verts']), colour)

    def hull(self, points, colour, smooth=False):
        """The smallest solid that wraps the points: rocks, roofs, wedges."""
        bm = self.bm
        verts = [bm.verts.new(p) for p in points]
        out = bmesh.ops.convex_hull(bm, input=verts, use_existing_faces=False)
        junk = list({g for g in out['geom_interior'] + out['geom_unused'] if isinstance(g, bmesh.types.BMVert)})
        if junk:
            bmesh.ops.delete(bm, geom=junk, context='VERTS')
        faces = [g for g in out['geom'] if isinstance(g, bmesh.types.BMFace) and g.is_valid]
        bmesh.ops.recalc_face_normals(bm, faces=faces)
        for f in faces:
            f.normal_update()
        self._paint(faces, colour, smooth)

    def poly(self, points, colour, both=False):
        """One flat face (a blade of grass, a flag). `both` adds its back, for one-sided drawing."""
        f = self.bm.faces.new([self.bm.verts.new(p) for p in points])
        f.normal_update()
        self._paint([f], colour)
        if both:
            g = self.bm.faces.new([self.bm.verts.new(p) for p in reversed(points)])
            g.normal_update()
            self._paint([g], colour)

    def finish(self):
        mesh = bpy.data.meshes.new(self.name)
        self.bm.to_mesh(mesh)
        self.bm.free()
        mesh.color_attributes.active_color = mesh.color_attributes['Col']
        mesh.color_attributes.render_color_index = 0
        mesh.materials.append(MATERIAL())
        obj = bpy.data.objects.new(self.name, mesh)
        bpy.context.scene.collection.objects.link(obj)
        return obj

    def triangles(self):
        return sum(len(f.verts) - 2 for f in self.bm.faces)


_material = None


def MATERIAL():
    """The one material every piece shares (the game uses its own; this just carries the painted colours)."""
    global _material
    if _material is None:
        _material = bpy.data.materials.new('Scenery')
        _material.use_nodes = True
        bsdf = _material.node_tree.nodes.get('Principled BSDF')
        bsdf.inputs['Roughness'].default_value = 0.9
        bsdf.inputs['Metallic'].default_value = 0.0
    return _material


def by_height(low, high, z0, z1):
    """A colour that runs from `low` at height z0 to `high` at z1."""
    return lambda co, n: mix(low, high, (co.z - z0) / (z1 - z0))


def lit(base, tip, dark):
    """Foliage: lighter where a face looks up, darker underneath."""
    return lambda co, n: mix(dark, mix(base, tip, max(0.0, n.z)), 0.5 + 0.5 * min(1.0, n.z + 0.6))


# --- Trees ----------------------------------------------------------------------

def spruce(name, seed, height, spread, tiers, snow=False, club=False, ragged=0.25, far=False):
    """A boreal spruce: a thin trunk and tiers of drooping branches, wide at
    the bottom and narrowing to a spike. `club` gives the black spruce's
    dense knot at the top; `snow` paints the top of every tier white. `far`
    is the cheap one for the hills, where a forest is hundreds of trees and
    each is a few pixels: three-pointed tiers and fewer of them."""
    it = Item(name, seed)
    rng = it.rng
    lean = (rng.uniform(-0.02, 0.02) * height, rng.uniform(-0.02, 0.02) * height)
    it.loft([((0, 0, 0), 0.045 * height ** 0.5 * 0.6, None), ((lean[0] * 0.5, lean[1] * 0.5, height * 0.5), 0.02 * height ** 0.5, None),
             ((lean[0], lean[1], height * 0.97), 0.004, None)], by_height(C['barkDark'], C['bark'], 0, height), cap=False)
    bm = it.bm
    start = 0.16 + rng.uniform(0, 0.06)
    for i in range(tiers):
        u = i / (tiers - 1)
        z = height * (start + (0.9 - start) * u ** 0.9)
        # The widest tier is a little way up, like a real spruce's skirt.
        width = spread * (1 - u) ** 0.85 * (0.75 + 0.25 * min(1.0, u * 5 + 0.4))
        if club and u > 0.72:
            width = spread * 0.3 * (1.15 - u)
        width = max(width, spread * 0.07) * (1 + rng.uniform(-ragged, ragged) * 0.6)
        tall = height * (0.9 - start) / tiers * 1.9
        droop = tall * (0.5 - 0.3 * u)
        cx, cy = lean[0] * (z / height), lean[1] * (z / height)
        points = 3 if far else 7 if width > spread * 0.4 else 5
        turn = rng.uniform(0, TAU)
        apex = bm.verts.new((cx, cy, z + tall))
        under = bm.verts.new((cx, cy, z + tall * 0.18))
        ring = []
        for k in range(points * 2):
            a = turn + TAU * k / (points * 2)
            tip = k % 2 == 0
            rr = width * (1.0 if tip else 0.62) * (1 + rng.uniform(-ragged, ragged))
            ring.append(bm.verts.new((cx + rr * math.cos(a), cy + rr * math.sin(a), z - (droop if tip else droop * 0.25))))
        top, bottom = [], []
        for k in range(len(ring)):
            k2 = (k + 1) % len(ring)
            top.append(bm.faces.new([apex, ring[k], ring[k2]]))
            bottom.append(bm.faces.new([under, ring[k2], ring[k]]))
        bmesh.ops.recalc_face_normals(bm, faces=top + bottom)
        for f in top + bottom:
            f.normal_update()
        tone = 1 + rng.uniform(-0.1, 0.1)
        base, tip_c = shade(C['spruce'], tone), shade(C['spruceTip'], tone)

        def top_colour(co, n, cx=cx, cy=cy, width=width, base=base, tip_c=tip_c):
            out = min(1.0, math.hypot(co.x - cx, co.y - cy) / max(width, 1e-4))
            c = mix(base, tip_c, out ** 1.5)
            if snow:
                # Snow sits on the branches and thins towards the tips.
                c = mix(C['snow'], mix(C['snowShade'], c, out ** 3), out ** 2 * 0.7)
            return c

        it._paint(top, top_colour)
        it._paint(bottom, C['spruceDark'])
    return it


def pine(name, seed, height):
    """A tall pine: a bare trunk that turns orange towards the top and a few flat clumps of needles."""
    it = Item(name, seed)
    rng = it.rng
    bend = rng.uniform(-0.05, 0.05) * height
    top = (bend, bend * 0.5, height * 0.8)

    def bark(co, n):
        return mix(C['bark'], C['pineBark'], (co.z / height - 0.3) * 2.2)

    it.loft([((0, 0, 0), 0.02 * height + 0.05, None), ((bend * 0.3, 0, height * 0.35), 0.014 * height + 0.03, None),
             (top, 0.008 * height + 0.02, None)], bark, cap=False)
    foliage = lit(C['pine'], C['pineTip'], C['spruceDark'])
    for k in range(rng.randint(3, 4)):
        a = rng.uniform(0, TAU)
        out = height * rng.uniform(0.06, 0.16) * (0 if k == 0 else 1)
        z = height * (0.9 - k * 0.07) + rng.uniform(-0.3, 0.3)
        centre = (top[0] + out * math.cos(a), top[1] + out * math.sin(a), z)
        if k:
            it.tube((top[0], top[1], z - height * 0.08), centre, 0.035, bark, sides=4, r2=0.02, caps=False)
        w = height * rng.uniform(0.13, 0.19)
        it.blob(centre, (w, w, w * 0.42), foliage, jitter=0.22)
    # A dead stub or two on the bare trunk.
    for k in range(2):
        a = rng.uniform(0, TAU)
        z = height * rng.uniform(0.35, 0.6)
        it.tube((bend * 0.3, 0, z), (bend * 0.3 + 0.5 * math.cos(a), 0.5 * math.sin(a), z + 0.15), 0.025,
                C['barkDark'], sides=3, r2=0.008, caps=False)
    return it


def birch(name, seed, height, leaves='leaf', bare=False, stems=1):
    """A birch: a pale trunk with dark bands, a few twigs and a light, open crown."""
    it = Item(name, seed)
    rng = it.rng
    palette = {'leaf': (C['leaf'], C['leafTip'], C['leafDark']), 'gold': (C['gold'], C['goldTip'], C['goldDark'])}[leaves]
    foliage = lit(*palette)
    for stem in range(stems):
        h = height * (1 if stem == 0 else rng.uniform(0.7, 0.9))
        a0 = rng.uniform(0, TAU)
        splay = 0 if stems == 1 else 0.12 * h
        base = (0.12 * stem * math.cos(a0), 0.12 * stem * math.sin(a0), 0)
        sway = (rng.uniform(-0.05, 0.05) * h + splay * math.cos(a0), rng.uniform(-0.05, 0.05) * h + splay * math.sin(a0))
        r0 = 0.012 * h + 0.035
        rings = []
        sections = 6
        for i in range(sections + 1):
            u = i / sections
            c = (base[0] + sway[0] * u * u, base[1] + sway[1] * u * u, h * 0.86 * u)
            r = r0 * (1 - 0.8 * u)
            # Dark at the foot, then pale with a thin dark band at every joint.
            rings.append((c, r, C['birchBand'] if i == 0 else shade(C['birch'], 1 - 0.06 * rng.random())))
            if 0 < i < sections:
                rings.append(((c[0], c[1], c[2] + 0.02 * h), r * 0.99, C['birchBand']))
                rings.append(((c[0], c[1], c[2] + 0.02 * h + 0.035 + 0.02 * rng.random()), r * 0.98,
                              shade(C['birch'], 1 - 0.06 * rng.random())))
        rings[0] = (rings[0][0], rings[0][1] * 1.25, C['birchBand'])
        it.loft(rings, C['birch'], cap=False)
        head = V(rings[-1][0])
        # Twigs up and out, each with a clump of leaves at its end.
        n = rng.randint(4, 5) if stem == 0 else 3
        for k in range(n):
            a = a0 + TAU * k / n + rng.uniform(-0.4, 0.4)
            u = rng.uniform(0.55, 0.9)
            start = V((base[0] + sway[0] * u * u, base[1] + sway[1] * u * u, h * 0.86 * u))
            reach = h * rng.uniform(0.1, 0.2)
            end = start + V((reach * math.cos(a), reach * math.sin(a), h * rng.uniform(0.08, 0.2)))
            it.tube(start, end, r0 * 0.3, C['birchTwig'], sides=3, r2=0.008, caps=False)
            if bare:
                # Winter: fine twigs instead of leaves.
                for j in range(2):
                    b = a + rng.uniform(-0.9, 0.9)
                    it.tube(end, end + V((reach * 0.6 * math.cos(b), reach * 0.6 * math.sin(b), h * 0.1)), 0.012,
                            C['birchTwig'], sides=3, r2=0.003, caps=False)
            else:
                w = h * rng.uniform(0.09, 0.14)
                it.blob(tuple(end + V((0, 0, w * 0.3))), (w, w, w * 0.75), foliage, jitter=0.25)
        if bare:
            it.tube(head, head + V((0, 0, h * 0.14)), r0 * 0.2, C['birchTwig'], sides=3, r2=0.003, caps=False)
        else:
            w = h * 0.12
            it.blob(tuple(head + V((0, 0, w * 0.6))), (w, w, w * 0.9), foliage, jitter=0.25)
    return it


def snag(name, seed, height):
    """A dead spruce: a grey trunk with a few broken stubs."""
    it = Item(name, seed)
    rng = it.rng
    grey = by_height(C['woodDark'], C['woodGrey'], 0, height)
    it.loft([((0, 0, 0), 0.16, None), ((0.05, 0.02, height * 0.5), 0.09, None), ((0.12, 0.0, height), 0.03, None)], grey)
    for k in range(6):
        a = rng.uniform(0, TAU)
        z = height * rng.uniform(0.3, 0.92)
        reach = rng.uniform(0.3, 0.9) * (1.1 - z / height)
        it.tube((0.06, 0.01, z), (0.06 + reach * math.cos(a), reach * math.sin(a), z - reach * 0.25), 0.03, grey,
                sides=3, r2=0.006, caps=False)
    return it


# --- Rocks and ground cover ------------------------------------------------------

def rock(name, seed, size, flat=0.6, points=16):
    """A lump of granite: grey faces, lichen where it looks at the sky, dark underneath."""
    it = Item(name, seed)
    rng = it.rng
    pts = []
    for _ in range(points):
        a, b = rng.uniform(0, TAU), rng.uniform(-0.2, 1.0)
        rr = math.sqrt(max(0.0, 1 - b * b)) * rng.uniform(0.7, 1.0)
        pts.append((size[0] * rr * math.cos(a), size[1] * rr * math.sin(a), size[2] * flat * (b + 0.25)))
    tone = 1 + rng.uniform(-0.08, 0.08)

    def colour(co, n):
        c = shade(mix(C['graniteDark'], C['granite'], 0.5 + 0.5 * n.z), tone * (0.94 + 0.12 * rng.random()))
        if n.z > 0.75:
            c = mix(c, C['lichen'], 0.55)
        elif n.z > 0.45 and rng.random() < 0.4:
            c = mix(c, C['graniteLight'], 0.5)
        return c

    it.hull(pts, colour)
    return it


def shrub(name, seed, size, base, tip, dark, clumps=4):
    it = Item(name, seed)
    rng = it.rng
    foliage = lit(base, tip, dark)
    for k in range(clumps):
        a = TAU * k / clumps + rng.uniform(-0.5, 0.5)
        out = size * rng.uniform(0.15, 0.5) * (0 if k == 0 else 1)
        w = size * rng.uniform(0.35, 0.55)
        it.blob((out * math.cos(a), out * math.sin(a), w * 0.55), (w, w, w * rng.uniform(0.6, 0.85)), foliage, jitter=0.28)
    return it


def heather(name, seed):
    """A low mound of heather: brown underneath, purple on top."""
    it = Item(name, seed)
    rng = it.rng

    def colour(co, n):
        return mix(C['heatherDark'], mix(C['heather'], C['heatherTip'], rng.random()), max(0.0, n.z) ** 0.6)

    for k in range(3):
        a = TAU * k / 3 + rng.uniform(-0.4, 0.4)
        out = 0.28 * (0 if k == 0 else 1)
        w = rng.uniform(0.3, 0.45)
        it.blob((out * math.cos(a), out * math.sin(a), 0.05), (w, w, w * 0.5), colour, jitter=0.3)
    return it


def grass(name, seed, blades, height, spread, low, high, heads=None):
    """A tuft: thin blades fanning out from one spot, drawn from both sides."""
    it = Item(name, seed)
    rng = it.rng
    for k in range(blades):
        a = TAU * k / blades + rng.uniform(-0.3, 0.3)
        lean = spread * rng.uniform(0.3, 1.0)
        h = height * rng.uniform(0.6, 1.0)
        w = 0.035 + 0.02 * rng.random()
        across = V((-math.sin(a), math.cos(a), 0)) * w
        foot = V((0.04 * math.cos(a), 0.04 * math.sin(a), 0))
        tip = V((lean * math.cos(a), lean * math.sin(a), h))
        tone = 0.9 + 0.2 * rng.random()
        it.poly([foot - across, foot + across, tip], by_height(shade(low, tone), shade(high, tone), 0, h), both=True)
        if heads and rng.random() < 0.6:
            it.tube(tip - V((0, 0, h * 0.25)), tip + V((0, 0, 0.02)), 0.022, heads, sides=4, r2=0.012)
    return it


def fireweed(name, seed):
    """Fireweed: tall stalks with a spike of pink flowers. It grows wherever the ground's been disturbed, like a rally road's verge."""
    it = Item(name, seed)
    rng = it.rng
    for k in range(4):
        a = TAU * k / 4 + rng.uniform(-0.5, 0.5)
        out = rng.uniform(0.05, 0.22)
        h = rng.uniform(0.7, 1.15)
        foot = V((out * math.cos(a), out * math.sin(a), 0))
        top = foot + V((0.08 * math.cos(a), 0.08 * math.sin(a), h))
        mid = foot.lerp(top, 0.6)
        it.tube(foot, mid, 0.012, C['stalk'], sides=3, caps=False)
        # Narrow leaves up the stalk.
        for j in range(3):
            b = a + j * 2.1
            p = foot.lerp(mid, 0.3 + 0.3 * j)
            it.poly([p, p + V((0.12 * math.cos(b), 0.12 * math.sin(b), 0.05)), p + V((0, 0, 0.05))], C['stalk'], both=True)
        # The flower spike: a long pink diamond.
        w = 0.05
        it.loft([(tuple(mid), 0.012, None), (tuple(mid.lerp(top, 0.25)), w, None), (tuple(mid.lerp(top, 0.7)), w * 0.6, None),
                 (tuple(top), 0.004, None)], by_height(C['fireweedDark'], C['fireweed'], mid.z, top.z), cap=False)
    return it


def cotton_grass(name, seed):
    it = Item(name, seed)
    rng = it.rng
    for k in range(5):
        a = TAU * k / 5 + rng.uniform(-0.5, 0.5)
        out = rng.uniform(0.03, 0.2)
        h = rng.uniform(0.3, 0.5)
        foot = V((out * math.cos(a), out * math.sin(a), 0))
        top = foot + V((0.06 * math.cos(a), 0.06 * math.sin(a), h))
        it.tube(foot, top, 0.006, C['reed'], sides=3, caps=False)
        it.blob(tuple(top), (0.04, 0.04, 0.035), C['cotton'], jitter=0.2)
    return it


def stump(name, seed):
    it = Item(name, seed)
    it.loft([((0, 0, 0), 0.26, C['barkDark']), ((0, 0, 0.08), 0.2, C['bark']), ((0.01, 0, 0.42), 0.17, C['woodPale'])], C['bark'])
    return it


def log(name, seed):
    """A fallen birch, lying along X."""
    it = Item(name, seed)
    rng = it.rng
    x = -1.6
    r = 0.13
    while x < 1.6:
        step = rng.uniform(0.35, 0.6)
        it.tube((x, 0, r), (min(1.6, x + step), 0, r * 0.98), r, shade(C['birch'], 0.9 + 0.1 * rng.random()), sides=6, caps=True)
        it.tube((min(1.6, x + step) - 0.03, 0, r), (min(1.6, x + step), 0, r), r * 1.01, C['birchBand'], sides=6, caps=False)
        x += step
        r *= 0.97
    it.tube((0.4, 0, 0.14), (0.7, 0.35, 0.5), 0.035, C['birchTwig'], sides=3, r2=0.01, caps=False)
    return it


def cairn(name, seed):
    """A waymarker: stones piled into a cone."""
    it = Item(name, seed)
    rng = it.rng
    z = 0.0
    w = 0.42
    for k in range(6):
        h = rng.uniform(0.12, 0.18)
        pts = []
        for _ in range(9):
            a = rng.uniform(0, TAU)
            pts.append((w * rng.uniform(0.7, 1) * math.cos(a), w * rng.uniform(0.7, 1) * math.sin(a), z + h * rng.random()))
        tone = 0.85 + 0.3 * rng.random()
        it.hull(pts, lambda co, n, tone=tone: shade(mix(C['graniteDark'], C['granite'], 0.5 + 0.5 * n.z), tone))
        z += h * 0.8
        w *= 0.78
    return it


# --- Walls, gates and the roadside -------------------------------------------------

def dry_stone_wall(name, seed, length=4.0, height=1.05):
    """A length of dry-stone wall along X: courses of stones with a row of coping stones on edge on top."""
    it = Item(name, seed)
    rng = it.rng
    courses = 3
    for c in range(courses):
        z0 = height * 0.82 * c / courses
        z1 = height * 0.82 * (c + 1) / courses
        half = 0.3 - 0.07 * c / courses
        x = -length / 2
        while x < length / 2 - 0.01:
            step = min(rng.uniform(0.5, 1.0), length / 2 - x)
            tone = 0.82 + 0.3 * rng.random()
            col = shade(mix(C['granite'], C['graniteLight'], rng.random() * 0.5), tone)
            gap = 0.012
            it.hull([(x + gap, -half, z0 + gap), (x + step - gap, -half, z0 + gap), (x + gap, half, z0 + gap), (x + step - gap, half, z0 + gap),
                     (x + gap * 2, -half + 0.02, z1), (x + step - gap * 2, -half + 0.02, z1), (x + gap * 2, half - 0.02, z1),
                     (x + step - gap * 2, half - 0.02, z1)],
                    lambda co, n, col=col: mix(col, C['lichen'], 0.4) if n.z > 0.8 else shade(col, 0.8 + 0.2 * abs(n.y)))
            x += step
    # Coping stones on edge, leaning a little.
    x = -length / 2
    while x < length / 2 - 0.05:
        step = min(rng.uniform(0.24, 0.4), length / 2 - x)
        tone = 0.8 + 0.3 * rng.random()
        top = height + rng.uniform(-0.03, 0.05)
        it.hull([(x + 0.01, -0.2, height * 0.82), (x + step - 0.01, -0.2, height * 0.82), (x + 0.01, 0.2, height * 0.82),
                 (x + step - 0.01, 0.2, height * 0.82), (x + 0.03, -0.12, top), (x + step, -0.12, top), (x + 0.03, 0.12, top),
                 (x + step, 0.12, top)], shade(C['granite'], tone))
        x += step
    return it


def gate(name, seed):
    """A five-bar field gate between two stone posts, along X."""
    it = Item(name, seed)
    for sd in (-1, 1):
        it.hull([(sd * 1.65 - 0.17, -0.17, 0), (sd * 1.65 + 0.17, -0.17, 0), (sd * 1.65 - 0.17, 0.17, 0), (sd * 1.65 + 0.17, 0.17, 0),
                 (sd * 1.65 - 0.13, -0.13, 1.35), (sd * 1.65 + 0.13, -0.13, 1.35), (sd * 1.65 - 0.13, 0.13, 1.35),
                 (sd * 1.65 + 0.13, 0.13, 1.35), (sd * 1.65, 0, 1.45)], lambda co, n: shade(C['granite'], 0.8 + 0.25 * abs(n.y)))
    for k in range(5):
        z = 0.25 + k * 0.2 + (0.03 * k)
        it.box((0, 0, z), (3.0, 0.035, 0.085), shade(C['woodGrey'], 0.9 + 0.04 * k))
    for x in (-1.46, 0, 1.46):
        it.box((x, 0.03, 0.72), (0.085, 0.035, 1.05), C['woodGrey'])
    for sd in (-1, 1):
        a = math.atan2(0.86, 1.4)
        it.box((sd * 0.73, -0.03, 0.72), (1.68, 0.03, 0.075), shade(C['woodGrey'], 0.92), rot=Matrix.Rotation(-sd * a, 3, 'Y'))
    return it


def marker_post(name, seed):
    """A roadside marker post: weathered wood with a pink band and a white reflector, both faces."""
    it = Item(name, seed)
    it.hull([(-0.05, -0.05, 0), (0.05, -0.05, 0), (-0.05, 0.05, 0), (0.05, 0.05, 0), (-0.05, -0.05, 1.05), (0.05, -0.05, 1.05),
             (-0.05, 0.05, 1.12), (0.05, 0.05, 1.12)], by_height(C['woodDark'], C['woodGrey'], 0, 1.1))
    it.box((0, 0, 0.9), (0.108, 0.108, 0.16), C['magenta'])
    it.box((0, 0, 0.74), (0.112, 0.112, 0.07), C['paper'])
    return it


def caution_board(name, seed, marks):
    """A roadbook caution board on two stakes, facing along the road (X):
    one, two or three exclamation marks, like the roadbook's own danger
    grades. Both faces are painted."""
    it = Item(name, seed)
    w, h, z = 0.95, 0.62, 1.15
    for sd in (-1, 1):
        it.box((0, sd * (w / 2 - 0.08), (z + h / 2) / 2), (0.045, 0.045, z + h / 2), C['woodGrey'])
    it.box((0.03, 0, z), (0.02, w, h), C['paper'])
    it.box((0.03, 0, z), (0.014, w + 0.05, h + 0.05), C['graphite'])
    for face in (-1, 1):
        x = 0.03 + face * 0.012
        for k in range(marks):
            y = (k - (marks - 1) / 2) * 0.24
            it.hull([(x, y - 0.045, z + 0.2), (x, y + 0.045, z + 0.2), (x, y - 0.022, z - 0.07), (x, y + 0.022, z - 0.07),
                     (x + face * 0.004, y - 0.045, z + 0.2), (x + face * 0.004, y + 0.045, z + 0.2),
                     (x + face * 0.004, y - 0.022, z - 0.07), (x + face * 0.004, y + 0.022, z - 0.07)], C['hot'])
            it.box((x, y, z - 0.17), (0.008, 0.075, 0.075), C['hot'])
        # A pink highlighter stripe along the foot of the board, like a marked-up roadbook.
        it.box((x, 0, z - h / 2 + 0.045), (0.006, w - 0.06, 0.035), C['magenta'])
    return it


def truss(it, a, b, size, colour, bays):
    """A square lighting truss from a to b: four chords with zigzag bracing."""
    a, b = V(a), V(b)
    along = (b - a).normalized()
    side = along.cross(V((1, 0, 0)))
    if side.length < 0.1:
        side = along.cross(V((0, 1, 0)))
    side.normalize()
    up = along.cross(side)
    corners = [side * size + up * size, side * size - up * size, -side * size - up * size, -side * size + up * size]
    for c in corners:
        it.tube(a + c, b + c, 0.03, colour, sides=4, caps=False)
    for k in range(bays):
        p0 = a.lerp(b, k / bays)
        p1 = a.lerp(b, (k + 1) / bays)
        for j in range(4):
            c0, c1 = corners[j], corners[(j + 1) % 4]
            it.tube(p0 + (c0 if k % 2 == 0 else c1), p1 + (c1 if k % 2 == 0 else c0), 0.016, colour, sides=3, caps=False)


def arch(name, seed, half=5.2, height=5.4):
    """The test track's start line: a truss arch over the road (which runs
    along X) with a chequered header, pink end panels and weighted feet."""
    it = Item(name, seed)
    steel = C['steelDark']
    for sd in (-1, 1):
        truss(it, (0, sd * half, 0.25), (0, sd * half, height), 0.2, steel, 7)
        it.box((0, sd * half, 0.12), (1.3, 1.0, 0.24), C['concrete'])
        it.box((0, sd * half, 0.26), (0.9, 0.7, 0.05), C['hazard'])
        # A guy strap each way along the road.
        for fx in (-1, 1):
            it.tube((0, sd * half, height * 0.8), (fx * 2.4, sd * (half + 0.6), 0.05), 0.012, C['magenta'], sides=3, caps=False)
    truss(it, (0, -half, height), (0, half, height), 0.2, steel, 12)
    # The header: two rows of chequers, on both faces.
    cols = 20
    bw, bh = (2 * half - 1.4) / cols, 0.42
    for face in (-1, 1):
        x = face * 0.235
        for r in range(2):
            for c in range(cols):
                dark = (r + c) % 2 == 0
                y = -half + 0.7 + bw * (c + 0.5)
                it.box((x, y, height - 0.62 - r * bh), (0.012, bw, bh), C['graphite'] if dark else C['paper'])
        for sd in (-1, 1):
            it.box((x, sd * (half - 0.42), height - 0.83), (0.014, 0.5, 2 * bh), C['magenta'])
    it.box((0, 0, height - 0.83), (0.46, 2 * half - 0.3, 0.03), C['graphite'])
    # Timing beacons: a small amber lamp on top of each leg.
    for sd in (-1, 1):
        it.tube((0, sd * half, height + 0.2), (0, sd * half, height + 0.42), 0.09, C['amber'], sides=8)
    return it


def hut(name, seed):
    """The timing hut: a boarded shed with a tin roof, a wide window on the road and an aerial."""
    it = Item(name, seed)
    rng = it.rng
    w, d, h = 2.6, 2.1, 2.2
    # Vertical boards, each a slightly different brown.
    n = 13
    for k in range(n):
        y = -w / 2 + w * (k + 0.5) / n
        tone = 0.88 + 0.2 * rng.random()
        for x in (-d / 2, d / 2):
            it.box((x, y, h / 2), (0.04, w / n - 0.008, h), shade(C['wood'], tone))
    n = 10
    for k in range(n):
        x = -d / 2 + d * (k + 0.5) / n
        tone = 0.88 + 0.2 * rng.random()
        for y in (-w / 2, w / 2):
            it.box((x, y, h / 2), (d / n - 0.008, 0.04, h), shade(C['wood'], tone))
    # A tin roof sloping to the back, with ribs.
    it.hull([(-d / 2 - 0.2, -w / 2 - 0.2, h + 0.05), (-d / 2 - 0.2, w / 2 + 0.2, h + 0.05), (d / 2 + 0.25, -w / 2 - 0.2, h + 0.45),
             (d / 2 + 0.25, w / 2 + 0.2, h + 0.45), (-d / 2 - 0.2, -w / 2 - 0.2, h + 0.1), (-d / 2 - 0.2, w / 2 + 0.2, h + 0.1),
             (d / 2 + 0.25, -w / 2 - 0.2, h + 0.5), (d / 2 + 0.25, w / 2 + 0.2, h + 0.5)], C['tin'])
    for k in range(9):
        y = -w / 2 - 0.15 + (w + 0.3) * k / 8
        it.tube((-d / 2 - 0.2, y, h + 0.11), (d / 2 + 0.25, y, h + 0.51), 0.018, C['tinDark'], sides=3, caps=False)
    it.hull([(d / 2, -w / 2, h), (d / 2, w / 2, h), (d / 2, -w / 2, h + 0.42), (d / 2, w / 2, h + 0.42), (-d / 2, -w / 2, h),
             (-d / 2, w / 2, h), (-d / 2, -w / 2, h + 0.06), (-d / 2, w / 2, h + 0.06)], shade(C['wood'], 0.85))
    # The window on the road side (the +X face), with a sill and a warm lamp inside.
    it.box((d / 2 + 0.025, 0, 1.45), (0.02, 1.7, 0.7), C['glass'])
    it.box((d / 2 + 0.03, 0.45, 1.5), (0.02, 0.35, 0.3), C['glow'])
    it.box((d / 2 + 0.05, 0, 1.08), (0.12, 1.85, 0.05), C['woodPale'])
    for y in (-0.86, 0, 0.86):
        it.box((d / 2 + 0.035, y, 1.45), (0.03, 0.05, 0.74), C['woodPale'])
    # The door on the side, and a pink stripe so you can find it in a whiteout.
    it.box((0.1, -w / 2 - 0.025, 0.98), (0.8, 0.02, 1.9), C['woodDark'])
    it.box((0.4, -w / 2 - 0.04, 1.0), (0.04, 0.03, 0.1), C['steel'])
    it.box((0, 0, h - 0.12), (d + 0.1, w + 0.1, 0.12), C['magenta'])
    # Aerial mast and a clock board.
    it.tube((-d / 2 + 0.2, w / 2 - 0.2, h), (-d / 2 + 0.2, w / 2 - 0.2, h + 2.6), 0.02, C['steel'], sides=4)
    for k in range(3):
        z = h + 1.5 + k * 0.4
        it.tube((-d / 2 + 0.2, w / 2 - 0.5 + k * 0.08, z), (-d / 2 + 0.2, w / 2 + 0.1 - k * 0.08, z), 0.01, C['steel'], sides=3)
    it.box((d / 2 + 0.03, -0.95, 1.9), (0.03, 0.42, 0.3), C['graphite'])
    it.box((d / 2 + 0.047, -0.95, 1.9), (0.006, 0.3, 0.1), C['amber'])
    # Steps.
    it.box((0.1, -w / 2 - 0.3, 0.09), (0.9, 0.5, 0.18), C['woodPale'])
    return it


def tire_stack(name, seed):
    """Three old tires, the top one painted white with a pink band: a corner marker."""
    it = Item(name, seed)
    rng = it.rng
    for k in range(3):
        z = 0.12 + k * 0.23
        ox, oy = rng.uniform(-0.03, 0.03), rng.uniform(-0.03, 0.03)
        col = C['paper'] if k == 2 else C['rubber']
        it.loft([((ox, oy, z - 0.11), 0.26, None), ((ox, oy, z - 0.11), 0.36, None), ((ox, oy, z - 0.04), 0.4, None),
                 ((ox, oy, z + 0.04), 0.4, C['magenta'] if k == 2 else None), ((ox, oy, z + 0.11), 0.36, None),
                 ((ox, oy, z + 0.11), 0.26, None)], col, cap=False)
        it.tube((ox, oy, z - 0.1), (ox, oy, z + 0.1), 0.26, C['rubber'], sides=6, caps=False)
    return it


def pennant(name, seed):
    """A flag pole with a pink pennant, flying along +X."""
    it = Item(name, seed)
    it.tube((0, 0, 0), (0, 0, 3.4), 0.025, C['paperDim'], sides=5, r2=0.015)
    it.poly([(0, 0, 3.35), (0.95, 0.06, 3.02), (0, 0, 2.75)], C['magenta'], both=True)
    it.box((0, 0, 0.06), (0.3, 0.3, 0.12), C['concreteDark'])
    return it


def bale(name, seed):
    """A big round straw bale lying on its side (its axle along Y)."""
    it = Item(name, seed)
    rng = it.rng
    r, half = 0.62, 0.6
    bm = it.bm
    n = 12
    rings = []
    for y in (-half, half):
        rings.append([bm.verts.new((r * math.cos(TAU * k / n), y, r + r * math.sin(TAU * k / n))) for k in range(n)])
    faces = []
    for k in range(n):
        k2 = (k + 1) % n
        faces.append(bm.faces.new([rings[0][k], rings[0][k2], rings[1][k2], rings[1][k]]))
    ends = [bm.faces.new(rings[0]), bm.faces.new(rings[1])]
    bmesh.ops.recalc_face_normals(bm, faces=faces + ends)
    for f in faces + ends:
        f.normal_update()
    it._paint(faces, lambda co, n: shade(C['bale'], 0.9 + 0.15 * rng.random()), smooth=True)
    it._paint(ends, C['baleDark'])
    for y in (-0.3, 0.3):
        it.tube((0, y - 0.015, r), (0, y + 0.015, r), r + 0.006, C['paper'], sides=n, caps=False)
    return it


def power_pole(name, seed):
    it = Item(name, seed)
    grey = by_height(C['woodDark'], C['woodGrey'], 0, 8)
    it.loft([((0, 0, 0), 0.15, None), ((0.02, 0, 4), 0.12, None), ((0.04, 0, 8.2), 0.09, None)], grey)
    it.box((0.04, 0, 7.6), (0.1, 1.9, 0.11), C['woodDark'])
    it.box((0.04, 0, 7.25), (0.06, 0.06, 0.8), C['woodDark'], rot=Matrix.Rotation(0.75, 3, 'X'))
    for y in (-0.85, 0, 0.85):
        it.tube((0.04, y, 7.66), (0.04, y, 7.86), 0.035, C['cotton'], sides=5, r2=0.02)
    it.box((0.1, 0, 2.0), (0.02, 0.16, 0.22), C['hazard'])
    return it


def bothy(name, seed):
    """A stone bothy: thick walls, a slate roof, a chimney, a blue door and a lit window."""
    it = Item(name, seed)
    rng = it.rng
    w, d, h, ridge = 5.6, 3.8, 2.3, 3.9
    # Walls as courses of blocks, each its own grey.
    for face, (length, fixed, along) in {'front': (w, -d / 2, 'x'), 'back': (w, d / 2, 'x'), 'left': (d, -w / 2, 'y'),
                                         'right': (d, w / 2, 'y')}.items():
        courses = 6
        for c in range(courses):
            z0, z1 = h * c / courses, h * (c + 1) / courses
            p = -length / 2
            while p < length / 2 - 0.01:
                step = min(rng.uniform(0.5, 1.1), length / 2 - p)
                tone = 0.8 + 0.3 * rng.random()
                col = shade(mix(C['granite'], C['graniteLight'], 0.4 * rng.random()), tone)
                if along == 'x':
                    it.box((p + step / 2, fixed, (z0 + z1) / 2), (step - 0.02, 0.5, z1 - z0 - 0.015), col)
                else:
                    it.box((fixed, p + step / 2, (z0 + z1) / 2), (0.5, step - 0.02, z1 - z0 - 0.015), col)
                p += step
    # Gables and the slate roof.
    for sd in (-1, 1):
        it.hull([(sd * (w / 2 - 0.25), -d / 2, h), (sd * (w / 2 - 0.25), d / 2, h), (sd * (w / 2 + 0.25), -d / 2, h),
                 (sd * (w / 2 + 0.25), d / 2, h), (sd * (w / 2 - 0.25), 0, ridge - 0.1), (sd * (w / 2 + 0.25), 0, ridge - 0.1)],
                shade(C['granite'], 0.92))
    rows = 7
    for sd in (-1, 1):
        for r in range(rows):
            u0, u1 = r / rows, (r + 1) / rows
            y0, y1 = sd * (d / 2 + 0.3) * (1 - u0), sd * (d / 2 + 0.3) * (1 - u1)
            z0 = h - 0.12 + (ridge - h + 0.12) * u0
            z1 = h - 0.12 + (ridge - h + 0.12) * u1
            tone = 0.88 + 0.22 * rng.random()
            it.hull([(-w / 2 - 0.35, y0, z0), (w / 2 + 0.35, y0, z0), (-w / 2 - 0.35, y1, z1 + 0.03), (w / 2 + 0.35, y1, z1 + 0.03),
                     (-w / 2 - 0.35, y0, z0 + 0.06), (w / 2 + 0.35, y0, z0 + 0.06), (-w / 2 - 0.35, y1, z1 + 0.09),
                     (w / 2 + 0.35, y1, z1 + 0.09)], shade(mix(C['slate'], C['slateLight'], rng.random()), tone))
    it.box((0, 0, ridge + 0.04), (w + 0.8, 0.22, 0.1), C['slate'])
    # Chimney at one end, with a pot.
    it.box((w / 2 - 0.3, 0, ridge + 0.35), (0.6, 0.7, 1.0), shade(C['granite'], 0.9))
    it.tube((w / 2 - 0.3, 0, ridge + 0.85), (w / 2 - 0.3, 0, ridge + 1.15), 0.13, C['pineBark'], sides=6, r2=0.1)
    # The door and two small windows on the front (the -Y face).
    y = -d / 2 - 0.26
    it.box((-0.5, y, 0.98), (0.95, 0.03, 1.95), C['cool'])
    it.box((-0.5, y + 0.005, 2.02), (1.2, 0.05, 0.16), C['graniteLight'])
    it.box((-0.18, y - 0.02, 1.0), (0.05, 0.03, 0.12), C['graphite'])
    for x, glow in ((1.4, True), (-2.0, False)):
        it.box((x, y, 1.4), (0.8, 0.03, 0.85), C['glow'] if glow else C['glass'])
        it.box((x, y - 0.012, 1.4), (0.05, 0.03, 0.85), C['paper'])
        it.box((x, y - 0.012, 1.4), (0.8, 0.03, 0.05), C['paper'])
        it.box((x, y + 0.005, 0.93), (1.0, 0.09, 0.1), C['graniteLight'])
    # A stack of peat or logs by the door.
    for k in range(3):
        for j in range(3 - k):
            it.tube((-1.75 + j * 0.24 + k * 0.12, y - 0.5, 0.12 + k * 0.2), (-1.75 + j * 0.24 + k * 0.12, y - 0.05, 0.12 + k * 0.2),
                    0.11, shade(C['wood'], 0.85 + 0.2 * rng.random()), sides=6)
    return it


# --- The horizon and the sky ---------------------------------------------------------

def noise1(rng, n):
    """`n` smooth random numbers round a circle (they join up), 0 to 1."""
    knots = [rng.random() for _ in range(n)]

    def at(u):
        p = (u % 1.0) * n
        i = int(p)
        f = p - i
        f = f * f * (3 - 2 * f)
        return knots[i % n] * (1 - f) + knots[(i + 1) % n] * f

    return at


def ridge(name, seed, low, high, segments, trees, bumps):
    """A ring of hills round the whole horizon, one unit in radius (the game
    scales it). Its top edge is the skyline; `trees` adds a jagged line of
    spruce tips, as on the nearest ridge."""
    it = Item(name, seed)
    rng = it.rng
    big = noise1(rng, bumps)
    small = noise1(rng, bumps * 4)
    bm = it.bm
    top, mid, bottom = [], [], []
    for k in range(segments):
        u = k / segments
        a = TAU * u
        h = low + (high - low) * (0.65 * big(u) + 0.35 * small(u))
        if trees:
            # Spruce tips: every other point pokes up.
            h += trees * (rng.uniform(0.5, 1.0) if k % 2 == 0 else rng.uniform(0.0, 0.3))
        x, y = math.cos(a), math.sin(a)
        top.append(bm.verts.new((x, y, h)))
        mid.append(bm.verts.new((x, y, h * 0.35)))
        bottom.append(bm.verts.new((x, y, -0.06)))
    upper, lower = [], []
    for k in range(segments):
        k2 = (k + 1) % segments
        # Facing inwards: the camera stands in the middle.
        upper.append(bm.faces.new([mid[k], mid[k2], top[k2], top[k]]))
        lower.append(bm.faces.new([bottom[k], bottom[k2], mid[k2], mid[k]]))
    for f in upper + lower:
        f.normal_update()
    # White at the skyline shading to a soft grey at the foot: the game tints
    # the whole ring, so the foot sinks into the haze.
    it._paint(upper + lower, lambda co, n: (1, 1, 1) if co.z > 0 else (0.86, 0.86, 0.86))
    return it


def cloud(name, seed, puffs):
    """A low cloud with a flat bottom, about one unit long (the game scales it)."""
    it = Item(name, seed)
    rng = it.rng

    def colour(co, n):
        return mix((0.82, 0.83, 0.85), (1, 1, 1), 0.5 + 0.5 * n.z)

    for k in range(puffs):
        u = (k + 0.5) / puffs - 0.5
        w = rng.uniform(0.16, 0.26) * (1 - abs(u) * 0.9)
        it.blob((u * 0.95, rng.uniform(-0.05, 0.05), w * 0.45), (w * 1.25, w, w * 0.7), colour, jitter=0.16)
    # Slice the bottom flat.
    geom = it.bm.verts[:] + it.bm.edges[:] + it.bm.faces[:]
    bmesh.ops.bisect_plane(it.bm, geom=geom, plane_co=(0, 0, 0.02), plane_no=(0, 0, -1), clear_outer=True)
    edges = [e for e in it.bm.edges if e.is_boundary]
    made = bmesh.ops.holes_fill(it.bm, edges=edges, sides=0)
    for f in made['faces']:
        f.normal_update()
    it._paint(made['faces'], (0.78, 0.8, 0.83))
    return it


# --- The workshop round the shaker rig ------------------------------------------------

def shop(name, seed):
    """The shaker rig's workshop: a painted block wall with tin above and
    high windows, a roller door at one end, and the clutter of a rally
    shop along the back wall. The truck stands at the origin, nose to +X, on
    posts 0.6 m above the floor. The cameras all sit on the truck's left (+Y),
    so that side stays open; the hall is long enough for the heavy truck's
    cameras to stand inside its end walls. The floor is the game's own (it
    follows the page's light and dark colours).

    It is drawn here with the back wall at +Y and turned round at the end."""
    it = Item(name, seed)
    rng = it.rng
    back, x0, x1, top, floor = 6.5, -14.0, 17.0, 6.2, -0.6
    span = x1 - x0

    # The back wall: blockwork to 1.6 m in two greys, tin sheet above.
    def blocks(co, n):
        return shade(C['block'], 0.94 + 0.06 * rng.random())

    it.box(((x0 + x1) / 2, back + 0.1, floor + 0.8), (span, 0.2, 1.6), blocks)
    it.box(((x0 + x1) / 2, back - 0.005, floor + 1.63), (span, 0.03, 0.07), C['magenta'])
    sheets = int(span * 2)
    for k in range(sheets):
        x = x0 + span * (k + 0.5) / sheets
        it.box((x, back + 0.08 + (0.03 if k % 2 else 0), floor + 1.6 + (top - 1.6) / 2), (span / sheets, 0.06, top - 1.6),
               shade(C['tin'], 0.97 if k % 2 else 1.04))
    # High windows, glowing with daylight.
    for k in range(7):
        x = x0 + span * (k + 0.5) / 7
        it.box((x, back + 0.02, floor + 4.3), (2.6, 0.04, 1.2), C['glow'])
        it.box((x, back + 0.0, floor + 4.3), (0.06, 0.05, 1.2), C['steelDark'])
        it.box((x, back + 0.0, floor + 4.3), (2.6, 0.05, 0.06), C['steelDark'])
        it.box((x, back + 0.0, floor + 3.67), (2.76, 0.07, 0.07), C['steelDark'])
        it.box((x, back + 0.0, floor + 4.93), (2.76, 0.07, 0.07), C['steelDark'])
    # Steel columns and a roof beam.
    for k in range(6):
        x = x0 + span * k / 5
        it.box((min(max(x, x0 + 0.15), x1 - 0.15), back - 0.12, floor + top / 2), (0.24, 0.24, top), C['steelDark'])
    it.box(((x0 + x1) / 2, back - 0.12, floor + top - 0.2), (span, 0.2, 0.36), C['steelDark'])

    # The end walls. +X: a big roller door, half open on the daylight. -X: shelving.
    for x, sd in ((x1, 1), (x0, -1)):
        it.box((x + sd * 0.1, (back - 9) / 2, floor + 0.8), (0.2, back + 9, 1.6), blocks)
        it.box((x + sd * 0.08, (back - 9) / 2, floor + 1.6 + (top - 1.6) / 2), (0.06, back + 9, top - 1.6), shade(C['tin'], 0.95))
    door_y, door_w, door_h = -1.0, 5.2, 4.4
    it.box((x1 - 0.02, door_y, floor + door_h / 2), (0.06, door_w + 0.4, door_h + 0.2), C['steelDark'])
    it.box((x1 - 0.06, door_y, floor + 1.25), (0.05, door_w, 2.5), C['glow'])
    slats = 9
    for k in range(slats):
        z = floor + 2.5 + (door_h - 2.5) * (k + 0.5) / slats
        it.box((x1 - 0.08, door_y, z), (0.06, door_w, (door_h - 2.5) / slats - 0.02), shade(C['paperDim'], 0.9 if k % 2 else 1.0))
    it.box((x1 - 0.1, door_y, floor + 2.5), (0.1, door_w, 0.1), C['hazard'])

    # Along the back wall, left to right: tire rack, bench with a vice, tool chest, drums, the rig's console.
    y = back - 0.55
    # Tire rack: two shelves of tires on edge.
    rx = -8.2
    for z in (0.5, 1.55):
        it.box((rx, y, floor + z), (3.2, 0.9, 0.06), C['steelDark'])
        for k in range(5):
            cx = rx - 1.25 + k * 0.62
            it.loft([((0, 0, 0), 0.2, None), ((0, 0, 0), 0.44, None), ((0, 0, 0.3), 0.44, None), ((0, 0, 0.3), 0.2, None)],
                    C['rubber'], cap=False)
            # (lofts are built along Z at the origin; turn this one onto its edge and move it into the rack)
            verts = it.bm.verts[-24:]
            bmesh.ops.rotate(it.bm, verts=verts, cent=(0, 0, 0), matrix=Matrix.Rotation(math.pi / 2, 3, 'Y'))
            bmesh.ops.translate(it.bm, verts=verts, vec=(cx - 0.15, y, floor + z + 0.47))
    for x in (rx - 1.6, rx + 1.6):
        it.box((x, y, floor + 1.15), (0.06, 0.9, 2.3), C['steelDark'])
    # Workbench with a vice, a lamp and boxes of springs.
    bx = -4.3
    it.box((bx, y, floor + 0.95), (3.0, 0.85, 0.08), C['woodPale'])
    for x in (bx - 1.4, bx + 1.4):
        for yy in (y - 0.36, y + 0.36):
            it.box((x, yy, floor + 0.46), (0.08, 0.08, 0.92), C['steelDark'])
    it.box((bx, y, floor + 0.3), (2.8, 0.75, 0.04), C['steelDark'])
    it.box((bx - 1.0, y - 0.25, floor + 1.09), (0.3, 0.16, 0.2), C['cool'])
    it.box((bx - 1.0, y - 0.38, floor + 1.14), (0.1, 0.14, 0.1), C['steel'])
    it.tube((bx - 1.0, y - 0.5, floor + 1.13), (bx - 1.0, y - 0.25, floor + 1.13), 0.015, C['steel'], sides=4)
    for k in range(3):
        it.tube((bx + 0.2 + k * 0.3, y, floor + 1.0), (bx + 0.2 + k * 0.3, y, floor + 1.42), 0.085, C['magenta'], sides=8, caps=False)
    it.box((bx + 1.15, y + 0.1, floor + 1.14), (0.5, 0.4, 0.3), C['wood'])
    # A pegboard over the bench with tool outlines.
    it.box((bx, back - 0.02, floor + 2.45), (2.8, 0.03, 1.2), C['paperDim'])
    for k in range(7):
        x = bx - 1.15 + k * 0.38
        it.box((x, back - 0.045, floor + 2.5 + 0.1 * (k % 3)), (0.06, 0.02, 0.5 - 0.08 * (k % 2)), C['steelDark'])
    # Tool chest: red drawers on castors. (Red is the trace's "over the limit" colour; here it's just a tool chest.)
    tx = -1.5
    it.box((tx, y, floor + 0.68), (1.3, 0.7, 1.1), C['hot'])
    for k in range(5):
        it.box((tx, y - 0.36, floor + 0.28 + k * 0.2), (1.2, 0.02, 0.16), shade(C['hot'], 0.8))
        it.box((tx, y - 0.375, floor + 0.33 + k * 0.2), (0.7, 0.02, 0.025), C['chrome'])
    it.box((tx, y, floor + 1.25), (1.34, 0.74, 0.05), C['graphite'])
    # Oil drums.
    for k, col in enumerate((C['cool'], C['graphite'], C['cool'])):
        dx = 0.7 + k * 0.72
        it.tube((dx, y + 0.05 * (k % 2), floor), (dx, y + 0.05 * (k % 2), floor + 0.9), 0.3, col, sides=12)
        for z in (0.3, 0.6):
            it.tube((dx, y + 0.05 * (k % 2), floor + z - 0.015), (dx, y + 0.05 * (k % 2), floor + z + 0.015), 0.312,
                    shade(col, 1.25), sides=12, caps=False)
    # The shaker's console: a desk with a slanted panel, screens and a red stop button, and a cable tray to the rig.
    cx = 5.0
    it.box((cx, y - 0.1, floor + 0.5), (1.5, 0.7, 1.0), C['paperDim'])
    it.hull([(cx - 0.75, y - 0.45, floor + 1.0), (cx + 0.75, y - 0.45, floor + 1.0), (cx - 0.75, y + 0.25, floor + 1.0),
             (cx + 0.75, y + 0.25, floor + 1.0), (cx - 0.75, y + 0.25, floor + 1.4), (cx + 0.75, y + 0.25, floor + 1.4)], C['graphite'])
    slope = Matrix.Rotation(math.atan2(0.4, 0.7), 3, 'X')
    for k in range(2):
        it.box((cx - 0.35 + k * 0.7, y - 0.11, floor + 1.215), (0.55, 0.5, 0.012), C['glow'] if k == 0 else C['cool'], rot=slope)
    it.tube((cx, y - 0.4, floor + 1.0), (cx, y - 0.4, floor + 1.07), 0.05, C['hot'], sides=8)
    it.box((cx, y - 0.9, floor + 0.03), (0.3, 3.2, 0.06), C['hazard'])
    # Hydraulic power pack with two hoses.
    px = 7.2
    it.box((px, y, floor + 0.55), (1.2, 0.8, 1.1), C['cool'])
    it.tube((px - 0.25, y, floor + 1.1), (px - 0.25, y, floor + 1.5), 0.16, C['steel'], sides=8)
    it.box((px + 0.3, y - 0.41, floor + 0.8), (0.3, 0.02, 0.3), C['paper'])
    for k in range(2):
        it.tube((px - 0.5 + k * 0.15, y - 0.4, floor + 0.2), (px - 2.0, y - 2.4, floor + 0.04), 0.035, C['graphite'], sides=5, caps=False)
    # A hazard box painted on the floor round the rig, and a stripe to the door.
    for yy in (-2.2, 2.2):
        it.box((0, yy, floor + 0.004), (9.0, 0.12, 0.008), C['hazard'])
    for xx in (-4.5, 4.5):
        it.box((xx, 0, floor + 0.004), (0.12, 4.52, 0.008), C['hazard'])
    # Roadbook pages pinned to the wall, and a clock.
    for k in range(4):
        it.box((8.6 + (k % 2) * 0.5, back - 0.03, floor + 2.0 + (k // 2) * 0.62), (0.42, 0.02, 0.56), C['paper'])
        it.box((8.6 + (k % 2) * 0.5, back - 0.045, floor + 1.9 + (k // 2) * 0.62), (0.3, 0.01, 0.04), C['magenta'])
    it.tube((2.6, back - 0.02, floor + 3.0), (2.6, back - 0.08, floor + 3.0), 0.32, C['paper'], sides=14)
    it.box((2.6, back - 0.09, floor + 3.1), (0.03, 0.01, 0.22), C['graphite'])
    it.box((2.68, back - 0.09, floor + 3.0), (0.18, 0.01, 0.03), C['graphite'])
    # Strip lights hanging over the rig.
    for x in (-4.0, 0.0, 4.0):
        it.box((x, 1.5, floor + top - 0.9), (2.4, 0.22, 0.08), C['glow'])
        it.box((x, 1.5, floor + top - 0.84), (2.5, 0.3, 0.05), C['steelDark'])
        for dx in (-1.0, 1.0):
            it.tube((x + dx, 1.5, floor + top - 0.8), (x + dx, 1.5, floor + top), 0.01, C['steelDark'], sides=3, caps=False)
    # A jack and two axle stands by the wall.
    it.box((-6.2, 3.6, floor + 0.12), (1.1, 0.4, 0.16), C['hot'])
    it.tube((-6.6, 3.6, floor + 0.2), (-7.5, 3.6, floor + 0.75), 0.02, C['graphite'], sides=4)
    for k in range(2):
        it.tube((-5.0 + k * 0.6, 3.9, floor), (-5.0 + k * 0.6, 3.9, floor + 0.5), 0.2, C['hazard'], sides=4, r2=0.05)
    # Turn the whole room round, so the back wall is on the truck's right (-Y), behind it as the cameras see it.
    bmesh.ops.rotate(it.bm, verts=it.bm.verts[:], cent=(0, 0, 0), matrix=Matrix.Rotation(math.pi, 3, 'Z'))
    return it


def shaker_base(name, seed):
    """One of the rig's four hydraulic posts: a bolted base and the cylinder the ram slides in."""
    it = Item(name, seed)
    it.box((0, 0, -0.56), (1.0, 0.9, 0.08), C['steelDark'])
    for sx in (-1, 1):
        for sy in (-1, 1):
            it.tube((sx * 0.42, sy * 0.37, -0.52), (sx * 0.42, sy * 0.37, -0.49), 0.035, C['chrome'], sides=6)
    it.tube((0, 0, -0.52), (0, 0, -0.2), 0.22, C['cool'], sides=14)
    it.tube((0, 0, -0.2), (0, 0, -0.16), 0.25, C['graphite'], sides=14)
    # Hose stub and a hazard ring.
    it.tube((0.2, 0, -0.4), (0.5, 0.2, -0.5), 0.03, C['graphite'], sides=5, caps=False)
    it.tube((0, 0, -0.34), (0, 0, -0.3), 0.225, C['hazard'], sides=14, caps=False)
    return it


def shaker_pan(name, seed):
    """The wheel pan on top of a post, and the bright ram that pushes it. Its origin is the top of the pan."""
    it = Item(name, seed)
    it.box((0, 0, -0.035), (0.78, 0.62, 0.07), C['steelDark'])
    for sx in (-1, 1):
        it.box((sx * 0.36, 0, 0.02), (0.06, 0.62, 0.06), C['hazard'])
    # Grip bars across the pan.
    for k in range(5):
        it.box((-0.24 + k * 0.12, 0, 0.004), (0.03, 0.56, 0.012), C['steel'])
    it.tube((0, 0, -0.75), (0, 0, -0.07), 0.11, C['chrome'], sides=12, caps=False)
    it.tube((0, 0, -0.14), (0, 0, -0.07), 0.2, C['graphite'], sides=12)
    return it


# --- Everything ---------------------------------------------------------------------

def build_all():
    items = [
        spruce('Spruce_A', 1, 9.0, 1.9, 8),
        spruce('Spruce_B', 2, 11.0, 1.7, 9, ragged=0.35),
        spruce('Spruce_C', 3, 7.5, 1.3, 8, club=True, ragged=0.4),
        spruce('Spruce_D', 4, 12.5, 2.3, 9),
        spruce('Spruce_Young', 5, 3.2, 1.0, 5),
        spruce('Spruce_Far', 6, 9.0, 2.0, 4, far=True, ragged=0.3),
        spruce('Spruce_Snow_Far', 6, 9.0, 2.0, 4, far=True, ragged=0.3, snow=True),
        spruce('Spruce_Snow_A', 1, 9.0, 1.9, 8, snow=True),
        spruce('Spruce_Snow_B', 3, 7.5, 1.3, 8, snow=True, club=True, ragged=0.4),
        pine('Pine_A', 1, 11.0),
        pine('Pine_B', 2, 13.5),
        birch('Birch_A', 1, 8.0),
        birch('Birch_B', 2, 9.5),
        birch('Birch_C', 3, 7.0, stems=3),
        birch('Birch_Gold', 4, 8.5, leaves='gold'),
        birch('Birch_Bare', 5, 8.5, bare=True),
        snag('Snag', 1, 6.5),
        rock('Rock_A', 1, (0.55, 0.45, 0.5)),
        rock('Rock_B', 2, (0.9, 0.6, 0.55), flat=0.5),
        rock('Rock_C', 3, (0.35, 0.3, 0.3), points=11),
        rock('Rock_D', 4, (1.2, 0.9, 0.5), flat=0.45, points=20),
        rock('Boulder', 5, (1.9, 1.5, 1.7), flat=0.7, points=26),
        shrub('Shrub_A', 1, 1.0, C['shrub'], C['shrubTip'], C['leafDark']),
        shrub('Shrub_B', 2, 0.7, C['dwarf'], C['dwarfTip'], C['barkDark'], clumps=3),
        heather('Heather', 1),
        grass('Grass_A', 1, 7, 0.42, 0.3, C['grass'], C['straw']),
        grass('Grass_B', 2, 9, 0.6, 0.35, C['moss'], C['grass']),
        grass('Reeds', 3, 8, 1.1, 0.25, C['reed'], C['straw'], heads=C['reedHead']),
        fireweed('Fireweed', 1),
        cotton_grass('Cotton', 1),
        stump('Stump', 1),
        log('Log', 1),
        cairn('Cairn', 1),
        dry_stone_wall('Wall', 1),
        gate('Gate', 1),
        marker_post('Post', 1),
        caution_board('Board_1', 1, 1),
        caution_board('Board_2', 1, 2),
        caution_board('Board_3', 1, 3),
        arch('Arch', 1),
        hut('Hut', 1),
        tire_stack('TireStack', 1),
        pennant('Pennant', 1),
        bale('Bale', 1),
        power_pole('Pole', 1),
        bothy('Bothy', 1),
        ridge('Ridge_0', 1, 0.035, 0.075, 180, 0.012, 9),
        ridge('Ridge_1', 2, 0.05, 0.13, 120, 0.0, 7),
        ridge('Ridge_2', 3, 0.06, 0.2, 90, 0.0, 5),
        cloud('Cloud_A', 1, 5),
        cloud('Cloud_B', 2, 7),
        cloud('Cloud_C', 3, 4),
        shop('Shop', 1),
        shaker_base('ShakerBase', 1),
        shaker_pan('ShakerPan', 1),
    ]
    total = 0
    for it in items:
        n = it.triangles()
        total += n
        print(f'  {it.name:16s} {n:5d} triangles')
        it.finish()
    print(f'  {len(items)} pieces, {total} triangles')


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    for mesh in list(bpy.data.meshes):
        bpy.data.meshes.remove(mesh)
    build_all()
    path = os.path.join(OUT_DIR, 'scenery.glb')
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
        export_vertex_color='ACTIVE',
        export_all_vertex_colors=False,
        export_active_vertex_color_when_no_material=True,
    )
    # Zip it, like the trucks: the game unzips it in the browser. A fixed
    # timestamp keeps the file the same when nothing changed.
    with open(path, 'rb') as f:
        raw = f.read()
    with open(path + '.gz', 'wb') as f:
        f.write(gzip.compress(raw, compresslevel=9, mtime=0))
    os.remove(path)
    print(f'wrote {path}.gz ({os.path.getsize(path + ".gz") // 1024} KB, {len(raw) // 1024} KB unzipped)')


main()
