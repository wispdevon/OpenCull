# Benchmark face fixture

`astronaut.png` is the 512 × 512 `skimage.data.astronaut` sample bundled for
local face-analysis benchmarks. scikit-image documents the photograph as
Eileen Collins and says it has no known copyright restrictions and was
released into the public domain. The project page records the upstream sample
location and image context:

- https://scikit-image.org/docs/0.20.x/api/skimage.data.html#skimage.data.astronaut
- https://github.com/scikit-image/scikit-image/blob/v0.20.0/skimage/data/astronaut.png

SHA-256: `88431cd9653ccd539741b555fb0a46b61558b301d4110412b5bc28b5e3ea6cb5`

The benchmark wraps a generated JPEG copy in a minimal Fujifilm-style preview
header and adds synthetic EXIF and XMP. This only tests Culltivate's container
and embedded-preview readers. It is not camera RAW sensor data, and its single
portrait is not representative of a photo collection.
