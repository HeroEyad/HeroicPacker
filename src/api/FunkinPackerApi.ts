import type { LoadedImages, PackOptions } from "api/types";
import TypedObserver from "api/TypedObserver";
import packerList from "./packers";
import PackProcessor from "./PackProcessor";
import { ApiError, ErrorCodes } from "./Errors";
import type { AnimationOffset } from "./utils/AnimateAtlas";
import type { AtlasMeta } from "./utils/AtlasMeta";
import type { CharacterAnimation, ImportedCharacter, StoredAnimations } from "./utils/Character";

export type AnimationFile = Readonly<{
	name: string;
	data: string;
}>;

export default class FunkinPackerApi {
	private images: LoadedImages;
	private options: PackOptions;
	private onComplete: (res:unknown) => void;
	private onError: (err:string) => void;

	private storedOrder: string[] | null = null;
	private atlasMeta: AtlasMeta | null = null;
	private animation: AnimationFile | null = null;
	private animationOffsets: Map<string, AnimationOffset> = new Map();
	private characterAnimations: Map<string, Partial<CharacterAnimation>> = new Map();
	private importedCharacter: ImportedCharacter | null = null;

	constructor() {
		this.options = {};
		this.onComplete = () => {};
		this.onError = () => {};
	}

	public hasStoredOrder = () => {
		return this.storedOrder && this.storedOrder.length > 0;
	}

	public clearOrder = () => {
		this.storedOrder = null;
	}

	public reset = () => {
		this.images = null;
		this.options = {};
		this.storedOrder = null;
		this.atlasMeta = null;
		this.setAnimation(null);
		this.characterAnimations = new Map();
		this.importedCharacter = null;
		this.onComplete = () => {};
		this.onError = () => {};
	}

	public setStoredOrderObserver: TypedObserver<string[]> = new TypedObserver();
	public setStoredOrder(order:string[]) {
		this.storedOrder = order;
		this.setStoredOrderObserver.emit(order);
	}

	public getStoredOrder = () => {
		return this.storedOrder;
	}

	public setAtlasMeta(meta:AtlasMeta | null) {
		this.atlasMeta = meta;
	}

	public getAtlasMeta = () => {
		return this.atlasMeta;
	}

	public setAnimationObserver: TypedObserver<AnimationFile | null> = new TypedObserver();
	public setAnimation(animation:AnimationFile | null) {
		if(this.animation === animation) return;
		this.animation = animation;
		this.animationOffsets = new Map();
		this.setAnimationObserver.emit(animation);
	}

	public getAnimation = () => {
		return this.animation;
	}

	public hasAnimation = () => {
		return this.animation !== null;
	}

	public getAnimationOffsets = (): ReadonlyMap<string, AnimationOffset> => {
		return this.animationOffsets;
	}

	public setAnimationOffset(name:string, offset:AnimationOffset) {
		if(offset.x === 0 && offset.y === 0) this.animationOffsets.delete(name);
		else this.animationOffsets.set(name, { x: offset.x, y: offset.y });
	}

	public getCharacterAnimations = (): StoredAnimations => {
		return this.characterAnimations;
	}

	public setCharacterAnimation(key:string, settings:Partial<CharacterAnimation>) {
		this.characterAnimations.set(key, { ...this.characterAnimations.get(key), ...settings });
	}

	public getImportedCharacter = () => {
		return this.importedCharacter;
	}

	public setImportedCharacter(character:ImportedCharacter | null) {
		this.importedCharacter = character;
	}

	public renameCharacterAnimation(from:string, to:string) {
		const settings = this.characterAnimations.get(from);
		if(!settings || from === to) return;
		this.characterAnimations.delete(from);
		this.characterAnimations.set(to, settings);
	}

	public setLoadedImagesObserver: TypedObserver<LoadedImages> = new TypedObserver();
	public loadImages(images:LoadedImages) {
		this.images = images;
		this.setLoadedImagesObserver.emit(images);
	}

	public setOptionsObserver: TypedObserver<PackOptions> = new TypedObserver();
	public setOptions(options:PackOptions) {
		this.options = options;
		this.setOptionsObserver.emit(options);
	}

	public setOnComplete(onComplete:(res:unknown) => void) {
		this.onComplete = onComplete;
	}

	public setOnError(onError:(err:string) => void) {
		this.onError = onError;
	}

	public static getAllPackers = () => {
		return packerList;
	}

	private _packProcessor: PackProcessor;

	public async pack() {
		if(!this._packProcessor) {
			this._packProcessor = new PackProcessor(this);
		}
		if(!this.images) {
			throw new ApiError(ErrorCodes.NO_IMAGES_ERROR);
		}
		return await this._packProcessor.pack(this.images, this.options);
	}
}
