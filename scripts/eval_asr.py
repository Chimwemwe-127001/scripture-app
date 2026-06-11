#!/usr/bin/env python3
"""
eval_asr.py: measures transcription the way it is used in a service.

For each system it reports:
  - WER (word error rate) against a hand-corrected reference transcript
  - hallucinated words on 60 s each of silence, room noise and music
  - decode time per utterance (p50, p95) and real-time factor
  - the cited verses found, when the transcript goes through the real
    detector and KJV check (scripts/extract-references.js)

Systems:
  baseline            the v1.1.3 approach: openai-whisper "small" on CPU, fixed
                      6 s windows with 1.5 s overlap, peak normalisation
  <faster-whisper model name>
                      the current worker (python/whisper_worker.py) in file mode,
                      e.g. distil-large-v3.5 or large-v3-turbo

Usage:
  python scripts/eval_asr.py --audio "eval-audio/sermon.mp3" --start 600 --end 1200 \
      --reference eval-audio/sermon.ref.txt --verses eval-audio/sermon.verses.txt \
      --systems baseline,distil-large-v3.5,large-v3-turbo

The recording and reference stay in eval-audio/, which git ignores.
"""

import argparse
import json
import os
import re
import subprocess
import sys
import tempfile
import time
import wave

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WORKER = os.path.join(ROOT, "python", "whisper_worker.py")
SR = 16000


# ---------------------------------------------------------------------------
# Text scoring
# ---------------------------------------------------------------------------

def normalise(text):
    """Lowercase, drop punctuation, and write chapter and verse the same way
    ("3:16", "3.16" and "3-16" all become "3 16") so only real word errors count."""
    text = text.lower()
    text = re.sub(r"(\d)[:.\-](\d)", r"\1 \2", text)
    text = re.sub(r"[^a-z0-9' ]+", " ", text)
    return text.split()


def word_errors(ref, hyp):
    """Word-level edit distance: returns (substitutions, deletions, insertions)."""
    r, h = normalise(ref), normalise(hyp)
    # cost, subs, dels, ins for each cell of the dynamic programming table
    prev = [(j, 0, 0, j) for j in range(len(h) + 1)]
    for i in range(1, len(r) + 1):
        cur = [(i, 0, i, 0)]
        for j in range(1, len(h) + 1):
            if r[i - 1] == h[j - 1]:
                cur.append(prev[j - 1])
                continue
            s, d, n = prev[j - 1], prev[j], cur[j - 1]
            best = min((s[0], "s"), (d[0], "d"), (n[0], "i"))[1]
            if best == "s":
                cur.append((s[0] + 1, s[1] + 1, s[2], s[3]))
            elif best == "d":
                cur.append((d[0] + 1, d[1], d[2] + 1, d[3]))
            else:
                cur.append((n[0] + 1, n[1], n[2], n[3] + 1))
        prev = cur
    _, subs, dels, ins = prev[-1]
    return subs, dels, ins, len(r)


def find_verses(lines):
    """Run lines through the app's own detector and KJV check."""
    out = subprocess.run(["node", os.path.join(ROOT, "scripts", "extract-references.js")],
                         input=json.dumps(lines), capture_output=True, text=True, check=True)
    return set(json.loads(out.stdout))


# ---------------------------------------------------------------------------
# Audio
# ---------------------------------------------------------------------------

def decode(path, start=0.0, end=None):
    import av
    resampler = av.AudioResampler(format="flt", layout="mono", rate=SR)
    chunks = []
    with av.open(path) as c:
        for frame in c.decode(audio=0):
            chunks.extend(o.to_ndarray().reshape(-1) for o in resampler.resample(frame))
    audio = np.concatenate(chunks).astype(np.float32)
    return audio[int(start * SR): int(end * SR) if end else None]


