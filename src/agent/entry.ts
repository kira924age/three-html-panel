// The script a panel page loads, before its own scripts:
//
//   <script type="module" src=".../agent.js" data-host-origin="https://host.example"></script>
//
// It has to run first because it replaces focus() and pointer capture in the
// page, and the page's code should only ever see the replacements.

import { readHostOrigin, startAgent } from "./agent";

const hostOrigin = readHostOrigin(document);
if (!hostOrigin) {
  console.warn(
    "[three-html-panel] the agent is not started: its <script> needs data-host-origin set to the host's origin",
  );
} else {
  startAgent({ hostOrigin });
}
