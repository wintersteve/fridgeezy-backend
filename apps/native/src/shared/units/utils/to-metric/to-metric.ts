function parseFraction(quantity: string): number {
  if (quantity.includes("/")) {
    const [num, denom] = quantity.split("/").map(Number);
    if (isNaN(num) || isNaN(denom) || denom === 0) {
      throw new Error(`Invalid fraction: "${quantity}"`);
    }
    return num / denom;
  } else {
    const val = Number(quantity);
    if (isNaN(val)) throw new Error(`Invalid number: "${quantity}"`);
    return val;
  }
}

const imperialToMetric: Record<string, { factor: number; unit: string }> = {
  oz: { factor: 28.3495, unit: "g" },
  lbs: { factor: 0.453592 * 1000, unit: "g" },
};

export const toMetric = (
  quantity: string,
  unit: string,
): { quantity: string; unit: string } => {
  if (!quantity || !unit) return { quantity, unit };

  const conversion = imperialToMetric[unit.toLowerCase()];
  if (!conversion) return { quantity, unit };

  const value = parseFraction(quantity);
  const metricValue = value * conversion.factor;

  let formatted: string;
  if (metricValue < 1) {
    // Keep 2 decimals for very small quantities
    formatted = metricValue.toFixed(2);
  } else if (metricValue < 10) {
    // One decimal for small values
    formatted = metricValue.toFixed(1);
  } else {
    // Round to whole number for larger values
    formatted = Math.round(metricValue).toString();
  }

  return { quantity: formatted, unit: conversion.unit };
};
