import * as vscode from 'vscode';
import * as path from 'path';
import type { SfProjectWatcher } from '../project/projectWatcher';
import type { ApplicationProject, ServiceManifest } from '../project/sfprojModel';

export type ApplicationNodeKind =
	'sfproj' | 'group' | 'serviceFolder' | 'packageFolder' | 'manifest' | 'serviceManifest' | 'file' | 'projectRef' | 'message';

/** A node in the `serviceFabric.applications` view. `contextValue` is the node kind. */
export class ApplicationTreeItem extends vscode.TreeItem {
	constructor(
		readonly kind: ApplicationNodeKind,
		label: string,
		collapsibleState: vscode.TreeItemCollapsibleState,
		readonly project?: ApplicationProject,
		readonly resource?: vscode.Uri,
		readonly children?: ApplicationTreeItem[],
	) {
		super(label, collapsibleState);
		this.contextValue = kind;
		if (resource) this.resourceUri = resource;
		switch (kind) {
			case 'sfproj':
				this.iconPath = new vscode.ThemeIcon('package');
				this.contextValue = 'sfproj';
				break;
			case 'group':
				this.iconPath = new vscode.ThemeIcon('folder');
				break;
			case 'serviceFolder':
				this.iconPath = new vscode.ThemeIcon('folder-library');
				break;
			case 'packageFolder':
				this.iconPath = new vscode.ThemeIcon('folder');
				break;
			case 'manifest':
			case 'serviceManifest':
				this.iconPath = new vscode.ThemeIcon('file-code');
				this.command = resource ? { command: 'serviceFabric.openFile', title: 'Open', arguments: [resource] } : undefined;
				break;
			case 'file':
				this.iconPath = vscode.ThemeIcon.File;
				this.command = resource ? { command: 'serviceFabric.openFile', title: 'Open', arguments: [resource] } : undefined;
				break;
			case 'projectRef':
				this.iconPath = new vscode.ThemeIcon('references');
				this.command = resource ? { command: 'serviceFabric.openFile', title: 'Open', arguments: [resource] } : undefined;
				break;
			case 'message':
				this.iconPath = new vscode.ThemeIcon('info');
				break;
		}
	}
}

/** Tree data for the `serviceFabric.applications` view: one root per .sfproj in the workspace. */
export class ApplicationsTreeProvider implements vscode.TreeDataProvider<ApplicationTreeItem> {
	private readonly emitter = new vscode.EventEmitter<void>();
	readonly onDidChangeTreeData: vscode.Event<void> = this.emitter.event;

	constructor(private readonly watcher: SfProjectWatcher) {
		watcher.onDidChange(() => this.emitter.fire());
	}

	refresh(): void {
		this.emitter.fire();
	}

	getTreeItem(element: ApplicationTreeItem): ApplicationTreeItem {
		return element;
	}

	async getChildren(element?: ApplicationTreeItem): Promise<ApplicationTreeItem[]> {
		if (!element) {
			const projects = this.watcher.getProjects();
			return projects.length === 0 ? [] : projects.map((p) => this.makeProjectNode(p));
		}
		return element.children ?? [];
	}

	private makeProjectNode(project: ApplicationProject): ApplicationTreeItem {
		const label = project.applicationManifest?.applicationTypeName || path.basename(project.sfproj.path, '.sfproj');
		const node = new ApplicationTreeItem(
			'sfproj',
			label,
			vscode.TreeItemCollapsibleState.Expanded,
			project,
			vscode.Uri.file(project.sfproj.path),
			this.buildProjectChildren(project),
		);
		const version = project.applicationManifest?.applicationTypeVersion;
		node.description = version ? `v${version}` : undefined;
		node.tooltip = project.sfproj.path;
		return node;
	}

