/** Year picker options: a couple of years back through one year ahead. */
export function getYearOptions(spanBack = 2, spanForward = 1): number[] {
  const current = new Date().getFullYear();
  const years: number[] = [];
  for (let y = current - spanBack; y <= current + spanForward; y++) years.push(y);
  return years;
}
