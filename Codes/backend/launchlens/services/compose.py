"""Deterministic flyer composition.

The generated image is only ever a BACKGROUND. The real product photo is
composited unchanged in shape (scaled with its aspect ratio locked, never
cropped or warped), and every word of advertising text, the price and the
logo are rendered here with real fonts — never by the image model. Indic
scripts are shaped with libraqm.

Export presets are application targets: the provider image is cover-cropped
to the preset size and the crop box is recorded, so nobody can mistake the
final dimensions for the provider's native output.
"""
from __future__ import annotations

import io
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont, features

from ..config import settings

PRESETS = {
    "square": {"size": (1080, 1080), "provider_aspect": "1:1", "safe": (64, 64, 64, 64)},
    "portrait": {"size": (1080, 1350), "provider_aspect": "3:4", "safe": (64, 72, 64, 72)},
    "vertical": {"size": (1080, 1920), "provider_aspect": "9:16", "safe": (64, 230, 64, 300)},
    "landscape": {"size": (1920, 1080), "provider_aspect": "16:9", "safe": (96, 64, 96, 64)},
}
FONT_DIR = Path(settings.FONT_ASSET_DIR)
RAQM = features.check("raqm")


def _font_file(language: str, weight: str) -> Path:
    script = {"hi": "Devanagari", "bn": "Bengali"}.get(language, "")
    if script:
        return FONT_DIR / f"NotoSans{script}-{weight}.ttf"
    if weight == "ExtraBold":
        return FONT_DIR / "NotoSansDisplay-ExtraBold.ttf"
    return FONT_DIR / f"NotoSans-{weight}.ttf"


def script_of(text: str, default: str = "en") -> str:
    """Pick the font family from the characters actually present."""
    for ch in text or "":
        o = ord(ch)
        if 0x0980 <= o <= 0x09FF:
            return "bn"
        if 0x0900 <= o <= 0x097F:
            return "hi"
    return "en" if text else default


def font(language: str, weight: str, size: int) -> ImageFont.FreeTypeFont:
    engine = ImageFont.Layout.RAQM if RAQM else ImageFont.Layout.BASIC
    return ImageFont.truetype(str(_font_file(language, weight)), size, layout_engine=engine)


def _hex(c: str, default=(255, 122, 69)) -> tuple[int, int, int]:
    try:
        c = c.lstrip("#")
        return tuple(int(c[i:i + 2], 16) for i in (0, 2, 4))  # type: ignore[return-value]
    except (ValueError, AttributeError):
        return default


def _luminance(rgb) -> float:
    def ch(v):
        v = v / 255
        return v / 12.92 if v <= 0.03928 else ((v + 0.055) / 1.055) ** 2.4
    r, g, b = rgb[:3]
    return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b)


def contrast_ratio(a, b) -> float:
    la, lb = _luminance(a), _luminance(b)
    hi, lo = max(la, lb), min(la, lb)
    return round((hi + 0.05) / (lo + 0.05), 2)


def _char_script(ch: str) -> str | None:
    o = ord(ch)
    if 0x0964 <= o <= 0x0965 or ch.isspace():
        return None  # dandas and spaces belong to the surrounding run
    if 0x0980 <= o <= 0x09FF:
        return "bn"
    if 0x0900 <= o <= 0x097F or 0xA8E0 <= o <= 0xA8FF:
        return "hi"
    return "en"


def runs(text: str) -> list[tuple[str, str]]:
    """Split text into (script, chunk) runs so each chunk is drawn with a font
    that has its glyphs (Noto Bengali/Devanagari have no Latin letters)."""
    out: list[list[str]] = []
    pending = ""
    for ch in text:
        sc = _char_script(ch)
        if sc is None:
            if out:
                out[-1][1] += ch
            else:
                pending += ch
            continue
        if out and out[-1][0] == sc:
            out[-1][1] += ch
        else:
            out.append([sc, pending + ch])
            pending = ""
    if pending:
        out.append(["en", pending])
    return [(a, b) for a, b in out]


