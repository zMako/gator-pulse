#!/usr/bin/env python3
"""Bake SF State campus geometry from OpenStreetMap into public/campus.json.

Output coordinates are local metres around ORIGIN: x = east, z = south.
Run: python3 scripts/bake_campus.py [--refresh]
"""
import json
import math
import pathlib
import random
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
CACHE = ROOT / "scripts" / ".cache" / "osm.json"
OUT = ROOT / "public" / "campus.json"

BBOX = (37.7160, -122.4890, 37.7300, -122.4710)
ORIGIN = (37.7232, -122.4790)
M_PER_LAT = 110540.0
M_PER_LON = 111320.0 * math.cos(math.radians(ORIGIN[0]))

ENDPOINTS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
]

QUERY = """[out:json][timeout:90];
(
  nwr["building"]({b});
  way["highway"]({b});
  nwr["leisure"]({b});
  nwr["natural"]({b});
  nwr["landuse"~"grass|meadow|forest|recreation_ground"]({b});
  nwr["amenity"="university"]({b});
);
out geom;"""

# OpenStreetMap has no height for these, so they are estimated from floor counts.
HEIGHTS = {
    "Administration": 20,
    "Burk Hall": 13,
    "Business": 16,
    "Centennial Square - Building A": 16,
    "Centennial Square - Building B": 16,
    "Centennial Square - Building C": 16,
    "Cesar Chavez Student Center": 17,
    "Cox Stadium": 6,
    "Creative Arts": 15,
    "Ethnic Studies & Psychology": 15,
    "Fine Arts": 13,
    "Gymnasium": 13,
    "HSS": 16,
    "Hensill Hall": 30,
    "Humanities": 21,
    "J. Paul Leonard Library": 27,
    "Lot 20 Parking Structure": 14,
    "Mary Park Hall": 21,
    "Mary Ward Hall": 21,
    "Mashouf Wellness Center": 14,
    "Science": 16,
    "Student Health Services": 9,
    "Student Services": 16,
    "Towers Conference Center": 7,
    "Towers Junior Suites": 24,
    "Towers at Centennial Square": 46,
    "Village at Centennial Square": 16,
}

GREEN_LEISURE = {"garden", "park", "common", "golf_course", "dog_park", "playground"}
GREEN_NATURAL = {"wood", "heath", "grassland", "scrub"}


def fetch():
    if CACHE.exists() and "--refresh" not in sys.argv:
        return json.loads(CACHE.read_text())
    query = "data=" + QUERY.format(b=",".join(map(str, BBOX)))
    for url in ENDPOINTS:
        # curl rather than urllib: python.org builds on macOS ship without a CA bundle.
        res = subprocess.run(
            ["curl", "-sS", "--fail", "-m", "120", "-A", "gator-pulse/0.1",
             "-H", "Accept: application/json", "--data-urlencode", query, url],
            capture_output=True,
        )
        if res.returncode == 0 and res.stdout.lstrip().startswith(b"{"):
            CACHE.parent.mkdir(parents=True, exist_ok=True)
            CACHE.write_bytes(res.stdout)
            return json.loads(res.stdout)
        print(f"{url} failed: {res.stderr.decode().strip()}", file=sys.stderr)
    sys.exit("All Overpass endpoints failed")


def project(lat, lon):
    return ((lon - ORIGIN[1]) * M_PER_LON, -(lat - ORIGIN[0]) * M_PER_LAT)


def ring_of(latlons):
    pts = [project(*ll) for ll in latlons]
    return pts[:-1] if len(pts) > 1 and pts[0] == pts[-1] else pts


def latlons_of(geometry):
    return [(g["lat"], g["lon"]) for g in geometry or [] if g]


def stitched_rings(relation, roles):
    """Join a multipolygon's member ways into closed rings."""
    segments = [
        latlons_of(m.get("geometry"))
        for m in relation.get("members", [])
        if m["type"] == "way" and m.get("role", "") in roles and m.get("geometry")
    ]
    rings = []
    while segments:
        cur = segments.pop(0)
        while cur[0] != cur[-1]:
            for i, seg in enumerate(segments):
                if seg[0] == cur[-1]:
                    cur = cur + seg[1:]
                elif seg[-1] == cur[-1]:
                    cur = cur + seg[-2::-1]
                else:
                    continue
                segments.pop(i)
                break
            else:
                break
        if cur[0] == cur[-1] and len(cur) >= 4:
            rings.append(ring_of(cur))
    return rings


def polygons(el):
    """[(outer ring, [hole rings])] for a closed way or a multipolygon relation."""
    if el["type"] == "way":
        ll = latlons_of(el.get("geometry"))
        return [(ring_of(ll), [])] if len(ll) >= 4 and ll[0] == ll[-1] else []
    if el["type"] == "relation":
        inners = stitched_rings(el, ("inner",))
        return [(o, [h for h in inners if inside(centroid(h), o)]) for o in stitched_rings(el, ("outer", ""))]
    return []


