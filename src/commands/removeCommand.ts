import * as vscode from 'vscode';
import { resolveTargetProject, type ProjectCommandTarget, type ProjectLookup } from './buildCommands';
import { runPowerShell } from '../cluster/powerShellRunner';
import { createClientForConnection, getEntraAccessToken } from '../cluster/clusterAuth';
import { SfAuthError } from '../cluster/sfRestClient';
import type { ClusterConnection, ConnectionStore } from '../cluster/connectionStore';
import type { LocalClusterManager } from '../cluster/localCluster';
import type { Logger } from '../util/logger';

/**
 * Convert a cluster HTTP gateway URL into the `host:port` client connection
 * endpoint `Connect-ServiceFabricCluster` expects. The default gateway port
 * 19080 maps to the default client TCP port 19000; any other port is kept.
 */
function toClientConnectionEndpoint(endpoint: string): string {
	if (!endpoint || typeof endpoint != 'string') throw new Error(`Invalid Service Fabric endpoint: ${JSON.stringify(endpoint)}`);
	let url: URL;
	try {
		url = new URL(endpoint.trim());
	} catch {
		throw new Error(`Invalid Service Fabric endpoint: '${endpoint}'. Expected an http(s) URL like 'http://localhost:19080'.`);
	}
	if (!url.hostname) throw new Error(`Invalid Service Fabric endpoint: '${endpoint}' has no host.`);
	const portText = url.port || (url.protocol === 'https:' ? '443' : '80');
	const port = Number.parseInt(portText, 10);
	const clientPort = port === 19080 ? 19000 : port;
	return `${url.hostname}:${clientPort}`;
}

/**
 * `serviceFabric.remove`: tear down every instance of the project's
 * application type on the active cluster and unregister the type.
 */
