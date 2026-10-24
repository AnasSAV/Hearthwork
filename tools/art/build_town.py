"""
Build the town from LimeZu's Modern Exteriors (16x16 singles).

    python tools/art/build_town.py "D:/Personal/FocusTown-art"

Writes:
  client/public/assets/tilesets/town.png      every 16x16 tile the map uses, deduplicated
  client/public/assets/maps/town.json, .tmx   the map (open the .tmx in Tiled to edit it)
  client/public/assets/sprites/houses.png     house exteriors per style and level (Phaser atlas,
  client/public/assets/sprites/houses.json    JSON hash), drawn in each home's yard
  client/public/assets/sprites/town-anims.*   animated pieces (flags, fish, garden fountain);
                                              `anim` objects in the map say where they play
  client/public/assets/sprites/town-map.png   a small picture of the town for the world map

Layers, bottom to top: ground, paths, decor, below, below2 (drawn under players), above,
above2 (drawn over players: tree tops, lamp heads), collision (hidden). Tall things are split
so their lower rows are solid and drawn under players and their upper rows are drawn over
players, which lets people walk behind trees.

Re-running overwrites the map; after hand edits in Tiled, export the JSON from Tiled instead
(embed tilesets) and only re-run this script to start over. Needs Python 3 + Pillow and the
LimeZu pack (credit LimeZu; only the derived files are committed).
"""
import glob
import json
import os
import random
import sys

from PIL import Image

SRC = sys.argv[1] if len(sys.argv) > 1 else "D:/Personal/FocusTown-art"
ME = os.path.join(SRC, "Exterior", "Modern_Exteriors_16x16", "ME_Theme_Sorter_16x16")
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
ASSETS = os.path.join(ROOT, "client", "public", "assets")

T = 16
W, H = 68, 50
random.seed(7)

# ---------------------------------------------------------------------------------------------
# Source images, found by the end of their file name ("Camping_16x16_Chair_13" etc.)
# ---------------------------------------------------------------------------------------------

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


def sheet(name, x, y, w=1, h=1):
    """Tiles cut straight from a theme sheet, e.g. sheet("1_Terrains_and_Fences", 1, 17)."""
    im = Image.open(os.path.join(ME, f"{name}_16x16.png")).convert("RGBA")
    return im.crop((x * T, y * T, (x + w) * T, (y + h) * T))


# ---------------------------------------------------------------------------------------------
# Tileset and layers
# ---------------------------------------------------------------------------------------------

tiles = []
tile_ids = {}


def tile_id(tile):
    """1-based gid of a 16x16 tile in town.png (0 for a fully transparent tile)."""
    if tile.getextrema()[3][1] == 0:
        return 0
    key = tile.tobytes()
    if key not in tile_ids:
        tiles.append(tile)
        tile_ids[key] = len(tiles)
    return tile_ids[key]


LAYERS = ["ground", "paths", "decor", "below", "below2", "above", "above2"]
layers = {name: [0] * (W * H) for name in LAYERS}
solid = [False] * (W * H)
# Cells kept free of random trees and flowers (roads, plaza, buildings, lots and margins).
reserved = [False] * (W * H)
# Cells covered by placed objects (so scattered trees don't overlap them).
occupied = [False] * (W * H)


def inside(x, y):
    return 0 <= x < W and 0 <= y < H


def at(x, y):
    return y * W + x


def reserve(x0, y0, x1, y1, margin=0):
    for y in range(y0 - margin, y1 + margin + 1):
        for x in range(x0 - margin, x1 + margin + 1):
            if inside(x, y):
                reserved[at(x, y)] = True


def set_tile(layer, x, y, gid):
    if inside(x, y) and gid:
        layers[layer][at(x, y)] = gid


