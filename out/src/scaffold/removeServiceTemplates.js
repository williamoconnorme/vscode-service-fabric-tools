"use strict";
/**
 * Pure XML helpers for the "Remove Service" command.
 *
 * Operates on the raw XML text to preserve the rest of the manifest's
 * formatting and comments. No `vscode` or `fs` imports — kept testable
 * under the node runner.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.patchApplicationManifestForRemove = patchApplicationManifestForRemove;
exports.patchApplicationParametersForRemove = patchApplicationParametersForRemove;
exports.patchStartupServicesXmlForRemove = patchStartupServicesXmlForRemove;
exports.extractServiceTypeNames = extractServiceTypeNames;
exports.patchSfprojRemoveProjectReference = patchSfprojRemoveProjectReference;
/**
 * Removes the `<ServiceManifestImport>` and any `<Service>` blocks tied to the
 * given package, then drops orphaned `<Parameter>` declarations whose names
 * are no longer referenced anywhere in the manifest.
 */
function patchApplicationManifestForRemove(xml, packageName, serviceTypeNames) {
    let out = xml;
    // 1. Drop the matching <ServiceManifestImport> block.
    let removedImport = false;
    const removedImportBodies = [];
    out = out.replace(/\r?\n?\s*<ServiceManifestImport\b[^>]*>[\s\S]*?<\/ServiceManifestImport>/g, block => {
        if (new RegExp(`ServiceManifestName="${escapeRegex(packageName)}"`).test(block)) {
            removedImport = true;
            removedImportBodies.push(block);
            return '';
        }
        return block;
    });
    // 2. Drop matching <Service> blocks, capturing their bodies for parameter analysis.
    const removedServiceBodies = [];
    out = out.replace(/\r?\n?\s*<Service\b[^>]*>[\s\S]*?<\/Service>/g, block => {
        const matched = [...serviceTypeNames].some(t => new RegExp(`ServiceTypeName="${escapeRegex(t)}"`).test(block));
        if (matched) {
            removedServiceBodies.push(block);
            return '';
        }
        return block;
    });
    // 3. Collect parameter references inside removed services AND removed imports
    //    (ASP.NET kinds reference `[<Folder>_ASPNETCORE_ENVIRONMENT]` only from
    //    the import's <EnvironmentOverrides>).
    const referenced = new Set();
    for (const body of [...removedServiceBodies, ...removedImportBodies]) {
        const matches = body.matchAll(/\[([A-Za-z_][A-Za-z0-9_.-]*)\]/g);
        for (const m of matches)
            referenced.add(m[1]);
    }
    // 4. Remove parameter declarations that are no longer referenced anywhere else.
    const removedParameters = [];
    for (const name of referenced) {
        const stillUsed = new RegExp(`\\[${escapeRegex(name)}\\]`).test(out);
        if (stillUsed)
            continue;
        const declPattern = new RegExp(`\\r?\\n?\\s*<Parameter\\s+Name="${escapeRegex(name)}"[^>]*\\/>`, 'g');
        const before = out;
        out = out.replace(declPattern, '');
        if (out !== before)
            removedParameters.push(name);
    }
    // 5. Collapse a now-empty <Parameters></Parameters> to a self-closing tag.
    out = out.replace(/<Parameters>\s*<\/Parameters>/g, '<Parameters />');
    out = out.replace(/<DefaultServices>\s*<\/DefaultServices>/g, '<DefaultServices />');
    return {
        xml: out,
        removedParameters,
        removedServiceBlocks: removedServiceBodies.length,
        removedImport
    };
}
/**
 * Drops `<Parameter Name="..." Value="..."/>` lines for the given names from a
 * per-environment ApplicationParameters file.
 */
function patchApplicationParametersForRemove(xml, parameterNames) {
    if (parameterNames.length === 0)
        return xml;
    let out = xml;
    for (const name of parameterNames) {
        const pattern = new RegExp(`\\r?\\n?\\s*<Parameter\\s+Name="${escapeRegex(name)}"[^>]*\\/>`, 'g');
        out = out.replace(pattern, '');
    }
    out = out.replace(/<Parameters>\s*<\/Parameters>/g, '<Parameters />');
    return out;
}
/**
 * Removes `<Service>` blocks tied to the given service-type names from a
 * `StartupServices.xml` file, then drops orphaned `<Parameter>` declarations
 * whose names are no longer referenced anywhere in the file.
 *
 * StartupServices.xml has the same `<Service>` block shape as
 * ApplicationManifest.xml's `<DefaultServices>` (the VS scaffold writes either
 * one depending on which file is present), so the matching logic mirrors
 * {@link patchApplicationManifestForRemove} minus the import-removal step
 * (StartupServices.xml has no `<ServiceManifestImport>` blocks).
 */
