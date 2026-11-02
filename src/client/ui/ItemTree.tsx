import * as React from 'react';
import type { PropsWithChildren } from 'react';
import CustomImage from '../data/CustomImage';
import TypedObserver from 'TypedObserver';
import I18 from '../locale/I18';

export interface TreeListItem {
	img: CustomImage | null;
	isFolder: boolean;
	path: string;
	name: string;
	selected: boolean;
	current: boolean;
	renaming?: boolean;
	items?: TreeListItem[];
}

export type TreeListItems = {
	readonly [key: string]: TreeListItem
};


class ItemTreePart extends React.Component<TreeListItem> {
	constructor(props: TreeListItem) {
		super(props);
	}

	override render() {
		if(!this.props || !this.props.items?.length) {
			return (<span>&nbsp;</span>);
		}

		return (
			<div>
				{this.props.items.map((item) => {
					let key = item.path;

					if(item.isFolder) {
						return (
							<ItemTreeView key={"tree-folder-" + key} {...item}>
								<ItemTreePart {...item}/>
							</ItemTreeView>
						);
					}

					return (
						<ItemTreeItem key={"tree-item-" + key} {...item}/>
					);
				})}
			</div>
		);
	}
}

class ItemTreeItem extends React.Component<TreeListItem> {
	private readonly renameRef: React.RefObject<HTMLInputElement> = React.createRef();

	constructor(props:TreeListItem) {
		super(props);
	}

	override componentDidMount() {
		this.focusRename();
	}

	override componentDidUpdate(prevProps: TreeListItem) {
		if(!prevProps.renaming) this.focusRename();
	}

	focusRename = () => {
		const input = this.renameRef.current;
		if(!input) return;

		input.focus();
		const dot = input.value.lastIndexOf(".");
		input.setSelectionRange(0, dot > 0 ? dot : input.value.length);
	}

	onStartRename = (e: React.MouseEvent<HTMLDivElement>) => {
		TypedObserver.imageRenameStarted.emit(this.props.path);

		e.preventDefault();
		e.stopPropagation();
	}

	onRenameKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
		e.stopPropagation();

		if(e.key === "Enter") this.finishRename(e.currentTarget.value);
		else if(e.key === "Escape") this.finishRename(this.props.name);
	}

	onRenameBlur = (e: React.FocusEvent<HTMLInputElement>) => {
		this.finishRename(e.currentTarget.value);
	}

	finishRename = (name: string) => {
		TypedObserver.imageRenamed.emit({path: this.props.path, name});
	}

	stopEvent = (e: React.MouseEvent<HTMLInputElement>) => {
		e.stopPropagation();
	}

	onSelect = (e: React.MouseEvent<HTMLDivElement>) => {
		TypedObserver.imageSelected.emit({
			isFolder: false,
			path: this.props.path,
			ctrlKey: e.ctrlKey,
			shiftKey: e.shiftKey
		});

		e.preventDefault();
		e.stopPropagation();
		return false;
	}

	override render() {
		if(!this.props.img) return (<span>&nbsp;</span>);

		return (
			<div className={"image-list-item" + (this.props.selected ? " back-400" : "") + (this.props.current ? " image-list-item-current" : "")} onClick={this.onSelect} onDoubleClick={this.onStartRename} >
				<div className="image-list-image-container">
					<img src={this.props.img.blobSrc} className="image-list-image" />
				</div>
				{this.props.renaming ? (
					<input ref={this.renameRef} type="text" className="image-list-rename border-color-gray" defaultValue={this.props.name} onKeyDown={this.onRenameKeyDown} onBlur={this.onRenameBlur} onClick={this.stopEvent} onDoubleClick={this.stopEvent}/>
				) : (
					<div className="image-list-name-container" title={I18.f("RENAME_FRAME_TITLE")}>
						{this.props.name}
					</div>
				)}
			</div>
		);
	}
}

interface TreeViewState {
	collapsed: boolean;
}

class ItemTreeView extends React.Component<PropsWithChildren<TreeListItem>, TreeViewState> {

	constructor(props: PropsWithChildren<TreeListItem>) {
		super(props);

		this.state = {
			collapsed: false
		};
	}

	handleCollapse = (e: React.MouseEvent<HTMLDivElement>) => {
		this.setState({collapsed: !this.state.collapsed});

		e.preventDefault();
		e.stopPropagation();
		return false;
	}

	handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
		TypedObserver.imageSelected.emit({
			isFolder: true,
			path: this.props.path,
			ctrlKey: e.ctrlKey,
			shiftKey: e.shiftKey
		});

		e.preventDefault();
		e.stopPropagation();
		return false;
	}

	override render() {
		const collapsed = this.state.collapsed;
		const label = this.props.name;
		const children = this.props.children;

		let arrowClass = 'tree-view-arrow';
		let containerClass = 'tree-view-children';
		if (collapsed) {
			arrowClass += ' tree-view-arrow-collapsed';
			containerClass += ' tree-view-children-collapsed';
		}

		const arrow = (<div className={arrowClass} onClick={this.handleCollapse}/>);
		const folderIcon = (<div className="tree-view-folder"></div>);

		return (
			<div className="tree-view" onClick={this.handleClick}>
				<div className={'tree-view-item' + (this.props.selected ? " back-400" : "")}>
					{arrow}
					{folderIcon}
					{label}
				</div>
				<div className={containerClass}>
					{children}
				</div>
			</div>
		);
	}
}

export default ItemTreePart;