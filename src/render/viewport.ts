/**
 * Sizes the canvas backing store.
 *
 * CSS decides how big the canvas is on screen. The backing store follows it
 * at the device pixel ratio, capped (dense phone screens would triple the
 * pixels to fill for no visible gain) and multiplied by a resolution scale
 * that drops when the device cannot keep up.
 */
export class Viewport {
  /** Size in CSS pixels. */
  width = 1;
  height = 1;
  /** Backing-store pixels per CSS pixel. */
  pixelRatio = 1;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly dprCap: number,
  ) {}

  /** Returns true when the size or the density changed. */
  update(resolutionScale: number): boolean {
    const cssWidth = Math.max(1, this.canvas.clientWidth);
    const cssHeight = Math.max(1, this.canvas.clientHeight);
    const ratio = Math.min(window.devicePixelRatio || 1, this.dprCap) * resolutionScale;
    const pixelWidth = Math.max(1, Math.round(cssWidth * ratio));
    const pixelHeight = Math.max(1, Math.round(cssHeight * ratio));

    const changed =
      this.canvas.width !== pixelWidth ||
      this.canvas.height !== pixelHeight ||
      this.width !== cssWidth ||
      this.height !== cssHeight;
    if (this.canvas.width !== pixelWidth) this.canvas.width = pixelWidth;
    if (this.canvas.height !== pixelHeight) this.canvas.height = pixelHeight;
    this.width = cssWidth;
    this.height = cssHeight;
    this.pixelRatio = pixelWidth / cssWidth;
    return changed;
  }
}
