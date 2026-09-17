// The app-wide tooltip layer (KANBAN-47). The native `title` tooltip takes a
// second or more to appear (David, 2026-09-17), so one delegated layer shows a
// styled tip for EVERY element with a `title` instead:
//
// - ~150ms after a mouse/pen hover (at once when moving on from a tip that was
//   just showing), and at once on keyboard focus (:focus-visible). Never for
//   touch.
// - Hover takes the nearest element (or ancestor) with a title, as the native
//   tooltip does; focus only the focused element's own title.
// - When an element is first hovered or focused its `title` moves to
//   `data-tip`, so the native tooltip never also appears. A `title` present
//   later (React set a new value) wins and moves again. `title=""` means "no
//   tip here" (use it, not `undefined`, to switch a tip off conditionally:
//   React can't remove an attribute that is already gone).
// - The accessible name/description the title provided is kept, in the same
//   step as the move (titleA11yRole in lib/tooltip.ts).
// - Hidden on leave, blur, pointerdown (until the pointer leaves), Esc, any
//   scroll, resize, and if the element leaves the DOM.
// - One fixed-position element at the end of <body>, placed from
//   getBoundingClientRect, so scroll containers never clip it.
//
// Listeners are on `window` in the capture phase, so surfaces that stop events
// from bubbling (the GitHub help dialog's portal) still get tooltips.
// Framework-free so a static harness can run the real thing.

import { placeTip, tipText, titleA11yRole } from "./tooltip.ts";

const HOVER_DELAY_MS = 150;
/** Moving onto another tip this soon after one hid shows it at once. */
const WARM_MS = 300;
const TIP_ATTR = "data-tip";
/** Which aria attribute the layer set from the tip ("label" | "description"). */
const A11Y_ATTR = "data-tip-a11y";
const SELECTOR = `[title],[${TIP_ATTR}]`;

type Via = "hover" | "focus";

