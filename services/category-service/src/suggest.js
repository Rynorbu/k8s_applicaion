export const FALLBACK_CATEGORY_IDS = {
  expense: 'c0000000-0000-4000-8000-000000000015',
  income: 'c0000000-0000-4000-8000-000000000108',
};

const normalize = (s) =>
  (s ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}&.\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Rule-based auto-categorization. Each keyword hit scores by keyword length (more
 * specific keywords win); the user's own categories get a boost over system ones,
 * and an exact category-name mention scores highest.
 */
export function suggestCategory(categories, { type, description, merchant }) {
  const text = ` ${normalize(`${merchant ?? ''} ${description ?? ''}`)} `;
  if (!text.trim()) return { category: null, score: 0 };
  let best = { category: null, score: 0 };
  for (const category of categories) {
    if (category.type !== type) continue;
    let score = 0;
    const name = normalize(category.name);
    if (name && text.includes(` ${name} `)) score += 10;
    for (const keyword of category.keywords ?? []) {
      const k = normalize(keyword);
      if (k && text.includes(k)) score += 2 + k.length / 10;
    }
    if (score > 0 && category.userId) score *= 1.25;
    if (score > best.score) best = { category, score };
  }
  return best;
}

export function confidenceOf(score) {
  if (score >= 10) return 'high';
  if (score >= 3) return 'medium';
  return score > 0 ? 'low' : 'none';
}
