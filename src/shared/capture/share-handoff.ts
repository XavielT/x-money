import { SharedItem } from './share-receiver.service';

// Items shared from another app that were picked up at start-up, waiting for the Capture screen to take
// them (reading them once consumes them from the native side).
export const shareHandoff: { items: SharedItem[] } = { items: [] };
