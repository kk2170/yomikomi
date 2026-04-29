import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { backup, DatabaseSync } from 'node:sqlite';
import Parser from 'rss-parser';
import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import sanitizeHtml from 'sanitize-html';
import type {
  DiscoveredFeed,
  FeedArticle,
  FeedResult,
  FeedSubscription,
  SaveArticleInput,
  SavedArticle,
  SavedArticleSummary,
} from '../shared/types';
import {
  buildArticleSummary,
  buildDatabaseExportFileName,
  normalizeHttpUrl,
  stripHtmlToText,
} from '../shared/article-utils';

const parser = new Parser();

let database: DatabaseSync | null = null;

const getDatabasePath = () => path.join(app.getPath('userData'), 'yomikomi.db');

const parseRequiredHttpUrl = (input: string, label: string) => {
  if (!input.trim()) {
    throw new Error(`${label}を入力してください。`);
  }

  try {
    return normalizeHttpUrl(input);
  } catch (error) {
    if (error instanceof Error && error.message === 'http または https のURLを入力してください。') {
      const wrappedError = new Error(`${label}は http または https のURLを入力してください。`);
      (wrappedError as Error & { cause?: unknown }).cause = error;
      throw wrappedError;
    }

    throw error;
  }
};

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');

const getDatabase = () => {
  if (database) {
    return database;
  }

  const databasePath = getDatabasePath();
  database = new DatabaseSync(databasePath);
  database.exec(`
    PRAGMA journal_mode = WAL;

    CREATE TABLE IF NOT EXISTS feeds (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      url TEXT NOT NULL UNIQUE,
      added_at TEXT NOT NULL,
      last_fetched_at TEXT
    );

    CREATE TABLE IF NOT EXISTS saved_articles (
      id TEXT PRIMARY KEY,
      feed_id TEXT,
      feed_title TEXT,
      title TEXT NOT NULL,
      source_url TEXT NOT NULL UNIQUE,
      summary TEXT NOT NULL,
      site_name TEXT,
      byline TEXT,
      excerpt TEXT NOT NULL,
      content_html TEXT NOT NULL,
      text_content TEXT NOT NULL,
      published_at TEXT,
      saved_at TEXT NOT NULL
    );
  `);

  return database;
};

const sanitizeArticleHtml = (html: string) =>
  sanitizeHtml(html, {
    allowedTags: sanitizeHtml.defaults.allowedTags.concat([
      'img',
      'h1',
      'h2',
      'figure',
      'figcaption',
      'section',
      'article',
      'time',
      'pre',
      'code',
    ]),
    allowedAttributes: {
      a: ['href', 'name', 'target', 'rel'],
      img: ['src', 'srcset', 'alt', 'title'],
      '*': ['class'],
    },
    allowedSchemes: ['http', 'https', 'data', 'mailto'],
    transformTags: {
      a: sanitizeHtml.simpleTransform('a', { target: '_blank', rel: 'noreferrer noopener' }),
    },
  });

const fetchText = async (url: string) => {
  const response = await fetch(url, {
    redirect: 'follow',
    headers: {
      'user-agent': 'YomiKomi/0.2 (+https://localhost)',
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    },
  });

  if (!response.ok) {
    throw new Error(`取得に失敗しました: ${response.status} ${response.statusText}`);
  }

  return response.text();
};

const tryParseFeed = async (feedUrl: string) => {
  try {
    const xml = await fetchText(feedUrl);
    const parsed = await parser.parseString(xml);

    return {
      title: parsed.title?.trim() || feedUrl,
      url: feedUrl,
    };
  } catch {
    return null;
  }
};

