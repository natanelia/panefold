import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";

export function CodeBlock({
  code,
  language = "code",
  label,
}: {
  readonly code: string;
  readonly language?: string;
  readonly label?: string;
}) {
  const [status, setStatus] = useState<"idle" | "copied" | "failed">("idle");
  const mounted = useRef(true);
  const timeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      clearTimeout(timeout.current);
    };
  }, []);
  const copy = async () => {
    clearTimeout(timeout.current);
    try {
      await navigator.clipboard.writeText(code);
      if (!mounted.current) return;
      setStatus("copied");
    } catch {
      if (!mounted.current) return;
      setStatus("failed");
    }
    timeout.current = setTimeout(() => setStatus("idle"), 2500);
  };
  return (
    <div className="code-frame">
      <div className="code-toolbar">
        <span>{label ?? language}</span>
        <button
          type="button"
          onClick={() => {
            void copy();
          }}
          aria-label={status === "copied" ? "Code copied" : "Copy code"}
        >
          {status === "copied" ? <Check size={14} /> : <Copy size={14} />}{" "}
          {status === "copied" ? "Copied" : "Copy"}
        </button>
      </div>
      <pre tabIndex={0} aria-label={`${label ?? language} code`}>
        <code>{code}</code>
      </pre>
      <span className={status === "failed" ? "copy-error" : "sr-only"} role="status">
        {status === "failed"
          ? "Copy failed. Select and copy the code manually."
          : status === "copied"
            ? "Code copied to clipboard"
            : ""}
      </span>
    </div>
  );
}
