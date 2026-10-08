// Messages between a panel page and the application around it (the host), for
// pages that know they are shown as a panel.
//
// They are plain events on the page's window, so a page does not need the
// agent's code to use them, and still loads where there is no agent (the
// messages then go nowhere). The data must be structured-cloneable. The host
// receives it through HtmlPanel's `onMessage` and sends with `postMessage()`.

/** Dispatched by the page on its window; the agent forwards `detail` to the host. */
export const PAGE_MESSAGE_EVENT = "three-html-panel:send";
/** Dispatched by the agent on the page's window; `detail` is what the host sent. */
export const HOST_MESSAGE_EVENT = "three-html-panel:message";

export function sendToHost(data: unknown): void {
  window.dispatchEvent(new CustomEvent(PAGE_MESSAGE_EVENT, { detail: data }));
}

/** Calls `listener` with each message from the host. Returns a function that stops it. */
export function onHostMessage(listener: (data: unknown) => void): () => void {
  const handle = (event: Event) => listener((event as CustomEvent).detail);
  window.addEventListener(HOST_MESSAGE_EVENT, handle);
  return () => window.removeEventListener(HOST_MESSAGE_EVENT, handle);
}
