import * as React from 'react';
import I18 from '../locale/I18';
import { smartSortImages} from 'api/utils/common';
import type { PackResultsData } from 'types';
import type { Rect } from 'api/types';
import TypedObserver from 'TypedObserver';
import type { TextureBack } from './SheetSplitter';
import { GLOBAL_EVENT, Observer } from '../Observer';
import APP from '../APP';
import ImagesList from './ImagesList';
import { getAnimationOffsetAt, parseAnimationJson, WHOLE_ANIMATION, type AnimationLabel, type AnimationOffset } from 'api/utils/AnimateAtlas';
import { AnimateTimeline, concatMatrix, type AtlasDraw, type AtlasMatrix } from 'api/utils/AnimateTimeline';
import type { AnimationFile } from 'api/FunkinPackerApi';
import { animationKey, animationLabel, groupFrames, guessAnimationName, importedSettings, labelGroups, parseCharacterFile, resolveAnimations, type ImportedCharacter, type ResolvedAnimation } from 'api/utils/Character';
import PackProperties from './PackProperties';
import type { ButtonData } from './MessageBox';
import { holdFrame, moveFrame, removeFrame } from 'api/utils/FrameTiming';
import { flattenAtlas } from '../utils/AtlasFlattener';
import { alignOffsets, alignReference, findFeet } from 'api/utils/AutoAlign';
import { blendModeCss } from '../utils/BlendModes';

interface Props {
	readonly start: boolean;
	readonly textureBack: TextureBack[number];
	readonly data: PackResultsData[];
	readonly blendMode: string;
}

interface State {
	atlas: boolean;
	labels: AnimationLabel[];
	label: string;
	ghost: string;
	offsetX: string;
	offsetY: string;
	animations: ResolvedAnimation[];
	animation: string | null;
	animationGhost: string | null;
	prefix: string;
	animName: string;
	loop: boolean;
	paused: boolean;
	frameLabel: string;
	frameOffsetX: string;
	frameOffsetY: string;
}

type Texture = {
	readonly config: Rect,
	readonly baseTexture: HTMLCanvasElement
}

type AtlasPlayback = {
	readonly timeline: AnimateTimeline,
	readonly sprites: Map<string, Texture>,
	readonly data: PackResultsData[],
	readonly animation: AnimationFile,
	view: AtlasMatrix,
	start: number,
	length: number,
	ghostFrame: number | null
}

type FramesView = {
	zoom: number,
	x: number,
	y: number
}

const VIEW_LIMIT = 1024;
const VIEW_MARGIN = 8;
const MIN_VIEW_WIDTH = 256;
const MIN_VIEW_HEIGHT = 200;
const GHOST_ALPHA = 0.35;
const ANIMATION_VALUE = "a:";
const NO_OFFSET: AnimationOffset = { x: 0, y: 0 };

function frameFile(config: Rect) {
	return config.originalFile || config.file || "";
}

function showOffset(value: number, scale: number) {
	return (Math.round(value * scale * 1000) / 1000).toString(10);
}

function prefixOf(key: string) {
	return key.substring(key.lastIndexOf("/") + 1);
}

class SpritesPlayer extends React.Component<Props, State> {
	private readonly fpsRef: React.RefObject<HTMLInputElement> = React.createRef();
	private readonly speedRef: React.RefObject<HTMLInputElement> = React.createRef();
	private readonly bufferRef: React.RefObject<HTMLCanvasElement> = React.createRef();
	private readonly viewRef: React.RefObject<HTMLCanvasElement> = React.createRef();
	private readonly playerContainerRef: React.RefObject<HTMLDivElement> = React.createRef();
	private readonly containerRef: React.RefObject<HTMLDivElement> = React.createRef();
	private textures: Texture[];
	private currentTextures: Texture[];
	private currentFrame: number = 0;
	private width: number = 0;
	private height: number = 0;
	private selectedImages: string[];
	private atlas: AtlasPlayback | null = null;
	private framesData: PackResultsData[] | null = null;
	private framesWidth: number = 0;
	private framesHeight: number = 0;
	private framesView: FramesView = { zoom: 1, x: 0, y: 0 };
	private selectedAnimation: string | null = null;
	private ghostAnimation: string | null = null;
	private paused: boolean = false;
	private pendingFrame: number | null = null;
	private ghostTexture: Texture | null = null;
	private alignCanvas: HTMLCanvasElement | null = null;

	private updateTimer: NodeJS.Timeout | number | null = null;

	constructor(props: Props) {
		super(props);

		this.textures = [];
		this.currentTextures = [];
		this.selectedImages = [];

		this.state = {
			atlas: false,
			labels: [],
			label: "",
			ghost: "",
			offsetX: "0",
			offsetY: "0",
			animations: [],
			animation: null,
			animationGhost: null,
			prefix: "",
			animName: "",
			loop: false,
			paused: false,
			frameLabel: "",
			frameOffsetX: "0",
			frameOffsetY: "0"
		};
	}

	override componentDidMount = () => {
		TypedObserver.imagesListSelectedChanged.on(this.onImagesSelected, this);

		if(this.props.start) this.setup();
		else this.stop();
	}

	override componentWillUnmount = () => {
		this.stop();
	}

	onImagesSelected = (list: string[]) => {
		this.selectedImages = list;
		if(this.atlas || this.selectedAnimation !== null) return;
		this.updateCurrentTextures();
	}

	override componentDidUpdate = () => {
		if(this.props.start) this.setup();
		else this.stop();
	}

