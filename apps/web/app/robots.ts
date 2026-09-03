import type { MetadataRoute } from 'next';

/** Crawlers that harvest content for model training. Advisory, like all of robots.txt. */
const AI_CRAWLERS = [
  'GPTBot',
  'ChatGPT-User',
  'OAI-SearchBot',
  'ClaudeBot',
  'Claude-Web',
  'anthropic-ai',
  'Google-Extended',
  'CCBot',
  'PerplexityBot',
  'Bytespider',
  'Amazonbot',
  'Applebot-Extended',
  'FacebookBot',
  'Meta-ExternalAgent',
  'cohere-ai',
  'Diffbot',
  'omgili',
  'YouBot',
];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      ...AI_CRAWLERS.map((userAgent) => ({ userAgent, disallow: '/' })),
      { userAgent: '*', allow: '/', disallow: ['/play/', '/api/'] },
    ],
    sitemap: 'https://societymahjong.app/sitemap.xml',
    host: 'https://societymahjong.app',
  };
}