function patchStartupServicesXmlForRemove(xml, serviceTypeNames) {
    let out = xml;
    // 1. Drop matching <Service> blocks, capturing their bodies for parameter analysis.
    const removedServiceBodies = [];
    out = out.replace(/\r?\n?\s*<Service\b[^>]*>[\s\S]*?<\/Service>/g, block => {
        const matched = [...serviceTypeNames].some(t => new RegExp(`ServiceTypeName="${escapeRegex(t)}"`).test(block));
        if (matched) {
            removedServiceBodies.push(block);
            return '';
        }
        return block;
    });
    // 2. Collect parameter references inside removed services.
    const referenced = new Set();
    for (const body of removedServiceBodies) {
        const matches = body.matchAll(/\[([A-Za-z_][A-Za-z0-9_.-]*)\]/g);
        for (const m of matches)
            referenced.add(m[1]);
    }
    // 3. Remove parameter declarations no longer referenced anywhere else.
    const removedParameters = [];
    for (const name of referenced) {
        const stillUsed = new RegExp(`\\[${escapeRegex(name)}\\]`).test(out);
        if (stillUsed)
            continue;
        const declPattern = new RegExp(`\\r?\\n?\\s*<Parameter\\s+Name="${escapeRegex(name)}"[^>]*\\/>`, 'g');
        const before = out;
        out = out.replace(declPattern, '');
        if (out !== before)
            removedParameters.push(name);
    }
    // 4. Collapse now-empty <Parameters></Parameters> and <Services></Services>.
    out = out.replace(/<Parameters>\s*<\/Parameters>/g, '<Parameters />');
    out = out.replace(/<Services>\s*<\/Services>/g, '<Services />');
    return {
        xml: out,
        removedParameters,
        removedServiceBlocks: removedServiceBodies.length
    };
}
/**
 * Extracts every `ServiceTypeName="..."` declaration from a ServiceManifest.xml body.
 * Handles all four kinds (Stateless / Stateful / Container / Guest).
 */
function extractServiceTypeNames(serviceManifestXml) {
    const names = new Set();
    const pattern = /<(?:[A-Za-z]+ServiceType|ServiceType)\s+[^>]*?ServiceTypeName="([^"]+)"/g;
    for (const m of serviceManifestXml.matchAll(pattern))
        names.add(m[1]);
    return [...names];
}
/**
 * Removes a `<ProjectReference Include="..." />` line from a `.sfproj`,
 * matching slash direction and case insensitively. If the surrounding
 * `<ItemGroup>` becomes empty (only whitespace), the entire group is removed.
 *
 * Returns the patched XML and a flag indicating whether anything changed.
 */
function patchSfprojRemoveProjectReference(xml, csprojRelativePath) {
    const variants = new Set([
        csprojRelativePath,
        csprojRelativePath.replace(/\//g, '\\'),
        csprojRelativePath.replace(/\\/g, '/')
    ]);
    let out = xml;
    let removed = false;
    for (const variant of variants) {
        // Self-closing form: <ProjectReference Include="..." />
        const selfClosing = new RegExp(`\\r?\\n?\\s*<ProjectReference\\s+Include="${escapeRegex(variant)}"\\s*\\/>`, 'gi');
        // Open/close form (e.g. ASP.NET kinds with a <ServiceLaunchUrl> child):
        //   <ProjectReference Include="...">
        //     <ServiceLaunchUrl>...</ServiceLaunchUrl>
        //   </ProjectReference>
        const openClose = new RegExp(`\\r?\\n?\\s*<ProjectReference\\s+Include="${escapeRegex(variant)}"\\s*>[\\s\\S]*?<\\/ProjectReference>`, 'gi');
        const before = out;
        out = out.replace(selfClosing, '').replace(openClose, '');
        if (out !== before)
            removed = true;
    }
    if (!removed)
        return { xml, removed: false };
    // Collapse any now-empty <ItemGroup>...</ItemGroup>.
    out = out.replace(/\r?\n?\s*<ItemGroup\b[^>]*>\s*<\/ItemGroup>/g, '');
    return { xml: out, removed: true };
}
function escapeRegex(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
//# sourceMappingURL=removeServiceTemplates.js.map