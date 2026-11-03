import * as React from 'react';

import I18 from 'client/locale/I18';
import type { PackResultsData } from 'types';
import TypedObserver from 'TypedObserver';

import { formatBytes } from 'api/utils/common';
import type { PackerCombo } from 'api/packers/Packer';
import { getSpaceUsage } from 'api/utils/SpaceUsage';
import { animationLabel, groupFrames, type AnimationGroup } from 'api/utils/Character';
import { findPrefixClashes, renameClashes, type PrefixClash } from 'api/utils/PrefixClash';
import { exportedName } from 'api/exporters';
import APP from 'client/APP';
import ImagesList from './ImagesList';
import type { RepackCheckResult } from 'client/utils/RepackChecker';

(globalThis as any).formatBytes = formatBytes;

export type StatsInfoEvent = {
	packResults: PackResultsData[];
	usedPacker: PackerCombo | null;
	scale: number;
}

function percent(share: number) {
	return (share * 100).toFixed(1) + "%";
}

function currentGroups(): AnimationGroup[] {
	if (APP.i.api.hasAnimation()) return [];

	const options = APP.i.packOptions;
	return groupFrames(Object.keys(APP.i.images).map(file => ({
		file,
		name: exportedName(file, options.removeFileExtension ?? true, options.prependFolderName ?? true)
	})));
}

function renamedPrefix(prefix: string, label: string) {
	return prefix.substring(0, prefix.lastIndexOf("/") + 1) + label;
}

function validLabel(label: string) {
	return label.trim() !== "" && label === label.trim() && !label.includes("/") && !/\d$/.test(label);
}

export type RepackInfoEvent = {
	width: number;
	height: number;
	totalFrames: number;
}

interface Props {}

interface State {
	info: StatsInfoEvent;
	repackInfo: RepackInfoEvent | null;
	repackCheck: RepackCheckResult | null;
	si: number;
	spaceOpen: boolean;
	groups: AnimationGroup[];
	clashes: PrefixClash[];
	clashesOpen: boolean;
	renames: Readonly<Record<string, string>>;
}

class StatsInfo extends React.Component<Props, State> {
	constructor(props:Props) {
		super(props);

		this.state = {
			info: {
				packResults: [],
				usedPacker: null,
				scale: 1
			},
			repackInfo: null,
			repackCheck: null,
			si: 1024,
			spaceOpen: false,
			groups: [],
			clashes: [],
			clashesOpen: false,
			renames: {}
		};
	}

	override componentDidMount = () => {
		TypedObserver.statsInfoUpdated.on(this.updateStatsInfo, this);
		TypedObserver.siUnitsChanged.on(this.setSI, this);
		TypedObserver.repackInfo.on(this.updateRepackInfo, this);
		TypedObserver.repackCheck.on(this.updateRepackCheck, this);
		TypedObserver.packExporterChanged.on(this.updateClashes, this);
	}

	override componentWillUnmount = () => {
		TypedObserver.statsInfoUpdated.off(this.updateStatsInfo, this);
		TypedObserver.siUnitsChanged.off(this.setSI, this);
		TypedObserver.repackInfo.off(this.updateRepackInfo, this);
		TypedObserver.repackCheck.off(this.updateRepackCheck, this);
		TypedObserver.packExporterChanged.off(this.updateClashes, this);
	}

	updateStatsInfo = (statsInfo: StatsInfoEvent) => {
		this.setState({ info: statsInfo, repackCheck: null });
		this.updateClashes();
	};

	updateClashes = () => {
		const groups = currentGroups();
		const clashes = findPrefixClashes(groups);
		this.setState({ groups, clashes, clashesOpen: this.state.clashesOpen && clashes.length > 0 });
	};

	toggleClashes = () => {
		this.setState({ clashesOpen: !this.state.clashesOpen, spaceOpen: false });
	};

	clashLabel = (clash: PrefixClash) => {
		return this.state.renames[clash.key] ?? animationLabel(clash.prefix);
	};

	canRename = (clash: PrefixClash) => {
		const label = this.clashLabel(clash);
		const group = this.state.groups.find(item => item.key === clash.key);
		if (!group || !validLabel(label) || label === animationLabel(clash.prefix)) return false;

		return !renameClashes(group, renamedPrefix(clash.prefix, label), this.state.groups);
	};

