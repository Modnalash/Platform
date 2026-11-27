# Portal tests

`run.mjs` opens every page in a real browser against an in-memory copy of the
database (`supabase-stub.js`), so nothing touches the live Supabase project.
It checks that each page loads without script errors on desktop and phone, and
that the main actions (add stock, place order, fulfil order, edit, log in/out)
still write what they should.

    node tests/run.mjs . /tmp/shots

Needs Node with Playwright and Chrome. Screenshots and `results.txt` land in the
output folder. This folder is not deployed (see `.vercelignore`).

`restyle-applied-2026-11.py` is the one-off script that moved the pages onto
`app.css`; kept only as a record of what was changed.
