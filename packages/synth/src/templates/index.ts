import {
  type SyntheticInvoice,
  TEMPLATE_IDS,
  type TemplateId,
} from "../types.js";
import { classic } from "./classic.js";
import { compact } from "./compact.js";
import { modern } from "./modern.js";

export { TEMPLATE_IDS };

const TEMPLATES: Record<TemplateId, (synthetic: SyntheticInvoice) => string> = {
  classic,
  modern,
  compact,
};

/** Renders a synthetic invoice as a standalone HTML page with its template. */
export function renderHtml(synthetic: SyntheticInvoice): string {
  return TEMPLATES[synthetic.template](synthetic);
}
