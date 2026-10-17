# Face detector comparison

Measured locally on 2026-10-17. This compares Culltivate's bundled YuNet with
face-trained YOLO11 nano and YOLO26 nano checkpoints. The application model
and processing pipeline were not changed.

## Results

P201 **model inference only**, median / p95 milliseconds. AP50 and recall at
90% precision are percentages from the labeled public sample. The latter
chooses its confidence threshold on this sample and is a diagnostic, rather
than a preselected deployment threshold.

| Detector | CPU ms | CUDA ms | AP50 | Recall at 90% precision | ONNX MiB |
|---|---:|---:|---:|---:|---:|
| YuNet 2048 (current) | 62.7 / 70.5 | 12.4 / 14.2 | 59.1 | 47.1 | 0.22 |
| YOLO11n face 640 | 63.5 / 66.7 | 5.5 / 6.9 | 58.5 | 49.0 | 9.94 |
| YOLO26n face 640 | 53.7 / 58.4 | 5.8 / 7.2 | 59.1 | 49.4 | 9.52 |
| YOLO11n face 2048 | 478.4 / 523.9 | 22.9 / 26.3 | 72.4 | 59.9 | 9.94 |
| YOLO26n face 2048 | 468.7 / 495.5 | 24.5 / 28.4 | 72.2 | 60.8 | 9.52 |

At the operating thresholds described below:

| Detector | Precision | Recall | Recall on faces under 40 px | Raw boxes on 24 P201 photos |
|---|---:|---:|---:|---:|
| YuNet 2048 (current) | 84.5% | 50.3% | 42.5% | 62 |
| YOLO11n face 640 | 86.4% | 51.2% | 42.9% | 77 |
| YOLO26n face 640 | 85.0% | 52.0% | 43.6% | 69 |
| YOLO11n face 2048 | 80.3% | 66.7% | 61.6% | 69 |
| YOLO26n face 2048 | 82.9% | 66.2% | 60.9% | 62 |

YOLO26n at 640 is the most relevant fast-GPU candidate: **2.16× faster CUDA
model inference** than YuNet in this run, essentially tied AP50, and it
provides facial landmarks. Its CPU model time was about 14% lower. These
are detector measurements, not a promised speedup of the whole application.

The 2048 YOLO models improve sampled AP50 by about 13 percentage points,
particularly on tiny faces, but cost about 7.5× the CPU inference time and
1.8–2.0× the CUDA inference time. The 640 models and YuNet are essentially
tied on AP50; the data does not establish a clear accuracy winner there.

P201 box counts are not accuracy scores. Visual review of YOLO11's extra
640 proposals found many blurred heads, partial faces and people facing
away, alongside additional profiles. There is no independent box annotation
set for these 24 private photos. Culltivate's existing judge may remove such
proposals; that downstream filtering was not measured here.

All five configurations produced identical CPU/CUDA detection counts on the
24 P201 photos; each CPU box had a CUDA match with IoU above 0.9999. Separate
profiles confirmed CUDA execution for every model. A YuNet decoder crosscheck
against OpenCV on one P201 photo produced the same three boxes with IoU above
0.99999.

A model replacement still needs the downstream judge's crop geometry,
landmark ordering and eye/gaze/focus behavior checked. YuNet's box adjustment
is calibrated specifically to YuNet. YOLO11 would additionally need a source
of eye landmarks. No production model was replaced by this benchmark.

## Method

- Hardware: AMD Ryzen 5 7500F, NVIDIA GeForce RTX 3060 Ti, Linux. The desktop
  and other applications remained running; these are comparative measurements,
  not isolated hardware limits.
- ONNX Runtime 1.28.0, FP32, one intra/inter-op CPU thread. CUDA disables TF32
  and uses requested-size arena growth, matching Culltivate's provider settings.
  Each configuration/provider gets its own process. Untimed profiles verify
  CUDA model-node execution; some YOLO shape/control nodes run on CPU.
- Real-world input: 24 JPEGs evenly spaced through the 218 JPEGs in
  `LUMIX/DCIM/201_PANA` on the connected card. Sources are read only. Two
  warmups and three timed passes per image give 72 timing samples per model
  and provider. Image decoding is outside the detector timer; preprocessing,
  inference including input/output transfers, and postprocessing are recorded
  separately. The Python reference's preprocessing/total time is not a native
  Rust application benchmark.
