import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import type { SharedZoom } from "@/lib/comparison-zoom";

export interface ComparisonMove {
  viewport: SharedZoom;
  source: string;
  motion: "glide" | "stretch" | "pan";
  ms: number;
}

const Context = createContext<{
  move: ComparisonMove | null;
  publish: (move: ComparisonMove) => void;
} | null>(null);

/** Only the two comparison canvases share a viewport; ordinary loupes stay independent. */
export function ComparisonZoom({ children }: { children: ReactNode }) {
  const [move, publish] = useState<ComparisonMove | null>(null);
  const value = useMemo(() => ({ move, publish }), [move]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export const useComparisonZoom = () => useContext(Context);
