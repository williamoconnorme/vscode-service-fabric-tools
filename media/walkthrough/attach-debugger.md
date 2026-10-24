# Attach the debugger to a running service

Once an application is deployed:

1. Run **Service Fabric: Attach Debugger to Deployed Service…**.
2. Pick the application, then the specific service / code package and node hosting the replica you want to attach to.
3. Pick the runtime: **coreclr** for modern .NET (requires the C# extension) or **clr** for legacy .NET Framework (Windows only).

The extension queries the cluster's HTTP gateway for the host process ID and asks VS Code to start an attach session against it. Set breakpoints in your service code and they'll bind once the symbols load.

For ad-hoc workflows, you can also add a `launch.json` configuration directly:

```jsonc
{
  "type": "servicefabric",
  "request": "attach",
  "name": "Service Fabric: Attach (coreclr)",
  "runtime": "coreclr"
}
```

Triggering that configuration runs the same picker.

If the C# extension (`ms-dotnettools.csharp`) is not installed, the extension surfaces a modal with **Install C# Extension** / **Open Marketplace** / **Cancel**. Choose *Install* to acquire the debugger and continue into the attach session in one step. *C# Dev Kit* is **not** required — it ships solution-explorer UI and depends on the C# extension for debugging.
