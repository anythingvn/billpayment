import { vndToWordsVi, vndToWordsEn } from '../../src/domain/words';

const cases: [number, string, string][] = [
  [0, 'Không đồng.', 'Zero dong.'],
  [5, 'Năm đồng.', 'Five dong.'],
  [15, 'Mười lăm đồng.', 'Fifteen dong.'],
  [21, 'Hai mươi mốt đồng.', 'Twenty-one dong.'],
  [25, 'Hai mươi lăm đồng.', 'Twenty-five dong.'],
  [105, 'Một trăm linh năm đồng.', 'One hundred five dong.'],
  [110, 'Một trăm mười đồng.', 'One hundred ten dong.'],
  [1001, 'Một nghìn không trăm linh một đồng.', 'One thousand one dong.'],
  [1000005, 'Một triệu không trăm linh năm đồng.', 'One million five dong.'],
  [
    1005015,
    'Một triệu không trăm linh năm nghìn không trăm mười lăm đồng.',
    'One million five thousand fifteen dong.',
  ],
  [21000000, 'Hai mươi mốt triệu đồng.', 'Twenty-one million dong.'],
  [
    20952000,
    'Hai mươi triệu chín trăm năm mươi hai nghìn đồng.',
    'Twenty million nine hundred fifty-two thousand dong.',
  ],
  [1000000000, 'Một tỷ đồng.', 'One billion dong.'],
  [
    12345678901,
    'Mười hai tỷ ba trăm bốn mươi lăm triệu sáu trăm bảy mươi tám nghìn chín trăm linh một đồng.',
    'Twelve billion three hundred forty-five million six hundred seventy-eight thousand nine hundred one dong.',
  ],
];

describe('amount in words', () => {
  it.each(cases)('%i', (n, vi, en) => {
    expect(vndToWordsVi(n)).toBe(vi);
    expect(vndToWordsEn(n)).toBe(en);
  });
  it('rejects negative or non-integer amounts', () => {
    expect(() => vndToWordsVi(-1)).toThrow();
    expect(() => vndToWordsEn(1.5)).toThrow();
  });
});
