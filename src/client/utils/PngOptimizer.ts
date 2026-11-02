import init, { optimise } from '@jsquash/oxipng/codec/pkg/squoosh_oxipng.js';

let wasmReady: ReturnType<typeof init> | undefined;

function base64ToArrayBuffer(base64: string) {
	const binary = atob(base64);

	const bytes = new Uint8Array(binary.length);

	for (let i = 0; i < binary.length; i++) {
		bytes[i] = binary.charCodeAt(i);
	}

	return bytes.buffer;
}

export function arrayBufferToBase64(buffer: Uint8Array) {
	const bytes = buffer;

	let binary = "";

	const chunkSize = 0x8000;

	for (let i = 0; i < bytes.length; i += chunkSize) {
		binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
	}

	return btoa(binary);
}

export async function optimisePng(base64: string, level: number = 3) {
	wasmReady ||= init();

	await wasmReady;

	const data = new Uint8Array(base64ToArrayBuffer(base64));

	const optimised = optimise(
		data,
		level,
		false,
		true
	);

	return arrayBufferToBase64(optimised);
}