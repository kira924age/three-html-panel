// Starts the panel agent when the page is shown in a panel (an iframe of the
// scene at VITE_HOST_ORIGIN). Opened on its own, it does nothing and the page is
// an ordinary page. It must run before the page's other scripts: main.js
// imports it first.

import { startAgent } from "@urth/three-html-panel/agent";

startAgent({ hostOrigin: import.meta.env.VITE_HOST_ORIGIN });
