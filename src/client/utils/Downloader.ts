import * as JSZip from 'jszip';
import * as FileSaver from 'file-saver';
import type { FileData } from 'types';

class Downloader {
	static run(files: FileData[], fileName: string) {
		const zip = new JSZip();
		const now = new Date();
		const date = new Date(now.getTime() - now.getTimezoneOffset() * 60000);

		for (const file of files) {
			zip.file(file.name, file.content, { base64: !!file.base64, date });
		}

		if (fileName.split('.').pop() !== 'zip') fileName += '.zip';

		zip.generateAsync({ type: 'blob' }).then(content => {
			FileSaver.saveAs(content, fileName);
		});
	}
}

export default Downloader;
