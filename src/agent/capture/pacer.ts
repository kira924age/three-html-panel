// Decides how long to wait between frames.
//
// Turning the page into an SVG takes time on the page's main thread, which a
// same-site page shares with the host, and the host then decodes it. Waiting a multiple of the time the last frame took keeps the
// share of time spent on panels roughly constant: a heavy page simply updates
// less often instead of dragging the whole scene down.

export interface PacerOptions {
  /** The share of time a panel may spend producing frames (0–1). */
  budget?: number;
  minIntervalMs?: number;
  maxIntervalMs?: number;
}

export class RenderPacer {
  private readonly budget: number;
  private readonly minIntervalMs: number;
  private readonly maxIntervalMs: number;
  private intervalMs: number;

  constructor({ budget = 0.25, minIntervalMs = 16, maxIntervalMs = 500 }: PacerOptions = {}) {
    this.budget = budget;
    this.minIntervalMs = minIntervalMs;
    this.maxIntervalMs = maxIntervalMs;
    this.intervalMs = minIntervalMs;
  }

  /** Records how long a frame took and returns the interval until the next one may start. */
  record(durationMs: number): number {
    const wanted = durationMs / this.budget;
    this.intervalMs = Math.min(this.maxIntervalMs, Math.max(this.minIntervalMs, wanted));
    return this.intervalMs;
  }

  get interval(): number {
    return this.intervalMs;
  }
}