def write_wav(path, audio):
    with wave.open(path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes((np.clip(audio, -1, 1) * 32767).astype(np.int16).tobytes())


def hallucination_clips(folder):
    """60 s each of near-silence, room noise and music-like tones, generated
    here so the test needs no extra files."""
    rng = np.random.default_rng(7)
    t = np.arange(60 * SR) / SR
    pink = np.cumsum(rng.standard_normal(len(t)))
    pink = (pink - np.convolve(pink, np.ones(400) / 400, mode="same"))
    pink = pink / np.abs(pink).max() * 0.02                        # about -34 dBFS room noise
    chords = sum(np.sin(2 * np.pi * f * t) for f in (220, 277.2, 329.6))
    music = 0.15 * chords / 3 * (0.6 + 0.4 * np.sin(2 * np.pi * 0.25 * t))
    clips = {"silence": rng.standard_normal(len(t)) * 1e-4, "room noise": pink, "music": music}
    paths = {}
    for name, audio in clips.items():
        paths[name] = os.path.join(folder, name.replace(" ", "_") + ".wav")
        write_wav(paths[name], audio.astype(np.float32))
    return paths


# ---------------------------------------------------------------------------
# Systems
# ---------------------------------------------------------------------------

def run_worker(model, path, start=0.0, end=None):
    """The current worker in file mode. Returns (lines, decode_ms list, wall seconds)."""
    cmd = [sys.executable, WORKER, "--input-file", path, "--model", model, "--start", str(start)]
    if end:
        cmd += ["--end", str(end)]
    t0 = time.perf_counter()
    out = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8")
    wall = time.perf_counter() - t0
    lines, decode_ms = [], []
    for raw in out.stdout.splitlines():
        try:
            msg = json.loads(raw)
        except ValueError:
            continue
        if msg.get("type") == "transcript":
            lines.append(msg["text"])
            decode_ms.append(msg["decode_ms"])
        elif msg.get("type") == "error":
            raise RuntimeError(msg["message"])
    return lines, decode_ms, wall


_baseline_model = None

def run_baseline(audio):
    """The v1.1.3 worker's method, replayed on a file: 6 s windows stepping by
    4.5 s, an RMS gate, peak normalisation to 0.95, openai-whisper small on CPU."""
    global _baseline_model
    import whisper
    if _baseline_model is None:
        _baseline_model = whisper.load_model("small", device="cpu")
    prompt = ("Bible passages, scripture reading, sermon, church service, Genesis, Exodus, Leviticus, "
              "Numbers, Deuteronomy, Joshua, Judges, Ruth, Samuel, Kings, Chronicles, Ezra, Nehemiah, "
              "Esther, Job, Psalms, Proverbs, Ecclesiastes, Song of Solomon, Isaiah, Jeremiah, "
              "Lamentations, Ezekiel, Daniel, Hosea, Joel, Amos, Obadiah, Jonah, Micah, Nahum, Habakkuk, "
              "Zephaniah, Haggai, Zechariah, Malachi, Matthew, Mark, Luke, John, Acts, Romans, Corinthians, "
              "Galatians, Ephesians, Philippians, Colossians, Thessalonians, Timothy, Titus, Philemon, "
              "Hebrews, James, Peter, John, Jude, Revelation.")
    window, step = int(6.0 * SR), int(4.5 * SR)
    lines, decode_ms, previous = [], [], ""
    t_all = time.perf_counter()
    for i in range(0, max(1, len(audio) - window + 1), step):
        chunk = audio[i:i + window]
        if np.sqrt(np.mean(chunk ** 2)) < 0.005:
            continue
        peak = np.abs(chunk).max()
        chunk = (chunk / peak * 0.95) if peak > 0 else chunk
        t0 = time.perf_counter()
        result = _baseline_model.transcribe(
            chunk.astype(np.float32), language="en", beam_size=5, temperature=0.0,
            condition_on_previous_text=False, initial_prompt=prompt, fp16=False,
            no_speech_threshold=0.5, logprob_threshold=-0.8, compression_ratio_threshold=2.4)
        decode_ms.append(round((time.perf_counter() - t0) * 1000))
        text = " ".join(s["text"].strip() for s in result.get("segments", [])
                        if s.get("no_speech_prob", 1) < 0.5 and s.get("avg_logprob", -999) > -0.8)
        text = " ".join(text.split())
        if len(text) >= 4 and text != previous:
            lines.append(text)
            previous = text
    return lines, decode_ms, time.perf_counter() - t_all


def evaluate(system, args, clips, excerpt):
    if system == "baseline":
        lines, decode_ms, wall = run_baseline(excerpt)
        noise = {name: run_baseline(decode(path))[0] for name, path in clips.items()}
    else:
        lines, decode_ms, wall = run_worker(system, args.audio, args.start, args.end)
        noise = {name: run_worker(system, path)[0] for name, path in clips.items()}
    return {"lines": lines, "decode_ms": decode_ms, "wall": wall, "noise": noise}


# ---------------------------------------------------------------------------
# Report
# ---------------------------------------------------------------------------

def pct(x):
    return f"{x * 100:.1f}%"


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--audio", required=True)
    p.add_argument("--start", type=float, default=0.0)
    p.add_argument("--end", type=float, default=None)
    p.add_argument("--reference", required=True, help="corrected transcript of the excerpt")
    p.add_argument("--verses", help="one reference per line, e.g. John 3:16")
    p.add_argument("--systems", default="baseline,distil-large-v3.5,large-v3-turbo")
    p.add_argument("--save", help="folder to write each system's transcript to")
    args = p.parse_args()

    # Lines starting with # are notes, and [mm:ss] at the start of a line is a
    # reading aid, so neither is scored.
    lines = [l for l in open(args.reference, encoding="utf-8") if not l.lstrip().startswith("#")]
    reference = re.sub(r"\[\d+:\d+\]", " ", " ".join(lines))
    if "[[" in reference or "||" in reference:
        sys.exit("The reference still has [[A || B]] choices in it. Resolve them first.")
    gold = set()
    if args.verses:
        gold = {l.strip() for l in open(args.verses, encoding="utf-8") if l.strip() and not l.startswith("#")}
    excerpt = decode(args.audio, args.start, args.end)
    secs = len(excerpt) / SR

    tmp = tempfile.mkdtemp(prefix="eval_asr_")
    clips = hallucination_clips(tmp)

    rows = []
    for system in [s.strip() for s in args.systems.split(",") if s.strip()]:
        print(f"running {system}...", file=sys.stderr, flush=True)
        r = evaluate(system, args, clips, excerpt)
        hyp = " ".join(r["lines"])
        subs, dels, ins, n = word_errors(reference, hyp)
        verses = find_verses(r["lines"])
        noise_words = {k: len(" ".join(v).split()) for k, v in r["noise"].items()}
        d = sorted(r["decode_ms"]) or [0]
        rows.append({
            "system": system,
            "wer": (subs + dels + ins) / max(1, n), "subs": subs, "dels": dels, "ins": ins,
            "noise": noise_words,
            "p50": d[len(d) // 2], "p95": d[min(len(d) - 1, int(len(d) * 0.95))],
            "rtf": r["wall"] / secs,
            "found": len(verses & gold), "extra": sorted(verses - gold), "missed": sorted(gold - verses),
        })
        if args.save:
            os.makedirs(args.save, exist_ok=True)
            with open(os.path.join(args.save, f"{system}.txt"), "w", encoding="utf-8") as f:
                f.write("\n".join(r["lines"]) + "\n")

    print(f"\nExcerpt: {secs / 60:.1f} min, {len(normalise(reference))} reference words, {len(gold)} cited verses\n")
    print("| System | WER | Subs | Dels | Ins | Hallucinated words (silence / noise / music) | Decode p50 | Decode p95 | Real-time factor | Verses found |")
    print("|---|---|---|---|---|---|---|---|---|---|")
    for r in rows:
        nz = r["noise"]
        print(f"| {r['system']} | {pct(r['wer'])} | {r['subs']} | {r['dels']} | {r['ins']} | "
              f"{nz['silence']} / {nz['room noise']} / {nz['music']} | {r['p50']} ms | {r['p95']} ms | "
              f"{r['rtf']:.3f} | {r['found']} of {len(gold)} |")
    for r in rows:
        if r["missed"] or r["extra"]:
            print(f"\n{r['system']}: missed {r['missed'] or 'none'}; not in reference {r['extra'] or 'none'}")


if __name__ == "__main__":
    main()
