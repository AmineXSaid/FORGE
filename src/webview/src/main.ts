import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import '@vscode/codicons/dist/codicon.css';
import '@mdi/font/css/materialdesignicons.min.css';
import 'virtual:svg-icons-register';

declare global {
  interface Window {
    acquireVsCodeApi?: <T = unknown>() => {
      postMessage(data: T): void;
      getState(): any;
      setState(data: any): void;
    };
    FORGE_BOOTSTRAP?: {
      host?: 'sidebar' | 'editor';
      page?: string;
      /** Step 31: the Settings tab a freshly opened panel starts on. */
      tab?: string;
      /** The session manager's collapsed sections when the page was built. */
      collapsedPanelSections?: string[];
    };
  }
}

/**
 * The official `S95`: a startup failure is written into the page's
 * `#claude-error` sentinel instead of leaving the panel blank.
 */
function reportStartupError(error: Error): void {
  const sentinel = document.querySelector('#claude-error');
  if (sentinel) sentinel.textContent = error.stack ? String(error.stack) : String(error);
}

// The official: `try{u95()}catch($){S95($ instanceof Error?$:Error(String($)))}`.
try {
  const pinia = createPinia();
  const app = createApp(App);

  app.use(pinia);
  app.mount('#app');
} catch (error) {
  reportStartupError(error instanceof Error ? error : Error(String(error)));
}
