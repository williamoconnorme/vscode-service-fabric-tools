import * as vscode from 'vscode';
import * as fsp from 'fs/promises';
import {
	expandHome,
	inspectClientCert,
	isPfxPath,
	matchesFindCriteria,
	passphraseSecretKey,
	type ClientCertInfo,
	type ClientCertMaterial,
	type ClientCertRef,
} from './clientCert';
import { normalizeThumbprint } from './tlsPinning';
import type { Logger } from '../util/logger';

/** A certificate the user picked (or that was resolved from settings), loaded and ready to use. */
export interface LoadedClientCert {
	ref: ClientCertRef;
	info: ClientCertInfo;
	material: ClientCertMaterial;
	/** Kept only until {@link ClientCertManager.remember} moves it into SecretStorage. */
	passphrase?: string;
}

/** How a publish profile identifies its client certificate (`FindType` / `FindValue`). */
export interface ClientCertCriteria {
	findType?: string;
	findValue?: string;
}

/**
 * Loads client certificates for REST calls. Passphrases are kept in VS Code's
 * SecretStorage (Keychain on macOS, Credential Manager on Windows, libsecret on
 * Linux); loaded material is cached per thumbprint for the session.
 */
export class ClientCertManager {
	private readonly cache = new Map<string, ClientCertMaterial>();

	constructor(
		private readonly secrets: vscode.SecretStorage,
		private readonly logger: Logger,
	) {}

	/**
	 * TLS material for a saved reference. With `interactive`, a passphrase missing
	 * from SecretStorage (or a stale one) is asked for again; otherwise it throws.
	 */
	async getMaterial(ref: ClientCertRef, interactive = false): Promise<ClientCertMaterial> {
		const thumbprint = normalizeThumbprint(ref.thumbprint);
		const cached = this.cache.get(thumbprint);
		if (cached) return cached;
		const stored = ref.hasPassphrase ? await this.secrets.get(passphraseSecretKey(thumbprint)) : undefined;
		try {
			const { info, material } = await inspectClientCert(ref, stored);
			this.checkThumbprint(ref, info);
			this.cache.set(thumbprint, material);
			return material;
		} catch (err) {
			if (!interactive || !/passphrase/i.test((err as Error).message)) throw err;
			const loaded = await this.loadWithPassphrasePrompt(ref, (err as Error).message);
			if (!loaded) throw new Error(`A passphrase is required for the client certificate ${ref.path}.`);
			this.checkThumbprint(ref, loaded.info);
			await this.remember(loaded);
			return loaded.material;
		}
	}

	/** Saves a loaded certificate's passphrase in SecretStorage and caches its material. */
	async remember(cert: LoadedClientCert): Promise<void> {
		// Also keyed by path: a PFX's thumbprint can't be read without its passphrase,
		// so a file named in settings is looked up by path before prompting.
		for (const key of [passphraseSecretKey(cert.ref.thumbprint), pathSecretKey(cert.ref.path)]) {
			if (cert.passphrase) await this.secrets.store(key, cert.passphrase);
			else await this.secrets.delete(key);
		}
		cert.passphrase = undefined;
		this.cache.set(normalizeThumbprint(cert.ref.thumbprint), cert.material);
	}

	/** Drops a cached certificate, e.g. after the file was replaced. */
	forget(thumbprint: string): void {
		this.cache.delete(normalizeThumbprint(thumbprint));
	}

	/**
	 * Asks the user for a certificate file (PFX/P12 or PEM, plus a key file when
	 * the PEM has no key) and its passphrase. Returns `undefined` on cancel.
	 */
	async pick(title: string, defaultPath?: string): Promise<LoadedClientCert | undefined> {
		const picked = await vscode.window.showOpenDialog({
			title,
			openLabel: 'Use Certificate',
			canSelectMany: false,
			defaultUri: defaultPath ? vscode.Uri.file(expandHome(defaultPath)) : undefined,
			filters: { 'Client certificates': ['pfx', 'p12', 'pem', 'crt', 'cer'], 'All files': ['*'] },
		});
		const file = picked?.[0]?.fsPath;
		if (!file) return undefined;
		let keyPath: string | undefined;
		if (!isPfxPath(file) && !(await pemHasPrivateKey(file))) {
			const key = await vscode.window.showOpenDialog({
				title: `Private key for ${file}`,
				openLabel: 'Use Key',
				canSelectMany: false,
				defaultUri: vscode.Uri.file(file),
				filters: { 'PEM keys': ['pem', 'key'], 'All files': ['*'] },
			});
			keyPath = key?.[0]?.fsPath;
			if (!keyPath) return undefined;
		}
		return this.load({ path: file, keyPath }, true);
	}

	/**
	 * Loads a certificate from a path, first without a passphrase, then (with
	 * `interactive`) prompting for one until it loads or the user cancels.
	 */
	async load(location: Pick<ClientCertRef, 'path' | 'keyPath'>, interactive: boolean): Promise<LoadedClientCert | undefined> {
		const ref: ClientCertRef = {
			path: expandHome(location.path),
			keyPath: location.keyPath && expandHome(location.keyPath),
			thumbprint: '',
			hasPassphrase: false,
		};
		try {
			const { info, material } = await inspectClientCert(ref);
			ref.thumbprint = info.thumbprint;
			return { ref, info, material };
		} catch (err) {
			if (!/passphrase/i.test((err as Error).message) || !interactive) {
				if (interactive) vscode.window.showErrorMessage((err as Error).message);
				else throw err;
				return undefined;
			}
			const stored = await this.secrets.get(pathSecretKey(ref.path));
			if (stored) {
				try {
					const { info, material } = await inspectClientCert(ref, stored);
					return { ref: { ...ref, thumbprint: info.thumbprint, hasPassphrase: true }, info, material, passphrase: stored };
				} catch {
					// Stale passphrase (the file was re-exported): ask again.
				}
			}
			return this.loadWithPassphrasePrompt(ref, (err as Error).message);
		}
	}

