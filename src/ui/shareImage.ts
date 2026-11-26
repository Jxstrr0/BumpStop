/**
 * Hand the player a picture (plan PR 12): the truck card or a photo-mode
 * shot. The share sheet first (on a phone: Messages, Photos, Save Image),
 * else a download.
 *
 * Everything before the share sheet opens is synchronous on purpose: phones
 * only allow a share right after a tap, and waiting on `canvas.toBlob` can
 * use that up. So the picture becomes a PNG through `toDataURL`, which
 * doesn't wait.
 */
import type { FileResult } from '../persist/safety'

/** The picture as a PNG file, made without waiting. */
export function pngFile(canvas: HTMLCanvasElement, name: string): File {
  const url = canvas.toDataURL('image/png')
  const bytes = atob(url.slice(url.indexOf(',') + 1))
  const data = new Uint8Array(bytes.length)
  for (let i = 0; i < bytes.length; i++) data[i] = bytes.charCodeAt(i)
  return new File([data], name, { type: 'image/png' })
}

/** Share `file` (with `text` alongside, where the phone allows), or download it. */
export async function shareFile(file: File, text?: string): Promise<FileResult> {
  try {
    if (typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share(text ? { files: [file], text } : { files: [file] })
        return 'shared'
      } catch (err) {
        // The player closed the share sheet: nothing to report.
        if ((err as { name?: string })?.name === 'AbortError') return 'cancelled'
        // Anything else (not allowed here, say): fall through to a download.
      }
    }
  } catch {
    // No share support: download instead.
  }
  try {
    const url = URL.createObjectURL(file)
    const a = document.createElement('a')
    a.href = url
    a.download = file.name
    a.rel = 'noopener'
    a.style.display = 'none'
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 10_000)
    return 'downloaded'
  } catch {
    return 'failed'
  }
}

/** `bump-stop-<what>-YYYY-MM-DD-HHMM.png`, in the phone's own time. */
export function pictureName(what: string, date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
  return `bump-stop-${what}-${day}-${pad(date.getHours())}${pad(date.getMinutes())}.png`
}

/** A colour from a CSS variable on the page, for drawing on a 2D canvas. */
export function cssVar(name: string, fallback: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback
}

/**
 * The game's mark in a corner of a photo: BUMP STOP in the heading font on a
 * highlighter swipe, like the title at the top of the page.
 */
export function stampMark(canvas: HTMLCanvasElement): void {
  const g = canvas.getContext('2d')
  if (!g) return
  const s = Math.max(canvas.width, canvas.height) / 1000
  const size = Math.round(28 * s)
  g.font = `800 ${size}px 'Big Shoulders', 'Arial Narrow', sans-serif`
  const text = 'BUMP STOP'
  const w = g.measureText(text).width
  const pad = 8 * s
  const x = 20 * s
  const y = canvas.height - 20 * s
  g.fillStyle = cssVar('--accent', '#ff4fb2')
  g.fillRect(x - pad, y - size * 0.92, w + pad * 2, size * 1.1)
  g.fillStyle = cssVar('--on-accent', '#25272b')
  g.textBaseline = 'alphabetic'
  g.fillText(text, x, y)
}
