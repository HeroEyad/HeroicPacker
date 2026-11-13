import CustomImage from "../data/CustomImage";
import type { LoadedImages } from "api/types";
import TypedObserver from "TypedObserver";
import I18 from "../locale/I18";
import { Observer, GLOBAL_EVENT } from "../Observer";
import { getDummyRect } from "api/utils/common";
import { readFla } from "./AdobleFLAReader";
import { FlaRenderer, listSymbols, type FlaSymbolInfo } from "./FlaRenderer";

export interface FlaImportRequest {
    fileName: string;
    symbols: FlaSymbolInfo[];
    resolve: (ids: string[] | null) => void;
}

const minDigits = 4;
const nextTick = () => new Promise<void>((resolve) => setTimeout(resolve));

function pickName(info: FlaSymbolInfo, used: Set<string>) {
    const parts = info.name.split("/");
    let name = parts[parts.length - 1];

    if (used.has(name)) name = info.name.replace(/\//g, "_");
    for (let i = 2; used.has(name); i++) name = info.name.replace(/\//g, "_") + " (" + i + ")";

    used.add(name);
    return /\d$/.test(name) ? name + "_" : name;
}

export async function loadFlaFile(file: File, into: LoadedImages) {
    const doc = readFla(await file.arrayBuffer());
    const symbols = listSymbols(doc);

    if (!symbols.length) {
        TypedObserver.showMessage.emit(I18.f("FLA_NO_SYMBOLS", file.name));
        return;
    }

    Observer.emit(GLOBAL_EVENT.HIDE_PROCESSING);
    const ids = await new Promise<string[] | null>((resolve) => {
        TypedObserver.flaImportRequested.emit({ fileName: file.name, symbols, resolve });
    });
    
    if (!ids || !ids.length) return;

    Observer.emit(GLOBAL_EVENT.SHOW_PROCESSING);
    await nextTick();

    const renderer = new FlaRenderer(doc);
    const used = new Set<string>();
    const skipped: string[] = [];
    const decoding: Promise<void>[] = [];

	// texture atlas part, ignore it because im still working on it... Unless someone's generous enough to help with assembling.
    /*
    const uniqueParts = new Set<string>();
    for (const rawId of ids) {
        const info = symbols.find((s: FlaSymbolInfo) => s.id === rawId || s.name === rawId);
        if (!info) continue;
        if (info.type === "bitmap") {
            uniqueParts.add(info.name);
        } else {
            const tl = renderer.timelineOf(info.id);
            if (tl) {
                const nestedParts = renderer.getNestedSymbolNames(tl);
                if (nestedParts.length > 0) {
                    nestedParts.forEach((p) => uniqueParts.add(p));
                } else {
                    uniqueParts.add(info.name);
                }
            }
        }
    }

    for (const partName of uniqueParts) {
        let rendered = null;
        try {
            const isBitmap = Boolean(doc.bitmaps[partName]);
            if (isBitmap) {
                rendered = await renderer.renderBitmap(partName);
            } else {
                const tl = renderer.timelineOf("symbol:" + partName);
                if (tl) {
                    rendered = await renderer.renderTimeline(tl);
                    if (rendered && rendered.frames.length > 0) {
                        rendered.frames = [rendered.frames[0]];
                    }
                }
            }
        } catch (e) { console.error(e); }

        if (!rendered || !rendered.frames.length) continue;

        const cleanName = partName.split("/").pop() || partName;
        const name = (used.has(cleanName) ? partName.replace(/\//g, "_") : cleanName) + ".png";
        used.add(cleanName);

        const frame = rendered.frames[0];
        const nativeImage = new Image();
        nativeImage.src = frame.url;

        const image = new CustomImage(nativeImage, name, name, "");
        image.src = frame.url;
        image.base64 = frame.url;
        image.image.src = frame.url;
        image.rect = getDummyRect(name, rendered.width, rendered.height);
        into[name] = image;

        decoding.push(nativeImage.decode().catch(() => {}));
    }
    */

    for (const rawId of ids) {
        const info = symbols.find((s: FlaSymbolInfo) => s.id === rawId || s.name === rawId);
        if (!info) continue;

        let rendered = null;
        try {
            if (info.type === "bitmap") {
                rendered = await renderer.renderBitmap(info.name);
            } else {
                const tl = renderer.timelineOf(info.id);
                if (tl) {
                    rendered = await renderer.renderTimeline(tl);
                }
            }
        }
        catch (e) {
            console.error(e);
        }

        if (!rendered || !rendered.frames.length) {
            skipped.push(info.name);
            continue;
        }

        const base = pickName(info, used);
        const digits = Math.max(minDigits, (rendered.frames.length - 1).toString(10).length);
        const frameMs = 1000 / doc.fps;

        rendered.frames.forEach((frame: { url: string; count: number }, index: number) => {
            const name = base + index.toString(10).padStart(digits, "0") + ".png";
            const nativeImage = new Image();
            nativeImage.src = frame.url;

            const image = new CustomImage(nativeImage, name, name, "");
            image.src = frame.url;
            image.base64 = frame.url;
            image.image.src = frame.url;

            image.rect = getDummyRect(name, rendered.width, rendered.height);
            image.rect.duration = Math.round(frameMs * frame.count);

            into[name] = image;
            decoding.push(nativeImage.decode().catch(() => {}));
        });

        await nextTick();
    }

    await Promise.all(decoding);

    const notes: string[] = [];
    if (skipped.length) notes.push(I18.f("FLA_IMPORT_SKIPPED", skipped.join(", ")));
    if (renderer.failedBitmaps.size) notes.push(I18.f("FLA_BITMAP_WARNING", String(renderer.failedBitmaps.size)));
    if (notes.length) TypedObserver.showMessage.emit(notes.join(" "));
}