import { useEffect, useState } from "react";
import type { FileToken } from "./file-tokenize.js";

export function FileSyntax({ path, text }: { path: string; text: string }): JSX.Element {
  const [segments, setSegments] = useState<FileToken[] | null>(null);

  useEffect(() => {
    let current = true;
    setSegments(null);
    void import("./file-tokenize.js")
      .then(({ tokenizeFile }) => tokenizeFile(path, text))
      .then((tokens) => { if (current && tokens) setSegments(tokens); });
    return () => { current = false; };
  }, [path, text]);

  if (!segments) return <>{text || " "}</>;
  return <span className="file-syntax">{segments.map((segment, index) => (
    <span className={segment.className} key={`${index}:${segment.text}`}>{segment.text}</span>
  ))}</span>;
}
