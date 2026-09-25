const VI_DIGITS = ['không', 'một', 'hai', 'ba', 'bốn', 'năm', 'sáu', 'bảy', 'tám', 'chín'];
const VI_SCALES = ['', 'nghìn', 'triệu', 'tỷ', 'nghìn tỷ'];

const EN_ONES = [
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen',
];
const EN_TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
const EN_SCALES = ['', 'thousand', 'million', 'billion', 'trillion'];

function assertAmount(n: number): void {
  if (!Number.isInteger(n) || n < 0 || n >= 1e15) {
    throw new RangeError(`Unsupported amount: ${n}`);
  }
}

/** Split into groups of three digits, least significant first. */
function groups(n: number): number[] {
  const g: number[] = [];
  while (n > 0) {
    g.push(n % 1000);
    n = Math.floor(n / 1000);
  }
  return g;
}

const capitalise = (s: string) => s[0].toUpperCase() + s.slice(1);

/** `full` = this group follows a higher group, so "không trăm" / "linh" must be spoken. */
function viTriple(n: number, full: boolean): string {
  const h = Math.floor(n / 100);
  const t = Math.floor(n / 10) % 10;
  const u = n % 10;
  const p: string[] = [];
  if (h > 0 || full) p.push(VI_DIGITS[h], 'trăm');
  if (t === 0) {
    if (u > 0 && (h > 0 || full)) p.push('linh');
  } else if (t === 1) {
    p.push('mười');
  } else {
    p.push(VI_DIGITS[t], 'mươi');
  }
  if (u > 0) {
    if (u === 1 && t >= 2) p.push('mốt');
    else if (u === 5 && t >= 1) p.push('lăm');
    else p.push(VI_DIGITS[u]);
  }
  return p.join(' ');
}

export function vndToWordsVi(n: number): string {
  assertAmount(n);
  if (n === 0) return 'Không đồng.';
  const g = groups(n);
  const parts: string[] = [];
  for (let i = g.length - 1; i >= 0; i--) {
    if (g[i] === 0) continue;
    parts.push(viTriple(g[i], i < g.length - 1));
    if (VI_SCALES[i]) parts.push(VI_SCALES[i]);
  }
  return `${capitalise(parts.join(' '))} đồng.`;
}

function enTriple(n: number): string {
  const h = Math.floor(n / 100);
  const r = n % 100;
  const p: string[] = [];
  if (h > 0) p.push(EN_ONES[h], 'hundred');
  if (r > 0) {
    if (r < 20) p.push(EN_ONES[r]);
    else p.push(r % 10 ? `${EN_TENS[Math.floor(r / 10)]}-${EN_ONES[r % 10]}` : EN_TENS[r / 10]);
  }
  return p.join(' ');
}

export function vndToWordsEn(n: number): string {
  assertAmount(n);
  if (n === 0) return 'Zero dong.';
  const g = groups(n);
  const parts: string[] = [];
  for (let i = g.length - 1; i >= 0; i--) {
    if (g[i] === 0) continue;
    parts.push(enTriple(g[i]));
    if (EN_SCALES[i]) parts.push(EN_SCALES[i]);
  }
  return `${capitalise(parts.join(' '))} dong.`;
}
