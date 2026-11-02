import type { Language } from './languages';

interface I18Config {
	currentLanguage: Language;
	supportedLanguages: string[];
	strings: Record<string, string>;
}

class I18 {
	private static config: I18Config = {
		currentLanguage: {
			lang: "null",
			name: "None",
			mapping: {}
		},
		supportedLanguages: ["en"],
		strings: {},
	};

	static get currentLanguage(): Language {
		return this.config.currentLanguage;
	}

	static set currentLanguage(val: Language) {
		this.config.currentLanguage = val;
	}

	static get supportedLanguages(): string[] {
		return this.config.supportedLanguages;
	}

	static set supportedLanguages(val: string[]) {
		this.config.supportedLanguages = val;
	}

	static get strings(): Record<string, string> {
		return this.config.strings;
	}

	static set strings(val: Record<string, string>) {
		this.config.strings = val;
	}

	static load(callback: () => void) {
		this.setup(this.currentLanguage.mapping);
		if (callback) callback();
	}

	private static setup(data: Record<string, string>): void {
		this.strings = data;
	}

	static getString(key: string, values?: string[] | null): string {
		if (!values)
			values = null;

		const str = this.getStringOrNull(key, values);
		if (str === null) return `{${key}}`;

		return str;
	}

	private static getStringOrNull(key: string, args: string[] | null): string | null {
		if (!args) return null;

		let value = this.config.strings[key];
		if (!value) return null;

		args = [value].concat(args);
		return this.sprintf(...args);
	}

	static f(key: string, ...values: string[]): string {
		return this.getString(key, values);
	}

	private static regex = /%%|%(\d+\$)?([-+\'#0 ]*)(\*\d+\$|\*|\d+)?(\.(\*\d+\$|\*|\d+))?([scboxXuideEfFgG])/g;

	static sprintf(...values: string[]): string {
		let i = 0;
		const format = values[i++];

		const pad = (str: string, len: number, chr: string = ' ', leftJustify: boolean): string => {
			const padding = str.length >= len ? '' : new Array(1 + len - str.length >>> 0).join(chr);
			return leftJustify ? str + padding : padding + str;
		};

		const justify = (value: string, prefix: string, leftJustify: boolean, minWidth: number, zeroPad: boolean, customPadChar: string): string => {
			const diff = minWidth - value.length;
			if (diff > 0) {
				if (leftJustify || !zeroPad) value = pad(value, minWidth, customPadChar, leftJustify);
				else value = value.slice(0, prefix.length) + pad('', diff, '0', true) + value.slice(prefix.length);
			}
			return value;
		};

		const formatBaseX = (num: number, base: number, prefix: boolean, leftJustify: boolean, minWidth: number, precision: number | null, zeroPad: boolean, customPadChar: string): string => {
			const prefixStr = prefix && num && { '2': '0b', '8': '0', '16': '0x' }[base] || '';
			const formattedValue = prefixStr + pad(num.toString(base), precision || 0, '0', false);
			return justify(formattedValue, prefixStr, leftJustify, minWidth, zeroPad, customPadChar);
		};

		const formatString = (value: string, leftJustify: boolean, minWidth: number, precision: number | null, zeroPad: boolean, customPadChar: string): string => {
			if (precision != null)
				value = value.slice(0, precision);
			return justify(value, '', leftJustify, minWidth, zeroPad, customPadChar);
		};

		const doFormat = (substring: string, valueIndex: string, flags: string, minWidth: string, _: string, prec: string, type: string): string => {
			if (substring === '%%') return '%';

			let leftJustify = false;
			let positivePrefix = '';
			let zeroPad = false;
			let prefixBaseX = false;
			let customPadChar = ' ';
			for (const flag of flags) {
				switch (flag) {
					case ' ':
						positivePrefix = ' ';
						break;
					case '+':
						positivePrefix = '+';
						break;
					case '-':
						leftJustify = true;
						break;
					case "'":
						customPadChar = flag;
						break;
					case '0':
						zeroPad = true;
						customPadChar = '0';
						break;
					case '#':
						prefixBaseX = true;
						break;
				}
			}

			let minimumWidth = 0;

			if (!minWidth) minimumWidth = 0;
			else if (minWidth === '*') minimumWidth = +values[i++];
			else if (minWidth.charAt(0) === '*') minimumWidth = +values[+minWidth.slice(1, -1)];
			else minimumWidth = +minWidth;

			if (minimumWidth < 0) {
				minimumWidth = -minimumWidth;
				leftJustify = true;
			}

			if (!isFinite(minimumWidth)) {
				throw new Error('sprintf: (minimum-)width must be finite');
			}

			let precision:number | null = 0;

			if (!prec) precision = 'fFeE'.includes(type) ? 6 : type === 'd' ? 0 : null;
			else if (prec === '*') precision = +values[i++];
			else if (prec.charAt(0) === '*') precision = +values[+prec.slice(1, -1)];
			else precision = +prec;

			if(precision === null) precision = 0;

			let value = valueIndex ? values[+valueIndex.slice(0, -1) - 1] : values[i++];
			let number = +value || 0;

			const prefix = number < 0 ? '-' : positivePrefix;

			switch (type) {
				case 's':
					return formatString(String(value), leftJustify, minimumWidth, prec ? precision : null, zeroPad, customPadChar);
				case 'c':
					return formatString(String.fromCharCode(+value), leftJustify, minimumWidth, prec ? precision : null, zeroPad, customPadChar);
				case 'b':
					return formatBaseX(number, 2, prefixBaseX, leftJustify, minimumWidth, precision, zeroPad, customPadChar);
				case 'o':
					return formatBaseX(number, 8, prefixBaseX, leftJustify, minimumWidth, precision, zeroPad, customPadChar);
				case 'x':
					return formatBaseX(number, 16, prefixBaseX, leftJustify, minimumWidth, precision, zeroPad, customPadChar);
				case 'X':
					return formatBaseX(number, 16, prefixBaseX, leftJustify, minimumWidth, precision, zeroPad, customPadChar).toUpperCase();
				case 'u':
					return formatBaseX(number, 10, prefixBaseX, leftJustify, minimumWidth, precision, zeroPad, customPadChar);
				case 'i':
				case 'd':
					number = Math.round(number - number % 1);
					const absValue = Math.abs(number).toString();
					value = prefix + pad(absValue, precision, '0', false);
					return justify(value, prefix, leftJustify, minimumWidth, zeroPad, customPadChar);
				case 'e':
				case 'E':
				case 'f':
				case 'F':
				case 'g':
				case 'G':
					type Method = 'toExponential' | 'toFixed' | 'toPrecision';
					type Transform = 'toString' | 'toUpperCase';

					let method = (['toExponential', 'toFixed', 'toPrecision'] as Method[])['efg'.indexOf(type.toLowerCase())];
					let textTransform = (['toString', 'toUpperCase'] as Transform[])['eEfFgG'.indexOf(type) % 2];
					value = prefix + Math.abs(number)[method](precision);
					return justify(value, prefix, leftJustify, minimumWidth, zeroPad, customPadChar)[textTransform]();
				default:
					return substring;
			}
		};

		return format.replace(I18.regex, doFormat);
	}
}

export default I18;
