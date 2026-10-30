const viewports = new Map([
  ['390x844', { width: 390, height: 844 }],
  ['1280x800', { width: 1280, height: 800 }],
]);

export function perfViewport(raw: unknown = '1280x800'): { width: number; height: number } {
  if (typeof raw !== 'string') throw new TypeError('Expected a declared performance viewport');
  const viewport = viewports.get(raw);
  if (!viewport) throw new RangeError('Expected 390x844 or 1280x800');
  return { ...viewport };
}
