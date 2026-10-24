"use strict";
/**
 * Pure XML/template helpers for the "Add Library Project" / "Remove Library
 * Project" commands. No `vscode` or `fs` imports so they can be unit-tested
 * under the node test runner.
 *
 * Per Plan §6.1, libraries are NOT added to the `.sfproj`'s `<ProjectReference>`
 * graph — they live as sibling folders next to the `.sfproj` and are referenced
 * from each consuming service's `.csproj`. These templates provide the
 * minimal SDK-style class-library shape and idempotent patchers for adding /
 * removing `<ProjectReference>` rows in consumer csprojs.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildLibraryCsproj = buildLibraryCsproj;
exports.buildLibraryClassStub = buildLibraryClassStub;
exports.patchCsprojAddProjectReference = patchCsprojAddProjectReference;
exports.patchCsprojRemoveProjectReference = patchCsprojRemoveProjectReference;
exports.isServiceFabricServiceProject = isServiceFabricServiceProject;
exports.extractTargetFramework = extractTargetFramework;
exports.compareNetcoreTfm = compareNetcoreTfm;
/**
 * Returns the `<Project Sdk="Microsoft.NET.Sdk">` body for a vanilla class
 * library targeting the requested TFM. Per Plan §6.3, this is intentionally
 * minimal — no `<OutputType>Exe</OutputType>`, no `<RuntimeIdentifier>`, no
 * `<SelfContained>`, no `<IsServiceFabricServiceProject>`, no `PackageRoot/`.
 * A library is a vanilla netcore class library; SF-specific properties would
 * mis-classify it.
 */
function buildLibraryCsproj(t) {
    return `<Project Sdk="Microsoft.NET.Sdk">

  <PropertyGroup>
    <TargetFramework>${t.targetFramework}</TargetFramework>
    <ImplicitUsings>enable</ImplicitUsings>
    <Nullable>enable</Nullable>
  </PropertyGroup>

</Project>
`;
}
/**
 * Returns a one-line `Class1.cs` stub so the project compiles immediately on
 * scaffold. Users delete it as they add real code. The namespace mirrors the
 * library name with non-identifier characters stripped (matching the C# /
 * Roslyn convention for default file-scoped namespaces).
 */
function buildLibraryClassStub(name) {
    const ns = sanitizeNamespace(name);
    return `namespace ${ns};

public class Class1
{
}
`;
}
function sanitizeNamespace(name) {
    return name
        .split('.')
        .map(segment => segment.replace(/[^A-Za-z0-9_]/g, ''))
        .filter(segment => segment.length > 0)
        .map(segment => /^[0-9]/.test(segment) ? `_${segment}` : segment)
        .join('.') || 'Library';
}
/**
 * Adds a `<ProjectReference Include="<relativePath>" />` row to the given
 * csproj XML. Idempotent: if the reference is already present (matching
 * slash direction or case-insensitively), the original xml is returned with
 * `changed: false`.
 *
 * Insertion strategy:
 *   - If an `<ItemGroup>` already contains `<ProjectReference>` items, append
 *     the new line just before the group's closing tag.
 *   - Otherwise, insert a fresh `<ItemGroup>` immediately before `</Project>`.
 */
