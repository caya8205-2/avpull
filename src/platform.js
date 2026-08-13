const PLATFORM_PATTERNS = [
  { name: 'youtube', patterns: [/youtube\.com/, /youtu\.be/, /music\.youtube\.com/] },
  { name: 'twitter', patterns: [/(?:twitter|x)\.com/, /t\.co\//] },
  { name: 'instagram', patterns: [/instagram\.com/] },
  { name: 'facebook', patterns: [/facebook\.com/, /fb\.watch/, /fb\.com/] },
  { name: 'tiktok', patterns: [/tiktok\.com/] },
  { name: 'reddit', patterns: [/reddit\.com/, /redd\.it\//] },
];

/** Detect platform from a URL string. Returns platform name or 'unknown'. */
export function detectPlatform(url) {
  const lower = url.toLowerCase();
  for (const { name, patterns } of PLATFORM_PATTERNS) {
    if (patterns.some((p) => p.test(lower))) return name;
  }
  return 'unknown';
}

/** Quick check if URL is a YouTube URL. */
export function isYouTubeUrl(url) {
  return detectPlatform(url) === 'youtube';
}
