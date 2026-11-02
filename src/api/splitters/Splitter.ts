import type { Rect } from 'api/types';
import type { AtlasMeta } from 'api/utils/AtlasMeta';

export type SplitterOptions = {
	textureWidth: number,
	textureHeight: number,
	width: number,
	height: number,
	padding: number
}

class Splitter {
	public options: SplitterOptions;

	doCheck(_data: string, cb: (checked: boolean) => void) {
		throw new Error('doCheck not implemented');
	}

	doSplit(_data: string, cb: (res: Rect[] | false) => void) {
		throw new Error('doSplit not implemented');
	}

	readMeta(_data: string): AtlasMeta | null {
		return null;
	}

	cleanData(_data: string) {
		if(!_data) {
			return _data;
		}
		return (_data.startsWith("ï»¿")) ? _data.slice(3) : _data;
	}

	get splitterName() {
		return '!! Default !!';
	}

	static fixFileName(name: string) {
		const validExts = ['png', 'jpg', 'jpeg'];
		const ext = name.split('.').pop().toLowerCase();

		if(validExts.indexOf(ext) < 0) name += '.png';

		return name;
	}

	static readDuration(value: unknown) {
		return typeof value === "number" && isFinite(value) && value >= 0 ? value : undefined;
	}

	get inverseRotation() {
		return false;
	}

	get groupFramesByAnimation() {
		return true;
	}
}

export default Splitter;