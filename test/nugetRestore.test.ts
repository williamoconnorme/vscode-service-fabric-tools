import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as path from 'node:path';
import { computePackagesDirectory } from '../src/build/nugetRestore';

const importOf = (prefix: string): string =>
	`<Project><Import Project="${prefix}Microsoft.VisualStudio.Azure.Fabric.MSBuild.1.7.9\\build\\Microsoft.VisualStudio.Azure.Fabric.Application.props" /></Project>`;

test('computePackagesDirectory follows the .sfproj import', () => {
	const sfproj = path.join(path.sep, 'repo', 'src', 'App', 'App.sfproj');
	assert.equal(computePackagesDirectory(sfproj, importOf('..\\packages\\')), path.join(path.sep, 'repo', 'src', 'packages'));
	assert.equal(computePackagesDirectory(sfproj, importOf('..\\..\\packages\\')), path.join(path.sep, 'repo', 'packages'));
	assert.equal(computePackagesDirectory(sfproj, importOf('packages/')), path.join(path.sep, 'repo', 'src', 'App', 'packages'));
});

test('computePackagesDirectory falls back to ../packages', () => {
	const sfproj = path.join(path.sep, 'repo', 'App', 'App.sfproj');
	assert.equal(computePackagesDirectory(sfproj, '<Project />'), path.join(path.sep, 'repo', 'packages'));
	assert.equal(computePackagesDirectory(sfproj, importOf('$(SolutionDir)packages\\')), path.join(path.sep, 'repo', 'packages'));
});
