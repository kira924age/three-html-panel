import { $, $$ } from "./common.js";

// --- Responsive images: which file the browser picked, shown under each.
for (const figure of $$(".gallery figure")) {
  const img = $("img", figure);
  const show = () => {
    const file = img.currentSrc.split("/").pop();
    if (file) $(".chosen", figure).textContent = `· ${file}`;
  };
  if (img.complete) show();
  img.addEventListener("load", show);
}

// --- Filters.
const filtered = $("#filtered");
for (const button of $$("[data-filter]")) {
  button.addEventListener("click", () => {
    filtered.style.filter = button.dataset.filter;
    for (const other of $$("[data-filter]"))
      other.setAttribute("aria-pressed", String(other === button));
  });
}

// --- An SVG bar chart, drawn from data.
const chartData = [
  ["Static", 42],
  ["SSR", 65],
  ["SPA", 88],
  ["Islands", 30],
  ["Edge", 21],
];
const bars = $(".chart .bars");
const svg = "http://www.w3.org/2000/svg";
chartData.forEach(([label, value], index) => {
  const x = 20 + index * 60;
  const height = value * 1.3;
  const rect = document.createElementNS(svg, "rect");
  for (const [key, val] of Object.entries({ x, y: 135 - height, width: 40, height, rx: 4 }))
    rect.setAttribute(key, String(val));
  const title = document.createElementNS(svg, "title");
  title.textContent = `${label}: ${value}`;
  rect.append(title);
  const text = document.createElementNS(svg, "text");
  text.setAttribute("x", String(x + 20));
  text.setAttribute("y", "150");
  text.setAttribute("text-anchor", "middle");
  text.textContent = label;
  bars.append(rect, text);
});

// --- Canvas: strokes drawn with the pointer, over a wave redrawn every frame.
const canvas = $("#sketch");
const context = canvas.getContext("2d");
const strokes = [];
let current = null;
const point = (event) => {
  const rect = canvas.getBoundingClientRect();
  return [
    ((event.clientX - rect.left) / rect.width) * canvas.width,
    ((event.clientY - rect.top) / rect.height) * canvas.height,
  ];
};
canvas.addEventListener("pointerdown", (event) => {
  canvas.setPointerCapture(event.pointerId);
  current = { hue: (strokes.length * 47) % 360, points: [point(event)] };
  strokes.push(current);
});
canvas.addEventListener("pointermove", (event) => current?.points.push(point(event)));
const endStroke = () => {
  if (!current) return;
  current = null;
  $("#stroke-count").textContent = `${strokes.length} stroke${strokes.length === 1 ? "" : "s"}`;
};
canvas.addEventListener("pointerup", endStroke);
canvas.addEventListener("pointercancel", endStroke);
$('[data-action="clear"]').addEventListener("click", () => {
  strokes.length = 0;
  $("#stroke-count").textContent = "0 strokes";
});

function draw(time) {
  const { width, height } = canvas;
  const dark = document.documentElement.dataset.theme === "dark";
  context.clearRect(0, 0, width, height);
  context.lineWidth = 2;
  context.strokeStyle = dark ? "rgb(122 167 255 / 35%)" : "rgb(47 111 222 / 30%)";
  context.beginPath();
  for (let x = 0; x <= width; x += 6) {
    const y = height / 2 + Math.sin(x / 40 + time / 600) * 28 + Math.sin(x / 13 + time / 300) * 6;
    if (x === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  }
  context.stroke();
  context.lineCap = "round";
  context.lineJoin = "round";
  context.lineWidth = 5;
  for (const stroke of strokes) {
    context.strokeStyle = `oklch(62% 0.2 ${stroke.hue})`;
    context.beginPath();
    stroke.points.forEach(([x, y], index) => (index ? context.lineTo(x, y) : context.moveTo(x, y)));
    context.stroke();
  }
  requestAnimationFrame(draw);
}
requestAnimationFrame(draw);

// --- Video: the page's own controls, and its own captions from the track's cues.
const video = $("#zoom-video");
const seek = $("#seek");
const playButton = $('[data-video="play"]');
const captionLine = $("#caption-line");
const track = video.textTracks[0];
let showCaptions = true;
const formatTime = (seconds) => seconds.toFixed(1);

function updateTime() {
  const duration = Number.isFinite(video.duration) ? video.duration : 8;
  seek.max = String(duration);
  seek.value = String(video.currentTime);
  $("#time").value = `${formatTime(video.currentTime)} / ${formatTime(duration)} s`;
}
function updateCaption() {
  const cue = track?.activeCues?.[0];
  captionLine.textContent = showCaptions && cue ? cue.text : "";
}
if (track) {
  // Hidden: the cues still fire, but the browser draws nothing (this page does).
  track.mode = "hidden";
  track.addEventListener("cuechange", updateCaption);
}
video.addEventListener("timeupdate", updateTime);
video.addEventListener("loadedmetadata", updateTime);
video.addEventListener("play", () => (playButton.textContent = "❚❚ Pause"));
video.addEventListener("pause", () => (playButton.textContent = "▶ Play"));
seek.addEventListener("input", () => (video.currentTime = Number(seek.value)));

const rates = [1, 1.5, 2, 0.5];
const videoActions = {
  play: () => (video.paused ? video.play() : video.pause()),
  back: () => (video.currentTime = Math.max(0, video.currentTime - 2)),
  forward: () => (video.currentTime = Math.min(video.duration || 8, video.currentTime + 2)),
  captions: (button) => {
    showCaptions = !showCaptions;
    button.setAttribute("aria-pressed", String(showCaptions));
    updateCaption();
  },
  rate: (button) => {
    video.playbackRate = rates[(rates.indexOf(video.playbackRate) + 1) % rates.length];
    button.textContent = `${video.playbackRate}×`;
  },
};
for (const button of $$("[data-video]")) {
  button.addEventListener("click", () => videoActions[button.dataset.video](button));
}

// --- Audio: play() is refused without a user gesture (as in a panel, where the
// press is synthetic); the page says so instead of failing silently.
const audio = $("#chord-audio");
const audioButton = $('[data-action="audio"]');
const audioStatus = $("#audio-status");
audioButton.addEventListener("click", async () => {
  if (!audio.paused) {
    audio.pause();
    return;
  }
  audio.currentTime = 0;
  try {
    await audio.play();
    audioStatus.textContent = "Playing.";
  } catch (error) {
    audioStatus.textContent =
      error.name === "NotAllowedError"
        ? "The browser did not allow sound: this press was not a user gesture (as in a panel)."
        : `Could not play: ${error.message}`;
  }
});
audio.addEventListener("pause", () => (audioButton.textContent = "▶ Play the chord"));
audio.addEventListener("play", () => (audioButton.textContent = "❚❚ Pause"));
audio.addEventListener("ended", () => (audioStatus.textContent = ""));
