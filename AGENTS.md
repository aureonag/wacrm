<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Production build uses `--webpack`, not Turbopack (2026-09-29)

`package.json`'s `build` script is `next build --webpack`, not the
bare `next build` Turbopack default. On Hostinger's build machine
(never reproducible locally), Turbopack's production build reliably
crashed with `TurbopackInternalError: node process exited before we
could connect to it` while computing the middleware's whole-app
module graph — it hit whichever CSS file got processed at that point
(`@xyflow/react/dist/style.css` on one attempt, our own
`src/app/globals.css` on the next after that file was worked around),
consistent with the build container running out of real memory in a
spawned PostCSS/webpack-loader subprocess — not fixed by raising
`NODE_OPTIONS=--max-old-space-size`, since that only raises the
*parent* process's own V8 heap ceiling, not a container-level memory
limit the OS enforces on every process in it. `next build --webpack`
sidesteps Turbopack's production pipeline entirely; `next dev` is
untouched and still uses Turbopack (fine there — the crash was
build-only). Revisit this once Turbopack's production build proves
stable on Hostinger's plan, or if the plan's build memory is ever
confirmed/raised with their support.

