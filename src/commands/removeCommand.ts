// @ts-nocheck
import * as vscode from 'vscode';
import { resolveTargetProject } from './buildCommands';
import { runPowerShell } from '../cluster/powerShellRunner';
import { SfRestClient } from '../cluster/sfRestClient';

function toClientConnectionEndpoint(e) {
	if (!e || typeof e != 'string') throw new Error(`Invalid Service Fabric endpoint: ${JSON.stringify(e)}`);
	let t;
	try {
		t = new URL(e.trim());
	} catch {
		throw new Error(`Invalid Service Fabric endpoint: '${e}'. Expected an http(s) URL like 'http://localhost:19080'.`);
	}
	if (!t.hostname) throw new Error(`Invalid Service Fabric endpoint: '${e}' has no host.`);
	let r = t.port || (t.protocol === 'https:' ? '443' : '80'),
		n = Number.parseInt(r, 10),
		i = n === 19080 ? 19e3 : n;
	return `${t.hostname}:${i}`;
}

async function removeApplication(e, t, r, n, i) {
	if (process.platform !== 'win32') {
		vscode.window.showWarningMessage('Remove is supported on Windows only \u2014 the Service Fabric SDK is required.');
		return;
	}
	let o = await resolveTargetProject(e, i);
	if (!o) return;
	let s = o.applicationManifest;
	if (!s) {
		vscode.window.showErrorMessage('Application manifest could not be loaded.');
		return;
	}
	let a = t.getActive();
	if (!a) {
		vscode.window.showErrorMessage('No active cluster. Use "Connect to Local Cluster" first.');
		return;
	}
	if (
		(vscode.workspace.getConfiguration('serviceFabric').get('confirmDestructiveActions') ?? !0) &&
		(await vscode.window.showWarningMessage(
			`Remove application '${s.applicationTypeName}' (v${s.applicationTypeVersion}) from ${a.label}?`,
			{
				modal: !0,
			},
			'Remove',
		)) !== 'Remove'
	)
		return;
	let l;
	try {
		l = toClientConnectionEndpoint(a.endpoint);
	} catch (v) {
		vscode.window.showErrorMessage(`Cannot derive a client connection endpoint from ${a.endpoint}: ${v.message}`);
		return;
	}
	if (!(await ensureClusterReachableForRemove(a.endpoint, a.kind, n))) return;
	let p = `fabric:/${s.applicationTypeName}`,
		d = `
$ErrorActionPreference = 'Stop'
try {
    Import-Module ServiceFabric -Global -ErrorAction Stop
} catch {
    throw "The 'ServiceFabric' PowerShell module isn't available. Install the Service Fabric SDK and restart VS Code so it picks up the updated PSModulePath. Inner error: $($_.Exception.Message)"
}
$null = Connect-ServiceFabricCluster -ConnectionEndpoint $ClientEndpoint -TimeoutSec 10

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
	(n.show(), n.info(`Connecting to ${l} (client TCP) for remove...`));
	let f = vscode.workspace.getConfiguration('serviceFabric').get('remove.waitSeconds') ?? 30,
		m = await runPowerShell(n, d, {
			ClientEndpoint: l,
			ApplicationName: p,
			ApplicationTypeName: s.applicationTypeName,
			WaitSeconds: String(Math.max(0, Math.floor(f))),
		});
	m.exitCode === 0
		? (vscode.window.showInformationMessage(`Removed ${p} from ${a.label}.`), await r.refresh(a))
		: vscode.window.showErrorMessage(`Remove failed (exit code ${m.exitCode}). See the Service Fabric output channel.`);
}

async function ensureClusterReachableForRemove(e, t, r) {
	r.info(`Probing cluster gateway ${e}...`);
	let n = new SfRestClient(e);
	try {
		return (await n.getClusterHealth(5e3), r.info('Cluster probe ok.'), !0);
	} catch (o) {
		r.warn(`Cluster probe failed: ${o.message}`);
	}
	if (t === 'local') {
		let o = await vscode.window.showErrorMessage(
			`Local Service Fabric cluster at ${e} isn't responding. Remove needs an active cluster connection.`,
			{
				modal: !0,
			},
			'Start Local Cluster',
			'Continue Anyway',
		);
		if (o === 'Start Local Cluster') {
			await vscode.commands.executeCommand('serviceFabric.cluster.startLocal');
			try {
				return (await n.getClusterHealth(1e4), r.info('Cluster probe ok after start.'), !0);
			} catch (s) {
				return (vscode.window.showErrorMessage(`Cluster still unreachable after start: ${s.message}. Aborting remove.`), !1);
			}
		}
		return o === 'Continue Anyway';
	}
	return (
		(await vscode.window.showErrorMessage(
			`Service Fabric cluster at ${e} isn't responding. Verify the cluster is online and the connection settings are correct.`,
			{
				modal: !0,
			},
			'Continue Anyway',
		)) === 'Continue Anyway'
	);
}

export { removeApplication };
