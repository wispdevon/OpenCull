"""Local YuNet/YOLO ONNX comparison. See docs/FACE-DETECTOR-BENCHMARK.md.

Requires numpy, Pillow, onnxruntime-gpu; no photos or models are uploaded.
This evaluates detector boxes, before Culltivate's separate face judge.
"""
import argparse
import collections
import hashlib
import io
import json
from pathlib import Path
import random
import resource
import subprocess
import sys
import time
import zipfile

import numpy as np
from PIL import Image, ImageOps
import onnxruntime as ort


def ious(box, boxes):
    if len(boxes) == 0:
        return np.empty(0)
    inter = np.maximum(0, np.minimum(box[2:], boxes[:, 2:]) - np.maximum(box[:2], boxes[:, :2])).prod(1)
    area = np.maximum(0, box[2:] - box[:2]).prod()
    areas = np.maximum(0, boxes[:, 2:] - boxes[:, :2]).prod(1)
    return inter / np.maximum(area + areas - inter, 1e-12)


def nms(detections, threshold=0.3):
    if len(detections) == 0:
        return np.empty((0, 5), dtype=np.float32)
    order = np.argsort(-detections[:, 4], kind="stable")[:5000]
    keep = []
    while len(order) and len(keep) < 1000:
        at = order[0]
        keep.append(at)
        order = order[1:][ious(detections[at, :4], detections[order[1:], :4]) <= threshold]
    return detections[keep]