export async function removeApplication(
	watcher: ProjectLookup,
	connections: ConnectionStore,
	localCluster: LocalClusterManager,
	logger: Logger,
	target?: ProjectCommandTarget,
): Promise<void> {
	if (process.platform !== 'win32') {
		vscode.window.showWarningMessage('Remove is supported on Windows only \u2014 the Service Fabric SDK is required.');
		return;
	}
	const project = await resolveTargetProject(watcher, target);
	if (!project) return;
	const manifest = project.applicationManifest;
	if (!manifest) {
		vscode.window.showErrorMessage('Application manifest could not be loaded.');
		return;
	}
	const active = connections.getActive();
	if (!active) {
		vscode.window.showErrorMessage('No active cluster. Use "Connect to Local Cluster" first.');
		return;
	}
	if (
		(vscode.workspace.getConfiguration('serviceFabric').get<boolean>('confirmDestructiveActions') ?? true) &&
		(await vscode.window.showWarningMessage(
			`Remove application '${manifest.applicationTypeName}' (v${manifest.applicationTypeVersion}) from ${active.label}?`,
			{ modal: true },
			'Remove',
		)) !== 'Remove'
	) {
		return;
	}
	let clientEndpoint: string;
	try {
		clientEndpoint = toClientConnectionEndpoint(active.endpoint);
	} catch (err) {
		vscode.window.showErrorMessage(`Cannot derive a client connection endpoint from ${active.endpoint}: ${(err as Error).message}`);
		return;
	}
	if (!(await ensureClusterReachableForRemove(active, logger))) return;
	let securityToken: string | undefined;
	if (active.auth) {
		try {
			securityToken = await getEntraAccessToken(active.auth, true);
		} catch (err) {
			vscode.window.showErrorMessage(`Microsoft Entra ID sign-in failed: ${(err as Error).message}`);
			return;
		}
	}
	const script = `
$ErrorActionPreference = 'Stop'
try {
    Import-Module ServiceFabric -Global -ErrorAction Stop
} catch {
    throw "The 'ServiceFabric' PowerShell module isn't available. Install the Service Fabric SDK and restart VS Code so it picks up the updated PSModulePath. Inner error: $($_.Exception.Message)"
}
if ($env:SF_VSCODE_SECURITY_TOKEN) {
    $null = Connect-ServiceFabricCluster -ConnectionEndpoint $ClientEndpoint -AzureActiveDirectory -SecurityToken $env:SF_VSCODE_SECURITY_TOKEN -ServerCertThumbprint ($ServerCertThumbprint -split ',') -TimeoutSec 10
} else {
    $null = Connect-ServiceFabricCluster -ConnectionEndpoint $ClientEndpoint -TimeoutSec 10
}

# 1-3. Find every application instance of this type (named or otherwise),
# walk replicas \u2192 services \u2192 application for each.
$apps = @(Get-ServiceFabricApplication -ApplicationTypeName "$ApplicationTypeName" -ErrorAction SilentlyContinue)
if ($apps.Count -gt 0) {
    Write-Host "Found $($apps.Count) application instance(s) of type '$ApplicationTypeName'."
    foreach ($app in $apps) {
        $appNameStr = $app.ApplicationName.OriginalString
        Write-Host "Tearing down '$appNameStr'..."

        $services = @(Get-ServiceFabricService -ApplicationName $app.ApplicationName -ErrorAction SilentlyContinue)
        foreach ($svc in $services) {
            $svcName = $svc.ServiceName.OriginalString
            # Force-remove replicas inside every partition so the service
            # remove doesn't stall on a stuck replica/instance.
            $partitions = @(Get-ServiceFabricPartition -ServiceName $svc.ServiceName -ErrorAction SilentlyContinue)
            foreach ($p in $partitions) {
                $replicas = @(Get-ServiceFabricReplica -PartitionId $p.PartitionId -ErrorAction SilentlyContinue)
                foreach ($r in $replicas) {
                    try {
                        Write-Host "    Remove-ServiceFabricReplica -NodeName '$($r.NodeName)' -PartitionId '$($p.PartitionId)' -ReplicaOrInstanceId '$($r.ReplicaOrInstanceId)' -ForceRemove"
                        Remove-ServiceFabricReplica -NodeName $r.NodeName -PartitionId $p.PartitionId -ReplicaOrInstanceId $r.ReplicaOrInstanceId -ForceRemove -ErrorAction Stop | Out-Null
                    } catch {
                        Write-Warning "    Replica force-remove skipped: $($_.Exception.Message)"
                    }
                }
            }
            try {
                Write-Host "  Remove-ServiceFabricService -ServiceName '$svcName' -Force -ForceRemove"
                Remove-ServiceFabricService -ServiceName $svc.ServiceName -Force -ForceRemove
            } catch {
                Write-Warning "  Service force-remove failed for '$svcName': $($_.Exception.Message). Continuing \u2014 application-level remove will retry."
            }
        }

        try {
            Write-Host "  Remove-ServiceFabricApplication -ApplicationName '$appNameStr' -Force"
            Remove-ServiceFabricApplication -ApplicationName $app.ApplicationName -Force
        } catch {
            Write-Warning "  Application remove failed for '$appNameStr': $($_.Exception.Message). Will still try to unregister the type."
        }
    }
} else {
    Write-Host "No live application instances of type '$ApplicationTypeName' found."
}

# 4. Wait for the cluster to actually reap the instances. Poll
# Get-ServiceFabricApplication -ApplicationTypeName until it returns empty
# (or we hit the timeout). Without this the next step racing the cluster
# triggers "Application type and version is still in use."
$deadline = (Get-Date).AddSeconds([int]$WaitSeconds)
while ((Get-Date) -lt $deadline) {
    $remaining = @(Get-ServiceFabricApplication -ApplicationTypeName "$ApplicationTypeName" -ErrorAction SilentlyContinue)
    if ($remaining.Count -eq 0) { break }
    Write-Host "Waiting for $($remaining.Count) application instance(s) of '$ApplicationTypeName' to finish deleting..."
    Start-Sleep -Seconds 2
}
$stillThere = @(Get-ServiceFabricApplication -ApplicationTypeName "$ApplicationTypeName" -ErrorAction SilentlyContinue)
if ($stillThere.Count -gt 0) {
    $names = ($stillThere | ForEach-Object { $_.ApplicationName.OriginalString }) -join ', '
    Write-Warning "Application instance(s) still present after $WaitSeconds s: $names. Skipping Unregister-ServiceFabricApplicationType to avoid 'still in use' error."
} else {
    # 5. Unregister every version of the type.
    $type = @(Get-ServiceFabricApplicationType -ApplicationTypeName "$ApplicationTypeName" -ErrorAction SilentlyContinue)
    foreach ($t in $type) {
        try {
            Write-Host "Unregister-ServiceFabricApplicationType -ApplicationTypeName '$ApplicationTypeName' -ApplicationTypeVersion '$($t.ApplicationTypeVersion)' -Force"
            Unregister-ServiceFabricApplicationType -ApplicationTypeName "$ApplicationTypeName" -ApplicationTypeVersion $t.ApplicationTypeVersion -Force
        } catch {
            Write-Warning "Unregister failed for version '$($t.ApplicationTypeVersion)': $($_.Exception.Message)"
        }
    }
    Write-Host "Application type '$ApplicationTypeName' removed."
}
`;
	logger.show();
	logger.info(`Connecting to ${clientEndpoint} (client TCP) for remove...`);
	const waitSeconds = vscode.workspace.getConfiguration('serviceFabric').get<number>('remove.waitSeconds') ?? 30;
	const result = await runPowerShell(
		logger,
		script,
		{
			ClientEndpoint: clientEndpoint,
			ApplicationTypeName: manifest.applicationTypeName,
			WaitSeconds: String(Math.max(0, Math.floor(waitSeconds))),
			ServerCertThumbprint: active.serverCert?.thumbprints.join(','),
		},
		undefined,
		securityToken ? { env: { SF_VSCODE_SECURITY_TOKEN: securityToken } } : {},
	);
	if (result.exitCode === 0) {
		vscode.window.showInformationMessage(
			`Removed application type '${manifest.applicationTypeName}' and its instances from ${active.label}.`,
		);
		await localCluster.refresh(active, { interactive: true });
	} else {
		vscode.window.showErrorMessage(`Remove failed (exit code ${result.exitCode}). See the Service Fabric output channel.`);
	}
}

