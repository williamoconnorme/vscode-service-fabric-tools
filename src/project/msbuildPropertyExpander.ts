/**
 * Pure MSBuild $(Property) expander for .sfproj `<PropertyGroup>` scalars.
 *
 * Tier 1 of the package-root resolution chain (Plan 1.1.9). Handles the
 * common shapes seen in real-world .sfproj files:
 *
 *   <OutputPath>$(MSBuildProjectDirectory)\out\$(Configuration)\</OutputPath>
 *   <PackageLocation>$(BuildOutputPath)\bin\$(MSBuildProjectName)\$(Configuration)\</PackageLocation>
 *
 * Does NOT handle: item refs (@(X)), metadata (%(X)), functions
 * ($([System.IO.Path]::Combine(...))), Choose/When/Otherwise, target
 * execution, or properties defined exclusively in imported targets files.
 * Those cases are the responsibility of Tier 2 (MSBuild -getProperty).
 *
 * Pure: no `vscode` / `fs` / `child_process` imports.
 */

/** A single scalar child of a `<PropertyGroup>`. */
export interface RawProperty {
	name: string;
	value: string;
}

/** One `<PropertyGroup>` block: its verbatim Condition attribute and scalar children. */
export interface RawPropertyGroup {
	condition?: string;
	properties: RawProperty[];
}

export interface BuildPropertyMapInput {
	propertyGroups: RawPropertyGroup[];
	intrinsics: ReadonlyMap<string, string>;
	configuration: string;
	/** Defaults to `AnyCPU`. */
	platform?: string;
}

export interface ExpandResult {
	value: string;
	/** Distinct `$(Name)` tokens that remained after expansion. */
	unresolved: string[];
}

export interface ExpandOptions {
	/** Defaults to 16. */
	maxIterations?: number;
}

export type ConditionVerdict = boolean | 'unevaluable';

const TOKEN_RE = /\$\(([A-Za-z_][A-Za-z0-9_]*)\)/g;

/**
 * Build the effective property map by walking PropertyGroup blocks in source
 * order, skipping conditional groups whose condition does not evaluate to true
 * against the properties known so far. Intrinsics + Configuration + Platform
 * are seeded first so they're visible to every group's condition.
 */
export function buildPropertyMap(input: BuildPropertyMapInput): Map<string, string> {
	const map = new Map<string, string>();
	for (const [k, v] of input.intrinsics) map.set(k, v);
	map.set('Configuration', input.configuration);
	map.set('Platform', input.platform ?? 'AnyCPU');
	for (const pg of input.propertyGroups) {
		if (pg.condition !== undefined) {
			const verdict = evaluateSimpleCondition(pg.condition, map);
			if (verdict !== true) continue; // false OR unevaluable → skip
		}
		for (const { name, value } of pg.properties) {
			// Property values can themselves reference earlier properties;
			// expand them as we set so downstream lookups see resolved text.
			map.set(name, expandMsbuildValue(value, map).value);
		}
	}
	return map;
}

/**
 * Iteratively expand $(Name) tokens against `properties`. Bounded by
 * `maxIterations` (default 16) to defeat pathological cycles. Returns the
 * distinct unresolved tokens so callers can log a single actionable line.
 */
export function expandMsbuildValue(value: string, properties: ReadonlyMap<string, string>, opts: ExpandOptions = {}): ExpandResult {
	const max = opts.maxIterations ?? 16;
	let current = value;
	for (let i = 0; i < max; i++) {
		let changed = false;
		const next = current.replace(TOKEN_RE, (match: string, name: string) => {
			const v = properties.get(name);
			if (v === undefined) return match;
			changed = true;
			return v;
		});
		if (!changed) break;
		current = next;
	}
	const unresolved = new Set<string>();
	for (const m of current.matchAll(TOKEN_RE)) unresolved.add(m[1]);
	return { value: current, unresolved: [...unresolved] };
}

/**
 * Evaluate the subset of MSBuild Condition expressions we support:
 *   '<lhs>' == '<rhs>'
 *   '<lhs>' != '<rhs>'
 * where each side may be a literal or a $(Property) ref. Both sides are
 * expanded against `properties` before comparison; comparison is
 * case-insensitive (MSBuild semantics for `==`/`!=`).
 *
 * Returns:
 *   true  → group should be applied
 *   false → group should be skipped (condition is well-formed and false)
 *   'unevaluable' → unsupported syntax; caller should skip + log debug
 */
export function evaluateSimpleCondition(condition: string, properties: ReadonlyMap<string, string>): ConditionVerdict {
	const trimmed = condition.trim();
	const m = /^'([^']*)'\s*(==|!=)\s*'([^']*)'$/.exec(trimmed);
	if (!m) return 'unevaluable';
	const lhs = expandMsbuildValue(m[1], properties).value.toLowerCase();
	const rhs = expandMsbuildValue(m[3], properties).value.toLowerCase();
	return m[2] === '==' ? lhs === rhs : lhs !== rhs;
}

/**
 * Convenience for callers that already have the expanded property map and
 * want a one-shot expander callback to hand to `collectPackageRootCandidates`.
 */
export function makeExpander(properties: ReadonlyMap<string, string>): (value: string) => ExpandResult {
	return (value) => expandMsbuildValue(value, properties);
}