class MixedFont:
    """A font stack that measures and draws mixed-script text run by run.
    Each run is shaped by libraqm with the font for its script."""

    def __init__(self, weight: str, size: int):
        self.weight, self.size = weight, size
        self._fonts: dict[str, ImageFont.FreeTypeFont] = {}

    def f(self, script: str) -> ImageFont.FreeTypeFont:
        if script not in self._fonts:
            self._fonts[script] = font(script, self.weight, self.size)
        return self._fonts[script]

    def getlength(self, text: str) -> float:
        return sum(self.f(sc).getlength(chunk) for sc, chunk in runs(text))

    def draw(self, draw: ImageDraw.ImageDraw, xy, text: str, fill) -> None:
        x, y = xy
        for sc, chunk in runs(text):
            draw.text((x, y), chunk, font=self.f(sc), fill=fill)
            x += self.f(sc).getlength(chunk)


def wrap(text: str, f, max_w: int) -> list[str]:
    words, lines, cur = text.split(), [], ""
    for w in words:
        trial = (cur + " " + w).strip()
        if f.getlength(trial) <= max_w or not cur:
            cur = trial
        else:
            lines.append(cur)
            cur = w
    if cur:
        lines.append(cur)
    return lines


def fit_text(text: str, language: str, weight: str, max_w: int, max_lines: int, start: int, minimum: int):
    """Largest size at which the text fits; overflow=True if even the minimum
    does not. Returns (MixedFont, lines, size, overflow)."""
    size = start
    while size >= minimum:
        f = MixedFont(weight, size)
        lines = wrap(text, f, max_w)
        if len(lines) <= max_lines and all(f.getlength(line) <= max_w for line in lines):
            return f, lines, size, False
        size -= 2
    f = MixedFont(weight, minimum)
    return f, wrap(text, f, max_w)[:max_lines], minimum, True


def cover_crop(img: Image.Image, size: tuple[int, int], focus: tuple[float, float] = (0.5, 0.5)) -> tuple[Image.Image, dict]:
    """Scale to cover, then crop around a focal point (0..1, 0..1)."""
    tw, th = size
    scale = max(tw / img.width, th / img.height)
    nw, nh = round(img.width * scale), round(img.height * scale)
    resized = img.resize((nw, nh), Image.LANCZOS)
    fx, fy = (min(1.0, max(0.0, float(v))) for v in focus)
    left = int(round((nw - tw) * fx))
    top = int(round((nh - th) * fy))
    return resized.crop((left, top, left + tw, top + th)), {
        "source_size": [img.width, img.height], "scale": round(scale, 4), "crop_box": [left, top, left + tw, top + th],
        "focus": [fx, fy]}


