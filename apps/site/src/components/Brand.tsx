import { cn } from "../lib/cn";

export function Brand({ compact = false }: { readonly compact?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <span
        className="relative grid size-8 grid-cols-[0.8fr_1.2fr] grid-rows-2 gap-0.5 overflow-hidden rounded-[9px] border border-cyan-200/25 bg-[#0c1521] p-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]"
        aria-hidden="true"
      >
        <i className="row-span-2 rounded-[2px] border border-cyan-300/55 bg-cyan-300/10" />
        <i className="rounded-[2px] border border-sky-300/45 bg-sky-300/10" />
        <i className="rounded-[2px] border border-teal-300/45 bg-teal-300/10" />
        <span className="absolute left-[47%] top-1/2 size-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-cyan-200 shadow-[0_0_9px_#67e8f9]" />
      </span>
      <span
        className={cn(
          "font-display text-[17px] font-semibold tracking-[-0.02em]",
          compact && "sr-only",
        )}
      >
        Panefold
      </span>
    </span>
  );
}

export function GitHubIcon({ className = "size-4" }: { readonly className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M12 .7a11.5 11.5 0 0 0-3.64 22.42c.58.1.79-.25.79-.56v-2.23c-3.23.7-3.91-1.37-3.91-1.37-.53-1.34-1.29-1.7-1.29-1.7-1.05-.72.08-.7.08-.7 1.17.08 1.78 1.2 1.78 1.2 1.04 1.77 2.72 1.26 3.38.96.1-.75.4-1.26.74-1.55-2.58-.3-5.29-1.29-5.29-5.69 0-1.26.45-2.28 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.16 1.18A10.96 10.96 0 0 1 12 6.13c.98 0 1.96.13 2.87.39 2.2-1.49 3.16-1.18 3.16-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.83 1.19 3.09 0 4.41-2.72 5.39-5.3 5.68.42.36.79 1.07.79 2.16v3.24c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .7Z" />
    </svg>
  );
}
