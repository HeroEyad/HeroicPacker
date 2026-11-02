export type FrameNaming = Readonly<{
	prefix: string;
	digits: number;
	extension: string;
}>;

const MIN_DIGITS = 4;

export function frameNaming(name: string): FrameNaming {
	const match = name.match(/^(.*?)(\d*)(\.[^./]*)?$/);
	const prefix = match ? match[1] : name;
	const digits = match ? match[2].length : 0;

	return { prefix, digits: Math.max(MIN_DIGITS, digits), extension: match?.[3] ?? "" };
}

export function frameName(naming: FrameNaming, index: number) {
	return naming.prefix + String(index).padStart(naming.digits, "0") + naming.extension;
}

export function moveFrame<T>(sequence: readonly T[], index: number, step: number): T[] {
	const target = index + step;
	const result = [...sequence];
	if (index < 0 || index >= result.length || target < 0 || target >= result.length) return result;

	[result[index], result[target]] = [result[target], result[index]];
	return result;
}

export function holdFrame<T>(sequence: readonly T[], index: number): T[] {
	const result = [...sequence];
	if (index >= 0 && index < result.length) result.splice(index + 1, 0, result[index]);
	return result;
}

export function removeFrame<T>(sequence: readonly T[], index: number): T[] {
	if (sequence.length <= 1) return [...sequence];
	return sequence.filter((_, i) => i !== index);
}

export function replaceInOrder(order: readonly string[], previous: readonly string[], next: readonly string[]) {
	const old = new Set(previous);
	const last = order.reduce((found, name, index) => old.has(name) ? index : found, -1);
	if (last < 0) return [...order];

	const result: string[] = [];
	let placed = 0;

	order.forEach((name, index) => {
		if (!old.has(name)) result.push(name);
		else if (placed < next.length) result.push(next[placed++]);

		if (index === last) {
			while (placed < next.length) result.push(next[placed++]);
		}
	});

	return result;
}
