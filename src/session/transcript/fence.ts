const FENCE = /^ {0,3}(`{3,}|~{3,})/;

/** The code fence open after `line`, given the one open before it (null: none); roughly CommonMark. */
export function nextFence(fence: string | null, line: string): string | null {
  const m = FENCE.exec(line);
  if (!m) return fence;
  const marker = m[1]!;
  if (fence == null) return marker;
  return marker[0] === fence[0] && marker.length >= fence.length && line.trim() === marker ? null : fence;
}
