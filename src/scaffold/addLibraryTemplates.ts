// @ts-nocheck

function buildLibraryCsproj(e) {
	return `<Project Sdk="Microsoft.NET.Sdk">

  <PropertyGroup>
    <TargetFramework>${e.targetFramework}</TargetFramework>
    <ImplicitUsings>enable</ImplicitUsings>
    <Nullable>enable</Nullable>
  </PropertyGroup>

</Project>
`;
}

function buildLibraryClassStub(e) {
	return `namespace ${sanitizeNamespace(e)};

public class Class1
{
}
`;
}

function sanitizeNamespace(e) {
	return (
		e
			.split('.')
			.map((t) => t.replace(/[^A-Za-z0-9_]/g, ''))
			.filter((t) => t.length > 0)
			.map((t) => (/^[0-9]/.test(t) ? `_${t}` : t))
			.join('.') || 'Library'
	);
}

function patchCsprojAddProjectReference(e, t) {
	let r = t.replace(/\//g, '\\'),
		n = referenceVariants(t);
	if (containsAnyReference(e, n))
		return {
			xml: e,
			changed: !1,
		};
	let i = `    <ProjectReference Include="${r}" />`,
		o = /<ItemGroup\b[^>]*>([\s\S]*?)<\/ItemGroup>/g,
		s,
		a = null;
	for (; (s = o.exec(e)) !== null;)
		if (/<ProjectReference\b/.test(s[1])) {
			a = {
				start: s.index,
				end: s.index + s[0].length,
			};
			break;
		}
	if (a) {
		let u = e.slice(a.start, a.end).replace(
			/(\s*<\/ItemGroup>)/,
			`
${i}$1`,
		);
		return {
			xml: e.slice(0, a.start) + u + e.slice(a.end),
			changed: !0,
		};
	}
	let c = `
  <ItemGroup>
${i}
  </ItemGroup>
`;
	return /<\/Project>\s*$/.test(e)
		? {
				xml: e.replace(/(\s*<\/Project>)/, `${c}$1`),
				changed: !0,
			}
		: {
				xml: e + c,
				changed: !0,
			};
}

function patchCsprojRemoveProjectReference(e, t) {
	let r = referenceVariants(t),
		n = e,
		i = !1;
	for (let o of r) {
		let s = new RegExp(`\\r?\\n?\\s*<ProjectReference\\s+Include="${escapeRegex(o)}"\\s*\\/>`, 'gi'),
			a = new RegExp(`\\r?\\n?\\s*<ProjectReference\\s+Include="${escapeRegex(o)}"\\s*>[\\s\\S]*?<\\/ProjectReference>`, 'gi'),
			c = n;
		((n = n.replace(s, '').replace(a, '')), n !== c && (i = !0));
	}
	return i
		? ((n = n.replace(/\r?\n?\s*<ItemGroup\b[^>]*>\s*<\/ItemGroup>/g, '')),
			{
				xml: n,
				changed: !0,
			})
		: {
				xml: e,
				changed: !1,
			};
}

function containsAnyReference(e, t) {
	let r = /<ProjectReference\s+Include="([^"]+)"/gi,
		n;
	for (; (n = r.exec(e)) !== null;) {
		let i = n[1].toLowerCase();
		for (let o of t) if (i === o.toLowerCase()) return !0;
	}
	return !1;
}

function referenceVariants(e) {
	return new Set([e, e.replace(/\//g, '\\'), e.replace(/\\/g, '/')]);
}

function escapeRegex(e) {
	return e.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isServiceFabricServiceProject(e) {
	return /<IsServiceFabricServiceProject>\s*[Tt]rue\s*<\/IsServiceFabricServiceProject>/.test(e);
}

function extractTargetFramework(e) {
	let t = /<TargetFramework>([^<]+)<\/TargetFramework>/.exec(e);
	if (t) return t[1].trim();
	let r = /<TargetFrameworks>([^<]+)<\/TargetFrameworks>/.exec(e);
	if (r) {
		let n = r[1].split(/[;,]/)[0]?.trim();
		return n || void 0;
	}
}

function compareNetcoreTfm(e, t) {
	let r = /^net(\d+)\.(\d+)$/,
		n = r.exec(e),
		i = r.exec(t);
	if (!n || !i) return;
	let o = parseInt(n[1], 10) * 1e3 + parseInt(n[2], 10),
		s = parseInt(i[1], 10) * 1e3 + parseInt(i[2], 10);
	return o < s ? -1 : o > s ? 1 : 0;
}

export {
	buildLibraryClassStub,
	buildLibraryCsproj,
	compareNetcoreTfm,
	extractTargetFramework,
	isServiceFabricServiceProject,
	patchCsprojAddProjectReference,
	patchCsprojRemoveProjectReference,
};