/** Mount the layer on `doc`; returns the unmount function. */
export function mountTooltipLayer(doc: Document): () => void {
  const win = doc.defaultView;
  if (!win) return () => {};

  const tip = doc.createElement("div");
  tip.className = "app-tooltip";
  tip.setAttribute("role", "tooltip");
  tip.hidden = true;
  doc.body.appendChild(tip);

  let anchor: Element | null = null;
  let via: Via | null = null;
  let pending: Element | null = null;
  let pendingTimer: number | undefined;
  let hiddenAt = 0;
  /** A pressed element: no hover tip again until the pointer leaves it. */
  let pressed: Element | null = null;
  let watchTimer: number | undefined;

  /**
   * The tip for `el`, moving a fresh `title` into `data-tip` (and keeping the
   * accessible name/description it provided) on the way.
   */
  function adopt(el: Element): string | null {
    if (!el.hasAttribute("title")) return tipText(el.getAttribute(TIP_ATTR));
    const text = tipText(el.getAttribute("title"));
    if (!text) {
      // title="" switches the tip off; leave it so it also hides ancestors'.
      el.removeAttribute(TIP_ATTR);
      syncA11y(el, null);
      return null;
    }
    // One synchronous step: never a moment with neither title nor aria name.
    syncA11y(el, text);
    el.setAttribute(TIP_ATTR, text);
    el.removeAttribute("title");
    return text;
  }

  function syncA11y(el: Element, text: string | null) {
    // Undo what the layer set for the old tip, then decide afresh for the new
    // one. Set before removing, so a name never goes missing in between.
    const managed = el.getAttribute(A11Y_ATTR);
    if (managed === "label" && text) {
      el.setAttribute("aria-label", text);
      return;
    }
    if (managed === "label" || managed === "description") {
      el.removeAttribute(`aria-${managed}`);
      el.removeAttribute(A11Y_ATTR);
    }
    if (!text) return;
    const role = titleA11yRole({
      tip: text,
      ariaLabel: el.getAttribute("aria-label"),
      hasLabelledBy: el.hasAttribute("aria-labelledby"),
      hasLabels: hasLabels(el),
      text: el.textContent ?? "",
      hasDescription:
        el.hasAttribute("aria-describedby") || el.hasAttribute("aria-description"),
    });
    if (role === "none") return;
    el.setAttribute(`aria-${role}`, text);
    el.setAttribute(A11Y_ATTR, role);
  }

  function hasLabels(el: Element): boolean {
    const labels = (el as HTMLInputElement).labels;
    return !!labels && labels.length > 0;
  }

  function cancelPending() {
    if (pendingTimer !== undefined) win!.clearTimeout(pendingTimer);
    pendingTimer = undefined;
    pending = null;
  }

  function show(el: Element, text: string, how: Via) {
    cancelPending();
    const rect = el.getBoundingClientRect();
    if (!el.isConnected || (rect.width === 0 && rect.height === 0)) return;
    tip.textContent = text;
    tip.style.left = "0px";
    tip.style.top = "0px";
    tip.removeAttribute("data-open");
    tip.hidden = false;
    const { left, top, side } = placeTip({
      anchor: rect,
      width: tip.offsetWidth,
      height: tip.offsetHeight,
      viewportWidth: doc.documentElement.clientWidth,
      viewportHeight: win!.innerHeight,
    });
    tip.style.left = `${left}px`;
    tip.style.top = `${top}px`;
    tip.setAttribute("data-side", side);
    // Force a style flush so the fade-in runs from 0.
    void tip.offsetWidth;
    tip.setAttribute("data-open", "");
    anchor = el;
    via = how;
    if (watchTimer === undefined) {
      watchTimer = win!.setInterval(() => {
        if (anchor && !anchor.isConnected) hide();
      }, 250);
    }
  }

  function hide() {
    cancelPending();
    if (!anchor) return;
    anchor = null;
    via = null;
    tip.hidden = true;
    tip.removeAttribute("data-open");
    hiddenAt = Date.now();
    if (watchTimer !== undefined) win!.clearInterval(watchTimer);
    watchTimer = undefined;
  }

  function onPointerOver(e: PointerEvent) {
    if (e.pointerType === "touch") return;
    const target = e.target instanceof Element ? e.target : null;
    const el = target?.closest(SELECTOR) ?? null;
    if (el && pressed === el) return;
    if (!el) {
      if (via === "hover") hide();
      cancelPending();
      return;
    }
    const text = adopt(el);
    if (!text) {
      if (via === "hover") hide();
      cancelPending();
      return;
    }
    if (el === anchor) return;
    if (el === pending) return;
    const warm = anchor !== null || Date.now() - hiddenAt < WARM_MS;
    if (warm) {
      show(el, text, "hover");
      return;
    }
    cancelPending();
    pending = el;
    pendingTimer = win!.setTimeout(() => {
      pendingTimer = undefined;
      pending = null;
      // Re-read: the title may have changed during the delay.
      const fresh = adopt(el);
      if (fresh) show(el, fresh, "hover");
    }, HOVER_DELAY_MS);
  }

  function onPointerOut(e: PointerEvent) {
    if (e.pointerType === "touch") return;
    const to = e.relatedTarget instanceof Node ? e.relatedTarget : null;
    if (pressed && !(to && pressed.contains(to))) pressed = null;
    if (pending && !(to && pending.contains(to))) cancelPending();
    if (via === "hover" && anchor && !(to && anchor.contains(to))) hide();
  }

  function onPointerDown(e: PointerEvent) {
    const target = e.target instanceof Element ? e.target : null;
    pressed = target?.closest(SELECTOR) ?? null;
    hide();
    hiddenAt = 0; // A press is not a "move on": the next tip waits its delay.
  }

  function onFocusIn(e: FocusEvent) {
    const el = e.target instanceof Element ? e.target : null;
    if (!el || !el.matches(SELECTOR)) return;
    let visible = false;
    try {
      visible = el.matches(":focus-visible");
    } catch {
      visible = false;
    }
    if (!visible) return;
    const text = adopt(el);
    if (text) show(el, text, "focus");
  }

  function onFocusOut(e: FocusEvent) {
    if (via === "focus" && e.target === anchor) hide();
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key !== "Escape" || !anchor) return;
    if (via === "hover") pressed = anchor;
    hide();
  }

  const onHide = () => hide();

  const opts = { capture: true, passive: true } as const;
  win.addEventListener("pointerover", onPointerOver, opts);
  win.addEventListener("pointerout", onPointerOut, opts);
  win.addEventListener("pointerdown", onPointerDown, opts);
  win.addEventListener("focusin", onFocusIn, opts);
  win.addEventListener("focusout", onFocusOut, opts);
  win.addEventListener("keydown", onKeyDown, opts);
  win.addEventListener("scroll", onHide, opts);
  win.addEventListener("resize", onHide, opts);
  win.addEventListener("blur", onHide);

  return () => {
    hide();
    win.removeEventListener("pointerover", onPointerOver, opts);
    win.removeEventListener("pointerout", onPointerOut, opts);
    win.removeEventListener("pointerdown", onPointerDown, opts);
    win.removeEventListener("focusin", onFocusIn, opts);
    win.removeEventListener("focusout", onFocusOut, opts);
    win.removeEventListener("keydown", onKeyDown, opts);
    win.removeEventListener("scroll", onHide, opts);
    win.removeEventListener("resize", onHide, opts);
    win.removeEventListener("blur", onHide);
    tip.remove();
  };
}
