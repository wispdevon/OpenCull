"""Regression checks for benchmark matching and detector coordinate decoding."""
import unittest

import numpy as np
from PIL import Image

from benchmark_face_detectors import decode, match, metrics, nms, prepare


class BenchmarkTests(unittest.TestCase):
    def test_duplicate_predictions_cannot_claim_the_same_face(self):
        detections = [[0, 0, 10, 10, .9], [0, 0, 10, 10, .8]]
        records = match(detections, [[0, 0, 10, 10]], [])
        self.assertEqual([r[1] for r in records], [1, 0])

    def test_invalid_annotations_ignore_predictions_without_hiding_valid_faces(self):
        records = match([[0, 0, 10, 10, .9], [30, 30, 40, 40, .8]],
                        [[30, 30, 40, 40]], [[0, 0, 10, 10]])
        self.assertEqual(len(records), 1)
        self.assertEqual(records[0][1], 1)

    def test_metrics_count_misses_and_false_positives(self):
        result = metrics([[[0, 0, 10, 10, .9], [50, 50, 60, 60, .8]]],
                         [{"valid": [[0, 0, 10, 10], [20, 20, 30, 30]], "ignored": []}], .6)
        self.assertEqual((result["tp"], result["fp"], result["fn"]), (1, 1, 1))
        self.assertEqual(result["precision"], .5)
        self.assertEqual(result["recall"], .5)
        self.assertAlmostEqual(result["ap50"], 51 / 101)

    def test_nms_preserves_distinct_faces_and_keeps_highest_confidence(self):
        detections = np.array([[0, 0, 10, 10, .8], [1, 1, 11, 11, .9], [20, 20, 30, 30, .7]])
        kept = nms(detections)
        self.assertEqual(len(kept), 2)
        self.assertEqual(kept[0, 4], .9)

    def test_yolo_letterbox_coordinates_map_back_to_original_image(self):
        tensor, transform = prepare(Image.new("RGB", (1280, 640)), "yolov11n", 640)
        # Original box [100,100,300,300] becomes [50,210,150,310].
        raw = np.array([[[100], [260], [100], [100], [.9]]], dtype=np.float32)
        found = decode([raw], ["output0"], "yolov11n", tensor.shape, transform)
        np.testing.assert_allclose(found[0, :4], [100, 100, 300, 300])

    def test_production_size_does_not_enlarge_small_images(self):
        tensor, transform = prepare(Image.new("RGB", (333, 201)), "yunet", 2048)
        self.assertEqual(tensor.shape, (1, 3, 224, 352))
        self.assertEqual(transform, (1, 1, 0, 0))

    def test_yunet_grid_and_exponential_size_decode_to_original_coordinates(self):
        outputs = {}
        for stride in [8, 16, 32]:
            count = (32 // stride) ** 2
            for name, channels in [("cls", 1), ("obj", 1), ("bbox", 4)]:
                outputs[f"{name}_{stride}"] = np.zeros((1, count, channels), dtype=np.float32)
        outputs["cls_8"][0, 6, 0] = .81
        outputs["obj_8"][0, 6, 0] = 1
        outputs["bbox_8"][0, 6] = [.5, .5, np.log(2), np.log(4)]
        found = decode(list(outputs.values()), list(outputs), "yunet", (1, 3, 32, 32), (.5, .5, 0, 0))
        np.testing.assert_allclose(found[0], [24, -8, 56, 56, .9], atol=1e-5)


if __name__ == "__main__":
    unittest.main()
