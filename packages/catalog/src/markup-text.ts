export function stripTags(value: string): string {
  const pieces: string[] = [];
  let cursor = 0;
  for (let start = value.indexOf("<", cursor); start >= 0; start = value.indexOf("<", cursor)) {
    const end = value.indexOf(">", start + 1);
    if (end < 0) break;
    pieces.push(value.slice(cursor, start));
    cursor = end + 1;
  }
  pieces.push(value.slice(cursor));
  return pieces.join("");
}
