import { pageCuts } from '../../src/ui/pdfPaging';

const b = (top: number, bottom: number) => ({ top, bottom });

describe('pageCuts', () => {
  it('one page when everything fits', () => {
    expect(pageCuts([b(0, 300), b(300, 900)], 900, 1000)).toEqual([0]);
  });
  it('never cuts inside a block', () => {
    expect(pageCuts([b(0, 400), b(400, 700), b(700, 1100)], 1100, 1000)).toEqual([0, 700]);
  });
  it('moves the end block whole', () => {
    expect(pageCuts([b(0, 500), b(500, 950), b(950, 1300)], 1300, 1000)).toEqual([0, 950]);
  });
  it('cuts a block taller than a page at the page height', () => {
    expect(pageCuts([b(0, 2500)], 2500, 1000)).toEqual([0, 1000, 2000]);
  });
  it('continues paging after a moved block', () => {
    expect(pageCuts([b(0, 600), b(600, 1200), b(1200, 1900), b(1900, 2100)], 2100, 1000)).toEqual([0, 600, 1200]);
  });
});
