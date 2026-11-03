export type NoteSkinProfile = "psych" | "vslice";

export type NotePart = "note" | "holdPiece" | "holdEnd" | "static" | "press" | "confirm";

export const NOTE_DIRECTIONS = ["left", "down", "up", "right"] as const;

export type NoteDirection = typeof NOTE_DIRECTIONS[number];

export type NoteSkinCell = Readonly<{
	direction: NoteDirection;
	part: NotePart;
	prefixes: readonly string[];
	prefix: string | null;
	frames: readonly string[];
	extra: readonly string[];
}>;

type Requirement = Readonly<{
	part: NotePart;
	prefixes: (index: number) => string[];
}>;

const COLORS = ["purple", "blue", "green", "red"] as const;

const capitalized = (index: number) => NOTE_DIRECTIONS[index].charAt(0).toUpperCase() + NOTE_DIRECTIONS[index].slice(1);

const PSYCH: ReadonlyArray<Requirement> = [
	{ part: "note", prefixes: i => [COLORS[i] + "0"] },
	{ part: "holdPiece", prefixes: i => [COLORS[i] + " hold piece"] },
	{ part: "holdEnd", prefixes: i => i === 0 ? ["purple hold end", "pruple end hold"] : [COLORS[i] + " hold end"] },
	{ part: "static", prefixes: i => ["arrow" + NOTE_DIRECTIONS[i].toUpperCase()] },
	{ part: "press", prefixes: i => [NOTE_DIRECTIONS[i] + " press"] },
	{ part: "confirm", prefixes: i => [NOTE_DIRECTIONS[i] + " confirm"] }
];

const VSLICE: ReadonlyArray<Requirement> = [
	{ part: "note", prefixes: i => ["note" + capitalized(i)] },
	{ part: "static", prefixes: i => ["static" + capitalized(i) + "0"] },
	{ part: "press", prefixes: i => ["press" + capitalized(i) + "0"] },
	{ part: "confirm", prefixes: i => ["confirm" + capitalized(i) + "0"] }
];

export function noteSkinParts(profile: NoteSkinProfile): NotePart[] {
	return (profile === "vslice" ? VSLICE : PSYCH).map(requirement => requirement.part);
}

function stripDigits(name: string) {
	return name.replace(/\d+$/, "");
}

function checkCell(direction: number, requirement: Requirement, names: readonly string[]): NoteSkinCell {
	const prefixes = requirement.prefixes(direction);
	let prefix: string | null = null;
	let frames: string[] = [];

	for (const candidate of prefixes) {
		const matched = names.filter(name => name.startsWith(candidate));
		if (matched.length) {
			prefix = candidate;
			frames = matched;
			break;
		}
	}

	const own = prefix === null ? "" : stripDigits(prefix);
	const extra = [...new Set(frames.map(stripDigits))].filter(key => key !== own);

	return { direction: NOTE_DIRECTIONS[direction], part: requirement.part, prefixes, prefix, frames, extra };
}

export function checkNoteSkin(profile: NoteSkinProfile, names: readonly string[]): NoteSkinCell[][] {
	const requirements = profile === "vslice" ? VSLICE : PSYCH;
	return NOTE_DIRECTIONS.map((_, index) => requirements.map(requirement => checkCell(index, requirement, names)));
}
