import * as React from 'react';

import I18 from '../locale/I18';
import { Observer, GLOBAL_EVENT } from '../Observer';
import FrameSource from './FrameSource';
import type CustomImage from '../data/CustomImage';
import type { FrameSet } from '../utils/FrameSets';
import { framePixels } from '../utils/FramePixels';
import { compareFrameSets, differenceMask, unionBox, FRAME_STATUSES, type Box, type FrameDifference, type FrameStatus } from '../utils/SheetComparison';

const STATUS_LABELS: Readonly<Record<FrameStatus, string>> = {
	changed: "COMPARE_CHANGED",
	moved: "COMPARE_MOVED",
	renamed: "COMPARE_RENAMED",
	added: "COMPARE_ADDED",
	removed: "COMPARE_REMOVED",
	same: "COMPARE_SAME"
};

const PREVIEW_SIZE = 160;
const PREVIEW_PADDING = 6;
const MAX_ZOOM = 4;

interface Props {}

interface State {
	before: FrameSet | null;
	after: FrameSet | null;
	results: FrameDifference[] | null;
	comparing: boolean;
	error: string | null;
	shown: ReadonlySet<FrameStatus>;
	selected: string | null;
}

function signed(value: number) {
	return (value > 0 ? "+" : "") + value;
}

function previewScale(box: Box) {
	return Math.min(MAX_ZOOM, (PREVIEW_SIZE - PREVIEW_PADDING * 2) / Math.max(box.width, box.height));
}

class SheetCompare extends React.Component<Props, State> {
	private readonly beforeRef: React.RefObject<HTMLCanvasElement> = React.createRef();
	private readonly afterRef: React.RefObject<HTMLCanvasElement> = React.createRef();
	private readonly diffRef: React.RefObject<HTMLCanvasElement> = React.createRef();
	private run = 0;

	constructor(props: Props) {
		super(props);

		this.state = {
			before: null,
			after: null,
			results: null,
			comparing: false,
			error: null,
			shown: new Set(FRAME_STATUSES.filter(status => status !== "same")),
			selected: null
		};
	}

	override componentWillUnmount = () => {
		this.run++;
	}

	override componentDidUpdate = (_: Props, previous: State) => {
		if (previous.selected !== this.state.selected || previous.results !== this.state.results) this.drawPreview();
	}

	setSide = (side: "before" | "after", frames: FrameSet) => {
		this.setState({
			before: side === "before" ? frames : this.state.before,
			after: side === "after" ? frames : this.state.after,
			results: null,
			selected: null
		}, this.compare);
	}

	compare = () => {
		const { before, after } = this.state;
		if (!before || !after) return;

		const run = ++this.run;
		this.setState({ comparing: true, error: null });

		setTimeout(() => {
			if (run !== this.run) return;

			try {
				const results = compareFrameSets(before, after);
				const first = results.find(result => this.state.shown.has(result.status));
				this.setState({ results, comparing: false, selected: first?.name ?? null });
			}
			catch (e) {
				console.error(e);
				this.setState({ comparing: false, error: I18.f("UNKNOWN_ERROR", e instanceof Error ? e.message : String(e)) });
			}
		}, 30);
	}

	toggleStatus = (status: FrameStatus) => {
		const shown = new Set(this.state.shown);
		if (shown.has(status)) shown.delete(status);
		else shown.add(status);
		this.setState({ shown });
	}

	close = () => {
		Observer.emit(GLOBAL_EVENT.HIDE_SHEET_COMPARE);
	}

	selectedResult() {
		return this.state.results?.find(result => result.name === this.state.selected) ?? null;
	}

