// Small input helpers shared by the API routes.

// Trimmed text, capped at `max` characters ("" for null/undefined).
const clean = (value, max = 500) =>
  String(value ?? "")
    .trim()
    .slice(0, max);

// A YYYY-MM-DD date string.
const isDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value ?? ""));

// An integer within [min, max], or the fallback.
const int = (value, min, max, fallback) => {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n >= min && n <= max ? n : fallback;
};

// A number forced into [min, max]; 0, blanks and junk become the fallback.
const clamp = (value, min, max, fallback) =>
  Math.max(min, Math.min(Number(value) || fallback, max));

module.exports = { clean, isDate, int, clamp };
