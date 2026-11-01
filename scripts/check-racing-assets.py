#!/usr/bin/env python3
"""Read-only image QA. --refresh writes metadata and an original-image HTML board.

Requires Pillow. Never crops, rescales, recolors, encodes or otherwise saves images.
Run: python3 scripts/check-racing-assets.py --refresh
Without --refresh, verifies saved metadata as well as current source images.
"""
import argparse
import hashlib
import html
import json
from pathlib import Path
import sys
import xml.etree.ElementTree as ET

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / "assets/racing/manifest.json"
BOARD = MANIFEST.with_name("contact-sheet.html")
MEASUREMENTS = ("width", "height", "bytes", "sha256", "mode", "rawAlphaBounds",
                "alphaBounds", "padding", "anchor", "decodedBytes", "status")


def bounds_dict(bounds):
    if bounds is None:
        return None
    x, y, right, bottom = bounds
    return {"x": x, "y": y, "w": right - x, "h": bottom - y}


def image_info(entry, rider, manifest, errors, warnings):
    src = entry["src"]
    path = (ROOT / src).resolve()
    if not path.is_relative_to(ROOT) or not path.is_file():
        errors.append(f"Missing or out-of-repository asset: {src}")
        return {"status": "missing"}
    try:
        with Image.open(path) as probe:
            probe.verify()
        with Image.open(path) as im:
            im.load()
            width, height = im.size
            alpha = im.getchannel("A") if "A" in im.getbands() else None
            visible = alpha.point(lambda a: 255 if a >= manifest["art"]["alphaBoundsThreshold"] else 0) if alpha else None
            raw_box, box = (alpha.getbbox(), visible.getbbox()) if alpha else (None, None)
            result = {"width": width, "height": height, "bytes": path.stat().st_size,
                      "sha256": hashlib.sha256(path.read_bytes()).hexdigest(), "mode": im.mode,
                      "decodedBytes": width * height * 4, "status": "ready"}
            if width > manifest["budgets"]["maxImageDimension"] or height > manifest["budgets"]["maxImageDimension"]:
                errors.append(f"Oversized image dimensions: {src}")
            budget = manifest["budgets"]["maxRiderBytes" if rider else "maxBackgroundBytes"]
            if result["bytes"] > budget:
                errors.append(f"Asset exceeds byte budget ({result['bytes']} > {budget}): {src}")
            if rider:
                if alpha is None or alpha.getextrema()[0] != 0 or box is None:
                    errors.append(f"Rider requires real transparent padding and visible pixels: {src}")
                    result["status"] = "invalid"
                else:
                    x, y, right, bottom = box
                    padding = {"left": x, "top": y, "right": width - right, "bottom": height - bottom}
                    result.update(rawAlphaBounds=bounds_dict(raw_box), alphaBounds=bounds_dict(box),
                                  padding=padding, anchor={"x": .5, "y": round(bottom / height, 8)})
                    if min(padding.values()) < manifest["budgets"]["minRiderVisiblePadding"]:
                        errors.append(f"Visible rider pixels violate 16px safe padding {padding}: {src}")
                    if raw_box and (raw_box[0] == 0 or raw_box[1] == 0 or raw_box[2] == width or raw_box[3] == height):
                        warnings.append(f"Near-invisible alpha below threshold reaches image edge: {src}")
            elif alpha and alpha.getextrema()[0] < 255:
                errors.append(f"Backdrop must be opaque: {src}")
            if not rider and abs(width / height - 2) > .05:
                errors.append(f"Backdrop must be approximately 2:1: {src}")
            return result
    except (OSError, ValueError) as exc:
        errors.append(f"Cannot decode {src}: {exc}")
        return {"status": "invalid"}


