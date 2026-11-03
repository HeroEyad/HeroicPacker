export type PrefixGroup = Readonly<{
	key: string;
	prefix: string;
	names: readonly string[];
}>;

export type PrefixClash = Readonly<{
	key: string;
	prefix: string;
	matches: string[];
	safePrefix: string | null;
}>;

export function clashingGroups<T extends PrefixGroup>(group: T, groups: readonly T[]) {
	return groups.filter(other => other !== group && other.names.some(name => name.startsWith(group.prefix)));
}

export function safePrefix(group: PrefixGroup, groups: readonly PrefixGroup[]) {
	const next = new Set(group.names.map(name => name.charAt(group.prefix.length)));
	if (next.size !== 1) return null;

	const [char] = next;
	if (!/\d/.test(char)) return null;

	const candidate = group.prefix + char;
	const clashes = groups.some(other => other !== group && other.names.some(name => name.startsWith(candidate)));
	return clashes ? null : candidate;
}

export function findPrefixClashes(groups: readonly PrefixGroup[]): PrefixClash[] {
	const clashes: PrefixClash[] = [];

	for (const group of groups) {
		const matched = clashingGroups(group, groups);
		if (!matched.length) continue;

		clashes.push({
			key: group.key,
			prefix: group.prefix,
			matches: matched.map(other => other.prefix),
			safePrefix: safePrefix(group, groups)
		});
	}

	return clashes;
}

export function renamedGroup(group: PrefixGroup, prefix: string): PrefixGroup {
	return {
		key: group.key,
		prefix,
		names: group.names.map(name => prefix + name.substring(group.prefix.length))
	};
}

export function renameClashes(group: PrefixGroup, prefix: string, groups: readonly PrefixGroup[]) {
	const renamed = renamedGroup(group, prefix);
	const others = groups.filter(other => other !== group);
	const all = [...others, renamed];

	return clashingGroups(renamed, all).length > 0 || others.some(other => clashingGroups(other, all).includes(renamed));
}
