import * as React from 'react';

import LocalImagesLoader from '../utils/LocalImagesLoader';
import ZipLoader from '../utils/ZipLoader';
import I18 from '../locale/I18';

import { Observer, GLOBAL_EVENT } from '../Observer';
import ItemTreePart, { type TreeListItem } from './ItemTree';

import {fixManualOffsets, getDummyRect, setMaxSizesForSourceSize, smartSortImages} from 'api/utils/common';
import type { RenameEvent, SelectedEvent } from 'types';
import TypedObserver from 'TypedObserver';
import CustomImage from '../data/CustomImage';
import type { ButtonData } from './MessageBox';
import type { LoadedImages } from 'api/types';
import APP from 'client/APP';
import { animationKey } from 'api/utils/Character';
import { frameName, frameNaming, replaceInOrder } from 'api/utils/FrameTiming';
import { hasUnsavedChanges, markSaved, openProject } from '../Project';
import { isProjectFile } from '../utils/ProjectFile';
import { animationIsEmpty, animationLabelNames, removeAnimation } from '../utils/FlaAnimation';

let INSTANCE:ImagesList;

interface Props {
}

interface State {
	images: LoadedImages,
	renaming: string | null
};

class ImagesList extends React.Component<Props, State> {
	private readonly imagesTreeRef: React.RefObject<HTMLDivElement> = React.createRef();
	private readonly imagesTreePartRef: React.RefObject<ItemTreePart> = React.createRef();
	private readonly dropHelpRef: React.RefObject<HTMLDivElement> = React.createRef();
	private readonly addImagesInputRef: React.RefObject<HTMLInputElement> = React.createRef();
	private readonly addZipInputRef: React.RefObject<HTMLInputElement> = React.createRef();

	override state:State = {
		images: {},
		renaming: null,
	};

	constructor(props: Props) {
		super(props);

		INSTANCE = this;

		this.state = {images: {}, renaming: null};
	}

	static get i() {
		return INSTANCE;
	}

	override componentDidMount = () => {
		TypedObserver.imageSelected.on(this.handleImageSelected, this);
		TypedObserver.imageRenameStarted.on(this.startRename, this);
		TypedObserver.imageRenamed.on(this.handleImageRenamed, this);
		Observer.on(GLOBAL_EVENT.IMAGE_CLEAR_SELECTION, this.handleImageClearSelection, this);

		globalThis.addEventListener("keydown", this.handleKeys, false);

		let dropZone = this.imagesTreeRef.current;
		if(dropZone) {
			dropZone.ondrop = this.onFilesDrop;

			dropZone.addEventListener("dragover", e => {
				let help = this.dropHelpRef.current;
				if(help) help.className = "image-drop-help selected";
				return e.preventDefault();
			});

			dropZone.addEventListener("dragleave", e => {
				let help = this.dropHelpRef.current;
				if(help) help.className = "image-drop-help";
				return e.preventDefault();
			});
		}
	}

	override componentWillUnmount = () => {
		TypedObserver.imageSelected.off(this.handleImageSelected, this);
		TypedObserver.imageRenameStarted.off(this.startRename, this);
		TypedObserver.imageRenamed.off(this.handleImageRenamed, this);
		Observer.off(GLOBAL_EVENT.IMAGE_CLEAR_SELECTION, this.handleImageClearSelection, this);

		globalThis.removeEventListener("keydown", this.handleKeys, false);
	}

	handleKeys = (e:KeyboardEvent) => {
		const target = e?.target;
		const typing = target instanceof HTMLTextAreaElement
			|| (target instanceof HTMLInputElement && !["checkbox", "radio", "button", "range", "file", "color"].includes(target.type))
			|| (target instanceof HTMLElement && target.isContentEditable);
		if(typing) return;

		if(e) {
			if(e.key === "F2") {
				const current = Object.keys(this.state.images).find(key => this.state.images[key].current);
				if(current) this.startRename(current);
				e.preventDefault();
				return;
			}

			if((e.code === "KeyA") && e.ctrlKey) {
				this.selectAllImages();
				e.preventDefault();
				return;
			}

			let key = e.keyCode || e.which;
			if(key === 65 && e.ctrlKey) {
				this.selectAllImages();
				e.preventDefault();
				return;
			}
		}
	}

