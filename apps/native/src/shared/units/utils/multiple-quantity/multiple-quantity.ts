function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

export function multiplyQuantity(
  quantity: string,
  targetFactor: number,
  baseFactor: number,
): string {
  if (!quantity || !targetFactor || !baseFactor) return "";

  let numerator: number;
  let denominator: number;

  if (quantity.includes("/")) {
    const [numStr, denomStr] = quantity.split("/");
    numerator = parseInt(numStr, 10);
    denominator = parseInt(denomStr, 10);
  } else {
    numerator = parseInt(quantity, 10);
    denominator = 1;
  }

  if (
    isNaN(numerator) ||
    isNaN(denominator) ||
    denominator === 0 ||
    baseFactor === 0
  ) {
    throw new Error(`Invalid input: "${quantity}", baseFactor: ${baseFactor}`);
  }

  // Apply ratio of target/base to quantity
  numerator *= targetFactor;
  denominator *= baseFactor;

  // Simplify fraction
  const divisor = gcd(Math.abs(numerator), Math.abs(denominator));
  numerator /= divisor;
  denominator /= divisor;

  const value = numerator / denominator;

  if (value >= 1) {
    // Round to 2 decimal places, strip trailing .0
    const rounded = parseFloat(value.toFixed(2));
    return rounded.toString();
  }

  // Keep fraction if < 1
  return `${numerator}/${denominator}`;
}
