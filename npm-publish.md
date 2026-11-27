# Publishing arc to npm

## Steps

```sh
npm login                       # log in as the Architect-Brad npm account
cd /path/to/arc                 # repo root (where package.json lives)
npm publish
npm view @architect-brad/arc    # verify the published package
```

## Notes

- **Scoped name:** the unscoped `arc` name is already taken on npm.
  `@architect-brad/arc` is free and matches the GitHub owner
  (`github.com/Architect-Brad/arc`). `publishConfig.access: "public"` makes the
  scoped package publicly installable.
- **Built code:** `dist/` is gitignored but is explicitly whitelisted in the
  `files` field, so it ships in the tarball. `prepack` and `prepublishOnly` both
  run `npm run build`, so `npm pack` and `npm publish` always rebuild `dist/`
  from `src/` first — no stale or missing JavaScript.
- **Tarball contents:** only `dist/`, `assets/`, `install.sh`, `WIKI.md`,
  `README.md`, `LICENSE`, and the always-included `package.json`. Source,
  Rust build artifacts, models (`*.gguf`), chat databases (`*.db`),
  `node_modules`, and the `test-webui` test helper are excluded. No
  `.npmignore` is needed: the `files` whitelist is the primary mechanism and
  overrides `.gitignore` for `dist/`.
