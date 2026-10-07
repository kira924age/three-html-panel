// An ordinary single-page app: nothing in it knows that it is shown in 3D.
import "./style.css"

interface Note {
  id: number
  x: number
  y: number
  text: string
  color: string
}

const COLORS = ["#fff3a3", "#ffd1dc", "#c8f0d0", "#cde4ff"]

let nextId = 1
const notes: Note[] = [
  { id: nextId++, x: 40, y: 60, text: "Drag me by the bar", color: COLORS[0]! },
  { id: nextId++, x: 300, y: 110, text: "Click here and type.\n日本語の入力もできます。", color: COLORS[2]! },
  { id: nextId++, x: 560, y: 70, text: "Hover me: color dots appear", color: COLORS[3]! }
]

const app = document.querySelector<HTMLDivElement>("#app")!
app.innerHTML = `
  <header class="toolbar">
    <h1>Sticky notes</h1>
    <span class="count"></span>
    <span class="spacer"></span>
    <button class="primary add">+ Add note</button>
  </header>
  <main class="stage">
    <div class="board">
      <div class="board-inner">
        <div class="hint">Double-click empty space to add a note · scroll with the wheel</div>
      </div>
    </div>
    <button class="help-button" aria-label="Help">?</button>
  </main>
`
const stage = app.querySelector<HTMLElement>(".stage")!
const board = app.querySelector<HTMLElement>(".board")!
const inner = app.querySelector<HTMLElement>(".board-inner")!
const count = app.querySelector<HTMLElement>(".count")!

function updateCount(): void {
  count.textContent = `${notes.length} note${notes.length === 1 ? "" : "s"}`
}

function renderNote(note: Note): HTMLElement {
  const element = document.createElement("div")
  element.className = "note"
  element.style.left = `${note.x}px`
  element.style.top = `${note.y}px`
  element.style.background = note.color
  element.innerHTML = `
    <div class="note-bar">
      <div class="dots">${COLORS.map(c => `<button class="dot" style="background:${c}" data-color="${c}"></button>`).join("")}</div>
      <span class="spacer"></span>
      <button class="close" aria-label="Delete">×</button>
    </div>
    <textarea></textarea>
  `
  const textarea = element.querySelector("textarea")!
  textarea.value = note.text
  textarea.addEventListener("input", () => (note.text = textarea.value))

  element.querySelector(".close")!.addEventListener("click", () => {
    notes.splice(notes.indexOf(note), 1)
    element.remove()
    updateCount()
  })
  for (const dot of element.querySelectorAll<HTMLButtonElement>(".dot")) {
    dot.addEventListener("click", () => {
      note.color = dot.dataset.color!
      element.style.background = note.color
    })
  }

  // Dragging with pointer capture, the usual way.
  const bar = element.querySelector<HTMLElement>(".note-bar")!
  bar.addEventListener("pointerdown", event => {
    if ((event.target as Element).closest("button")) return
    const start = { x: event.clientX, y: event.clientY, left: note.x, top: note.y }
    bar.setPointerCapture(event.pointerId)
    const move = (moveEvent: PointerEvent) => {
      note.x = Math.max(0, start.left + moveEvent.clientX - start.x)
      note.y = Math.max(0, start.top + moveEvent.clientY - start.y)
      element.style.left = `${note.x}px`
      element.style.top = `${note.y}px`
    }
    const up = () => {
      bar.removeEventListener("pointermove", move)
      bar.removeEventListener("pointerup", up)
    }
    bar.addEventListener("pointermove", move)
    bar.addEventListener("pointerup", up)
  })
  return element
}

function addNote(x: number, y: number): void {
  const note: Note = { id: nextId++, x, y, text: "", color: COLORS[notes.length % COLORS.length]! }
  notes.push(note)
  const element = renderNote(note)
  inner.appendChild(element)
  updateCount()
  element.querySelector("textarea")!.focus()
}

for (const note of notes) inner.appendChild(renderNote(note))
updateCount()

app.querySelector(".add")!.addEventListener("click", () => {
  addNote(board.scrollLeft + 60 + Math.random() * 300, board.scrollTop + 80 + Math.random() * 200)
})

inner.addEventListener("dblclick", event => {
  if (event.target !== inner) return
  const rect = inner.getBoundingClientRect()
  addNote(event.clientX - rect.left - 110, event.clientY - rect.top - 15)
})

let help: HTMLElement | null = null
app.querySelector(".help-button")!.addEventListener("click", () => {
  if (help) {
    help.remove()
    help = null
    return
  }
  help = document.createElement("div")
  help.className = "help"
  help.innerHTML = `
    <h2>What you are looking at</h2>
    <ul>
      <li>This page runs in an iframe on another origin than the 3D scene.</li>
      <li>A script in the page copies its DOM into an SVG and posts it to the scene, which draws it into a texture.</li>
      <li>Your clicks and keys are posted to the page and synthesized as DOM events there.</li>
    </ul>
  `
  stage.appendChild(help)
})
