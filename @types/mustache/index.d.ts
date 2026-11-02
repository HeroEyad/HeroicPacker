declare module 'mustache' {
	export default Mustache;
}

declare namespace Mustache {
	const name: string;

	const version: string;

	let tags: OpeningAndClosingTags;

	let templateCache: TemplateCache | undefined;

	class Scanner {
		string: string;
		tail: string;
		pos: number;

		constructor(string: string);

		eos(): boolean;

		scan(re: RegExp): string;

		scanUntil(re: RegExp): string;
	}

	class Context {
		view: any;
		parent: Context | undefined;

		constructor(view: any, parentContext?: Context);

		push(view: any): Context;

		lookup(name: string): any;
	}

	class Writer {
		constructor();

		clearCache(): void;

		parse(template: string, tags?: OpeningAndClosingTags): any;

		render(
			template: string,
			view: any | Context,
			partials?: PartialsOrLookupFn,
			config?: OpeningAndClosingTags | RenderOptions,
		): string;

		renderTokens(
			tokens: string[][],
			context: Context,
			partials?: PartialsOrLookupFn,
			originalTemplate?: string,
			config?: RenderOptions,
		): string;

		renderSection(
			token: string[],
			context: Context,
			partials?: PartialsOrLookupFn,
			originalTemplate?: string,
			config?: RenderOptions,
		): string;

		renderInverted(
			token: string[],
			context: Context,
			partials?: PartialsOrLookupFn,
			originalTemplate?: string,
			config?: RenderOptions,
		): string;

		indentPartial(partial: string, indentation: string, lineHasNonSpace: boolean): string;

		renderPartial(
			token: string[],
			context: Context,
			partials?: PartialsOrLookupFn,
			config?: OpeningAndClosingTags | RenderOptions,
		): string;

		unescapedValue(token: string[], context: Context): string;

		escapedValue(
			token: string[],
			context: Context,
			config?: RenderOptions,
		): string;

		rawValue(token: string[]): string;
	}

	let escape: EscapeFunction;

	function clearCache(): void;

	function parse(template: string, tags?: OpeningAndClosingTags): TemplateSpans;

	function render(
		template: string,
		view: any | Context,
		partials?: PartialsOrLookupFn,
		tagsOrOptions?: OpeningAndClosingTags | RenderOptions,
	): string;

	type RAW_VALUE = "text";
	type ESCAPED_VALUE = "name";
	type UNESCAPED_VALUE = "&";
	type SECTION = "#";
	type INVERTED = "^";
	type COMMENT = "!";
	type PARTIAL = ">";
	type EQUAL = "=";

	type TemplateSpanType =
		| RAW_VALUE
		| ESCAPED_VALUE
		| SECTION
		| UNESCAPED_VALUE
		| INVERTED
		| COMMENT
		| PARTIAL
		| EQUAL;

	type TemplateSpans = Array<
		| [TemplateSpanType, string, number, number]
		| [TemplateSpanType, string, number, number, TemplateSpans, number]
		| [TemplateSpanType, string, number, number, string, number, boolean]
	>;

	type EscapeFunction = (value: any) => string;

	type OpeningAndClosingTags = [string, string];

	type PartialsOrLookupFn = Record<string, string> | PartialLookupFn;
	type PartialLookupFn = (partialName: string) => string | undefined;

	interface RenderOptions {
		escape?: EscapeFunction | undefined;
		tags?: OpeningAndClosingTags | undefined;
	}

	interface TemplateCache {
		set(cacheKey: string, value: string): void;
		get(cacheKey: string): string | undefined;
		clear(): void;
	}
}