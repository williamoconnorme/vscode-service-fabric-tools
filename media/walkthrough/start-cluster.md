# Start a local development cluster

The extension can drive the Service Fabric SDK's `DevClusterSetup.ps1` to bring up a one-node or five-node development cluster on Windows.

- **Service Fabric: Start Local Cluster** — pick 1-node (fast inner loop) or 5-node (failover, placement constraints, rolling upgrades).
- **Service Fabric: Reset Local Cluster** — clean and recreate the cluster.
- **Service Fabric: Switch Local Cluster Mode (1-node ↔ 5-node)…** — re-create with a different topology and persist the choice.

The status bar shows live aggregated health, node count, and application count once a cluster is connected.
