import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { useStrip } from "./strip";

/** Exercise real scroll events and React commits in the native web view. */
export async function checkStripScrolling(): Promise<void> {
  const starts = Float64Array.from({ length: 241 }, (_, i) => i * 180);
  const host = document.createElement("div");
  host.style.cssText = "position:fixed;left:0;top:0;width:1200px;height:24px;pointer-events:none;z-index:-1";
  document.body.append(host);
  const root = createRoot(host);
  function Strip() {
    const { scroller, length, from, to, onScroll, onWheel } = useStrip({ starts, pad: 0, position: 0, anchor: 0 });
    return <div ref={scroller} onScroll={onScroll} onWheel={onWheel} style={{ width: 1200, height: 24, overflow: "auto" }}>
      <div style={{ width: length, height: 1, position: "relative" }}>
        {Array.from({ length: to - from }, (_, i) => from + i).map(i =>
          <div key={i} style={{ position: "absolute", left: starts[i], width: 180, height: 1 }} />)}
      </div>
    </div>;
  }
  try {
    flushSync(() => root.render(<Strip />));
    const el = host.firstElementChild as HTMLDivElement;
    const covered = () => {
      const cells = el.firstElementChild!.children;
      const first = cells[0] as HTMLElement | undefined;
      const last = cells[cells.length - 1] as HTMLElement | undefined;
      if (!first || !last || parseFloat(first.style.left) > el.scrollLeft ||
          parseFloat(last.style.left) + last.offsetWidth < el.scrollLeft + el.clientWidth) {
        throw new Error(`filmstrip has no rendered coverage at scroll offset ${el.scrollLeft}`);
      }
    };
    for (let n = 0; n < 32; n++) {
      el.dispatchEvent(new WheelEvent("wheel", { bubbles: true, deltaY: (n < 16 ? 1 : -1) * 1200 }));
      covered();
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      covered();
    }
    // Horizontal wheels, touchpads and scrollbar drags use native scrolling.
    for (const at of [25000, 500, 40000, 0]) {
      el.scrollLeft = at;
      el.dispatchEvent(new Event("scroll"));
      covered();
    }
  } finally {
    flushSync(() => root.unmount());
    host.remove();
  }
}