	private buildProjectChildren(project: ApplicationProject): ApplicationTreeItem[] {
		const children: ApplicationTreeItem[] = [];
		const apkgRootPath = path.join(project.sfproj.directory, project.sfproj.applicationPackageRootFolder);
		const apkgRootUri = vscode.Uri.file(apkgRootPath);
		const apkgChildren: ApplicationTreeItem[] = [];
		if (project.applicationManifest) {
			apkgChildren.push(
				new ApplicationTreeItem(
					'manifest',
					'ApplicationManifest.xml',
					vscode.TreeItemCollapsibleState.None,
					project,
					vscode.Uri.file(project.applicationManifest.path),
				),
			);
		} else {
			apkgChildren.push(new ApplicationTreeItem('message', 'ApplicationManifest.xml not found', vscode.TreeItemCollapsibleState.None));
		}
		for (const sm of project.serviceManifests) apkgChildren.push(this.makeServiceFolderNode(project, sm));
		children.push(
			new ApplicationTreeItem(
				'group',
				project.sfproj.applicationPackageRootFolder,
				vscode.TreeItemCollapsibleState.Expanded,
				project,
				apkgRootUri,
				apkgChildren,
			),
		);
		if (project.applicationParameters.length) {
			children.push(this.makeFileGroup(project, 'ApplicationParameters', project.applicationParameters));
		}
		if (project.publishProfiles.length) {
			children.push(this.makeFileGroup(project, 'PublishProfiles', project.publishProfiles));
		}
		if (project.startupServiceParameters.length) {
			children.push(this.makeFileGroup(project, 'StartupServiceParameters', project.startupServiceParameters));
		}
		if (project.startupServicesManifest) {
			children.push(
				new ApplicationTreeItem(
					'manifest',
					'StartupServices.xml',
					vscode.TreeItemCollapsibleState.None,
					project,
					vscode.Uri.file(project.startupServicesManifest),
				),
			);
		}
		if (project.scripts.length) {
			children.push(this.makeFileGroup(project, 'Scripts', project.scripts));
		}
		if (project.sfproj.projectReferences.length) {
			const refs = project.sfproj.projectReferences.map(
				(ref) =>
					new ApplicationTreeItem('projectRef', path.basename(ref), vscode.TreeItemCollapsibleState.None, project, vscode.Uri.file(ref)),
			);
			children.push(new ApplicationTreeItem('group', 'References', vscode.TreeItemCollapsibleState.Collapsed, project, undefined, refs));
		}
		return children;
	}

	private makeServiceFolderNode(project: ApplicationProject, sm: ServiceManifest): ApplicationTreeItem {
		const folderName = path.basename(sm.packageDirectory);
		const folderUri = vscode.Uri.file(sm.packageDirectory);
		const children: ApplicationTreeItem[] = [
			new ApplicationTreeItem(
				'serviceManifest',
				'ServiceManifest.xml',
				vscode.TreeItemCollapsibleState.None,
				project,
				vscode.Uri.file(sm.path),
			),
		];
		for (const pkg of sm.codePackages) {
			children.push(
				new ApplicationTreeItem(
					'packageFolder',
					`Code (${pkg})`,
					vscode.TreeItemCollapsibleState.None,
					project,
					vscode.Uri.file(path.join(sm.packageDirectory, pkg)),
				),
			);
		}
		for (const pkg of sm.configPackages) {
			children.push(
				new ApplicationTreeItem(
					'packageFolder',
					`Config (${pkg})`,
					vscode.TreeItemCollapsibleState.None,
					project,
					vscode.Uri.file(path.join(sm.packageDirectory, pkg)),
				),
			);
		}
		for (const pkg of sm.dataPackages) {
			children.push(
				new ApplicationTreeItem(
					'packageFolder',
					`Data (${pkg})`,
					vscode.TreeItemCollapsibleState.None,
					project,
					vscode.Uri.file(path.join(sm.packageDirectory, pkg)),
				),
			);
		}
		const node = new ApplicationTreeItem(
			'serviceFolder',
			folderName,
			vscode.TreeItemCollapsibleState.Collapsed,
			project,
			folderUri,
			children,
		);
		node.description = sm.version ? `v${sm.version}` : undefined;
		return node;
	}

	private makeFileGroup(project: ApplicationProject, label: string, files: string[]): ApplicationTreeItem {
		const children = files.map(
			(f) => new ApplicationTreeItem('file', path.basename(f), vscode.TreeItemCollapsibleState.None, project, vscode.Uri.file(f)),
		);
		return new ApplicationTreeItem('group', label, vscode.TreeItemCollapsibleState.Collapsed, project, undefined, children);
	}
}
