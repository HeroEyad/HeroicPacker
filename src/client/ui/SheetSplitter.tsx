import * as React from 'react';
import APP from '../APP';

import { Observer, GLOBAL_EVENT } from '../Observer';
import I18 from '../locale/I18';

import { SplitterMaster } from 'api/splitters';
import LocalImagesLoader from "../utils/LocalImagesLoader";
import Downloader from "../utils/Downloader";
import ImagesList from "./ImagesList";
import PackProperties from '../ui/PackProperties';
import type { FileData } from 'types';
import type { Rect } from 'api/types';
import Splitter from 'api/splitters/Splitter';
import TypedObserver from 'TypedObserver';
import CustomImage from '../data/CustomImage';
import { formatBytes, setMaxSizesForSourceSize } from 'api/utils/common';
import { extractFrames } from '../utils/FrameExtractor';
import { getAnimationInfo, isAnimationJson, parseAnimationJson } from 'api/utils/AnimateAtlas';
import type { AnimationFile } from 'api/FunkinPackerApi';

const splitterMaster = new SplitterMaster();

const ATLAS_SPLITTER = "Atlas Spritemap";

interface Props {
}

interface State {
	textureBack: string;
	scale: number;
	updateFileName: boolean;
	animationName: string | null;

	message: React.ReactNode;
	detectedPacker: string;
}

const valTextureBackColors = ["grid-back", "white-back", "pink-back", "black-back"] as const;
export type TextureBack = typeof valTextureBackColors;

class SheetSplitter extends React.Component<Props, State> {
	private readonly disableUntrimRef: React.RefObject<HTMLInputElement> = React.createRef();
	private readonly updateFileNameRef: React.RefObject<HTMLInputElement> = React.createRef();
	private readonly dataFormatRef: React.RefObject<HTMLSelectElement> = React.createRef();
	private readonly selectTextureInputRef: React.RefObject<HTMLInputElement> = React.createRef();
	private readonly dataFileNameRef: React.RefObject<HTMLInputElement> = React.createRef();
	private readonly fileNameRef: React.RefObject<HTMLInputElement> = React.createRef();
	private readonly viewRef: React.RefObject<HTMLCanvasElement> = React.createRef();
	private readonly paddingRef: React.RefObject<HTMLInputElement> = React.createRef();
	private readonly widthRef: React.RefObject<HTMLInputElement> = React.createRef();
	private readonly heightRef: React.RefObject<HTMLInputElement> = React.createRef();
	private readonly textureBackColors: TextureBack;
	private step: number;
	private readonly rangeRef: React.RefObject<HTMLInputElement> = React.createRef();
	private readonly wheelRef: React.RefObject<HTMLInputElement> = React.createRef();
	private texture: CustomImage;
	private data: string;
	private frames: Rect[];
	private fileName: string;
	private dataName: string;
	private animation: AnimationFile | null;
	private animationSprites: ReadonlyMap<string, number> | null;
	private readonly buffer: HTMLCanvasElement;

	constructor(props: Props) {
		super(props);

		this.textureBackColors = valTextureBackColors;
		this.step = 0.01;

		this.state = {
			textureBack: this.textureBackColors[0],
			scale: 1,
			updateFileName: APP.i.packOptions.repackUpdateFileName === undefined ? true : APP.i.packOptions.repackUpdateFileName,
			animationName: null,
			message: null,
			detectedPacker: ''
		};

		this.texture = null;
		this.data = null;
		this.frames = null;
		this.animation = null;
		this.animationSprites = null;

		this.fileName = '';
		this.dataName = '';

		this.buffer = document.createElement('canvas');
	}

	override componentDidMount = () => {
		this.updateTexture();
		this.wheelRef.current.addEventListener('wheel', this.handleWheel, { passive: false });
	}

	override componentWillUnmount = () => {
		this.wheelRef.current.removeEventListener('wheel', this.handleWheel);
	}

	handleWheel = (event: WheelEvent) => {
		if(!event.ctrlKey) return false;

		let value = this.state.scale;
		if (event.deltaY >= 0) {
			if (this.state.scale > 0.1) {
				value = Number((this.state.scale - this.step).toPrecision(2));
				this.setState({scale: value});
				this.updateTextureScale(value);
			}
		} else {
			if (this.state.scale < 2.0) {
				value = Number((this.state.scale + this.step).toPrecision(2));
				this.setState({scale: value});
				this.updateTextureScale(value);
			}
		}

		this.rangeRef.current.value = value.toString(10);

		event.preventDefault();
		event.stopPropagation();
		return false;
	}

