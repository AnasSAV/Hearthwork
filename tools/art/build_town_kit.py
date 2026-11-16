"""
Build the town builder's kit: every piece you can drag onto the town, and the ground tiles.

    python tools/art/build_town_kit.py "D:/Personal/FocusTown-art"            # kit only
    python tools/art/build_town_kit.py "D:/Personal/FocusTown-art" --starter  # + starter town

Writes:
  tools/town-builder/kit/kit.png    one atlas: piece pictures, animation strips, ground tiles
  tools/town-builder/kit/kit.json   what each piece is (size, what's solid, what it adds to the
                                    map: a building, desks, a tree, an animation...)
  tools/town-builder/town.layout.json  (--starter only) today's town, rebuilt from pieces, as a
                                    starting point; after that the builder owns this file

The town builder (`npm run editor`) turns a layout into the Tiled map the game loads. Needs
Python 3 + Pillow and the LimeZu pack (credit LimeZu; only the derived files are committed).
"""
import glob
import json
import os
import random
import sys

from PIL import Image

SRC = sys.argv[1] if len(sys.argv) > 1 and not sys.argv[1].startswith("--") else "D:/Personal/FocusTown-art"
STARTER = "--starter" in sys.argv
BASE = os.path.join(SRC, "Exterior", "Modern_Exteriors_16x16")
ME = os.path.join(BASE, "ME_Theme_Sorter_16x16")
ANIMATED = os.path.join(BASE, "Animated_16x16", "Animated_sheets_16x16")
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(ROOT, "tools", "town-builder")
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
    if name not in _sheets:
        _sheets[name] = Image.open(os.path.join(ME, f"{name}_16x16.png")).convert("RGBA")
    return _sheets[name].crop((x * T, y * T, (x + w) * T, (y + h) * T))


def size(im):
    return im.width // T, im.height // T


# ---------------------------------------------------------------------------------------------
# Atlas packing (shelves)
# ---------------------------------------------------------------------------------------------

ATLAS_W = 1024
_atlas_items = []  # (image, callback(x, y))


def pack(image):
    """Reserve room for `image`; returns a dict filled with x/y when the atlas is written."""
    slot = {"w": image.width, "h": image.height}
    _atlas_items.append((image, slot))
    return slot


# ---------------------------------------------------------------------------------------------
# Pieces
# ---------------------------------------------------------------------------------------------

prefabs = []


def piece(pid, name, category, image, solid="all", above=0, kind="tiles", base=None, **extra):
    """
    A piece the builder can place. `solid`: "all", None, or (col, row) cells. `above`: top rows
    drawn over players. `base`: cells no other piece may share (default: the solid cells, or the
    bottom row if nothing is solid).
    """
    w, h = size(image)
    if solid == "all":
        # Every tile with something drawn in it (empty corners of a picture stay walkable).
        solid_cells = [(c, r) for r in range(h) for c in range(w)
                       if image.crop((c * T, r * T, c * T + T, r * T + T)).getextrema()[3][1] > 0]
    else:
        solid_cells = list(solid or [])
    base_cells = base if base is not None else (solid_cells or [(c, h - 1) for c in range(w)])
    # The first row with anything drawn in it: signs go just above it, not above empty space.
    top = next((r for r in range(h) if image.crop((0, r * T, image.width, r * T + T)).getextrema()[3][1] > 0), 0)
    prefabs.append({
        "id": pid, "name": name, "category": category, "kind": kind, "w": w, "h": h, "top": top,
        "frame": pack(image), "solid": [list(c) for c in solid_cells],
        "base": [list(c) for c in base_cells], "above": above, **extra,
    })


# Buildings. The Furniture Shop is the one the game needs (its door opens the shop).
piece("shop", "Furniture Shop", "buildings", img("Hardware_Store_Example"), kind="building",
      unique=True, building={"name": "shop", "label": "Furniture Shop", "doorCol": 2})