- At 2048, both model families receive the same aspect-preserving resolution,
  capped at the original image size and padded on the right/bottom to a
  multiple of 32. YuNet uses BGR values 0–255 and black padding. YOLO uses RGB
  0–1 and padding 114. The separate YOLO 640 configurations use standard
  centered square letterboxing and may enlarge smaller images.
- The reference harness uses Pillow bilinear resizing. Culltivate uses native
  Catmull–Rom resizing; exact real-photo boxes can therefore differ slightly.
- Accuracy sample: three seeded random images from each of 61 WIDER FACE
  validation event categories: 183 images, 2,365 valid faces. Of these, 1,983
  annotations are under 40 pixels wide in the original image. No P201 boxes
  were used as labeled ground truth.
- Box matching uses IoU ≥0.5 and one detection per valid annotation. Detections
  matching invalid annotations are ignored. All detectors use NMS IoU 0.3,
  with at most 5,000 candidates and 1,000 retained detections per image.
  Operating thresholds are YuNet 0.6 (the app default) and YOLO 0.25. AP50
  sweeps scores down to 0.001 using 101-point interpolation. This sampled
  metric is **not the official WIDER FACE Easy/Medium/Hard evaluation**.
- Results cover raw detection, before Culltivate's judge removes nonfaces and
  computes focus, eye state, gaze, or subject importance.

## Models and provenance

- YuNet: the exact `src-tauri/models/finder.onnx` bundled in Culltivate.
- YOLO11 and YOLO26: `yolov11n-face.pt` and `yolo26n-face.pt` from
  [akanametov/yolo-face release 1.0.0](https://github.com/akanametov/yolo-face/releases/tag/1.0.0).
  Both checkpoints identify their only class as `face` and reference WIDER
  FACE training data. These are community face checkpoints, rather than the
  general-purpose official COCO weights.
- The particular YOLO26 checkpoint is a pose model with five two-coordinate
  facial landmarks and a non-end-to-end head. It still needs NMS. The YOLO11
  checkpoint provides boxes without landmarks. The generic YOLO26 family's
  NMS-free claims should not be applied to this checkpoint.
- Both were exported with Ultralytics 8.4.178, PyTorch 2.14.1+cpu and ONNX
  1.23.2: dynamic FP32 ONNX, opset 17, batch 1, no graph simplification.
  Raw exported outputs were compared with the original fused PyTorch models
  at 640 and 2048 on a P201 photo; all four comparisons passed
  `numpy.allclose(rtol=1e-3, atol=1e-3)`.
- Validation images/annotations came from the
  [CUHK-CSE WIDER FACE dataset](https://huggingface.co/datasets/CUHK-CSE/wider_face).
  Photos, checkpoints, raw predictions and per-image manifests remain outside
  the repository. Result JSON records each exported model's SHA-256.

## Reproduce

Use a separate Python environment with `onnxruntime-gpu==1.28.0`, NumPy and
Pillow and the compatible local CUDA/cuDNN runtime. Export the checkpoints
in a separate Ultralytics environment:

```python
from ultralytics import YOLO

for name in ["yolov11n-face", "yolo26n-face"]:
    YOLO(f"/path/to/models/{name}.pt").export(
        format="onnx", imgsz=640, dynamic=True, simplify=False,
        opset=17, device="cpu", batch=1,
    )
```

Download `data/WIDER_val.zip` and `data/wider_face_split.zip` from the linked
dataset, then run from the repository root:

```sh
python -m unittest discover -s tools -p test_benchmark_face_detectors.py
python tools/benchmark_face_detectors.py \
  --images /path/to/WIDER_val.zip \
  --annotations /path/to/wider_face_split.zip \
  --photos /run/media/wisp/LUMIX/DCIM/201_PANA \
  --models /path/to/models \
  --output /tmp/opencull-face-comparison/results
```

The tool downloads nothing and writes only to the selected output directory.
It produces the sample manifest, raw public and private-photo detections,
per-stage timing samples, CUDA placement profiles and a combined `results.json`.
Do not put these photo-derived artifacts in Git.
