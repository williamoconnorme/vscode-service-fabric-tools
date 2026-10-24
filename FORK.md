# Fork notes

This is a fork of [Service Fabric Project (sfproj) Tools](https://marketplace.visualstudio.com/items?itemName=sfproj-tools.service-fabric-project-tools-vscode) (MIT).

The upstream source repository (`github.com/coyesiku_microsoft/vscode-sfproj-tools`) is behind
Microsoft enterprise SSO and isn't public, so this fork was rebuilt from the published 1.1.11 VSIX.
The tag `upstream-1.1.11` is the unmodified package.

## Layout

- `src/extension.js`: the extension. This is upstream's esbuild bundle, pretty-printed. String literals,
  command IDs and VS Code API calls keep their names, but local identifiers are minified. It also
  inlines `fast-xml-parser`.
- `reference/upstream-modules/`: upstream's tsc output for the helper modules, with names and doc comments intact.
  Use these to understand the matching code in `src/extension.js`. Nothing loads them at runtime.
- `design_plans/`, `docs/HOWTO.md`, `changelog.md`: upstream design notes and docs, shipped in the VSIX.

## Develop

- `npm install`
- Press F5 (**Run Extension**) to launch an Extension Development Host. There's no build step.
- `npm run package` writes a `.vsix` to `artifacts/`.

Disable the original extension while you use this fork. Both register the same `serviceFabric.*`
command and view IDs.
