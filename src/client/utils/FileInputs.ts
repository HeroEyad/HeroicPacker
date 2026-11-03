import type { InputFile } from 'api/utils/SheetJobs';

export async function readFile(file: File, name: string = file.webkitRelativePath || file.name): Promise<InputFile> {
	return { name, data: new Uint8Array(await file.arrayBuffer()) };
}

function readEntries(reader: FileSystemDirectoryReader) {
	return new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject));
}

function entryFile(entry: FileSystemFileEntry) {
	return new Promise<File>((resolve, reject) => entry.file(resolve, reject));
}

async function readEntry(entry: FileSystemEntry, out: InputFile[]) {
	if (entry.isFile) {
		out.push(await readFile(await entryFile(entry as FileSystemFileEntry), entry.fullPath));
		return;
	}

	const reader = (entry as FileSystemDirectoryEntry).createReader();
	for (let batch = await readEntries(reader); batch.length; batch = await readEntries(reader)) {
		for (const child of batch) await readEntry(child, out);
	}
}

export async function readPicked(input: HTMLInputElement) {
	const picked = Array.from(input.files ?? []);
	input.value = "";
	return Promise.all(picked.map(file => readFile(file)));
}

export async function readDropped(transfer: DataTransfer) {
	const entries = Array.from(transfer.items ?? [])
		.map(item => item.kind === "file" ? item.webkitGetAsEntry() : null)
		.filter((entry): entry is FileSystemEntry => entry !== null);

	const out: InputFile[] = [];
	if (entries.length) {
		for (const entry of entries) await readEntry(entry, out);
	}
	else {
		for (const file of Array.from(transfer.files ?? [])) out.push(await readFile(file, file.name));
	}

	return out;
}
