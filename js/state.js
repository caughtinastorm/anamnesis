import { getSyncCredentials } from '../sync.js';

export const cardState = { allCards: [], dueCards: [], newCards: [] };
export const selectionState = { selectedDeck: 'all' };
export const studyState = {
  studySessionCards: [], studySessionInfo: { name: 'All Collections', type: 'all', count: 0, isForce: false },
  currentCardIndex: 0, isFlipped: false
};
export const gestureState = { isSwipeActive: false, touchStartX: 0, touchStartY: 0, touchMoveX: 0, touchMoveY: 0 };
export const dialogState = {
  modalConfirmCallback: null, modalCancelCallback: null, modalDismissCallback: null,
  promptModalConfirmCallback: null, promptModalCancelCallback: null
};
export const settingsState = { syncCredentials: getSyncCredentials() };
export const importState = { tempParsedCards: [] };

// Compatibility facade for existing integrations. New code imports its owned slice.
export const state = {};
for (const slice of [cardState, selectionState, studyState, gestureState, dialogState, settingsState, importState]) {
  for (const key of Object.keys(slice)) Object.defineProperty(state, key, {
    enumerable: true, get: () => slice[key], set: value => { slice[key] = value; }
  });
}
