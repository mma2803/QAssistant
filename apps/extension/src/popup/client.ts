import type { PopupRequest, Result } from '../shared/messages.js';

/**
 * Thin wrapper that sends a typed PopupRequest to the service worker and returns
 * the typed Result. All side effects (auth, network, recording) live in the
 * worker; the popup is a pure UI that issues commands and renders state.
 */
export function call<T>(payload: PopupRequest): Promise<Result<T>> {
  return chrome.runtime.sendMessage({ channel: 'popup', payload }) as Promise<Result<T>>;
}
