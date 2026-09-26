/**
 * Where each PDF page starts (in content pixels). Pages are `pageHeight` tall; a page break never
 * falls inside a block unless that block alone is taller than a page, in which case it is cut at the page height.
 */
export function pageCuts(blocks: { top: number; bottom: number }[], contentHeight: number, pageHeight: number): number[] {
  const cuts = [0];
  let start = 0;
  while (start + pageHeight < contentHeight) {
    const limit = start + pageHeight;
    const straddling = blocks.find((blk) => blk.top > start && blk.top < limit && blk.bottom > limit);
    const next = straddling ? straddling.top : limit;
    cuts.push(next);
    start = next;
  }
  return cuts;
}
