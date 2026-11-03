import * as React from 'react';

import ImagesList from './ImagesList';
import MainHeader from './MainHeader';
import PackProperties from './PackProperties';
import PackResults from './PackResults';
import MessageBox, { type ButtonData } from './MessageBox';
import ProcessingOverlay from './ProcessingOverlay';
import OldBrowserBlocker from './OldBrowserBlocker';
import EditCustomExporter from './EditCustomExporter';
import SheetSplitter from './SheetSplitter';
import BulkOptimizer from './BulkOptimizer';
import SheetCompare from './SheetCompare';
import NoteSkinChecker from './NoteSkinChecker';

import { Observer, GLOBAL_EVENT } from '../Observer';
import TypedObserver from 'TypedObserver';
import I18 from '../locale/I18';

type MobileTab = "images" | "sheet" | "options";

const MOBILE_TABS: ReadonlyArray<Readonly<{ id: MobileTab, label: string }>> = [
	{ id: "images", label: "IMAGES" },
	{ id: "sheet", label: "MOBILE_TAB_SHEET" },
	{ id: "options", label: "MOBILE_TAB_OPTIONS" }
];

interface Props {}

interface State {
	mobileTab: MobileTab;
	messageBox: React.ReactNode;
	processing: boolean;
	editCustomExporter: boolean;
	sheetSplitter: boolean;
	bulkOptimizer: boolean;
	sheetCompare: boolean;
	noteSkinCheck: boolean;
	browserBlocker: boolean;
}

class MainLayout extends React.Component<Props, State> {
	constructor(props:Props) {
		super(props);

		this.state = {
			mobileTab: "images",
			messageBox: null,
			processing: false,
			editCustomExporter: false,
			sheetSplitter: false,
			bulkOptimizer: false,
			sheetCompare: false,
			noteSkinCheck: false,
			browserBlocker: !OldBrowserBlocker.isSupported()
		};
	}

	override componentDidMount = () => {
		TypedObserver.showMessage.on(this.showMessage, this);
		Observer.on(GLOBAL_EVENT.SHOW_PROCESSING, this.showProcessing, this);
		Observer.on(GLOBAL_EVENT.HIDE_PROCESSING, this.hideProcessing, this);
		Observer.on(GLOBAL_EVENT.SHOW_EDIT_CUSTOM_EXPORTER, this.showEditCustomExporter, this);
		Observer.on(GLOBAL_EVENT.HIDE_EDIT_CUSTOM_EXPORTER, this.hideEditCustomExporter, this);
		Observer.on(GLOBAL_EVENT.SHOW_SHEET_SPLITTER, this.showSheetSplitter, this);
		Observer.on(GLOBAL_EVENT.HIDE_SHEET_SPLITTER, this.hideSheetSplitter, this);
		Observer.on(GLOBAL_EVENT.SHOW_BULK_OPTIMIZER, this.showBulkOptimizer, this);
		Observer.on(GLOBAL_EVENT.HIDE_BULK_OPTIMIZER, this.hideBulkOptimizer, this);
		Observer.on(GLOBAL_EVENT.SHOW_SHEET_COMPARE, this.showSheetCompare, this);
		Observer.on(GLOBAL_EVENT.HIDE_SHEET_COMPARE, this.hideSheetCompare, this);
		Observer.on(GLOBAL_EVENT.SHOW_NOTE_SKIN_CHECK, this.showNoteSkinCheck, this);
		Observer.on(GLOBAL_EVENT.HIDE_NOTE_SKIN_CHECK, this.hideNoteSkinCheck, this);
	}

