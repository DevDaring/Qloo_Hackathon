"""Deterministic final-video assembly with FFmpeg.

Generated clips are normalised to the export frame (cover-crop for native
aspect, or a blurred fill when transforming 9:16 to 16:9 — recorded as a
transform, never claimed as native), joined with fixed crossfades, captioned
with Pillow-rendered overlays (correct Indic shaping), closed with a
real-product end card, and given either reviewed narration, owner-supplied
licensed audio, or an explicit silent track. Output: H.264 High / yuv420p /
AAC / +faststart MP4, plus thumbnail and SRT/VTT subtitles.
"""
from __future__ import annotations

import asyncio
import json
import logging
import shutil
import tempfile
from dataclasses import dataclass, field
from pathlib import Path

from PIL import Image, ImageDraw

from ..config import settings
from .compose import fit_text, script_of

log = logging.getLogger("launchlens.video")
FPS = 30
XFADE = 0.4
SIZES = {"vertical": (1080, 1920), "landscape": (1920, 1080)}


class FFmpegError(RuntimeError):
    pass


async def run(args: list[str], timeout: float = 600) -> str:
    proc = await asyncio.create_subprocess_exec(*args, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
    try:
        out, err = await asyncio.wait_for(proc.communicate(), timeout)
    except TimeoutError:
        proc.kill()
        raise FFmpegError(f"{Path(args[0]).name} timed out") from None
    if proc.returncode != 0:
        raise FFmpegError(err.decode(errors="replace")[-1200:])
    return out.decode(errors="replace") + err.decode(errors="replace")


async def probe(path: Path) -> dict:
    out = await run([settings.FFPROBE_PATH, "-v", "error", "-show_streams", "-show_format", "-of", "json", str(path)])
    data = json.loads(out[out.index("{"):])
    v = next((s for s in data.get("streams", []) if s.get("codec_type") == "video"), {})
    a = next((s for s in data.get("streams", []) if s.get("codec_type") == "audio"), None)
    return {"duration": float(data.get("format", {}).get("duration") or v.get("duration") or 0),
            "width": v.get("width"), "height": v.get("height"), "codec": v.get("codec_name"),
            "profile": v.get("profile"), "pix_fmt": v.get("pix_fmt"),
            "fps": v.get("r_frame_rate"), "audio_codec": a.get("codec_name") if a else None,
            "has_audio": a is not None, "bytes": int(data.get("format", {}).get("size") or 0)}


def caption_png(text: str, language: str, width: int, path: Path, *, bottom_pad: int) -> Path:
    """A caption strip rendered with real fonts, sized to the frame width."""
    max_w = int(width * 0.84)
    f, lines, size, _ = fit_text(text, script_of(text, language), "Bold", max_w, 3, int(width * 0.05), int(width * 0.028))
    line_h = int(size * 1.35)
    pad_x, pad_y = int(size * 0.8), int(size * 0.55)
    box_w = int(max(f.getlength(line) for line in lines)) + 2 * pad_x if lines else 10
    box_h = line_h * len(lines) + 2 * pad_y
    img = Image.new("RGBA", (width, box_h + bottom_pad), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    x0 = (width - box_w) // 2
    d.rounded_rectangle([x0, 0, x0 + box_w, box_h], radius=int(size * 0.6), fill=(8, 12, 22, 200))
    y = pad_y
    for line in lines:
        lw = f.getlength(line)
        f.draw(d, ((width - lw) / 2, y - size * 0.08), line, (255, 255, 255, 255))
        y += line_h
    img.save(path)
    return path


def srt_time(t: float) -> str:
    ms = int(round(t * 1000))
    h, ms = divmod(ms, 3_600_000)
    m, ms = divmod(ms, 60_000)
    s, ms = divmod(ms, 1000)
    return f"{h:02}:{m:02}:{s:02},{ms:03}"


def subtitles(cues: list[tuple[float, float, str]]) -> tuple[str, str]:
    srt, vtt = [], ["WEBVTT", ""]
    for i, (a, b, t) in enumerate(cues, 1):
        srt += [str(i), f"{srt_time(a)} --> {srt_time(b)}", t, ""]
        vtt += [f"{srt_time(a).replace(',', '.')} --> {srt_time(b).replace(',', '.')}", t, ""]
    return "\n".join(srt), "\n".join(vtt)


@dataclass
class Segment:
    path: Path | None          # video clip, or None for a still (end card / slideshow frame)
    still: Path | None
    duration: float
    caption: str = ""
    narration: Path | None = None
    label: str = ""
    overlay: Path | None = None   # real product cut-out PNG, composited (never generated)


@dataclass
class AssemblyResult:
    path: Path
    thumbnail: Path
    srt: str
    vtt: str
    duration: float
    probe: dict
    timeline: list = field(default_factory=list)
    audio_state: str = "silent_captioned"


async def _normalise(seg: Segment, size: tuple[int, int], out: Path, transform: str) -> None:
    W, H = size
    d = f"{seg.duration:.3f}"
    if seg.path is not None:
        if transform == "blur_fill":
            vf = (f"[0:v]split[a][b];[a]scale={W}:{H}:force_original_aspect_ratio=increase,crop={W}:{H},boxblur=24:2,"
                  f"eq=brightness=-0.08[bg];[b]scale={W}:{H}:force_original_aspect_ratio=decrease[fg];"
                  f"[bg][fg]overlay=(W-w)/2:(H-h)/2,fps={FPS},setsar=1,tpad=stop_mode=clone:stop_duration=3,trim=0:{d},"
                  f"setpts=PTS-STARTPTS,format=yuv420p[v]")
        else:
            vf = (f"[0:v]scale={W}:{H}:force_original_aspect_ratio=increase,crop={W}:{H},fps={FPS},setsar=1,"
                  f"tpad=stop_mode=clone:stop_duration=3,trim=0:{d},setpts=PTS-STARTPTS,format=yuv420p[v]")
        args = [settings.FFMPEG_PATH, "-y", "-i", str(seg.path)]
        if seg.overlay is not None:
            ow = int(W * 0.62)
            args += ["-loop", "1", "-i", str(seg.overlay)]
            vf = vf.replace("format=yuv420p[v]", "format=yuva420p[base]")
            vf += (f";[1:v]scale={ow}:-1,format=rgba,fade=t=in:st=0.6:d=0.6:alpha=1[ov];"
                   f"[base][ov]overlay=(W-w)/2:H*0.18:shortest=1,format=yuv420p[v]")
        args += ["-filter_complex", vf, "-map", "[v]", "-an", "-t", d]
    else:
        frames = int(seg.duration * FPS)
        vf = (f"[0:v]scale={int(W * 1.08)}:{int(H * 1.08)},zoompan=z='min(zoom+0.0006,1.06)':d={frames}:"
              f"x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s={W}x{H}:fps={FPS},setsar=1,format=yuv420p[v]")
        args = [settings.FFMPEG_PATH, "-y", "-loop", "1", "-t", d, "-i", str(seg.still), "-filter_complex", vf,
                "-map", "[v]", "-t", d]
    args += ["-c:v", "libx264", "-preset", "veryfast", "-crf", "18", str(out)]
    await run(args)


async def assemble(segments: list[Segment], orientation: str, out_path: Path, *, language: str,
                   logo: Path | None = None, licensed_audio: Path | None = None, transform: str = "cover") -> AssemblyResult:
    W, H = SIZES[orientation]
    if shutil.which(settings.FFMPEG_PATH) is None and not Path(settings.FFMPEG_PATH).exists():
        raise FFmpegError("FFmpeg is not installed (FFMPEG_PATH)")
    with tempfile.TemporaryDirectory(prefix="ll-video-") as tmp:
        tmpd = Path(tmp)
        norm = []
        for i, seg in enumerate(segments):
            p = tmpd / f"seg{i}.mp4"
            await _normalise(seg, (W, H), p, transform if seg.path is not None else "cover")
            norm.append(p)
        # crossfade chain
        n = len(norm)
        offsets, t = [], 0.0
        for i, seg in enumerate(segments):
            offsets.append(t)
            t += seg.duration - (XFADE if i < n - 1 else 0)
        total = t
        inputs: list[str] = []
        for p in norm:
            inputs += ["-i", str(p)]
        fc, last = [], "[0:v]"
        for i in range(1, n):
            lbl = f"[x{i}]"
            fc.append(f"{last}[{i}:v]xfade=transition=fade:duration={XFADE}:offset={offsets[i]:.3f}{lbl}")
            last = lbl
        # captions
        cues, idx = [], n
        for i, seg in enumerate(segments):
            if not seg.caption:
                continue
            png = caption_png(seg.caption, language, W, tmpd / f"cap{i}.png",
                              bottom_pad=int(H * (0.16 if orientation == "vertical" else 0.07)))
            inputs += ["-i", str(png)]
            a, b = offsets[i] + 0.15, offsets[i] + seg.duration - XFADE - 0.05
            cues.append((a, b, seg.caption))
            lbl = f"[c{i}]"
            fc.append(f"{last}[{idx}:v]overlay=0:H-h:enable='between(t,{a:.2f},{b:.2f})'{lbl}")
            last, idx = lbl, idx + 1
        if logo is not None:
            inputs += ["-i", str(logo)]
            lw = int(W * 0.16)
            fc.append(f"[{idx}:v]scale={lw}:-1[lg]")
            end_start = offsets[-1]
            fc.append(f"{last}[lg]overlay=W-w-{int(W * 0.05)}:{int(H * 0.05)}:enable='lt(t,{end_start:.2f})'[lgv]")
            last, idx = "[lgv]", idx + 1
        fc.append(f"{last}format=yuv420p[vout]")
        # audio
        audio_state = "silent_captioned"
        narrations = [(i, s.narration) for i, s in enumerate(segments) if s.narration]
        if licensed_audio is not None:
            inputs += ["-i", str(licensed_audio)]
            fc.append(f"[{idx}:a]atrim=0:{total:.3f},afade=t=out:st={max(0, total - 1.0):.3f}:d=1,"
                      f"loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000[aout]")
            audio_state, idx = "licensed_audio_supplied", idx + 1
        elif narrations:
            parts = []
            for i, p in narrations:
                inputs += ["-i", str(p)]
                delay = int((offsets[i] + 0.25) * 1000)
                maxlen = segments[i].duration - 0.3
                fc.append(f"[{idx}:a]atrim=0:{maxlen:.2f},adelay={delay}|{delay},aresample=48000[n{i}]")
                parts.append(f"[n{i}]")
                idx += 1
            fc.append(f"{''.join(parts)}amix=inputs={len(parts)}:normalize=0,apad,atrim=0:{total:.3f},"
                      f"loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000[aout]")
            audio_state = "narration_tts_needs_review"
        else:
            inputs += ["-f", "lavfi", "-t", f"{total:.3f}", "-i", "anullsrc=r=48000:cl=stereo"]
            fc.append(f"[{idx}:a]anull[aout]")
        args = [settings.FFMPEG_PATH, "-y", *inputs, "-filter_complex", ";".join(fc), "-map", "[vout]", "-map", "[aout]",
                "-c:v", "libx264", "-profile:v", "high", "-level", "4.1", "-preset", "medium", "-crf", "20",
                "-pix_fmt", "yuv420p", "-r", str(FPS), "-c:a", "aac", "-b:a", "128k", "-ar", "48000",
                "-movflags", "+faststart", "-t", f"{total:.3f}", str(out_path)]
        await run(args, timeout=900)
        thumb = out_path.with_suffix(".jpg")
        await run([settings.FFMPEG_PATH, "-y", "-ss", f"{min(1.5, total / 3):.2f}", "-i", str(out_path), "-frames:v", "1",
                   "-q:v", "3", str(thumb)])
        info = await probe(out_path)
    srt, vtt = subtitles(cues)
    timeline = [{"index": i, "start": round(offsets[i], 3), "duration": s.duration, "label": s.label,
                 "kind": "clip" if s.path else "still", "caption": s.caption} for i, s in enumerate(segments)]
    return AssemblyResult(out_path, thumb, srt, vtt, total, info, timeline, audio_state)


async def audio_peak_db(path: Path) -> float | None:
    out = await run([settings.FFMPEG_PATH, "-i", str(path), "-af", "volumedetect", "-vn", "-f", "null", "-"])
    for line in out.splitlines():
        if "max_volume" in line:
            try:
                return float(line.split("max_volume:")[1].split("dB")[0])
            except (IndexError, ValueError):
                return None
    return None


async def validate(path: Path, *, orientation: str, expected_s: float, audio_state: str) -> dict:
    info = await probe(path)
    W, H = SIZES[orientation]
    peak = await audio_peak_db(path) if info["has_audio"] and audio_state != "silent_captioned" else None
    checks = {
        "duration": {"expected": round(expected_s, 2), "actual": round(info["duration"], 2),
                     "ok": abs(info["duration"] - expected_s) <= 0.35},
        "orientation": {"expected": [W, H], "actual": [info["width"], info["height"]],
                        "ok": (info["width"], info["height"]) == (W, H)},
        "codec": {"video": info["codec"], "pix_fmt": info["pix_fmt"], "audio": info["audio_codec"],
                  "ok": info["codec"] == "h264" and info["pix_fmt"] == "yuv420p" and info["audio_codec"] == "aac"},
        "audio": {"state": audio_state, "peak_db": peak, "clipping": peak is not None and peak > -0.1,
                  "ok": not (peak is not None and peak > -0.1)},
        "max_length": {"limit_s": settings.MAX_VIDEO_SECONDS, "ok": info["duration"] <= settings.MAX_VIDEO_SECONDS + 0.5},
    }
    checks["passed"] = all(v["ok"] for v in checks.values() if isinstance(v, dict) and "ok" in v)
    return {"checks": checks, "probe": info}