def area(ring):
    n = len(ring)
    return abs(sum(ring[i][0] * ring[(i + 1) % n][1] - ring[(i + 1) % n][0] * ring[i][1] for i in range(n))) / 2


def centroid(ring):
    return (sum(p[0] for p in ring) / len(ring), sum(p[1] for p in ring) / len(ring))


def inside(pt, ring):
    x, y = pt
    hit = False
    for i in range(len(ring)):
        x1, y1 = ring[i]
        x2, y2 = ring[(i + 1) % len(ring)]
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1:
            hit = not hit
    return hit


def bounds(ring):
    xs, ys = [p[0] for p in ring], [p[1] for p in ring]
    return min(xs), min(ys), max(xs), max(ys)


def flat(pts):
    return [round(v, 1) for p in pts for v in p]


def unflat(values):
    return list(zip(values[::2], values[1::2]))


def number(value):
    try:
        return float(str(value).split()[0].rstrip("m"))
    except (ValueError, IndexError):
        return None


def scatter(ring, count, rng, blockers=()):
    x0, y0, x1, y1 = bounds(ring)
    pts, tries = [], 0
    while len(pts) < count and tries < count * 30:
        tries += 1
        p = (rng.uniform(x0, x1), rng.uniform(y0, y1))
        if not inside(p, ring):
            continue
        if any(b[0] <= p[0] <= b[2] and b[1] <= p[1] <= b[3] and inside(p, r) for b, r in blockers):
            continue
        pts.append(p)
    return pts


def building_height(tags, on_campus, osm_id):
    name = tags.get("name")
    if name in HEIGHTS:
        return HEIGHTS[name]
    height, levels = number(tags.get("height")), number(tags.get("building:levels"))
    known = [v for v in (height if height and height > 2 else None, levels * 3.8 if levels else None) if v]
    if known:
        return max(known)
    return 12 if on_campus else 5.5 + (osm_id % 7) * 0.5


def main():
    elements = fetch()["elements"]
    rng = random.Random(7)

    campus = max(
        (outer for e in elements if e.get("tags", {}).get("amenity") == "university" for outer, _ in polygons(e)),
        key=area,
        default=None,
    )

    buildings, areas, paths, trees = [], [], [], []
    for el in elements:
        tags = el.get("tags", {})
        if el["type"] == "node":
            if tags.get("natural") == "tree":
                trees.append(project(el["lat"], el["lon"]))
            continue

        if "building" in tags:
            for outer, holes in polygons(el):
                if area(outer) < 12:
                    continue
                on_campus = bool(campus and inside(centroid(outer), campus))
                b = {"h": round(building_height(tags, on_campus, el["id"]), 1), "c": int(on_campus), "r": flat(outer)}
                if tags.get("name"):
                    b["n"] = tags["name"]
                if holes:
                    b["k"] = [flat(h) for h in holes]
                buildings.append(b)
            continue

        if "highway" in tags and el["type"] == "way":
            kind_tag = tags["highway"]
            if kind_tag in ("corridor", "platform", "proposed", "construction"):
                continue
            if kind_tag.split("_")[0] in ("trunk", "primary", "secondary", "tertiary"):
                kind = 0
            elif kind_tag in ("residential", "unclassified", "service", "living_street"):
                kind = 1
            else:
                kind = 2
            pts = [project(*ll) for ll in latlons_of(el.get("geometry"))]
            if len(pts) >= 2:
                paths.append({"t": kind, "p": flat(pts)})
            continue

        if tags.get("natural") == "water":
            kind = "w"
        elif tags.get("leisure") == "pitch":
            kind = "p"
        elif tags.get("natural") in GREEN_NATURAL or tags.get("leisure") in GREEN_LEISURE or "landuse" in tags:
            kind = "g"
        else:
            continue
        wooded = tags.get("natural") == "wood" or tags.get("landuse") == "forest"
        for outer, _ in polygons(el):
            size = area(outer)
            if size < 20:
                continue
            areas.append({"t": kind, "r": flat(outer)})
            if kind == "g":
                trees += scatter(outer, min(400, int(size / 90)) if wooded else min(50, round(size / 380)), rng)

    if campus:
        blocked = [unflat(b["r"]) for b in buildings if b["c"]] + [unflat(a["r"]) for a in areas if a["t"] == "p"]
        trees += scatter(campus, int(area(campus) / 650), rng, [(bounds(r), r) for r in blocked])

    trees = [p for p in trees if abs(p[0]) < 1500 and abs(p[1]) < 1500]
    data = {
        "buildings": buildings,
        "paths": paths,
        "areas": areas,
        "trees": flat(trees),
        "campus": flat(campus) if campus else [],
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(data, separators=(",", ":")))
    print(
        f"buildings {len(buildings)} (campus {sum(b['c'] for b in buildings)}, named {sum('n' in b for b in buildings)})"
        f" | paths {len(paths)} | areas {len(areas)} | trees {len(trees)}"
        f" | campus boundary {'yes' if campus else 'NO'} | {OUT.stat().st_size // 1024} KB"
    )


if __name__ == "__main__":
    main()
