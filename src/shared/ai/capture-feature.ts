import { AiFeatureDef } from './ai.types';

// Smart capture (2.18.0): the one function that sends a DOCUMENT (an image, a PDF, or the text of a
// notice, a voice transcript or an email) instead of aggregates. It has its own switch and consent, it
// is never cached, and its answer is a fixed JSON shape that the app converts and the user approves.
export const CAPTURE_FEATURE_ID = 'capture_parse';

export const CAPTURE_FEATURE: AiFeatureDef = {
  id: CAPTURE_FEATURE_ID,
  kind: 'capture',
  module: null,
  sends: 'document',
  labelKey: 'Smart capture',
  describeKey: 'The image, PDF or text of each capture you choose is sent to read it. Nothing else from your data.',
  ttlMs: 0,
  output: 'plain',
};
