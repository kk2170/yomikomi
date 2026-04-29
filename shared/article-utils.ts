export const stripHtmlToText = (value?: string | null) =>
  (value ?? '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

export const buildArticleSummary = (options: {
  summary?: string;
  excerpt?: string;
  contentHtml?: string;
}) => {
  const normalizedSummary = options.summary?.trim();
  if (normalizedSummary) {
    return normalizedSummary;
  }

  const normalizedExcerpt = options.excerpt?.trim();
  if (normalizedExcerpt) {
    return normalizedExcerpt;
  }

  return stripHtmlToText(options.contentHtml).slice(0, 180);
};

export const buildDatabaseExportFileName = (isoDate: string) =>
  `yomikomi-${isoDate.slice(0, 10)}.sqlite3`;
