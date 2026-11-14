import * as React from 'react';
import I18 from '../locale/I18';
import type { FlaImportRequest } from '../utils/FlaImport';
import type { FlaSymbolInfo } from '../utils/FlaRenderer';

interface Props {
    readonly request: FlaImportRequest;
    readonly onClose: () => void;
}

interface State {
    selected: ReadonlySet<string>;
    filter: string;
    asAnimation: boolean;
}

class FlaImportDialog extends React.Component<Props, State> {
    override state: State = {
        selected: new Set(),
        filter: "",
        asAnimation: true
    };

    private done = false;

    override componentDidMount = () => {
        globalThis.addEventListener("keydown", this.onKey, false);
    }

    override componentWillUnmount = () => {
        globalThis.removeEventListener("keydown", this.onKey, false);
    }

    onKey = (e: KeyboardEvent) => {
        if (e.key === "Escape") this.cancel();
    }

    finish = (ids: string[] | null, asAnimation: boolean = true) => {
        if (this.done) return;
        this.done = true;
        this.props.request.resolve(ids, asAnimation);
    }

    cancel = () => {
        this.finish(null);
        this.props.onClose();
    }

    confirm = () => {
        if (!this.state.selected.size) return;
        this.finish(Array.from(this.state.selected), this.state.asAnimation);
        this.props.onClose();
    }

    visible = () => {
        const filter = this.state.filter.trim().toLowerCase();
        return this.props.request.symbols.filter((s: FlaSymbolInfo) => !filter || s.name.toLowerCase().includes(filter));
    }

    toggle = (id: string) => {
        const selected = new Set(this.state.selected);
        if (!selected.delete(id)) selected.add(id);
        this.setState({ selected });
    }

    selectVisible = (on: boolean) => {
        const selected = new Set(this.state.selected);
        for (const s of this.visible()) {
            if (on) selected.add(s.id);
            else selected.delete(s.id);
        }
        this.setState({ selected });
    }

    onFilter = (e: React.ChangeEvent<HTMLInputElement>) => {
        this.setState({ filter: e.target.value });
    }

    onAsAnimation = () => {
        this.setState({ asAnimation: !this.state.asAnimation });
    }

    override render() {
        const count = this.state.selected.size;

        return (
            <div className="message-box-wrapper">
                <div className="message-box-window fla-import-window">
                    <div className="fla-import-title">{I18.f("FLA_IMPORT_TITLE", this.props.request.fileName)}</div>

                    <div className="fla-import-tools">
                        <input type="text" value={this.state.filter} onChange={this.onFilter} placeholder={I18.f("FLA_IMPORT_SEARCH")} autoFocus />
                        <div className="btn back-800 border-color-gray color-white" onClick={() => this.selectVisible(true)}>{I18.f("FLA_IMPORT_ALL")}</div>
                        <div className="btn back-800 border-color-gray color-white" onClick={() => this.selectVisible(false)}>{I18.f("FLA_IMPORT_NONE")}</div>
                    </div>

                    <div className="fla-import-list border-color-gray">
                        {this.visible().map((s: FlaSymbolInfo) => (
                            <label key={s.id} className="fla-import-row">
                                <input type="checkbox" checked={this.state.selected.has(s.id)} onChange={() => this.toggle(s.id)} />
                                <span className="fla-import-name" title={s.name}>{s.name}</span>
                                <span className="fla-import-meta">{s.type} ({I18.f("FLA_IMPORT_FRAMES", String(s.frames))})</span>
                            </label>
                        ))}
                    </div>

                    <label className="fla-import-option" title={I18.f("FLA_IMPORT_AS_ANIMATION_TITLE")}>
                        <input type="checkbox" checked={this.state.asAnimation} onChange={this.onAsAnimation} />
                        <span>{I18.f("FLA_IMPORT_AS_ANIMATION")}</span>
                    </label>

                    <div className="fla-import-buttons">
                        <div className="btn back-800 border-color-gray color-white" onClick={this.cancel}>{I18.f("CANCEL")}</div>
                        <div className={"btn back-600 border-color-gray color-white" + (count ? "" : " disabled")} onClick={this.confirm}>
                            {I18.f("FLA_IMPORT_CONFIRM", String(count))}
                        </div>
                    </div>
                </div>
            </div>
        );
    }
}

export default FlaImportDialog;