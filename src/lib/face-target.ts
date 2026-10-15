import { uprightToShown } from "./framing";
import type { AiFace, Photo } from "./types";

type FramedPhoto = Pick<Photo, "fullWidth" | "fullHeight" | "framing">;

/** The existing per-face numeric score is sharpness, not the whole-photo AI mark. */
export function highestScoringFace(faces: readonly AiFace[], photo: FramedPhoto): AiFace | null {
  if (photo.fullWidth <= 0 || photo.fullHeight <= 0) return null;
  const visible = faces.filter((face) => {
    if (![face.x, face.y, face.w, face.h, face.sharpness].every((v) => typeof v === "number" && Number.isFinite(v)) || face.w <= 0 || face.h <= 0) return false;
    const at = uprightToShown(photo, { x: face.x + face.w / 2, y: face.y + face.h / 2 });
    return at.x >= 0 && at.x <= 1 && at.y >= 0 && at.y <= 1;
  });
  const subjects = visible.filter((face) => face.subject);
  return (subjects.length ? subjects : visible).reduce<AiFace | null>((best, face) => !best || face.sharpness! > best.sharpness! ? face : best, null);
}
