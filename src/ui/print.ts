/** Opens the browser print dialog; the chosen PDF name comes from document.title. */
export function printBill(fileTitle: string): void {
  const previous = document.title;
  document.title = fileTitle;
  const restore = () => {
    document.title = previous;
    window.removeEventListener('afterprint', restore);
  };
  window.addEventListener('afterprint', restore);
  window.print();
}
