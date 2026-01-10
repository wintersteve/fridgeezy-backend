export function withAlpha(hex: string, alpha: number): string {
  let normalizedHex = hex.replace(/^#/, "");

  // Expand shorthand (#RGB → #RRGGBB)
  if (normalizedHex.length === 3) {
    normalizedHex = normalizedHex
      .split("")
      .map((c) => c + c)
      .join("");
  }

  if (normalizedHex.length !== 6) {
    throw new Error(`Invalid hex color: ${hex}`);
  }

  // Clamp alpha between 0 and 1, then convert to 0–255
  const alphaValue = Math.round(Math.min(1, Math.max(0, alpha)) * 255);
  const alphaHex = alphaValue.toString(16).padStart(2, "0").toUpperCase();

  return `#${normalizedHex.toUpperCase()}${alphaHex}`;
}
