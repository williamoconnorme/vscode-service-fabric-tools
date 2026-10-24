import * as vscode from 'vscode';
import * as fsp from 'fs/promises';
import * as path from 'path';
import { encryptForServiceFabric, loadEncryptionCertificate, type EncryptionCertificate } from '../cluster/encryptSecret';
import type { ProjectLookup } from './buildCommands';
import type { Logger } from '../util/logger';

/** `workspaceState` key: the certificate file last used for encryption. */
const LAST_CERT_KEY = 'serviceFabric.encryptSecret.certificate';

/** Thumbprints of the `<SecretsCertificate>` elements declared in the workspace's application manifests. */
async function declaredSecretsThumbprints(projects: ProjectLookup): Promise<Set<string>> {
	const out = new Set<string>();
	for (const p of projects.getProjects()) {
		const manifest = p.applicationManifest?.path;
		if (!manifest) continue;
		const text = await fsp.readFile(manifest, 'utf8').catch(() => '');
		for (const m of text.matchAll(/<SecretsCertificate\b[^>]*\bX509FindValue\s*=\s*"([^"]+)"/gi)) out.add(m[1].replace(/\s/g, '').toUpperCase());
	}
	return out;
}

async function pickCertificate(memento: vscode.Memento): Promise<{ cert: EncryptionCertificate; file: string } | undefined> {
	const last = memento.get<string>(LAST_CERT_KEY);
	type Item = vscode.QuickPickItem & { file?: string };
	const items: Item[] = [];
	if (last) items.push({ label: `$(key) ${path.basename(last)}`, description: 'Last used', detail: last, file: last });
	items.push({ label: '$(folder-opened) Select Certificate File…', description: 'Public certificate: .cer, .crt or .pem' });
	const picked = last ? await vscode.window.showQuickPick(items, { placeHolder: 'Certificate to encrypt with (the cluster decrypts with its private key)' }) : items[0];
	if (!picked) return undefined;
	let file = picked.file;
	if (!file) {
		const uri = await vscode.window.showOpenDialog({
			canSelectMany: false,
			openLabel: 'Use Certificate',
			title: 'Public certificate of the cluster\'s secrets certificate',
			filters: { Certificates: ['cer', 'crt', 'pem', 'der'], 'All files': ['*'] },
		});
		file = uri?.[0]?.fsPath;
		if (!file) return undefined;
	}
	try {
		const cert = loadEncryptionCertificate(await fsp.readFile(file));
		await memento.update(LAST_CERT_KEY, file);
		return { cert, file };
	} catch (err) {
		vscode.window.showErrorMessage(`Couldn't use ${path.basename(file)}: ${(err as Error).message}`);
		return undefined;
	}
}

/**
 * `serviceFabric.encryptSecret`: encrypts a value with a certificate for
 * `IsEncrypted="true"` settings and parameters (or `PasswordEncrypted="true"`
 * registry credentials), like `Invoke-ServiceFabricEncryptText`, on any OS.
 * Replaces the selection in an XML editor, otherwise copies the result.
 */
export async function encryptSecret(projects: ProjectLookup, memento: vscode.Memento, logger: Logger): Promise<void> {
	const picked = await pickCertificate(memento);
	if (!picked) return;
	const { cert } = picked;
	const declared = await declaredSecretsThumbprints(projects);
	if (declared.size > 0 && !declared.has(cert.thumbprint)) {
		const go = await vscode.window.showWarningMessage(
			`${cert.thumbprint} isn't a SecretsCertificate declared in the open ApplicationManifest.xml (${[...declared].join(', ')}). The cluster can only decrypt values encrypted for a certificate installed on its nodes.`,
			{ modal: true },
			'Encrypt Anyway',
		);
		if (go !== 'Encrypt Anyway') return;
	}
	const value = await vscode.window.showInputBox({
		prompt: `Value to encrypt for ${cert.subject} (${cert.thumbprint})`,
		password: true,
		ignoreFocusOut: true,
	});
	if (value === undefined) return;
	const encrypted = encryptForServiceFabric(value, cert);
	logger.info(`Encrypted a value for certificate ${cert.thumbprint} (${cert.subject}, expires ${cert.validTo}).`);
	const editor = vscode.window.activeTextEditor;
	if (editor && editor.document.languageId === 'xml') {
		await editor.edit((edit) => {
			for (const sel of editor.selections) edit.replace(sel, encrypted);
		});
		vscode.window.showInformationMessage(
			`Inserted the encrypted value (certificate ${cert.thumbprint}). Mark the setting IsEncrypted="true" (or the registry password PasswordEncrypted="true").`,
		);
	} else {
		await vscode.env.clipboard.writeText(encrypted);
		vscode.window.showInformationMessage(`Encrypted value copied to the clipboard (certificate ${cert.thumbprint}).`);
	}
}
