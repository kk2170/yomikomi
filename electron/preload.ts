import { contextBridge, ipcRenderer } from 'electron';
import type { YomiKomiApi } from '../shared/types';

const api: YomiKomiApi = {
  listFeeds: () => ipcRenderer.invoke('feeds:list'),
  addFeed: (url) => ipcRenderer.invoke('feeds:add', url),
  removeFeed: (feedId) => ipcRenderer.invoke('feeds:remove', feedId),
  refreshFeed: (feedId) => ipcRenderer.invoke('feeds:refresh', feedId),
  listSavedArticles: () => ipcRenderer.invoke('saved:list'),
  getSavedArticle: (articleId) => ipcRenderer.invoke('saved:get', articleId),
  saveArticle: (input) => ipcRenderer.invoke('saved:save', input),
  removeSavedArticle: (articleId) => ipcRenderer.invoke('saved:remove', articleId),
  exportDatabase: () => ipcRenderer.invoke('database:export'),
  openArticle: (url) => ipcRenderer.invoke('article:open', url),
  openArchive: (url) => ipcRenderer.invoke('archive:open', url),
};

contextBridge.exposeInMainWorld('yomikomi', api);
