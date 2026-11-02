import * as React from 'react';

import { Observer, GLOBAL_EVENT } from '../Observer';
import I18 from '../locale/I18';
import * as appInfo from '../../../package.json';
import { getLanguageByCode, languages } from '../locale/languages';
import StatsInfo from './StatsInfo';
import TypedObserver from 'TypedObserver';
import Theme, { type ThemeChoice } from '../utils/Theme';

const THEME_LABELS: Readonly<Record<ThemeChoice, string>> = {
	system: "THEME_SYSTEM",
	light: "THEME_LIGHT",
	dark: "THEME_DARK"
};

const {
	displayName: appDisplayName,
	version: appVersion
} = appInfo;

class MainHeader extends React.Component {

	changeLanguage = (e: React.ChangeEvent<HTMLSelectElement>) => {
		TypedObserver.changeLanguage.emit(getLanguageByCode(e.target.value));
	}

	changeTheme = (e: React.ChangeEvent<HTMLSelectElement>) => {
		Theme.set(e.target.value as ThemeChoice);
	}

	showSplitter = () => {
		Observer.emit(GLOBAL_EVENT.SHOW_SHEET_SPLITTER);
	}

	showBulkOptimizer = () => {
		Observer.emit(GLOBAL_EVENT.SHOW_BULK_OPTIMIZER);
	}

	override render() {
		return (
			<div className="main-header back-900 color-white">
				<div className='left-align'>
					<div className="main-header-app-name">
						<img src="static/images/logo.png" alt="Logo" />
						{appDisplayName} {appVersion}
					</div>

					<div className='main-header-github'>
						<a href="https://twitter.com/HeroEyad_" target="_blank">
							<img src="static/images/twitter-256.png" height="25" alt="Github" />
						</a>
					</div>
					<div className='main-header-ko-fi'>
						<a href="https://ko-fi.com/SaharianHero" target="_blank">
							<img src="static/images/ko-fi.png" height="25" alt="Ko-Fi" />
						</a>
					</div>
				</div>

				<StatsInfo />

				<div className='right-align'>
					<div className="main-header-controls">
						<div className="btn back-700 border-color-gray color-white" onClick={this.showSplitter}>{I18.f("SPLITTER")}</div>
						<div className="btn back-700 border-color-gray color-white main-header-bulk" title={I18.f("BULK_OPTIMIZE_TITLE")} onClick={this.showBulkOptimizer}>{I18.f("BULK_OPTIMIZE")}</div>
					</div>

					<div className="main-header-language border-color-gray">
						{I18.f("THEME")}
						<select defaultValue={Theme.choice} onChange={this.changeTheme}>
							{
								Theme.choices.map((item) => {
									return (
										<option key={"theme_" + item} value={item}>
											{I18.f(THEME_LABELS[item])}
										</option>
									)
								})
							}
						</select>
					</div>

					<div className="main-header-language border-color-gray">
						{I18.f("LANGUAGE")}
						<select defaultValue={I18.currentLanguage.lang} onChange={this.changeLanguage}>
							{
								languages.map((item) => {
									return (
										<option key={"localization_" + item.lang} value={item.lang}>
											{item.name}
										</option>
									)
								})
							}
						</select>
					</div>
				</div>
			</div>
		);
	}
}

export default MainHeader;