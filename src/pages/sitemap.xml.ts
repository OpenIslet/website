// The list of pages for search engines. It is built from the same list as the navigation, so a new page cannot be forgotten.
import type { APIRoute } from 'astro';
import { contact, navItems, release, startHref } from '../data/site';

export const GET: APIRoute = ({ site }) => {
  const origin = (site ?? new URL('https://openislet.org')).origin;
  const paths = ['/', startHref, '/submit', ...navItems.map((i) => i.href).filter((h) => !h.includes('#')), contact.href];
  const urls = [...new Set(paths)].map((p) => `  <url><loc>${origin}${p}</loc><lastmod>${release.date}</lastmod></url>`).join('\n');
  const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
  return new Response(body, { headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
};
