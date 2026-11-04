import { useEffect, useRef } from 'react'
import { cn } from '../lib/utils'

type Part = { src: [number, number, number, number]; dest: [number, number, number, number] }

const HEAD: Part = { src: [8, 8, 8, 8], dest: [4, 0, 8, 8] }
const HAT: Part = { src: [40, 8, 8, 8], dest: [4, 0, 8, 8] }
const BODY: Part = { src: [20, 20, 8, 12], dest: [4, 8, 8, 12] }
const JACKET: Part = { src: [20, 36, 8, 12], dest: [4, 8, 8, 12] }
const ARM_R: Part = { src: [44, 20, 4, 12], dest: [0, 8, 4, 12] }
const ARM_L: Part = { src: [36, 52, 4, 12], dest: [12, 8, 4, 12] }
const SLEEVE_R: Part = { src: [44, 36, 4, 12], dest: [0, 8, 4, 12] }
const SLEEVE_L: Part = { src: [52, 52, 4, 12], dest: [12, 8, 4, 12] }
const LEG_R: Part = { src: [4, 20, 4, 12], dest: [4, 20, 4, 12] }
const LEG_L: Part = { src: [20, 52, 4, 12], dest: [8, 20, 4, 12] }

const HEAD_BACK: Part = { src: [24, 8, 8, 8], dest: [4, 0, 8, 8] }
const HAT_BACK: Part = { src: [56, 8, 8, 8], dest: [4, 0, 8, 8] }
const BODY_BACK: Part = { src: [32, 20, 8, 12], dest: [4, 8, 8, 12] }
const JACKET_BACK: Part = { src: [32, 36, 8, 12], dest: [4, 8, 8, 12] }
const ARM_R_BACK: Part = { src: [56, 20, 4, 12], dest: [0, 8, 4, 12] }
const ARM_L_BACK: Part = { src: [48, 52, 4, 12], dest: [12, 8, 4, 12] }
const LEG_R_BACK: Part = { src: [12, 20, 4, 12], dest: [4, 20, 4, 12] }
const LEG_L_BACK: Part = { src: [28, 52, 4, 12], dest: [8, 20, 4, 12] }

function drawParts(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  parts: Part[],
  unit: number,
  legacy: boolean
): void {
  for (const part of parts) {
    const [sx, sy, sw, sh] = part.src
    const [dx, dy, dw, dh] = part.dest
    if (sy + sh > image.height || sx + sw > image.width) continue
    ctx.drawImage(image, sx, sy, sw, sh, dx * unit, dy * unit, dw * unit, dh * unit)
  }
  if (legacy) {
    // 64x32 skins mirror the right limbs onto the left side
    ctx.save()
    ctx.translate(16 * unit, 0)
    ctx.scale(-1, 1)
    for (const part of parts) {
      const [sx, sy, sw, sh] = part.src
      const [dx, dy, dw, dh] = part.dest
      if (dx < 4) continue
      if (sy + sh > image.height) continue
      ctx.drawImage(image, sx, sy, sw, sh, dx * unit, dy * unit, dw * unit, dh * unit)
    }
    ctx.restore()
  }
}

export function SkinPreview({
  dataUrl,
  view = 'front',
  className,
  unit = 8
}: {
  dataUrl: string | null
  view?: 'front' | 'back'
  className?: string
  unit?: number
}): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const width = 16 * unit
    const height = 32 * unit
    canvas.width = width
    canvas.height = height
    ctx.clearRect(0, 0, width, height)

    ctx.fillStyle = 'rgba(255,255,255,0.05)'
    ctx.fillRect(0, 0, width, height)

    if (!dataUrl) {
      // Pleasant placeholder silhouette
      ctx.fillStyle = 'rgba(255,255,255,0.12)'
      ctx.fillRect(4 * unit, 0, 8 * unit, 8 * unit)
      ctx.fillRect(4 * unit, 8 * unit, 8 * unit, 12 * unit)
      ctx.fillRect(0, 8 * unit, 4 * unit, 12 * unit)
      ctx.fillRect(12 * unit, 8 * unit, 4 * unit, 12 * unit)
      ctx.fillRect(4 * unit, 20 * unit, 4 * unit, 12 * unit)
      ctx.fillRect(8 * unit, 20 * unit, 4 * unit, 12 * unit)
      return
    }

    const image = new Image()
    image.onload = () => {
      const legacy = image.height === 32
      ctx.imageSmoothingEnabled = false
      if (view === 'front') {
        drawParts(ctx, image, [ARM_R, ARM_L, LEG_R, LEG_L, BODY, HEAD], unit, legacy)
        drawParts(ctx, image, [HAT, JACKET, SLEEVE_R, SLEEVE_L], unit, false)
      } else {
        drawParts(ctx, image, [ARM_R_BACK, ARM_L_BACK, LEG_R_BACK, LEG_L_BACK, BODY_BACK, HEAD_BACK], unit, legacy)
        drawParts(ctx, image, [HAT_BACK, JACKET_BACK], unit, false)
      }
    }
    image.src = dataUrl
  }, [dataUrl, view, unit])

  return (
    <canvas
      ref={canvasRef}
      className={cn('skin-canvas rounded-xl', className)}
      style={{ width: 16 * unit, height: 32 * unit }}
    />
  )
}

/** Just the face, used for avatars in the top bar and profile cards. */
export function SkinHead({ dataUrl, size = 36, className }: { dataUrl: string | null; size?: number; className?: string }): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const scale = 4
    canvas.width = 8 * scale
    canvas.height = 8 * scale
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    if (!dataUrl) {
      const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height)
      gradient.addColorStop(0, '#2fe28c')
      gradient.addColorStop(1, '#0b8f66')
      ctx.fillStyle = gradient
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      return
    }
    const image = new Image()
    image.onload = () => {
      ctx.imageSmoothingEnabled = false
      ctx.drawImage(image, 8, 8, 8, 8, 0, 0, canvas.width, canvas.height)
      if (image.height >= 64) ctx.drawImage(image, 40, 8, 8, 8, 0, 0, canvas.width, canvas.height)
    }
    image.src = dataUrl
  }, [dataUrl])

  return <canvas ref={canvasRef} className={cn('skin-canvas rounded-lg', className)} style={{ width: size, height: size }} />
}
