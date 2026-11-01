# Contributing

OpenIslet takes two kinds of contribution, and they go to different places.

## An idea for the blueprint

A weak spot, a better design choice, or a paper we missed. Please don't open an issue or a pull request here for these. Send an Islet Improvement Proposal (IIP): [openislet.org/start](https://openislet.org/start) walks you through it with your own AI. Software checks it at once, a person reviews each week's IIPs together, and the decision and its reason are posted in public on the issue in [openislet/openislet](https://github.com/openislet/openislet/issues).

## A fix to the website or the connector

This repository. For a bug or a small fix, open an issue or go straight to a pull request. For anything bigger, open an issue first so we can agree on it before you spend time.

Before you open a pull request, run:

```bash
npm ci
npm test
npx astro build
npm ci --prefix connector
npm run typecheck --prefix connector
```

If you changed the connector, also run its tests: the steps are in [connector/README.md](connector/README.md). Then say in plain English what changed and why.

Some files are copies. `src/data/release.json`, `src/data/references.json`, `src/data/idea_graveyard_v0.5.json`, `src/data/downloads.json` and everything in `public/downloads/` come from the blueprint repository, and a script rewrites them. To change what they say, send an IIP; a change to the copy here would be overwritten.

## House rules

- Plain English first, the scientist's detail underneath. Short words, short sentences.
- Numbers on the pages come from the data files, not from typing them into a page. The tests check this.
- Everything here is public. Please leave medical and personal details about yourself or anyone else out of issues and pull requests.
- Argue with the idea, not the person. If we remove something we say so in public, with the reason. See [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

## Licence

Unless you say otherwise, a contribution you send is licensed under the [Apache License 2.0](LICENSE), like the rest of the code (section 5 of the licence).
