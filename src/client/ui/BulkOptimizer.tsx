import * as React from 'react';

import I18 from '../locale/I18';
import { Observer, GLOBAL_EVENT } from '../Observer';
import Downloader from '../utils/Downloader';
import PackProperties from './PackProperties';
import { expandInputs, jobName, optimizeJob, planBulk, type BulkResult } from '../utils/BulkRepack';
import { JobError, type InputFile, type Job } from 'api/utils/SheetJobs';
import { readDropped, readPicked } from '../utils/FileInputs';
import type { FileData } from 'types';

interface Props {}

interface State {
	inputs: InputFile[];
	jobs: Job[];
	skipped: string[];
	zipName: string | null;
	planError: string | null;
	loading: boolean;
	running: boolean;
	done: number;
	current: string;
	results: BulkResult[];
	outputs: FileData[] | null;
	dragging: boolean;
}

function sharedFolder(files: ReadonlyArray<InputFile>) {
	const first = files[0]?.name.replace(/^\/+/, "").split("/")[0];
	if (!first || files.some(file => !file.name.replace(/^\/+/, "").startsWith(first + "/"))) return null;
	return first;
}

function megapixels(pixels: number) {
	return (pixels / 1000000).toFixed(1) + " MP";
}

function nextTick() {
	return new Promise(resolve => setTimeout(resolve, 0));
}

class BulkOptimizer extends React.Component<Props, State> {
	private readonly folderRef: React.RefObject<HTMLInputElement> = React.createRef();
	private cancelled = false;
	private closed = false;

	constructor(props: Props) {
		super(props);

		this.state = {
			inputs: [],
			jobs: [],
			skipped: [],
			zipName: null,
			planError: null,
			loading: false,
			running: false,
			done: 0,
			current: "",
			results: [],
			outputs: null,
			dragging: false
		};
	}

	override componentDidMount = () => {
		this.cancelled = false;
		this.closed = false;
		this.folderRef.current?.setAttribute("webkitdirectory", "");
	}

	override componentWillUnmount = () => {
		this.cancelled = true;
		this.closed = true;
	}

	addInputs = async (added: InputFile[]) => {
		if (!added.length || this.state.running) return;
		this.setState({ loading: true });

		const byName = new Map<string, InputFile>();
		for (const file of [...this.state.inputs, ...added]) byName.set(file.name, file);
		const inputs = [...byName.values()];

		try {
			const expanded = await expandInputs(inputs);
			const zipName = expanded.zipName ?? sharedFolder(inputs);
			const plan = planBulk(expanded.files, zipName ?? undefined);
			this.setState({ inputs, jobs: [...plan.jobs], skipped: plan.skipped, zipName, planError: null, results: [], outputs: null });
		}
		catch (e) {
			const message = e instanceof JobError || e instanceof Error ? e.message : String(e);
			this.setState({ inputs, jobs: [], skipped: [], planError: message, results: [], outputs: null });
		}
		finally {
			this.setState({ loading: false });
		}
	}

	onFilesPicked = async (e: React.ChangeEvent<HTMLInputElement>) => {
		await this.addInputs(await readPicked(e.target));
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
		this.setState({ dragging: false });
		await this.addInputs(await readDropped(e.dataTransfer));
	}

	clear = () => {
		if (this.state.running) return;
		this.setState({ inputs: [], jobs: [], skipped: [], zipName: null, planError: null, results: [], outputs: null });
	}

	start = async () => {
		const jobs = this.state.jobs;
		if (!jobs.length || this.state.running) return;

		this.cancelled = false;
		const options = PackProperties.i.getPackOptions();
		const outputs: FileData[] = [];
		const results: BulkResult[] = [];

		this.setState({ running: true, done: 0, results: [], outputs: null });

		for (let i = 0; i < jobs.length && !this.cancelled; i++) {
			this.setState({ current: jobName(jobs[i]), done: i });
			await nextTick();

			const output = await optimizeJob(jobs[i], options);
			if (this.closed) return;

			outputs.push(...output.files);
			results.push(output.result);
			this.setState({ results: results.slice(), done: i + 1 });
		}

		this.setState({ running: false, current: "", outputs });
		if (outputs.length && !this.cancelled) this.download(outputs);
	}

	cancel = () => {
		this.cancelled = true;
	}

	download = (outputs: FileData[] | null = this.state.outputs) => {
		if (!outputs || !outputs.length) return;
		Downloader.run(outputs, (this.state.zipName ?? "sheets") + "-optimized");
	}

	close = () => {
		this.cancelled = true;
		this.closed = true;
		Observer.emit(GLOBAL_EVENT.HIDE_BULK_OPTIMIZER);
	}