	setImages = (images: LoadedImages) => {
		this.setState({images: images});
		TypedObserver.imagesListChanged.emit(images);
	}

	onFilesDrop = (e: DragEvent) => {
		e.preventDefault();

		if(!e.dataTransfer) return false;

		const project = Array.from(e.dataTransfer.files).find(file => isProjectFile(file.name));
		if(project) {
			openProject(project);
			return false;
		}

		if(e.dataTransfer.files.length) {
			let loader = new LocalImagesLoader();
			loader.load(e.dataTransfer.files, null, data => {
				return this.loadImagesComplete(data);
			});
		}

		return false;
	}

	addImages = (e:React.ChangeEvent<HTMLInputElement>) => {
		if(!e.target) return;
		if(!e.target.files) return;

		if(e.target.files.length) {
			Observer.emit(GLOBAL_EVENT.SHOW_PROCESSING);

			let loader = new LocalImagesLoader();
			loader.load(e.target.files, null, data => {
				return this.loadImagesComplete(data);
			});
		}
	}

	addZip = (e: React.ChangeEvent<HTMLInputElement>) => {
		if(!e.target) return;
		if(!e.target.files) return;

		let file = e.target.files[0];
		if(file) {
			Observer.emit(GLOBAL_EVENT.SHOW_PROCESSING);

			let loader = new ZipLoader();
			loader.load(file, null, data => this.loadImagesComplete(data));
		}
	}

	loadImagesComplete = (data:LoadedImages={}) => {

		Observer.emit(GLOBAL_EVENT.HIDE_PROCESSING);

		this.addImagesInputRef.current.value = "";
		this.addZipInputRef.current.value = "";

		const names = Object.keys(data);

		if(names.length) {
			const unsaved = hasUnsavedChanges();
			let images = this.state.images;
			const rects = [];

			for (const name of names) {
				images[name] = data[name];
				const img = images[name];
				if(!img) continue;
				if(!img.rect)
					img.rect = getDummyRect(name, img.width, img.height);
				rects.push(img.rect);
			}

			setMaxSizesForSourceSize(rects);
			fixManualOffsets(rects);

			images = this.sortImages(images);

			this.setState({images: images});
			TypedObserver.imagesListChanged.emit(images);
			if(!unsaved) markSaved();
		}
	}

	sortImages = (images:LoadedImages) => {
		const names:NonNullable<string>[] = Object.keys(images);
		names.sort(smartSortImages);

		const sorted:LoadedImages = {};

		for(let name of names) {
			sorted[name] = images[name];
		}

		return sorted;
	}

	clear = () => {
		const keys = Object.keys(this.state.images);
		if(keys.length > 0) {
			const buttons:ButtonData[] = [
				{name: "yes", caption: I18.f("YES"), callback: this.doClear},
				{name: "no", caption: I18.f("NO")}
			];

			TypedObserver.showMessage.emit(I18.f("CLEAR_WARNING"), buttons);
		}
	}

	doClear = () => {
		TypedObserver.imagesListChanged.emit({});
		TypedObserver.imagesListSelectedChanged.emit([]);
		APP.i.api.reset();
		this.setState({images: {}});
	}

	selectAllImages = () => {
		const images = this.state.images;
		for(const key in images) {
			images[key].selected = true;
		}

		this.setState({images: this.state.images});
		this.emitSelectedChanges();
	}

	removeImagesSelect = () => {
		const images = this.state.images;
		for(const key in images) {
			images[key].selected = false;
		}
	}

	getCurrentImage = () => {
		const images = this.state.images;
		for(const key in images) {
			if(images[key].current) return images[key];
		}

		return null;
	}