	onRenameChange = (clash: PrefixClash, label: string) => {
		this.setState({ renames: { ...this.state.renames, [clash.key]: label } });
	};

	renameClash = (clash: PrefixClash) => {
		if (!this.canRename(clash)) return;

		const renamed = ImagesList.i.renameAnimation(clash.key, this.clashLabel(clash));
		if (renamed === null) return;

		const renames = { ...this.state.renames };
		delete renames[clash.key];
		this.setState({ renames });
	};

	updateRepackCheck = (repackCheck: RepackCheckResult | null) => {
		this.setState({ repackCheck });
	};

	showMovedFrames = () => {
		const check = this.state.repackCheck;
		if (check?.moved.length) TypedObserver.showMessage.emit(I18.f("REPACK_CHECK_MOVED_LIST", check.moved.join(", ")));
	};

	setSI = (si: number) => {
		this.setState({ si });
	};

	updateRepackInfo = (repackInfo: RepackInfoEvent) => {
		this.setState({ repackInfo });
	};

	toggleSpace = () => {
		this.setState({ spaceOpen: !this.state.spaceOpen, clashesOpen: false });
	};

	renderClashes() {
		const clashes = this.state.clashes;
		if (!clashes.length) return <></>;

		return (
			<>
				<div className="stats-info-item stats-space" title={I18.f("STATS_CLASH_TITLE")} onClick={this.toggleClashes}>
					<div className="stats-info-label">{I18.f("STATS_CLASH")} {this.state.clashesOpen ? "▴" : "▾"}</div>
					<div className="stats-info-value" style={{color: "#FF0000"}}>⚠ {clashes.length}</div>
				</div>
				{this.state.clashesOpen ? <div className="space-usage prefix-clashes back-white color-black border-color-gray">
					<div className="prefix-clash-intro">{I18.f("CLASH_INTRO")}</div>
					{clashes.map(clash => {
						const renamable = this.canRename(clash);
						return (
							<div key={"clash-" + clash.key} className="prefix-clash border-color-gray">
								<div>{I18.f("CLASH_MATCHES", clash.prefix, clash.matches.join(", "))}</div>
								{clash.safePrefix ? <div className="prefix-clash-hint">{I18.f("CLASH_SAFE_PREFIX", clash.safePrefix)}</div> : null}
								<div className="prefix-clash-rename">
									<input type="text" className="border-color-gray" value={this.clashLabel(clash)} title={I18.f("CLASH_RENAME_TITLE")}
										onChange={e => this.onRenameChange(clash, e.target.value)}
										onKeyDown={e => { if (e.key === "Enter") this.renameClash(clash); }}/>
									<div className={"btn back-800 border-color-gray color-white" + (renamable ? "" : " bulk-disabled")} onClick={() => this.renameClash(clash)}>{I18.f("CLASH_RENAME")}</div>
								</div>
							</div>
						);
					})}
				</div> : <></>}
			</>
		);
	}

	renderScale() {
		const options = APP.i.packOptions;
		const requested = options.scale || 1;
		const used = this.state.info.scale;
		if (!options.fitToSize || !this.state.info.packResults.length || used >= requested) return <></>;

		return (
			<div className="stats-info-item" title={I18.f("STATS_SCALE_TITLE", String(requested), String(options.width), String(options.height))}>
				<div className="stats-info-label">{I18.f("STATS_SCALE")}</div>
				<div className="stats-info-value">{used}</div>
			</div>
		);
	}

	renderCheck() {
		const check = this.state.repackCheck;
		if (!check || !check.frames) return <></>;

		const ok = check.moved.length === 0;
		const lines = [I18.f("STATS_REPACK_CHECK_TITLE")];
		if (check.edited) lines.push(I18.f("STATS_REPACK_CHECK_EDITED", String(check.edited)));
		if (!ok) lines.push(...check.moved.slice(0, 20));

		return (
			<div className={"stats-info-item" + (ok ? "" : " stats-space")} title={lines.join("\n")} onClick={this.showMovedFrames}>
				<div className="stats-info-label">{I18.f("STATS_REPACK_CHECK")}</div>
				<div className="stats-info-value" style={{color: ok ? "#00FF00" : "#FF0000"}}>
					{ok ? I18.f("STATS_REPACK_CHECK_OK", String(check.frames)) : I18.f("STATS_REPACK_CHECK_MOVED", String(check.moved.length))}
				</div>
			</div>
		);
	}

