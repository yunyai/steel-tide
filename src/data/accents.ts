/** A skill accent colour (0xRRGGBB) as a CSS hex string. */
export function accentCss(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}
