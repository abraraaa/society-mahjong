import type { MetadataRoute } from 'next';

/**
 * Discoverable, not free to use. Search engines and answer/recommendation
 * agents may index everything. Crawlers that exist only to harvest training
 * data are refused. Advisory, like all of robots.txt; the licence is the law.
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
    rules: [
      ...TRAINING_ONLY_CRAWLERS.map((userAgent) => ({ userAgent, disallow: '/' })),
      { userAgent: '*', allow: '/', disallow: ['/api/'] },
    ],
    sitemap: 'https://societymahjong.app/sitemap.xml',
    host: 'https://societymahjong.app',
  };
}
