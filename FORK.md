# Fork notes

This is a fork of [Service Fabric Project (sfproj) Tools](https://marketplace.visualstudio.com/items?itemName=sfproj-tools.service-fabric-project-tools-vscode) (MIT).

The upstream source repository (`github.com/coyesiku_microsoft/vscode-sfproj-tools`) is behind
Microsoft enterprise SSO and isn't public, so this fork was rebuilt from the published 1.1.11 VSIX.
The tag `upstream-1.1.11` is the unmodified package.

## How the source was recovered

Upstream shipped only a minified esbuild bundle, plus tsc output for the helper modules
(`reference/upstream-modules/`). The TypeScript in `src/` was rebuilt from those:

1. The bundle was split back into its original modules mechanically (commit "Split bundle into ES modules under src/").
   Module boundaries and top-level names came from the bundle's structure and the reference modules.
2. Each module was then retyped and its locals renamed. Doc comments were restored from the reference modules where they still apply.

Names and comments in bundle-only modules (commands, views, the extension entry) are reconstructions, not upstream's originals.
Where the reference modules disagree with the bundle (e.g. `deploy/packageResolver`), the bundle won,
because it is what upstream actually shipped in 1.1.11.

## Layout

- `src/`: TypeScript source, entry point `src/extension.ts`.
- `reference/upstream-modules/`: upstream's tsc output, kept for comparison. Nothing loads it at runtime.
- `design_plans/`, `docs/HOWTO.md`, `changelog.md`: upstream design notes and docs.

## Develop

- `npm install`
- Press F5 (**Run Extension**) to build and launch an Extension Development Host.
- `npm run watch`: rebuild on change. `npm run typecheck`: tsc without emitting.
- `npm run package` writes a `.vsix` to `artifacts/`.

Disable the original extension while you use this fork. Both register the same `serviceFabric.*`
command and view IDs.