# ---------------------------------------------------------------- cutout ----
def cutout(product: Image.Image) -> tuple[Image.Image, dict]:
    """Return (RGBA product, info). Uses existing transparency; otherwise
    removes a near-uniform studio background by border flood. If the border is
    not uniform enough to separate reliably, the photo is kept intact and the
    layout frames it as a card instead."""
    im = product.convert("RGBA")
    a = np.array(im)
    alpha = a[:, :, 3]
    if (alpha < 250).mean() > 0.02:
        return im, {"method": "existing_alpha", "reliable": True}
    rgb = a[:, :, :3].astype(np.int16)
    border = np.concatenate([rgb[0, :], rgb[-1, :], rgb[:, 0], rgb[:, -1]])
    bg = np.median(border, axis=0)
    spread = float(np.abs(border - bg).max(axis=1).mean())
    if spread > 18:
        return im, {"method": "none", "reliable": False, "reason": f"background not uniform (spread {spread:.1f})"}
    diff = np.abs(rgb - bg).max(axis=2)
    # Flood from the border through background-like pixels. The tolerance is
    # wide enough to take in a studio floor shadow, which is then kept as a
    # soft semi-transparent shadow rather than a white patch.
    cand = diff < 64
    from collections import deque
    h, w = cand.shape
    mask = np.zeros_like(cand)
    q = deque()
    for x in range(w):
        for y in (0, h - 1):
            if cand[y, x] and not mask[y, x]:
                mask[y, x] = True
                q.append((y, x))
    for y in range(h):
        for x in (0, w - 1):
            if cand[y, x] and not mask[y, x]:
                mask[y, x] = True
                q.append((y, x))
    while q:
        y, x = q.popleft()
        for ny, nx in ((y + 1, x), (y - 1, x), (y, x + 1), (y, x - 1)):
            if 0 <= ny < h and 0 <= nx < w and cand[ny, nx] and not mask[ny, nx]:
                mask[ny, nx] = True
                q.append((ny, nx))
    # Background visible through the product (e.g. under a seat, between
    # wheels) is enclosed, so the border flood cannot reach it: take any large
    # enclosed region of background colour as background too.
    rest = cand & ~mask
    seen = np.zeros_like(rest)
    min_size = max(400, int(h * w * 0.0015))
    for y0, x0 in zip(*np.nonzero(rest & (diff < 30)), strict=False):
        if seen[y0, x0]:
            continue
        comp = [(y0, x0)]
        seen[y0, x0] = True
        i = 0
        while i < len(comp):
            y, x = comp[i]
            i += 1
            for ny, nx in ((y + 1, x), (y - 1, x), (y, x + 1), (y, x - 1)):
                if 0 <= ny < h and 0 <= nx < w and rest[ny, nx] and not seen[ny, nx]:
                    seen[ny, nx] = True
                    comp.append((ny, nx))
        if len(comp) >= min_size:
            ys, xs = zip(*comp, strict=True)
            mask[list(ys), list(xs)] = True
    shadow_alpha = np.clip((diff.astype(np.float32) - 18) / 50, 0, 1) * 120
    alpha = np.where(mask, shadow_alpha, 255).astype(np.uint8)
    removed = float((alpha < 8).mean())
    # A small product on a large studio canvas legitimately removes most pixels; what matters is that a
    # solid foreground remains (at least 1% of the image). Too little removed means no real background.
    if removed < 0.05 or (1 - removed) < 0.01:
        # return the untouched photo: the layout frames it as a card
        return product.convert("RGBA"), {"method": "none", "reliable": False,
                                         "reason": f"separation implausible ({removed:.0%} removed)"}
    # floor-shadow pixels become a neutral dark shadow (not a pale patch)
    a[mask, :3] = 0
    im = Image.fromarray(a)
    alpha_img = Image.fromarray(alpha).filter(ImageFilter.GaussianBlur(1.0))
    im.putalpha(alpha_img)
    bbox = im.getbbox()
    if bbox:
        im = im.crop(bbox)
    return im, {"method": "border_flood", "reliable": True, "removed_share": round(removed, 3)}


