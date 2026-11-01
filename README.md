<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset=".github/openislet-mark-dark.svg">
    <img src=".github/openislet-mark.svg" width="80" height="80" alt="OpenIslet">
  </picture>
</p>

<h1 align="center">OpenIslet website</h1>

<p align="center">The code behind <a href="https://openislet.org">openislet.org</a>, and the connector that lets AI assistants read the blueprint and send ideas in.</p>

<p align="center"><a href="https://openislet.org">Website</a> · <a href="https://openislet.org/blueprint">Blueprint</a> · <a href="https://openislet.org/start">Take part</a> · <a href="https://github.com/openislet/openislet">Blueprint repository</a></p>

OpenIslet is an open effort to design a personalised cure for type 1 diabetes that aims to work without anti-rejection drugs. Our goal: cure the first person by 2030. Anyone can help, with the AI tools they already have.

**OpenIslet is a research design, not a medical product. Nothing here is medical advice.**

## Take part

You don't need to read any code. Go to [openislet.org/start](https://openislet.org/start), give the blueprint to your own AI, look for its weak spots, and send what you find as an Islet Improvement Proposal (IIP). IIPs become issues in [openislet/openislet](https://github.com/openislet/openislet/issues).

To fix something in this repository, see [CONTRIBUTING.md](CONTRIBUTING.md). To report a security problem, see [SECURITY.md](SECURITY.md).

## What's here

| Folder | What it is |
| --- | --- |
| `src/` | The website, built with [Astro](https://astro.build). Pages are in `src/pages`, words and numbers in `src/data` and `src/content`. |
| `public/` | Pictures, icons and the blueprint's downloads. |
| `connector/` | The OpenIslet connector: an [MCP](https://modelcontextprotocol.io) server on Cloudflare Workers, and the queue that turns an IIP into a GitHub issue. |
| `site-worker/` | The small Worker in front of the site. It serves the launch film from Cloudflare storage, and a password page for a private preview copy. |
| `scripts/` | The data sync, and the site's checks for accessibility and layout. |
| `tests/` | The website's tests. The connector's are in `connector/tests`. |
| `docs/` | How to update the site, and the queue's API. |

## Use it

You need [Node.js](https://nodejs.org) 22.20 or later, or 24.12 or later. The blueprint's numbers and downloads are already in this repository, so the website runs on its own:

```bash
git clone https://github.com/openislet/website.git
cd website
npm ci
npm run dev
```

The site is then at <http://localhost:4321>. Run the tests with `npm test`. The launch film is kept in Cloudflare storage, not in this repository, so it won't play on your computer: press Skip.

The connector has its own steps, because it also needs the blueprint repository: see [connector/README.md](connector/README.md). To run your own copy of it, see [connector/DEPLOY.md](connector/DEPLOY.md).

## Licence

- **Code:** [Apache License 2.0](LICENSE).
- **Blueprint data and the Idea Graveyard** (copied into `src/data` and `public/downloads` from openislet/openislet): [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Please credit the OpenIslet community.
- **The home page photo** is by Masur, [CC BY 2.5](https://commons.wikimedia.org/wiki/File:PancreaticisletsDAPI.jpg), cropped and brightened.
- **The fonts** are IBM Plex, under the [SIL Open Font License 1.1](https://openfontlicense.org).
- **Company logos** on the Start here page belong to their companies and are not covered by any of these.
- **Dependencies** keep their own licences.

## Contact

[hello@openislet.org](mailto:hello@openislet.org) · [@OpenIslet on X](https://x.com/OpenIslet)
