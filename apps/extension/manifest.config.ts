import { defineManifest } from '@crxjs/vite-plugin';

/**
 * Chrome MV3 manifest for the QAssistant capture extension (task 3.1).
 *
 * - background: service worker that owns the recording lifecycle, token storage
 *   and refresh, chunk upload, screenshot timer and the inactivity timer.
 * - popup (action): sign-in, forced first-login password change, project +
 *   work-context selection, start/stop controls.
 * - content script: runs rrweb in the page (the only context with DOM access),
 *   masks per project config, and listens for the flag hotkey keydown.
 *
 * Permissions are intentionally minimal:
 *   storage    -> chrome.storage.local for tokens + active-session state
 *   tabs       -> resolve the active tab for screenshots + session targeting
 *   activeTab  -> grant captureVisibleTab on the focused tab
 *   scripting  -> (re)inject the recorder after navigation when needed
 * host_permissions <all_urls> so capture works against any project base URL and
 * the service worker can PUT to GCS signed URLs and call the API.
 */
export default defineManifest({
  manifest_version: 3,
  name: 'QAssistant Capture',
  description: 'Record QA sessions as DOM-replay with optional screenshots and codegen.',
  version: '0.1.0',
  minimum_chrome_version: '116',
  icons: {
    16: 'public/icons/icon-16.png',
    32: 'public/icons/icon-32.png',
    48: 'public/icons/icon-48.png',
    128: 'public/icons/icon-128.png',
  },
  action: {
    default_title: 'QAssistant Capture',
    default_popup: 'src/popup/index.html',
    default_icon: {
      16: 'public/icons/icon-16.png',
      32: 'public/icons/icon-32.png',
    },
  },
  background: {
    service_worker: 'src/background/service-worker.ts',
    type: 'module',
  },
  content_scripts: [
    {
      matches: ['<all_urls>'],
      js: ['src/content/recorder.ts'],
      run_at: 'document_start',
      all_frames: false,
    },
    {
      // Network interceptor in the page's MAIN world: the only context that can
      // patch the page's own fetch/XHR (change: configurable-test-type). It posts
      // captured calls to the isolated recorder via window.postMessage.
      matches: ['<all_urls>'],
      js: ['src/content/network-intercept.ts'],
      run_at: 'document_start',
      all_frames: false,
      world: 'MAIN',
    },
  ],
  permissions: ['storage', 'tabs', 'activeTab', 'scripting'],
  host_permissions: ['<all_urls>'],
  commands: {
    'flag-state': {
      suggested_key: {
        default: 'Alt+Shift+F',
        mac: 'Alt+Shift+F',
      },
      description: 'Flag the focused element/state as important for codegen',
    },
  },
});
