"""
Build house art from LimeZu's Modern Interiors and Modern Exteriors (16x16).

    python tools/art/build_interiors.py "D:/Personal/FocusTown-art"

Writes:
  client/public/assets/tilesets/furniture.png  one sprite per catalog item, packed
  client/public/assets/tilesets/room.png       wall and floor styles (3x2 tile blocks) + border
  client/public/assets/tilesets/yard.png       yard ground, path, fence and the Town signpost
  shared/src/interiorSprites.ts                generated: sprite rectangles for all three sheets

Garden items (catalog category `garden`) come from Modern Exteriors and go in the yard.

Catalog ids are kept from the earlier Kenney art so existing inventories and layouts stay valid; the
footprints live in shared/src/catalog.ts. A sprite is as wide as its item's footprint and may
be taller: it is drawn bottom-aligned, so the extra rows rise above the footprint (a bookshelf
against the wall, a painting reaching up the wall). Needs Python 3 + Pillow and the pack.
"""
import os
import sys

from PIL import Image

SRC = sys.argv[1] if len(sys.argv) > 1 else "D:/Personal/FocusTown-art"
MI = os.path.join(SRC, "Interior", "1_Interiors", "16x16")
SINGLES = os.path.join(MI, "Theme_Sorter_Singles")
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
TILESETS = os.path.join(ROOT, "client", "public", "assets", "tilesets")
MANIFEST = os.path.join(ROOT, "shared", "src", "interiorSprites.ts")
T = 16

FOLDERS = {
    "living": "2_Living_Room_Singles/Living_Room_Singles_{}.png",
    "bedroom": "4_Bedroom_Singles/Bedroom_Singles_{}.png",
    "library": "5_Classroom_and_Library_Singles/Classroom_and_Library_Singles_{}.png",
    "music": "6_Music_and_Sport/Music_and_sport_Singles_{}.png",
    "art": "7_Art_Singles/Art_Singles_{}.png",
    "kitchen": "12_Kitchen_Singles/Kitchen_Singles_{}.png",
}
THEME_SHEETS = {"livingsheet": "Theme_Sorter/2_LivingRoom_16x16.png"}

ME = os.path.join(SRC, "Exterior", "Modern_Exteriors_16x16", "ME_Theme_Sorter_16x16")
_EXT = {}
for folder in os.listdir(ME):
    if folder.endswith("_Singles_16x16"):
        for f in os.listdir(os.path.join(ME, folder)):
            if f.endswith(".png"):
                key = f[:-4][: -len("_16x16")] if f[:-4].endswith("_16x16") else f[:-4]
                _EXT[key] = os.path.join(ME, folder, f)


def ext(name):
    """A Modern Exteriors single, found by the end of its file name."""
    hits = [p for k, p in _EXT.items() if k == name or k.endswith("_" + name)]
    if len(hits) != 1:
        raise SystemExit(f"{name}: {len(hits)} matches")
    return Image.open(hits[0]).convert("RGBA")


def terrain(x, y, w=1, h=1):
    im = Image.open(os.path.join(ME, "1_Terrains_and_Fences_16x16.png")).convert("RGBA")
    return im.crop((x * T, y * T, (x + w) * T, (y + h) * T))


def single(kind, number):
    pattern = FOLDERS[kind]
    path = os.path.join(SINGLES, pattern.format(number))
    if not os.path.exists(path):  # some folders spell the prefix differently
        folder = os.path.dirname(os.path.join(SINGLES, pattern))
        hits = [f for f in os.listdir(folder) if f.endswith(f"_{number}.png")]
        if len(hits) != 1:
            raise SystemExit(f"{kind} {number}: {hits}")
        path = os.path.join(folder, hits[0])
    return Image.open(path).convert("RGBA")


def sheet(name, x, y, w, h):
    im = Image.open(os.path.join(MI, THEME_SHEETS[name])).convert("RGBA")
    return im.crop((x * T, y * T, (x + w) * T, (y + h) * T))


