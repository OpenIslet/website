// Tells search engines whether they may list the site. The answer follows the same switch as the pages' "noindex" tag.
import type { APIRoute } from 'astro';
import { indexable } from '../data/site';

export const GET: APIRoute = ({ site }) => {
  const origin = (site ?? new URL('https://openislet.org')).origin;
  const body = indexable
    ? `User-agent: *\nAllow: /\n\nSitemap: ${origin}/sitemap.xml\n`
    : '# This site is not public yet, so crawlers are asked to stay away.\nUser-agent: *\nDisallow: /\n';
  return new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
};
