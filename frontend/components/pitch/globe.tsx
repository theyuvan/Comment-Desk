"use client"

import { useEffect, useRef, useState } from "react"
import createGlobe from "cobe"

/** A spread of cities. One dot is one human, wherever they are. */
const HUMANS: [number, number][] = [
  [19.08, 72.88], [28.61, 77.21], [12.97, 77.59], [35.68, 139.69], [1.35, 103.82],
  [-33.87, 151.21], [51.51, -0.13], [52.52, 13.41], [48.86, 2.35], [40.42, -3.7],
  [40.71, -74.01], [37.77, -122.42], [43.65, -79.38], [19.43, -99.13], [-23.55, -46.63],
  [-34.6, -58.38], [6.52, 3.38], [-1.29, 36.82], [-26.2, 28.05], [30.04, 31.24],
  [25.2, 55.27], [41.01, 28.98], [55.76, 37.62], [39.9, 116.41], [13.76, 100.5],
]

export function Globe({ size = 520, seats = HUMANS.length }: { size?: number; seats?: number }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const dragFrom = useRef<number | null>(null)
  const spin = useRef(0)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const element = canvas.current
    if (!element) return
    let phi = 1.2
    let frame = 0
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    const ratio = Math.min(window.devicePixelRatio || 1, 2)
    try {
      const globe = createGlobe(element, {
        devicePixelRatio: ratio,
        width: size * ratio,
        height: size * ratio,
        phi,
        theta: 0.28,
        dark: 1,
        diffuse: 1.6,
        mapSamples: 20000,
        mapBrightness: 7,
        baseColor: [0.14, 0.14, 0.14],
        markerColor: [1, 1, 1],
        glowColor: [0.86, 0.85, 0.83],
        markerElevation: 0,
        markers: HUMANS.slice(0, seats).map((location) => ({ location, size: 0.035 })),
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
  }, [size, seats])

  if (failed) {
    return <div className="flex aspect-square w-full items-center justify-center rounded-full border border-foreground/20 font-mono text-xs text-foreground/50">1 human = 1 voice</div>
  }

  return (
    <canvas
      ref={canvas}
      role="img"
      aria-label="A globe with a dot for each verified human. Drag to spin it."
      className="aspect-square w-full max-w-full cursor-grab touch-none active:cursor-grabbing"
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
  )
}
