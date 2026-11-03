/**
 * Splits a label into lines no wider than `maxWidth`, breaking only at
 * spaces, like Pixi's word wrap that core's graph labels use (300 units
 * wide, `breakWords` off): a word wider than the box stays whole and runs
 * past it. Pure: `measure` is passed in.
 */
export const wrapText = (
  text: string,
  maxWidth: number,
  measure: (s: string) => number,
): string[] => {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(" ")) {
    if (!line) {
      line = word;
      continue;
    }
    const candidate = `${line} ${word}`;
    if (measure(candidate) <= maxWidth) line = candidate;
    else {
      lines.push(line);
      line = word;
    }
  }
  lines.push(line);
  return lines;
};