const discoverFeedsFromArticleUrl = async (articleUrl: string): Promise<DiscoveredFeed[]> => {
  const normalizedArticleUrl = parseRequiredHttpUrl(articleUrl, '記事URL');
  const html = await fetchText(normalizedArticleUrl);
  const dom = new JSDOM(html, { url: normalizedArticleUrl });
  const document = dom.window.document;
  const seen = new Set<string>();
  const discovered: DiscoveredFeed[] = [];

  const registerFeed = async (candidateUrl: string, source: DiscoveredFeed['source'], title?: string) => {
    let normalizedCandidateUrl: string;

    try {
      normalizedCandidateUrl = normalizeHttpUrl(candidateUrl);
    } catch {
      return;
    }

    if (seen.has(normalizedCandidateUrl)) {
      return;
    }

    const parsedFeed = await tryParseFeed(normalizedCandidateUrl);
    if (!parsedFeed) {
      return;
    }

    seen.add(normalizedCandidateUrl);
    discovered.push({
      title: title?.trim() || parsedFeed.title,
      url: normalizedCandidateUrl,
      source,
    });
  };

  const alternateLinks = Array.from(
    document.querySelectorAll<HTMLLinkElement>('link[rel~="alternate"][href]'),
  );

  for (const link of alternateLinks) {
    const type = link.type?.toLowerCase() ?? '';
    const href = link.getAttribute('href');

    if (!href || !['application/rss+xml', 'application/atom+xml', 'application/rdf+xml'].includes(type)) {
      continue;
    }

    await registerFeed(new URL(href, normalizedArticleUrl).toString(), 'page-link', link.title);
  }

  const commonFeedPaths = ['/feed', '/feed.xml', '/rss', '/rss.xml', '/atom.xml', '/index.xml'];
  const origin = new URL(normalizedArticleUrl).origin;

  for (const feedPath of commonFeedPaths) {
    await registerFeed(new URL(feedPath, origin).toString(), 'common-path');
  }

  if (discovered.length === 0) {
    throw new Error('記事URLからRSS/Atomフィード候補を見つけられませんでした。');
  }

  return discovered.slice(0, 5);
};

const mapFeedRow = (row: Record<string, unknown>): FeedSubscription => ({
  id: String(row.id),
  title: String(row.title),
  url: String(row.url),
  addedAt: String(row.added_at),
  lastFetchedAt: row.last_fetched_at ? String(row.last_fetched_at) : undefined,
});

const mapSavedArticleSummaryRow = (row: Record<string, unknown>): SavedArticleSummary => ({
  id: String(row.id),
  feedId: row.feed_id ? String(row.feed_id) : undefined,
  feedTitle: row.feed_title ? String(row.feed_title) : undefined,
  title: String(row.title),
  sourceUrl: String(row.source_url),
  summary: String(row.summary),
  siteName: row.site_name ? String(row.site_name) : undefined,
  publishedAt: row.published_at ? String(row.published_at) : undefined,
  savedAt: String(row.saved_at),
});

const mapSavedArticleRow = (row: Record<string, unknown>): SavedArticle => ({
  ...mapSavedArticleSummaryRow(row),
  byline: row.byline ? String(row.byline) : undefined,
  excerpt: String(row.excerpt),
  contentHtml: String(row.content_html),
  textContent: String(row.text_content),
});

const listSubscriptions = (): FeedSubscription[] => {
  const rows = getDatabase()
    .prepare('SELECT id, title, url, added_at, last_fetched_at FROM feeds ORDER BY added_at ASC')
    .all() as Record<string, unknown>[];

  return rows.map(mapFeedRow);
};

