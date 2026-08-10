import * as sync from '../sync.js';

export const state = {
  allCards: [],
  dueCards: [],
  newCards: [],
  studySessionCards: [],
  currentCardIndex: 0,
  syncCredentials: sync.getSyncCredentials(),
  isFlipped: false,
  isSwipeActive: false,
  modalConfirmCallback: null,
  touchStartX: 0,
  touchStartY: 0,
  touchMoveX: 0,
  touchMoveY: 0,
  tempParsedCards: []
};
