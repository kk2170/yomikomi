/// <reference types="vite/client" />

import type { YomiKomiApi } from '../shared/types';

declare global {
  interface Window {
    yomikomi: YomiKomiApi;
  }
}

export {};