def prepare(image, kind, size):
    w, h = image.size
    # 2048 matches Culltivate: keep aspect, never enlarge, pad right/bottom to 32.
    # 640 is the standard square YOLO deployment input, with centered letterbox.
    scale = size / max(w, h)
    if size == 2048:
        scale = min(1.0, scale)
    sw, sh = max(1, round(w * scale)), max(1, round(h * scale))
    resized = image.resize((sw, sh), Image.Resampling.BILINEAR)
    pw, ph = ((sw + 31) // 32 * 32, (sh + 31) // 32 * 32) if size == 2048 else (size, size)
    left, top = (0, 0) if size == 2048 else ((pw - sw) // 2, (ph - sh) // 2)
    a = np.full((ph, pw, 3), 0 if kind == "yunet" else 114, dtype=np.float32)
    a[top:top + sh, left:left + sw] = np.asarray(resized)
    if kind == "yunet":
        a = a[:, :, ::-1]
    else:
        a /= 255.0
    return np.ascontiguousarray(a.transpose(2, 0, 1)[None]), (sw / w, sh / h, left, top)


def decode(outputs, names, kind, shape, transform, minimum=0.001):
    if kind == "yunet":
        out = dict(zip(names, outputs))
        levels = []
        for stride in (8, 16, 32):
            scores = np.sqrt(np.clip(out[f"cls_{stride}"].reshape(-1), 0, 1) * np.clip(out[f"obj_{stride}"].reshape(-1), 0, 1))
            indices = np.flatnonzero(scores >= minimum)
            b = out[f"bbox_{stride}"].reshape(-1, 4)[indices]
            cols = shape[-1] // stride
            cx = (indices % cols + b[:, 0]) * stride
            cy = (indices // cols + b[:, 1]) * stride
            wh = np.exp(b[:, 2:]) * stride
            levels.append(np.column_stack((cx - wh[:, 0] / 2, cy - wh[:, 1] / 2, cx + wh[:, 0] / 2, cy + wh[:, 1] / 2, scores[indices])))
        detections = np.concatenate(levels)
    else:
        # These checkpoints have one face class. YOLO26 also has 5 (x,y) landmarks.
        rows = outputs[0][0].T
        assert rows.shape[1] in (5, 15), rows.shape
        rows = rows[rows[:, 4] >= minimum]
        detections = np.column_stack((rows[:, :2] - rows[:, 2:4] / 2, rows[:, :2] + rows[:, 2:4] / 2, rows[:, 4]))
    detections = nms(detections)
    sx, sy, left, top = transform
    detections[:, [0, 2]] = (detections[:, [0, 2]] - left) / sx
    detections[:, [1, 3]] = (detections[:, [1, 3]] - top) / sy
    return detections


def match(detections, valid, ignored):
    valid = np.asarray(valid, dtype=float).reshape(-1, 4)
    ignored = np.asarray(ignored, dtype=float).reshape(-1, 4)
    used = set()
    records = []
    for d in sorted(detections, key=lambda x: -x[4]):
        overlaps = ious(np.asarray(d[:4]), valid)
        available = [i for i in np.argsort(-overlaps) if i not in used and overlaps[i] >= 0.5]
        if available:
            at = int(available[0])
            used.add(at)
            records.append((float(d[4]), 1, at))
        elif not np.any(ious(np.asarray(d[:4]), ignored) >= 0.5):
            records.append((float(d[4]), 0, -1))
    return records


def metrics(predictions, samples, confidence):
    records = []
    total = small = small_hits = 0
    for detections, sample in zip(predictions, samples):
        boxes = sample["valid"]
        total += len(boxes)
        small += sum(b[2] - b[0] < 40 for b in boxes)
        found = match(detections, boxes, sample["ignored"])
        records.extend(found)
        small_hits += sum(hit and score >= confidence and boxes[at][2] - boxes[at][0] < 40 for score, hit, at in found)
    records.sort(key=lambda r: -r[0])
    hits = np.cumsum([r[1] for r in records])
    precision = hits / np.arange(1, len(records) + 1)
    recall = hits / max(total, 1)
    envelope = np.maximum.accumulate(precision[::-1])[::-1]
    # 101-point interpolated AP at IoU .5, NOT the official WIDER evaluation.
    ap = np.mean([max(envelope[recall >= r], default=0) for r in np.linspace(0, 1, 101)])
    operating = [r for r in records if r[0] >= confidence]
    tp = sum(r[1] for r in operating)
    return dict(faces=total, tp=tp, fp=len(operating) - tp, fn=total - tp,
                precision=tp / max(len(operating), 1), recall=tp / max(total, 1),
                ap50=float(ap), small_faces_under40=small,
                small_recall=small_hits / max(small, 1), confidence=confidence)


def select_samples(args):
    with zipfile.ZipFile(args.annotations) as z:
        text = z.read(next(n for n in z.namelist() if n.endswith("wider_face_val_bbx_gt.txt"))).decode().splitlines()
    grouped = collections.defaultdict(list)
    i = 0
    while i < len(text):
        name = text[i].strip()
        count = int(text[i + 1])
        rows = [[int(v) for v in line.split()] for line in text[i + 2:i + 2 + max(count, 1)]]
        i += 2 + max(count, 1)
        valid, ignored = [], []
        for row in rows[:count]:
            x, y, w, h = row[:4]
            if w <= 0 or h <= 0:
                continue
            (ignored if row[7] else valid).append([x, y, x + w, y + h])
        grouped[name.split("/")[0]].append(dict(name=name, valid=valid, ignored=ignored))
    rng = random.Random(20261017)
    selected = []
    for event, rows in sorted(grouped.items()):
        selected.extend(rng.sample(sorted(rows, key=lambda r: r["name"]), min(args.per_event, len(rows))))
    paths = sorted(args.photos.glob("*.JPG")) + sorted(args.photos.glob("*.jpg"))
    if not paths:
        raise ValueError("No JPEGs in photo folder")
    chosen = [paths[i] for i in np.linspace(0, len(paths) - 1, min(args.photo_count, len(paths)), dtype=int)]
    return dict(public=selected, photos=[str(p.resolve()) for p in chosen], available_photos=len(paths))


def summary(values):
    return dict(median_ms=float(np.median(values)), p95_ms=float(np.percentile(values, 95)), samples_ms=values)


def worker(args):
    manifest = json.loads((args.output / "manifest.json").read_text())
    kind, size = args.configuration.rsplit("-", 1)
    size = int(size)
    model = args.yunet if kind == "yunet" else args.models / (kind + "-face.onnx")
    opt = ort.SessionOptions()
    opt.intra_op_num_threads = opt.inter_op_num_threads = 1
    opt.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
    gpu = args.provider == "CUDA"
    if gpu:
        ort.preload_dlls(directory="")
    providers = [("CUDAExecutionProvider", {"use_tf32": "0", "arena_extend_strategy": "kSameAsRequested"}), "CPUExecutionProvider"] if gpu else ["CPUExecutionProvider"]
    start = time.perf_counter()
    session = ort.InferenceSession(str(model), sess_options=opt, providers=providers)
    session.disable_fallback()
    if gpu:
        assert "CUDAExecutionProvider" in session.get_providers()
    setup = (time.perf_counter() - start) * 1000
    input_name = session.get_inputs()[0].name
    names = [x.name for x in session.get_outputs()]
    threshold = 0.6 if kind == "yunet" else 0.25

    def infer(image, minimum):
        t = time.perf_counter()
        tensor, transform = prepare(image, kind, size)
        prepared = time.perf_counter()
        raw = session.run(None, {input_name: tensor})
        ran = time.perf_counter()
        found = decode(raw, names, kind, tensor.shape, transform, minimum)
        ended = time.perf_counter()
        return found, [(prepared - t) * 1000, (ran - prepared) * 1000, (ended - ran) * 1000, (ended - t) * 1000]

    quality = None
    if not gpu:
        predictions = []
        with zipfile.ZipFile(args.images) as z:
            for sample in manifest["public"]:
                image = Image.open(io.BytesIO(z.read("WIDER_val/images/" + sample["name"]))).convert("RGB")
                predictions.append(infer(image, 0.001)[0].tolist())
        quality = metrics(predictions, manifest["public"], threshold)
        (args.output / (args.configuration + "-public-predictions.json")).write_text(json.dumps(predictions))

    photo_predictions = []
    durations = []
    decode_ms = []
    for path in manifest["photos"]:
        t = time.perf_counter()
        with Image.open(path) as source:
            image = ImageOps.exif_transpose(source).convert("RGB")
        decode_ms.append((time.perf_counter() - t) * 1000)
        # Each input shape is warmed before timed runs. Includes CPU input/output transfers.
        for _ in range(args.warmups):
            infer(image, threshold)
        for repeat in range(args.repeats):
            found, duration = infer(image, threshold)
            durations.append(duration)
            if repeat == 0:
                photo_predictions.append(found.tolist())
    placements = {}
    if gpu:
        # Separate untimed profile proves actual CUDA kernel placement.
        opt.enable_profiling = True
        opt.profile_file_prefix = str(args.output / (args.configuration + "-placement"))
        profile = ort.InferenceSession(str(model), sess_options=opt, providers=providers)
        tensor, _ = prepare(image, kind, size)
        profile.run(None, {input_name: tensor})
        events = json.loads(Path(profile.end_profiling()).read_text())
        placements = dict(collections.Counter(e.get("args", {}).get("provider") for e in events if e.get("args", {}).get("provider")))
        assert placements.get("CUDAExecutionProvider", 0) > 0
    result = dict(configuration=args.configuration, provider=args.provider, model_sha256=hashlib.sha256(model.read_bytes()).hexdigest(),
                  model_mib=model.stat().st_size / 1024 ** 2, setup_ms=setup, quality=quality,
                  photo_detections=photo_predictions, decode=summary(decode_ms),
                  timings={name: summary([row[i] for row in durations]) for i, name in enumerate(["preprocess", "inference", "postprocess", "total"])},
                  peak_rss_mib=resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024, placements=placements)
    (args.output / (args.configuration + "-" + args.provider + ".json")).write_text(json.dumps(result, indent=2))
    print(json.dumps({k: result[k] for k in ["configuration", "provider", "quality", "placements"]}), flush=True)


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--images", type=Path, required=True, help="WIDER_val.zip")
    p.add_argument("--annotations", type=Path, required=True, help="wider_face_split.zip")
    p.add_argument("--photos", type=Path, required=True, help="Read-only local JPEG folder")
    p.add_argument("--models", type=Path, required=True, help="Dynamic YOLO11/26 nano face ONNX exports")
    p.add_argument("--yunet", type=Path, default=Path(__file__).resolve().parents[1] / "src-tauri/models/finder.onnx")
    p.add_argument("--output", type=Path, required=True)
    p.add_argument("--per-event", type=int, default=3)
    p.add_argument("--photo-count", type=int, default=24)
    p.add_argument("--warmups", type=int, default=2)
    p.add_argument("--repeats", type=int, default=3)
    p.add_argument("--configuration", choices=["yunet-2048", "yolov11n-640", "yolov11n-2048", "yolo26n-640", "yolo26n-2048"])
    p.add_argument("--provider", choices=["CPU", "CUDA"])
    args = p.parse_args()
    if min(args.per_event, args.photo_count, args.warmups, args.repeats) < 1:
        p.error("sample counts, warmups and repeats must be positive")
    args.output.mkdir(parents=True, exist_ok=True)
    if args.configuration:
        if not args.provider:
            p.error("worker requires --provider")
        worker(args)
        return
    (args.output / "manifest.json").write_text(json.dumps(select_samples(args), indent=2))
    configs = ["yunet-2048", "yolov11n-640", "yolov11n-2048", "yolo26n-640", "yolo26n-2048"]
    # Sequential workers prevent model accumulation and GPU competition within this benchmark.
    for config in configs:
        for provider in ["CPU", "CUDA"]:
            print("Starting", config, provider, flush=True)
            subprocess.run([sys.executable, __file__, *sys.argv[1:], "--configuration", config, "--provider", provider], check=True)
    results = [json.loads((args.output / (c + "-" + provider + ".json")).read_text()) for c in configs for provider in ["CPU", "CUDA"]]
    (args.output / "results.json").write_text(json.dumps(dict(onnxruntime=ort.__version__, results=results), indent=2))


if __name__ == "__main__":
    main()
