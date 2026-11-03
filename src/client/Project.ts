import * as FileSaver from 'file-saver';
import * as appInfo from '../../package.json';
import APP from './APP';
import I18 from './locale/I18';
import ErrorHandler from './ErrorHandler';
import { Observer, GLOBAL_EVENT } from './Observer';
import TypedObserver from 'TypedObserver';
import ImagesList from './ui/ImagesList';
import PackProperties from './ui/PackProperties';
import type { RepackInfoEvent } from './ui/StatsInfo';
import type { PackOptions } from 'api/types';
import { getExporterByType } from 'api/exporters';
import { PROJECT_EXTENSION, ProjectError, readProject, savedRect, writeProject, type ProjectState } from './utils/ProjectFile';

const { version: appVersion } = appInfo;

const LOCAL_OPTIONS: ReadonlyArray<keyof PackOptions> = ["statsSI", "previewBlendMode", "repackUpdateFileName", "exporterCls", "packerCls"];

let repackInfo: RepackInfoEvent | null = null;
let savedSnapshot: string | null = null;
let nextId = 0;
const ids = new WeakMap<object, number>();

function idOf(value: object | null) {
	if (!value) return null;

	let id = ids.get(value);
	if (id === undefined) {
		id = nextId++;
		ids.set(value, id);
	}
	return id;
}

function snapshot() {
	const api = APP.i.api;

	return JSON.stringify([
		Object.entries(APP.i.images).map(([name, image]) => [name, idOf(image.image), image.rect && savedRect(image.rect)]),
		api.getStoredOrder(),
		idOf(api.getAnimation()),
		[...api.getAnimationOffsets()],
		[...api.getCharacterAnimations()],
		idOf(api.getImportedCharacter())
	]);
}

function hasImages() {
	return Object.keys(APP.i.images).length > 0;
}

export function hasUnsavedChanges() {
	return hasImages() && snapshot() !== savedSnapshot;
}

export function markSaved() {
	savedSnapshot = snapshot();
}

function currentState(): ProjectState {
	const api = APP.i.api;
	const options: PackOptions = { ...PackProperties.i.packOptions };
	for (const key of LOCAL_OPTIONS) delete options[key];

	const custom = getExporterByType("custom");

	return {
		images: APP.i.images,
		options,
		customExporter: options.exporter === custom.exporterName ? {
			allowTrim: custom.allowTrim,
			allowRotation: custom.allowRotation,
			fileExt: custom.fileExt,
			content: custom.content
		} : null,
		order: api.getStoredOrder(),
		atlasMeta: api.getAtlasMeta(),
		animation: api.getAnimation(),
		animationOffsets: Object.fromEntries(api.getAnimationOffsets()),
		characterAnimations: Object.fromEntries(api.getCharacterAnimations()),
		importedCharacter: api.getImportedCharacter(),
		repackInfo
	};
}

function applyState(state: ProjectState) {
	const api = APP.i.api;
	api.reset();

	if (state.customExporter) PackProperties.i.setCustomExporter(state.customExporter);

	api.setAnimation(state.animation);
	api.setAtlasMeta(state.atlasMeta);
	for (const [name, offset] of Object.entries(state.animationOffsets)) api.setAnimationOffset(name, offset);
	for (const [key, settings] of Object.entries(state.characterAnimations)) api.setCharacterAnimation(key, settings);
	api.setImportedCharacter(state.importedCharacter);
	if (state.order) api.setStoredOrder(state.order);

	TypedObserver.storedOrderChanged.emit(state.order ?? []);
	TypedObserver.repackInfo.emit(state.repackInfo);
	TypedObserver.repackCheck.emit(null);

	PackProperties.i.setOptions({ ...PackProperties.i.packOptions, ...state.options });
	ImagesList.i.setImages(state.images);
	TypedObserver.imagesListSelectedChanged.emit([]);
}

function projectFileName() {
	const name = PackProperties.i.packOptions.fileName || "project";
	return name + PROJECT_EXTENSION;
}

export async function saveProject() {
	if (!hasImages()) {
		TypedObserver.showMessage.emit(I18.f("PROJECT_EMPTY"));
		return;
	}

	Observer.emit(GLOBAL_EVENT.SHOW_PROCESSING);
	try {
		const blob = await writeProject(currentState(), appVersion);
		FileSaver.saveAs(blob, projectFileName());
		markSaved();
	}
	catch (e) {
		console.error(e);
		TypedObserver.showMessage.emit(I18.f("PROJECT_SAVE_ERROR", ErrorHandler.translateError(e)));
	}
	finally {
		Observer.emit(GLOBAL_EVENT.HIDE_PROCESSING);
	}
}

async function loadProject(file: File) {
	Observer.emit(GLOBAL_EVENT.SHOW_PROCESSING);

	let state: ProjectState;
	try {
		state = await readProject(file);
	}
	catch (e) {
		Observer.emit(GLOBAL_EVENT.HIDE_PROCESSING);
		if (!(e instanceof ProjectError)) console.error(e);
		const newer = e instanceof ProjectError && e.newerVersion;
		TypedObserver.showMessage.emit(I18.f(newer ? "PROJECT_NEWER" : "PROJECT_INVALID", file.name));
		return;
	}

	applyState(state);
	markSaved();
}

export function openProject(file: File) {
	if (!hasUnsavedChanges()) {
		loadProject(file);
		return;
	}

	TypedObserver.showMessage.emit(I18.f("PROJECT_REPLACE_CONFIRM", file.name), [
		{ name: "yes", caption: I18.f("YES"), callback: () => loadProject(file) },
		{ name: "no", caption: I18.f("NO") }
	]);
}

export function pickProject() {
	const input = document.createElement("input");
	input.type = "file";
	input.accept = PROJECT_EXTENSION;
	input.onchange = () => {
		const file = input.files?.[0];
		if (file) openProject(file);
	};
	input.click();
}

function onKeyDown(e: KeyboardEvent) {
	if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return;

	if (e.code === "KeyS") {
		e.preventDefault();
		saveProject();
	}
	else if (e.code === "KeyO") {
		e.preventDefault();
		pickProject();
	}
}

function onBeforeUnload(e: BeforeUnloadEvent) {
	if (!hasUnsavedChanges()) return;

	e.preventDefault();
	e.returnValue = "";
}

export function initProjects() {
	TypedObserver.repackInfo.on(info => { repackInfo = info; });
	globalThis.addEventListener("keydown", onKeyDown);
	globalThis.addEventListener("beforeunload", onBeforeUnload);
}