def vector_info(manifest, errors):
    path = ROOT / manifest["art"]["vectorManifest"]
    if not path.is_file():
        errors.append("Missing vector manifest")
        return [], 0
    pack = json.loads(path.read_text())
    items, byte_count = [], 0
    for asset in pack["assets"]:
        source = path.parent / asset["file"]
        try:
            raw = source.read_text()
            svg = ET.fromstring(raw)
            if not svg.tag.endswith("svg"):
                raise ValueError("Root is not SVG")
            # SVGs must be self-contained; the board must never fetch remote art.
            for element in svg.iter():
                for key, value in element.attrib.items():
                    if (key.endswith("href") and not value.startswith("#")) or value.lower().startswith("javascript:"):
                        raise ValueError("External image/link or script URI")
                if element.tag.rsplit("}", 1)[-1] in ("script", "foreignObject"):
                    raise ValueError("Executable/non-image SVG content")
            byte_count += source.stat().st_size
            items.append({**asset, "src": source.relative_to(ROOT).as_posix()})
        except (OSError, ValueError, ET.ParseError) as exc:
            errors.append(f"Invalid vector {source.name}: {exc}")
    return items, byte_count


def write_board(manifest, vectors):
    def card(asset, title, subtitle="", rider=False):
        relative = Path(asset["src"]).relative_to("assets/racing").as_posix()
        width, height = asset.get("width", 1), asset.get("height", 1)
        ready = asset.get("status", "ready") == "ready"
        picture = f'<img src="{html.escape(relative)}" alt="{html.escape(title)}" width="{width}" height="{height}" loading="eager">' if ready else '<p class="pending">Asset pending</p>'
        anchor = asset.get("anchor", {})
        if rider and ready:
            picture += f'<i class="anchor" style="left:{100*anchor["x"]}%;top:{100*anchor["y"]}%" title="Ground anchor"></i>'
        metrics = f'{width} × {height}' if ready else 'Not yet generated'
        if "bytes" in asset:
            metrics += f' · {asset["bytes"]/1024:.0f} KiB'
        if rider and ready:
            metrics += f' · minimum visible margin {min(asset["padding"].values())} px'
        return f'<article><div class="art {"rider" if rider else ""}">{picture}</div><h3>{html.escape(title)}</h3><p>{html.escape(subtitle)}</p><small>{html.escape(metrics)}</small><details><summary>Source and measurements</summary><pre>{html.escape(json.dumps(asset, indent=2))}</pre></details></article>'

    racers = ''.join(card(r["sprite"], r["name"], r["vehicle"] + ' · ' + r["traits"], True) for r in manifest["racers"])
    backdrops = ''.join(card(b, b["name"], 'Opaque panorama · horizon reviewed separately') for b in manifest["backgrounds"])
    vector_cards = ''.join(card(v, v["title"], v["description"]) for v in vectors)
    qa = manifest["qa"]
    body = f'''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Road to the Show — asset review</title>
<style>*{{box-sizing:border-box}}body{{margin:0;padding:28px;background:#111416;color:#f4ebd6;font:16px/1.5 system-ui,sans-serif}}header{{max-width:1000px}}h1{{font-size:clamp(28px,5vw,52px);margin:0}}h2{{margin-top:40px;color:#b9ef42}}p{{margin:8px 0}}.grid{{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:20px}}.panoramas{{grid-template-columns:repeat(auto-fit,minmax(min(520px,100%),1fr))}}article{{min-width:0;border:1px solid #596065;border-radius:12px;padding:14px;background:#202528}}.art{{position:relative;display:flex;align-items:center;justify-content:center;aspect-ratio:1;background-color:#424b4d;background-image:linear-gradient(45deg,#2b3133 25%,transparent 25%),linear-gradient(-45deg,#2b3133 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#2b3133 75%),linear-gradient(-45deg,transparent 75%,#2b3133 75%);background-size:24px 24px;background-position:0 0,0 12px,12px -12px,-12px 0;overflow:visible}}.art img{{display:block;width:100%;height:100%;object-fit:contain}}.panoramas .art{{aspect-ratio:2}}.anchor{{position:absolute;width:14px;height:14px;transform:translate(-50%,-50%);border:2px solid #ff476c;border-radius:50%;box-shadow:0 0 0 1px #000}}h3{{margin:12px 0 0}}small{{color:#c1cfcc}}pre{{white-space:pre-wrap;overflow-wrap:anywhere;font-size:11px}}details{{margin-top:10px}}button{{padding:10px 16px;border:1px solid #b9ef42;border-radius:6px;color:inherit;background:#30383c;cursor:pointer}}.status{{color:#f5b94c}}.light .art{{background-color:#d6dfdc;background-image:linear-gradient(45deg,#a7b5b1 25%,transparent 25%),linear-gradient(-45deg,#a7b5b1 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#a7b5b1 75%),linear-gradient(-45deg,transparent 75%,#a7b5b1 75%)}}.pending{{color:#f5b94c}}</style>
<header><h1>Road to the Show</h1><p>Original asset review · six racers, three locations and reusable track artwork.</p><p>This board displays the source images directly. No atlas cuts, background removal, image processing or game assembly is involved. Pink markers show each rider’s recorded ground anchor.</p><p class="status">Technical status: {html.escape(qa['status'])}. Visual approval: {html.escape(qa['visualApproval'])}.</p><button onclick="document.body.classList.toggle('light')">Toggle light / dark checkerboard</button><p id="load-state" aria-live="polite">Checking browser image loading…</p></header>
<h2>Racers</h2><section class="grid">{racers}</section><h2>Locations</h2><section class="grid panoramas">{backdrops}</section><h2>Track props, controls and identity</h2><section class="grid">{vector_cards}</section>
<script>Promise.all([...document.images].map(i=>i.decode().then(()=>({{src:i.getAttribute('src'),ok:true}}),()=>({{src:i.getAttribute('src'),ok:false}})))).then(results=>{{window.assetLoadReport=results;const failed=results.filter(x=>!x.ok);document.querySelector('#load-state').textContent=failed.length?'Failed images: '+failed.map(x=>x.src).join(', '):results.length+' original images decoded successfully.';}});</script></html>'''
    BOARD.write_text(body)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--refresh", action="store_true", help="Refresh JSON measurements and CSS contact sheet; never writes image files")
    args = parser.parse_args()
    manifest = json.loads(MANIFEST.read_text())
    errors, warnings = [], []
    total_bytes = total_decoded = ready = 0
    records = [(r["sprite"], True) for r in manifest["racers"]] + [(b, False) for b in manifest["backgrounds"]]
    for entry, rider in records:
        measured = image_info(entry, rider, manifest, errors, warnings)
        if args.refresh:
            for key in MEASUREMENTS:
                entry.pop(key, None)
            entry.update(measured)
        elif any(entry.get(key) != value for key, value in measured.items()):
            errors.append(f"Saved measurements stale or absent: {entry['src']}; run --refresh")
        total_bytes += measured.get("bytes", 0)
        total_decoded += measured.get("decodedBytes", 0)
        ready += measured["status"] == "ready"
    vectors, vector_bytes = vector_info(manifest, errors)
    if total_bytes > manifest["budgets"]["maxTotalRasterBytes"]:
        errors.append("Combined raster bytes exceed budget")
    if total_decoded > manifest["budgets"]["maxTotalDecodedBytes"]:
        errors.append("Combined decoded RGBA memory estimate exceeds budget")
    qa = {**manifest.get("qa", {}), "status": "pass" if not errors else "incomplete-or-failed",
          "rasterAssetsReady": ready, "rasterAssetsExpected": len(records), "vectorAssets": len(vectors),
          "totalRasterBytes": total_bytes, "totalVectorBytes": vector_bytes,
          "totalDecodedBytes": total_decoded, "errors": errors, "warnings": warnings}
    if args.refresh:
        manifest["qa"] = qa
        MANIFEST.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n")
        write_board(manifest, vectors)
    print(json.dumps(qa, indent=2))
    return bool(errors)


if __name__ == "__main__":
    sys.exit(main())
