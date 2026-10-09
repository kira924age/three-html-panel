import { reactive, type InjectionKey } from "vue";
import type { ThreadNode } from "../api/hn";

/** Shared by a thread's comments: the story's author, and "collapse/expand all". */
export interface ThreadContext {
  op: string | null;
  /** Bumped by "collapse all" / "expand all"; each comment then takes `collapsed`. */
  version: number;
  collapsed: boolean;
}

export const ThreadKey: InjectionKey<ThreadContext> = Symbol("thread");

export function createThreadContext(op: string | null): ThreadContext {
  return reactive({ op, version: 0, collapsed: false });
}

export function countReplies(node: ThreadNode): number {
  return node.children.reduce((sum, child) => sum + 1 + countReplies(child), 0);
}
