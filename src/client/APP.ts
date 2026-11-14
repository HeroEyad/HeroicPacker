import { Observer, GLOBAL_EVENT } from './Observer';
import TextureRenderer from './utils/TextureRenderer';
import { getFilterByType } from './filters';
import I18 from './locale/I18';
import type { RenderSettings } from 'api/exporters';
import { exportedName, startExporter } from 'api/exporters';
import Downloader from './utils/Downloader';
import type { FileData, MessageBoxData, PackResultsData } from 'types';
import TypedObserver from 'TypedObserver';
import type { PackerCombo } from 'api/packers/Packer';
import type { LoadedImages, PackOptions, Rect } from 'api/types';
import ErrorHandler from './ErrorHandler';
import FunkinPackerApi from 'api/FunkinPackerApi';
import { optimisePng } from './utils/PngOptimizer';
import { getPackedSpriteOffsets, parseAnimationJson, transformAnimationJson } from 'api/utils/AnimateAtlas';
import { AnimateTimeline } from 'api/utils/AnimateTimeline';
import { buildCharacterFile, labelGroups, type CharacterFileFormat, type CharacterFrame } from 'api/utils/Character';
import Filter from './filters/Filter';
import { buildAnimationJson } from 'api/utils/AtlasExport';
import { checkRepack, type CheckedSheet } from './utils/RepackChecker';

const ANIMATION_FILE = "Animation.json";

let INSTANCE:APP;

class APP {
	images: LoadedImages;
	packOptions: PackOptions;
	packResult: PackResultsData[] | null;

	api: FunkinPackerApi;

	private packQueued: boolean = false;
	private packScale: number = 1;

	constructor() {
		INSTANCE = this;

		this.images = {};
		this.packOptions = {};
		this.packResult = null;

		this.api = new FunkinPackerApi();

		TypedObserver.imagesListChanged.on(this.onImagesListChanged, this);
		TypedObserver.packOptionsChanged.on(this.onPackOptionsChanged, this);
		TypedObserver.packExporterChanged.on(this.onPackExporterOptionsChanged, this);
		Observer.on(GLOBAL_EVENT.START_EXPORT, this.startExport, this);
	}

	static get i() {
		return INSTANCE;
	}

	private onImagesListChanged = (data: LoadedImages) => {
		this.images = data;
		this.pack();
	}

	private onPackOptionsChanged = (data: PackOptions) => {
		this.packOptions = data;
		this.pack();
	}

	private onPackExporterOptionsChanged = (data: PackOptions) => {
		this.packOptions = data;
	}

	private pack() {
		const keys = Object.keys(this.images);

		if (keys.length > 0) {
			Observer.emit(GLOBAL_EVENT.SHOW_PROCESSING);

			if (this.packQueued) return;
			this.packQueued = true;

			setTimeout(() => {
				this.packQueued = false;
				this.doPack();
			}, 0);
		}
		else {
			this.doPack();
		}
	}

	private async doPack() {
		try {
			this.api.loadImages(this.images);
			this.api.setOptions(this.packOptions);
			const {result, usedPacker, scale} = await this.api.pack();
			this.packScale = scale;
			this.onPackComplete(result, usedPacker);
		}
		catch (e:any) {
			this.onPackError({
				description: ErrorHandler.translateError(e)
			});
			console.error(e);
		}
	}

	private onPackComplete = (res:Rect[][], usedPacker:PackerCombo) => {
		this.packResult = [];

		for (const data of res) {
			const renderer = new TextureRenderer(data, this.packOptions);

			this.packResult.push({
				data,
				buffer: renderer.buffer,
				renderer
			});
		}

		TypedObserver.packComplete.emit({
			packResults: this.packResult,
			usedPacker: usedPacker,
			scale: this.packScale
		});
		Observer.emit(GLOBAL_EVENT.HIDE_PROCESSING);
	}

	private onPackError = (err: MessageBoxData) => {
		Observer.emit(GLOBAL_EVENT.HIDE_PROCESSING);
		TypedObserver.showMessage.emit(err.description);
	}

