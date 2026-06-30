import { FONT_FAMILY } from './palette'

export interface AmiAssets {
  pixelKeyBlack: HTMLImageElement
  trashOff: HTMLImageElement
  trashOn: HTMLImageElement
  astriid: HTMLImageElement
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(`failed to load ${url}`))
    img.src = url
  })
}

export async function loadAssets(base = '/res'): Promise<AmiAssets> {
  const font = new FontFace(FONT_FAMILY, `url(${base}/amidos.ttf)`)
  await font.load()
  document.fonts.add(font)

  const [pixelKeyBlack, trashOff, trashOn, astriid] = await Promise.all([
    loadImage(`${base}/pixelkey_black.png`),
    loadImage(`${base}/amiTrashOff.png`),
    loadImage(`${base}/amiTrashOn.png`),
    loadImage(`${base}/astriid_amiga.png`),
  ])

  return { pixelKeyBlack, trashOff, trashOn, astriid }
}
