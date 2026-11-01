# Security

## Reporting a problem

If you find a security problem in the website or the connector, for example in the sign-in, the submission queue, or how the connector handles requests, please email [hello@openislet.org](mailto:hello@openislet.org) with "Security" in the subject instead of opening a public issue. Say what you found, how to reproduce it, and which page or tool it affects. We can't promise how quickly we will reply, but we do read what we are sent.

While you test, please don't touch other people's submissions or accounts, and don't send real personal information.

## What this covers

This repository: the website (`src/`), the connector (`connector/`) and the Worker in front of the site (`site-worker/`). A mistake in the science, such as a wrong number or a missing paper, is not a security problem: send it as an IIP (see [CONTRIBUTING.md](CONTRIBUTING.md)).

## Secrets

The connector's secrets (the GitHub App's client secret and private key, and the signing key) are never kept in this repository. If you find one here, please tell us at once at the address above.