	doRepack = async () => {
		Observer.emit(GLOBAL_EVENT.SHOW_PROCESSING);

		if(!this.frames || !this.frames.length) {
			Observer.emit(GLOBAL_EVENT.HIDE_PROCESSING);
			TypedObserver.showMessage.emit(I18.f('SPLITTER_ERROR_NO_FRAMES'));

			return;
		}

		splitterMaster.finishSplit();

		const disableUntrim = this.disableUntrimRef.current.checked;

		if(this.state.updateFileName) {
			let filename = this.fileName;
			const di = filename.lastIndexOf(".");
			if (di !== -1) {
				filename = filename.substring(0, di);
			}
			PackProperties.i.packOptions.fileName = filename;
			TypedObserver.packExporterChanged.emit(PackProperties.i.getPackOptions());
			PackProperties.i.refreshPackOptions();
		}

		const splitter = this.getCurrentSplitter();
		const images = await extractFrames(this.texture.image, this.frames, splitter, disableUntrim);

		TypedObserver.repackInfo.emit({
			width: this.texture.width,
			height: this.texture.height,
			totalFrames: this.frames.length
		});

		APP.i.api.setAnimation(splitter.splitterName === ATLAS_SPLITTER ? this.animation : null);
		APP.i.api.setAtlasMeta(splitter.readMeta(splitter.cleanData(this.data)));

		Observer.emit(GLOBAL_EVENT.HIDE_SHEET_SPLITTER);
		ImagesList.i.loadImagesComplete(images);
	}

	doExport = () => {
		Observer.emit(GLOBAL_EVENT.SHOW_PROCESSING);

		if(!this.frames || !this.frames.length) {
			Observer.emit(GLOBAL_EVENT.HIDE_PROCESSING);
			TypedObserver.showMessage.emit(I18.f('SPLITTER_ERROR_NO_FRAMES'));

			return;
		}

		const ctx = this.buffer.getContext('2d');
		if(!ctx) {
			Observer.emit(GLOBAL_EVENT.HIDE_PROCESSING);
			TypedObserver.showMessage.emit(I18.f('ERROR_NO_CONTEXT'));

			return;
		}
		const files:FileData[] = [];

		const disableUntrim = this.disableUntrimRef.current?.checked ?? false;

		const splitter = this.getCurrentSplitter();

		if(splitter.groupFramesByAnimation)
			setMaxSizesForSourceSize(this.frames);

		for(let item of this.frames) {
			const trimmed = item.trimmed ? disableUntrim : false;

			const ssw = item.sourceSize.mw ?? item.frame.w;
			const ssh = item.sourceSize.mh ?? item.frame.h;

			this.buffer.width = (disableUntrim && trimmed) ? item.spriteSourceSize.w : ssw;
			this.buffer.height = (disableUntrim && trimmed) ? item.spriteSourceSize.h : ssh;

			ctx.clearRect(0, 0, this.buffer.width, this.buffer.height);

			if(item.rotated) {
				ctx.save();

				ctx.translate(item.spriteSourceSize.x + item.spriteSourceSize.w/2, item.spriteSourceSize.y + item.spriteSourceSize.h/2);
				ctx.rotate(splitter.inverseRotation ? Math.PI/2 : -Math.PI/2);

				let dx = trimmed ? item.spriteSourceSize.y - item.spriteSourceSize.h/2 : -item.spriteSourceSize.h/2;
				let dy = trimmed ? -(item.spriteSourceSize.x + item.spriteSourceSize.w/2) : -item.spriteSourceSize.w/2;

				ctx.drawImage(this.texture.image,
					item.frame.x, item.frame.y,
					item.frame.h, item.frame.w,
					dx, dy,
					item.spriteSourceSize.h, item.spriteSourceSize.w);

				ctx.restore();
			}
			else {
				const dx = trimmed ? 0 : item.spriteSourceSize.x;
				const dy = trimmed ? 0 : item.spriteSourceSize.y;

				ctx.drawImage(this.texture.image,
					item.frame.x, item.frame.y,
					item.frame.w, item.frame.h,
					dx, dy,
					item.spriteSourceSize.w, item.spriteSourceSize.h);
			}

			let ext = item.name.split('.').pop().toLowerCase();
			if(!ext) {
				ext = 'png';
				item.name += '.' + ext;
			}

			let base64 = this.buffer.toDataURL(ext === 'png' ? 'image/png' : 'image/jpeg');
			base64 = base64.split(',').pop();

			files.push({
				name: item.name,
				content: base64,
				base64: !!base64
			});
		}

		Downloader.run(files, this.fileName + '.zip');

		Observer.emit(GLOBAL_EVENT.HIDE_PROCESSING);
	}