	setup = () => {
		this.playerContainerRef.current.className = "player-view-container " + this.props.textureBack;

		const animation = APP.i.api.getAnimation();
		if(animation && this.props.data && this.props.data.length && this.setupAtlas(animation)) return;

		if(this.atlas) {
			this.atlas = null;
			this.framesData = null;
			this.setState({atlas: false, labels: [], label: "", ghost: "", offsetX: "0", offsetY: "0"});
		}

		if(this.framesData === this.props.data && this.updateTimer) return;
		this.framesData = this.props.data;

		this.textures = [];

		if(!this.props.data) return;

		this.width = 0;
		this.height = 0;

		for(const part of this.props.data) {
			const baseTexture = part.buffer;

			for (const config of part.data) {
				const {w, h} = SpritesPlayer.getFrameSize(config);

				if (this.width < w) this.width = w;
				if (this.height < h) this.height = h;

				this.textures.push({
					config: config,
					baseTexture: baseTexture
				});
			}
		}

		if(this.width < 256) this.width = 256;
		if(this.height < 200) this.height = 200;

		this.framesWidth = this.width;
		this.framesHeight = this.height;

		const canvas = this.viewRef.current;
		canvas.width = this.width;
		canvas.height = this.height;

		this.refreshAnimations();
		this.updateCurrentTextures();
	}

	setupAtlas = (animation: AnimationFile) => {
		if(this.atlas && this.atlas.data === this.props.data && this.atlas.animation === animation) {
			if(!this.updateTimer) this.update(true);
			return true;
		}

		const json = parseAnimationJson(APP.i.getPackedAnimation(false) ?? "");
		if(!json) return false;

		const sprites = new Map<string, Texture>();
		for(const part of this.props.data) {
			for(const config of part.data) {
				const file = (config.originalFile || config.file || "").split("/").pop();
				if(!file) continue;

				const texture = { config, baseTexture: part.buffer };
				const dot = file.lastIndexOf(".");
				if(dot > 0 && !sprites.has(file.substring(0, dot))) sprites.set(file.substring(0, dot), texture);
				if(!sprites.has(file)) sprites.set(file, texture);
			}
		}

		const timeline = new AnimateTimeline(json);
		const previous = this.atlas && this.atlas.animation === animation ? this.atlas : null;
		const labelIndex = previous ? timeline.labels.findIndex(item => item.start === previous.start && item.length === previous.length) : -1;
		const label = timeline.labels[labelIndex];
		const ghostIndex = previous ? timeline.labels.findIndex(item => item.start === previous.ghostFrame) : -1;

		this.atlas = {
			timeline,
			sprites,
			data: this.props.data,
			animation,
			view: [1, 0, 0, 1, 0, 0],
			start: label ? label.start : 0,
			length: label ? label.length : timeline.frameCount,
			ghostFrame: ghostIndex >= 0 ? timeline.labels[ghostIndex].start : null
		};

		const fps = Math.max(1, Math.min(60, Math.round(timeline.frameRate)));
		if(!previous) {
			this.speedRef.current.value = fps.toString(10);
			this.fpsRef.current.textContent = fps + " fps";
		}

		this.setState({
			atlas: true,
			labels: timeline.labels,
			label: label ? labelIndex.toString(10) : "",
			ghost: ghostIndex >= 0 ? ghostIndex.toString(10) : "",
			...this.shownOffset(label ? label.name : WHOLE_ANIMATION)
		});
		this.fitAtlasView();
		this.currentFrame = 0;
		this.update(true);

		return true;
	}

	shownOffset = (name: string) => {
		const stored = APP.i.api.getAnimationOffsets().get(name);
		const scale = APP.i.getPackScale();

		return {
			offsetX: showOffset(stored ? stored.x : 0, scale),
			offsetY: showOffset(stored ? stored.y : 0, scale)
		};
	}

	offsetAt = (frame: number) => {
		const offset = getAnimationOffsetAt(this.atlas.timeline.labels, APP.i.api.getAnimationOffsets(), frame);
		const scale = APP.i.getPackScale();

		return { x: offset.x * scale, y: offset.y * scale };
	}

	fitAtlasView = () => {
		const atlas = this.atlas;
		if(!atlas) return;

		let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;

		const include = (draws: AtlasDraw[], dx: number, dy: number) => {
			for(const draw of draws) {
				const texture = atlas.sprites.get(draw.name);
				if(!texture) continue;

				const w = texture.config.frame.w;
				const h = texture.config.frame.h;
				const m = draw.matrix;

				for(const [x, y] of [[0, 0], [w, 0], [0, h], [w, h]]) {
					const px = m[0] * x + m[2] * y + m[4] + dx;
					const py = m[1] * x + m[3] * y + m[5] + dy;
					if(px < left) left = px;
					if(px > right) right = px;
					if(py < top) top = py;
					if(py > bottom) bottom = py;
				}
			}
		};

		for(let frame = atlas.start; frame < atlas.start + atlas.length; frame++) {
			const draws = atlas.timeline.getDraws(frame);
			const offset = this.offsetAt(frame);

			include(draws, offset.x, offset.y);
			if(offset.x !== 0 || offset.y !== 0) include(draws, 0, 0);
		}

		if(atlas.ghostFrame !== null) {
			const offset = this.offsetAt(atlas.ghostFrame);
			include(atlas.timeline.getDraws(atlas.ghostFrame), offset.x, offset.y);
		}

		if(left > right || top > bottom) {
			left = 0;
			top = 0;
			right = 0;
			bottom = 0;
		}

		const zoom = Math.min(1, VIEW_LIMIT / Math.max(1, right - left, bottom - top));
		const contentWidth = Math.ceil((right - left) * zoom) + VIEW_MARGIN * 2;
		const contentHeight = Math.ceil((bottom - top) * zoom) + VIEW_MARGIN * 2;

		this.width = Math.max(MIN_VIEW_WIDTH, contentWidth);
		this.height = Math.max(MIN_VIEW_HEIGHT, contentHeight);

		atlas.view = [
			zoom, 0, 0, zoom,
			(this.width - contentWidth) / 2 + VIEW_MARGIN - left * zoom,
			(this.height - contentHeight) / 2 + VIEW_MARGIN - top * zoom
		];

		const canvas = this.viewRef.current;
		canvas.width = this.width;
		canvas.height = this.height;
	}

	onLabelChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
		const atlas = this.atlas;
		if(!atlas) return;

		const label = e.target.value === "" ? null : atlas.timeline.labels[Number(e.target.value)];
		atlas.start = label ? label.start : 0;
		atlas.length = label ? label.length : atlas.timeline.frameCount;

