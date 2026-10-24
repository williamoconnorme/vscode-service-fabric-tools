/**
 * Captures the Marketplace screenshots into media/screenshots/: generates a
 * sample "Contoso" workspace with the extension's own scaffolding, starts a
 * fake cluster gateway, launches VS Code with this extension (and no others)
 * and drives it with Playwright over the Chrome DevTools protocol.
 *
 * Usage: npm run screenshots   (VS Code must be installed; set VSCODE_PATH to override)
 */
import { spawn, spawnSync, type ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { chromium, type Browser, type Page } from 'playwright-core';
import { applyCreateApplication } from '../../src/scaffold/createApplicationApply';
import { applyAddService } from '../../src/scaffold/addServiceApply';
import { loadApplicationProject } from '../../src/project/sfprojParser';
import { newProjectGuid } from '../../src/scaffold/createApplicationTemplates';
import { startMockCluster } from './mockCluster';

const REPO = path.resolve(__dirname, '..', '..');
const OUT = path.join(REPO, 'media', 'screenshots');
const GATEWAY_PORT = 19180;
const DEBUG_PORT = 9339;
const WIDTH = 1280;
/** What the fake cluster's endpoint is shown as. */
const FAKE_ENDPOINT = 'https://contoso-prod.westeurope.cloudapp.azure.com:19080';
const HEIGHT = 800;

/** The packaged extension (`npm run package` writes it to artifacts/). */
function packagedVsix(): string {
	const pkg = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8')) as { name: string; version: string };
	const vsix = path.join(REPO, 'artifacts', `${pkg.name}-${pkg.version}.vsix`);
	if (!fs.existsSync(vsix)) throw new Error(`${vsix} not found; run npm run package first.`);
	return vsix;
}

/** The `code` command-line launcher next to the VS Code executable. */
function codeCli(exe: string): string {
	if (process.platform === 'win32') return path.join(path.dirname(exe), 'bin', 'code.cmd');
	if (process.platform === 'darwin') return path.join(path.dirname(exe), '..', 'Resources', 'app', 'bin', 'code');
	return path.join(path.dirname(exe), 'bin', 'code');
}

function codeExecutable(): string {
	if (process.env.VSCODE_PATH) return process.env.VSCODE_PATH;
	if (process.platform === 'win32') return path.join(process.env.LOCALAPPDATA ?? '', 'Programs', 'Microsoft VS Code', 'Code.exe');
	if (process.platform === 'darwin') return '/Applications/Visual Studio Code.app/Contents/MacOS/Electron';
	return '/usr/share/code/code';
}

// ---- sample workspace ------------------------------------------------------------------

async function createWorkspace(root: string): Promise<string> {
	const app = path.join(root, 'Contoso.Store');
	applyCreateApplication({
		targetDirectory: app,
		applicationName: 'Contoso.Store',
		serviceName: 'Web',
		projectGuid: newProjectGuid(),
		kind: 'aspNetStateless',
		targetFramework: 'net8.0',
		targetOs: 'linux',
	});
	const sfproj = path.join(app, 'Contoso.Store.sfproj');
	const add = async (template: Parameters<typeof applyAddService>[1]): Promise<void> => {
		await applyAddService(await loadApplicationProject(sfproj), template);
	};
	await add({ serviceName: 'Catalog', serviceTypeName: 'CatalogType', kind: 'stateful', runtime: 'netcore', version: '1.0.0', targetFramework: 'net8.0', targetOs: 'linux' });
	await add({ serviceName: 'Cart', serviceTypeName: 'CartType', kind: 'actor', runtime: 'netcore', version: '1.0.0', targetFramework: 'net8.0', targetOs: 'linux' });
	await add({
		serviceName: 'Gateway',
		serviceTypeName: 'GatewayType',
		kind: 'container',
		version: '1.0.0',
		containerImage: 'contosoacr.azurecr.io/gateway:1.4.0',
		containerPort: 80,
		registryCredentials: true,
	});
	return sfproj;
}

function writeUserSettings(userDataDir: string): void {
	const dir = path.join(userDataDir, 'User');
	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(
		path.join(dir, 'settings.json'),
		JSON.stringify(
			{
				'workbench.colorTheme': 'Default Dark Modern',
				'workbench.startupEditor': 'none',
				'workbench.tips.enabled': false,
				'workbench.welcomePage.walkthroughs.openOnInstall': false,
				'workbench.secondarySideBar.defaultVisibility': 'hidden',
				'workbench.layoutControl.enabled': false,
				'chat.disableAIFeatures': true,
				'chat.commandCenter.enabled': false,
				'window.restoreWindows': 'none',
				'window.commandCenter': true,
				'window.title': '${rootName}',
				'telemetry.telemetryLevel': 'off',
				'update.mode': 'none',
				'extensions.ignoreRecommendations': true,
				'security.workspace.trust.enabled': false,
				'git.enabled': false,
				'editor.minimap.enabled': false,
				'editor.fontSize': 14,
				'editor.quickSuggestionsDelay': 0,
				'files.exclude': { '**/bin': true, '**/obj': true },
				'serviceFabric.debug.autoAttachOnPublish': 'never',
			},
			null,
			2,
		),
	);
}

// ---- driving VS Code ---------------------------------------------------------------------

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function connect(): Promise<{ browser: Browser; page: Page }> {
	for (let i = 0; i < 60; i++) {
		try {
			const browser = await chromium.connectOverCDP(`http://127.0.0.1:${DEBUG_PORT}`);
			for (let j = 0; j < 60; j++) {
				const page = browser.contexts().flatMap((c) => c.pages()).find((p) => p.url().includes('workbench'));
				if (page) return { browser, page };
				await sleep(500);
			}
		} catch {
			// not up yet
		}
		await sleep(500);
	}
	throw new Error('VS Code did not expose its debugging port.');
}

/** Fixes the workbench at WIDTH×HEIGHT CSS pixels (2× device pixels) whatever the real window size. */
async function resizeWindow(page: Page): Promise<void> {
	const session = await page.context().newCDPSession(page);
	await session.send('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: HEIGHT, deviceScaleFactor: 2, mobile: false });
}

class Driver {
	constructor(readonly page: Page) {}

	async command(title: string): Promise<void> {
		await this.page.keyboard.press('Escape');
		await this.page.keyboard.press('Control+Shift+P');
		const input = this.page.locator('.quick-input-widget input');
		await input.waitFor({ state: 'visible' });
		await input.fill(`>${title}`);
		await this.page.locator('.quick-input-list .monaco-list-row').first().waitFor();
		await sleep(300);
		await this.page.keyboard.press('Enter');
		await sleep(500);
	}

	/** Picks the quick-pick row whose label contains `text`. */
	async pick(text: string): Promise<void> {
		const row = this.page.locator('.quick-input-list .monaco-list-row', { hasText: text }).first();
		await row.waitFor({ state: 'visible', timeout: 15000 });
		await row.click();
		await sleep(500);
	}

	/** Replaces the text of an open input box and accepts it. */
	async input(text: string): Promise<void> {
		const input = this.page.locator('.quick-input-widget input');
		await input.waitFor({ state: 'visible', timeout: 15000 });
		await input.fill(text);
		await sleep(200);
		await this.page.keyboard.press('Enter');
		await sleep(800);
	}

	/** A view pane in the side bar, by its title (e.g. `Clusters`). */
	pane(title: string) {
		return this.page.locator('.pane').filter({ has: this.page.locator('.pane-header', { hasText: new RegExp(`^${title}`) }) });
	}

	/** Expands or collapses a side-bar view pane. */
	async setPaneExpanded(title: string, expanded: boolean): Promise<void> {
		const header = this.pane(title).locator('.pane-header').first();
		await header.waitFor();
		if (((await header.getAttribute('aria-expanded')) === 'true') !== expanded) await header.click();
		await sleep(500);
	}

	treeRow(name: RegExp | string, pane = 'Clusters') {
		return this.pane(pane).locator('.monaco-list-row').filter({ hasText: name }).first();
	}

	async expand(name: RegExp | string, pane = 'Clusters'): Promise<void> {
		const row = this.treeRow(name, pane);
		await row.waitFor({ state: 'visible', timeout: 20000 });
		if ((await row.getAttribute('aria-expanded')) !== 'true') await row.click();
		await sleep(900);
	}

	/** Drags the sash on the side bar's right edge so the side bar is `width` CSS pixels wide. */
	async sideBarWidth(width: number): Promise<void> {
		const sidebar = await this.page.locator('.part.sidebar').first().boundingBox();
		if (!sidebar) return;
		const edge = sidebar.x + sidebar.width;
		const sashes = await this.page.locator('.monaco-sash.vertical').evaluateAll((els) =>
			els.map((e) => {
				const r = e.getBoundingClientRect();
				return { x: r.x + r.width / 2, y: r.y + r.height / 2, h: r.height };
			}),
		);
		const sash = sashes.filter((s) => s.h > 100).sort((a, b) => Math.abs(a.x - edge) - Math.abs(b.x - edge))[0];
		if (!sash) return;
		await this.page.mouse.move(sash.x, sash.y);
		await sleep(200);
		await this.page.mouse.down();
		await this.page.mouse.move(sash.x + 20, sash.y, { steps: 5 });
		await this.page.mouse.move(sidebar.x + width, sash.y, { steps: 20 });
		await this.page.mouse.up();
		await sleep(500);
	}

	/** Swaps the fake gateway's localhost address for a realistic cluster host in whatever is on screen. */
	async scrub(): Promise<void> {
		await this.page.evaluate(
			([from, to]) => {
				const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
				for (let n = walker.nextNode(); n; n = walker.nextNode()) if (n.nodeValue?.includes(from)) n.nodeValue = n.nodeValue.split(from).join(to);
			},
			[`http://localhost:${GATEWAY_PORT}`, FAKE_ENDPOINT],
		);
	}

	async shot(name: string): Promise<void> {
		await sleep(700);
		await this.scrub();
		await this.page.screenshot({ path: path.join(OUT, `${name}.png`) });
		console.log(`  ${name}.png`);
	}
}

// ---- the shots -----------------------------------------------------------------------------

async function captureAll(d: Driver, sfproj: string): Promise<void> {
	const page = d.page;
	await d.command('Notifications: Toggle Do Not Disturb Mode');

	// The fake cluster, saved like any remote cluster.
	await d.command('Service Fabric: Add Cluster');
	await d.pick('Remote Cluster');
	await d.input(`http://localhost:${GATEWAY_PORT}`);
	await d.input('contoso-prod');
	await sleep(2000);

	// 1. Clusters view with an application mid-upgrade.
	await d.command('View: Show Service Fabric');
	await d.sideBarWidth(470);
	await d.setPaneExpanded('Applications', false);
	await d.expand(/^contoso-prod/);
	await d.expand(/^Applications \(/);
	await d.expand(/^Contoso\.Store/);
	await d.expand(/^Catalog/);
	await page.mouse.move(WIDTH - 10, HEIGHT / 2);
	await d.shot('clusters-view');

	// 2. Upgrade controls on the upgrading application.
	await d.treeRow(/^Contoso\.Store/).click({ button: 'right' });
	await page.locator('.context-view .monaco-menu').waitFor();
	await d.shot('upgrade-controls');
	await page.keyboard.press('Escape');

	// 3. Manifest IntelliSense: completion inside a code package.
	const manifest = path.join(path.dirname(sfproj), '..', 'Catalog', 'PackageRoot', 'ServiceManifest.xml');
	await d.command('View: Show Explorer');
	await d.sideBarWidth(300);
	await page.keyboard.press('Control+P');
	await page.locator('.quick-input-widget input').fill(path.relative(path.dirname(path.dirname(sfproj)), manifest));
	await sleep(800);
	await page.keyboard.press('Enter');
	await page.locator('.monaco-editor .view-lines').first().waitFor();
	await sleep(1500);
	const line = page.locator('.view-line', { hasText: '</CodePackage>' }).first();
	await line.click();
	await page.keyboard.press('Home');
	await page.keyboard.press('Enter');
	await page.keyboard.press('ArrowUp');
	await page.keyboard.type('    <', { delay: 60 });
	await page.locator('.suggest-widget.visible').waitFor({ timeout: 10000 });
	await d.shot('manifest-completion');
	await page.keyboard.press('Escape');

	// 4. Hover documentation.
	await page.keyboard.press('Control+Z');
	await page.keyboard.press('Control+Z');
	await page.keyboard.press('Control+Z');
	await sleep(400);
	await page.locator('.view-line span', { hasText: /^ConfigPackage$/ }).first().hover();
	await page.locator('.monaco-hover').first().waitFor({ state: 'visible', timeout: 10000 });
	await d.shot('manifest-hover');
	await d.command('View: Revert File');
	await d.command('View: Close All Editors');

	// 5. Publish target picker.
	await d.command('Service Fabric: Publish Application');
	await page.locator('.quick-input-list .monaco-list-row', { hasText: 'contoso-prod' }).waitFor();
	await d.shot('publish-picker');
	await page.keyboard.press('Escape');

	// 6. Add Service picker.
	await d.command('Service Fabric: Add New Service');
	await page.locator('.quick-input-list .monaco-list-row', { hasText: 'Stateless Service' }).first().waitFor();
	await d.shot('add-service');
	await page.keyboard.press('Escape');

	// 7. Applications view.
	await d.command('View: Show Service Fabric');
	await d.setPaneExpanded('Clusters', false);
	await d.setPaneExpanded('Applications', true);
	await d.expand(/^ApplicationPackageRoot/, 'Applications');
	await d.expand(/^GatewayPkg/, 'Applications');
	await d.expand(/^PublishProfiles/, 'Applications');
	await d.treeRow(/^ApplicationManifest\.xml/, 'Applications').click();
	await page.locator('.monaco-editor .view-lines').first().waitFor();
	await sleep(1500);
	await d.shot('applications-view');
}

async function main(): Promise<void> {
	const exe = codeExecutable();
	if (!fs.existsSync(exe)) throw new Error(`VS Code not found at ${exe}. Set VSCODE_PATH.`);
	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-shots-'));
	const workspace = path.join(tmp, 'Contoso');
	fs.mkdirSync(workspace);
	fs.mkdirSync(OUT, { recursive: true });
	console.log('Generating the sample workspace...');
	const sfproj = await createWorkspace(workspace);
	const userData = path.join(tmp, 'user-data');
	writeUserSettings(userData);
	const extensionsDir = path.join(tmp, 'extensions');
	console.log('Installing the packaged extension...');
	// cmd.exe needs the .cmd path quoted (it contains spaces).
	const cli = process.platform === 'win32' ? `"${codeCli(exe)}"` : codeCli(exe);
	const install = spawnSync(cli, [`--extensions-dir=${extensionsDir}`, `--user-data-dir=${userData}`, '--install-extension', packagedVsix()], {
		shell: process.platform === 'win32',
		encoding: 'utf8',
	});
	if (install.status !== 0) throw new Error(`Installing the VSIX failed: ${install.stderr || install.stdout}`);
	const stopGateway = await startMockCluster(GATEWAY_PORT);
	let code: ChildProcess | undefined;
	try {
		console.log('Launching VS Code...');
		code = spawn(
			exe,
			[
				`--user-data-dir=${userData}`,
				`--extensions-dir=${extensionsDir}`,
				`--remote-debugging-port=${DEBUG_PORT}`,
				'--disable-workspace-trust',
				'--skip-welcome',
				'--skip-release-notes',
				'--force-device-scale-factor=2',
				'--new-window',
				workspace,
			],
			{ stdio: 'ignore', env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined } },
		);
		const { browser, page } = await connect();
		await resizeWindow(page);
		await page.locator('.monaco-workbench').waitFor();
		await sleep(6000); // extension activation and the first cluster probe
		console.log(`Capturing into ${path.relative(REPO, OUT)}:`);
		try {
			await captureAll(new Driver(page), sfproj);
		} catch (err) {
			await page.screenshot({ path: path.join(tmp, '..', 'sf-shots-failure.png') }).catch(() => undefined);
			throw err;
		}
		await browser.close().catch(() => undefined);
	} finally {
		if (code?.pid) {
			if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(code.pid), '/T', '/F']);
			else code.kill();
		}
		await stopGateway();
		// VS Code can hold files in its user-data folder for a moment after exiting.
		await sleep(1500);
		try {
			fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
		} catch {
			console.warn(`Couldn't remove ${tmp}; delete it by hand.`);
		}
	}
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
