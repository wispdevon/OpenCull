# Experimental MobileCLIP grouping

Settings → AI → MobileCLIP grouping → Download model, then enable **Group by
visual similarity**. It is off by default and needs OpenCull AI. Switching it
off immediately regroups cached face results using the existing time/face
geometry rules. The toggle participates in Storage settings import/export.

## Order of operations

1. Read capture times and orientation; create candidate runs using the tighter
   time rules (see TIGHTER_GROUPING.md).
2. Restore cached face analysis, or analyze missing faces. MobileCLIP does not
   invalidate or repeat face inference.
3. Look for MobileCLIP embeddings in a bounded RAM cache, then the disk cache.
   Keys include source path, file version, model SHA and preprocessing version.
4. For misses, reuse existing 1280px thumbnails, then 640px thumbnails with a
   short edge of at least 384px. These are already upright. Do not generate a
   JPEG just to decode it again. Otherwise use the existing embedded-preview
   selection and scaled decoder (libjpeg-turbo when built with turbo).
5. At most two decode workers prepare two inputs at a time. Centre crop,
   bilinear resize to 256×256, RGB floats in [0,1], no mean/std normalization.
   One CPU ONNX session with two inference threads processes prepared inputs.
6. Store normalized 512-value embeddings. At cosine similarity ≥0.95, compare
   against both the preceding frame and group anchor to avoid chaining different
   compositions. Time span remains at most three seconds; orientation changes
   split groups. A visual mismatch can split even a single shutter burst.
7. Rank frames inside their resulting groups using existing face/motion scores.
   MobileCLIP changes group membership, not photo ratings or source files.

Closed sessions and changed preferences cancel stale work. Background grouping
stands aside for interactive previews according to the existing AI pause option.
Status and errors appear in the toolbar and AI settings. Missing models do not
silently substitute a different visual algorithm. Clearing AI cache removes
embeddings and face results but retains the downloaded model.

## Model and privacy

The download is **45,543,630 bytes**, FP32 vision-only MobileCLIP-S0 from
[Xenova's ONNX conversion](https://huggingface.co/Xenova/mobileclip_s0), pinned
at revision `757d59c9c6870a76a4b0306f05f5061bca15c39f`. SHA-256:
`17d3c037b1d488c10c50e09f6009ea5a198caef4e0e8f4ea5617b7cb2d067ac0`.
Downloads require an explicit button press and are checked before installation
and model loading. Photographs and embeddings stay local. The model is stored
under the app cache's `mobileclip-s0` directory; weights are not committed.
See [Apple's MobileCLIP project](https://github.com/apple-aiml-research/ml-mobileclip)
for model terms and architecture. This path currently uses CPU inference, even
when face analysis uses the optional CUDA worker.

## Measured decisions

On a Ryzen 5 7500F, eight local JPEGs, five timed passes each, the standalone
Python/libjpeg-turbo harness measured median decode+preprocessing of 139.8ms at
full resolution, 51.7ms at 1/8 scale, 1.32ms from an existing 512px JPEG preview,
and 0.16ms loading a disk embedding. Eight-photo scaled decoding took 424ms with
one worker, 216ms with two, and 114ms with four. Two workers leave more CPU for
interactive previews. These are warm-filesystem standalone results, not native
app latency promises. Preview creation is excluded from reuse measurements.

FP32 inference measured 21.2ms with two threads versus 46.0ms for the quantized
model. Quantization also substantially changed similarity scores, so FP32 was
chosen. Smaller recompressed previews can shift scores near the threshold;
prefer 1280px existing previews and validate on more shoots before relying on
this experimental grouping. Embeddings retain the representation used on first
analysis until the source/version changes or AI cache is cleared.

Native Linux validation: the explicit model download and checksum verification
succeeded. The reference pair P1962550/P1962551, supplied as the same synthetic
200ms burst, grouped together with visual grouping off and split with it on.
A repeat request used two cached embeddings and zero inferences; switching off
restored the baseline. Stale revisions were rejected and AI cache clearing
retained the model. Native batch logs measured 272ms for two new embeddings and
38µs for the two RAM-cache hits (excluding command transport and model startup).
