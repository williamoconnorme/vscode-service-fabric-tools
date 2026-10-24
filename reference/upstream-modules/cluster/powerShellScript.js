"use strict";
/**
 * Pure helpers for assembling PowerShell command strings safely. Lives in its
 * own module (no `vscode` imports) so it can be unit-tested under `tsx`.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildScriptWithParameters = buildScriptWithParameters;
/**
 * Produce the final PowerShell command by prepending `$Name = <literal>`
 * declarations to the user's script body. The executable is later invoked via
 * `powershell -Command <result>`, which does NOT bind trailing `-Name Value`
 * arguments into variables, so this prepend approach is the correct way to
 * make values available as `$Name` references inside the script.
 *
 *  - Strings → wrapped in single quotes with `'` doubled to `''`. Single
 *    quoting suppresses `$variable` and backtick interpolation, so the value
 *    is treated as a literal even if it contains workspace-derived text.
 *  - Booleans → `$true` / `$false`.
 *  - Finite numbers → emitted verbatim.
 *  - `undefined` → skipped (the caller's `if ($Foo) { ... }` blocks are
 *    expected to handle the missing case).
 *
 * Parameter names are validated against `^[A-Za-z_][A-Za-z0-9_]*$` to avoid
 * accidental injection through a non-identifier key.
 */
function buildScriptWithParameters(script, parameters) {
    const declarations = [];
    for (const [k, v] of Object.entries(parameters)) {
        if (v === undefined)
            continue;
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(k)) {
            throw new Error(`Invalid PowerShell parameter name: ${k}`);
        }
        declarations.push(`$${k} = ${literal(v)}`);
    }
    if (declarations.length === 0)
        return script;
    return declarations.join('\n') + '\n' + script;
}
function literal(v) {
    if (typeof v === 'boolean')
        return v ? '$true' : '$false';
    if (typeof v === 'number' && Number.isFinite(v))
        return String(v);
    const s = typeof v === 'string' ? v : String(v);
    return `'${s.replace(/'/g, "''")}'`;
}
//# sourceMappingURL=powerShellScript.js.map