	renderSpace() {
		const usage = getSpaceUsage(this.state.info.packResults.map(res => res.data), APP.i.packOptions.spritePadding || 0);
		if (usage.length < 2) return <></>;

		const name = (key: string) => animationLabel(key) || key || "?";
		const largest = usage[0];

		return (
			<>
				<div className="stats-info-item stats-space" title={I18.f("STATS_SPACE_TITLE")} onClick={this.toggleSpace}>
					<div className="stats-info-label">{I18.f("STATS_SPACE")} {this.state.spaceOpen ? "▴" : "▾"}</div>
					<div className="stats-info-value">{name(largest.key)} {percent(largest.share)}</div>
				</div>
				{this.state.spaceOpen ? <div className="space-usage back-white color-black border-color-gray">
					<table>
						<tbody>
							{usage.map(item => (
								<tr key={"space-" + item.key} title={item.key}>
									<td className="space-usage-name">{name(item.key)}</td>
									<td className="space-usage-bar"><div className="back-600" style={{width: percent(item.share)}}></div></td>
									<td className="space-usage-share">{percent(item.share)}</td>
									<td className="space-usage-frames">{item.unique === item.frames ? I18.f("STATS_SPACE_FRAMES", String(item.frames)) : I18.f("STATS_SPACE_UNIQUE", String(item.frames), String(item.unique))}</td>
								</tr>
							))}
						</tbody>
					</table>
				</div> : <></>}
			</>
		);
	}

	override render() {
		const sizes = this.state.info.packResults.map((res) => ({ width: res.renderer.width, height: res.renderer.height }));
		const ramUsage = sizes.reduce((acc, res) => acc + res.width * res.height * 4, 0);
		let sizeText = sizes.map((res) => res.width + "x" + res.height).join(" + ");
		let ramText = formatBytes(ramUsage, 3, this.state.si);
		let ramTitle = "";
		let usedPacker = this.state.info.usedPacker?.packerClass?.packerName ?? "";
		let savingText = <></>;
		if (sizes.length === 0) {
			sizeText = "? x ?";
			ramText = "? B";
			usedPacker = "";
		} else {
			let repackInfo = this.state.repackInfo;
			if (repackInfo) {
				const oldUsage = (repackInfo.width * repackInfo.height * 4);
				const savedRamPercent = (ramUsage-oldUsage) / oldUsage;
				let savePercentTxt = (savedRamPercent * 100).toFixed(2);
				if(savedRamPercent > 0) savePercentTxt = "+" + savePercentTxt;
				let saveTxt = " (" + savePercentTxt + "%)";
				const color = savedRamPercent < 0 ? "#00FF00" : "#FF0000";
				savingText = <span style={{color}}>{saveTxt}</span>;

				ramTitle = formatBytes(oldUsage, 3, this.state.si) + " -> " + formatBytes(ramUsage, 3, this.state.si);
			}
		}

		return (
			<div className="stats-info">
				<div className="stats-info-item">
					<div className="stats-info-label">{I18.f("STATS_SIZE")}</div>
					<div className="stats-info-value">{sizeText}</div>
				</div>
				<div className="stats-info-item">
					<div className="stats-info-label">{I18.f("STATS_RAM")}</div>
					<div className="stats-info-value" title={ramTitle}>{ramText}{savingText}</div>
				</div>
				{usedPacker ? <div className="stats-info-item">
					<div className="stats-info-label">{I18.f("STATS_USED_PACKER")}</div>
					<div className="stats-info-value">{usedPacker}</div>
				</div> : <></>}
				{this.renderScale()}
				{this.renderSpace()}
				{this.renderClashes()}
				{this.renderCheck()}
			</div>
		);
	}
}

export default StatsInfo;