BUILDINGS = [
    ("library", "Library", "Victorian_House_5"),
    ("clock-tower", "Clock Tower", "School_16x16_Clock_Tower_1"),
    ("bakery", "Bakery", "Ground_Floor_Bakery_1"),
    ("ice-cream", "Ice Cream Parlour", "Ground_Floor_Ice_Cream_Shop_1"),
    ("market", "Market", "Market_Medium_1"),
    ("bait-shop", "Bait Shop", "Ground_Floor_Bait_Shop_1"),
    ("coffee-kiosk", "Coffee Kiosk", "Kiosk_Coffee_Cup_Example"),
    ("mushroom-kiosk", "Mushroom Kiosk", "Kiosk_Mushroom_Example"),
    ("info-kiosk", "Info Point", "Kiosk_Infopoint_1"),
    ("greenhouse", "Greenhouse", "Large_Greenhouse_Example"),
    ("pergola", "Pergola", "Pergola_Example"),
    ("country-house", "Country House", "Additional_Houses_Country_House"),
    ("japanese-house", "Japanese House", "Additional_Houses_Japanese_House"),
    ("villa-orange", "Orange Villa", "Villas_16x16_Villa_1"),
    ("villa-brown", "Brown Villa", "Villas_16x16_Villa_2"),
    ("villa-red", "Red Villa", "Villas_16x16_Villa_3"),
]
for pid, name, image_name in BUILDINGS:
    try:
        image = img(image_name)
    except SystemExit as e:
        print("skipping", pid, e)
        continue
    piece(pid, name, "buildings", image, kind="building", building={"name": pid, "label": name})

# Study spots: chairs either side of a table; seated players face the table.
CHAIR_RIGHT = img("Camping_16x16_Chair_13", flip=True)
CHAIR_LEFT = img("Camping_16x16_Chair_13")


def table_pair_image(table_name):
    """Chair, 2-wide table, chair; the seat tiles are on row 1."""
    table = img(table_name)
    tw, th = size(table)
    h = max(th, size(CHAIR_LEFT)[1])
    im = Image.new("RGBA", (4 * T, h * T))
    im.alpha_composite(CHAIR_RIGHT, (0, 0))
    im.alpha_composite(table, (T, 0))
    im.alpha_composite(CHAIR_LEFT, (3 * T, 0))
    solid = [(1 + c, r) for r in range(th) for c in range(tw)]
    return im, solid


TABLES = [("Camping_16x16_Table_5", "Blue"), ("Camping_16x16_Table_6", "Green"),
          ("Camping_16x16_Table_7", "Wooden"), ("Camping_16x16_Table_8", "Café")]
for table_name, look in TABLES:
    im, _ = table_pair_image(table_name)
    # 4x1 on the grid: everything is drawn on the seat row except a 3 px sliver (chair tops and
    # the table's top edge), which overhangs the row above like a tree top does.
    piece(f"desk-pair-{look.lower().replace('é', 'e')}", f"{look} table, 2 seats", "study", im,
          solid=[(1, 1), (2, 1)], base=[(c, 1) for c in range(4)], kind="desks",
          seats=[{"c": 0, "r": 1, "facing": "right"}, {"c": 3, "r": 1, "facing": "left"}])

# A group table: three pairs in a column, six seats sharing one Pomodoro.
pair, pair_solid = table_pair_image("Camping_16x16_Table_5")
ph = size(pair)[1]
group = Image.new("RGBA", (4 * T, (4 + ph) * T))
for k in range(3):
    group.alpha_composite(pair, (0, 2 * k * T))
group_solid = [(c, r + 2 * k) for k in range(3) for c, r in pair_solid]
piece("group-table", "Group table, 6 seats", "study", group, solid=group_solid,
      base=group_solid + [(c, 1 + 2 * k) for k in range(3) for c in (0, 3)], kind="desks", group=True,
      seats=[{"c": c, "r": 1 + 2 * k, "facing": f} for k in range(3) for c, f in ((0, "right"), (3, "left"))])
# A café row: three pairs side by side, also one shared Pomodoro.
cafe, cafe_solid = table_pair_image("Camping_16x16_Table_8")
row = Image.new("RGBA", (16 * T, size(cafe)[1] * T))
for k in range(3):
    row.alpha_composite(cafe, (6 * k * T, 0))
row_solid = [(c + 6 * k, r) for k in range(3) for c, r in cafe_solid]
piece("cafe-row", "Café row, 6 seats", "study", row, solid=row_solid,
      base=row_solid + [(c + 6 * k, 1) for k in range(3) for c in (0, 3)], kind="desks", group=True,
      seats=[{"c": c + 6 * k, "r": 1, "facing": f} for k in range(3) for c, f in ((0, "right"), (3, "left"))])

# Trees: drawn by the game as swaying sprites; only the trunk is solid.
TREES = ["Camping_16x16_Tree_1", "Camping_16x16_Tree_13", "Camping_16x16_Tree_49",
         "Camping_16x16_Tree_9", "Camping_16x16_Tree_61", "Camping_16x16_Tree_157",
         "Camping_16x16_Tree_97", "Camping_16x16_Tree_145", "Camping_16x16_Tree_185",
         "Camping_16x16_Tree_197"]


