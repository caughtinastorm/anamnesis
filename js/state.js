import * as sync from '../sync.js';

export const state = {
  allCards: [],
  dueCards: [],
  newCards: [],
  selectedDeck: "all", // "all" | "folder:<folderName>" | "deck:<folder> / <deck>" | "deck:<standaloneDeck>"
  studySessionCards: [],
  studySessionInfo: { name: "All Collections", type: "all", count: 0, isForce: false },
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

