# Contributing

## Develop

1. `npm install`
2. Press F5 (**Run Extension**) to build and launch an Extension Development Host.

| Command | What it does |
|---|---|
| `npm run watch` | Rebuild on change |
| `npm run typecheck` | Type-check without emitting |
| `npm test` | Run the unit tests (`test/`) |
| `npm run package` | Write a `.vsix` to `artifacts/` |
| `npm run schema` | Regenerate the bundled Service Fabric schema from the SDK's XSD |

Disable the original *Service Fabric Project (sfproj) Tools* extension while you work: both register the same command and view IDs.

## Layout

- `src/`: TypeScript source; the entry point is `src/extension.ts`.
- `test/`: `node:test` suites for the modules that don't depend on `vscode`.
- `docs/HOWTO.md`: the in-product help guide.
- `reference/upstream-modules/`: compiled helper modules from the original extension, kept for comparison. Nothing loads them.

## History

This project is a fork of [Service Fabric Project (sfproj) Tools](https://marketplace.visualstudio.com/items?itemName=sfproj-tools.service-fabric-project-tools-vscode) 1.1.11 (MIT). The original source repository isn't public, so the TypeScript in `src/` was rebuilt from the published package. The tag `upstream-1.1.11` holds the unmodified package.

## Pull requests

Keep changes focused, add tests for logic that can run without VS Code, and add a line to `CHANGELOG.md`.