def place(image, tx, ty, solid_cells="all", above=0):
    """
    Draw `image` with its top-left tile at (tx, ty). The top `above` rows go to the above
    layers, the rest below. solid_cells: "all", None, or a list of (col, row) in the image.
    """
    w, h = image.width // T, image.height // T
    for r in range(h):
        for c in range(w):
            x, y = tx + c, ty + r
            if not inside(x, y):
                continue
            gid = tile_id(image.crop((c * T, r * T, c * T + T, r * T + T)))
            if not gid:
                continue
            occupied[at(x, y)] = True
            group = ("above", "above2") if r < above else ("below", "below2")
            for name in group:
                if not layers[name][at(x, y)]:
                    layers[name][at(x, y)] = gid
                    break
            else:
                layers[group[-1]][at(x, y)] = gid  # both full: the newest object wins
    cells = [(c, r) for r in range(h) for c in range(w)] if solid_cells == "all" else solid_cells or []
    for c, r in cells:
        if inside(tx + c, ty + r):
            solid[at(tx + c, ty + r)] = True
    return w, h


def trunk_cells(w, h, rows=2):
    """Solid footprint of a tree: the middle column(s) of its bottom rows."""
    cols = [w // 2 - 1, w // 2] if w >= 4 else ([0, 1] if w == 2 else [w // 2])
    return [(c, h - 1 - r) for r in range(rows) for c in cols]


tree_images = {}  # name -> image, for the trees atlas


def plant_tree(name, tx, ty):
    """
    Trees are objects, not tiles: the town scene draws each one as a sprite sorted with the
    players (so you can walk behind them) and sways its canopy in the wind. Only the trunk is
    solid.
    """
    image = img(name)
    w, h = image.width // T, image.height // T
    tree_images[name] = image
    for c, r in trunk_cells(w, h):
        if inside(tx + c, ty + r):
            solid[at(tx + c, ty + r)] = True
    for r in range(h):
        for c in range(w):
            if inside(tx + c, ty + r):
                occupied[at(tx + c, ty + r)] = True
    add_object(name, "tree", tx * T, ty * T, w * T, h * T, trunk=2)
    return w, h


def fits(tx, ty, w, h, margin=0, ignore_occupied=False):
    for y in range(ty - margin, ty + h + margin):
        for x in range(tx - margin, tx + w + margin):
            if inside(x, y) and (reserved[at(x, y)] or (occupied[at(x, y)] and not ignore_occupied)):
                return False
    return True


# ---------------------------------------------------------------------------------------------
# Objects layer (desks, buildings, plots, spawn)
# ---------------------------------------------------------------------------------------------

objects = []


def prop(name, value):
    kind = "bool" if isinstance(value, bool) else "int" if isinstance(value, int) else (
        "float" if isinstance(value, float) else "string")
    return {"name": name, "type": kind, "value": value}


def add_object(name, kind, x, y, w=0, h=0, point=False, **props):
    o = {"id": len(objects) + 1, "name": name, "type": kind, "x": x, "y": y, "width": w,
         "height": h, "rotation": 0, "visible": True}
    if point:
        o["point"] = True
    if props:
        o["properties"] = [prop(k, v) for k, v in props.items()]
    objects.append(o)


# ---------------------------------------------------------------------------------------------
# 1. Grass
# ---------------------------------------------------------------------------------------------

PLAIN_GRASS = tile_id(sheet("1_Terrains_and_Fences", 1, 17))
TUFTED_GRASS = tile_id(sheet("1_Terrains_and_Fences", 1, 7))
for y in range(H):
    for x in range(W):
        layers["ground"][at(x, y)] = TUFTED_GRASS if random.random() < 0.2 else PLAIN_GRASS

# ---------------------------------------------------------------------------------------------
# 2. Paving: plaza, avenue in front of the buildings, south path, lots street
# ---------------------------------------------------------------------------------------------

PAVING = [img(f"City_Terrains_16x16_Sidewalk_1_{n}") for n in (25, 26, 27, 28)]


def pave(x0, y0, x1, y1):
    for y in range(y0, y1 + 1):
        for x in range(x0, x1 + 1):
            block = PAVING[hash((x // 2, y // 2)) % len(PAVING)]
            c, r = x % 2, y % 2
            set_tile("paths", x, y, tile_id(block.crop((c * T, r * T, c * T + T, r * T + T))))
    reserve(x0, y0, x1, y1)


PLAZA = (14, 19, 53, 33)
pave(*PLAZA)
pave(4, 18, 63, 18)  # avenue in front of shop, library and tower
pave(32, 34, 35, 40)  # path from the plaza down to the promenade
pave(4, 40, 63, 41)  # promenade across the south of town

# ---------------------------------------------------------------------------------------------
# 3. Buildings
# ---------------------------------------------------------------------------------------------


def building(name, image_name, tx, ty, label=None, door_col=None):
    w, h = place(img(image_name), tx, ty)
    reserve(tx, ty, tx + w - 1, ty + h - 1, margin=1)
    props = {}
    if label:
        props["label"] = label
    if door_col is not None:
        # The door spans door_col-1 and door_col; doorY is the top of the doorstep row.
        props["doorX"] = (tx + door_col) * T
        props["doorY"] = (ty + h) * T
    add_object(name, "building", tx * T, ty * T, w * T, h * T, **props)


building("shop", "Hardware_Store_Example", 6, 9, "Furniture Shop", door_col=2)
building("library", "Victorian_House_5", 25, 2, "Library")
building("tower", "School_16x16_Clock_Tower_1", 54, 3)

# ---------------------------------------------------------------------------------------------
# 4. Study plaza: tables with side chairs (seated players use LimeZu's sit animation)
# ---------------------------------------------------------------------------------------------

CHAIR_FACING_LEFT = img("Camping_16x16_Chair_13")
CHAIR_FACING_RIGHT = img("Camping_16x16_Chair_13", flip=True)
desk_count = 0


def seat(tx, seat_row, facing, table=None):
    """A chair whose seat tile is (tx, seat_row); the player stands there to focus."""
    global desk_count
    chair = CHAIR_FACING_LEFT if facing == "left" else CHAIR_FACING_RIGHT
    place(chair, tx, seat_row - 1, None)
    desk_count += 1
    props = {"facing": facing}
    if table:
        props["table"] = table
    add_object(f"desk-{desk_count}", "desk", tx * T, seat_row * T, T, T, **props)


def table_pair(tx, seat_row, table_image, group=None):
    """Chair, 2-wide table, chair: seats on both sides facing the table."""
    place(img(table_image), tx + 1, seat_row - 1)
    seat(tx, seat_row, "right", group)
    seat(tx + 3, seat_row, "left", group)


def group_table(name, tx, top_row, table_image):
    """Three tables in a column sharing one Pomodoro: 6 seats."""
    for k in range(3):
        table_pair(tx, top_row + 2 * k, table_image, name)


group_table("table-west", 19, 22, "Camping_16x16_Table_5")
group_table("table-east", 45, 22, "Camping_16x16_Table_5")
for tx, table in ((16, "Camping_16x16_Table_7"), (22, "Camping_16x16_Table_6"),
                  (42, "Camping_16x16_Table_6"), (48, "Camping_16x16_Table_7")):
    table_pair(tx, 31, table)

place(img("Fountain_3_1"), 32, 23)

# Raised grass planters (stone curb, 9-slice from the terrain sheet) with a tree in each.
CURB = sheet("1_Terrains_and_Fences", 0, 16, 3, 3)


def planter(x0, y0, w, h, tree):
    for y in range(h):
        for x in range(w):
            c = 0 if x == 0 else 2 if x == w - 1 else 1
            r = 0 if y == 0 else 2 if y == h - 1 else 1
            set_tile("paths", x0 + x, y0 + y, tile_id(CURB.crop((c * T, r * T, c * T + T, r * T + T))))
            solid[at(x0 + x, y0 + y)] = True
    image = img(tree)
    tw, th = image.width // T, image.height // T
    place(image, x0 + (w - tw) // 2, y0 + h - th, None, above=th - 1)


planter(26, 20, 4, 3, "Camping_16x16_Tree_145")
planter(38, 20, 4, 3, "Camping_16x16_Tree_145")
for tx in (17, 27, 39, 50):
    place(img("Garden_16x16_Bush_Potted_2"), tx, 32, [(0, 1)], above=1)
for tx, ty in ((15, 19), (52, 19), (15, 28), (52, 28)):
    place(img("Street_Lamp_5"), tx, ty - 1, [(0, 3)], above=2)
place(img("City_Props_16x16_Bench_2"), 26, 28, [(0, 1), (1, 1), (2, 1)])
place(img("City_Props_16x16_Bench_2"), 38, 28, [(0, 1), (1, 1), (2, 1)])
place(img("Flowers_Bench_Horizontal"), 21, 19)
place(img("Flowers_Bench_Horizontal"), 44, 19)
place(img("City_Props_16x16_Trashbin_1"), 30, 28, [(0, 1)], above=1)
place(img("City_Props_16x16_Trashbin_1"), 37, 28, [(0, 1)], above=1)

# ---------------------------------------------------------------------------------------------
# 5. The south: café terrace, park reading garden, pond; and some life around the buildings
# ---------------------------------------------------------------------------------------------

ANIMATED = os.path.join(SRC, "Exterior", "Modern_Exteriors_16x16", "Animated_16x16",
                        "Animated_sheets_16x16")
anim_strips = {}  # name -> (strip image, frame width, frame height in tiles, frames, fps)


def animated(name, file, fw, fh, fps, crop=None):
    strip = Image.open(os.path.join(ANIMATED, file)).convert("RGBA")
    if crop:  # (x, y, w, h) in px: part of a bigger sheet
        strip = strip.crop((crop[0], crop[1], crop[0] + crop[2], crop[1] + crop[3]))
    anim_strips[name] = (strip, fw, fh, strip.width // (fw * T), fps)


def place_anim(name, tx, ty, solid_cells=()):
    """An animated piece with its top-left tile at (tx, ty); the town scene plays it."""
    _, fw, fh, frames, fps = anim_strips[name]
    add_object(name, "anim", tx * T, ty * T, fw * T, fh * T, frames=frames, fps=fps)
    for c, r in solid_cells:
        solid[at(tx + c, ty + r)] = True
    for r in range(fh):
        for c in range(fw):
            if inside(tx + c, ty + r):
                occupied[at(tx + c, ty + r)] = True


animated("flag", "School_Flag_1_16x16.png", 3, 9, 8)
animated("fish1", "Fishes_1_16x16.png", 1, 1, 6)
animated("fish2", "Fishes_2_16x16.png", 1, 1, 6)
animated("garden-fountain", "Garden_Fountain_1_16x16.png", 2, 3, 8)
# Seagulls pottering by the pond (idle row of the sheet: 6 frames facing right, 6 left).
animated("gull-right", "Beach_Seagull_Complete_16x16.png", 2, 2, 5, crop=(0, 32, 192, 32))
animated("gull-left", "Beach_Seagull_Complete_16x16.png", 2, 2, 5, crop=(384, 32, 192, 32))

# Flags either side of the library steps.
for fx in (21, 44):
    place_anim("flag", fx, 9, [(c, 8) for c in range(3)])

# Flower beds and benches on the lawns between the buildings.
for fx, fy, flowers in ((16, 10, 4), (16, 13, 5), (46, 12, 6), (49, 14, 4)):
    place(img(f"Villa_Yard_Flowers_{flowers}"), fx, fy, None)
    add_object("flowers", "flowers", fx * T, fy * T, 2 * T, 2 * T)
    reserve(fx, fy, fx + 1, fy + 1, margin=1)
place(img("City_Props_16x16_Bench_1"), 19, 15, [(0, 1), (1, 1)])
place(img("City_Props_16x16_Bench_1"), 49, 10, [(0, 1), (1, 1)])
reserve(15, 9, 24, 17)
reserve(45, 9, 53, 17)

# Café terrace (west): three tables in a row sharing one Pomodoro, a food cart and planters.
pave(4, 35, 24, 39)
for tx in (6, 12, 18):
    table_pair(tx, 37, "Camping_16x16_Table_8", "table-cafe")
place(img("Street_Food_Cart_2"), 22, 34, [(c, 2) for c in range(3)], above=2)
for tx in (5, 11, 17):
    place(img("Garden_16x16_Bush_Potted_4"), tx, 34, [(0, 1)], above=1)
place(img("Umbrella_2"), 4, 36, [(1, 3)], above=2)

# Park reading garden (east): solo tables on the lawn, benches, an animated fountain.
for tx in (40, 46):
    table_pair(tx, 37, "Camping_16x16_Table_7")
place_anim("garden-fountain", 53, 35, [(0, 2), (1, 2)])
place(img("City_Props_16x16_Bench_1"), 56, 37, [(0, 1), (1, 1)])
place(img("City_Props_16x16_Bench_1"), 59, 37, [(0, 1), (1, 1)])
reserve(38, 34, 62, 39)

# Pond south of the promenade (water in grass, 9-slice) with fish swimming in it.
POND = sheet("1_Terrains_and_Fences", 0, 35, 3, 3)


def pond(x0, y0, w, h):
    for y in range(h):
        for x in range(w):
            c = 0 if x == 0 else 2 if x == w - 1 else 1
            r = 0 if y == 0 else 2 if y == h - 1 else 1
            set_tile("paths", x0 + x, y0 + y, tile_id(POND.crop((c * T, r * T, c * T + T, r * T + T))))
            solid[at(x0 + x, y0 + y)] = True
    reserve(x0, y0, x0 + w - 1, y0 + h - 1, margin=1)


pond(44, 43, 12, 4)
for name, fx, fy in (("fish1", 46, 44), ("fish2", 50, 45), ("fish1", 53, 44)):
    place_anim(name, fx, fy)
place(img("City_Props_16x16_Bench_1"), 40, 43, [(0, 1), (1, 1)])
place_anim("gull-right", 42, 45)
place_anim("gull-left", 57, 44)

# Lamps along the promenade.
for lx in (10, 28, 39, 58):
    place(img("Street_Lamp_5"), lx, 39, [(0, 3)], above=2)

# A flower meadow and a quiet bench south-west of the promenade.
for fx, fy, flowers in ((8, 43, 4), (11, 44, 5), (14, 43, 6), (17, 44, 4)):
    place(img(f"Villa_Yard_Flowers_{flowers}"), fx, fy, None)
    add_object("flowers", "flowers", fx * T, fy * T, 2 * T, 2 * T)
    reserve(fx, fy, fx + 1, fy + 1)
place(img("City_Props_16x16_Bench_1"), 22, 43, [(0, 1), (1, 1)])
reserve(6, 42, 25, 46)

# ---------------------------------------------------------------------------------------------
# 6. Trees: a forest border, then a few scattered in the open grass
# ---------------------------------------------------------------------------------------------

BORDER_TREES = ["Camping_16x16_Tree_1", "Camping_16x16_Tree_13", "Camping_16x16_Tree_49",
                "Camping_16x16_Tree_9", "Camping_16x16_Tree_61", "Camping_16x16_Tree_157"]
for y in range(H):
    for x in range(W):
        if x < 2 or y < 2 or x >= W - 2 or y >= H - 2:
            solid[at(x, y)] = True
spots = []
for x in range(-2, W, 3):
    spots += [(x, -1), (x + 1, 1), (x, H - 4), (x + 1, H - 6)]
for y in range(-1, H, 3):
    spots += [(-1, y), (1, y + 1), (W - 3, y), (W - 5, y + 1)]
spots.sort(key=lambda p: (p[1], p[0]))  # north first, so southern trees overlap them
for x, y in spots:
    name = random.choice(BORDER_TREES)
    w, h = img(name).width // T, img(name).height // T
    if fits(x, y, w, h, ignore_occupied=True):
        plant_tree(name, x, y)

SCATTER = ["Camping_16x16_Tree_1", "Camping_16x16_Tree_49", "Camping_16x16_Tree_97",
           "Camping_16x16_Tree_145", "Camping_16x16_Tree_185", "Camping_16x16_Tree_197",
           "Garden_16x16_Bush_22", "Garden_16x16_Bush_20"]
for y in range(2, H - 2):
    for x in range(2, W - 2):
        if random.random() < 0.09:
            name = random.choice(SCATTER)
            w, h = img(name).width // T, img(name).height // T
            if fits(x, y, w, h, margin=1):
                if name.startswith("Garden"):
                    place(img(name), x, y, [(c, h - 1) for c in range(w)], above=h - 1)
                else:
                    plant_tree(name, x, y)

# Flowers and grass tufts (walkable decoration).
FLOWERS = [img(f"Villa_Yard_Flowers_{n}") for n in (1, 2, 3)] + [
    img(f"Terrains_and_Fences_16x16_Props_Grass_{n}") for n in (9, 10, 11)]
for y in range(2, H - 2):
    for x in range(2, W - 2):
        if not reserved[at(x, y)] and not occupied[at(x, y)] and random.random() < 0.035:
            set_tile("decor", x, y, tile_id(random.choice(FLOWERS)))

# Spawn on the south path just below the plaza.
add_object("spawn", "spawn", 34 * T, 36 * T - 1, point=True)

# ---------------------------------------------------------------------------------------------
# Output: tileset, map (.json + .tmx), houses atlas
# ---------------------------------------------------------------------------------------------

COLS = 32
rows = -(-len(tiles) // COLS)
sheet = Image.new("RGBA", (COLS * T, rows * T))
for i, t in enumerate(tiles):
    sheet.paste(t, ((i % COLS) * T, (i // COLS) * T))
sheet.save(os.path.join(ASSETS, "tilesets", "town.png"), optimize=True)

COLL = len(tiles) + 1  # collision.png's firstgid
tilesets = [
    {"firstgid": 1, "name": "town", "image": "../tilesets/town.png", "imagewidth": sheet.width,
     "imageheight": sheet.height, "columns": COLS, "tilecount": len(tiles)},
    {"firstgid": COLL, "name": "collision", "image": "../tilesets/collision.png",
     "imagewidth": T, "imageheight": T, "columns": 1, "tilecount": 1},
]
tile_layers = [(name, layers[name], True) for name in LAYERS] + [
    ("collision", [COLL if s else 0 for s in solid], False)]

data = {
    "compressionlevel": -1, "width": W, "height": H, "tilewidth": T, "tileheight": T,
    "infinite": False, "orientation": "orthogonal", "renderorder": "right-down",
    "tiledversion": "1.11.2", "type": "map", "version": "1.10",
    "nextlayerid": len(tile_layers) + 2, "nextobjectid": len(objects) + 1,
    "layers": [
        {"id": i + 1, "name": name, "type": "tilelayer", "width": W, "height": H, "x": 0, "y": 0,
         "opacity": 1, "visible": visible, "data": d}
        for i, (name, d, visible) in enumerate(tile_layers)
    ] + [{"id": len(tile_layers) + 1, "name": "objects", "type": "objectgroup",
          "draworder": "topdown", "x": 0, "y": 0, "opacity": 1, "visible": True,
          "objects": objects}],
    "tilesets": [dict(ts, tilewidth=T, tileheight=T, margin=0, spacing=0) for ts in tilesets],
}
maps = os.path.join(ASSETS, "maps")
with open(os.path.join(maps, "town.json"), "w", encoding="utf-8", newline="\n") as fh:
    json.dump(data, fh, separators=(",", ":"))


def esc(s):
    return str(s).replace("&", "&amp;").replace('"', "&quot;").replace("<", "&lt;")


def csv(d):
    return ",\n".join(",".join(str(v) for v in d[y * W:(y + 1) * W]) for y in range(H))


tmx = ['<?xml version="1.0" encoding="UTF-8"?>',
       f'<map version="1.10" tiledversion="1.11.2" orientation="orthogonal" renderorder="right-down" '
       f'width="{W}" height="{H}" tilewidth="{T}" tileheight="{T}" infinite="0" '
       f'nextlayerid="{data["nextlayerid"]}" nextobjectid="{data["nextobjectid"]}">']
for ts in tilesets:
    tmx.append(f' <tileset firstgid="{ts["firstgid"]}" name="{ts["name"]}" tilewidth="{T}" '
               f'tileheight="{T}" tilecount="{ts["tilecount"]}" columns="{ts["columns"]}">\n'
               f'  <image source="{ts["image"]}" width="{ts["imagewidth"]}" height="{ts["imageheight"]}"/>\n'
               f' </tileset>')
for i, (name, d, visible) in enumerate(tile_layers):
    hidden = "" if visible else ' visible="0"'
    tmx.append(f' <layer id="{i + 1}" name="{name}" width="{W}" height="{H}"{hidden}>\n'
               f'  <data encoding="csv">\n{csv(d)}\n</data>\n </layer>')
tmx.append(f' <objectgroup id="{len(tile_layers) + 1}" name="objects">')
for o in objects:
    size = "" if o.get("point") else f' width="{o["width"]}" height="{o["height"]}"'
    head = f'  <object id="{o["id"]}" name="{esc(o["name"])}" type="{o["type"]}" x="{o["x"]}" y="{o["y"]}"{size}'
    inner = []
    if o.get("properties"):
        inner.append("   <properties>")
        for p in o["properties"]:
            kind = "" if p["type"] == "string" else f' type="{p["type"]}"'
            inner.append(f'    <property name="{esc(p["name"])}"{kind} value="{esc(p["value"])}"/>')
        inner.append("   </properties>")
    if o.get("point"):
        inner.append("   <point/>")
    tmx.append(head + (">\n" + "\n".join(inner) + "\n  </object>" if inner else "/>"))
tmx += [" </objectgroup>", "</map>", ""]
with open(os.path.join(maps, "town.tmx"), "w", encoding="utf-8", newline="\n") as fh:
    fh.write("\n".join(tmx))

# Animated pieces: one strip per animation, stacked; frames are named "<name>:<i>".
anim_frames = {}
sheet_w = max(strip.width for strip, *_ in anim_strips.values())
sheet_h = sum(strip.height for strip, *_ in anim_strips.values())
anim_sheet = Image.new("RGBA", (sheet_w, sheet_h))
y = 0
for name, (strip, fw, fh, frames, _) in anim_strips.items():
    anim_sheet.paste(strip, (0, y))
    for i in range(frames):
        frame = {"x": i * fw * T, "y": y, "w": fw * T, "h": fh * T}
        anim_frames[f"{name}:{i}"] = {"frame": frame, "rotated": False, "trimmed": False,
                                      "spriteSourceSize": {"x": 0, "y": 0, "w": fw * T, "h": fh * T},
                                      "sourceSize": {"w": fw * T, "h": fh * T}}
    y += strip.height
os.makedirs(os.path.join(ASSETS, "sprites"), exist_ok=True)
anim_sheet.save(os.path.join(ASSETS, "sprites", "town-anims.png"), optimize=True)
with open(os.path.join(ASSETS, "sprites", "town-anims.json"), "w", encoding="utf-8", newline="\n") as fh:
    json.dump({"frames": anim_frames, "meta": {"image": "town-anims.png",
               "size": {"w": sheet_w, "h": sheet_h}, "scale": "1"}}, fh, indent=1)

# The town as one small picture (first animation frames included) for the world map.
picture = Image.new("RGBA", (W * T, H * T), (0, 0, 0, 255))
for name in LAYERS:
    for i, gid in enumerate(layers[name]):
        if gid:
            picture.alpha_composite(tiles[gid - 1], ((i % W) * T, (i // W) * T))
    if name == "below2":
        for o in objects:
            if o["type"] == "anim":
                strip, fw, fh, *_ = anim_strips[o["name"]]
                picture.alpha_composite(strip.crop((0, 0, fw * T, fh * T)), (o["x"], o["y"]))
        for o in sorted((o for o in objects if o["type"] == "tree"), key=lambda o: o["y"] + o["height"]):
            picture.alpha_composite(tree_images[o["name"]], (o["x"], o["y"])) if o["x"] >= 0 and o["y"] >= 0 else picture.paste(
                tree_images[o["name"]], (o["x"], o["y"]), tree_images[o["name"]])
picture.convert("RGB").resize((W * 4, H * 4), Image.LANCZOS).save(
    os.path.join(ASSETS, "sprites", "town-map.png"), optimize=True)

# Trees: one frame per tree image ("<name>"), packed in a row.
tree_frames = {}
tw = sum(im.width for im in tree_images.values())
th = max(im.height for im in tree_images.values())
tree_sheet = Image.new("RGBA", (tw, th))
x = 0
for name, im in tree_images.items():
    tree_sheet.paste(im, (x, 0))
    tree_frames[name] = {"frame": {"x": x, "y": 0, "w": im.width, "h": im.height}, "rotated": False,
                         "trimmed": False, "spriteSourceSize": {"x": 0, "y": 0, "w": im.width, "h": im.height},
                         "sourceSize": {"w": im.width, "h": im.height}}
    x += im.width
tree_sheet.save(os.path.join(ASSETS, "sprites", "town-trees.png"), optimize=True)
with open(os.path.join(ASSETS, "sprites", "town-trees.json"), "w", encoding="utf-8", newline="\n") as fh:
    json.dump({"frames": tree_frames, "meta": {"image": "town-trees.png", "size": {"w": tw, "h": th},
               "scale": "1"}}, fh, indent=1)

# Houses: level 1-3 per style (all have their door in column 2).
HOUSES = {"cottage": 1, "brick": 2}
frames = {}
pieces = []
for style, variant in HOUSES.items():
    for level, size in ((1, "Small"), (2, "Medium"), (3, "Big")):
        pieces.append((f"{style}-{level}", img(f"Mobile_House_{size}_{variant}")))
atlas = Image.new("RGBA", (sum(p.width for _, p in pieces), max(p.height for _, p in pieces)))
x = 0
for name, p in pieces:
    atlas.paste(p, (x, 0))
    frames[name] = {"frame": {"x": x, "y": 0, "w": p.width, "h": p.height}, "rotated": False,
                    "trimmed": False, "spriteSourceSize": {"x": 0, "y": 0, "w": p.width, "h": p.height},
                    "sourceSize": {"w": p.width, "h": p.height}}
    x += p.width
atlas.save(os.path.join(ASSETS, "sprites", "houses.png"), optimize=True)
with open(os.path.join(ASSETS, "sprites", "houses.json"), "w", encoding="utf-8", newline="\n") as fh:
    json.dump({"frames": frames, "meta": {"image": "houses.png", "size": {"w": atlas.width,
               "h": atlas.height}, "scale": "1"}}, fh, indent=1)

print(f"town: {W}x{H}, {len(tiles)} tiles, {len(objects)} objects, {desk_count} desks")