/**
 * Probe the cluster's HTTP gateway before running the remove script. On a
 * failed probe, local clusters get a "Start Local Cluster" offer; any cluster
 * can be force-continued. Returns `false` to abort.
 */
async function ensureClusterReachableForRemove(connection: ClusterConnection, logger: Logger): Promise<boolean> {
	const { endpoint, kind } = connection;
	logger.info(`Probing cluster gateway ${endpoint}...`);
	const client = createClientForConnection(connection, { interactive: true });
	try {
		await client.getClusterHealth(5000);
		logger.info('Cluster probe ok.');
		return true;
	} catch (err) {
		logger.warn(`Cluster probe failed: ${(err as Error).message}`);
		if (err instanceof SfAuthError) {
			vscode.window.showErrorMessage(`${err.message} Reconnect to the cluster to sign in again.`);
			return false;
		}
	}
	if (kind === 'local') {
		const choice = await vscode.window.showErrorMessage(
			`Local Service Fabric cluster at ${endpoint} isn't responding. Remove needs an active cluster connection.`,
			{ modal: true },
			'Start Local Cluster',
			'Continue Anyway',
		);
		if (choice === 'Start Local Cluster') {
			await vscode.commands.executeCommand('serviceFabric.cluster.startLocal');
			try {
				await client.getClusterHealth(10000);
				logger.info('Cluster probe ok after start.');
				return true;
			} catch (err) {
				vscode.window.showErrorMessage(`Cluster still unreachable after start: ${(err as Error).message}. Aborting remove.`);
				return false;
			}
		}
		return choice === 'Continue Anyway';
	}
	return (
		(await vscode.window.showErrorMessage(
			`Service Fabric cluster at ${endpoint} isn't responding. Verify the cluster is online and the connection settings are correct.`,
			{ modal: true },
			'Continue Anyway',
		)) === 'Continue Anyway'
	);
}
