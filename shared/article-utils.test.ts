import { describe, expect, it } from 'vitest';
import {
  buildArticleSummary,
  buildDatabaseExportFileName,
  stripHtmlToText,
} from './article-utils';

describe('記事テキストの整形', () => {
  it('HTMLタグと余分な空白を取り除ける', () => {
    // 記事一覧の要約表示で読みやすい文字列にする。
    expect(stripHtmlToText('<p> こんにちは </p>\n<div>世界&nbsp;&nbsp;です</div>')).toBe(
      'こんにちは 世界 です',
    );
  });

  it('summaryがあればそれを優先する', () => {
    expect(
      buildArticleSummary({
        summary: 'これは要約です',
        excerpt: 'こちらは抜粋です',
        contentHtml: '<p>本文です</p>',
      }),
    ).toBe('これは要約です');
  });

  it('summaryがなければHTML本文から要約を作る', () => {
    expect(
      buildArticleSummary({
        contentHtml: '<article><h1>見出し</h1><p>本文の一部です。</p></article>',
      }),
    ).toBe('見出し 本文の一部です。');
  });
});

describe('SQLiteエクスポート名の生成', () => {
  it('日付入りのファイル名を作る', () => {
    expect(buildDatabaseExportFileName('2026-04-29T12:34:56.000Z')).toBe(
      'yomikomi-2026-04-29.sqlite3',
    );
  });
});