const insertSubscription = (subscription: FeedSubscription) => {
  getDatabase()
    .prepare(
      `INSERT INTO feeds (id, title, url, added_at, last_fetched_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(
      subscription.id,
      subscription.title,
      subscription.url,
      subscription.addedAt,
      subscription.lastFetchedAt ?? null,
    );
};

const updateSubscription = (subscription: FeedSubscription) => {
  getDatabase()
    .prepare(
      `UPDATE feeds
       SET title = ?, url = ?, added_at = ?, last_fetched_at = ?
       WHERE id = ?`,
    )
    .run(
      subscription.title,
      subscription.url,
      subscription.addedAt,
      subscription.lastFetchedAt ?? null,
      subscription.id,
    );
};

const fetchFeedSnapshot = async (subscription: FeedSubscription): Promise<FeedResult> => {
  const xml = await fetchText(subscription.url);
  const parsed = await parser.parseString(xml);
  const fetchedAt = new Date().toISOString();
  const normalizedSubscription: FeedSubscription = {
    ...subscription,
    title: parsed.title?.trim() || subscription.title,
    lastFetchedAt: fetchedAt,
  };

  const articles: FeedArticle[] = (parsed.items ?? []).map((item, index) => ({
    id: item.guid ?? item.id ?? item.link ?? `${subscription.id}-${index}`,
    feedId: subscription.id,
    feedTitle: normalizedSubscription.title,
    title: item.title?.trim() || 'タイトルなし',
    link: item.link ?? subscription.url,
    summary: stripHtmlToText(item.contentSnippet ?? item.content ?? item.summary),
    publishedAt: item.isoDate ?? item.pubDate,
  }));

  return {
    subscription: normalizedSubscription,
    articles,
  };
};

const listSavedArticles = (): SavedArticleSummary[] => {
  const rows = getDatabase()
    .prepare(
      `SELECT id, feed_id, feed_title, title, source_url, summary, site_name, published_at, saved_at
       FROM saved_articles
       ORDER BY saved_at DESC`,
    )
    .all() as Record<string, unknown>[];

  return rows.map(mapSavedArticleSummaryRow);
};

const getSavedArticle = (articleId: string): SavedArticle => {
  const row = getDatabase()
    .prepare(
      `SELECT id, feed_id, feed_title, title, source_url, summary, site_name, byline, excerpt,
              content_html, text_content, published_at, saved_at
       FROM saved_articles
       WHERE id = ?`,
    )
    .get(articleId) as Record<string, unknown> | undefined;

  if (!row) {
    throw new Error('保存済み記事が見つかりません。');
  }

  return mapSavedArticleRow(row);
};

const saveArticle = async (input: SaveArticleInput): Promise<SavedArticle> => {
  const sourceUrl = parseRequiredHttpUrl(input.sourceUrl, '記事URL');

  const existing = getDatabase()
    .prepare('SELECT id FROM saved_articles WHERE source_url = ?')
    .get(sourceUrl) as Record<string, unknown> | undefined;

  const html = await fetchText(sourceUrl);
  const dom = new JSDOM(html, { url: sourceUrl });
  const parsed = new Readability(dom.window.document).parse();

  const rawContent = parsed?.content ?? dom.window.document.body?.innerHTML ?? '';
  const safeContent = sanitizeArticleHtml(rawContent);

  if (!safeContent.trim()) {
    throw new Error('記事本文を抽出できませんでした。');
  }

  const title =
    parsed?.title?.trim() || input.title.trim() || dom.window.document.title.trim() || sourceUrl;
  const articleId = existing ? String(existing.id) : randomUUID();
  const savedAt = new Date().toISOString();
  const siteName = parsed?.siteName?.trim() || new URL(sourceUrl).hostname;
  const excerpt = parsed?.excerpt?.trim() || input.summary?.trim() || '';
  const summary = buildArticleSummary({
    summary: input.summary,
    excerpt,
    contentHtml: safeContent,
  });
  const textContent = parsed?.textContent?.trim() || stripHtmlToText(safeContent);

  getDatabase()
    .prepare(
      `INSERT INTO saved_articles (
         id, feed_id, feed_title, title, source_url, summary, site_name, byline,
         excerpt, content_html, text_content, published_at, saved_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(source_url) DO UPDATE SET
         feed_id = excluded.feed_id,
         feed_title = excluded.feed_title,
         title = excluded.title,
         summary = excluded.summary,
         site_name = excluded.site_name,
         byline = excluded.byline,
         excerpt = excluded.excerpt,
         content_html = excluded.content_html,
         text_content = excluded.text_content,
         published_at = excluded.published_at,
         saved_at = excluded.saved_at`,
    )
    .run(
      articleId,
      input.feedId ?? null,
      input.feedTitle ?? null,
      title,
      sourceUrl,
      summary,
      siteName,
      parsed?.byline?.trim() ?? null,
      excerpt,
      safeContent,
      textContent,
      input.publishedAt ?? null,
      savedAt,
    );

  return getSavedArticle(articleId);
};

const exportDatabase = async () => {
  const defaultPath = path.join(
    app.getPath('documents'),
    buildDatabaseExportFileName(new Date().toISOString()),
  );
  const saveDialogOptions = {
    title: 'YomiKomiのSQLiteデータベースを書き出す',
    defaultPath,
    filters: [{ name: 'SQLite Database', extensions: ['sqlite3', 'db'] }],
  };
  const focusedWindow = BrowserWindow.getFocusedWindow();
  const result = focusedWindow
    ? await dialog.showSaveDialog(focusedWindow, saveDialogOptions)
    : await dialog.showSaveDialog(saveDialogOptions);

  if (result.canceled || !result.filePath) {
    return null;
  }

  await backup(getDatabase(), result.filePath, { rate: 200 });
  return result.filePath;
};

const createWindow = async () => {
  const mainWindow = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 1024,
    minHeight: 720,
    backgroundColor: '#0b1120',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  const devServerUrl = process.env.VITE_DEV_SERVER_URL ?? (!app.isPackaged ? 'http://127.0.0.1:5173' : undefined);
  if (devServerUrl) {
    await mainWindow.loadURL(devServerUrl);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
    return;
  }

  await mainWindow.loadFile(path.join(app.getAppPath(), 'dist', 'index.html'));
};

ipcMain.handle('feeds:list', async () => listSubscriptions());

ipcMain.handle('feeds:add', async (_event, url: string) => {
  const normalizedUrl = parseRequiredHttpUrl(url, 'RSS フィード URL');

  const subscriptions = listSubscriptions();
  if (subscriptions.some((feed) => feed.url === normalizedUrl)) {
    throw new Error('その RSS フィードはすでに登録されています。');
  }

  const draft: FeedSubscription = {
    id: randomUUID(),
    title: normalizedUrl,
    url: normalizedUrl,
    addedAt: new Date().toISOString(),
  };

  const result = await fetchFeedSnapshot(draft);
  insertSubscription(result.subscription);

  return result.subscription;
});

ipcMain.handle('feeds:discover', async (_event, articleUrl: string) =>
  discoverFeedsFromArticleUrl(articleUrl),
);

ipcMain.handle('feeds:remove', async (_event, feedId: string) => {
  getDatabase().prepare('DELETE FROM feeds WHERE id = ?').run(feedId);
});

ipcMain.handle('feeds:refresh', async (_event, feedId: string) => {
  const target = listSubscriptions().find((feed) => feed.id === feedId);
  if (!target) {
    throw new Error('対象のフィードが見つかりません。');
  }

  const result = await fetchFeedSnapshot(target);
  updateSubscription(result.subscription);

  return result;
});

ipcMain.handle('saved:list', async () => listSavedArticles());
ipcMain.handle('saved:get', async (_event, articleId: string) => getSavedArticle(articleId));
ipcMain.handle('saved:save', async (_event, input: SaveArticleInput) => saveArticle(input));
ipcMain.handle('saved:remove', async (_event, articleId: string) => {
  getDatabase().prepare('DELETE FROM saved_articles WHERE id = ?').run(articleId);
});
ipcMain.handle('database:export', async () => exportDatabase());

ipcMain.handle('article:open', async (_event, url: string) => {
  await shell.openExternal(url);
});

ipcMain.handle('archive:open', async (_event, url: string) => {
  await shell.openExternal(`https://web.archive.org/save/${encodeURIComponent(url)}`);
});

app.whenReady().then(async () => {
  getDatabase();
  await createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
