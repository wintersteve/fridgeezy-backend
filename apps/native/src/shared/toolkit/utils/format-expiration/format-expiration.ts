/**
 * Formats an expiration date into a human-readable string
 * @param expiresAt - ISO date string or null
 * @returns Formatted expiration text (e.g., "Expires in 3 days", "Expired 2 days ago", "No expiration set")
 */
export const formatExpiration = (expiresAt: string | null): string => {
  if (!expiresAt) return "No expiration set";

  const now = new Date();
  const expirationDate = new Date(expiresAt);
  const diffMs = expirationDate.getTime() - now.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays < 0) {
    const daysAgo = Math.abs(diffDays);
    return daysAgo === 0
      ? "Expired today"
      : `Expired ${daysAgo} day${daysAgo === 1 ? "" : "s"} ago`;
  }

  if (diffDays === 0) {
    return "Expires today";
  }

  if (diffDays === 1) {
    return "Expires tomorrow";
  }

  if (diffDays <= 7) {
    return `Expires in ${diffDays} days`;
  }

  return `Expires ${expirationDate.toLocaleDateString()}`;
};

/**
 * Formats a date for display in the date picker card
 * @param dateString - ISO date string or null
 * @returns Short date format (e.g., "Jan 15, 2026" or "Not set")
 */
export const formatDateShort = (dateString: string | null): string => {
  if (!dateString) return "Not set";

  const date = new Date(dateString);
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
};

/**
 * Determines if an item is expired
 * @param expiresAt - ISO date string or null
 * @returns true if expired, false otherwise
 */
export const isExpired = (expiresAt?: string | null): boolean => {
  if (!expiresAt) return false;
  return new Date(expiresAt) < new Date();
};