	drawImage(canvas: HTMLCanvasElement | null, image: CustomImage | null, box: Box, scale: number) {
		if (!canvas) return;
		const ctx = canvas.getContext("2d");
		ctx.clearRect(0, 0, canvas.width, canvas.height);
		if (!image) return;

		const pixels = framePixels(image);
		if (!pixels.width) return;

		const temp = document.createElement("canvas");
		temp.width = pixels.width;
		temp.height = pixels.height;
		temp.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(pixels.data), pixels.width, pixels.height), 0, 0);

		ctx.imageSmoothingEnabled = scale < 1;
		ctx.drawImage(temp, PREVIEW_PADDING + (pixels.x - box.x) * scale, PREVIEW_PADDING + (pixels.y - box.y) * scale, pixels.width * scale, pixels.height * scale);
	}

	drawDifference(canvas: HTMLCanvasElement | null, result: FrameDifference, box: Box, scale: number) {
		if (!canvas) return;
		const ctx = canvas.getContext("2d");
		ctx.clearRect(0, 0, canvas.width, canvas.height);
		if (!result.before || !result.after) return;

		const before = framePixels(result.before);
		const after = framePixels(result.after);
		const { mask } = differenceMask(before, after);
		const union = unionBox(before, after);
		const image = new ImageData(union.width, union.height);

		for (let y = 0; y < union.height; y++) {
			for (let x = 0; x < union.width; x++) {
				const out = (y * union.width + x) * 4;
				if (mask[y * union.width + x]) {
					image.data.set([255, 0, 80, 255], out);
					continue;
				}

				const px = union.x + x - after.x;
				const py = union.y + y - after.y;
				if (px < 0 || py < 0 || px >= after.width || py >= after.height) continue;

				const index = (py * after.width + px) * 4;
				const gray = (after.data[index] + after.data[index + 1] + after.data[index + 2]) / 3;
				image.data.set([gray, gray, gray, after.data[index + 3] * 0.35], out);
			}
		}

		const temp = document.createElement("canvas");
		temp.width = union.width;
		temp.height = union.height;
		temp.getContext("2d").putImageData(image, 0, 0);

		ctx.imageSmoothingEnabled = scale < 1;
		ctx.drawImage(temp, PREVIEW_PADDING + (union.x - box.x) * scale, PREVIEW_PADDING + (union.y - box.y) * scale, union.width * scale, union.height * scale);
	}

	drawPreview() {
		const result = this.selectedResult();
		const canvases = [this.beforeRef.current, this.afterRef.current, this.diffRef.current];
		if (!result) {
			for (const canvas of canvases) canvas?.getContext("2d").clearRect(0, 0, canvas.width, canvas.height);
			return;
		}

		const box = unionBox(result.before && framePixels(result.before), result.after && framePixels(result.after));
		const scale = previewScale(box);

		this.drawImage(this.beforeRef.current, result.before, box, scale);
		this.drawImage(this.afterRef.current, result.after, box, scale);
		this.drawDifference(this.diffRef.current, result, box, scale);
	}

	detail(result: FrameDifference) {
		switch (result.status) {
			case "changed":
				return I18.f("COMPARE_DETAIL_CHANGED", (result.changedShare * 100).toFixed(1) + "%");
			case "renamed":
				return I18.f("COMPARE_DETAIL_RENAMED", result.beforeName ?? "");
			case "moved": {
				const parts: string[] = [];
				if (result.moveX || result.moveY) parts.push("x " + signed(result.moveX) + ", y " + signed(result.moveY));
				if (result.beforeFrame !== result.afterFrame) parts.push(I18.f("COMPARE_DETAIL_FRAME", result.beforeFrame, result.afterFrame));
				return parts.join(" · ");
			}
			default:
				return "";
		}
	}

	renderSummary() {
		const results = this.state.results;
		if (this.state.comparing) return <div className="bulk-status">{I18.f("COMPARE_RUNNING")}</div>;
		if (this.state.error) return <div className="bulk-status bulk-error">{this.state.error}</div>;
		if (!results) return <div className="bulk-status">{I18.f("COMPARE_INTRO")}</div>;

		const counts = new Map<FrameStatus, number>();
		for (const result of results) counts.set(result.status, (counts.get(result.status) ?? 0) + 1);
		const identical = results.length > 0 && results.every(result => result.status === "same");

		return (
			<div className="compare-summary">
				{identical ? <span className="bulk-saved">{I18.f("COMPARE_ALL_SAME")}</span> : null}
				{FRAME_STATUSES.map(status => (
					<div key={"compare-chip-" + status}
						className={"compare-chip compare-" + status + (this.state.shown.has(status) ? " compare-chip-on" : "")}
						onClick={() => this.toggleStatus(status)}>
						{I18.f(STATUS_LABELS[status])} {counts.get(status) ?? 0}
					</div>
				))}
			</div>
		);
	}

	renderList() {
		const results = (this.state.results ?? []).filter(result => this.state.shown.has(result.status));
		const order = (status: FrameStatus) => FRAME_STATUSES.indexOf(status);
		const sorted = results.map((result, index) => ({ result, index })).sort((a, b) => order(a.result.status) - order(b.result.status) || a.index - b.index);

		return (
			<table>
				<tbody>
					{sorted.map(({ result }) => (
						<tr key={"compare-" + result.name} className={result.name === this.state.selected ? "back-400" : ""} onClick={() => this.setState({ selected: result.name })}>
							<td className="compare-name">{result.name}</td>
							<td className={"compare-status compare-" + result.status}>{I18.f(STATUS_LABELS[result.status])}</td>
							<td className="bulk-dim">{this.detail(result)}</td>
						</tr>
					))}
				</tbody>
			</table>
		);
	}

	override render() {
		const selected = this.selectedResult();
		const previews = [
			{ label: "COMPARE_BEFORE", ref: this.beforeRef },
			{ label: "COMPARE_AFTER", ref: this.afterRef },
			{ label: "COMPARE_DIFFERENCE", ref: this.diffRef }
		];

		return (
			<div className="bulk-overlay">
				<div className="bulk-content compare-content back-white color-black border-color-gray">
					<div className="bulk-title">{I18.f("COMPARE")}</div>

					<div className="compare-sides">
						<FrameSource title={I18.f("COMPARE_BEFORE")} frames={this.state.before} onChange={frames => this.setSide("before", frames)}/>
						<FrameSource title={I18.f("COMPARE_AFTER")} frames={this.state.after} onChange={frames => this.setSide("after", frames)}/>
					</div>

					{this.renderSummary()}

					<div className="compare-body">
						<div className="bulk-list compare-list border-color-gray">{this.renderList()}</div>
						<div className="compare-preview">
							{previews.map(preview => (
								<div key={"compare-preview-" + preview.label} className="compare-preview-item">
									<div className="bulk-dim">{I18.f(preview.label)}</div>
									<canvas ref={preview.ref} width={PREVIEW_SIZE} height={PREVIEW_SIZE} className="grid-back border-color-gray"/>
								</div>
							))}
							{selected ? <div className="compare-preview-name">{selected.name}</div> : <div className="bulk-dim">{I18.f("COMPARE_PICK")}</div>}
						</div>
					</div>

					<div className="bulk-buttons bulk-footer">
						<div className="btn back-800 border-color-gray color-white" onClick={this.close}>{I18.f("CLOSE")}</div>
					</div>
				</div>
			</div>
		);
	}
}

export default SheetCompare;