	getImageIdx = (image:CustomImage) => {
		let idx = 0;

		const images = this.state.images;
		for(const key in images) {
			if(images[key] === image) return idx;
			idx++;
		}

		return -1;
	}

	bulkSelectImages = (to:CustomImage) => {
		const current = this.getCurrentImage();
		if(!current) {
			to.selected = true;
			return;
		}

		const fromIx = this.getImageIdx(current);
		const toIx = this.getImageIdx(to);

		const images = this.state.images;
		let ix = 0;
		for(const key in images) {
			if(fromIx < toIx && ix >= fromIx && ix <= toIx) images[key].selected = true;
			if(fromIx > toIx && ix <= fromIx && ix >= toIx) images[key].selected = true;
			ix++;
		}
		this.emitSelectedChanges();
	}

	selectImagesFolder = (path: string, selected: boolean) => {
		const images = this.state.images;

		let first = false;
		for(const key in images) {
			if(key.substring(0, path.length + 1) === path + "/") {
				if(!first) {
					first = true;
					this.clearCurrentImage();
					images[key].current = true;
				}
				images[key].selected = selected;
			}
		}
		this.emitSelectedChanges();
	}

	clearCurrentImage = () => {
		const images = this.state.images;
		for(const key in images) {
			images[key].current = false;
		}
	}

	getFirstImageInFolder = (path: string) => {
		const images = this.state.images;

		for(const key in images) {
			if (key.substring(0, path.length + 1) === path + "/")
				return images[key];
		}

		return null;
	}

	getLastImageInFolder = (path: string) => {
		const images = this.state.images;

		let ret = null;
		for(const key in images) {
			if (key.substring(0, path.length + 1) === path + "/")
				ret = images[key];
		}

		return ret;
	}

	handleImageSelected = (e: SelectedEvent) => {
		const path = e.path;
		const images = this.state.images;

		if(e.isFolder) {
			if(e.ctrlKey) {
				this.selectImagesFolder(path, true);
			}
			else if(e.shiftKey) {
				let to = this.getLastImageInFolder(path);
				if(to) this.bulkSelectImages(to);

				to = this.getFirstImageInFolder(path);
				if(to) {
					this.bulkSelectImages(to);
					this.clearCurrentImage();
					to.current = true;
				}
			}
			else {
				this.removeImagesSelect();
				this.selectImagesFolder(path, true);
			}
		}
		else {
			const image = images[path];
			if(image) {
				if(e.ctrlKey) {
					image.selected = !image.selected;
				}
				else if(e.shiftKey) {
					this.bulkSelectImages(image);
				}
				else {
					this.removeImagesSelect();
					image.selected = true;
				}

				this.clearCurrentImage();
				image.current = true;
			}
		}

		this.setState({images: images});
		this.emitSelectedChanges();
	}

	handleImageClearSelection = () => {
		this.removeImagesSelect();
		this.clearCurrentImage();
		this.setState({images: this.state.images});
		this.emitSelectedChanges();
	}

	emitSelectedChanges = () => {
		const selected = [];

		const images = this.state.images;

		for(const key in images) {
			if(images[key].selected) selected.push(key);
		}

		TypedObserver.imagesListSelectedChanged.emit(selected);
	}

	createImagesFolder(name="", path=""):TreeListItem {
		return {
			img: null,
			isFolder: true,
			selected: false,
			current: false,
			name: name,
			path: path,
			items: []
		};
	}

	getImageSubFolder = (root:TreeListItem, parts:string[]) => {
		parts = parts.slice();

		let folder = null;

		while(parts.length) {
			const name = parts.shift();

			folder = null;

			for (const item of root.items) {
				if (item.isFolder && item.name === name) {
					folder = item;
					break;
				}
			}

			if (!folder) {
				const p = [];
				if(root.path) p.unshift(root.path);
				p.push(name);

				folder = this.createImagesFolder(name, p.join("/"));
				root.items.push(folder);
			}

			root = folder;
		}

		return folder || root;
	}