	selectTexture = (e: React.ChangeEvent<HTMLInputElement>) => {
		if(e.target.files.length) {
			Observer.emit(GLOBAL_EVENT.SHOW_PROCESSING);

			const loader = new LocalImagesLoader(false);
			loader.load(e.target.files, null, data => {
				const keys = Object.keys(data);

				if(keys.length === 0) {
					Observer.emit(GLOBAL_EVENT.HIDE_PROCESSING);
					TypedObserver.showMessage.emit(I18.f('SPLITTER_ERROR_NO_TEXTURE'));
					return;
				}

				this.fileName = keys[0];

				this.texture = data[this.fileName];
				this.fileNameRef.current.textContent = this.fileName;

				this.updateView();

				Observer.emit(GLOBAL_EVENT.HIDE_PROCESSING);
			});
		}
	}

	updateTexture = () => {
		const canvas = this.viewRef.current;

		if(this.texture) {
			canvas.width = this.texture.width;
			canvas.height = this.texture.height;
			canvas.style.display = '';

			const ctx = canvas.getContext('2d');
			ctx.clearRect(0, 0, canvas.width, canvas.height);
			ctx.drawImage(this.texture.image, 0, 0);

			canvas.className = this.state.textureBack;
			this.updateTextureScale();
		}
		else {
			canvas.style.display = 'none';
		}
	}

	selectDataFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
		const files = Array.from(e.target.files);

