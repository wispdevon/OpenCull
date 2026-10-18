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
    const { scroller, length, from, to, onScroll } = useStrip({ starts, pad: 0, position: 0, anchor: 0 });
    return <div ref={scroller} onScroll={onScroll} style={{ width: 1200, height: 24, overflow: "auto" }}>
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
    const wheel = (init: WheelEventInit) => {
      const event = new WheelEvent("wheel", { bubbles: true, cancelable: true, ...init });
      el.dispatchEvent(event);
      return event;
    };
    const moved = (init: WheelEventInit, distance: number) => {
      el.scrollLeft = 4000;
      const event = wheel(init);
      if (!event.defaultPrevented || Math.abs(el.scrollLeft - 4000 - distance) > 1) {
        throw new Error("strip wheel must have one scrolling owner and preserve its delta");
      }
      covered();
    };
    moved({ deltaY: 10 }, 15);
    moved({ deltaX: 20, deltaY: 1 }, 20);
    moved({ deltaY: 2, deltaMode: 1 }, 48);
    moved({ deltaY: 1, deltaMode: 2 }, 1800);
    el.scrollLeft = 4000;
    for (let n = 0; n < 100; n++) wheel({ deltaY: 0.5 });
    if (Math.abs(el.scrollLeft - 4075) > 1) throw new Error(`fractional wheel deltas were lost: ${el.scrollLeft}`);
    for (const modifier of ["altKey", "ctrlKey", "metaKey"] as const) {
      const before = el.scrollLeft;
      if (wheel({ deltaY: 10, [modifier]: true }).defaultPrevented || el.scrollLeft !== before) {
        throw new Error("modified wheel must remain available to the browser");
      }
    }
    for (let n = 0; n < 32; n++) {
      el.dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: (n < 16 ? 1 : -1) * 1200 }));
      covered();
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      covered();
    }
    // Scrollbar drags and programmatic scrolling still update virtual coverage.
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