	private startExport() {
		if (!this.packResult || !this.packResult.length) {
			TypedObserver.showMessage.emit(I18.f("NO_IMAGES_ERROR"));
			return;
		}

		Observer.emit(GLOBAL_EVENT.SHOW_PROCESSING);
		setTimeout(() => this.doExport(), 0);
	}

	private async doExport() {
		const exporter = this.packOptions.exporterCls;
		const fileName = this.packOptions.fileName;
		const filterClass = getFilterByType(this.packOptions.filter);
		const filter = new filterClass();

		const files:FileData[] = [];

		const textureFormat = this.packOptions.textureFormat ?? "png";
		const pixelFormat = textureFormat === "png" ? "RGBA8888" : "RGB888";

		const scale = this.packScale;
		const optimizePNG = textureFormat === "png" && (this.packOptions.optimizePNG ?? true);
		const sheetNames: string[] = [];
		const checked: CheckedSheet[] = [];

		let ix = 0;
		for (const item of this.packResult) {

			const fName = exporter.animateAtlas ? "spritemap" + (ix + 1) : fileName + (this.packResult.length > 1 ? "-" + ix : "");
			sheetNames.push(fName);

			const buffer = item.renderer.getBuffer();

			let imageData = filter.apply(buffer).toDataURL(textureFormat === "png" ? "image/png" : "image/jpeg");
			const parts = imageData.split(",");
			parts.shift();
			imageData = parts.join(",");

			if (optimizePNG) {
				try {
					imageData = await optimisePng(imageData);
				} catch (e) {
					console.error("oxipng optimization failed, gotta use the unoptimized one!: " + e);
				}
			}

			files.push({
				name: `${fName}.${textureFormat}`,
				content: imageData,
				base64: true
			});

			const options:RenderSettings = {
				imageName: `${fName}`,
				imageFile: `${fName}.${textureFormat}`,
				imageData,
				spritePadding: this.packOptions.spritePadding ?? 3,
				borderPadding: this.packOptions.borderPadding ?? 1,
				format: pixelFormat,
				textureFormat: textureFormat,
				imageWidth: buffer.width,
				imageHeight: buffer.height,
				removeFileExtension: this.packOptions.removeFileExtension ?? true,
				prependFolderName: this.packOptions.prependFolderName ?? true,
				base64Export: this.packOptions.base64Export ?? false,
				scale,
				changedScale: scale !== 1,
				trimMode: this.packOptions.trimMode ?? "trim",

				sortExportedRows: this.packOptions.sortExportedRows ?? true,
			};

			try {
				const content = await startExporter(this.api, exporter, item.data, options);
				files.push({
					name: fName + "." + exporter.fileExt,
					content,
					base64: false
				});
				checked.push({ data: item.data, buffer, content });
			}
			catch (e) {
				Observer.emit(GLOBAL_EVENT.HIDE_PROCESSING);
				TypedObserver.showMessage.emit(I18.f("EXPORTER_ERROR", ErrorHandler.translateError(e)));
				console.error(e);
				return;
			}

			ix++;
		}

		const characterFile = this.packOptions.characterFile ?? "none";
		const atlas = Boolean(exporter.animateAtlas);
		if (characterFile !== "none" && (atlas || (exporter.exporterName === "Sparrow" && !this.api.hasAnimation()))) {
			files.push(this.getCharacterFile(characterFile, atlas ? [fileName || "character"] : sheetNames, atlas));
		}

		if (exporter.animateAtlas) {
			try {
				files.push({
					name: files.some(file => file.name === ANIMATION_FILE) ? fileName + "-" + ANIMATION_FILE : ANIMATION_FILE,
					content: this.api.hasAnimation() ? this.getPackedAnimation() : buildAnimationJson(this.packResult.map(sheet => sheet.data), {
						name: fileName || "texture",
						scale,
						removeFileExtension: this.packOptions.removeFileExtension ?? true,
						prependFolderName: this.packOptions.prependFolderName ?? true,
						trimMode: this.packOptions.trimMode ?? "trim",
						stored: this.api.getCharacterAnimations()
					}),
					base64: false
				});
			}
			catch (e) {
				Observer.emit(GLOBAL_EVENT.HIDE_PROCESSING);
				TypedObserver.showMessage.emit(I18.f("EXPORTER_ERROR", ErrorHandler.translateError(e)));
				console.error(e);
				return;
			}
		}

		Downloader.run(files, this.packOptions.fileName);
		Observer.emit(GLOBAL_EVENT.HIDE_PROCESSING);

		const checkable = exporter.exporterName === "Sparrow" && textureFormat === "png" && scale === 1 && filterClass === Filter && this.packOptions.trimMode !== "crop";
		TypedObserver.repackCheck.emit(null);
		if (checkable) {
			setTimeout(() => TypedObserver.repackCheck.emit(checkRepack(checked, {
				removeFileExtension: this.packOptions.removeFileExtension ?? true,
				prependFolderName: this.packOptions.prependFolderName ?? true,
				alphaThreshold: Math.max(0, Math.min(255, this.packOptions.alphaThreshold || 0))
			})), 0);
		}
	}

