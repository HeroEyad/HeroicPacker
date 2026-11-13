import CustomImage from "../data/CustomImage";
import type { LoadedImages } from "api/types";
import { loadAnimationFrames, mayBeAnimated } from "./AnimationFramesLoader";
import { loadFlaFile } from "./FlaImport";
import TypedObserver from "TypedObserver";
import I18 from "../locale/I18";

class LocalImagesLoader {
	data: File[];
	loaded: LoadedImages;
	loadedCnt: number;
	onProgress: ((loaded: number) => void) | null;
	onEnd: ((data: LoadedImages) => void) | null;
	private readonly splitAnimations: boolean;

	constructor(splitAnimations: boolean = true) {
		this.data = [];
		this.loaded = {};
		this.loadedCnt = 0;
		this.splitAnimations = splitAnimations;

		this.onProgress = null;
		this.onEnd = null;
	}

	load = (data: FileList, onProgress:(loaded: number) => void, onEnd:(data: LoadedImages) => void) => {
		this.data = [];

		for (let i = 0; i < data.length; i++) {
			this.data.push(data[i]);
		}

		this.onProgress = onProgress;
		this.onEnd = onEnd;

		this.loadNext();
	}

	private loadNext = () => {
		if (!this.data.length) {
			this.waitImages();
			return;
		}

		let types = ["image/png", "image/jpg", "image/jpeg", "image/gif"];
		let item = this.data.shift();

		if(!item) {
			this.loadNext();
			return;
		}

		if (/\.fla$/i.test(item.name)) {
			this.loadFla(item);
		}
		else if (types.indexOf(item.type) >= 0) {
			if (this.splitAnimations && mayBeAnimated(item.name)) {
				this.loadAnimated(item);
			}
			else {
				this.loadImage(item);
			}
		}
		else {
			this.loadNext();
		}
	}

	private loadFla = async (item: File) => {
		try {
			await loadFlaFile(item, this.loaded);
		}
		catch (e) {
			console.error(e);
			TypedObserver.showMessage.emit(I18.f("FLA_READ_ERROR", item.name));
		}

		this.onLoaded();
	}

	private loadAnimated = async (item: File) => {
		let loaded = false;

		try {
			loaded = await loadAnimationFrames(new Uint8Array(await item.arrayBuffer()), item.name, this.loaded);
		}
		catch (e) {
			console.error(e);
		}

		if (loaded) {
			this.onLoaded();
		}
		else {
			this.loadImage(item);
		}
	}

	private loadImage = (item: File) => {
		let img = new CustomImage(new Image(), item.name, item.name, "");

		let reader = new FileReader();
		reader.onload = e => {
			img.src = e.target.result as string;
			img.base64 = e.target.result as string;

			this.loaded[item.name] = img;
			this.onLoaded();
		};

		reader.readAsDataURL(item);
	}

	private onLoaded = () => {
		this.loadedCnt++;

		if (this.onProgress) {
			this.onProgress(this.loadedCnt / (this.loadedCnt + this.data.length));
		}

		this.loadNext();
	}

	private waitImages = () => {
		let ready = true;

		for (let key of Object.keys(this.loaded)) {
			if (!this.loaded[key].complete) {
				ready = false;
				break;
			}
		}

		if (ready) {
			if (this.onEnd) this.onEnd(this.loaded);
		}
		else {
			setTimeout(this.waitImages, 50);
		}
	}
}

export default LocalImagesLoader;
