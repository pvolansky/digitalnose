/** Position the measured panel within the viewport, including short/mobile screens. */
export function infoPosition(
  anchor: { left: number; bottom: number },
  panel: { width: number; height: number },
  viewport: { width: number; height: number },
) {
  return {
    left: Math.max(16, Math.min(anchor.left, viewport.width - panel.width - 16)),
    top: Math.max(16, Math.min(anchor.bottom + 8, viewport.height - panel.height - 16)),
  };
}