	getImagesTree = () => {
		const res = this.createImagesFolder();

		const keys = Object.keys(this.state.images);

		for(const key of keys) {
			const parts = key.split("/");
			const name = parts.pop();
			const folder = this.getImageSubFolder(res, parts);

			const img = this.state.images[key];

			folder.items.push({
				img: img,
				path: key,
				name: name,
				isFolder: false,
				selected: img.selected,
				current: img.current,
				renaming: key === this.state.renaming
			});

			if(this.state.images[key].selected) folder.selected = true;
		}

		const labels = animationLabelNames(APP.i.api.getAnimation()?.data ?? null);
		for(const item of res.items) {
			if(item.isFolder && labels.has(item.name)) item.isAnimation = true;
		}

		return res;
	}

	animationFolders = (names: string[]) => {
		const labels = animationLabelNames(APP.i.api.getAnimation()?.data ?? null);
		const found = new Set<string>();

		for(const name of names) {
			const slash = name.indexOf("/");
			if(slash > 0 && labels.has(name.substring(0, slash))) found.add(name.substring(0, slash));
		}

		return found;
	}

	renameAnimation = (key: string, prefix: string) => {
		const images = this.state.images;
		const target = key.substring(0, key.lastIndexOf("/") + 1) + prefix;
		if(target === key) return key;

		const renames = new Map<string, string>();
		for(const name of Object.keys(images)) {
			if(animationKey(name) === key) renames.set(name, target + name.substring(key.length));
		}

		if(!renames.size || !this.applyRenames(renames)) return null;

		const newKey = animationKey(renames.values().next().value);
		APP.i.api.renameCharacterAnimation(key, newKey);

		return newKey;
	}

	retimeAnimation = (key: string, sequence: readonly string[]) => {
		const images = this.state.images;
		const frames = Object.keys(images).filter(name => animationKey(name) === key).sort(smartSortImages);
		if (!frames.length || !sequence.length || sequence.some(name => !images[name] || animationKey(name) !== key)) return false;

		const naming = frameNaming(frames[0]);
		const names = sequence.map((_, index) => frameName(naming, index));
		const retimed: LoadedImages = {};
		const used = new Set<string>();

		for (const name of Object.keys(images)) {
			if (animationKey(name) !== key) retimed[name] = images[name];
		}

		sequence.forEach((source, index) => {
			const image = used.has(source) ? images[source].copy() : images[source];
			used.add(source);

			if (image.rect) image.rect.name = names[index];
			retimed[names[index]] = image;
		});

		const order = APP.i.api.getStoredOrder();
		if (order) {
			const newOrder = replaceInOrder(order, frames, names);
			APP.i.api.setStoredOrder(newOrder);
			TypedObserver.storedOrderChanged.emit(newOrder);
		}

		const sorted = this.sortImages(retimed);
		this.setState({images: sorted});
		TypedObserver.imagesListChanged.emit(sorted);
		TypedObserver.imagesListSelectedChanged.emit(Object.keys(sorted).filter(name => sorted[name].selected));

		return true;
	}

	startRename = (key: string) => {
		if(!this.state.images[key]) return;

		if(APP.i.api.hasAnimation()) {
			TypedObserver.showMessage.emit(I18.f("RENAME_ANIMATE_ERROR"));
			return;
		}

		this.setState({renaming: key});
	}

	handleImageRenamed = (e: RenameEvent) => {
		if(this.state.renaming !== e.path) return;

		this.setState({renaming: null});
		this.renameImage(e.path, e.name);
	}

	renameImage = (key: string, name: string) => {
		const images = this.state.images;
		const target = key.substring(0, key.lastIndexOf("/") + 1) + name.trim();
		if(!images[key] || target === key || target.split("/").some(part => !part.trim())) return false;

		const from = animationKey(key);
		const to = animationKey(target);
		const shared = (anim: string) => Object.keys(images).some(other => other !== key && animationKey(other) === anim);
		const moveSettings = from !== to && !shared(from) && !shared(to);

		if(!this.applyRenames(new Map([[key, target]]))) return false;
		if(moveSettings) APP.i.api.renameCharacterAnimation(from, to);

		return true;
	}

