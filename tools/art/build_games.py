"""
Build the mini-game maps from LimeZu's Modern Exteriors (16x16).

    python tools/art/build_games.py "D:/Personal/FocusTown-art"

Writes:
  client/public/assets/tilesets/games.png      every tile the four maps use, deduplicated
  client/public/assets/maps/lake.json          Mirror Lake (fishing)
  client/public/assets/maps/rapids.json        Rushwater Rapids (rafting)
  client/public/assets/maps/meadow.json        Butterfly Meadow (net catching)
  client/public/assets/maps/cove.json          Treasure Cove (digging)
  client/public/assets/sprites/games.png/.json animated pieces and game sprites (Phaser atlas)

Same layers as the town: ground, paths, decor, below, below2, above, above2, collision (hidden),
objects. The rapids add a hidden `raft` layer: where a raft can't go (the banks and rocks), the
opposite of where a walker can't go. Object types the game reads: spawn, label, anim, fish_zone,
launch, finish, buoy, flowers, dig_zone.

The maps are generated once; after that the JSON is the source of truth (Tiled opens it). Needs
Python 3 + Pillow and the LimeZu pack (credit LimeZu; only the derived files are committed).
"""
import glob
import json
import math
import os
import random
import sys

from PIL import Image

SRC = sys.argv[1] if len(sys.argv) > 1 else "D:/Personal/FocusTown-art"
OUT = sys.argv[2] if len(sys.argv) > 2 else None
BASE = os.path.join(SRC, "Exterior", "Modern_Exteriors_16x16")
ME = os.path.join(BASE, "ME_Theme_Sorter_16x16")
ANIM = os.path.join(BASE, "Animated_16x16", "Animated_sheets_16x16")
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
ASSETS = OUT or os.path.join(ROOT, "client", "public", "assets")
T = 16

_index = {}
for path in glob.glob(os.path.join(ME, "*_Singles_16x16", "*.png")):
    key = os.path.basename(path)[:-4]
    if key.endswith("_16x16"):
        key = key[: -len("_16x16")]
    _index[key] = path


