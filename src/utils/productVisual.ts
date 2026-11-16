/**
 * Deterministic inline SVG product visual generator.
 * Replaces fragile external image URLs (e.g., images.unsplash.com) with
 * self-contained offline-safe data URIs tailored by product category/title.
 */

const CATEGORY_PALETTES: Array<{
  match: RegExp;
  bg: string;
  accent: string;
  label: string;
  shape: 'watch' | 'audio' | 'bag' | 'kitchen' | 'shoe' | 'power' | 'glasses' | 'keyboard' | 'box';
}> = [
  {
    match: /watch|ساعة/i,
    bg: '#EFF6FF',
    accent: '#2563EB',
    label: 'WATCH',
    shape: 'watch',
  },
  {
    match: /audio|headphone|سماع/i,
    bg: '#F1F5F9',
    accent: '#1E293B',
    label: 'AUDIO',
    shape: 'audio',
  },
  {
    match: /bag|backpack|حقيبة|شنطة/i,
    bg: '#ECFDF5',
    accent: '#059669',
    label: 'BAG',
    shape: 'bag',
  },
  {
    match: /coffee|kitchen|espresso|home|ماكينة|مطبخ/i,
    bg: '#FFFBEB',
    accent: '#D97706',
    label: 'HOME',
    shape: 'kitchen',
  },
  {
    match: /shoe|sneaker|footwear|حذاء/i,
    bg: '#FEF2F2',
    accent: '#DC2626',
    label: 'SHOES',
    shape: 'shoe',
  },
  {
    match: /power|bank|charger|شاحن/i,
    bg: '#EEF2FF',
    accent: '#4F46E5',
    label: 'TECH',
    shape: 'power',
  },
  {
    match: /sunglass|glass|accessor|نظار/i,
    bg: '#F0FDF4',
    accent: '#15803D',
    label: 'ACC',
    shape: 'glasses',
  },
  {
    match: /keyboard|gaming|لوحة|ألعاب/i,
    bg: '#F8FAFC',
    accent: '#334155',
    label: 'GEAR',
    shape: 'keyboard',
  },
];

function getShapeSvg(shape: string, accent: string): string {
  switch (shape) {
    case 'watch':
      return `<rect x="48" y="22" width="24" height="14" rx="4" fill="${accent}" opacity="0.25"/><rect x="48" y="84" width="24" height="14" rx="4" fill="${accent}" opacity="0.25"/><rect x="38" y="34" width="44" height="52" rx="12" fill="white" stroke="${accent}" stroke-width="3"/><circle cx="60" cy="60" r="14" fill="none" stroke="${accent}" stroke-width="2.5"/><path d="M60 52V60L66 64" stroke="${accent}" stroke-width="2.5" stroke-linecap="round"/>`;
    case 'audio':
      return `<path d="M34 64V54a26 26 0 0 1 52 0v10" fill="none" stroke="${accent}" stroke-width="4" stroke-linecap="round"/><rect x="28" y="58" width="12" height="24" rx="6" fill="${accent}"/><rect x="80" y="58" width="12" height="24" rx="6" fill="${accent}"/>`;
    case 'bag':
      return `<path d="M46 42v-4a14 14 0 0 1 28 0v4" fill="none" stroke="${accent}" stroke-width="3.5"/><rect x="34" y="42" width="52" height="48" rx="10" fill="white" stroke="${accent}" stroke-width="3"/><path d="M34 60h52" stroke="${accent}" stroke-width="2.5" opacity="0.45"/><rect x="52" y="55" width="16" height="10" rx="3" fill="${accent}"/>`;
    case 'kitchen':
      return `<rect x="36" y="34" width="48" height="54" rx="8" fill="white" stroke="${accent}" stroke-width="3"/><rect x="44" y="44" width="32" height="16" rx="4" fill="${accent}" opacity="0.2"/><path d="M48 76h24" stroke="${accent}" stroke-width="4" stroke-linecap="round"/><circle cx="60" cy="52" r="4" fill="${accent}"/>`;
    case 'shoe':
      return `<path d="M28 74c0-10 12-22 20-26l14 12c8 4 22 4 30 8v10H28v-4z" fill="white" stroke="${accent}" stroke-width="3" stroke-linejoin="round"/><path d="M32 78h60" stroke="${accent}" stroke-width="4" stroke-linecap="round"/>`;
    case 'power':
      return `<rect x="40" y="28" width="40" height="64" rx="8" fill="white" stroke="${accent}" stroke-width="3"/><path d="M62 44l-8 16h8l-4 16 10-18h-8l2-14z" fill="${accent}"/>`;
    case 'glasses':
      return `<rect x="26" y="48" width="28" height="20" rx="8" fill="white" stroke="${accent}" stroke-width="3"/><rect x="66" y="48" width="28" height="20" rx="8" fill="white" stroke="${accent}" stroke-width="3"/><path d="M54 56h12" stroke="${accent}" stroke-width="3"/>`;
    case 'keyboard':
      return `<rect x="24" y="42" width="72" height="36" rx="6" fill="white" stroke="${accent}" stroke-width="3"/><rect x="32" y="50" width="10" height="6" rx="1.5" fill="${accent}" opacity="0.7"/><rect x="46" y="50" width="10" height="6" rx="1.5" fill="${accent}" opacity="0.7"/><rect x="60" y="50" width="10" height="6" rx="1.5" fill="${accent}" opacity="0.7"/><rect x="74" y="50" width="14" height="6" rx="1.5" fill="${accent}"/><rect x="36" y="62" width="48" height="6" rx="2" fill="${accent}" opacity="0.5"/>`;
    default:
      return `<path d="M60 28L90 44v32L60 92 30 76V44l30-16z" fill="white" stroke="${accent}" stroke-width="3" stroke-linejoin="round"/><path d="M30 44l30 16 30-16M60 60v32" stroke="${accent}" stroke-width="2.5" opacity="0.65"/>`;
  }
}

export function generateProductSvgDataUri(name: string = 'Product', category: string = ''): string {
  const probe = `${category} ${name}`;
  const matched = CATEGORY_PALETTES.find((p) => p.match.test(probe)) || {
    bg: '#F8FAFC',
    accent: '#2563EB',
    label: 'ITEM',
    shape: 'box',
  };

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160" viewBox="0 0 120 120" fill="none"><rect width="120" height="120" rx="18" fill="${matched.bg}"/>${getShapeSvg(
    matched.shape,
    matched.accent
  )}<text x="60" y="109" text-anchor="middle" font-family="system-ui,sans-serif" font-size="9" font-weight="700" fill="${matched.accent}" letter-spacing="1">${matched.label}</text></svg>`;

  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

export function resolveSafeProductImage(
  imageUrl?: string,
  name: string = 'Product',
  category: string = ''
): string {
  const trimmed = (imageUrl || '').trim();
  if (
    !trimmed ||
    trimmed.includes('images.unsplash.com') ||
    trimmed.includes('picsum.photos') ||
    trimmed.includes('placeholder.com')
  ) {
    return generateProductSvgDataUri(name, category);
  }
  return trimmed;
}