	applyRenames = (renames: ReadonlyMap<string, string>) => {
		const images = this.state.images;

		for(const name of renames.values()) {
			if(images[name] && !renames.has(name)) {
				TypedObserver.showMessage.emit(I18.f("RENAME_EXISTS_ERROR", name));
				return false;
			}
		}

		const renamed: LoadedImages = {};
		for(const name of Object.keys(images)) {
			const to = renames.get(name) ?? name;
			renamed[to] = images[name];
			if(to !== name && images[name].rect) images[name].rect.name = to;
		}

		const order = APP.i.api.getStoredOrder();
		if(order) {
			const newOrder = order.map(name => renames.get(name) ?? name);
			APP.i.api.setStoredOrder(newOrder);
			TypedObserver.storedOrderChanged.emit(newOrder);
		}

		const sorted = this.sortImages(renamed);
		this.setState({images: sorted});
		TypedObserver.imagesListChanged.emit(sorted);
		TypedObserver.imagesListSelectedChanged.emit(Object.keys(sorted).filter(name => sorted[name].selected));

		return true;
	}

	deleteSelectedImages = () => {
		let images = this.state.images;

		let deletedCount = 0;

		let keys = Object.keys(images);
		const folders = this.animationFolders(keys);
		for(let key of keys) {
			if(images[key].selected) {
				deletedCount++;
				delete images[key];
			}
		}

		if(deletedCount > 0) {
			images = this.sortImages(images);

			const remaining = this.animationFolders(Object.keys(images));
			const removed = Array.from(folders).filter(label => !remaining.has(label));
			const animation = APP.i.api.getAnimation();
			if(removed.length && animation) {
				let data = animation.data;
				for(const label of removed) data = removeAnimation(data, label);
				APP.i.api.setAnimation(animationIsEmpty(data) ? null : { name: animation.name, data });
			}

			this.setState({images: images});
			TypedObserver.imagesListChanged.emit(images);
			this.emitSelectedChanges();
		}
	}

	renderWebButtons() {
		return (
			<span>
				<div className="btn back-800 border-color-gray color-white file-upload" title={I18.f("ADD_IMAGES_TITLE")}>
					{I18.f("ADD_IMAGES")}
					<input type="file" ref={this.addImagesInputRef} multiple accept="image/png,image/jpg,image/jpeg,image/gif,.fla" onChange={this.addImages} />
				</div>

				<div className="btn back-800 border-color-gray color-white file-upload" title={I18.f("ADD_ZIP_TITLE")}>
					{I18.f("ADD_ZIP")}
					<input type="file" ref={this.addZipInputRef} accept=".zip,application/octet-stream,application/zip,application/x-zip,application/x-zip-compressed" onChange={this.addZip} />
				</div>
			</span>
		);
	}

	override render() {
		let data = this.getImagesTree();

		let dropHelp = Object.keys(this.state.images).length > 0 ? null : (<div ref={this.dropHelpRef} className="image-drop-help">{I18.f("IMAGE_DROP_HELP")}</div>);

		return (
			<div className="images-list border-color-gray back-white">

				<div className="images-controllers border-color-gray">

					{this.renderWebButtons()}

					<div className="btn back-800 border-color-gray color-white" onClick={this.deleteSelectedImages} title={I18.f("DELETE_TITLE")}>
						{I18.f("DELETE")}
					</div>
					<div className="btn back-800 border-color-gray color-white" onClick={this.clear} title={I18.f("CLEAR_TITLE")}>
						{I18.f("CLEAR")}
					</div>

					<hr />

				</div>

				<div ref={this.imagesTreeRef} className="images-tree">
					<ItemTreePart ref={this.imagesTreePartRef} {...data} />
					{dropHelp}
				</div>

			</div>
		);
	}
}

export default ImagesList;