		this.setState({label: e.target.value, ...this.shownOffset(label ? label.name : WHOLE_ANIMATION)});
		this.fitAtlasView();
		this.currentFrame = 0;
		this.update(true);
	}

	onGhostChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
		const atlas = this.atlas;
		if(!atlas) return;

		const label = e.target.value === "" ? null : atlas.timeline.labels[Number(e.target.value)];
		atlas.ghostFrame = label ? label.start : null;

		this.setState({ghost: e.target.value});
		this.fitAtlasView();
		this.renderAtlas();
	}

	setOffset = (offsetX: string, offsetY: string) => {
		const atlas = this.atlas;
		if(!atlas) {
			this.setCharacterOffset(offsetX, offsetY);
			return;
		}

		const label = this.state.label === "" ? null : atlas.timeline.labels[Number(this.state.label)];
		const scale = APP.i.getPackScale() || 1;

		APP.i.api.setAnimationOffset(label ? label.name : WHOLE_ANIMATION, {
			x: (Number(offsetX) || 0) / scale,
			y: (Number(offsetY) || 0) / scale
		});

		this.setState({offsetX, offsetY});
		this.fitAtlasView();
		this.renderAtlas();
	}

	onOffsetXChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		this.setOffset(e.target.value, this.state.offsetY);
	}

	onOffsetYChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		this.setOffset(this.state.offsetX, e.target.value);
	}

	resetOffset = () => {
		this.setOffset("0", "0");
	}

	frameGroups = () => {
		return groupFrames(this.textures.map(texture => {
			const file = frameFile(texture.config);
			return { file, name: file, duration: texture.config.duration };
		}));
	}

	getAnimations = () => {
		return resolveAnimations(this.frameGroups(), APP.i.api.getCharacterAnimations());
	}

	onCharacterPicked = async (e: React.ChangeEvent<HTMLInputElement>) => {
		const file = e.target.files?.[0];
		e.target.value = "";
		if(!file) return;

		let character: ImportedCharacter;
		try {
			character = parseCharacterFile(await file.text());
		}
		catch (error) {
			TypedObserver.showMessage.emit(I18.f("CHARACTER_IMPORT_ERROR", file.name));
			return;
		}

		const groups = this.atlas ? labelGroups(this.atlas.timeline.labels, this.atlas.timeline.frameRate) : this.frameGroups();
		const { settings, missing } = importedSettings(character, groups);
		for(const [key, values] of settings) APP.i.api.setCharacterAnimation(key, values);

		APP.i.api.setImportedCharacter(character);
		PackProperties.i.setCharacterFile(character.format);

		this.refreshAnimations();
		if(this.selectedAnimation !== null) {
			this.fitFramesView();
			this.renderFrames();
		}

		const found = character.animations.length - missing.length;
		let message = I18.f("CHARACTER_IMPORTED", file.name, String(found), String(character.animations.length));
		if(missing.length) message += " " + I18.f("CHARACTER_IMPORT_MISSING", missing.join(", "));
		TypedObserver.showMessage.emit(message);
	}

	frameFields = () => {
		const texture = this.currentTextures[this.currentFrame];
		const rect = texture?.config.image?.rect;
		if(!texture || !rect) return { frameLabel: "", frameOffsetX: "0", frameOffsetY: "0" };

		const scale = APP.i.getPackScale() || 1;
		const base = rect.importedOffset ?? rect.frameSize;

		return {
			frameLabel: (this.currentFrame + 1) + " / " + this.currentTextures.length + "  " + prefixOf(frameFile(texture.config)),
			frameOffsetX: showOffset(base.x - rect.frameSize.x, scale),
			frameOffsetY: showOffset(base.y - rect.frameSize.y, scale)
		};
	}

	togglePause = () => {
		this.paused = !this.paused;
		this.setState({ paused: this.paused, ...this.frameFields() });
	}

	stepFrame = (step: number) => {
		const count = this.currentTextures.length;
		if(!count) return;

		this.paused = true;
		this.currentFrame = (this.currentFrame + step + count) % count;
		this.setState({ paused: true, ...this.frameFields() });
		this.update(true);
	}

	previousFrame = () => {
		this.stepFrame(-1);
	}

	nextFrame = () => {
		this.stepFrame(1);
	}

	setFrameOffset = (offsetX: string, offsetY: string) => {
		const rect = this.currentTextures[this.currentFrame]?.config.image?.rect;
		if(!rect) return;

		const scale = APP.i.getPackScale() || 1;
		rect.importedOffset ??= { x: rect.frameSize.x, y: rect.frameSize.y };
		rect.frameSize.x = rect.importedOffset.x - Math.round(Number(offsetX) || 0) / scale;
		rect.frameSize.y = rect.importedOffset.y - Math.round(Number(offsetY) || 0) / scale;

		this.setState({ frameOffsetX: offsetX, frameOffsetY: offsetY });
		if(this.selectedAnimation !== null) this.fitFramesView(true);
		this.update(true);
	}

	onFrameOffsetXChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		this.setFrameOffset(e.target.value, this.state.frameOffsetY);
	}

	onFrameOffsetYChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		this.setFrameOffset(this.state.frameOffsetX, e.target.value);
	}

	resetFrameOffset = () => {
		this.setFrameOffset("0", "0");
	}

	editTiming = (sequence: string[], frame: number) => {
		const key = this.selectedAnimation;
		if(key === null) return;

		this.pendingFrame = frame;
		if(!ImagesList.i.retimeAnimation(key, sequence)) this.pendingFrame = null;
	}

	frameSequence = () => {
		return this.currentTextures.map(texture => frameFile(texture.config));
	}

	moveFrameEarlier = () => {
		const index = this.currentFrame;
		if(index > 0) this.editTiming(moveFrame(this.frameSequence(), index, -1), index - 1);
	}

	moveFrameLater = () => {
		const index = this.currentFrame;
		if(index < this.currentTextures.length - 1) this.editTiming(moveFrame(this.frameSequence(), index, 1), index + 1);
	}

	holdCurrentFrame = () => {
		this.editTiming(holdFrame(this.frameSequence(), this.currentFrame), this.currentFrame);
	}

	deleteCurrentFrame = () => {
		const sequence = this.frameSequence();
		if(sequence.length > 1) this.editTiming(removeFrame(sequence, this.currentFrame), Math.min(this.currentFrame, sequence.length - 2));
	}

	convertAtlas = () => {
		const buttons: ButtonData[] = [
			{name: "yes", caption: I18.f("YES"), callback: this.doConvertAtlas},
			{name: "no", caption: I18.f("NO")}
		];

		TypedObserver.showMessage.emit(I18.f("CONVERT_ATLAS_CONFIRM"), buttons);
	}

	doConvertAtlas = async () => {
		const animation = APP.i.api.getAnimation();
		if(!animation) return;

		Observer.emit(GLOBAL_EVENT.SHOW_PROCESSING);
		const result = await flattenAtlas(animation, APP.i.images, APP.i.api.getAnimationOffsets()).catch((): null => null);
		Observer.emit(GLOBAL_EVENT.HIDE_PROCESSING);

		if(!result) {
			TypedObserver.showMessage.emit(I18.f("CONVERT_ATLAS_ERROR"));
			return;
		}

		APP.i.api.setAnimation(null);
		APP.i.api.setAtlasMeta(null);
		APP.i.api.clearOrder();

		ImagesList.i.setImages(ImagesList.i.sortImages(result.images));
		TypedObserver.imagesListSelectedChanged.emit([]);
		PackProperties.i.setOptions({ ...PackProperties.i.packOptions, exporter: "Sparrow" });

		let message = I18.f("CONVERT_ATLAS_DONE", String(result.frames), String(result.animations));
		if(result.missing.length) message += " " + I18.f("CONVERT_ATLAS_MISSING", result.missing.join(", "));
		TypedObserver.showMessage.emit(message);
	}

	animationFields = (animation: ResolvedAnimation | undefined) => {
		if(!animation) {
			return { prefix: "", animName: "", loop: false, offsetX: "0", offsetY: "0" };
		}

		const scale = APP.i.getPackScale();

		return {
			prefix: prefixOf(animation.key),
			animName: animation.anim,
			loop: animation.loop,
			offsetX: showOffset(animation.offset.x, scale),
			offsetY: showOffset(animation.offset.y, scale)
		};
	}

	refreshAnimations = () => {
		const animations = this.getAnimations();
		const exists = (key: string | null) => key !== null && animations.some(item => item.key === key);

		if(!exists(this.selectedAnimation)) this.selectedAnimation = null;
		if(!exists(this.ghostAnimation) || this.ghostAnimation === this.selectedAnimation) this.ghostAnimation = null;

		this.setState({
			animations,
			animation: this.selectedAnimation,
			animationGhost: this.ghostAnimation,
			...this.animationFields(animations.find(item => item.key === this.selectedAnimation))
		});
	}

	selectAnimation = (key: string | null) => {
		const animations = this.getAnimations();
		const animation = key === null ? undefined : animations.find(item => item.key === key);

		this.selectedAnimation = animation ? animation.key : null;
		if(this.ghostAnimation === this.selectedAnimation) this.ghostAnimation = null;

		if(animation) {
			this.speedRef.current.value = animation.fps.toString(10);
			this.fpsRef.current.textContent = animation.fps + " fps";
		}

		this.setState({
			animations,
			animation: this.selectedAnimation,
			animationGhost: this.ghostAnimation,
			...this.animationFields(animation)
		});
		this.updateCurrentTextures();
	}

	onAnimationChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
		const value = e.target.value;
		this.selectAnimation(value === "" ? null : value.substring(ANIMATION_VALUE.length));
	}

	onAnimationGhostChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
		const value = e.target.value;
		this.ghostAnimation = value === "" ? null : value.substring(ANIMATION_VALUE.length);

		this.setState({animationGhost: this.ghostAnimation});
		this.fitFramesView();
		this.renderFrames();
	}

	onPrefixChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		this.setState({prefix: e.target.value});
	}

	onPrefixKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
		if(e.key === "Enter") e.currentTarget.blur();
	}

	commitPrefix = (e: React.FocusEvent<HTMLInputElement>) => {
		const key = this.selectedAnimation;
		if(key === null) return;

		const current = prefixOf(key);
		const prefix = e.currentTarget.value.trim();

		if(!prefix || prefix === current) {
			this.setState({prefix: current});
			return;
		}

		const renamed = ImagesList.i.renameAnimation(key, prefix);
		if(renamed === null) {
			this.setState({prefix: current});
			return;
		}

		this.selectedAnimation = renamed;
		this.setState({animation: renamed, prefix: prefixOf(renamed)});
	}

	onAnimNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		const key = this.selectedAnimation;
		if(key === null) return;

		APP.i.api.setCharacterAnimation(key, {anim: e.target.value.trim()});
		this.setState({animName: e.target.value});
	}

	onLoopChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		const key = this.selectedAnimation;
		if(key === null) return;

		APP.i.api.setCharacterAnimation(key, {loop: e.target.checked});
		this.setState({loop: e.target.checked});
	}

	setCharacterOffset = (offsetX: string, offsetY: string) => {
		const key = this.selectedAnimation;
		if(key === null) return;

		const scale = APP.i.getPackScale() || 1;

		APP.i.api.setCharacterAnimation(key, {
			offset: {
				x: (Number(offsetX) || 0) / scale,
				y: (Number(offsetY) || 0) / scale
			}
		});

		this.setState({offsetX, offsetY});
		this.fitFramesView(true);
		this.renderFrames();
	}

	frameFeet = (texture: Texture): AnimationOffset | null => {
		const frame = texture.config.frame;
		if(frame.w < 1 || frame.h < 1) return null;

		if(!this.alignCanvas) this.alignCanvas = document.createElement("canvas");
		const canvas = this.alignCanvas;
		canvas.width = frame.w;
		canvas.height = frame.h;

		const ctx = canvas.getContext("2d", {willReadFrequently: true});
		if(!ctx) return null;

		ctx.setTransform(1, 0, 0, 1, 0, 0);
		ctx.clearRect(0, 0, frame.w, frame.h);

		if(texture.config.rotated) {
			ctx.transform(0, -1, 1, 0, 0, frame.h);
			ctx.drawImage(texture.baseTexture,
				frame.x, frame.y,
				frame.h, frame.w,
				0, 0,
				frame.h, frame.w);
		}
		else {
			ctx.drawImage(texture.baseTexture,
				frame.x, frame.y,
				frame.w, frame.h,
				0, 0,
				frame.w, frame.h);
		}

		const feet = findFeet(ctx.getImageData(0, 0, frame.w, frame.h).data, frame.w, frame.h);
		if(!feet) return null;

		const placement = this.framePlacement(texture.config);
		return { x: placement.x + feet.x, y: placement.y + feet.y };
	}

	autoAlign = () => {
		const animations = this.getAnimations();
		const reference = alignReference(animations);
		if(!reference) return;

		const feet = new Map<string, AnimationOffset>();
		for(const animation of animations) {
			const first = this.animationTextures(animation.key)[0];
			const point = first ? this.frameFeet(first) : null;
			if(point) feet.set(animation.key, point);
		}

		const scale = APP.i.getPackScale() || 1;
		const offsets = alignOffsets(feet, reference.key, { x: reference.offset.x * scale, y: reference.offset.y * scale });
		if(!offsets.size) return;

		const apply = () => {
			for(const [key, offset] of offsets) {
				APP.i.api.setCharacterAnimation(key, { offset: { x: offset.x / scale, y: offset.y / scale } });
			}

			if(this.selectedAnimation !== null && this.selectedAnimation !== reference.key && this.ghostAnimation === null) {
				this.ghostAnimation = reference.key;
			}

			this.refreshAnimations();

			if(this.selectedAnimation !== null) {
				this.fitFramesView();
				this.renderFrames();
			}
		};

		const replaces = animations.some(animation => offsets.has(animation.key) && (animation.offset.x !== 0 || animation.offset.y !== 0));
		if(!replaces) {
			apply();
			return;
		}

		TypedObserver.showMessage.emit(I18.f("PLAYER_AUTO_ALIGN_CONFIRM", animationLabel(reference.key)), [
			{ name: "yes", caption: I18.f("YES"), callback: apply },
			{ name: "no", caption: I18.f("NO") }
		]);
	}

	characterOffset = (key: string | null): AnimationOffset => {
		const offset = key === null ? undefined : APP.i.api.getCharacterAnimations().get(key)?.offset;
		if(!offset) return NO_OFFSET;

		const scale = APP.i.getPackScale();
		return { x: offset.x * scale, y: offset.y * scale };
	}

	animationTextures = (key: string) => {
		return this.textures
			.filter(texture => animationKey(frameFile(texture.config)) === key)
			.sort((a, b) => smartSortImages(frameFile(a.config), frameFile(b.config)));
	}

	framePlacement = (config: Rect) => {
		const scale = APP.i.getPackScale() || 1;
		const cropped = config.trimmed && APP.i.packOptions.trimMode === "crop";

		return {
			x: (cropped ? 0 : Math.round(config.spriteSourceSize.x * scale)) + Math.round(config.frameSize.x * scale),
			y: (cropped ? 0 : Math.round(config.spriteSourceSize.y * scale)) + Math.round(config.frameSize.y * scale),
			w: config.frame.w,
			h: config.frame.h
		};
	}

	resizeView = (width: number, height: number) => {
		this.width = width;
		this.height = height;

		const canvas = this.viewRef.current;
		if(canvas.width !== width) canvas.width = width;
		if(canvas.height !== height) canvas.height = height;
	}

	fitFramesView = (keepIfFits: boolean = false) => {
		this.ghostTexture = this.ghostAnimation === null ? null : this.animationTextures(this.ghostAnimation)[0] ?? null;

		let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;

		const include = (texture: Texture, offset: AnimationOffset) => {
			const placement = this.framePlacement(texture.config);
			const x = placement.x - offset.x;
			const y = placement.y - offset.y;

			if(x < left) left = x;
			if(y < top) top = y;
			if(x + placement.w > right) right = x + placement.w;
			if(y + placement.h > bottom) bottom = y + placement.h;
		};

		const offset = this.characterOffset(this.selectedAnimation);
		for(const texture of this.currentTextures) {
			include(texture, offset);
			include(texture, NO_OFFSET);
		}

		if(this.ghostTexture) {
			include(this.ghostTexture, this.characterOffset(this.ghostAnimation));
			include(this.ghostTexture, NO_OFFSET);
		}

		if(left > right || top > bottom) {
			left = 0;
			top = 0;
			right = 0;
			bottom = 0;
		}

		if(keepIfFits) {
			const view = this.framesView;
			if(view.x + left * view.zoom >= 0 && view.y + top * view.zoom >= 0 &&
				view.x + right * view.zoom <= this.width && view.y + bottom * view.zoom <= this.height) return;
		}

		const zoom = Math.min(1, VIEW_LIMIT / Math.max(1, right - left, bottom - top));
		const contentWidth = Math.ceil((right - left) * zoom) + VIEW_MARGIN * 2;
		const contentHeight = Math.ceil((bottom - top) * zoom) + VIEW_MARGIN * 2;
		const width = Math.max(MIN_VIEW_WIDTH, contentWidth);
		const height = Math.max(MIN_VIEW_HEIGHT, contentHeight);

		this.framesView = {
			zoom,
			x: (width - contentWidth) / 2 + VIEW_MARGIN - left * zoom,
			y: (height - contentHeight) / 2 + VIEW_MARGIN - top * zoom
		};

		this.resizeView(width, height);
	}

	private static getFrameSize(config:Rect) {
		let w = config.sourceSize.mw;
		let h = config.sourceSize.mh;

		let width = config.frameSize.w;
		let height = config.frameSize.h;
		let x = config.frameSize.x;
		let y = config.frameSize.y;
		if(x < 0) {
			width -= x;
			x = 0;
		}
		if(y < 0) {
			height -= y;
			y = 0;
		}

		w = Math.max(width, w);
		h = Math.max(height, h);

		return {w, h};
	}

	eventForceUpdate = (e: KeyboardEvent) => {
		if(!e) return;

		if(e.code === "Enter" && e.ctrlKey) {
			this.updateCurrentTextures();
			e.preventDefault();
			return;
		}

		let key = e.keyCode || e.which;
		if(key === 13) {
			this.updateCurrentTextures();
			e.preventDefault();
		}
	}

	onSpeedChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		this.fpsRef.current.textContent = e.target.value + " fps";

		if(!this.atlas && this.selectedAnimation !== null) {
			APP.i.api.setCharacterAnimation(this.selectedAnimation, {fps: Number(e.target.value)});
		}
	}

	updateCurrentTextures = () => {
		if(this.selectedAnimation !== null) {
			this.currentTextures = this.animationTextures(this.selectedAnimation);
			this.fitFramesView();
		}
		else {
			let textures:Texture[] = [];

			for(const tex of this.textures) {
				if(!tex.config.cloned && this.selectedImages.indexOf(tex.config.file) >= 0) {
					textures.push(tex);
				}

				if(tex.config.cloned && this.selectedImages.indexOf(tex.config.originalFile) >= 0) {
					textures.push(tex);
				}
			}

			textures = textures.sort((a, b) => {
				return smartSortImages(a.config.name, b.config.name);
			});

			this.currentTextures = textures;
			this.resizeView(this.framesWidth, this.framesHeight);
		}

		const pending = this.pendingFrame;
		this.pendingFrame = null;
		this.currentFrame = pending !== null && pending < this.currentTextures.length ? pending : 0;
		if(this.paused) this.setState(this.frameFields());
		this.update(true);
	}

	update = (skipFrameUpdate:boolean) => {
		if(this.updateTimer) clearTimeout(this.updateTimer);

		if(!skipFrameUpdate && (!this.paused || this.atlas)) {
			this.currentFrame++;
			if(this.currentFrame >= (this.atlas ? this.atlas.length : this.currentTextures.length)) {
				this.currentFrame = 0;
			}
		}

		if(this.atlas) this.renderAtlas();
		else if(this.selectedAnimation !== null) this.renderFrames();
		else this.renderTexture();

		this.updateTimer = setTimeout(this.update, 1000 / +this.speedRef.current.value);
	}

	renderAtlas = () => {
		const atlas = this.atlas;
		const ctx = this.viewRef.current.getContext("2d");
		if(!atlas || !ctx) return;

		ctx.setTransform(1, 0, 0, 1, 0, 0);
		ctx.globalAlpha = 1;
		ctx.clearRect(0, 0, this.width, this.height);

		if(atlas.ghostFrame !== null) this.drawAtlasFrame(ctx, atlas, atlas.ghostFrame, GHOST_ALPHA);
		this.drawAtlasFrame(ctx, atlas, atlas.start + this.currentFrame, 1);

		ctx.setTransform(1, 0, 0, 1, 0, 0);
		ctx.globalAlpha = 1;
	}

	drawAtlasFrame = (ctx: CanvasRenderingContext2D, atlas: AtlasPlayback, frameIndex: number, alpha: number) => {
		const offset = this.offsetAt(frameIndex);
		const view = concatMatrix(atlas.view, [1, 0, 0, 1, offset.x, offset.y]);

		for(const draw of atlas.timeline.getDraws(frameIndex)) {
			const texture = atlas.sprites.get(draw.name);
			if(!texture || draw.alpha <= 0) continue;

			const frame = texture.config.frame;
			const m = concatMatrix(view, draw.matrix);

			ctx.setTransform(m[0], m[1], m[2], m[3], m[4], m[5]);
			ctx.globalAlpha = draw.alpha * alpha;

			if(texture.config.rotated) {
				ctx.transform(0, -1, 1, 0, 0, frame.h);
				ctx.drawImage(texture.baseTexture,
					frame.x, frame.y,
					frame.h, frame.w,
					0, 0,
					frame.h, frame.w);
			}
			else {
				ctx.drawImage(texture.baseTexture,
					frame.x, frame.y,
					frame.w, frame.h,
					0, 0,
					frame.w, frame.h);
			}
		}
	}

	renderFrames = () => {
		const ctx = this.viewRef.current.getContext("2d");
		if(!ctx) return;

		ctx.setTransform(1, 0, 0, 1, 0, 0);
		ctx.globalAlpha = 1;
		ctx.clearRect(0, 0, this.width, this.height);

		if(this.ghostTexture) this.drawPlacedFrame(ctx, this.ghostTexture, this.characterOffset(this.ghostAnimation), GHOST_ALPHA);

		const texture = this.currentTextures[this.currentFrame];
		if(texture) this.drawPlacedFrame(ctx, texture, this.characterOffset(this.selectedAnimation), 1);

		ctx.setTransform(1, 0, 0, 1, 0, 0);
		ctx.globalAlpha = 1;
	}

	drawPlacedFrame = (ctx: CanvasRenderingContext2D, texture: Texture, offset: AnimationOffset, alpha: number) => {
		const view = this.framesView;
		const placement = this.framePlacement(texture.config);
		const frame = texture.config.frame;

		ctx.setTransform(view.zoom, 0, 0, view.zoom,
			view.x + (placement.x - offset.x) * view.zoom,
			view.y + (placement.y - offset.y) * view.zoom);
		ctx.globalAlpha = alpha;

		if(texture.config.rotated) {
			ctx.transform(0, -1, 1, 0, 0, frame.h);
			ctx.drawImage(texture.baseTexture,
				frame.x, frame.y,
				frame.h, frame.w,
				0, 0,
				frame.h, frame.w);
		}
		else {
			ctx.drawImage(texture.baseTexture,
				frame.x, frame.y,
				frame.w, frame.h,
				0, 0,
				frame.w, frame.h);
		}
	}

	renderTexture = () => {
		const ctx = this.viewRef.current.getContext("2d");
		if(!ctx) {
			Observer.emit(GLOBAL_EVENT.HIDE_PROCESSING);
			TypedObserver.showMessage.emit(I18.f('ERROR_NO_CONTEXT'));

			return;
		}

		ctx.clearRect(0, 0, this.width, this.height);

		const texture = this.currentTextures[this.currentFrame];
		if(!texture) return;

		const {w, h} = SpritesPlayer.getFrameSize(texture.config);

		const buffer = this.bufferRef.current;
		buffer.width = w;
		buffer.height = h;

		const bufferCtx = buffer.getContext("2d");
		if(!bufferCtx) {
			Observer.emit(GLOBAL_EVENT.HIDE_PROCESSING);
			TypedObserver.showMessage.emit(I18.f('ERROR_NO_CONTEXT'));

			return;
		}
		bufferCtx.clearRect(0, 0, w, h);

		let frameX = texture.config.spriteSourceSize.x;
		let frameY = texture.config.spriteSourceSize.y;
		let frameW = texture.config.spriteSourceSize.w;
		let frameH = texture.config.spriteSourceSize.h;
		let frameOffsetX = 0;
		let frameOffsetY = 0;

		frameX += texture.config.frameSize.x;
		frameY += texture.config.frameSize.y;

		if(frameX < 0) {
			frameW -= frameX;
			frameOffsetX -= frameX;
			frameX = 0;
		}
		if(frameY < 0) {
			frameH -= frameY;
			frameOffsetY -= frameY;
			frameY = 0;
		}

		if(texture.config.rotated) {
			bufferCtx.save();

			bufferCtx.translate(frameX + frameW/2, frameY + frameH/2);
			bufferCtx.rotate(-Math.PI/2);

			bufferCtx.drawImage(texture.baseTexture,
				texture.config.frame.x, texture.config.frame.y,
				texture.config.frame.h, texture.config.frame.w,
				-frameH/2, -frameW/2,
				texture.config.frame.h, texture.config.frame.w);

			bufferCtx.restore();
		}
		else {
			bufferCtx.drawImage(texture.baseTexture,
				texture.config.frame.x, texture.config.frame.y,
				texture.config.frame.w, texture.config.frame.h,
				frameX, frameY,
				texture.config.frame.w, texture.config.frame.h);
		}

		let x = this.width/2, y = this.height/2;
		x += frameOffsetX;
		y += frameOffsetY;

		ctx.drawImage(buffer,
			0, 0,
			w, h,
			x - w/2, y - h/2,
			w, h);
	}

	stop = () => {
		if(this.updateTimer) clearTimeout(this.updateTimer);
		this.updateTimer = null;
	}

	override render() {
		const framesMode = !this.state.atlas && this.state.animations.length > 0;
		const animationMode = framesMode && this.state.animation !== null;
		const selected = this.state.animations.find(item => item.key === this.state.animation);

		return (
			<div ref={this.containerRef} className="player-container">
				<div className="player-window border-color-gray">
					<div ref={this.playerContainerRef}>
						<canvas ref={this.viewRef} style={{mixBlendMode: blendModeCss(this.props.blendMode)}}></canvas>
						<canvas ref={this.bufferRef} className="player-buffer"></canvas>
					</div>
					<div>
						<table>
							<tbody>
							<tr style={{display: this.state.atlas ? '' : 'none'}}>
								<td>
									{I18.f("SHOW_SPRITES")}
								</td>
								<td>
									<select className="border-color-gray" value={this.state.label} onChange={this.onLabelChange}>
										<option value="">All</option>
										{this.state.labels.map((label, index) => {
											return (<option key={"player-label-" + index} value={index}>{label.name}</option>)
										})}
									</select>
								</td>
								<td></td>
							</tr>
							<tr style={{display: this.state.atlas ? '' : 'none'}} title={"Moves the selected animation, or all of it with All selected.\nThe offset gets written into the exported Animation.json."}>
								<td>
									Offset
								</td>
								<td>
									<input type="number" className="border-color-gray player-offset" title="X" value={this.state.offsetX} onChange={this.onOffsetXChange}/>
									<input type="number" className="border-color-gray player-offset" title="Y" value={this.state.offsetY} onChange={this.onOffsetYChange}/>
								</td>
								<td>
									<div className="btn back-800 border-color-gray color-white" onClick={this.resetOffset}>Reset</div>
								</td>
							</tr>
							<tr style={{display: this.state.atlas && this.state.labels.length ? '' : 'none'}} title="Shows the first frame of another animation behind this one, to line them up.">
								<td>
									Ghost
								</td>
								<td>
									<select className="border-color-gray" value={this.state.ghost} onChange={this.onGhostChange}>
										<option value="">None</option>
										{this.state.labels.map((label, index) => {
											return (<option key={"player-ghost-" + index} value={index}>{label.name}</option>)
										})}
									</select>
								</td>
								<td></td>
							</tr>
							<tr style={{display: this.state.atlas ? '' : 'none'}} title={I18.f("PLAYER_CONVERT_ATLAS_TITLE")}>
								<td></td>
								<td>
									<div className="btn back-800 border-color-gray color-white" onClick={this.convertAtlas}>{I18.f("PLAYER_CONVERT_ATLAS")}</div>
								</td>
								<td></td>
							</tr>
							<tr style={{display: framesMode ? '' : 'none'}}>
								<td>
									{I18.f("SHOW_SPRITES")}
								</td>
								<td>
									<select className="border-color-gray" value={this.state.animation === null ? "" : ANIMATION_VALUE + this.state.animation} onChange={this.onAnimationChange}>
										<option value="">{I18.f("PLAYER_SELECTED_FRAMES")}</option>
										{this.state.animations.map(item => {
											return (<option key={"player-animation-" + item.key} value={ANIMATION_VALUE + item.key}>{animationLabel(item.key)}</option>)
										})}
									</select>
								</td>
								<td>
									{this.state.animations.length > 1 ? <div className="btn back-800 border-color-gray color-white" title={I18.f("PLAYER_AUTO_ALIGN_TITLE")} onClick={this.autoAlign}>{I18.f("PLAYER_AUTO_ALIGN")}</div> : null}
								</td>
							</tr>
							<tr style={{display: framesMode || this.state.atlas ? '' : 'none'}} title={I18.f("PLAYER_IMPORT_CHARACTER_TITLE")}>
								<td>
									{I18.f("CHARACTER_FILE")}
								</td>
								<td>
									<div className="btn back-800 border-color-gray color-white file-upload">
										{I18.f("PLAYER_IMPORT_CHARACTER")}
										<input type="file" accept=".json,.xml" onChange={this.onCharacterPicked}/>
									</div>
								</td>
								<td></td>
							</tr>
							<tr style={{display: animationMode ? '' : 'none'}} title={I18.f("PLAYER_PREFIX_TITLE")}>
								<td>
									{I18.f("PLAYER_PREFIX")}
								</td>
								<td>
									<input type="text" className="border-color-gray" value={this.state.prefix} onChange={this.onPrefixChange} onBlur={this.commitPrefix} onKeyDown={this.onPrefixKeyDown}/>
								</td>
								<td></td>
							</tr>
							<tr style={{display: animationMode ? '' : 'none'}} title={I18.f("PLAYER_ANIM_NAME_TITLE")}>
								<td>
									{I18.f("PLAYER_ANIM_NAME")}
								</td>
								<td>
									<input type="text" className="border-color-gray" value={this.state.animName} placeholder={selected ? guessAnimationName(selected.prefix) : ""} onChange={this.onAnimNameChange}/>
								</td>
								<td></td>
							</tr>
							<tr style={{display: animationMode ? '' : 'none'}} title={I18.f("PLAYER_LOOP_TITLE")}>
								<td>
									{I18.f("PLAYER_LOOP")}
								</td>
								<td>
									<input type="checkbox" className="border-color-gray" checked={this.state.loop} onChange={this.onLoopChange}/>
								</td>
								<td></td>
							</tr>
							<tr style={{display: animationMode ? '' : 'none'}} title={I18.f("PLAYER_OFFSET_TITLE")}>
								<td>
									{I18.f("PLAYER_OFFSET")}
								</td>
								<td>
									<input type="number" className="border-color-gray player-offset" title="X" value={this.state.offsetX} onChange={this.onOffsetXChange}/>
									<input type="number" className="border-color-gray player-offset" title="Y" value={this.state.offsetY} onChange={this.onOffsetYChange}/>
								</td>
								<td>
									<div className="btn back-800 border-color-gray color-white" onClick={this.resetOffset}>{I18.f("PLAYER_RESET")}</div>
								</td>
							</tr>
							<tr style={{display: animationMode && this.state.animations.length > 1 ? '' : 'none'}} title={I18.f("PLAYER_GHOST_TITLE")}>
								<td>
									{I18.f("PLAYER_GHOST")}
								</td>
								<td>
									<select className="border-color-gray" value={this.state.animationGhost === null ? "" : ANIMATION_VALUE + this.state.animationGhost} onChange={this.onAnimationGhostChange}>
										<option value="">{I18.f("NONE")}</option>
										{this.state.animations.filter(item => item.key !== this.state.animation).map(item => {
											return (<option key={"player-animation-ghost-" + item.key} value={ANIMATION_VALUE + item.key}>{animationLabel(item.key)}</option>)
										})}
									</select>
								</td>
								<td></td>
							</tr>
							<tr style={{display: framesMode ? '' : 'none'}}>
								<td>
									{I18.f("PLAYER_FRAME")}
								</td>
								<td>
									<div className="btn back-800 border-color-gray color-white" title={I18.f("PLAYER_PREV_FRAME")} onClick={this.previousFrame}>&lsaquo;</div>
									<div className="btn back-800 border-color-gray color-white" onClick={this.togglePause}>{I18.f(this.state.paused ? "PLAYER_PLAY" : "PLAYER_PAUSE")}</div>
									<div className="btn back-800 border-color-gray color-white" title={I18.f("PLAYER_NEXT_FRAME")} onClick={this.nextFrame}>&rsaquo;</div>
								</td>
								<td>
									<div className="player-frame">{this.state.paused ? this.state.frameLabel : ""}</div>
								</td>
							</tr>
							<tr style={{display: framesMode && this.state.paused && this.state.frameLabel ? '' : 'none'}} title={I18.f("PLAYER_FRAME_OFFSET_TITLE")}>
								<td>
									{I18.f("PLAYER_FRAME_OFFSET")}
								</td>
								<td>
									<input type="number" className="border-color-gray player-offset" title="X" value={this.state.frameOffsetX} onChange={this.onFrameOffsetXChange}/>
									<input type="number" className="border-color-gray player-offset" title="Y" value={this.state.frameOffsetY} onChange={this.onFrameOffsetYChange}/>
								</td>
								<td>
									<div className="btn back-800 border-color-gray color-white" onClick={this.resetFrameOffset}>{I18.f("PLAYER_RESET")}</div>
								</td>
							</tr>
							<tr style={{display: animationMode && this.state.paused && this.state.frameLabel ? '' : 'none'}} title={I18.f("PLAYER_TIMING_TITLE")}>
								<td>
									{I18.f("PLAYER_TIMING")}
								</td>
								<td>
									<div className="btn back-800 border-color-gray color-white" title={I18.f("PLAYER_MOVE_EARLIER")} onClick={this.moveFrameEarlier}>&laquo;</div>
									<div className="btn back-800 border-color-gray color-white" title={I18.f("PLAYER_MOVE_LATER")} onClick={this.moveFrameLater}>&raquo;</div>
									<div className="btn back-800 border-color-gray color-white" title={I18.f("PLAYER_HOLD_TITLE")} onClick={this.holdCurrentFrame}>{I18.f("PLAYER_HOLD")}</div>
								</td>
								<td>
									<div className="btn back-800 border-color-gray color-white" onClick={this.deleteCurrentFrame}>{I18.f("PLAYER_DELETE_FRAME")}</div>
								</td>
							</tr>
							<tr>
								<td>
									{I18.f("ANIMATION_SPEED")}
								</td>
								<td>
									<input type="range" ref={this.speedRef} max="60" min="1" defaultValue="24" onChange={this.onSpeedChange}/>
								</td>
								<td>
									<div ref={this.fpsRef} className="player-fps">24 fps</div>
								</td>
							</tr>
							</tbody>
						</table>
					</div>
				</div>
			</div>
		)
	}

}

export default SpritesPlayer;
