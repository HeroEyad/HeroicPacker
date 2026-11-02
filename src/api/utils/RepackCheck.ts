export type PlacedAlpha = Readonly<{
	left: number;
	top: number;
	width: number;
	height: number;
	alpha: Uint8Array;
}>;

export function placeAlpha(rgba: ArrayLike<number>, width: number, height: number, x: number, y: number, threshold: number): PlacedAlpha | null {
	let left = width, top = height, right = -1, bottom = -1;

	for (let j = 0; j < height; j++) {
		for (let i = 0; i < width; i++) {
			if (rgba[(j * width + i) * 4 + 3] <= threshold) continue;

			if (i < left) left = i;
			if (i > right) right = i;
			if (j < top) top = j;
			if (j > bottom) bottom = j;
		}
	}

	if (right < 0) return null;

	const boxWidth = right - left + 1;
	const boxHeight = bottom - top + 1;
	const alpha = new Uint8Array(boxWidth * boxHeight);

	for (let j = 0; j < boxHeight; j++) {
		for (let i = 0; i < boxWidth; i++) {
			const value = rgba[((top + j) * width + left + i) * 4 + 3];
			alpha[j * boxWidth + i] = value > threshold ? value : 0;
		}
	}

	return { left: left + x, top: top + y, width: boxWidth, height: boxHeight, alpha };
}

export function samePlacement(a: PlacedAlpha | null, b: PlacedAlpha | null) {
	if (a === null || b === null) return a === b;
	if (a.left !== b.left || a.top !== b.top || a.width !== b.width || a.height !== b.height) return false;

	for (let i = 0; i < a.alpha.length; i++) {
		if (a.alpha[i] !== b.alpha[i]) return false;
	}

	return true;
}