	override componentWillUnmount = () => {
		TypedObserver.showMessage.off(this.showMessage, this);
		Observer.off(GLOBAL_EVENT.SHOW_PROCESSING, this.showProcessing, this);
		Observer.off(GLOBAL_EVENT.HIDE_PROCESSING, this.hideProcessing, this);
		Observer.off(GLOBAL_EVENT.SHOW_EDIT_CUSTOM_EXPORTER, this.showEditCustomExporter, this);
		Observer.off(GLOBAL_EVENT.HIDE_EDIT_CUSTOM_EXPORTER, this.hideEditCustomExporter, this);
		Observer.off(GLOBAL_EVENT.SHOW_SHEET_SPLITTER, this.showSheetSplitter, this);
		Observer.off(GLOBAL_EVENT.HIDE_SHEET_SPLITTER, this.hideSheetSplitter, this);
		Observer.off(GLOBAL_EVENT.SHOW_BULK_OPTIMIZER, this.showBulkOptimizer, this);
		Observer.off(GLOBAL_EVENT.HIDE_BULK_OPTIMIZER, this.hideBulkOptimizer, this);
		Observer.off(GLOBAL_EVENT.SHOW_SHEET_COMPARE, this.showSheetCompare, this);
		Observer.off(GLOBAL_EVENT.HIDE_SHEET_COMPARE, this.hideSheetCompare, this);
		Observer.off(GLOBAL_EVENT.SHOW_NOTE_SKIN_CHECK, this.showNoteSkinCheck, this);
		Observer.off(GLOBAL_EVENT.HIDE_NOTE_SKIN_CHECK, this.hideNoteSkinCheck, this);
	}

	showMessage = (content: string, buttons?: ButtonData[]) => {
		if(this.state.messageBox) return;

		let box = (<MessageBox content={content} buttons={buttons} closeCallback={this.closeMessage} />);
		this.setState({messageBox: box});
	}

	closeMessage = () => {
		this.setState({messageBox: null});
	}

	showProcessing = () => {
		this.setState({processing: true});
	}

	hideProcessing = () => {
		this.setState({processing: false});
	}

	showEditCustomExporter = () => {
		this.setState({editCustomExporter: true});
	}

	hideEditCustomExporter = () => {
		this.setState({editCustomExporter: false});
	}

	showSheetSplitter = () => {
		this.setState({sheetSplitter: true});
	}

	hideSheetSplitter = () => {
		this.setState({sheetSplitter: false});
	}

	showBulkOptimizer = () => {
		this.setState({bulkOptimizer: true});
	}

	hideBulkOptimizer = () => {
		this.setState({bulkOptimizer: false});
	}

	showSheetCompare = () => {
		this.setState({sheetCompare: true});
	}

	hideSheetCompare = () => {
		this.setState({sheetCompare: false});
	}

	showNoteSkinCheck = () => {
		this.setState({noteSkinCheck: true});
	}

	hideNoteSkinCheck = () => {
		this.setState({noteSkinCheck: false});
	}

	showMobileTab = (tab: MobileTab) => {
		this.setState({mobileTab: tab});
	}

	override render() {
		return (
			<div className="main-wrapper">
				<MainHeader/>

				<div className={"main-layout border-color-gray mobile-" + this.state.mobileTab}>
					<ImagesList/>
					<PackProperties/>
					<PackResults/>
					{this.state.browserBlocker ? (<OldBrowserBlocker/>) : null}
					{this.state.editCustomExporter ? (<EditCustomExporter/>) : null}
					{this.state.sheetSplitter ? (<SheetSplitter/>) : null}
					{this.state.bulkOptimizer ? (<BulkOptimizer/>) : null}
					{this.state.sheetCompare ? (<SheetCompare/>) : null}
					{this.state.noteSkinCheck ? (<NoteSkinChecker/>) : null}
					{this.state.processing ? (<ProcessingOverlay/>) : null}
					{this.state.messageBox}
				</div>

				<div className="mobile-tabs back-900">
					{MOBILE_TABS.map(tab => (
						<div key={"mobile-tab-" + tab.id} className={"mobile-tab color-white" + (this.state.mobileTab === tab.id ? " mobile-tab-current" : "")} onClick={() => this.showMobileTab(tab.id)}>
							{I18.f(tab.label)}
						</div>
					))}
				</div>
			</div>
		);
	}
}

export default MainLayout;