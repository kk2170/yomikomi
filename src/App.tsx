import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import type {
  FeedArticle,
  FeedResult,
  FeedSubscription,
  SavedArticle,
  SavedArticleSummary,
} from '../shared/types';

type FeedState = {
  loading: boolean;
  error?: string;
  data?: FeedResult;
};

type ViewMode = 'feeds' | 'saved';
type ThemeMode = 'system' | 'dark' | 'light';
type StylePreset = 'ocean' | 'forest' | 'sunset' | 'paper';

const THEME_MODE_KEY = 'yomikomi-theme-mode';
const STYLE_PRESET_KEY = 'yomikomi-style-preset';
const themeModes: ThemeMode[] = ['system', 'dark', 'light'];
const stylePresets: StylePreset[] = ['ocean', 'forest', 'sunset', 'paper'];

const readStoredSetting = <T extends string>(
  key: string,
  fallback: T,
  allowedValues: readonly T[],
) => {
  if (typeof window === 'undefined') {
    return fallback;
  }

  const storedValue = window.localStorage.getItem(key);
  return storedValue && allowedValues.includes(storedValue as T) ? (storedValue as T) : fallback;
};

const formatDate = (value?: string) => {
  if (!value) {
    return '---';
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('ja-JP');
};

function App() {
  const [viewMode, setViewMode] = useState<ViewMode>('feeds');
  const [themeMode, setThemeMode] = useState<ThemeMode>(() =>
    readStoredSetting(THEME_MODE_KEY, 'system', themeModes),
  );
  const [stylePreset, setStylePreset] = useState<StylePreset>(() =>
    readStoredSetting(STYLE_PRESET_KEY, 'ocean', stylePresets),
  );
  const [feeds, setFeeds] = useState<FeedSubscription[]>([]);
  const [feedUrl, setFeedUrl] = useState('');
  const [selectedFeedId, setSelectedFeedId] = useState<string>('');
  const [statusMessage, setStatusMessage] = useState('ローカルで読むための記事基地を育てよう。');
  const [submitting, setSubmitting] = useState(false);
  const [refreshingAll, setRefreshingAll] = useState(false);
  const [feedStates, setFeedStates] = useState<Record<string, FeedState>>({});
  const [savedArticles, setSavedArticles] = useState<SavedArticleSummary[]>([]);
  const [savedArticleDetails, setSavedArticleDetails] = useState<Record<string, SavedArticle>>({});
  const [selectedSavedArticleId, setSelectedSavedArticleId] = useState<string>('');
  const [savingUrl, setSavingUrl] = useState<string>('');
  const [exportingDatabase, setExportingDatabase] = useState(false);

  const selectedFeed = useMemo(
    () => feeds.find((feed) => feed.id === selectedFeedId) ?? feeds[0],
    [feeds, selectedFeedId],
  );

  const selectedFeedState = selectedFeed ? feedStates[selectedFeed.id] : undefined;
  const feedArticles = selectedFeedState?.data?.articles ?? [];
  const selectedSavedArticle = selectedSavedArticleId
    ? savedArticleDetails[selectedSavedArticleId]
    : undefined;
  const savedArticleByUrl = useMemo(
    () => new Map(savedArticles.map((article) => [article.sourceUrl, article])),
    [savedArticles],
  );

  useEffect(() => {
    document.documentElement.dataset.themeMode = themeMode;
    document.documentElement.dataset.stylePreset = stylePreset;
    document.documentElement.style.colorScheme =
      themeMode === 'system' ? 'light dark' : themeMode;
    window.localStorage.setItem(THEME_MODE_KEY, themeMode);
    window.localStorage.setItem(STYLE_PRESET_KEY, stylePreset);
  }, [themeMode, stylePreset]);

  const refreshFeed = useCallback(async (feedId: string) => {
    setFeedStates((current) => ({
      ...current,
      [feedId]: {
        ...current[feedId],
        loading: true,
        error: undefined,
      },
    }));

    try {
      const result = await window.yomikomi.refreshFeed(feedId);

      setFeedStates((current) => ({
        ...current,
        [feedId]: {
          loading: false,
          data: result,
        },
      }));

      setFeeds((current) =>
        current.map((feed) => (feed.id === feedId ? result.subscription : feed)),
      );
    } catch (error) {
      setFeedStates((current) => ({
        ...current,
        [feedId]: {
          ...current[feedId],
          loading: false,
          error: error instanceof Error ? error.message : 'フィードの更新に失敗しました。',
        },
      }));
    }
  }, []);

  const refreshAllFeeds = useCallback(async (list: FeedSubscription[]) => {
    if (list.length === 0) {
      return;
    }

    setRefreshingAll(true);

    try {
      await Promise.all(list.map((feed) => refreshFeed(feed.id)));
    } finally {
      setRefreshingAll(false);
    }
  }, [refreshFeed]);

  const loadSavedArticle = useCallback(async (articleId: string) => {
    if (savedArticleDetails[articleId]) {
      return savedArticleDetails[articleId];
    }

    const detail = await window.yomikomi.getSavedArticle(articleId);
    setSavedArticleDetails((current) => ({ ...current, [articleId]: detail }));
    return detail;
  }, [savedArticleDetails]);

  const refreshSavedArticles = async () => {
    const list = await window.yomikomi.listSavedArticles();
    setSavedArticles(list);

    if (!selectedSavedArticleId && list[0]) {
      setSelectedSavedArticleId(list[0].id);
    }
  };

  useEffect(() => {
    const loadAppState = async () => {
      try {
        const [savedFeeds, savedList] = await Promise.all([
          window.yomikomi.listFeeds(),
          window.yomikomi.listSavedArticles(),
        ]);

        setFeeds(savedFeeds);
        setSavedArticles(savedList);

        if (savedFeeds[0]) {
          setSelectedFeedId(savedFeeds[0].id);
          await refreshAllFeeds(savedFeeds);
        }

        if (savedList[0]) {
          setSelectedSavedArticleId(savedList[0].id);
        }

        setStatusMessage('RSSも、気になる記事の全文も、この手元に積み上げていけます。');
      } catch (error) {
        setStatusMessage(error instanceof Error ? error.message : '初期化に失敗しました。');
      }
    };

    void loadAppState();
  }, [refreshAllFeeds]);

  useEffect(() => {
    if (!selectedSavedArticleId) {
      return;
    }

    void loadSavedArticle(selectedSavedArticleId);
  }, [loadSavedArticle, selectedSavedArticleId]);

  const handleAddFeed = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setStatusMessage('フィードを登録しています...');

    try {
      const added = await window.yomikomi.addFeed(feedUrl);
      setFeeds((current) => [...current, added]);
      setSelectedFeedId(added.id);
      setFeedUrl('');
      setViewMode('feeds');
      await refreshFeed(added.id);
      setStatusMessage(`「${added.title}」を登録しました。ここから読み込みを始めます。`);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : 'フィードの登録に失敗しました。');
    } finally {
      setSubmitting(false);
    }
  };

  const handleRemoveFeed = async (feedId: string) => {
    const target = feeds.find((feed) => feed.id === feedId);
    if (!target) {
      return;
    }

    try {
      await window.yomikomi.removeFeed(feedId);
      const nextFeeds = feeds.filter((feed) => feed.id !== feedId);
      setFeeds(nextFeeds);
      setFeedStates((current) => {
        const next = { ...current };
        delete next[feedId];
        return next;
      });
      setSelectedFeedId(nextFeeds[0]?.id ?? '');
      setStatusMessage(`「${target.title}」を削除しました。`);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : 'フィードの削除に失敗しました。');
    }
  };

  const openSavedArticle = async (articleId: string) => {
    setViewMode('saved');
    setSelectedSavedArticleId(articleId);
    await loadSavedArticle(articleId);
  };

  const handleSaveArticle = async (article: FeedArticle) => {
    const existing = savedArticleByUrl.get(article.link);
    if (existing) {
      setStatusMessage(`「${existing.title}」はすでに保存済みです。ローカル表示に切り替えます。`);
      await openSavedArticle(existing.id);
      return;
    }

    setSavingUrl(article.link);
    setStatusMessage('記事本文を取得してローカルDBへ保存しています...');

    try {
      const saved = await window.yomikomi.saveArticle({
        feedId: article.feedId,
        feedTitle: article.feedTitle,
        title: article.title,
        sourceUrl: article.link,
        summary: article.summary,
        publishedAt: article.publishedAt,
      });

      await refreshSavedArticles();
      setSavedArticleDetails((current) => ({ ...current, [saved.id]: saved }));
      await openSavedArticle(saved.id);
      setStatusMessage(`「${saved.title}」を丸ごと保存しました。ローカルで読めます。`);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : '記事の保存に失敗しました。');
    } finally {
      setSavingUrl('');
    }
  };

  const handleRemoveSavedArticle = async (articleId: string) => {
    const target = savedArticles.find((article) => article.id === articleId);
    if (!target) {
      return;
    }

    try {
      await window.yomikomi.removeSavedArticle(articleId);
      const nextList = savedArticles.filter((article) => article.id !== articleId);
      setSavedArticles(nextList);
      setSavedArticleDetails((current) => {
        const next = { ...current };
        delete next[articleId];
        return next;
      });
      setSelectedSavedArticleId(nextList[0]?.id ?? '');
      setStatusMessage(`「${target.title}」を保存一覧から外しました。`);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : '保存済み記事の削除に失敗しました。');
    }
  };

  const handleExportDatabase = async () => {
    setExportingDatabase(true);
    setStatusMessage('SQLiteデータベースを書き出しています...');

    try {
      const exportPath = await window.yomikomi.exportDatabase();
      setStatusMessage(
        exportPath
          ? `SQLiteデータベースを書き出しました: ${exportPath}`
          : 'SQLiteデータベースの書き出しをキャンセルしました。',
      );
    } catch (error) {
      setStatusMessage(
        error instanceof Error ? error.message : 'SQLiteデータベースの書き出しに失敗しました。',
      );
    } finally {
      setExportingDatabase(false);
    }
  };

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div>
          <p className="eyebrow">LOCAL FEED COMMAND CENTER</p>
          <h1>YomiKomi</h1>
          <p className="muted">
            流れて消える記事を追いかけるのではなく、気になる情報を自分の手元に確保するためのRSSリーダーです。
          </p>
        </div>

        <form className="feed-form" onSubmit={handleAddFeed}>
          <label htmlFor="feedUrl">RSS / Atom URL</label>
          <input
            id="feedUrl"
            type="url"
            placeholder="https://example.com/feed.xml"
            value={feedUrl}
            onChange={(event) => setFeedUrl(event.target.value)}
            required
          />
          <button type="submit" disabled={submitting}>
            {submitting ? '登録中...' : 'フィード登録'}
          </button>
        </form>

        <section className="theme-panel">
          <div className="section-header compact">
            <h2>表示スタイル</h2>
            <span className="pill">THEME</span>
          </div>

          <div className="theme-grid">
            <label className="control-field" htmlFor="themeMode">
              <span>表示モード</span>
              <select
                id="themeMode"
                value={themeMode}
                onChange={(event) => setThemeMode(event.target.value as ThemeMode)}
              >
                <option value="system">システムに合わせる</option>
                <option value="dark">ダーク</option>
                <option value="light">ライト</option>
              </select>
            </label>

            <label className="control-field" htmlFor="stylePreset">
              <span>色のスタイル</span>
              <select
                id="stylePreset"
                value={stylePreset}
                onChange={(event) => setStylePreset(event.target.value as StylePreset)}
              >
                <option value="ocean">Ocean</option>
                <option value="forest">Forest</option>
                <option value="sunset">Sunset</option>
                <option value="paper">Paper</option>
              </select>
            </label>
          </div>
        </section>

        <div className="mode-switcher">
          <button
            type="button"
            className={viewMode === 'feeds' ? 'mode-button active' : 'mode-button'}
            onClick={() => setViewMode('feeds')}
          >
            フィード一覧
          </button>
          <button
            type="button"
            className={viewMode === 'saved' ? 'mode-button active' : 'mode-button'}
            onClick={() => setViewMode('saved')}
          >
            保存済み全文
          </button>
        </div>

        <button
          type="button"
          className="secondary"
          onClick={() => void handleExportDatabase()}
          disabled={exportingDatabase}
        >
          {exportingDatabase ? 'SQLiteを書き出し中...' : 'SQLiteを書き出す'}
        </button>

        {viewMode === 'feeds' ? (
          <>
            <div className="section-header">
              <h2>登録フィード</h2>
              <button
                type="button"
                className="secondary"
                onClick={() => void refreshAllFeeds(feeds)}
                disabled={refreshingAll || feeds.length === 0}
              >
                {refreshingAll ? '更新中...' : 'すべて更新'}
              </button>
            </div>

            <div className="feed-list">
              {feeds.length === 0 ? (
                <div className="empty-card">まだフィードがありません。</div>
              ) : (
                feeds.map((feed) => {
                  const state = feedStates[feed.id];
                  const isSelected = selectedFeed?.id === feed.id;

                  return (
                    <button
                      type="button"
                      key={feed.id}
                      className={`feed-card ${isSelected ? 'selected' : ''}`}
                      onClick={() => setSelectedFeedId(feed.id)}
                    >
                      <div>
                        <strong>{feed.title}</strong>
                        <p>{feed.url}</p>
                      </div>
                      <span>{state?.loading ? '更新中' : `${state?.data?.articles.length ?? 0}件`}</span>
                    </button>
                  );
                })
              )}
            </div>
          </>
        ) : (
          <>
            <div className="section-header">
              <h2>保存済み記事</h2>
              <span className="pill">{savedArticles.length}件</span>
            </div>

            <div className="feed-list">
              {savedArticles.length === 0 ? (
                <div className="empty-card">まだ丸ごと保存した記事がありません。</div>
              ) : (
                savedArticles.map((article) => (
                  <button
                    type="button"
                    key={article.id}
                    className={`feed-card ${selectedSavedArticleId === article.id ? 'selected' : ''}`}
                    onClick={() => void openSavedArticle(article.id)}
                  >
                    <div>
                      <strong>{article.title}</strong>
                      <p>{article.siteName ?? article.feedTitle ?? article.sourceUrl}</p>
                    </div>
                    <span>{formatDate(article.savedAt)}</span>
                  </button>
                ))
              )}
            </div>
          </>
        )}
      </aside>

      <main className="content">
        <header className="content-header">
          <div>
            <p className="eyebrow">STATUS</p>
            <h2>
              {viewMode === 'feeds'
                ? selectedFeed?.title ?? 'フィードを選択してください'
                : selectedSavedArticle?.title ?? '保存済み記事を選択してください'}
            </h2>
            <p className="muted">{statusMessage}</p>
          </div>

          {viewMode === 'feeds' && selectedFeed && (
            <div className="actions">
              <button type="button" className="secondary" onClick={() => void refreshFeed(selectedFeed.id)}>
                このフィードを更新
              </button>
              <button type="button" className="danger" onClick={() => void handleRemoveFeed(selectedFeed.id)}>
                削除
              </button>
            </div>
          )}

          {viewMode === 'saved' && selectedSavedArticle && (
            <div className="actions">
              <button
                type="button"
                className="secondary"
                onClick={() => void window.yomikomi.openArticle(selectedSavedArticle.sourceUrl)}
              >
                元記事を開く
              </button>
              <button
                type="button"
                className="secondary"
                onClick={() => void window.yomikomi.openArchive(selectedSavedArticle.sourceUrl)}
              >
                魚拓を取得
              </button>
              <button
                type="button"
                className="danger"
                onClick={() => void handleRemoveSavedArticle(selectedSavedArticle.id)}
              >
                保存を削除
              </button>
            </div>
          )}
        </header>

        {viewMode === 'feeds' ? (
          selectedFeed ? (
            <>
              <div className="meta-bar">
                <span>最終更新: {formatDate(selectedFeed.lastFetchedAt)}</span>
                {selectedFeedState?.error && <span className="error-text">{selectedFeedState.error}</span>}
              </div>

              <section className="article-list">
                {feedArticles.length === 0 ? (
                  <div className="empty-card large">
                    {selectedFeedState?.loading
                      ? '記事を読み込んでいます...'
                      : 'まだ記事がありません。更新してみてください。'}
                  </div>
                ) : (
                  feedArticles.map((article) => {
                    const saved = savedArticleByUrl.get(article.link);

                    return (
                      <article key={article.id} className="article-card">
                        <div className="article-meta">
                          <span>{formatDate(article.publishedAt)}</span>
                          <span>{article.feedTitle}</span>
                        </div>
                        <h3>{article.title}</h3>
                        <p>{article.summary || '概要はありません。'}</p>
                        <div className="article-actions wrap">
                          <button type="button" onClick={() => void window.yomikomi.openArticle(article.link)}>
                            元記事を開く
                          </button>
                          <button
                            type="button"
                            className="secondary"
                            onClick={() => void handleSaveArticle(article)}
                            disabled={savingUrl === article.link}
                          >
                            {savingUrl === article.link
                              ? '保存中...'
                              : saved
                                ? '保存済みをローカル表示'
                                : '丸ごと保存して読む'}
                          </button>
                          <button
                            type="button"
                            className="secondary"
                            onClick={() => void window.yomikomi.openArchive(article.link)}
                          >
                            魚拓を取得
                          </button>
                        </div>
                      </article>
                    );
                  })
                )}
              </section>
            </>
          ) : (
            <div className="empty-card large">左側から RSS フィードを登録してください。</div>
          )
        ) : selectedSavedArticle ? (
          <section className="reader-shell">
            <div className="meta-bar stack-on-mobile">
              <div>
                <span className="pill">LOCAL READER</span>
              </div>
              <div className="reader-meta-group">
                <span>保存日時: {formatDate(selectedSavedArticle.savedAt)}</span>
                <span>公開日時: {formatDate(selectedSavedArticle.publishedAt)}</span>
                <span>{selectedSavedArticle.siteName ?? selectedSavedArticle.feedTitle ?? '---'}</span>
              </div>
            </div>

            {selectedSavedArticle.byline && <p className="reader-byline">{selectedSavedArticle.byline}</p>}
            {selectedSavedArticle.excerpt && <p className="reader-excerpt">{selectedSavedArticle.excerpt}</p>}

            <article
              className="reader-article"
              dangerouslySetInnerHTML={{ __html: selectedSavedArticle.contentHtml }}
            />
          </section>
        ) : (
          <div className="empty-card large">まずは気になった記事を保存してください。全文がローカルで読めます。</div>
        )}
      </main>
    </div>
  );
}

export default App;