def trunk_cells(w, h, rows=2):
    cols = [w // 2 - 1, w // 2] if w >= 4 else ([0, 1] if w == 2 else [w // 2])
    return [(c, h - 1 - r) for r in range(rows) for c in cols]


for i, name in enumerate(TREES):
    image = img(name)
    w, h = size(image)
    piece(f"tree-{name.split('_')[-1]}", f"Tree {i + 1}", "nature", image, solid=trunk_cells(w, h),
          kind="tree", tree={"name": name, "trunk": 2})

for name, label in (("Garden_16x16_Bush_20", "Round bush"), ("Garden_16x16_Bush_22", "Hedge bush")):
    image = img(name)
    w, h = size(image)
    piece(f"bush-{name[-2:]}", label, "nature", image, solid=[(c, h - 1) for c in range(w)], above=h - 1)
for n in (1, 2, 3, 4, 5, 6):
    image = img(f"Villa_Yard_Flowers_{n}")
    piece(f"flowers-{n}", f"Flower bed {n}", "nature", image, solid=None, flowers=True)
for n in (9, 10, 11):
    piece(f"grass-{n}", f"Grass tuft {n - 8}", "nature", img(f"Terrains_and_Fences_16x16_Props_Grass_{n}"),
          solid=None, layer="decor")
for n, label in ((1, "Rock"), (2, "Big rock"), (5, "Mossy rock")):
    image = img(f"Camping_16x16_Rock_{n}")
    piece(f"rock-{n}", label, "nature", image)

# A raised planter: stone curb with a tree in it.
CURB = sheet("1_Terrains_and_Fences", 0, 16, 3, 3)
tree = img("Camping_16x16_Tree_145")
tw, th = size(tree)
ph = max(3, th)
planter = Image.new("RGBA", (4 * T, ph * T))
for y in range(3):
    for x in range(4):
        c = 0 if x == 0 else 2 if x == 3 else 1
        r = 0 if y == 0 else 2 if y == 2 else 1
        planter.alpha_composite(CURB.crop((c * T, r * T, c * T + T, r * T + T)), (x * T, (ph - 3 + y) * T))
planter.alpha_composite(tree, ((4 - tw) // 2 * T, (ph - th) * T))
piece("planter", "Planter with tree", "nature", planter,
      solid=[(c, ph - 3 + r) for r in range(3) for c in range(4)], above=ph - 1)

# Decor.
piece("bench", "Bench", "decor", img("City_Props_16x16_Bench_1"), solid=[(0, 1), (1, 1)])
piece("long-bench", "Long bench", "decor", img("City_Props_16x16_Bench_2"), solid=[(0, 1), (1, 1), (2, 1)])
piece("flower-bench", "Flower bench", "decor", img("Flowers_Bench_Horizontal"))
piece("lamp", "Street lamp", "decor", img("Street_Lamp_5"), solid=[(0, 3)], above=2)
piece("bin", "Bin", "decor", img("City_Props_16x16_Trashbin_1"), solid=[(0, 1)], above=1)
piece("potted-bush", "Potted bush", "decor", img("Garden_16x16_Bush_Potted_2"), solid=[(0, 1)], above=1)
piece("potted-tree", "Potted shrub", "decor", img("Garden_16x16_Bush_Potted_4"), solid=[(0, 1)], above=1)
piece("fountain", "Plaza fountain", "decor", img("Fountain_3_1"))
piece("food-cart", "Food cart", "decor", img("Street_Food_Cart_2"), solid=[(c, 2) for c in range(3)], above=2)
piece("umbrella", "Parasol", "decor", img("Umbrella_2"), solid=[(1, 3)], above=2)
piece("signpost", "Signpost", "decor", img("Camping_16x16_Sign_1"), solid=[(0, size(img("Camping_16x16_Sign_1"))[1] - 1)])

# Animated pieces: the game plays them from the town-anims atlas the builder writes.
def strip(file, crop=None):
    s = Image.open(os.path.join(ANIMATED, file)).convert("RGBA")
    if crop:
        s = s.crop((crop[0], crop[1], crop[0] + crop[2], crop[1] + crop[3]))
    return s


ANIMS = [
    ("flag", "Flag", "School_Flag_1_16x16.png", 3, 9, 8, None, [(c, 8) for c in range(3)], False),
    ("garden-fountain", "Garden fountain", "Garden_Fountain_1_16x16.png", 2, 3, 8, None, [(0, 2), (1, 2)], False),
    ("fish1", "Fish", "Fishes_1_16x16.png", 1, 1, 6, None, [], True),
    ("fish2", "More fish", "Fishes_2_16x16.png", 1, 1, 6, None, [], True),
    ("gull-right", "Seagull (right)", "Beach_Seagull_Complete_16x16.png", 2, 2, 5, (0, 32, 192, 32), [], False),
    ("gull-left", "Seagull (left)", "Beach_Seagull_Complete_16x16.png", 2, 2, 5, (384, 32, 192, 32), [], False),
]
for name, label, file, fw, fh, fps, crop, solid_cells, on_water in ANIMS:
    s = strip(file, crop)
    first = s.crop((0, 0, fw * T, fh * T))
    frames = s.width // (fw * T)
    piece(name, label, "water" if on_water else "decor", first, solid=solid_cells, kind="anim",
          base=solid_cells or [(c, fh - 1) for c in range(fw)], onWater=on_water,
          anim={"name": name, "frames": frames, "fps": fps, "strip": pack(s)})

piece("spawn", "Arrival point", "special", Image.new("RGBA", (T, T)), solid=None, kind="spawn",
      unique=True, base=[(0, 0)])

# ---------------------------------------------------------------------------------------------
# Ground tiles
# ---------------------------------------------------------------------------------------------


def autotile(sheet_name, ox, oy):
    """9-slice plus four inner corners, laid out as in the pack: `body` meets `outside`."""
    return {
        "slice": [pack(sheet(sheet_name, ox + c, oy + r)) for r in range(3) for c in range(3)],
        "inner": [pack(sheet(sheet_name, ox + 3, oy)), pack(sheet(sheet_name, ox + 4, oy)),
                  pack(sheet(sheet_name, ox + 3, oy + 1)), pack(sheet(sheet_name, ox + 4, oy + 1))],
    }


PAVING = [img(f"City_Terrains_16x16_Sidewalk_1_{n}") for n in (25, 26, 27, 28)]
terrain = {
    "grass": [pack(sheet("1_Terrains_and_Fences", 1, 17)), pack(sheet("1_Terrains_and_Fences", 1, 7))],
    "paving": [[pack(block.crop((c * T, r * T, c * T + T, r * T + T))) for r in range(2) for c in range(2)]
               for block in PAVING],
    "water": autotile("1_Terrains_and_Fences", 0, 35),
    "sand": autotile("21_Beach", 0, 1),
}

# ---------------------------------------------------------------------------------------------
# Write the atlas and kit
# ---------------------------------------------------------------------------------------------

x = y = shelf = 0
placed = []
for image, slot in sorted(_atlas_items, key=lambda it: -it[0].height):
    if x + image.width > ATLAS_W:
        x, y, shelf = 0, y + shelf, 0
    slot["x"], slot["y"] = x, y
    placed.append((image, x, y))
    x += image.width
    shelf = max(shelf, image.height)
atlas = Image.new("RGBA", (ATLAS_W, y + shelf))
for image, px, py in placed:
    atlas.alpha_composite(image, (px, py))
os.makedirs(os.path.join(OUT, "kit"), exist_ok=True)
atlas.save(os.path.join(OUT, "kit", "kit.png"), optimize=True)
with open(os.path.join(OUT, "kit", "kit.json"), "w", encoding="utf-8", newline="\n") as fh:
    json.dump({"tile": T, "prefabs": prefabs, "terrain": terrain}, fh, indent=1)
print(f"kit: {len(prefabs)} pieces, atlas {atlas.width}x{atlas.height}")

# ---------------------------------------------------------------------------------------------
# Starter layout: today's town (tools/art/build_town.py), rebuilt from the pieces
# ---------------------------------------------------------------------------------------------

if STARTER:
    W, H = 68, 50
    ground = [["." for _ in range(W)] for _ in range(H)]

    def fill(ch, x0, y0, x1, y1):
        for yy in range(y0, y1 + 1):
            for xx in range(x0, x1 + 1):
                ground[yy][xx] = ch

    for rect in ((14, 19, 53, 33), (4, 18, 63, 18), (32, 34, 35, 40), (4, 40, 63, 41), (4, 35, 24, 39)):
        fill("#", *rect)
    fill("~", 44, 43, 55, 46)

    pieces = []

    def put(pid, px, py, **props):
        pieces.append({"uid": len(pieces) + 1, "prefab": pid, "x": px, "y": py, **props})

    by_id = {p["id"]: p for p in prefabs}
    put("shop", 6, 9)
    put("library", 25, 2)
    put("clock-tower", 54, 3, label="")
    # A table pair's top-left is one column left of its table and one row above its seats.
    put("group-table", 19, 21)
    put("group-table", 45, 21)
    for tx, look in ((16, "wooden"), (22, "green"), (42, "green"), (48, "wooden")):
        put(f"desk-pair-{look}", tx, 30)
    put("planter", 26, 23 - by_id["planter"]["h"])
    put("planter", 38, 23 - by_id["planter"]["h"])
    for tx in (17, 27, 39, 50):
        put("potted-bush", tx, 32)
    for tx, ty in ((15, 19), (52, 19), (15, 28), (52, 28)):
        put("lamp", tx, ty - 1)
    put("long-bench", 26, 28)
    put("long-bench", 38, 28)
    # One row higher than build_town.py put them: there they overlapped the group tables.
    put("flower-bench", 21, 18)
    put("flower-bench", 44, 18)
    put("bin", 30, 28)
    put("bin", 37, 28)
    put("fountain", 32, 23)
    put("flag", 21, 9)
    put("flag", 44, 9)
    for fx, fy, n in ((16, 10, 4), (16, 13, 5), (46, 12, 6), (49, 14, 4), (8, 43, 4), (11, 44, 5),
                      (14, 43, 6), (17, 44, 4)):
        put(f"flowers-{n}", fx, fy)
    put("bench", 19, 15)
    put("bench", 49, 10)
    put("cafe-row", 6, 36)
    put("food-cart", 22, 34)
    for tx in (5, 11, 17):
        put("potted-tree", tx, 34)
    put("umbrella", 4, 36)
    put("desk-pair-wooden", 40, 36)
    put("desk-pair-wooden", 46, 36)
    put("garden-fountain", 53, 35)
    put("bench", 56, 37)
    put("bench", 59, 37)
    for fname, fx, fy in (("fish1", 46, 44), ("fish2", 50, 45), ("fish1", 53, 44)):
        put(fname, fx, fy)
    put("bench", 40, 43)
    put("gull-right", 42, 45)
    put("gull-left", 57, 44)
    for lx in (10, 28, 39, 58):
        put("lamp", lx, 39)
    put("bench", 22, 43)
    put("spawn", 34, 35)

    # The forest round the edge, then a few trees on the open grass, kept off everything else.
    rnd = random.Random(7)
    taken = set()
    for p in pieces:
        f = by_id[p["prefab"]]
        for yy in range(-1, f["h"] + 1):
            for xx in range(-1, f["w"] + 1):
                taken.add((p["x"] + xx, p["y"] + yy))
    border = ["tree-1", "tree-13", "tree-49", "tree-9", "tree-61", "tree-157"]
    spots = []
    for bx in range(-2, W, 3):
        spots += [(bx, -1), (bx + 1, 1), (bx, H - 4), (bx + 1, H - 6)]
    for by in range(-1, H, 3):
        spots += [(-1, by), (1, by + 1), (W - 3, by), (W - 5, by + 1)]
    spots.sort(key=lambda p: (p[1], p[0]))
    for bx, by in spots:
        pid = rnd.choice(border)
        f = by_id[pid]
        cells = {(bx + c, by + r) for c, r in f["base"]}
        if any(not (0 <= cx < W and 0 <= cy < H) for cx, cy in cells) or cells & taken:
            continue
        if any(ground[cy][cx] != "." for cx, cy in cells):
            continue
        put(pid, bx, by)
        taken |= cells
    scatter = ["tree-1", "tree-49", "tree-97", "tree-145", "tree-185", "tree-197", "bush-22", "bush-20"]
    for sy in range(3, H - 6):
        for sx in range(3, W - 6):
            if rnd.random() >= 0.06:
                continue
            pid = rnd.choice(scatter)
            f = by_id[pid]
            area = {(sx + c, sy + r) for r in range(f["h"]) for c in range(f["w"])}
            ring = {(cx + dx, cy + dy) for cx, cy in area for dx in (-1, 0, 1) for dy in (-1, 0, 1)}
            if ring & taken or any(not (0 <= cx < W and 0 <= cy < H) or ground[cy][cx] != "."
                                   for cx, cy in ring):
                continue
            put(pid, sx, sy)
            taken |= area
    layout = {"version": 1, "width": W, "height": H, "ground": ["".join(r) for r in ground],
              "pieces": pieces}
    with open(os.path.join(OUT, "town.layout.json"), "w", encoding="utf-8", newline="\n") as fh:
        json.dump(layout, fh, indent=1)
    print(f"starter town: {W}x{H}, {len(pieces)} pieces")