	renderResults() {
		return (
			<table>
				<thead>
					<tr>
						<th>{I18.f("BULK_SHEET")}</th>
						<th>{I18.f("BULK_BEFORE")}</th>
						<th>{I18.f("BULK_AFTER")}</th>
						<th>{I18.f("BULK_SAVED")}</th>
					</tr>
				</thead>
				<tbody>
					{this.state.results.map(result => {
						const saved = result.before ? (result.before - result.after) / result.before : 0;
						return (
							<tr key={"bulk-result-" + result.name}>
								<td>{result.name}</td>
								{result.error ? <td colSpan={3} className="bulk-error">{result.error}</td> : <>
									<td>{result.beforeSize} <span className="bulk-dim">{megapixels(result.before)}</span></td>
									<td>{result.afterSize} <span className="bulk-dim">{megapixels(result.after)}</span></td>
									{result.kept ?
										<td className="bulk-dim">{I18.f("BULK_KEPT")}</td> :
										<td className={saved > 0 ? "bulk-saved" : "bulk-error"}>{(saved * 100).toFixed(1)}%</td>}
								</>}
							</tr>
						);
					})}
				</tbody>
			</table>
		);
	}

	renderPlan() {
		return (
			<table>
				<tbody>
					{this.state.jobs.map(job => (
						<tr key={"bulk-job-" + jobName(job)}>
							<td>{jobName(job)}</td>
							<td className="bulk-dim">{job.sheets.length ? job.sheets[0].splitter.splitterName : I18.f("BULK_LOOSE")}</td>
						</tr>
					))}
					{this.state.skipped.map(reason => (
						<tr key={"bulk-skip-" + reason}>
							<td colSpan={2} className="bulk-dim">{I18.f("BULK_SKIPPED_FILE", reason)}</td>
						</tr>
					))}
				</tbody>
			</table>
		);
	}

	override render() {
		const { jobs, running, done, results } = this.state;
		const finished = !running && results.length > 0;
		const before = results.reduce((sum, result) => sum + (result.error ? 0 : result.before), 0);
		const after = results.reduce((sum, result) => sum + (result.error ? 0 : result.after), 0);
		const shrunk = results.filter(result => !result.error && !result.kept).length;

		let status = I18.f("BULK_INTRO");
		if (this.state.loading) status = I18.f("BULK_READING");
		else if (this.state.planError) status = this.state.planError;
		else if (running) status = I18.f("BULK_PROGRESS", String(done + 1), String(jobs.length), this.state.current);
		else if (finished) status = I18.f("BULK_DONE", String(shrunk), String(jobs.length), megapixels(before), megapixels(after));
		else if (this.state.inputs.length) status = I18.f("BULK_FOUND", String(jobs.length), String(this.state.skipped.length));

		return (
			<div className="bulk-overlay">
				<div className={"bulk-content back-white color-black border-color-gray" + (this.state.dragging ? " bulk-dragging" : "")} onDragOver={this.onDragOver} onDragLeave={this.onDragLeave} onDrop={this.onDrop}>
					<div className="bulk-title">{I18.f("BULK_OPTIMIZE")}</div>

					<div className="bulk-buttons">
						<div className="btn back-800 border-color-gray color-white file-upload">
							{I18.f("BULK_ADD_FILES")}
							<input type="file" multiple accept=".png,.xml,.json,.txt,.atlas,.plist,.zip" onChange={this.onFilesPicked} disabled={running}/>
						</div>
						<div className="btn back-800 border-color-gray color-white file-upload">
							{I18.f("BULK_ADD_FOLDER")}
							<input type="file" ref={this.folderRef} onChange={this.onFilesPicked} disabled={running}/>
						</div>
						<div className="btn back-800 border-color-gray color-white" onClick={this.clear}>{I18.f("CLEAR")}</div>
					</div>

					<div className={"bulk-status" + (this.state.planError ? " bulk-error" : "")}>{status}</div>
					{running ? <div className="bulk-progress"><div className="back-600" style={{width: (done / jobs.length * 100) + "%"}}></div></div> : null}

					<div className="bulk-list border-color-gray">
						{results.length ? this.renderResults() : this.renderPlan()}
					</div>

					<div className="bulk-buttons bulk-footer">
						{running ?
							<div className="btn back-800 border-color-gray color-white" onClick={this.cancel}>{I18.f("CANCEL")}</div> :
							<div className={"btn back-800 border-color-gray color-white" + (jobs.length ? "" : " bulk-disabled")} onClick={this.start}>{I18.f("BULK_START")}</div>}
						{finished && this.state.outputs?.length ? <div className="btn back-800 border-color-gray color-white" onClick={() => this.download()}>{I18.f("BULK_DOWNLOAD")}</div> : null}
						<div className="btn back-800 border-color-gray color-white" onClick={this.close}>{I18.f("CLOSE")}</div>
					</div>
				</div>
			</div>
		);
	}
}

export default BulkOptimizer;