	/**
	 * Resolves the certificate a publish profile asks for (§2.5 of the 1.2.0
	 * plan): the saved connection's certificate when it matches, then the
	 * `serviceFabric.clientCertificates` setting, then a file prompt (offering to
	 * save the choice to the setting).
	 */
	async resolveForProfile(criteria: ClientCertCriteria, saved?: ClientCertRef): Promise<LoadedClientCert | undefined> {
		if (saved) {
			try {
				const material = await this.getMaterial(saved, true);
				const { info } = await inspectClientCert(saved, material.passphrase);
				if (!criteria.findValue || matchesFindCriteria(info, criteria.findType, criteria.findValue)) {
					return { ref: saved, info, material };
				}
			} catch (err) {
				this.logger.warn(`Saved client certificate ${saved.path} is unusable: ${(err as Error).message}`);
			}
		}
		const mapped = criteria.findValue ? lookupCertificateSetting(criteria.findValue) : undefined;
		if (mapped) {
			const loaded = await this.load({ path: mapped }, true);
			if (loaded && (!criteria.findValue || matchesFindCriteria(loaded.info, criteria.findType, criteria.findValue))) return loaded;
			if (loaded) {
				this.logger.warn(
					`serviceFabric.clientCertificates maps ${criteria.findValue} to ${mapped}, but that certificate (thumbprint ${loaded.info.thumbprint}, CN=${loaded.info.subjectCommonName}) doesn't match.`,
				);
			}
		}
		const what = criteria.findValue ? `${criteria.findType ?? 'FindByThumbprint'} ${criteria.findValue}` : 'this cluster';
		const loaded = await this.pick(`Client certificate for ${what} (PFX/P12 or PEM)`);
		if (!loaded) return undefined;
		if (criteria.findValue && !matchesFindCriteria(loaded.info, criteria.findType, criteria.findValue)) {
			const proceed = await vscode.window.showWarningMessage(
				`The selected certificate (thumbprint ${loaded.info.thumbprint}, CN=${loaded.info.subjectCommonName}) doesn't match the publish profile's ${what}. Use it anyway?`,
				{ modal: true },
				'Use Anyway',
			);
			if (proceed !== 'Use Anyway') return undefined;
		} else if (criteria.findValue) {
			const save = await vscode.window.showInformationMessage(
				`Remember ${loaded.ref.path} for ${criteria.findValue} in the serviceFabric.clientCertificates setting?`,
				'Save to User Settings',
				'Not Now',
			);
			if (save === 'Save to User Settings') {
				const config = vscode.workspace.getConfiguration('serviceFabric');
				const current = config.get<Record<string, string>>('clientCertificates') ?? {};
				await config.update('clientCertificates', { ...current, [criteria.findValue]: loaded.ref.path }, vscode.ConfigurationTarget.Global);
			}
		}
		return loaded;
	}

	private async loadWithPassphrasePrompt(ref: ClientCertRef, reason: string): Promise<LoadedClientCert | undefined> {
		let prompt = reason;
		for (;;) {
			const passphrase = await vscode.window.showInputBox({
				title: `Passphrase for ${ref.path}`,
				prompt,
				password: true,
				ignoreFocusOut: true,
			});
			if (passphrase === undefined) return undefined;
			try {
				const { info, material } = await inspectClientCert(ref, passphrase || undefined);
				const loadedRef: ClientCertRef = { ...ref, thumbprint: info.thumbprint, hasPassphrase: Boolean(passphrase) };
				return { ref: loadedRef, info, material, passphrase: passphrase || undefined };
			} catch (err) {
				prompt = (err as Error).message;
				if (!/passphrase/i.test(prompt)) {
					vscode.window.showErrorMessage(prompt);
					return undefined;
				}
			}
		}
	}

	private checkThumbprint(ref: ClientCertRef, info: ClientCertInfo): void {
		if (ref.thumbprint && normalizeThumbprint(ref.thumbprint) !== info.thumbprint) {
			throw new Error(
				`The client certificate at ${ref.path} changed (thumbprint ${info.thumbprint}, expected ${normalizeThumbprint(ref.thumbprint)}). Run "Change Client Certificate…" on the cluster.`,
			);
		}
	}
}

/** `serviceFabric.clientCertificates[findValue]`, matched case- and separator-insensitively for thumbprints. */
function lookupCertificateSetting(findValue: string): string | undefined {
	const map = vscode.workspace.getConfiguration('serviceFabric').get<Record<string, string>>('clientCertificates') ?? {};
	const wanted = normalizeThumbprint(findValue);
	for (const [key, value] of Object.entries(map)) {
		if (typeof value === 'string' && (key === findValue || normalizeThumbprint(key) === wanted)) return value;
	}
	return undefined;
}

async function pemHasPrivateKey(file: string): Promise<boolean> {
	try {
		return /-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(await fsp.readFile(file, 'utf8'));
	} catch {
		return false;
	}
}

/** Secondary SecretStorage key for a certificate file's passphrase, by absolute path. */
function pathSecretKey(file: string): string {
	return `serviceFabric.clientCertPath.${expandHome(file)}`;
}

let manager: ClientCertManager | undefined;

/** Registers the session's manager; called once from `activate`. */
export function registerClientCertManager(instance: ClientCertManager): void {
	manager = instance;
}

/** The session's {@link ClientCertManager}. Throws before activation. */
export function getClientCertManager(): ClientCertManager {
	if (!manager) throw new Error('Client certificate support is not initialized.');
	return manager;
}
