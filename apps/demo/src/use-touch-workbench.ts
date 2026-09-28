import { useEffect, useState } from "react";

const query = "(max-width: 700px), (any-pointer: coarse)";

/** Input policy is view state. It never replaces or writes the saved layout. */
export function useTouchWorkbench(): boolean {
  const [touch, setTouch] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const media = window.matchMedia(query);
    const update = () => setTouch(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    if (!touch) return;
    // Hover-only single-tab chrome would hide the only touch drag handle.
    const hadClass = document.body.classList.contains("pf-hide-single-tab-row");
    document.body.classList.remove("pf-hide-single-tab-row");
    return () => {
      if (hadClass) document.body.classList.add("pf-hide-single-tab-row");
    };
  }, [touch]);
  return touch;
}
