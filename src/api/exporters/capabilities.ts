import type { Exporter } from 'api/exporters';

export function exporterAllowsTrim(exporter: Exporter | null | undefined) {
	if(!exporter) return true;
	return exporter.allowTrim || Boolean(exporter.animateAtlas);
}

export function exporterAllowsScale(exporter: Exporter | null | undefined) {
	if(!exporter) return true;
	return exporter.allowScale !== false || Boolean(exporter.animateAtlas);
}
