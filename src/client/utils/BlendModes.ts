import type * as React from 'react';

type MixBlendMode = NonNullable<React.CSSProperties["mixBlendMode"]>;
export const BLEND_MODES: ReadonlyArray<Readonly<{ name: string, css: MixBlendMode }>> = [
	{ name: "normal", css: "normal" },
	{ name: "add", css: "plus-lighter" },
	{ name: "multiply", css: "multiply" },
	{ name: "screen", css: "screen" },
	{ name: "overlay", css: "overlay" },
	{ name: "lighten", css: "lighten" },
	{ name: "darken", css: "darken" },
	{ name: "difference", css: "difference" },
	{ name: "hardlight", css: "hard-light" }
];

export function isBlendMode(name: string | undefined) {
	return BLEND_MODES.some(mode => mode.name === name);
}

export function blendModeCss(name: string | undefined): MixBlendMode {
	return BLEND_MODES.find(mode => mode.name === name)?.css ?? "normal";
}