def _shadow(layer: Image.Image, offset=(0, 18), blur=28, opacity=120) -> Image.Image:
    sh = Image.new("RGBA", (layer.width + blur * 4, layer.height + blur * 4), (0, 0, 0, 0))
    alpha = layer.split()[3].point(lambda p: p * opacity // 255)
    sh.paste((0, 0, 0, 255), (blur * 2 + offset[0], blur * 2 + offset[1]), alpha)
    return sh.filter(ImageFilter.GaussianBlur(blur))


def _round_mask(size, radius) -> Image.Image:
    m = Image.new("L", size, 0)
    ImageDraw.Draw(m).rounded_rectangle([0, 0, size[0] - 1, size[1] - 1], radius, fill=255)
    return m


@dataclass
class Copy:
    headline: str
    body: str
    cta: str
    price_text: str = ""
    disclaimer: str = ""
    language: str = "en"


def compose(background: Image.Image, product: Image.Image, copy: Copy, preset: str, *,
            logo: Image.Image | None = None, accent: str = "#FF7A45", ai_label: str = "Background image: AI-generated",
            crop_override: dict | None = None) -> tuple[Image.Image, dict, dict]:
    """Returns (final RGB image, layout definition, quality checks)."""
    P = PRESETS[preset]
    W, H = P["size"]
    sl, st, sr, sb = P["safe"]
    focus = (crop_override or {}).get("x", 0.5), (crop_override or {}).get("y", 0.5)
    canvas, crop = cover_crop(background.convert("RGB"), (W, H), focus)
    canvas = canvas.convert("RGBA")
    layout: dict = {"preset": preset, "size": [W, H], "safe_area": [sl, st, W - sr, H - sb], "background_crop": crop,
                    "elements": []}
    lang = copy.language
    overflow: dict = {}
    notes = [n for n in (copy.disclaimer, ai_label) if n]
    notes_top = H - sb - 30 * len(notes) - 10
    if preset == "landscape":
        tx, tw = sl, W // 2 - sl
    else:
        tx, tw = sl, W - sl - sr
    tall = script_of(copy.headline + copy.body, lang) != "en"  # Indic marks need more line height
    h_lh, b_lh = (1.32, 1.5) if tall else (1.22, 1.4)

    def measure(h_start: int, b_start: int):
        hf, hl, hs, hov = fit_text(copy.headline, lang, "ExtraBold", tw, 3, h_start, 40)
        bf, bl, bs, bov = fit_text(copy.body, lang, "Regular", tw, 4, b_start, 24)
        cf, cl, cs, cov = fit_text(copy.cta, lang, "Bold", tw - 120, 1, min(40, b_start), 24)
        height = int(len(hl) * hs * h_lh) + 12 + int(len(bl) * bs * b_lh) + 26 + int(cs * 1.9)
        if copy.price_text:
            cta_w = (int(cf.getlength(cl[0])) + 88) if cl else 200
            if cta_w + 28 + MixedFont("Bold", 38).getlength(copy.price_text) > tw:
                height += 56  # price moves to its own line above the CTA
        return (hf, hl, hs, hov), (bf, bl, bs, bov), (cf, cl, cs, cov), height

    base_top = int(H * (0.50 if preset in ("square", "landscape") else 0.56))
    min_top = int(H * {"square": 0.40, "portrait": 0.46, "vertical": 0.50, "landscape": 0.0}[preset])
    h_start, b_start = (92 if preset != "square" else 76), (42 if preset != "square" else 36)
    text_top = st + 80 if preset == "landscape" else base_top
    while True:
        H_, B_, C_, need = measure(h_start, b_start)
        room = notes_top - text_top
        if need <= room:
            break
        if h_start > 56 or b_start > 30:
            h_start, b_start = max(56, h_start - 6), max(30, b_start - 2)
            continue
        if preset != "landscape" and text_top - 20 >= min_top:
            text_top -= 20
            continue
        overflow["layout"] = True
        break

    # Scrims keep text legible over any generated background.
    scrim = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    sd = ImageDraw.Draw(scrim)
    fade_from = max(0, text_top - int(H * 0.18))
    for y in range(fade_from, H):
        t = min(1.0, (y - fade_from) / (H * 0.22))
        sd.line([(0, y), (W, y)], fill=(10, 14, 24, int(210 * t)))
    for y in range(0, st + 140):
        t = 1 - y / (st + 140)
        sd.line([(0, y), (W, y)], fill=(10, 14, 24, int(120 * t)))
    canvas = Image.alpha_composite(canvas, scrim)

    # Product: aspect locked, never cropped.
    prod, cut = cutout(product)
    if preset == "landscape":
        box = (W // 2 + 40, st + 40, W - sr, H - sb - 40)
    else:
        box = (sl + 40, st + (110 if logo else 40), W - sr - 40, text_top - 30)
    bw, bh = box[2] - box[0], box[3] - box[1]
    pad = 0 if cut["reliable"] else 22
    scale = min((bw - 2 * pad) / prod.width, (bh - 2 * pad) / prod.height)
    pw, ph = max(1, int(prod.width * scale)), max(1, int(prod.height * scale))
    prod_r = prod.resize((pw, ph), Image.LANCZOS)
    px, py = box[0] + (bw - pw) // 2, box[1] + (bh - ph) // 2
    if cut["reliable"]:
        sh = _shadow(prod_r)
        canvas.alpha_composite(sh, (px - 56, py - 56 + 10))
        canvas.alpha_composite(prod_r, (px, py))
        layout["elements"].append({"type": "product", "mode": "cutout", "box": [px, py, px + pw, py + ph]})
    else:
        card = Image.new("RGBA", (pw + 2 * pad, ph + 2 * pad), (255, 255, 255, 255))
        card.alpha_composite(prod_r.convert("RGBA"), (pad, pad))
        card.putalpha(_round_mask(card.size, 28))
        cx, cy = px - pad, py - pad
        canvas.alpha_composite(_shadow(card), (cx - 56, cy - 46))
        canvas.alpha_composite(card, (cx, cy))
        layout["elements"].append({"type": "product", "mode": "framed_card", "box": [cx, cy, cx + card.width, cy + card.height]})
    # Compared with the (possibly background-trimmed) product layer actually placed.
    product_check = {"aspect_source": round(prod.width / prod.height, 4),
                     "aspect_rendered": round(pw / ph, 4), "cutout": cut,
                     "aspect_preserved": abs(prod.width / prod.height - pw / ph) / (prod.width / prod.height) < 0.01}

    draw = ImageDraw.Draw(canvas)
    hf, hlines, hsize, overflow["headline"] = H_
    bf, blines, bsize, overflow["body"] = B_
    cf, clines, csize, overflow["cta"] = C_
    y = text_top
    for line in hlines:
        hf.draw(draw, (tx, y), line, (255, 255, 255, 255))
        y += int(hsize * h_lh)
    layout["elements"].append({"type": "headline", "text": copy.headline,
                               "font": _font_file(script_of(copy.headline, lang), "ExtraBold").name,
                               "size": hsize, "lines": hlines, "box": [tx, text_top, tx + tw, y]})
    y += 12
    by0 = y
    for line in blines:
        bf.draw(draw, (tx, y), line, (236, 240, 247, 255))
        y += int(bsize * b_lh)
    layout["elements"].append({"type": "body", "text": copy.body, "size": bsize, "lines": blines, "box": [tx, by0, tx + tw, y]})
    y += 26
    acc = _hex(accent)
    cta_w = int(cf.getlength(clines[0])) + 88 if clines else 200
    cta_h = int(csize * 1.9)
    price_own_line = bool(copy.price_text) and cta_w + 28 + MixedFont("Bold", 38).getlength(copy.price_text) > tw
    if price_own_line:
        pf = MixedFont("Bold", 38)
        pf.draw(draw, (tx, y), copy.price_text, (255, 255, 255))
        layout["elements"].append({"type": "price", "text": copy.price_text,
                                   "box": [tx, y, tx + int(pf.getlength(copy.price_text)), y + 46]})
        y += 56
    draw.rounded_rectangle([tx, y, tx + cta_w, y + cta_h], radius=cta_h // 2, fill=acc + (255,))
    cta_text_fill = (255, 255, 255) if contrast_ratio((255, 255, 255), acc) >= contrast_ratio((17, 24, 39), acc) else (17, 24, 39)
    cf.draw(draw, (tx + 44, y + (cta_h - csize) // 2 - 4), clines[0] if clines else copy.cta, cta_text_fill)
    layout["elements"].append({"type": "cta", "text": copy.cta, "size": csize, "box": [tx, y, tx + cta_w, y + cta_h],
                               "colour": accent})
    if copy.price_text and not price_own_line:
        pf = MixedFont("Bold", 38)
        ptw = int(pf.getlength(copy.price_text))
        pxp = tx + cta_w + 28
        if pxp + ptw <= tx + tw:
            pf.draw(draw, (pxp, y + (cta_h - 38) // 2 - 4), copy.price_text, (255, 255, 255))
            layout["elements"].append({"type": "price", "text": copy.price_text, "box": [pxp, y, pxp + ptw, y + cta_h]})
        else:
            overflow["price"] = True
    y += cta_h
    if y > notes_top:
        overflow["layout"] = True
    ny = notes_top + 10
    for n in notes:
        MixedFont("Regular", 22).draw(draw, (tx, ny), n, (210, 216, 226, 230))
        ny += 30
    if logo is not None:
        lg = logo.convert("RGBA")
        s = min(220 / lg.width, 84 / lg.height)
        lg = lg.resize((max(1, int(lg.width * s)), max(1, int(lg.height * s))), Image.LANCZOS)
        canvas.alpha_composite(lg, (sl, st))
        layout["elements"].append({"type": "logo", "box": [sl, st, sl + lg.width, st + lg.height]})
    final = canvas.convert("RGB")

    # Quality checks on the rendered pixels
    arr = np.asarray(final)
    def region_mean(b):
        x0, y0, x1, y1 = [int(v) for v in b]
        x0, y0, x1, y1 = max(0, x0), max(0, y0), min(W, x1), min(H, y1)
        reg = arr[y0:y1, x0:x1]
        return tuple(int(v) for v in reg.reshape(-1, 3).mean(axis=0)) if reg.size else (0, 0, 0)
    head_box = next(e["box"] for e in layout["elements"] if e["type"] == "headline")
    body_box = next(e["box"] for e in layout["elements"] if e["type"] == "body")
    in_safe = all(e["box"][0] >= sl - 1 and e["box"][2] <= W - sr + 1 and e["box"][1] >= st - 1 and e["box"][3] <= H - sb + 1
                  for e in layout["elements"] if e["type"] in ("headline", "body", "cta", "price", "logo"))
    quality = {
        "dimensions": {"expected": [W, H], "actual": list(final.size), "ok": final.size == (W, H)},
        "text_overflow": {k: v for k, v in overflow.items() if v} or None,
        "contrast": {"headline": contrast_ratio((255, 255, 255), region_mean(head_box)),
                     "body": contrast_ratio((236, 240, 247), region_mean(body_box)),
                     "cta": contrast_ratio(cta_text_fill, acc)},
        "safe_area_ok": in_safe,
        "product": product_check,
        "text_rendering": {"engine": "raqm" if RAQM else "basic", "deterministic": True,
                           "complex_script_shaping": RAQM or lang == "en"},
    }
    quality["contrast_ok"] = quality["contrast"]["headline"] >= 3.0 and quality["contrast"]["body"] >= 4.5 and quality["contrast"]["cta"] >= 3.0
    quality["passed"] = (quality["dimensions"]["ok"] and not quality["text_overflow"] and quality["contrast_ok"]
                         and in_safe and product_check["aspect_preserved"] and quality["text_rendering"]["complex_script_shaping"])
    return final, layout, quality


def to_png(img: Image.Image) -> bytes:
    buf = io.BytesIO()
    img.save(buf, "PNG", optimize=True)
    return buf.getvalue()


def to_jpeg(img: Image.Image, q: int = 92) -> bytes:
    buf = io.BytesIO()
    img.convert("RGB").save(buf, "JPEG", quality=q, optimize=True, progressive=True)
    return buf.getvalue()


def end_card(product: Image.Image, copy: Copy, size: tuple[int, int], *, logo: Image.Image | None = None,
             accent: str = "#FF7A45") -> Image.Image:
    """Closing frame for videos: the real product photo, headline and CTA on a
    clean branded field (used whenever generated motion could alter identity)."""
    W, H = size
    bg = Image.new("RGB", (W, H), (14, 19, 32))
    d = ImageDraw.Draw(bg)
    acc = _hex(accent)
    for i in range(H):
        t = i / H
        d.line([(0, i), (W, i)], fill=(int(14 + 20 * t), int(19 + 12 * t), int(32 + 40 * t)))
    d.ellipse([W * 0.55, -H * 0.2, W * 1.3, H * 0.45], fill=tuple(int(c * 0.35) for c in acc))
    preset = "vertical" if H > W else "landscape"
    img, _, _ = compose(bg, product, copy, preset, logo=logo, accent=accent, ai_label="")
    return img
