import type { MetadataRoute } from 'next';

/**
 * Discoverable, not free to use. Search engines and answer/recommendation
 * agents may index the front door and the rules; the lobby, the tables and
 * the solo deal are for the people holding the link, so they are kept out of
 * the crawl (and say noindex themselves). Crawlers that exist only to harvest
 * training data are refused. Advisory, like all of robots.txt; the licence is
 * the law.
 */
const TRAINING_ONLY_CRAWLERS = [
  'GPTBot',
  'Google-Extended',
  'ClaudeBot',
  'anthropic-ai',
  'CCBot',
  'Bytespider',
  'Applebot-Extended',
  'Meta-ExternalAgent',
  'FacebookBot',
  'cohere-ai',
  'Diffbot',
  'omgili',
];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [...TRAINING_ONLY_CRAWLERS.map((userAgent) => ({ userAgent, disallow: '/' })), { userAgent: '*', allow: '/', disallow: ['/api/', '/r/', '/g/', '/room', '/play/solo'] }],
    sitemap: 'https://societymahjong.app/sitemap.xml',
    host: 'https://societymahjong.app',
  };
}
