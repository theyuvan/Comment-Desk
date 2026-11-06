"use client"

import { useEffect, useRef, useState } from "react"
import createGlobe from "cobe"

/** A spread of cities. One dot is one verified human, wherever they are. */
const HUMANS: [number, number][] = [
  [19.08, 72.88], [28.61, 77.21], [12.97, 77.59], [35.68, 139.69], [1.35, 103.82],
  [-33.87, 151.21], [51.51, -0.13], [52.52, 13.41], [48.86, 2.35], [40.42, -3.7],
  [40.71, -74.01], [37.77, -122.42], [43.65, -79.38], [19.43, -99.13], [-23.55, -46.63],
  [-34.6, -58.38], [6.52, 3.38], [-1.29, 36.82], [-26.2, 28.05], [30.04, 31.24],
  [25.2, 55.27], [41.01, 28.98], [55.76, 37.62], [39.9, 116.41], [13.76, 100.5],
]

/**
 * A dark, auto-rotating globe with a marker per verified human. Fills its
 * container (so the same component works at hero size and at a small card
 * size), drag-to-spin, and only runs while it's actually on screen.
 */
export function Globe({ seats = HUMANS.length, className = "" }: { seats?: number; className?: string }) {
  const container = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const dragFrom = useRef<number | null>(null)
  const spin = useRef(0)
  const [failed, setFailed] = useState(false)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const element = container.current
    if (!element || typeof IntersectionObserver === "undefined") {
      setVisible(true)
      return
    }
    const observer = new IntersectionObserver(([entry]) => setVisible(Boolean(entry?.isIntersecting)), { rootMargin: "200px" })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const canvasEl = canvas.current
    const box = container.current
    if (!visible || !canvasEl || !box) return
    let phi = 1.2
    let frame = 0
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    const ratio = Math.min(window.devicePixelRatio || 1, 2)
    const rect = box.getBoundingClientRect()
    const side = Math.max(120, Math.round(rect.width || rect.height || 300))
    try {
      const globe = createGlobe(canvasEl, {
        devicePixelRatio: ratio,
        width: side * ratio,
        height: side * ratio,
        phi,
        theta: 0.28,
        dark: 0.35,
        diffuse: 1,
        mapSamples: 20000,
        mapBrightness: 5,
        baseColor: [0.58, 0.58, 0.6],
        markerColor: [1, 1, 1],
        glowColor: [0.75, 0.75, 0.76],
        markerElevation: 0.04,
        markers: HUMANS.slice(0, seats).map((location) => ({ location, size: 0.05 })),
      })
      const tick = () => {
        if (dragFrom.current === null && !still) phi += 0.003
        globe.update({ phi: phi + spin.current })
        frame = requestAnimationFrame(tick)
      }
      tick()
      return () => {
        cancelAnimationFrame(frame)
        globe.destroy()
      }
    } catch {
      setFailed(true)
    }
  }, [visible, seats])

  if (failed) {
    return (
      <div className={`flex aspect-square w-full items-center justify-center rounded-full border border-foreground/20 font-mono text-xs text-foreground/50 ${className}`}>
        1 human = 1 voice
      </div>
    )
  }

  return (
    <div ref={container} className={`aspect-square w-full ${className}`}>
      <canvas
        ref={canvas}
        role="img"
        aria-label="A globe with a dot for each verified human. Drag to spin it."
        className="block aspect-square w-full max-w-full cursor-grab touch-none active:cursor-grabbing"
        style={{ contain: "layout paint size" }}
        onPointerDown={(event) => {
          dragFrom.current = event.clientX - spin.current * 220
        }}
        onPointerUp={() => {
          dragFrom.current = null
        }}
        onPointerLeave={() => {
          dragFrom.current = null
        }}
        onPointerMove={(event) => {
          if (dragFrom.current !== null) spin.current = (event.clientX - dragFrom.current) / 220
        }}
      />
    </div>
  )
}
