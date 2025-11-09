const TELEGRAM_LINK_REGEX =
  /https?:\/\/t\.me\/(?:joinchat\/[^\s"'<>]+|\+[^\s"'<>]+|[A-Za-z0-9_]{5,})|@[A-Za-z0-9_]{5,}/gi;

export interface ExtractedLink {
  raw: string;
  normalized: string;
  type: 'invite' | 'username';
}

const normalizeUsername = (input: string) => {
  const withoutScheme = input.replace(/^https?:\/\/t\.me\//i, '').replace(/^@/, '');
  return withoutScheme.trim();
};

export const extractTelegramLinks = (text: string): ExtractedLink[] => {
  if (!text) {
    return [];
}

  const matches = text.match(TELEGRAM_LINK_REGEX);
  if (!matches) {
    return [];
  }

  return matches.map((raw) => {
    const normalized = normalizeUsername(raw);
    const type = raw.includes('joinchat/') || raw.includes('+') ? 'invite' : 'username';
    return {
      raw,
      normalized,
      type
    };
  });
};

export const uniqueLinks = (links: ExtractedLink[]) => {
  const seen = new Set<string>();
  return links.filter((link) => {
    if (seen.has(link.normalized)) {
      return false;
    }
    seen.add(link.normalized);
    return true;
  });
};
