import * as React from 'react';

import I18 from '../locale/I18';
import APP from '../APP';
import { currentFrameSet, readFrameSet, type FrameSet } from '../utils/FrameSets';
import { readDropped, readPicked } from '../utils/FileInputs';
import type { InputFile } from 'api/utils/SheetJobs';

interface Props {
	title?: string;
	frames: FrameSet | null;
	onChange: (frames: FrameSet) => void;
}

interface State {
	loading: boolean;
	error: string | null;
	dragging: boolean;
}

class FrameSource extends React.Component<Props, State> {
	constructor(props: Props) {
		super(props);
		this.state = { loading: false, error: null, dragging: false };
	}

	load = async (files: InputFile[]) => {
		if (!files.length) return;

		this.setState({ loading: true, error: null });
		try {
			this.props.onChange(await readFrameSet(files));
		}
		catch (e) {
			this.setState({ error: e instanceof Error ? e.message : String(e) });
		}
		finally {
			this.setState({ loading: false });
		}
	}

	onPicked = async (e: React.ChangeEvent<HTMLInputElement>) => {
		await this.load(await readPicked(e.target));
	}

	onDragOver = (e: React.DragEvent<HTMLDivElement>) => {
		e.preventDefault();
		if (!this.state.dragging) this.setState({ dragging: true });
	}

	onDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
		if (e.currentTarget.contains(e.relatedTarget as Node)) return;
		this.setState({ dragging: false });
	}

	onDrop = async (e: React.DragEvent<HTMLDivElement>) => {
		e.preventDefault();
		e.stopPropagation();
		this.setState({ dragging: false });
		await this.load(await readDropped(e.dataTransfer));
	}

	useCurrent = () => {
		const frames = currentFrameSet();
		if (!frames) return;

		this.setState({ error: null });
		this.props.onChange(frames);
	}

	renderLabel() {
		const { frames } = this.props;
		if (this.state.loading) return I18.f("FRAMES_READING");
		if (this.state.error) return <span className="bulk-error">{this.state.error}</span>;
		if (!frames) return I18.f("FRAMES_DROP");
		return <>{frames.label} <span className="bulk-dim">{I18.f("FRAMES_COUNT", String(frames.frames.size))}</span></>;
	}

	override render() {
		const hasCurrent = Object.keys(APP.i.images).length > 0;

		return (
			<div className={"frame-source border-color-gray" + (this.state.dragging ? " bulk-dragging" : "")} onDragOver={this.onDragOver} onDragLeave={this.onDragLeave} onDrop={this.onDrop}>
				{this.props.title ? <div className="frame-source-title">{this.props.title}</div> : null}
				<div className="frame-source-label">{this.renderLabel()}</div>
				<div className="bulk-buttons">
					<div className="btn back-800 border-color-gray color-white file-upload">
						{I18.f("FRAMES_ADD")}
						<input type="file" multiple accept=".png,.xml,.json,.txt,.atlas,.plist,.zip" onChange={this.onPicked} disabled={this.state.loading}/>
					</div>
					<div className={"btn back-800 border-color-gray color-white" + (hasCurrent ? "" : " bulk-disabled")} onClick={this.useCurrent}>{I18.f("FRAMES_USE_CURRENT")}</div>
				</div>
			</div>
		);
	}
}

export default FrameSource;
