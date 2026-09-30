export { generateInvoice } from "./generate.js";
export { createRandom, type Random } from "./random.js";
export {
  type Augmentation,
  CLEAN,
  randomAugmentation,
  renderDocument,
} from "./render.js";
export {
  ERROR_KINDS,
  type ErrorKind,
  generateReviewFixtures,
  type InjectedError,
  injectError,
  type ReviewFixture,
  type ReviewFixtureManifest,
  renderInvoiceText,
} from "./review-fixtures.js";
export { renderHtml } from "./templates/index.js";
export {
  type SyntheticInvoice,
  TEMPLATE_IDS,
  type TemplateId,
} from "./types.js";
