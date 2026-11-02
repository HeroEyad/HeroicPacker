import * as React from 'react';
import { createRoot } from 'react-dom/client';

import I18 from './locale/I18';
import APP from './APP';
import MainLayout from './ui/MainLayout';

import Storage from './utils/Storage';
import Theme from './utils/Theme';

import {getLanguageByCode, languages, type Language} from './locale/languages';

import TypedObserver from 'TypedObserver';

let layoutRef: React.RefObject<MainLayout> = React.createRef();

const STORAGE_LANGUAGE_KEY = "language";

Theme.init();

function run() {
	Object.defineProperty(HTMLImageElement.prototype, 'toDataURL', {
		enumerable: false,
		configurable: false,
		writable: false,
		value: function (this: HTMLImageElement, m?: string, q?: any): string {
			const canvas = document.createElement('canvas');
			canvas.width = this.naturalWidth;
			canvas.height = this.naturalHeight;
			const context = canvas.getContext('2d');
			if (context) {
				context.drawImage(this, 0, 0);
				return canvas.toDataURL(m, q);
			}
			throw new Error("Unable to get canvas context");
		}
	});

	loadLocalization();
}

function loadLocalization() {
	I18.supportedLanguages = [];
	for(let i = 0; i < languages.length; i++) {
		I18.supportedLanguages.push(languages[i].lang);
	}
	I18.currentLanguage = getLanguageByCode(Storage.load(STORAGE_LANGUAGE_KEY, false));

	new APP();

	I18.load(renderLayout);

	TypedObserver.changeLanguage.on(setLocale);
}

function renderLayout() {
	const root = createRoot(document.getElementById("root"));
	root.render(
		<React.StrictMode>
			<MainLayout ref={layoutRef}></MainLayout>
		</React.StrictMode>
	);
}

function setLocale(locale: Language) {
	if(!layoutRef || !layoutRef.current) return;

	I18.currentLanguage = locale;
	I18.load(() => {
		Storage.save(STORAGE_LANGUAGE_KEY, I18.currentLanguage.lang);
		layoutRef.current.forceUpdate();
	});
}

window.addEventListener("load", run, false);