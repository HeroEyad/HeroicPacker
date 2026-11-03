import APP from '../APP';
import I18 from '../locale/I18';
import type CustomImage from '../data/CustomImage';
import type { LoadedImages } from 'api/types';
import { exportedName } from 'api/exporters';
import { smartSortImages } from 'api/utils/common';
import { JobError, baseName, classify, planJobs, type InputFile } from 'api/utils/SheetJobs';
import { expandInputs, readJobFrames } from './BulkRepack';

export type FrameSet = Readonly<{
	label: string;
	frames: ReadonlyMap<string, CustomImage>;
}>;

function namedFrames(images: LoadedImages, removeFileExtension: boolean, prependFolderName: boolean) {
	const frames = new Map<string, CustomImage>();
	for (const key of Object.keys(images).sort(smartSortImages)) {
		frames.set(exportedName(key, removeFileExtension, prependFolderName), images[key]);
	}
	return frames;
}

export function currentFrameSet(): FrameSet | null {
	const images = APP.i.images;
	if (!Object.keys(images).length) return null;

	const options = APP.i.packOptions;
	return {
		label: I18.f("FRAMES_CURRENT"),
		frames: namedFrames(images, options.removeFileExtension ?? true, options.prependFolderName ?? true)
	};
}

export async function readFrameSet(files: ReadonlyArray<InputFile>): Promise<FrameSet> {
	const expanded = await expandInputs(files);
	const { jobs, skipped } = planJobs(classify(expanded.files), true, expanded.zipName ?? "frames");
	const job = jobs[0];
	if (!job) throw new JobError(skipped[0] ?? I18.f("FRAMES_NONE"));

	const { images } = await readJobFrames(job);
	const parts = job.sheets.map(sheet => baseName(sheet.picture.name) + " + " + baseName(sheet.file.name));
	if (job.loose.length) parts.push(I18.f("FRAMES_LOOSE", String(job.loose.length)));

	return { label: parts.join(", "), frames: namedFrames(images, true, true) };
}
