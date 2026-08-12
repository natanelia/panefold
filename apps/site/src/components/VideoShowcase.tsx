import { Maximize2, Play } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { siteAsset } from "../lib/router";

export function VideoShowcase() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(
    () => !window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );

  useEffect(() => {
    const video = videoRef.current;
    if (video === null) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      video.pause();
    } else {
      void video.play().catch(() => setPlaying(false));
    }
  }, []);

  return (
    <div className="relative overflow-hidden rounded-2xl border border-white/[0.1] bg-[#090e15] shadow-2xl">
      <video
        ref={videoRef}
        className="aspect-[16/10] w-full bg-[#090e15] object-cover"
        src={siteAsset("media/panefold-interactions.webm")}
        poster={siteAsset("media/panefold-interactions-poster.jpg")}
        muted
        loop
        playsInline
        preload="metadata"
        aria-label="Panefold Atlas demo: resizing panes, moving a panel, closing it, and undoing the operation"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
      />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-28 bg-gradient-to-t from-black/70 to-transparent" />
      <div className="absolute inset-x-4 bottom-4 flex items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold text-white">
            Each accepted gesture commits at most once.
          </p>
          <p className="mt-1 text-[10px] text-slate-400">Resize · move · close · undo</p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            className="grid size-9 place-items-center rounded-full border border-white/15 bg-black/45 text-white backdrop-blur transition hover:bg-black/70"
            aria-label={playing ? "Pause interaction video" : "Play interaction video"}
            onClick={() => {
              const video = videoRef.current;
              if (video === null) return;
              if (video.paused) void video.play();
              else video.pause();
            }}
          >
            {playing ? (
              <span className="flex gap-0.5">
                <i className="h-3 w-0.5 bg-current" />
                <i className="h-3 w-0.5 bg-current" />
              </span>
            ) : (
              <Play className="ml-0.5 size-3.5" fill="currentColor" />
            )}
          </button>
          <button
            type="button"
            className="grid size-9 place-items-center rounded-full border border-white/15 bg-black/45 text-white backdrop-blur transition hover:bg-black/70"
            aria-label="Open interaction video fullscreen"
            onClick={() => void videoRef.current?.requestFullscreen()}
          >
            <Maximize2 className="size-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