		for(const item of files) {
			if(await this.loadAnimationFile(item)) continue;
			this.loadDataFile(item);
		}
	}

	loadDataFile = (item: File) => {
		const reader = new FileReader();
		reader.onload = e => {
			let content = e.target.result as string;
			const splitContent = content.split(',');
			splitContent.shift();
			if(splitContent.length == 1)
				content = atob(splitContent.join(','));

			this.data = content;

			this.dataName = item.name;
			this.dataFileNameRef.current.textContent = this.dataName;

			const splitter = splitterMaster.findSplitter(this.data);
			splitterMaster.loadSplitter(splitter);

			this.updateView();
		};

		reader.readAsDataURL(item);
	}

	loadAnimationFile = async (item: File) => {
		const data = await item.text();
		if(!isAnimationJson(data)) return false;

		this.animation = { name: item.name, data };
		this.animationSprites = getAnimationInfo(parseAnimationJson(data)).sprites;
		this.setState({animationName: item.name});
		this.updateView();

		return true;
	}

	selectAnimationFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
		const item = e.target.files[0];
		e.target.value = "";
		if(!item) return;

		if(!(await this.loadAnimationFile(item))) {
			TypedObserver.showMessage.emit("This file is not the Animation.json of a texture atlas.");
		}
	}

	removeAnimation = () => {
		this.animation = null;
		this.animationSprites = null;
		this.setState({animationName: null});
		this.updateView();
	}

	updateFrames = () => {
		if(!this.texture) return;
		if(this.data === null) return;

		splitterMaster.splitData(this.data, {
			textureWidth: this.texture.width,
			textureHeight: this.texture.height,
			width: +this.widthRef.current.value * 1 || 32,
			height: +this.heightRef.current.value * 1 || 32,
			padding: +this.paddingRef.current.value * 1 || 0
		}, frames => {
			const cleanData = splitterMaster.cleanData(this.data);

			if(frames) {
				this.frames = frames;

				const canvas = this.viewRef.current;
				const ctx = canvas.getContext('2d');

				if(!ctx) {
					Observer.emit(GLOBAL_EVENT.HIDE_PROCESSING);
					TypedObserver.showMessage.emit(I18.f('ERROR_NO_CONTEXT'));

					return;
				}

				const isSparrow = splitterMaster.currentSplitter.splitterName === 'Sparrow';

				let manualOffsets = 0;
				let weirdSize = 0;
				let totalFrames = 0;

				const DEFAULT_COLOR = "0,0,255";
				const MANUAL_OFFSETS_COLOR = "160,32,240";
				const WEIRD_SIZE_COLOR = "227,164,39";

				for(let item of this.frames) {
					const frame = item.frame;
					let frameHasManualOffsets = false;
					let frameHasWeirdSize = false;

					let w = frame.w, h = frame.h;
					if(item.rotated) {
						w = frame.h;
						h = frame.w;
					}

					if(isSparrow) {
						if(item.frameSize.x < 0 || item.frameSize.y < 0) {
							manualOffsets++;
							frameHasManualOffsets = true;
						} else if(item.spriteSourceSize.w + item.frameSize.x > item.frameSize.w) {
							weirdSize++;
							frameHasWeirdSize = true;
						} else if(item.spriteSourceSize.h + item.frameSize.y > item.frameSize.h) {
							weirdSize++;
							frameHasWeirdSize = true;
						}
					}

					let color = DEFAULT_COLOR;
					if(frameHasManualOffsets) {
						color = MANUAL_OFFSETS_COLOR;
					} else if(frameHasWeirdSize) {
						color = WEIRD_SIZE_COLOR;
					}

					ctx.strokeStyle = "rgba(" + color + ",1.0)";
					ctx.fillStyle = "rgba(" + color + ",0.25)";
					ctx.lineWidth = 1;

					ctx.beginPath();
					ctx.fillRect(frame.x, frame.y, w, h);
					ctx.rect(frame.x, frame.y, w, h);
					ctx.moveTo(frame.x, frame.y);
					ctx.lineTo(frame.x + w, frame.y + h);
					ctx.stroke();

					totalFrames++;
				}

				const splitterMessage: React.ReactNode[] = [];
				const addMessage = (msg: React.ReactNode) => {
					if(splitterMessage.length > 0) {
						splitterMessage.push(<br/>);
					}
					splitterMessage.push(msg);
				};
				const si = APP.i.packOptions.statsSI;
				const ramUsage = canvas.width * canvas.height * 4;
				addMessage(<><span>Ram Usage: {formatBytes(ramUsage, 3, si)}</span></>);
				addMessage(<><span>Total Frames: {totalFrames}</span></>);
				if(manualOffsets > 0) {
					addMessage(<><span style={{color: "rgb("+MANUAL_OFFSETS_COLOR+")"}}>Manual offsets detected, for {manualOffsets} frames.</span></>);
				}
				if(weirdSize > 0) {
					addMessage(<><span style={{color: "rgb("+WEIRD_SIZE_COLOR+")"}}>Unexpected Frame size detected, possible manual offsets for {weirdSize} frames.</span></>);
				}

				const splitterName = splitterMaster.currentSplitter.splitterName;
				const withDuration = this.frames.filter(item => item.duration !== undefined).length;
				if(withDuration > 0) {
					addMessage(<><span>Durations: found on {withDuration} frames. The JSON formats export them.</span></>);
				}
				if(splitterName === ATLAS_SPLITTER) {
					addMessage(<><span style={{color: "rgb("+WEIRD_SIZE_COLOR+")"}}>Warning: Texture atlas support is in BETA.</span></>);

					if(this.animationSprites) {
						const inSpritemap = new Set<string>();
						for(const item of this.frames) {
							inSpritemap.add(item.name);
							const dot = item.name.lastIndexOf(".");
							if(dot > 0) inSpritemap.add(item.name.substring(0, dot));
						}

						let missing = 0;
						for(const name of this.animationSprites.keys()) {
							if(!inSpritemap.has(name)) missing++;
						}

						addMessage(<><span>Animation.json: uses {this.animationSprites.size - missing} of these sprites. It gets exported with the Atlas Spritemap format, which can trim and scale now.</span></>);
						if(missing > 0) {
							addMessage(<><span style={{color: "rgb("+WEIRD_SIZE_COLOR+")"}}>{missing} of the sprites it uses are not in this spritemap. Fine if the atlas has more spritemaps, otherwise it is the wrong Animation.json.</span></>);
						}
					} else {
						addMessage(<><span style={{color: "rgb("+WEIRD_SIZE_COLOR+")"}}>No Animation.json selected: the Atlas Spritemap format can't trim or scale without it, and you keep your original Animation.json.</span></>);
					}
				}

				this.setState({message: <>{splitterMessage.map((a, i) => <span key={"splitter-message-" + i}>{a}</span>)}</>});

				const detectedPackers: string[] = [];
				if(isSparrow) {
					const data = cleanData;

					let packers = 0;

					const HAS_CREDIT				= 1;

					const ADOBE_ANIMATE				= 1 << ((1 << 1) - 1);
					const HEROIC_PACKER				= 1 << ((2 << 1) - 1);
					const FREE_TEX_PACKER			= 1 << ((3 << 1) - 1);
					const LESHY_PACKER				= 1 << ((4 << 1) - 1);
					const CODENWEB_TEXTURE_PACKER	= 1 << ((5 << 1) - 1);
					const UNCERTAINPROD_PACKER_WEB	= 1 << ((6 << 1) - 1);
					const UNCERTAINPROD_PACKER_APP	= 1 << ((7 << 1) - 1);

					let header_is_animate = false;
					let header_is_common = false;
					let header_is_leshy = false;

					const isCredited = (packer: number) => (packers & ((packer) >> HAS_CREDIT)) != 0;
					const hasPacker = (packer: number) => (packers & (packer)) != 0;
					const setCreditedPacker = (packer: number) => (packer) | ((packer) >> HAS_CREDIT);
					const setCredit = (packer: number) => (packer) >> HAS_CREDIT;
					const removePacker = (packer: number) => ~(packer);

					const commonPackers = HEROIC_PACKER | FREE_TEX_PACKER | CODENWEB_TEXTURE_PACKER;

					if(data.startsWith('<?xml version="1.0" encoding="UTF-8"?>')) {
						packers |= commonPackers;
						header_is_common = true;
					} else if(data.startsWith('<?xml version="1.0" encoding="utf-8"?>')) {
						packers |= ADOBE_ANIMATE;
						header_is_animate = true;
					} else if(data.startsWith("<?xml version='1.0' encoding='utf-8'?>")) {
						packers |= UNCERTAINPROD_PACKER_APP;
					} else if(/<textureatlas xmlns="http:\/\/www\.w3\.org\/1999\/xhtml" imagepath="[^"]+"/i.test(data)) {
						packers |= LESHY_PACKER;
						header_is_leshy = true;
					}

					if(data.includes("Created with Heroic Packer")) {
						packers &= ~commonPackers;
						packers |= setCreditedPacker(HEROIC_PACKER);
					}
					if(data.includes("Created with Free texture packer")) {
						packers &= ~commonPackers;
						packers |= setCreditedPacker(FREE_TEX_PACKER);
					}
					if(data.includes("Created with Adobe Animate")) {
						packers |= setCreditedPacker(ADOBE_ANIMATE);
					}
					if(data.includes("Created with TexturePacker https")) {
						packers |= setCreditedPacker(CODENWEB_TEXTURE_PACKER);
					}
					if(data.includes("Created using the Spritesheet and XML generator")) {
						packers |= setCreditedPacker(UNCERTAINPROD_PACKER_WEB);
						packers &= removePacker(ADOBE_ANIMATE);
					}

					if(/ {4}<SubTexture/.test(data)) {
						packers &= ~commonPackers;
						packers |= CODENWEB_TEXTURE_PACKER;
					} else if(/ {2}<SubTexture/.test(data) || /y="[^"]+"  width="[^"]+"/.test(data)) {
						packers &= ~commonPackers;
						packers |= FREE_TEX_PACKER;
					}

					if(hasPacker(HEROIC_PACKER)) {
						detectedPackers.push('Heroic Packer' + (isCredited(HEROIC_PACKER) ? '' : ' (Uncredited)'));
					}
					if(hasPacker(ADOBE_ANIMATE)) {
						detectedPackers.push('Adobe Animate' + (isCredited(ADOBE_ANIMATE) ? '' : ' (Uncredited)'));
					}
					if(hasPacker(FREE_TEX_PACKER)) {
						detectedPackers.push('FreeTexturePacker' + (isCredited(FREE_TEX_PACKER) ? '' : ' (Uncredited)'));
					}
					if(hasPacker(LESHY_PACKER)) {
						detectedPackers.push('Leshy Packer');
					}
					if(hasPacker(CODENWEB_TEXTURE_PACKER)) {
						const credited = isCredited(CODENWEB_TEXTURE_PACKER);
						let str = 'CodeAndWeb TexturePacker';
						if(!credited) {
							if(header_is_animate)
								str += ' (Uncredited, Could be Adobe Animate)';
							else
								str += ' (Uncredited, prob: 0.45)';
						}
						detectedPackers.push(str);
					}
					if(hasPacker(UNCERTAINPROD_PACKER_WEB)) {
						detectedPackers.push('UncertainProd Web Packer' + (isCredited(UNCERTAINPROD_PACKER_WEB) ? '' : ' (Uncredited)'));
					}
					if(hasPacker(UNCERTAINPROD_PACKER_APP)) {
						detectedPackers.push('UncertainProd Packer Desktop');
					}

				}

				this.setState({detectedPacker: detectedPackers.join(', ')});
			}
		});
	}

	updateView = () => {
		this.updateTexture();
		this.updateFrames();
	}

	changeSplitter = (e: React.ChangeEvent<HTMLSelectElement>) => {
		const splitter = splitterMaster.getSplitterFromName(e.target.value);

		splitterMaster.loadSplitter(splitter);
		this.updateView();
	}

	setBack = (e: React.MouseEvent<HTMLDivElement>) => {
		const classNames = (e.target as HTMLDivElement).className.split(" ");
		for(const name of classNames) {
			if(this.textureBackColors.indexOf(name as TextureBack[number]) >= 0) {
				this.setState({textureBack: name});

				const canvas = this.viewRef.current;
				canvas.className = name;

				return;
			}
		}
	}

	updateTextureScale = (val=this.state.scale) => {
		if(this.texture) {
			const w = Math.floor(this.texture.width * val);
			const h = Math.floor(this.texture.height * val);

			const canvas = this.viewRef.current;
			canvas.style.width = w + 'px';
			canvas.style.height = h + 'px';
		}
	}

	changeScale = (e: React.ChangeEvent<HTMLInputElement>) => {
		const val = Number(e.target.value);
		this.setState({scale: val});
		this.updateTextureScale(val);
	}

	onUpdateFileNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		const val = e.target.checked;
		this.setState({updateFileName: val});
		PackProperties.i.packOptions.repackUpdateFileName = val;
		PackProperties.i.saveOptions();
		TypedObserver.packExporterChanged.emit(PackProperties.i.getPackOptions());
	}

	close = () => {
		Observer.emit(GLOBAL_EVENT.HIDE_SHEET_SPLITTER);
	}

	getCurrentSplitter = () => {
		return splitterMaster.getCurrentSplitter();
	}

	override render() {
		const currentSplitterName = this.getCurrentSplitter().splitterName;

		let displayGridProperties = 'none';

		switch (currentSplitterName) {
			case "Grid": {
				displayGridProperties = '';
				break;
			}
		}

		const displayAtlasProperties = (currentSplitterName === ATLAS_SPLITTER || this.state.animationName) ? '' : 'none';

		return (
			<div className="sheet-splitter-overlay">
				<div className="sheet-splitter-content">
					<div className="sheet-splitter-top">
						<table>
							<tbody>
								<tr>
									<td>
										<div className="btn back-800 border-color-gray color-white file-upload">
											{I18.f("SELECT_TEXTURE")}
											<input type="file" ref={this.selectTextureInputRef} accept="image/png,image/jpg,image/jpeg,image/gif" onChange={this.selectTexture} />
										</div>
									</td>
									<td>
										<div className="back-400 border-color-gray color-black sheet-splitter-info-text" ref={this.fileNameRef}>&nbsp;</div>
									</td>
									<td>
										<div className="btn back-800 border-color-gray color-white file-upload">
											{I18.f("SELECT_DATA_FILE")}
											<input type="file" ref={this.selectTextureInputRef} multiple onChange={this.selectDataFile} />
										</div>
									</td>
									<td>
										<div className="back-400 border-color-gray color-black sheet-splitter-info-text" ref={this.dataFileNameRef}>&nbsp;</div>
									</td>
								</tr>
							</tbody>
						</table>
					</div>

					<div ref={this.wheelRef} className="sheet-splitter-view">
						<canvas ref={this.viewRef}/>
					</div>

					<div className="sheet-splitter-controls">
						<table>
							<tbody>
								<tr>
									<td>{I18.f('FORMAT')}</td>
									<td>
										<select ref={this.dataFormatRef} className="border-color-gray" value={currentSplitterName} onChange={this.changeSplitter}>
											{splitterMaster.getListOfSplittersNames().map(name => {
												return (<option key={"data-format-" + name} defaultValue={name}>{name}</option>)
											})}
										</select>
									</td>
								</tr>
								<tr>
									<td>{I18.f('UPDATE_FILENAME')}</td>
									<td>
										<input ref={this.updateFileNameRef} type="checkbox" className="border-color-gray" defaultChecked={this.state.updateFileName} onChange={this.onUpdateFileNameChange}/>
									</td>
								</tr>
								<tr>
									<td>{I18.f('DISABLE_UNTRIM')}</td>
									<td>
										<input ref={this.disableUntrimRef} type="checkbox" className="border-color-gray"/>
									</td>
								</tr>
								<tr style={{display: displayAtlasProperties}} title={"The Animation.json of the texture atlas (optional).\nWith it the Atlas Spritemap format can trim and scale the sprites, and it gets exported along with them."}>
									<td>Animation.json</td>
									<td>
										<div className="btn back-800 border-color-gray color-white file-upload" title={this.state.animationName ?? ""}>
											{this.state.animationName ? "Change" : "Select"}
											<input type="file" accept=".json,application/json" onChange={this.selectAnimationFile} />
										</div>
										{this.state.animationName ? <div className="btn back-800 border-color-gray color-white" style={{minWidth: 0}} title="Remove the Animation.json" onClick={this.removeAnimation}>X</div> : null}
									</td>
								</tr>
								<tr style={{display: displayGridProperties}}>
									<td>{I18.f('WIDTH')}</td>
									<td>
										<input type="number" ref={this.widthRef} defaultValue='64' onChange={this.updateView}/>
									</td>
								</tr>
								<tr style={{display: displayGridProperties}}>
									<td>{I18.f('HEIGHT')}</td>
									<td>
										<input type="number" ref={this.heightRef} defaultValue='64' onChange={this.updateView}/>
									</td>
								</tr>
								<tr style={{display: displayGridProperties}}>
									<td>{I18.f('PADDING')}</td>
									<td>
										<input type="number" ref={this.paddingRef} defaultValue='0' onChange={this.updateView}/>
									</td>
								</tr>
							</tbody>
						</table>
					</div>

					<div className="sheet-splitter-info">
						{this.state.message ? <table>
							<thead>
								<tr>
									<th>Info:</th>
								</tr>
							</thead>
							<tbody>
								<tr>
									<td>
										{this.state.message}
									</td>
								</tr>
							</tbody>
						</table> : null}
						{this.state.detectedPacker ? <table>
							<thead>
								<tr>
									<th>Detected Packer:</th>
								</tr>
							</thead>
							<tbody>
								<tr>
									<td>
										{this.state.detectedPacker}
									</td>
								</tr>
							</tbody>
						</table> : null}
					</div>

					<div className="sheet-splitter-bottom">
						<table>
							<tbody>
								<tr>
									{this.textureBackColors.map(name => {
										return (
											<td key={"back-color-btn-" + name}>
												<div className={"btn-back-color " + name + (this.state.textureBack === name ? " selected" : "")} onClick={this.setBack}>&nbsp;</div>
											</td>
										)
									})}

									<td>
										{I18.f("SCALE")}
									</td>
									<td style={{width: "65%"}}>
										<input ref={this.rangeRef} style={{width: "100%"}} type="range" min="0.1" max="2" step={this.step} defaultValue="1" onChange={this.changeScale}/>
									</td>
								</tr>
							</tbody>
						</table>

						<div>
							<div className="btn back-800 border-color-gray color-white" onClick={this.doRepack}>{I18.f("REPACK")}</div>
							<div className="btn back-800 border-color-gray color-white" onClick={this.doExport}>{I18.f("EXPORT")}</div>
							<div className="btn back-800 border-color-gray color-white" onClick={this.close}>{I18.f("CLOSE")}</div>
						</div>
					</div>
				</div>
			</div>
		);
	}
}

export default SheetSplitter;