def img(name, flip=False):
    hits = [p for k, p in _index.items() if k == name or k.endswith("_" + name)]
    if len(hits) != 1:
        raise SystemExit(f"{name}: {len(hits)} matches {[os.path.basename(h) for h in hits][:6]}")
    im = Image.open(hits[0]).convert("RGBA")
    if im.width % T or im.height % T:  # pad to whole tiles, anchored bottom-left
        padded = Image.new("RGBA", (-(-im.width // T) * T, -(-im.height // T) * T))
        padded.paste(im, (0, padded.height - im.height))
        im = padded
    return im.transpose(Image.FLIP_LEFT_RIGHT) if flip else im


_sheets = {}


def sheet(name, x, y, w=1, h=1):
    """Tiles cut straight from a theme sheet."""
    if name not in _sheets:
        _sheets[name] = Image.open(os.path.join(ME, f"{name}_16x16.png")).convert("RGBA")
    return _sheets[name].crop((x * T, y * T, (x + w) * T, (y + h) * T))


# One tileset shared by all four maps.
tiles = []
tile_ids = {}


def tile_id(tile):
    if tile.getextrema()[3][1] == 0:
        return 0
    key = tile.tobytes()
    if key not in tile_ids:
        tiles.append(tile)
        tile_ids[key] = len(tiles)
    return tile_ids[key]


class Autotile:
    """A 9-slice plus four inner corners, as the pack lays them out: `body` tiles meet `outside`."""

    def __init__(self, sheet_name, ox, oy):
        def cut(c, r):
            return tile_id(sheet(sheet_name, ox + c, oy + r))

        self.slice = {(c, r): cut(c, r) for r in range(3) for c in range(3)}
        self.inner_se = cut(3, 0)  # outside shows at the tile's south-east corner...
        self.inner_sw = cut(4, 0)
        self.inner_ne = cut(3, 1)
        self.inner_nw = cut(4, 1)

    def pick(self, is_body, x, y):
        n, s, w, e = is_body(x, y - 1), is_body(x, y + 1), is_body(x - 1, y), is_body(x + 1, y)
        c = 0 if not w else 2 if not e else 1
        r = 0 if not n else 2 if not s else 1
        if (c, r) != (1, 1):
            return self.slice[(c, r)]
        if not is_body(x - 1, y - 1):
            return self.inner_nw
        if not is_body(x + 1, y - 1):
            return self.inner_ne
        if not is_body(x - 1, y + 1):
            return self.inner_sw
        if not is_body(x + 1, y + 1):
            return self.inner_se
        return self.slice[(1, 1)]


WATER = Autotile("1_Terrains_and_Fences", 0, 35)  # water in grass
SAND = Autotile("21_Beach", 8, 1)  # sand surrounded by sea
GRASS = tile_id(sheet("1_Terrains_and_Fences", 1, 17))
TUFT = tile_id(sheet("1_Terrains_and_Fences", 1, 7))
SEA = tile_id(sheet("21_Beach", 11, 3))
PLAIN_SAND = tile_id(sheet("21_Beach", 12, 3))
PLANK = [tile_id(sheet("11_Camping", 3, 13)), tile_id(sheet("11_Camping", 4, 13))]
PLANK_END = [tile_id(sheet("11_Camping", 3, 14)), tile_id(sheet("11_Camping", 4, 14))]

LAYERS = ["ground", "paths", "decor", "below", "below2", "above", "above2"]
TREES = ["Camping_16x16_Tree_1", "Camping_16x16_Tree_13", "Camping_16x16_Tree_49",
         "Camping_16x16_Tree_9", "Camping_16x16_Tree_61", "Camping_16x16_Tree_157"]
FLOWER_PATCHES = [img(f"Villa_Yard_Flowers_{n}") for n in (1, 2, 3)]

# Animated pieces: strips of whole-tile frames; frames are named "<name>:<i>".
anim_strips = {}


def animated(name, sheet_file, fw, fh, fps, crop_row=None):
    strip = Image.open(os.path.join(ANIM, sheet_file)).convert("RGBA")
    if crop_row is not None:
        strip = strip.crop((0, crop_row * fh * T, strip.width, (crop_row + 1) * fh * T))
    anim_strips[name] = (strip, fw, fh, strip.width // (fw * T), fps)


animated("fish1", "Fishes_1_16x16.png", 1, 1, 6)
animated("fish2", "Fishes_2_16x16.png", 1, 1, 6)
animated("fish3", "Fishes_3_16x16.png", 1, 1, 6)
animated("buoy", "Beach_Water_Buoy_3_16x16.png", 2, 2, 6)
animated("gull-right", "Beach_Seagull_Idle_Right_16x16.png", 2, 2, 5)
animated("gull-left", "Beach_Seagull_Idle_Left_16x16.png", 2, 2, 5)
animated("waterfall", "Waterfall_16x16.png", 3, 3, 8)


class Map:
    def __init__(self, name, w, h, seed, raft_layer=False):
        self.name, self.w, self.h = name, w, h
        self.rand = random.Random(seed)
        self.layers = {n: [0] * (w * h) for n in LAYERS}
        self.solid = [False] * (w * h)
        self.occupied = [False] * (w * h)
        self.raft = [True] * (w * h) if raft_layer else None
        self.objects = []

    def inside(self, x, y):
        return 0 <= x < self.w and 0 <= y < self.h

    def at(self, x, y):
        return y * self.w + x

    def fill_ground(self, plain, tufted=None, chance=0.2):
        for i in range(self.w * self.h):
            self.layers["ground"][i] = tufted if tufted and self.rand.random() < chance else plain

    def set(self, layer, x, y, gid):
        if self.inside(x, y) and gid:
            self.layers[layer][self.at(x, y)] = gid

    def place(self, image, tx, ty, solid_cells="all", above=0, raft_solid=False):
        """Draw with its top-left tile at (tx, ty); the top `above` rows go over the players."""
        w, h = image.width // T, image.height // T
        for r in range(h):
            for c in range(w):
                x, y = tx + c, ty + r
                if not self.inside(x, y):
                    continue
                gid = tile_id(image.crop((c * T, r * T, c * T + T, r * T + T)))
                if not gid:
                    continue
                self.occupied[self.at(x, y)] = True
                group = ("above", "above2") if r < above else ("below", "below2")
                for name in group:
                    if not self.layers[name][self.at(x, y)]:
                        self.layers[name][self.at(x, y)] = gid
                        break
                else:
                    self.layers[group[-1]][self.at(x, y)] = gid
        cells = [(c, r) for r in range(h) for c in range(w)] if solid_cells == "all" else solid_cells or []
        for c, r in cells:
            if self.inside(tx + c, ty + r):
                self.solid[self.at(tx + c, ty + r)] = True
                if raft_solid:
                    self.raft[self.at(tx + c, ty + r)] = True
        return w, h

    def obj(self, name, kind, x, y, w=0, h=0, point=False, **props):
        o = {"id": len(self.objects) + 1, "name": name, "type": kind, "x": x, "y": y, "width": w,
             "height": h, "rotation": 0, "visible": True}
        if point:
            o["point"] = True
        if props:
            o["properties"] = [
                {"name": k, "type": "bool" if isinstance(v, bool) else "int" if isinstance(v, int)
                 else "float" if isinstance(v, float) else "string", "value": v}
                for k, v in props.items()]
        self.objects.append(o)

    def anim(self, name, tx, ty):
        _, fw, fh, frames, fps = anim_strips[name]
        self.obj(name, "anim", tx * T, ty * T, fw * T, fh * T, frames=frames, fps=fps)

    def free(self, tx, ty, w, h, margin=0):
        for y in range(ty - margin, ty + h + margin):
            for x in range(tx - margin, tx + w + margin):
                if not self.inside(x, y) or self.occupied[self.at(x, y)] or self.solid[self.at(x, y)]:
                    return False
        return True

    def tree(self, name, tx, ty):
        image = img(name)
        w, h = image.width // T, image.height // T
        cols = [w // 2 - 1, w // 2] if w >= 4 else [0, 1] if w == 2 else [w // 2]
        self.place(image, tx, ty, [(c, h - 1 - r) for r in range(2) for c in cols], above=h - 2)

    def scatter_trees(self, count, x0, y0, x1, y1, margin=1, names=TREES):
        for _ in range(count):
            name = self.rand.choice(names)
            image = img(name)
            w, h = image.width // T, image.height // T
            tx = self.rand.randint(x0, max(x0, x1 - w))
            ty = self.rand.randint(y0, max(y0, y1 - h))
            if self.free(tx, ty, w, h, margin):
                self.tree(name, tx, ty)

    def border_forest(self, depth=2):
        """A wall of trees all round, so the map ends in woods rather than at an edge."""
        for x in range(-1, self.w, 4):
            for y in [-3, self.h - 5]:
                self.tree(self.rand.choice(TREES[:5]), x, y)
        for y in range(1, self.h - 5, 4):
            for x in [-2, self.w - 3]:
                self.tree(self.rand.choice(TREES[:5]), x, y)
        for i in range(self.w * 2):
            self.solid[self.at(i % self.w, 0 if i < self.w else self.h - 1)] = True
        for y in range(self.h):
            self.solid[self.at(0, y)] = self.solid[self.at(self.w - 1, y)] = True

    def paint_water(self, is_water):
        """Water where `is_water(x, y)`, with shores from the pack's autotile."""
        for y in range(self.h):
            for x in range(self.w):
                if is_water(x, y):
                    self.set("paths", x, y, WATER.pick(is_water, x, y))
                    self.solid[self.at(x, y)] = True
                    self.occupied[self.at(x, y)] = True
                    if self.raft is not None:
                        self.raft[self.at(x, y)] = False

    def save(self):
        return self.name


maps = []

# ---------------------------------------------------------------------------------------------
# Mirror Lake: a wide lake, a camp on its north shore and a pier reaching out over the water.
# ---------------------------------------------------------------------------------------------

lake = Map("lake", 56, 42, 11)
lake.fill_ground(GRASS, TUFT)
PIER_X, PIER_END_Y = 27, 27


def lake_water(x, y):
    # A wobbly ellipse, thick enough everywhere for the autotile.
    cx, cy, rx, ry = 28, 25, 22, 12
    wobble = 1 + 0.08 * math.sin(x * 0.45) + 0.07 * math.sin(y * 0.6 + 1)
    return ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 < wobble * wobble


lake.paint_water(lake_water)
# The pier: two tiles wide, walkable over the water.
first_water = next(y for y in range(lake.h) if lake_water(PIER_X, y))
for y in range(first_water - 1, PIER_END_Y + 1):
    for i, gid in enumerate(PLANK):
        lake.set("decor", PIER_X + i, y, gid)
        lake.solid[lake.at(PIER_X + i, y)] = False
for i, gid in enumerate(PLANK_END):
    lake.set("decor", PIER_X + i, PIER_END_Y + 1, gid)
# A wider landing at the pier's end, with room for a few people to fish side by side.
for y in range(PIER_END_Y - 3, PIER_END_Y + 1):
    for x in range(PIER_X - 3, PIER_X + 5):
        lake.set("decor", x, y, PLANK[(x - PIER_X) % 2])
        lake.solid[lake.at(x, y)] = False
for x in range(PIER_X - 3, PIER_X + 5):
    lake.set("decor", x, PIER_END_Y + 1, PLANK_END[(x - PIER_X) % 2])

# Fish from the pier's sides and landing, and from any bank (the water's edge is solid, so a
# zone reaching over it only matches people standing right beside it).
lake.obj("pier-west", "fish_zone", (PIER_X - 1) * T, first_water * T, T, (PIER_END_Y - first_water - 3) * T)
lake.obj("pier-east", "fish_zone", (PIER_X + 2) * T, first_water * T, T, (PIER_END_Y - first_water - 3) * T)
lake.obj("pier-landing", "fish_zone", (PIER_X - 3) * T, (PIER_END_Y - 3) * T, 8 * T, 4 * T)
bank = set()
for y in range(lake.h):
    for x in range(lake.w):
        if lake_water(x, y) or x < 2 or x > lake.w - 3:
            continue
        if any(lake_water(x + dx, y + dy) for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1))):
            bank.add((x, y))
for x, y in sorted(bank):
    lake.obj(f"bank-{x}-{y}", "fish_zone", x * T, y * T, T, T)

lake.obj("spawn", "spawn", 28 * T, 9 * T, point=True)
lake.obj("Mirror Lake", "label", 28 * T, 4 * T)
# The camp north of the water.
lake.place(img("Camping_16x16_Tent_1"), 14, 3, [(c, r) for c in range(4) for r in range(1, 3)], above=1)
lake.place(img("Camping_16x16_Tent_3"), 38, 3, [(c, r) for c in range(4) for r in range(1, 3)], above=1)
lake.place(img("Camping_16x16_Benched_Table_1"), 21, 7)
lake.place(img("City_Props_16x16_Bench_1"), 32, 7, [(0, 1), (1, 1)])
# Boats tied up, and fish moving in the water.
lake.place(sheet("11_Camping", 2, 31, 2, 4), 17, 18, "all")
lake.place(sheet("11_Camping", 2, 31, 2, 4), 39, 22, "all")
for name, x, y in (("fish1", 16, 26), ("fish2", 22, 30), ("fish3", 36, 28), ("fish1", 40, 18),
                   ("fish2", 34, 18), ("fish3", 13, 21), ("fish1", 24, 20), ("fish2", 44, 26)):
    lake.anim(name, x, y)
lake.anim("gull-right", 6, 16)
lake.anim("gull-left", 49, 12)
lake.border_forest()
lake.scatter_trees(46, 1, 2, lake.w - 1, 10, 1)
lake.scatter_trees(30, 1, 10, lake.w - 1, lake.h - 2, 1)
for _ in range(16):
    image = lake.rand.choice(FLOWER_PATCHES)
    tx, ty = lake.rand.randint(2, lake.w - 5), lake.rand.randint(2, lake.h - 5)
    if lake.free(tx, ty, image.width // T, image.height // T):
        lake.place(image, tx, ty, None)
maps.append(lake)

# ---------------------------------------------------------------------------------------------
# Rushwater Rapids: a long winding river running south, rocks to dodge and buoys to collect.
# ---------------------------------------------------------------------------------------------

RAPIDS_W, RAPIDS_H = 48, 232
rapids = Map("rapids", RAPIDS_W, RAPIDS_H, 23, raft_layer=True)
rapids.fill_ground(GRASS, TUFT)
START_Y, FINISH_Y = 15, RAPIDS_H - 12


def river_center(y):
    return 24 + 8 * math.sin(y / 17) + 4 * math.sin(y / 7 + 2)


def river_half_width(y):
    return 6.5 + 1.5 * math.sin(y / 11 + 1)


def river(x, y):
    if y < 6 or y >= RAPIDS_H - 3:
        return False
    return abs(x + 0.5 - river_center(y)) < river_half_width(y)


rapids.paint_water(river)
# Keep the raft out of the outermost water row, where the shore art covers most of the tile.
for y in range(RAPIDS_H):
    for x in range(RAPIDS_W):
        if river(x, y) and not (river(x - 1, y) and river(x + 1, y)):
            rapids.raft[rapids.at(x, y)] = True
for x in range(RAPIDS_W):
    for y in (5, 6, RAPIDS_H - 3):
        rapids.raft[rapids.at(x, y)] = True

# Waterfalls feed the river at the top.
top_c = int(river_center(6))
for dx in (-4, -1, 2):
    rapids.anim("waterfall", top_c + dx, 3)

# The launch: a jetty on the east bank near the top, and the spawn beside it.
launch_x = int(river_center(11) + river_half_width(11))
rapids.obj("Rushwater Rapids", "label", launch_x * T + 80, 8 * T)
for x in range(launch_x - 1, launch_x + 3):
    for y in range(11, 13):
        rapids.set("decor", x, y, PLANK[x % 2])
        rapids.solid[rapids.at(x, y)] = False
rapids.obj("launch", "launch", (launch_x - 1) * T, 10 * T, 7 * T, 4 * T,
           startX=float(river_center(START_Y) * T), startY=START_Y * T)
rapids.obj("spawn", "spawn", (launch_x + 3) * T, 12 * T, point=True)
rapids.obj("finish", "finish", 0, FINISH_Y * T, RAPIDS_W * T, 3 * T)
# The finish: buoys across the river.
for dx in (-5, -2, 1, 4):
    rapids.anim("buoy", int(river_center(FINISH_Y)) + dx, FINISH_Y)

# Rocks every few rows, far enough apart to steer between. Sea rocks already have a
# ring of water drawn around them. Solid cells are only their base, so they feel fair.
ROCKS = [("Medium_Sea_Rock_1_Vers_1", 2, 3), ("Medium_Sea_Rock_2_Vers_1", 2, 3),
         ("Medium_Sea_Rock_3_Vers_1", 2, 3), ("Medium_Sea_Rock_4_Vers_1", 2, 3)]
rr = random.Random(31)
y = START_Y + 16
rows_with_rocks = []
while y < FINISH_Y - 8:
    half = river_half_width(y)
    c = river_center(y)
    # Clear of the banks, so there's always room to pass on either side.
    left = int(c - half) + 3
    right = int(c + half) - 2
    n = rr.choice((1, 2, 2))
    placed = []
    for _ in range(n):
        name, rw, rh = rr.choice(ROCKS)
        for _try in range(8):
            rx = rr.randint(left, max(left, right - rw))
            if all(abs(rx - px) >= 5 for px in placed):
                image = img(name)
                ih = image.height // T
                iw = image.width // T
                base = [(cx, ih - 1) for cx in range(iw)]
                rapids.place(image, rx, y - ih + 1, base, above=ih - 1, raft_solid=True)
                placed.append(rx)
                break
    rows_with_rocks.append(y)
    y += rr.randint(4, 7)

# Buoys worth a few seconds off your time, off the easy line.
by = START_Y + 11
i = 0
while by < FINISH_Y - 6:
    c = river_center(by)
    side = 1 if i % 2 else -1
    bx = c + side * (river_half_width(by) - 2.5)
    if not rapids.raft[rapids.at(int(bx), by)]:
        rapids.obj(f"buoy-{i}", "buoy", int(bx * T), by * T, point=True)
    i += 1
    by += rr.randint(9, 15)

for y0 in range(0, RAPIDS_H - 4, 8):
    for side in (0, 1):
        for _ in range(3):
            name = rapids.rand.choice(TREES)
            image = img(name)
            w, h = image.width // T, image.height // T
            limit = int(river_center(y0) - river_half_width(y0)) - w - 1
            if side:
                limit0 = int(river_center(y0) + river_half_width(y0)) + 2
                tx = rapids.rand.randint(limit0, max(limit0, RAPIDS_W - w))
            else:
                tx = rapids.rand.randint(0, max(0, limit))
            ty = y0 + rapids.rand.randint(0, 6)
            if rapids.free(tx, ty, w, h, 1) and not (ty < 18 and tx > launch_x - 3):
                rapids.tree(name, tx, ty)
maps.append(rapids)

# ---------------------------------------------------------------------------------------------
# Butterfly Meadow: open grass thick with flowers, in a ring of woods.
# ---------------------------------------------------------------------------------------------

meadow = Map("meadow", 52, 38, 41)
meadow.fill_ground(GRASS, TUFT, 0.35)
meadow.obj("spawn", "spawn", 26 * T, 30 * T, point=True)
meadow.obj("Butterfly Meadow", "label", 26 * T, 6 * T)


def meadow_pond(x, y):
    return ((x - 40) / 6) ** 2 + ((y - 11) / 4) ** 2 < 1


meadow.paint_water(meadow_pond)
meadow.place(img("City_Props_16x16_Bench_1"), 9, 8, [(0, 1), (1, 1)])
meadow.place(img("City_Props_16x16_Bench_1"), 30, 26, [(0, 1), (1, 1)])
meadow.anim("fish1", 39, 11)
meadow.anim("fish2", 42, 10)
meadow.border_forest()
meadow.scatter_trees(8, 5, 6, meadow.w - 6, meadow.h - 8, 3)
for name in ("Big_Sunflower", "Big_Pink_Flower", "Big_Red_Flower", "Big_White_Flower",
             "Big_Yellow_Flower", "Big_Light_Blue_Flower") * 3:
    image = img(f"Garden_16x16_{name}")
    w, h = image.width // T, image.height // T
    for _try in range(10):
        tx, ty = meadow.rand.randint(4, meadow.w - 6), meadow.rand.randint(5, meadow.h - 8)
        if meadow.free(tx, ty, w, h, 1):
            meadow.place(image, tx, ty, [(c, h - 1) for c in range(w)], above=h - 1)
            break
beds = 0
for _ in range(120):
    image = meadow.rand.choice(FLOWER_PATCHES)
    w, h = image.width // T, image.height // T
    tx, ty = meadow.rand.randint(3, meadow.w - 5), meadow.rand.randint(4, meadow.h - 6)
    if meadow.free(tx, ty, w, h, 0):
        meadow.place(image, tx, ty, None)
        for c in range(w):
            for r in range(h):
                meadow.occupied[meadow.at(tx + c, ty + r)] = True
        meadow.obj(f"bed-{beds}", "flowers", tx * T, ty * T, w * T, h * T)
        beds += 1
maps.append(meadow)

# ---------------------------------------------------------------------------------------------
# Treasure Cove: a sandy bay with palms and umbrellas. Somewhere under the sand...
# ---------------------------------------------------------------------------------------------

cove = Map("cove", 56, 42, 57)


def cove_sand(x, y):
    """The land: sand, with the sea curling in along the south and east."""
    shore_y = 31 + 2.5 * math.sin(x / 6) + 1.5 * math.sin(x / 2.5 + 1)
    shore_x = 46 + 2.5 * math.sin(y / 5 + 2) + 1.5 * math.sin(y / 2.2)
    if x < 0 or y < 0:
        return True
    return y < shore_y and x < shore_x


cove.fill_ground(SEA)
for y in range(cove.h):
    for x in range(cove.w):
        if cove_sand(x, y):
            cove.set("ground", x, y, SAND.pick(cove_sand, x, y))
        else:
            cove.solid[cove.at(x, y)] = True
            cove.occupied[cove.at(x, y)] = True
cove.obj("spawn", "spawn", 22 * T, 8 * T, point=True)
cove.obj("Treasure Cove", "label", 22 * T, 3 * T)
cove.obj("dig", "dig_zone", 3 * T, 3 * T, 39 * T, 25 * T)
cove.place(img("Medium_Sea_Rock_1_Vers_1"), 48, 18, None)
cove.place(img("Big_Sea_Rock_Vers_1"), 49, 30, None)
cove.place(img("Medium_Sea_Rock_3_Vers_1"), 22, 36, None)
cove.place(img("Medium_Sea_Rock_2_Vers_1"), 36, 37, None)
cove.place(img("Medium_Sea_Rock_4_Vers_1"), 8, 37, None)
cove.anim("buoy", 15, 38)
cove.anim("buoy", 51, 12)
cove.anim("gull-right", 27, 25)
cove.anim("gull-left", 11, 12)
for i in range(cove.w):
    cove.solid[cove.at(i, 0)] = cove.solid[cove.at(i, cove.h - 1)] = True
for y in range(cove.h):
    cove.solid[cove.at(0, y)] = cove.solid[cove.at(cove.w - 1, y)] = True
PALM = img("Palm_Tree")
pw, ph = PALM.width // T, PALM.height // T
for _ in range(60):
    tx, ty = cove.rand.randint(1, 42), cove.rand.randint(0, 26)
    if cove.free(tx, ty, pw, ph, 2) and abs(tx - 21) + abs(ty - 8) > 8:
        cove.place(PALM, tx, ty, [(pw // 2, ph - 1)], above=ph - 1)
for name, tx, ty in (("Blue_Beach_Umbrella_1", 8, 22), ("Green_Beach_Umbrella_1", 16, 25),
                     ("Lightblue_Beach_Umbrella_1", 30, 24)):
    try:
        image = img(name)
    except SystemExit:
        continue
    w, h = image.width // T, image.height // T
    if cove.free(tx, ty, w, h):
        cove.place(image, tx, ty, [(w // 2, h - 1)], above=h - 1)
for name, tx, ty in (("Blue_Beach_Towel_1", 10, 24), ("Green_Beach_Towel_1", 18, 27),
                     ("Purple_Beach_Towel_1", 32, 26), ("Sand_Castle_1_Vers_1", 25, 15),
                     ("Example_Bucket_With_Shovel", 13, 12)):
    image = img(name)
    if cove.free(tx, ty, image.width // T, image.height // T):
        cove.place(image, tx, ty, None)
maps.append(cove)

# ---------------------------------------------------------------------------------------------
# Write everything
# ---------------------------------------------------------------------------------------------

COLS = 32
rows = -(-len(tiles) // COLS)
tileset = Image.new("RGBA", (COLS * T, rows * T))
for i, t in enumerate(tiles):
    tileset.paste(t, ((i % COLS) * T, (i // COLS) * T))
os.makedirs(os.path.join(ASSETS, "tilesets"), exist_ok=True)
os.makedirs(os.path.join(ASSETS, "maps"), exist_ok=True)
os.makedirs(os.path.join(ASSETS, "sprites"), exist_ok=True)
tileset.save(os.path.join(ASSETS, "tilesets", "games.png"), optimize=True)
COLL = len(tiles) + 1

for m in maps:
    tile_layers = [(n, m.layers[n], True) for n in LAYERS]
    tile_layers.append(("collision", [COLL if s else 0 for s in m.solid], False))
    if m.raft is not None:
        tile_layers.append(("raft", [COLL if s else 0 for s in m.raft], False))
    data = {
        "compressionlevel": -1, "width": m.w, "height": m.h, "tilewidth": T, "tileheight": T,
        "infinite": False, "orientation": "orthogonal", "renderorder": "right-down",
        "tiledversion": "1.11.2", "type": "map", "version": "1.10",
        "nextlayerid": len(tile_layers) + 2, "nextobjectid": len(m.objects) + 1,
        "layers": [
            {"id": i + 1, "name": name, "type": "tilelayer", "width": m.w, "height": m.h, "x": 0,
             "y": 0, "opacity": 1, "visible": visible, "data": d}
            for i, (name, d, visible) in enumerate(tile_layers)
        ] + [{"id": len(tile_layers) + 1, "name": "objects", "type": "objectgroup",
              "draworder": "topdown", "x": 0, "y": 0, "opacity": 1, "visible": True,
              "objects": m.objects}],
        "tilesets": [
            {"firstgid": 1, "name": "games", "image": "../tilesets/games.png",
             "imagewidth": tileset.width, "imageheight": tileset.height, "columns": COLS,
             "tilecount": len(tiles), "tilewidth": T, "tileheight": T, "margin": 0, "spacing": 0},
            {"firstgid": COLL, "name": "collision", "image": "../tilesets/collision.png",
             "imagewidth": T, "imageheight": T, "columns": 1, "tilecount": 1, "tilewidth": T,
             "tileheight": T, "margin": 0, "spacing": 0},
        ],
    }
    with open(os.path.join(ASSETS, "maps", f"{m.name}.json"), "w", encoding="utf-8", newline="\n") as fh:
        json.dump(data, fh, separators=(",", ":"))

# The atlas: animated strips ("<name>:<i>") and game sprites.
sprites = {
    "raft": sheet("11_Camping", 2, 31, 2, 4),
    "shell-grey": img("Grey_Shell_1_Vers_1"),
    "shell-brown": img("Brown_Shell_1_Vers_1"),
    "shell-gold": img("Gold_Shell_1_Vers_1"),
    "shell-blue": img("Gold_Blue_Shell_1_Vers_1"),
    "shell-white": img("Ice_White_Shell_1_Vers_1"),
}
atlas_w = max(max(s.width for s, *_ in anim_strips.values()), 256)
atlas_h = sum(s.height for s, *_ in anim_strips.values()) + 64
atlas = Image.new("RGBA", (atlas_w, atlas_h))
frames = {}


def frame(name, x, y, w, h):
    frames[name] = {"frame": {"x": x, "y": y, "w": w, "h": h}, "rotated": False, "trimmed": False,
                    "spriteSourceSize": {"x": 0, "y": 0, "w": w, "h": h}, "sourceSize": {"w": w, "h": h}}


y = 0
for name, (strip, fw, fh, count, _) in anim_strips.items():
    atlas.paste(strip, (0, y))
    for i in range(count):
        frame(f"{name}:{i}", i * fw * T, y, fw * T, fh * T)
    y += strip.height
x = 0
for name, im in sprites.items():
    atlas.paste(im, (x, y))
    frame(name, x, y, im.width, im.height)
    x += im.width
atlas.save(os.path.join(ASSETS, "sprites", "games.png"), optimize=True)
with open(os.path.join(ASSETS, "sprites", "games.json"), "w", encoding="utf-8", newline="\n") as fh:
    json.dump({"frames": frames, "meta": {"image": "games.png", "size": {"w": atlas_w, "h": atlas_h},
                                          "scale": "1"}}, fh, indent=1)

# Preview pictures of the whole maps, for checking them by eye.
if OUT:
    for m in maps:
        pic = Image.new("RGBA", (m.w * T, m.h * T), (0, 0, 0, 255))
        for name in LAYERS:
            for i, gid in enumerate(m.layers[name]):
                if gid:
                    pic.alpha_composite(tiles[gid - 1], ((i % m.w) * T, (i // m.w) * T))
            if name == "below2":
                for o in m.objects:
                    if o["type"] == "anim":
                        strip, fw, fh, *_ = anim_strips[o["name"]]
                        pic.alpha_composite(strip.crop((0, 0, fw * T, fh * T)), (o["x"], o["y"]))
        pic.convert("RGB").save(os.path.join(OUT, f"preview-{m.name}.png"))

for m in maps:
    print(f"{m.name}: {m.w}x{m.h}, {len(m.objects)} objects")
print(f"{len(tiles)} tiles")
