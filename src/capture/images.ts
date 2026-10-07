// An SVG loaded as an image does not load anything external, so every image the
// page shows has to be embedded as a data URL. Images are fetched in the
// background; until one arrives, the frame is drawn without it, and `onLoad`
// asks for another frame.

const MAX_IMAGE_BYTES = 4 * 1024 * 1024

type Entry = { state: "loading" } | { state: "loaded"; dataUrl: string } | { state: "failed" }

export class ImageInliner {
  private readonly entries = new Map<string, Entry>()

  constructor(private readonly onLoad: () => void) {}

  /** The data URL for `url`, or null if it is not available (yet). */
  get(url: string): string | null {
    if (url.startsWith("data:")) return url
    const entry = this.entries.get(url)
    if (!entry) {
      this.load(url)
      return null
    }
    return entry.state === "loaded" ? entry.dataUrl : null
  }

  private load(url: string): void {
    this.entries.set(url, { state: "loading" })
    fetchAsDataUrl(url)
      .then(dataUrl => {
        this.entries.set(url, { state: "loaded", dataUrl })
        this.onLoad()
      })
      .catch(() => this.entries.set(url, { state: "failed" }))
  }
}

async function fetchAsDataUrl(url: string): Promise<string> {
  // Same-origin images are fetched like the page fetched them (with cookies);
  // cross-origin ones need CORS, as they would for a canvas.
  const response = await fetch(url)
  if (!response.ok) throw new Error(`image ${response.status}`)
  const blob = await response.blob()
  if (blob.size > MAX_IMAGE_BYTES) throw new Error("image too large")
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}