	getPackScale() {
		return this.packScale;
	}

	private atlasGroups() {
		const animation = this.api.getAnimation();
		const json = animation ? parseAnimationJson(animation.data) : null;
		if (!json) return undefined;

		const timeline = new AnimateTimeline(json);
		return labelGroups(timeline.labels, timeline.frameRate);
	}

	private getCharacterFile(format: CharacterFileFormat, images: string[], atlas: boolean): FileData {
		const removeFileExtension = this.packOptions.removeFileExtension ?? true;
		const prependFolderName = this.packOptions.prependFolderName ?? true;
		const frames: CharacterFrame[] = [];

		for (const sheet of this.packResult) {
			for (const rect of sheet.data) {
				const file = rect.originalFile || rect.file;
				if (!file) continue;

				frames.push({
					file,
					name: exportedName(file, removeFileExtension, prependFolderName),
					duration: rect.duration
				});
			}
		}

		const character = buildCharacterFile({
			format,
			name: this.packOptions.fileName || "character",
			images,
			frames,
			stored: this.api.getCharacterAnimations(),
			scale: this.packScale,
			imported: this.api.getImportedCharacter(),
			atlas,
			groups: atlas && this.api.hasAnimation() ? this.atlasGroups() : undefined
		});

		return {
			name: character.name,
			content: character.content,
			base64: false
		};
	}

	private exportedSpriteNames(sheets: ReadonlyArray<ReadonlyArray<Rect>>) {
		const removeFileExtension = this.packOptions.removeFileExtension ?? true;
		const prependFolderName = this.packOptions.prependFolderName ?? true;
		const names = new Map<string, string>();

		for (const sheet of sheets) {
			for (const rect of sheet) {
				const file = rect.originalFile || rect.file;
				if (!file) continue;

				const base = file.split("/").pop() as string;
				const dot = base.lastIndexOf(".");
				const bare = dot > 0 ? base.substring(0, dot) : base;
				const exported = exportedName(file, removeFileExtension, prependFolderName);

				if (exported !== bare && !names.has(bare)) names.set(bare, exported);
				if (exported !== base && !names.has(base)) names.set(base, exported);
			}
		}

		return names;
	}

	getPackedAnimation(withAnimationOffsets:boolean = true) {
		const animation = this.api.getAnimation();
		if (!animation || !this.packResult) return null;

		const sheets = this.packResult.map(sheet => sheet.data);
		const spriteOffsets = getPackedSpriteOffsets(sheets);
		const renames = withAnimationOffsets ? this.exportedSpriteNames(sheets) : undefined;

		return transformAnimationJson(animation.data, this.packScale, spriteOffsets, withAnimationOffsets ? this.api.getAnimationOffsets() : undefined, renames);
	}
}

export default APP;