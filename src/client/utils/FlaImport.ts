import CustomImage from "../data/CustomImage";
import type { LoadedImages } from "api/types";
import TypedObserver from "TypedObserver";
import I18 from "../locale/I18";
import APP from "../APP";
import { Observer, GLOBAL_EVENT } from "../Observer";
import { getDummyRect } from "api/utils/common";
import { readFla } from "./AdobleFLAReader";
import { FlaRenderer, listSymbols, type FlaSymbolInfo, type RenderedTimeline } from "./FlaRenderer";
import { animationLabelNames, appendAnimations, buildFlaAnimation, spriteNames, type FlaAnimationResult } from "./FlaAnimation";

export interface FlaImportRequest {
    fileName: string;
    symbols: FlaSymbolInfo[];
    resolve: (ids: string[] | null, asAnimation?: boolean) => void;
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

function pickLabel(info: FlaSymbolInfo, used: Set<string>) {
    const base = (info.name.split("/").pop() || info.name).trim() || "animation";

    let name = base;
    for (let i = 2; used.has(name); i++) name = base + " " + i;

    used.add(name);
    return name;
}

export async function loadFlaFile(file: File, into: LoadedImages) {
    const doc = readFla(await file.arrayBuffer());
    const symbols = listSymbols(doc);

    if (!symbols.length) {
        TypedObserver.showMessage.emit(I18.f("FLA_NO_SYMBOLS", file.name));
        return;
    }

    Observer.emit(GLOBAL_EVENT.HIDE_PROCESSING);
    const choice = await new Promise<{ ids: string[]; asAnimation: boolean } | null>((resolve) => {
        TypedObserver.flaImportRequested.emit({
            fileName: file.name,
            symbols,
            resolve: (ids, asAnimation = true) => resolve(ids && ids.length ? { ids, asAnimation } : null)
        });
    });

    if (!choice) return;

    Observer.emit(GLOBAL_EVENT.SHOW_PROCESSING);
    await nextTick();

    const renderer = new FlaRenderer(doc);
    const used = new Set<string>();
    const skipped: string[] = [];
    const decoding: Promise<void>[] = [];

    const current = APP.i.api.getAnimation();
    const labels = new Set(animationLabelNames(current ? current.data : null));
    const taken = spriteNames(current ? current.data : null);
    const built: FlaAnimationResult[] = [];

    const addImage = (name: string, url: string, size?: RenderedTimeline, duration?: number) => {
        const image = new CustomImage(new Image());
        image.src = url;
        image.base64 = url;

        if (size) {
            image.rect = getDummyRect(name, size.width, size.height);
            if (duration) image.rect.duration = duration;
        }

        into[name] = image;
        decoding.push(image.image.decode().catch(() => {}));
    };

    for (const id of choice.ids) {
        const info = symbols.find((s: FlaSymbolInfo) => s.id === id);
        if (!info) continue;

        if (info.type !== "bitmap" && choice.asAnimation) {
            const tl = renderer.timelineOf(info.id);
            let result: FlaAnimationResult | null = null;

            try {
                if (tl) result = await buildFlaAnimation(doc, renderer, tl, info.name, pickLabel(info, labels), taken);
            }
            catch (e) {
                console.error(e);
            }

            if (!result) {
                skipped.push(info.name);
                continue;
            }

            for (const part of result.parts) addImage(result.label + "/" + part.name + ".png", part.url);
            built.push(result);

            await nextTick();
            continue;
        }

        let rendered: RenderedTimeline | null = null;
        try {
            if (info.type === "bitmap") {
                rendered = await renderer.renderBitmap(info.name);
            }
            else {
                const tl = renderer.timelineOf(info.id);
                if (tl) rendered = await renderer.renderTimeline(tl);
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
        const size = rendered;

        rendered.frames.forEach((frame, index) => {
            const name = base + index.toString(10).padStart(digits, "0") + ".png";
            addImage(name, frame.url, size, Math.round(frameMs * frame.count));
        });

        await nextTick();
    }

    if (built.length) {
        const baseName = file.name.replace(/\.[^.]+$/, "");
        APP.i.api.setAnimation({
            name: current ? current.name : baseName,
            data: appendAnimations(current ? current.data : null, baseName, doc.fps, built)
        });
    }

    await Promise.all(decoding);

    const notes: string[] = [];
    if (skipped.length) notes.push(I18.f("FLA_IMPORT_SKIPPED", skipped.join(", ")));
    if (renderer.failedBitmaps.size) notes.push(I18.f("FLA_BITMAP_WARNING", String(renderer.failedBitmaps.size)));
    if (notes.length) TypedObserver.showMessage.emit(notes.join(" "));
}
