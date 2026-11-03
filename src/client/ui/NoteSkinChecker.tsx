import * as React from 'react';

import I18 from '../locale/I18';
import { Observer, GLOBAL_EVENT } from '../Observer';
import Storage from '../utils/Storage';
import FrameSource from './FrameSource';
import type CustomImage from '../data/CustomImage';
import { currentFrameSet, type FrameSet } from '../utils/FrameSets';
import { drawFrame, frameBounds } from '../utils/FramePixels';
import { checkNoteSkin, noteSkinParts, NOTE_DIRECTIONS, type NotePart, type NoteSkinCell, type NoteSkinProfile } from 'api/utils/NoteSkin';

const STORAGE_PROFILE_KEY = "note-skin-engine";
const CELL_SIZE = 72;
const CELL_PADDING = 4;
const FPS = 24;

const PART_LABELS: Readonly<Record<NotePart, string>> = {
	note: "NOTESKIN_NOTE",
	holdPiece: "NOTESKIN_HOLD_PIECE",
	holdEnd: "NOTESKIN_HOLD_END",
	static: "NOTESKIN_STATIC",
	press: "NOTESKIN_PRESS",
	confirm: "NOTESKIN_CONFIRM"
};

const DIRECTION_LABELS: Readonly<Record<typeof NOTE_DIRECTIONS[number], string>> = {
	left: "NOTESKIN_LEFT",
	down: "NOTESKIN_DOWN",
	up: "NOTESKIN_UP",
	right: "NOTESKIN_RIGHT"
};

type CellView = Readonly<{
	cell: NoteSkinCell;
	images: CustomImage[];
	bounds: Readonly<{ x: number, y: number, width: number, height: number }>;
}>;

interface Props {}

interface State {
	frames: FrameSet | null;
	profile: NoteSkinProfile;
}

function storedProfile(): NoteSkinProfile {
	return Storage.load(STORAGE_PROFILE_KEY, false) === "vslice" ? "vslice" : "psych";
}

class NoteSkinChecker extends React.Component<Props, State> {
	private readonly canvases = new Map<string, HTMLCanvasElement>();
	private views: CellView[][] = [];
	private viewsFor: { frames: FrameSet | null, profile: NoteSkinProfile } | null = null;
	private frameRequest = 0;

	constructor(props: Props) {
		super(props);
		this.state = { frames: currentFrameSet(), profile: storedProfile() };
	}

	override componentDidMount = () => {
		this.frameRequest = requestAnimationFrame(this.tick);
	}

	override componentWillUnmount = () => {
		cancelAnimationFrame(this.frameRequest);
	}

	close = () => {
		Observer.emit(GLOBAL_EVENT.HIDE_NOTE_SKIN_CHECK);
	}

	onProfileChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
		const profile = e.target.value === "vslice" ? "vslice" : "psych";
		Storage.save(STORAGE_PROFILE_KEY, profile);
		this.setState({ profile });
	}

	cellViews() {
		const { frames, profile } = this.state;
		if (this.viewsFor?.frames === frames && this.viewsFor.profile === profile) return this.views;

		const names = frames ? [...frames.frames.keys()] : [];
		this.views = checkNoteSkin(profile, names).map(row => row.map(cell => {
			const images = cell.frames.map(name => frames.frames.get(name)).filter((image): image is CustomImage => !!image);
			return { cell, images, bounds: frameBounds(images) };
		}));
		this.viewsFor = { frames, profile };
		return this.views;
	}

	tick = (time: number) => {
		this.frameRequest = requestAnimationFrame(this.tick);

		for (const row of this.views) {
			for (const view of row) {
				const canvas = this.canvases.get(view.cell.direction + "-" + view.cell.part);
				if (!canvas) continue;

				const ctx = canvas.getContext("2d");
				ctx.clearRect(0, 0, canvas.width, canvas.height);
				if (!view.images.length) continue;

				const { bounds } = view;
				const scale = Math.min(1, (CELL_SIZE - CELL_PADDING * 2) / Math.max(bounds.width, bounds.height));
				const image = view.images[Math.floor(time * FPS / 1000) % view.images.length];
				const x = (CELL_SIZE - bounds.width * scale) / 2 - bounds.x * scale;
				const y = (CELL_SIZE - bounds.height * scale) / 2 - bounds.y * scale;
				drawFrame(ctx, image, x, y, scale);
			}
		}
	}

	setCanvas = (key: string, canvas: HTMLCanvasElement | null) => {
		if (canvas) this.canvases.set(key, canvas);
		else this.canvases.delete(key);
	}

	renderCell(view: CellView) {
		const { cell } = view;
		const key = cell.direction + "-" + cell.part;
		const found = cell.prefix !== null;
		const title = I18.f("NOTESKIN_LOOKS_FOR", cell.prefixes.join(" / ")) + (found ? "\n" + cell.frames.join("\n") : "");

		return (
			<td key={key} title={title} className="noteskin-cell">
				<canvas ref={canvas => this.setCanvas(key, canvas)} width={CELL_SIZE} height={CELL_SIZE} className="grid-back border-color-gray"/>
				{found ?
					<div className="noteskin-found">✓ {cell.frames.length}</div> :
					<div className="noteskin-missing">{I18.f("NOTESKIN_MISSING")}<div className="noteskin-prefix">{cell.prefixes[0]}</div></div>}
				{cell.extra.length ? <div className="noteskin-extra">{I18.f("NOTESKIN_EXTRA", cell.extra.join(", "))}</div> : null}
			</td>
		);
	}

	override render() {
		const views = this.cellViews();
		const parts = noteSkinParts(this.state.profile);
		const cells = views.flat();
		const found = cells.filter(view => view.cell.prefix !== null).length;
		const vslice = this.state.profile === "vslice";

		return (
			<div className="bulk-overlay">
				<div className="bulk-content noteskin-content back-white color-black border-color-gray">
					<div className="bulk-title">{I18.f("NOTESKIN")}</div>

					<FrameSource frames={this.state.frames} onChange={frames => this.setState({ frames })}/>

					<div className="noteskin-engine">
						{I18.f("NOTESKIN_ENGINE")}
						<select className="border-color-gray" value={this.state.profile} onChange={this.onProfileChange}>
							<option value="psych">{I18.f("NOTESKIN_PSYCH")}</option>
							<option value="vslice">V-Slice</option>
						</select>
					</div>

					<div className={"bulk-status" + (found === cells.length ? " bulk-saved" : "")}>
						{this.state.frames ? I18.f("NOTESKIN_SUMMARY", String(found), String(cells.length)) : I18.f("NOTESKIN_INTRO")}
					</div>
					{vslice ? <div className="bulk-dim noteskin-note">{I18.f("NOTESKIN_VSLICE_NOTE")}</div> : null}

					<div className="bulk-list noteskin-list border-color-gray">
						<table className="noteskin-grid">
							<thead>
								{vslice ? <tr><th></th><th>notes</th><th colSpan={3}>noteStrumline</th></tr> : null}
								<tr>
									<th></th>
									{parts.map(part => <th key={"noteskin-part-" + part}>{I18.f(PART_LABELS[part])}</th>)}
								</tr>
							</thead>
							<tbody>
								{views.map((row, index) => (
									<tr key={"noteskin-row-" + NOTE_DIRECTIONS[index]}>
										<th>{I18.f(DIRECTION_LABELS[NOTE_DIRECTIONS[index]])}</th>
										{row.map(view => this.renderCell(view))}
									</tr>
								))}
							</tbody>
						</table>
					</div>

					<div className="bulk-buttons bulk-footer">
						<div className="btn back-800 border-color-gray color-white" onClick={this.close}>{I18.f("CLOSE")}</div>
					</div>
				</div>
			</div>
		);
	}
}

export default NoteSkinChecker;
