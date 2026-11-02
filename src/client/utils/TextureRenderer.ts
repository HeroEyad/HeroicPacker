import { GLOBAL_EVENT, Observer } from "../Observer";
import TypedObserver from "TypedObserver";
import type { PackOptions, Rect } from "api/types";
import I18 from "../locale/I18";
import { getSheetSize } from "api/utils/Frames";

class TextureRenderer {
	readonly buffer: HTMLCanvasElement;
	width: number;
	height: number;

	constructor(data:Rect[], options={}) {
		this.buffer = document.createElement("canvas");

		this.width = 0;
		this.height = 0;

		this.render(data, options);
	}

	render(data:Rect[], options:PackOptions={}) {
		const ctx = this.buffer.getContext("2d");

		if(!ctx) {
			Observer.emit(GLOBAL_EVENT.HIDE_PROCESSING);
			TypedObserver.showMessage.emit(I18.f('ERROR_NO_CONTEXT'));

			return;
		}

		if(PROFILER)
			console.time("render");

		const { width, height } = getSheetSize(data, options);

		this.width = width;
		this.height = height;
		this.buffer.width = width;
		this.buffer.height = height;

		ctx.clearRect(0, 0, width, height);

		for(let item of data) {
			this.renderItem(ctx, item, options);
		}

		if(PROFILER)
			console.timeEnd("render");
	}

	getBuffer() {
		return this.buffer;
	}

	private renderItem(ctx: CanvasRenderingContext2D, item: Rect, _options: PackOptions) {
		if(item.skipRender) return;

		const img = item.image;
		const source = item.renderSource;
		if(!source && !img) return;

		const drawable = source || img.image;
		const sx = source ? 0 : item.spriteSourceSize.x;
		const sy = source ? 0 : item.spriteSourceSize.y;
		const sw = source ? source.width : item.spriteSourceSize.w;
		const sh = source ? source.height : item.spriteSourceSize.h;

		if (item.rotated) {
			ctx.save();
			ctx.translate(item.frame.x + item.frame.h, item.frame.y);

			ctx.rotate(Math.PI / 2);

			ctx.drawImage(
				drawable,
				sx, sy,
				sw, sh,
				0, 0,
				item.frame.w, item.frame.h
			);

			ctx.restore();
		}
		else {
			ctx.drawImage(
				drawable,
				sx, sy,
				sw, sh,
				item.frame.x, item.frame.y,
				item.frame.w, item.frame.h
			);
		}
	}
}

export default TextureRenderer;