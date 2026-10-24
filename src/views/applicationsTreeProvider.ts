// @ts-nocheck
import * as vscode from 'vscode';
import * as path from 'path';

var ApplicationTreeItem = class extends vscode.TreeItem {
		constructor(r, n, i, o, s, a) {
			super(n, i);
			this.kind = r;
			this.project = o;
			this.resource = s;
			this.children = a;
			switch (((this.contextValue = r), s && (this.resourceUri = s), r)) {
				case 'sfproj':
					((this.iconPath = new vscode.ThemeIcon('package')), (this.contextValue = 'sfproj'));
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
					((this.iconPath = new vscode.ThemeIcon('file-code')),
						(this.command = s
							? {
									command: 'serviceFabric.openFile',
									title: 'Open',
									arguments: [s],
								}
							: void 0));
					break;
				case 'file':
					((this.iconPath = vscode.ThemeIcon.File),
						(this.command = s
							? {
									command: 'serviceFabric.openFile',
									title: 'Open',
									arguments: [s],
								}
							: void 0));
					break;
				case 'projectRef':
					((this.iconPath = new vscode.ThemeIcon('references')),
						(this.command = s
							? {
									command: 'serviceFabric.openFile',
									title: 'Open',
									arguments: [s],
								}
							: void 0));
					break;
				case 'message':
					this.iconPath = new vscode.ThemeIcon('info');
					break;
			}
		}
	},
	ApplicationsTreeProvider = class {
		constructor(t) {
			this.watcher = t;
			t.onDidChange(() => this.emitter.fire());
		}
		emitter = new vscode.EventEmitter();
		onDidChangeTreeData = this.emitter.event;
		refresh() {
			this.emitter.fire();
		}
		getTreeItem(t) {
			return t;
		}
		async getChildren(t) {
			if (!t) {
				let r = this.watcher.getProjects();
				return r.length === 0 ? [] : r.map((n) => this.makeProjectNode(n));
			}
			return t.children ?? [];
		}
		makeProjectNode(t) {
			let r = t.applicationManifest?.applicationTypeName || path.basename(t.sfproj.path, '.sfproj'),
				n = new ApplicationTreeItem(
					'sfproj',
					r,
					vscode.TreeItemCollapsibleState.Expanded,
					t,
					vscode.Uri.file(t.sfproj.path),
					this.buildProjectChildren(t),
				),
				i = t.applicationManifest?.applicationTypeVersion;
			return ((n.description = i ? `v${i}` : void 0), (n.tooltip = t.sfproj.path), n);
		}
		buildProjectChildren(t) {
			let r = [],
				n = path.join(t.sfproj.directory, t.sfproj.applicationPackageRootFolder),
				i = vscode.Uri.file(n),
				o = [];
			t.applicationManifest
				? o.push(
						new ApplicationTreeItem(
							'manifest',
							'ApplicationManifest.xml',
							vscode.TreeItemCollapsibleState.None,
							t,
							vscode.Uri.file(t.applicationManifest.path),
						),
					)
				: o.push(new ApplicationTreeItem('message', 'ApplicationManifest.xml not found', vscode.TreeItemCollapsibleState.None));
			for (let s of t.serviceManifests) o.push(this.makeServiceFolderNode(t, s));
			if (
				(r.push(new ApplicationTreeItem('group', t.sfproj.applicationPackageRootFolder, vscode.TreeItemCollapsibleState.Expanded, t, i, o)),
				t.applicationParameters.length && r.push(this.makeFileGroup(t, 'ApplicationParameters', t.applicationParameters)),
				t.publishProfiles.length && r.push(this.makeFileGroup(t, 'PublishProfiles', t.publishProfiles)),
				t.startupServiceParameters.length && r.push(this.makeFileGroup(t, 'StartupServiceParameters', t.startupServiceParameters)),
				t.startupServicesManifest &&
					r.push(
						new ApplicationTreeItem(
							'manifest',
							'StartupServices.xml',
							vscode.TreeItemCollapsibleState.None,
							t,
							vscode.Uri.file(t.startupServicesManifest),
						),
					),
				t.scripts.length && r.push(this.makeFileGroup(t, 'Scripts', t.scripts)),
				t.sfproj.projectReferences.length)
			) {
				let s = t.sfproj.projectReferences.map(
					(a) => new ApplicationTreeItem('projectRef', path.basename(a), vscode.TreeItemCollapsibleState.None, t, vscode.Uri.file(a)),
				);
				r.push(new ApplicationTreeItem('group', 'References', vscode.TreeItemCollapsibleState.Collapsed, t, void 0, s));
			}
			return r;
		}
		makeServiceFolderNode(t, r) {
			let n = path.basename(r.packageDirectory),
				i = vscode.Uri.file(r.packageDirectory),
				o = [
					new ApplicationTreeItem(
						'serviceManifest',
						'ServiceManifest.xml',
						vscode.TreeItemCollapsibleState.None,
						t,
						vscode.Uri.file(r.path),
					),
				];
			for (let a of r.codePackages)
				o.push(
					new ApplicationTreeItem(
						'packageFolder',
						`Code (${a})`,
						vscode.TreeItemCollapsibleState.None,
						t,
						vscode.Uri.file(path.join(r.packageDirectory, a)),
					),
				);
			for (let a of r.configPackages)
				o.push(
					new ApplicationTreeItem(
						'packageFolder',
						`Config (${a})`,
						vscode.TreeItemCollapsibleState.None,
						t,
						vscode.Uri.file(path.join(r.packageDirectory, a)),
					),
				);
			for (let a of r.dataPackages)
				o.push(
					new ApplicationTreeItem(
						'packageFolder',
						`Data (${a})`,
						vscode.TreeItemCollapsibleState.None,
						t,
						vscode.Uri.file(path.join(r.packageDirectory, a)),
					),
				);
			let s = new ApplicationTreeItem('serviceFolder', n, vscode.TreeItemCollapsibleState.Collapsed, t, i, o);
			return ((s.description = r.version ? `v${r.version}` : void 0), s);
		}
		makeFileGroup(t, r, n) {
			let i = n.map((o) => new ApplicationTreeItem('file', path.basename(o), vscode.TreeItemCollapsibleState.None, t, vscode.Uri.file(o)));
			return new ApplicationTreeItem('group', r, vscode.TreeItemCollapsibleState.Collapsed, t, void 0, i);
		}
	};

export { ApplicationsTreeProvider };