# id -> image. The sprite width must match the catalog footprint width.
ITEMS = {
    # Tables and desks (study spots: sit on the tile below)
    "table_long": single("kitchen", 310),
    "table_oval": single("kitchen", 322),
    "table_round": single("kitchen", 311),
    "table_side": single("living", 63),
    "table_low": single("living", 51),
    "desk_study": single("library", 25),
    # Seats and beds
    "chair_wood": single("kitchen", 280),
    "chair_cushion": single("kitchen", 282),
    "bed_orange": single("bedroom", 221),
    "bed_green": single("bedroom", 223),
    "bed_single": single("bedroom", 144),
    "couch_orange": sheet("livingsheet", 7, 28, 2, 2),
    "couch_green": sheet("livingsheet", 1, 28, 3, 2),
    # Storage and big pieces
    "piano": single("music", 1),
    "dresser": single("living", 55),
    "drawers": single("living", 57),
    "counter": single("kitchen", 121),
    "cabinet_books": single("library", 59),
    "cabinet_potions": single("living", 41),
    "shelf_wide": single("library", 57),
    "mirror_standing": single("bedroom", 420),
    "mirror_gilded": single("living", 89),
    # Small decor
    "stool": single("kitchen", 290),
    "pouf": single("living", 8),
    "vase_bronze": single("art", 1),
    "vase_silver": single("art", 7),
    "candelabra_silver": single("living", 72),
    "candelabra_gold": single("living", 71),
    # Rugs
    "rug_amber": single("bedroom", 385),
    "rug_oval": single("bedroom", 383),
    "rug_teal": single("kitchen", 236),
    "rug_moss": single("kitchen", 226),
    "rug_cream": single("bedroom", 382),
    # Wall decor
    "painting_meadow": single("art", 46),
    "painting_sunset": single("art", 45),
    "painting_lagoon": single("art", 43),
    "painting_scroll": single("art", 44),
    "gallery_frames": single("library", 33),
    "shield_round": single("music", 129),
    "torch": single("music", 96),
    # Plants
    "plant_fern": single("living", 16),
    "plant_bush": single("living", 17),
    "plant_mushrooms": single("living", 15),
    "plant_sprout": single("art", 21),
    # Garden (yard only)
    "garden_tree_round": ext("Camping_16x16_Tree_145"),
    "garden_tree_pine": ext("Camping_16x16_Tree_185"),
    "garden_bush": ext("Garden_16x16_Bush_20"),
    "garden_hedge": ext("Garden_16x16_Bush_14"),
    "garden_topiary": ext("Garden_16x16_Bush_Potted_6"),
    "garden_flowers_blue": ext("Villa_Yard_Flowers_4"),
    "garden_flowers_pink": ext("Villa_Yard_Flowers_5"),
    "garden_flowers_white": ext("Villa_Yard_Flowers_6"),
    "garden_bench": ext("City_Props_16x16_Bench_1"),
    "garden_table": ext("Camping_16x16_Table_6"),
    "garden_lamp": ext("Street_Lamp_5"),
    "garden_fountain": ext("Fountain_1_1"),
    "garden_bbq": ext("Barbecue_1"),
    "garden_mailbox": ext("Red_Mailbox_1_Front"),
    "garden_sunflowers": ext("Sunflower_Bench"),
    "garden_planter": ext("Sprout_Square_Bench"),
    "garden_birdhouse": ext("Blue_Big_Bird_House"),
}

WALLS_SRC = os.path.join(MI, "Room_Builder_subfiles", "Room_Builder_Walls_16x16.png")
FLOORS_SRC = os.path.join(MI, "Room_Builder_subfiles", "Room_Builder_Floors_16x16.png")
BORDERS_SRC = os.path.join(MI, "Room_Builder_subfiles", "Room_Builder_borders_16x16.png")
# Style -> top-left tile of a 3x2 block (walls: top row + baseboard row; floors: repeat 3x2).
WALLS = {"default": (0, 8), "wall_wood": (11, 18), "wall_stone": (0, 16), "wall_pale": (0, 6)}
FLOORS = {"default": (0, 24), "floor_oak": (0, 12), "floor_amber": (8, 10), "floor_moss": (12, 26)}


