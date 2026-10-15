import { faceOutline } from "@/lib/face-target";
import { useStore } from "@/lib/store";
import type { Photo } from "@/lib/types";

/** One lightweight SVG over the existing image; no duplicate image or blur layer. */
export function FaceOverlays({ photo }: { photo: Photo }) {
  const enabled = useStore((s) => s.aiEnabled);
  const outlines = useStore((s) => s.experimentalFaceOutlines);
  const spotlight = useStore((s) => s.experimentalFaceSpotlight && s.showFaces && !s.settingsOpen);
  const faces = useStore((s) => s.ai[photo.index]?.faces);
  const hover = useStore((s) => s.hoveredFace);
  if (!enabled || !faces || (!outlines && !spotlight)) return null;
  const active = spotlight && hover?.photoIndex === photo.index && hover.display === photo.display && hover.version === photo.version ? faces.indexOf(hover.face) : -1;
  const paths = faces.map((face) => {
    const corners = faceOutline(face, photo);
    return corners ? `M${corners.map((p) => `${p.x} ${p.y}`).join("L")}Z` : null;
  });
  const hole = active >= 0 ? paths[active] : null;
  if (!outlines && !hole) return null;
  return <svg data-face-overlays="" aria-hidden="true" className="pointer-events-none absolute inset-0 size-full overflow-hidden" viewBox="0 0 1 1" preserveAspectRatio="none">
    {hole && <path data-face-spotlight="" d={`M0 0H1V1H0Z ${hole}`} fill="black" fillOpacity="0.72" fillRule="evenodd" />}
    {paths.map((path, index) => path && (outlines || index === active) ? <g key={index} data-face-outline={index}>
      <path d={path} fill="none" stroke="#111" strokeWidth="4" vectorEffect="non-scaling-stroke" />
      <path d={path} fill="none" stroke={index === active ? "var(--color-brand, #59a6ff)" : "white"} strokeWidth="2" vectorEffect="non-scaling-stroke" />
    </g> : null)}
  </svg>;
}
