import Storage from './Storage';

export type ThemeChoice = "system" | "light" | "dark";

const STORAGE_KEY = "theme";
const CHOICES: ReadonlyArray<ThemeChoice> = ["system", "light", "dark"];

const darkQuery = typeof globalThis.matchMedia === "function" ? globalThis.matchMedia("(prefers-color-scheme: dark)") : null;

let current: ThemeChoice = "system";

function isChoice(value: unknown): value is ThemeChoice {
	return CHOICES.includes(value as ThemeChoice);
}

function apply() {
	const dark = current === "dark" || (current === "system" && Boolean(darkQuery?.matches));
	document.documentElement.dataset.theme = dark ? "dark" : "light";
}

class Theme {
	static readonly choices = CHOICES;

	static init() {
		try {
			const stored = Storage.load(STORAGE_KEY, false);
			if (isChoice(stored)) current = stored;
		}
		catch (e) {
			current = "system";
		}

		apply();
		darkQuery?.addEventListener("change", apply);
	}

	static get choice() {
		return current;
	}

	static set(choice: ThemeChoice) {
		current = isChoice(choice) ? choice : "system";
		apply();

		try {
			Storage.save(STORAGE_KEY, current);
		}
		catch (e) {
			console.warn("The theme could not be saved", e);
		}
	}
}

export default Theme;
