import {
  mdiFire,
  mdiClockOutline,
  mdiTrophyOutline,
  mdiCommentQuestionOutline,
  mdiPresentation,
} from "@mdi/js";
import type { Feed } from "../api/hn";

export const FEEDS: { id: Feed; title: string; icon: string; description: string }[] = [
  { id: "top", title: "Top", icon: mdiFire, description: "Front page stories" },
  { id: "new", title: "New", icon: mdiClockOutline, description: "The newest submissions" },
  { id: "best", title: "Best", icon: mdiTrophyOutline, description: "Highest voted recently" },
  { id: "ask", title: "Ask", icon: mdiCommentQuestionOutline, description: "Ask HN questions" },
  { id: "show", title: "Show", icon: mdiPresentation, description: "Show HN projects" },
];
