// Single-file components, for tools that type-check without Vue's own checker
// (the repository's lint); vue-tsc reads the .vue files themselves.
declare module "*.vue" {
  import type { DefineComponent } from "vue";

  const component: DefineComponent;
  export default component;
}