def pack(images, width_tiles=16):
    """Shelf-pack images (tallest first) into a sheet; returns (sheet, {id: (x, y, w, h)})."""
    order = sorted(images, key=lambda k: (-images[k].height, -images[k].width, k))
    x = y = shelf = 0
    rects = {}
    for k in order:
        w, h = images[k].width // T, images[k].height // T
        if x + w > width_tiles:
            x, y, shelf = 0, y + shelf, 0
        rects[k] = (x, y, w, h)
        x += w
        shelf = max(shelf, h)
    out = Image.new("RGBA", (width_tiles * T, (y + shelf) * T))
    for k, (x, y, w, h) in rects.items():
        out.paste(images[k], (x * T, y * T))
    return out, rects


for k, im in ITEMS.items():
    if im.width % T or im.height % T:
        raise SystemExit(f"{k}: {im.size} is not whole tiles")
furniture, item_rects = pack(ITEMS)
furniture.save(os.path.join(TILESETS, "furniture.png"), optimize=True)

walls = Image.open(WALLS_SRC).convert("RGBA")
floors = Image.open(FLOORS_SRC).convert("RGBA")
borders = Image.open(BORDERS_SRC).convert("RGBA")
room_blocks = {}
for name, (x, y) in WALLS.items():
    room_blocks["wall:" + name] = walls.crop((x * T, y * T, (x + 3) * T, (y + 2) * T))
for name, (x, y) in FLOORS.items():
    room_blocks["floor:" + name] = floors.crop((x * T, y * T, (x + 3) * T, (y + 2) * T))
room_blocks["border"] = borders.crop((7 * T, 0, 8 * T, T))
room, room_rects = pack(room_blocks, width_tiles=12)
room.save(os.path.join(TILESETS, "room.png"), optimize=True)

FENCE = "24_Additional_Houses_Fence_1_"
yard_blocks = {
    "grass": terrain(1, 17),
    "grass_tuft": terrain(1, 7),
    "path": ext("City_Terrains_16x16_Sidewalk_1_25"),
    "sign": ext("Camping_16x16_Sign_6"),
}
for name, piece in (("fence_tl", "Top_Left"), ("fence_t", "Top_Middle"), ("fence_tr", "Top_Right"),
                    ("fence_l", "Middle_Left"), ("fence_r", "Middle_Right"),
                    ("fence_bl", "Bottom_Left"), ("fence_b", "Bottom_Middle"),
                    ("fence_br", "Bottom_Right")):
    yard_blocks[name] = ext(FENCE + piece)
yard, yard_rects = pack(yard_blocks, width_tiles=8)
yard.save(os.path.join(TILESETS, "yard.png"), optimize=True)


def ts_rects(rects):
    return "\n".join(f"  {json_key(k)}: [{', '.join(map(str, r))}]," for k, r in sorted(rects.items()))


def json_key(k):
    return k if k.isidentifier() else f"'{k}'"


lines = [
    "// GENERATED by tools/art/build_interiors.py from LimeZu's Modern Interiors. Do not edit.",
    "// Rectangles are [x, y, w, h] in 16px tiles.",
    "",
    f"export const FURNITURE_SHEET = {{ width: {furniture.width}, height: {furniture.height} }} as const;",
    f"export const ROOM_SHEET = {{ width: {room.width}, height: {room.height} }} as const;",
    f"export const YARD_SHEET = {{ width: {yard.width}, height: {yard.height} }} as const;",
    "",
    "/** Catalog item id -> sprite in furniture.png. */",
    "export const FURNITURE_SPRITES: Record<string, readonly [number, number, number, number]> = {",
    ts_rects(item_rects),
    "};",
    "",
    "/** `wall:<style>` / `floor:<style>` (3x2 blocks) and `border` -> rectangle in room.png. */",
    "export const ROOM_SPRITES: Record<string, readonly [number, number, number, number]> = {",
    ts_rects(room_rects),
    "};",
    "",
    "/** Yard ground, path (2x2), fence pieces and the Town signpost -> rectangle in yard.png. */",
    "export const YARD_SPRITES: Record<string, readonly [number, number, number, number]> = {",
    ts_rects(yard_rects),
    "};",
    "",
]
with open(MANIFEST, "w", encoding="utf-8", newline="\n") as fh:
    fh.write("\n".join(lines))
print(f"furniture: {len(item_rects)} sprites {furniture.size}; room: {len(room_rects)} blocks "
      f"{room.size}; yard: {len(yard_rects)} pieces {yard.size}")
