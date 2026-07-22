export const estimateTranslationSize = (text: string) => {
  let size = 0;
  for (const character of text) {
    if (/\s/u.test(character)) size += 0.25;
    else if (/^[\x00-\x7f]$/u.test(character)) size += 0.5;
    else size += 1;
  }
  return size;
};