function patchCsprojAddProjectReference(csprojXml, relativePath) {
    const normalized = relativePath.replace(/\//g, '\\');
    const variants = referenceVariants(relativePath);
    if (containsAnyReference(csprojXml, variants)) {
        return { xml: csprojXml, changed: false };
    }
    const newLine = `    <ProjectReference Include="${normalized}" />`;
    const itemGroupRe = /<ItemGroup\b[^>]*>([\s\S]*?)<\/ItemGroup>/g;
    let match;
    let target = null;
    while ((match = itemGroupRe.exec(csprojXml)) !== null) {
        if (/<ProjectReference\b/.test(match[1])) {
            target = { start: match.index, end: match.index + match[0].length };
            break;
        }
    }
    if (target) {
        const block = csprojXml.slice(target.start, target.end);
        const patched = block.replace(/(\s*<\/ItemGroup>)/, `\n${newLine}$1`);
        return {
            xml: csprojXml.slice(0, target.start) + patched + csprojXml.slice(target.end),
            changed: true
        };
    }
    const newGroup = `\n  <ItemGroup>\n${newLine}\n  </ItemGroup>\n`;
    if (/<\/Project>\s*$/.test(csprojXml)) {
        return {
            xml: csprojXml.replace(/(\s*<\/Project>)/, `${newGroup}$1`),
            changed: true
        };
    }
    return { xml: csprojXml + newGroup, changed: true };
}
/**
 * Removes a `<ProjectReference Include="<relativePath>" />` row from the given
 * csproj XML. Matches both self-closing and open/close forms, slash direction,
 * and case insensitively. If the surrounding `<ItemGroup>` becomes empty
 * (whitespace only) after removal, the entire group is removed too.
 *
 * Idempotent: when the reference is not present, returns `{ changed: false }`
 * with the original xml unmodified.
 */
function patchCsprojRemoveProjectReference(csprojXml, relativePath) {
    const variants = referenceVariants(relativePath);
    let out = csprojXml;
    let changed = false;
    for (const variant of variants) {
        const selfClosing = new RegExp(`\\r?\\n?\\s*<ProjectReference\\s+Include="${escapeRegex(variant)}"\\s*\\/>`, 'gi');
        const openClose = new RegExp(`\\r?\\n?\\s*<ProjectReference\\s+Include="${escapeRegex(variant)}"\\s*>[\\s\\S]*?<\\/ProjectReference>`, 'gi');
        const before = out;
        out = out.replace(selfClosing, '').replace(openClose, '');
        if (out !== before)
            changed = true;
    }
    if (!changed)
        return { xml: csprojXml, changed: false };
    // Collapse any now-empty <ItemGroup>...</ItemGroup>.
    out = out.replace(/\r?\n?\s*<ItemGroup\b[^>]*>\s*<\/ItemGroup>/g, '');
    return { xml: out, changed: true };
}
/**
 * Returns true when the csproj already references a project at any of the
 * supplied path variants (case-insensitive comparison).
 */
function containsAnyReference(csprojXml, variants) {
    const re = /<ProjectReference\s+Include="([^"]+)"/gi;
    let m;
    while ((m = re.exec(csprojXml)) !== null) {
        const found = m[1].toLowerCase();
        for (const v of variants) {
            if (found === v.toLowerCase())
                return true;
        }
    }
    return false;
}
function referenceVariants(relativePath) {
    return new Set([
        relativePath,
        relativePath.replace(/\//g, '\\'),
        relativePath.replace(/\\/g, '/')
    ]);
}
function escapeRegex(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
/**
 * Returns true when the csproj is a Service Fabric service project (i.e. has
 * `<IsServiceFabricServiceProject>True</IsServiceFabricServiceProject>` in any
 * `<PropertyGroup>`). Used by the library commands to filter service vs
 * library candidates — Plan §6.5.
 */
function isServiceFabricServiceProject(csprojXml) {
    return /<IsServiceFabricServiceProject>\s*[Tt]rue\s*<\/IsServiceFabricServiceProject>/.test(csprojXml);
}
/**
 * Extracts the `<TargetFramework>` (or first entry of `<TargetFrameworks>`)
 * from a csproj. Returns `undefined` when neither is present. Used to
 * determine the workspace-minimum TFM for the Add Library Project picker.
 */
function extractTargetFramework(csprojXml) {
    const single = /<TargetFramework>([^<]+)<\/TargetFramework>/.exec(csprojXml);
    if (single)
        return single[1].trim();
    const multi = /<TargetFrameworks>([^<]+)<\/TargetFrameworks>/.exec(csprojXml);
    if (multi) {
        const first = multi[1].split(/[;,]/)[0]?.trim();
        return first ? first : undefined;
    }
    return undefined;
}
/**
 * Compares two TFMs of the form `netN.M`. Returns -1 / 0 / 1 like
 * `Array.prototype.sort`. Non-`netN.M` TFMs (e.g. `net472`) compare as
 * `undefined` and are treated as incomparable; callers should fall back to
 * the picker default (`net10.0`).
 */
function compareNetcoreTfm(a, b) {
    const re = /^net(\d+)\.(\d+)$/;
    const ma = re.exec(a);
    const mb = re.exec(b);
    if (!ma || !mb)
        return undefined;
    const av = parseInt(ma[1], 10) * 1000 + parseInt(ma[2], 10);
    const bv = parseInt(mb[1], 10) * 1000 + parseInt(mb[2], 10);
    return av < bv ? -1 : av > bv ? 1 : 0;
}
//# sourceMappingURL=addLibraryTemplates.js.map