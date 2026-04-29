export type FeedSubscription = {
  id: string;
  title: string;
  url: string;
  addedAt: string;
  lastFetchedAt?: string;
};

export type FeedArticle = {
  id: string;
  feedId: string;
  feedTitle: string;
  title: string;
  link: string;
  summary: string;
  publishedAt?: string;
};

export type SaveArticleInput = {
  feedId?: string;
  feedTitle?: string;
  title: string;
  sourceUrl: string;
  summary?: string;
  publishedAt?: string;
};

export type SavedArticleSummary = {
  id: string;
  feedId?: string;
  feedTitle?: string;
  title: string;
  sourceUrl: string;
  summary: string;
  siteName?: string;
  publishedAt?: string;
  savedAt: string;
};

export type SavedArticle = SavedArticleSummary & {
  byline?: string;
  excerpt: string;
  contentHtml: string;
  textContent: string;
};

export type FeedResult = {
  subscription: FeedSubscription;
  articles: FeedArticle[];
};

export type YomiKomiApi = {
  listFeeds: () => Promise<FeedSubscription[]>;
  addFeed: (url: string) => Promise<FeedSubscription>;
  removeFeed: (feedId: string) => Promise<void>;
  refreshFeed: (feedId: string) => Promise<FeedResult>;
  listSavedArticles: () => Promise<SavedArticleSummary[]>;
  getSavedArticle: (articleId: string) => Promise<SavedArticle>;
  saveArticle: (input: SaveArticleInput) => Promise<SavedArticle>;
  removeSavedArticle: (articleId: string) => Promise<void>;
  exportDatabase: () => Promise<string | null>;
  openArticle: (url: string) => Promise<void>;
  openArchive: (url: string) => Promise<void>;
};
