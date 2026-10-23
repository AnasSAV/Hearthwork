"""
Build house interior art from LimeZu's Modern Interiors (16x16).

    python tools/art/build_interiors.py "D:/Personal/FocusTown-art"

Writes:
  client/public/assets/tilesets/furniture.png  one sprite per catalog item, packed
  client/public/assets/tilesets/room.png       wall and floor styles (3x2 tile blocks) + border
  shared/src/interiorSprites.ts                generated: sprite rectangles for both sheets

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
]
with open(MANIFEST, "w", encoding="utf-8", newline="\n") as fh:
    fh.write("\n".join(lines))
print(f"furniture: {len(item_rects)} sprites {furniture.size}; room: {len(room_rects)} blocks {room.size}")
