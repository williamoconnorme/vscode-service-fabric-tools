# Build, package, and deploy

Right-click any `.sfproj` to invoke the MSBuild-backed task provider:

- **Build / Rebuild / Clean** — runs the corresponding MSBuild target via the auto-discovered MSBuild instance (`vswhere.exe`) or `dotnet msbuild` fallback.
- **Package Application** — produces the package folder layout under `pkg/<Configuration>/`.
- **Publish Application…** — picks a publish profile and runs the Service Fabric SDK PowerShell modules (`Connect-ServiceFabricCluster`, `Publish-NewServiceFabricApplication`, `Publish-UpgradedServiceFabricApplication`).

All output streams live to the **Service Fabric** output channel; errors surface in the **Problems** pane via the TS-aware MSBuild problem matcher.
