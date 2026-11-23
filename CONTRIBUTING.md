# Contributing to arc

**The terminal LLM platform nobody asked for but everyone needed.**
You found the source. That's the hard part. The rest is `npm install`.

## Building the TypeScript side

Node >= 18. One dependency (`sql.js`). `tsc` does the build.

On a normal filesystem:

```bash
npm install
npm run build          # tsc -> dist/ (~114 generated JS files, gitignored)
node dist/index.js     # or: npm start
```

On the working sdcard mount (Android): that mount is `noexec`, so `npm
install` fetches things then refuses to run them. Copy `src/` (plus
`package.json` and `tsconfig.json`) to a temp dir on an executable filesystem,
build there, and copy `dist/` back:

```bash
mkdir -p /tmp/arc-build && cp -r src package.json tsconfig.json /tmp/arc-build/
cd /tmp/arc-build && npm install && npm run build
cp -r dist /mnt/sdcard/Project/Arc/   # generated output only, never commit it
```

Normal FS? Use the first recipe. The temp-dir dance is purely for the noexec
crowd. We don't enjoy it either.

---

## The Rust core

`arc-core-rs` builds two binaries: `arc_core_rs` (streaming engine) and
`arc_render` (the ~30ms `--pipe` fast path). 75 tests live in there. Run them

```bash
cd arc-core-rs
CARGO_TARGET_DIR=/tmp/arc_render_tests cargo test
```

`CARGO_TARGET_DIR` puts test binaries on an executable filesystem (noexec
mounts can't run them) and keeps `arc-core-rs/target/` clean. On Android/Termux,
add the linker override:

```bash
cd arc-core-rs
CARGO_TARGET_DIR=/tmp/arc_render_tests \
CARGO_TARGET_AARCH64_LINUX_ANDROID_LINKER=/data/data/com.termux/files/usr/bin/clang \
cargo test
```

First compile is slow. On Android it's *very* slow. Go make coffee. We'll wait.

---

## House rules

- **ASCII only in terminal output.** No emojis — see the Emoji Incident in the
  README. `◈`, `◉`, `▲` and `[>]` are terminal glyphs, not emoji, and are fine.
  If your terminal renders it wider than one column, don't ship it.
- **Contributors use stubs. Users test real models.** Nobody can reproduce your
  exact llama/Qwen setup. A stub backend returning canned tokens proves the
  renderer. The user, in their own home directory, is the integration test.
- **Preserve the humor when editing README.md.** It's the project's voice. Fix
  the facts, keep the dry tone. If you delete a joke, replace it with a better
  one. The input box jokes are load-bearing.
- Generated files (`dist/`, `arc-core-rs/target/`, `node_modules/`, `*.db`,
  `*.gguf`, `*.log`) stay out of git. See `.gitignore`.

## Pull requests

Small, focused, and explain what broke. "It didn't work" is a start; "typing
`arc --pipe` on a noexec mount crashed, so I added the TS fallback" is a patch
we can merge. The Architect has strong opinions. Be correct, and they usually
win you over.

## Releasing

1. Bump the version in `package.json`, `package-lock.json`, and `VERSION` in
   `src/index.ts`.
2. Add release notes under `## Release notes` in `README.md`. Keep the jokes.
3. Rebuild `dist/` (not committed, but the release should be built clean).
4. Commit, then tag with an annotated tag:
   `git tag -a vX.Y.Z -m "arc vX.Y.Z: one-line summary"`
5. Push the commit and tag: `git push && git push --tags`.
6. Create the GitHub Release from the tag with `gh release create vX.Y.Z
   --generate-notes`, or write notes by hand if the commit history is too
   honest for public consumption.
