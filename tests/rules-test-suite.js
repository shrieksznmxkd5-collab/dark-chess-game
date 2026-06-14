import { CAMPS, PHASES, PIECE_TYPES } from "../js/config.js";
import { HIDDEN_START_SLOTS } from "../js/board.js";
import { createCustomState } from "../js/game-state.js";
import { createFixturePiece, createInitialPieces } from "../js/pieces.js";
import { validateBasicMove, getActiveCamp, getPieceAt } from "../js/rules.js";
import { isGeneralFaceToFace, isGeneralUnderAttack } from "../js/attacks.js";
import { advancePastNoLegalMoves, makeMove } from "../js/move-transaction.js";
import { chooseAiMove, scoreAiMove } from "../js/ai.js";
import {
  applyMove as applyEngineMove,
  buildShuffleLayout,
  countHiddenCamps,
  countHiddenTypes,
  createPublicSnapshot,
  getHalfCampCounts,
  getMaxSameCampRun
} from "../shared/engine/index.js";

function piece(options) {
  return createFixturePiece(options);
}

function generals() {
  return [
    piece({ id: "red-general", type: PIECE_TYPES.GENERAL, camp: CAMPS.RED, row: 9, col: 4 }),
    piece({ id: "black-general", type: PIECE_TYPES.GENERAL, camp: CAMPS.BLACK, row: 0, col: 3 })
  ];
}

function stateWith(pieces, currentCamp = CAMPS.RED, options = {}) {
  return createCustomState({
    pieces,
    currentCamp,
    phase: options.phase ?? PHASES.NORMAL,
    delayedThreat: options.delayedThreat ?? null
  });
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function run(name, fn) {
  try {
    fn();
    return { name, ok: true };
  } catch (error) {
    return { name, ok: false, error: error.stack ?? String(error) };
  }
}

function seededRandom(seed) {
  let value = seed >>> 0;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 0x100000000;
  };
}

function hiddenPieces(pieces) {
  return pieces.filter((item) => !item.faceUp);
}

function typeKey(camp, type) {
  return `${camp}-${type}`;
}

function createLayoutFromInitialPieces(pieces) {
  const deck = hiddenPieces(pieces).map((item) => ({
    realType: item.realType,
    realCamp: item.realCamp
  }));
  return buildShuffleLayout(HIDDEN_START_SLOTS, deck);
}

function moveFor(state, pieceId, row, col) {
  const moving = state.pieces.find((item) => item.id === pieceId);
  return {
    pieceId,
    fromRow: moving.row,
    fromCol: moving.col,
    row,
    col,
    piece: moving,
    targetPiece: getPieceAt(state.pieces, row, col, pieceId)
  };
}

function createDelayedFixture() {
  const dark = piece({
    id: "dark-trigger",
    type: PIECE_TYPES.SOLDIER,
    camp: CAMPS.RED,
    realType: PIECE_TYPES.ROOK,
    realCamp: CAMPS.BLACK,
    initialRole: PIECE_TYPES.SOLDIER,
    initialCamp: CAMPS.RED,
    faceUp: false,
    row: 6,
    col: 4
  });
  const state = stateWith([...generals(), dark], CAMPS.RED);
  const result = makeMove(state, "dark-trigger", 5, 4);
  assert(result.ok, result.reason);
  assert(state.delayedThreat?.active, "delayed threat should be created");
  return state;
}

export function runRulesTests() {
  const tests = [
    run("26 hidden pieces are created", () => {
      const pieces = createInitialPieces(() => 0.42);
      assert(hiddenPieces(pieces).length === 26, "hidden count should be 26");
      assert(pieces.length === 32, "total piece count should be 32");
    }),

    run("generals and advisors are fixed visible pieces", () => {
      const pieces = createInitialPieces(() => 0.7);
      const fixed = pieces.filter((item) => item.faceUp);
      assert(fixed.length === 6, "visible fixed count should be 6");
      assert(
        fixed.every(
          (item) =>
            item.realType === PIECE_TYPES.GENERAL ||
            item.realType === PIECE_TYPES.ADVISOR
        ),
        "visible fixed pieces should only be generals and advisors"
      );
    }),

    run("controlled shuffle keeps 13 hidden pieces per camp", () => {
      const hidden = hiddenPieces(createInitialPieces(seededRandom(11)));
      const counts = countHiddenCamps(hidden);
      assert(counts[CAMPS.RED] === 13, "red hidden count should be 13");
      assert(counts[CAMPS.BLACK] === 13, "black hidden count should be 13");
    }),

    run("controlled shuffle keeps exact hidden type counts", () => {
      const hidden = hiddenPieces(createInitialPieces(seededRandom(12)));
      const counts = countHiddenTypes(hidden);
      const expected = {
        [typeKey(CAMPS.RED, PIECE_TYPES.ROOK)]: 2,
        [typeKey(CAMPS.RED, PIECE_TYPES.HORSE)]: 2,
        [typeKey(CAMPS.RED, PIECE_TYPES.ELEPHANT)]: 2,
        [typeKey(CAMPS.RED, PIECE_TYPES.CANNON)]: 2,
        [typeKey(CAMPS.RED, PIECE_TYPES.SOLDIER)]: 5,
        [typeKey(CAMPS.BLACK, PIECE_TYPES.ROOK)]: 2,
        [typeKey(CAMPS.BLACK, PIECE_TYPES.HORSE)]: 2,
        [typeKey(CAMPS.BLACK, PIECE_TYPES.ELEPHANT)]: 2,
        [typeKey(CAMPS.BLACK, PIECE_TYPES.CANNON)]: 2,
        [typeKey(CAMPS.BLACK, PIECE_TYPES.SOLDIER)]: 5
      };

      Object.entries(expected).forEach(([key, value]) => {
        assert(counts[key] === value, `${key} should be ${value}`);
      });
    }),

    run("hidden real identity is fixed at opening", () => {
      const hidden = hiddenPieces(createInitialPieces(seededRandom(13)));
      assert(
        hidden.every((item) => item.realType && item.realCamp),
        "hidden pieces should have fixed real identities before reveal"
      );
    }),

    run("reveal does not reroll hidden identity", () => {
      const dark = piece({
        id: "dark-fixed",
        initialRole: PIECE_TYPES.SOLDIER,
        initialCamp: CAMPS.RED,
        realType: PIECE_TYPES.HORSE,
        realCamp: CAMPS.BLACK,
        faceUp: false,
        row: 6,
        col: 2
      });
      const state = stateWith([...generals(), dark]);
      const before = { realType: dark.realType, realCamp: dark.realCamp };
      const result = makeMove(state, "dark-fixed", 5, 2);
      const moved = state.pieces.find((item) => item.id === "dark-fixed");
      assert(result.ok, result.reason);
      assert(moved.faceUp, "piece should reveal after first move");
      assert(moved.realType === before.realType, "real type should not change");
      assert(moved.realCamp === before.realCamp, "real camp should not change");
    }),

    run("most controlled shuffles avoid four same-camp runs", () => {
      let accepted = 0;
      for (let seed = 1; seed <= 80; seed += 1) {
        const layout = createLayoutFromInitialPieces(createInitialPieces(seededRandom(seed)));
        if (getMaxSameCampRun(layout) <= 3) {
          accepted += 1;
        }
      }
      assert(accepted >= 72, `expected at least 72 balanced runs, got ${accepted}`);
    }),

    run("most controlled shuffles keep both halves balanced", () => {
      let accepted = 0;
      for (let seed = 101; seed <= 180; seed += 1) {
        const layout = createLayoutFromInitialPieces(createInitialPieces(seededRandom(seed)));
        const counts = getHalfCampCounts(layout);
        const blackHalfRed = counts[CAMPS.BLACK][CAMPS.RED];
        const redHalfRed = counts[CAMPS.RED][CAMPS.RED];
        if (
          blackHalfRed >= 5 &&
          blackHalfRed <= 8 &&
          redHalfRed >= 5 &&
          redHalfRed <= 8
        ) {
          accepted += 1;
        }
      }
      assert(accepted >= 72, `expected at least 72 balanced halves, got ${accepted}`);
    }),

    run("new games still produce non-fixed shuffle results", () => {
      const signatures = new Set();
      for (let seed = 201; seed <= 212; seed += 1) {
        const hidden = hiddenPieces(createInitialPieces(seededRandom(seed)));
        signatures.add(
          hidden.map((item) => `${item.realCamp}:${item.realType}`).join("|")
        );
      }
      assert(signatures.size > 3, "controlled shuffle should not use a fixed template");
    }),

    run("dark piece first move uses initialRole", () => {
      const dark = piece({
        id: "dark-soldier",
        type: PIECE_TYPES.SOLDIER,
        camp: CAMPS.RED,
        realType: PIECE_TYPES.ROOK,
        realCamp: CAMPS.RED,
        initialRole: PIECE_TYPES.SOLDIER,
        initialCamp: CAMPS.RED,
        faceUp: false,
        row: 6,
        col: 0
      });
      const state = stateWith([...generals(), dark]);
      const result = makeMove(state, "dark-soldier", 5, 0);
      assert(result.ok, result.reason);
      assert(
        state.pieces.find((item) => item.id === "dark-soldier").row === 5,
        "dark piece should move as a red soldier"
      );
    }),

    run("dark piece can capture on first move", () => {
      const dark = piece({
        id: "dark-rook",
        type: PIECE_TYPES.ROOK,
        camp: CAMPS.RED,
        realType: PIECE_TYPES.HORSE,
        realCamp: CAMPS.RED,
        initialRole: PIECE_TYPES.ROOK,
        initialCamp: CAMPS.RED,
        faceUp: false,
        row: 5,
        col: 0
      });
      const target = piece({
        id: "black-target",
        type: PIECE_TYPES.SOLDIER,
        camp: CAMPS.BLACK,
        row: 5,
        col: 3
      });
      const state = stateWith([...generals(), dark, target]);
      const result = makeMove(state, "dark-rook", 5, 3);
      assert(result.ok, result.reason);
      assert(!state.pieces.find((item) => item.id === "black-target").alive, "target should be captured");
    }),

    run("first dark move reveals the piece", () => {
      const dark = piece({
        id: "dark-reveal",
        initialRole: PIECE_TYPES.SOLDIER,
        initialCamp: CAMPS.RED,
        realType: PIECE_TYPES.HORSE,
        realCamp: CAMPS.RED,
        faceUp: false,
        row: 6,
        col: 2
      });
      const state = stateWith([...generals(), dark]);
      const result = makeMove(state, "dark-reveal", 5, 2);
      const moved = state.pieces.find((item) => item.id === "dark-reveal");
      assert(result.ok, result.reason);
      assert(moved.faceUp && moved.hasActed, "piece should be face up after first action");
    }),

    run("revealed control uses realCamp", () => {
      const dark = piece({
        id: "dark-control",
        initialRole: PIECE_TYPES.SOLDIER,
        initialCamp: CAMPS.RED,
        realType: PIECE_TYPES.HORSE,
        realCamp: CAMPS.BLACK,
        faceUp: false,
        row: 6,
        col: 2
      });
      const state = stateWith([...generals(), dark]);
      const result = makeMove(state, "dark-control", 5, 2);
      const moved = state.pieces.find((item) => item.id === "dark-control");
      assert(result.ok, result.reason);
      assert(getActiveCamp(moved) === CAMPS.BLACK, "revealed piece should belong to black");
    }),

    run("captured face-down piece does not expose identity", () => {
      const rook = piece({ id: "red-rook", type: PIECE_TYPES.ROOK, camp: CAMPS.RED, row: 5, col: 0 });
      const hidden = piece({
        id: "hidden-target",
        initialRole: PIECE_TYPES.HORSE,
        initialCamp: CAMPS.BLACK,
        realType: PIECE_TYPES.ROOK,
        realCamp: CAMPS.RED,
        faceUp: false,
        row: 5,
        col: 3
      });
      const state = stateWith([...generals(), rook, hidden]);
      const result = makeMove(state, "red-rook", 5, 3);
      assert(result.ok, result.reason);
      assert(state.captured[0].faceUp === false, "captured dark piece should remain hidden");
      assert(state.captured[0].displayType === null, "captured dark piece should not reveal real type");
    }),

    run("horse leg block is enforced", () => {
      const horse = piece({ id: "horse", type: PIECE_TYPES.HORSE, camp: CAMPS.RED, row: 5, col: 4 });
      const block = piece({ id: "block", type: PIECE_TYPES.SOLDIER, camp: CAMPS.RED, row: 4, col: 4 });
      const state = stateWith([...generals(), horse, block]);
      const result = validateBasicMove(state, horse, 3, 5);
      assert(!result.ok, "blocked horse move should be illegal");
    }),

    run("elephant eye block is enforced", () => {
      const elephant = piece({
        id: "elephant",
        type: PIECE_TYPES.ELEPHANT,
        camp: CAMPS.RED,
        row: 9,
        col: 2,
        lockedRiverSide: CAMPS.RED
      });
      const block = piece({ id: "eye", type: PIECE_TYPES.SOLDIER, camp: CAMPS.RED, row: 8, col: 3 });
      const state = stateWith([...generals(), elephant, block]);
      const result = validateBasicMove(state, elephant, 7, 4);
      assert(!result.ok, "blocked elephant move should be illegal");
    }),

    run("cannon mount count is enforced", () => {
      const cannon = piece({ id: "cannon", type: PIECE_TYPES.CANNON, camp: CAMPS.RED, row: 5, col: 0 });
      const target = piece({ id: "target", type: PIECE_TYPES.SOLDIER, camp: CAMPS.BLACK, row: 5, col: 4 });
      const mount = piece({ id: "mount", type: PIECE_TYPES.SOLDIER, camp: CAMPS.RED, row: 5, col: 2 });
      const stateOne = stateWith([...generals(), cannon, target, mount]);
      assert(validateBasicMove(stateOne, cannon, 5, 4).ok, "one mount should allow capture");
      const stateZero = stateWith([...generals(), cannon, target]);
      assert(!validateBasicMove(stateZero, cannon, 5, 4).ok, "zero mounts should block capture");
      const extra = piece({ id: "extra", type: PIECE_TYPES.SOLDIER, camp: CAMPS.RED, row: 5, col: 3 });
      const stateTwo = stateWith([...generals(), cannon, target, mount, extra]);
      assert(!validateBasicMove(stateTwo, cannon, 5, 4).ok, "two mounts should block capture");
    }),

    run("advisor cannot leave palace", () => {
      const advisor = piece({ id: "advisor", type: PIECE_TYPES.ADVISOR, camp: CAMPS.RED, row: 7, col: 4 });
      const state = stateWith([...generals(), advisor]);
      assert(!validateBasicMove(state, advisor, 6, 3).ok, "advisor should stay in palace");
    }),

    run("general cannot leave palace", () => {
      const redGeneral = piece({ id: "red-general", type: PIECE_TYPES.GENERAL, camp: CAMPS.RED, row: 7, col: 4 });
      const blackGeneral = piece({ id: "black-general", type: PIECE_TYPES.GENERAL, camp: CAMPS.BLACK, row: 0, col: 3 });
      const state = stateWith([redGeneral, blackGeneral]);
      assert(!validateBasicMove(state, redGeneral, 6, 4).ok, "general should stay in palace");
    }),

    run("generals facing each other is detected", () => {
      const state = stateWith([
        piece({ id: "red-general", type: PIECE_TYPES.GENERAL, camp: CAMPS.RED, row: 9, col: 4 }),
        piece({ id: "black-general", type: PIECE_TYPES.GENERAL, camp: CAMPS.BLACK, row: 0, col: 4 })
      ]);
      assert(isGeneralFaceToFace(state.pieces), "open same file should face");
    }),

    run("normal move cannot expose own general", () => {
      const redGeneral = piece({ id: "red-general", type: PIECE_TYPES.GENERAL, camp: CAMPS.RED, row: 9, col: 4 });
      const blackGeneral = piece({ id: "black-general", type: PIECE_TYPES.GENERAL, camp: CAMPS.BLACK, row: 0, col: 3 });
      const blackRook = piece({ id: "black-rook", type: PIECE_TYPES.ROOK, camp: CAMPS.BLACK, row: 0, col: 4 });
      const blocker = piece({ id: "blocker", type: PIECE_TYPES.ROOK, camp: CAMPS.RED, row: 5, col: 4 });
      const state = stateWith([redGeneral, blackGeneral, blackRook, blocker]);
      const result = makeMove(state, "blocker", 5, 5);
      assert(!result.ok, "moving the blocker should be illegal");
    }),

    run("dark reveal can create delayed threat", () => {
      const state = createDelayedFixture();
      assert(state.phase === PHASES.RESTRICTED, "state should enter restricted phase");
      assert(state.currentCamp === CAMPS.BLACK, "restricted side should be black");
    }),

    run("restricted side cannot create new check", () => {
      const state = createDelayedFixture();
      state.pieces.push(piece({ id: "black-rook-2", type: PIECE_TYPES.ROOK, camp: CAMPS.BLACK, row: 8, col: 0 }));
      const result = makeMove(state, "black-rook-2", 8, 4);
      assert(!result.ok, "restricted side should not create a new check");
    }),

    run("protected side gets an adjustment turn", () => {
      const state = createDelayedFixture();
      state.pieces.push(piece({ id: "black-rook-3", type: PIECE_TYPES.ROOK, camp: CAMPS.BLACK, row: 8, col: 0 }));
      const result = makeMove(state, "black-rook-3", 8, 1);
      assert(result.ok, result.reason);
      assert(state.phase === PHASES.ADJUSTMENT && state.currentCamp === CAMPS.RED, "red should adjust");
    }),

    run("adjustment turn must resolve threat", () => {
      const state = createDelayedFixture();
      state.delayedThreat.phase = "adjustment-turn";
      state.phase = PHASES.ADJUSTMENT;
      state.currentCamp = CAMPS.RED;
      state.pieces.push(piece({ id: "red-rook-side", type: PIECE_TYPES.ROOK, camp: CAMPS.RED, row: 9, col: 0 }));
      const result = makeMove(state, "red-rook-side", 9, 1);
      assert(!result.ok, "unresolved adjustment move should be illegal");
    }),

    run("revealed elephant cannot cross locked river side", () => {
      const elephant = piece({
        id: "locked-elephant",
        type: PIECE_TYPES.ELEPHANT,
        camp: CAMPS.RED,
        realType: PIECE_TYPES.ELEPHANT,
        realCamp: CAMPS.RED,
        faceUp: true,
        row: 4,
        col: 2,
        lockedRiverSide: CAMPS.BLACK
      });
      const state = stateWith([...generals(), elephant]);
      assert(!validateBasicMove(state, elephant, 6, 4).ok, "locked elephant should stay on reveal side");
    }),

    run("capturing a general ends the game", () => {
      const redGeneral = piece({ id: "red-general", type: PIECE_TYPES.GENERAL, camp: CAMPS.RED, row: 9, col: 3 });
      const blackGeneral = piece({ id: "black-general", type: PIECE_TYPES.GENERAL, camp: CAMPS.BLACK, row: 0, col: 4 });
      const redRook = piece({ id: "red-rook-win", type: PIECE_TYPES.ROOK, camp: CAMPS.RED, row: 1, col: 4 });
      const state = stateWith([redGeneral, blackGeneral, redRook]);
      const result = makeMove(state, "red-rook-win", 0, 4);
      assert(result.ok, result.reason);
      assert(state.gameOver && state.winner === CAMPS.RED, "red should win after capturing general");
    }),

    run("no legal moves skips turn instead of losing", () => {
      const blackGeneral = piece({ id: "black-general", type: PIECE_TYPES.GENERAL, camp: CAMPS.BLACK, row: 0, col: 4 });
      const redGeneral = piece({ id: "red-general", type: PIECE_TYPES.GENERAL, camp: CAMPS.RED, row: 9, col: 4 });
      const blockers = [
        piece({ id: "r1", type: PIECE_TYPES.ROOK, camp: CAMPS.RED, row: 0, col: 3 }),
        piece({ id: "r2", type: PIECE_TYPES.ROOK, camp: CAMPS.RED, row: 0, col: 5 }),
        piece({ id: "r3", type: PIECE_TYPES.ROOK, camp: CAMPS.RED, row: 1, col: 4 }),
        piece({ id: "p1", type: PIECE_TYPES.ROOK, camp: CAMPS.RED, row: 2, col: 3 }),
        piece({ id: "p2", type: PIECE_TYPES.ROOK, camp: CAMPS.RED, row: 2, col: 5 }),
        piece({ id: "p3", type: PIECE_TYPES.ROOK, camp: CAMPS.RED, row: 1, col: 0 })
      ];
      const state = stateWith([blackGeneral, redGeneral, ...blockers], CAMPS.BLACK);
      advancePastNoLegalMoves(state);
      assert(!state.gameOver, "no legal move should not end the game");
      assert(state.currentCamp === CAMPS.RED, "turn should skip to red");
    }),

    run("shared engine applyMove does not mutate source state", () => {
      const dark = piece({
        id: "engine-dark",
        initialRole: PIECE_TYPES.SOLDIER,
        initialCamp: CAMPS.RED,
        realType: PIECE_TYPES.ROOK,
        realCamp: CAMPS.RED,
        faceUp: false,
        row: 6,
        col: 0
      });
      const state = stateWith([...generals(), dark], CAMPS.RED);
      const result = applyEngineMove(state, {
        pieceId: "engine-dark",
        to: { row: 5, col: 0 }
      });
      assert(result.ok, result.reason);
      assert(
        state.pieces.find((item) => item.id === "engine-dark").row === 6,
        "source state should not mutate"
      );
      assert(
        result.state.pieces.find((item) => item.id === "engine-dark").row === 5,
        "result state should include the move"
      );
    }),

    run("public snapshot hides unrevealed real identity", () => {
      const hidden = piece({
        id: "snapshot-hidden",
        initialRole: PIECE_TYPES.ROOK,
        initialCamp: CAMPS.BLACK,
        realType: PIECE_TYPES.CANNON,
        realCamp: CAMPS.RED,
        faceUp: false,
        row: 0,
        col: 0
      });
      const visible = piece({
        id: "snapshot-visible",
        type: PIECE_TYPES.HORSE,
        camp: CAMPS.RED,
        faceUp: true,
        row: 9,
        col: 1
      });
      const state = stateWith([...generals(), hidden, visible], CAMPS.RED);
      const snapshot = createPublicSnapshot(state);
      const publicHidden = snapshot.pieces.find((item) => item.id === "snapshot-hidden");
      const publicVisible = snapshot.pieces.find((item) => item.id === "snapshot-visible");
      assert(publicHidden.realType === null && publicHidden.realCamp === null, "hidden identity should be masked");
      assert(publicVisible.realType === PIECE_TYPES.HORSE && publicVisible.realCamp === CAMPS.RED, "visible identity should remain");
    }),

    run("AI does not score hidden moves with real identity", () => {
      const makeState = (realType, realCamp) =>
        stateWith(
          [
            ...generals(),
            piece({
              id: "ai-hidden",
              initialRole: PIECE_TYPES.SOLDIER,
              initialCamp: CAMPS.BLACK,
              realType,
              realCamp,
              faceUp: false,
              row: 3,
              col: 0
            })
          ],
          CAMPS.BLACK
        );
      const scoreA = scoreAiMove(
        makeState(PIECE_TYPES.ROOK, CAMPS.RED),
        moveFor(makeState(PIECE_TYPES.ROOK, CAMPS.RED), "ai-hidden", 4, 0),
        CAMPS.BLACK,
        { random: () => 0 }
      );
      const stateB = makeState(PIECE_TYPES.SOLDIER, CAMPS.BLACK);
      const scoreB = scoreAiMove(
        stateB,
        moveFor(stateB, "ai-hidden", 4, 0),
        CAMPS.BLACK,
        { random: () => 0 }
      );
      assert(scoreA === scoreB, "hidden real identity should not affect AI score");
    }),

    run("AI prioritizes resolving check", () => {
      const state = stateWith(
        [
          piece({ id: "black-general", type: PIECE_TYPES.GENERAL, camp: CAMPS.BLACK, row: 0, col: 4 }),
          piece({ id: "red-general", type: PIECE_TYPES.GENERAL, camp: CAMPS.RED, row: 9, col: 3 }),
          piece({ id: "red-rook-check", type: PIECE_TYPES.ROOK, camp: CAMPS.RED, row: 2, col: 4 }),
          piece({ id: "black-advisor", type: PIECE_TYPES.ADVISOR, camp: CAMPS.BLACK, row: 0, col: 3 })
        ],
        CAMPS.BLACK
      );
      assert(isGeneralUnderAttack(state.pieces, CAMPS.BLACK), "black should start in check");
      const move = chooseAiMove(state, CAMPS.BLACK, { random: () => 0 });
      const result = makeMove(state, move.pieceId, move.row, move.col);
      assert(result.ok, result.reason);
      assert(!isGeneralUnderAttack(state.pieces, CAMPS.BLACK), "AI move should resolve check");
    }),

    run("AI does not voluntarily expose its general", () => {
      const state = stateWith(
        [
          piece({ id: "black-general", type: PIECE_TYPES.GENERAL, camp: CAMPS.BLACK, row: 0, col: 4 }),
          piece({ id: "red-general", type: PIECE_TYPES.GENERAL, camp: CAMPS.RED, row: 9, col: 3 }),
          piece({ id: "red-rook-line", type: PIECE_TYPES.ROOK, camp: CAMPS.RED, row: 3, col: 4 }),
          piece({ id: "black-blocker", type: PIECE_TYPES.ROOK, camp: CAMPS.BLACK, row: 1, col: 4 }),
          piece({ id: "black-horse", type: PIECE_TYPES.HORSE, camp: CAMPS.BLACK, row: 0, col: 1 })
        ],
        CAMPS.BLACK
      );
      const move = chooseAiMove(state, CAMPS.BLACK, { random: () => 0 });
      const result = makeMove(state, move.pieceId, move.row, move.col);
      assert(result.ok, result.reason);
      assert(!isGeneralUnderAttack(state.pieces, CAMPS.BLACK), "AI should not leave its general attacked");
    }),

    run("AI scores protection of high-value pieces", () => {
      const state = stateWith(
        [
          piece({ id: "black-general", type: PIECE_TYPES.GENERAL, camp: CAMPS.BLACK, row: 0, col: 4 }),
          piece({ id: "red-general", type: PIECE_TYPES.GENERAL, camp: CAMPS.RED, row: 9, col: 4 }),
          piece({ id: "line-blocker", type: PIECE_TYPES.SOLDIER, camp: CAMPS.BLACK, row: 5, col: 4 }),
          piece({ id: "black-rook", type: PIECE_TYPES.ROOK, camp: CAMPS.BLACK, row: 4, col: 3 }),
          piece({ id: "red-rook", type: PIECE_TYPES.ROOK, camp: CAMPS.RED, row: 4, col: 0 }),
          piece({ id: "black-horse", type: PIECE_TYPES.HORSE, camp: CAMPS.BLACK, row: 0, col: 1 }),
          piece({ id: "black-soldier", type: PIECE_TYPES.SOLDIER, camp: CAMPS.BLACK, row: 3, col: 8 })
        ],
        CAMPS.BLACK
      );
      const protectScore = scoreAiMove(state, moveFor(state, "black-horse", 2, 2), CAMPS.BLACK, { random: () => 0 });
      const quietScore = scoreAiMove(state, moveFor(state, "black-soldier", 4, 8), CAMPS.BLACK, { random: () => 0 });
      assert(protectScore > quietScore, "protecting a threatened rook should score higher");
    }),

    run("AI avoids clearly losing exchanges", () => {
      const state = stateWith(
        [
          piece({ id: "black-general", type: PIECE_TYPES.GENERAL, camp: CAMPS.BLACK, row: 0, col: 4 }),
          piece({ id: "red-general", type: PIECE_TYPES.GENERAL, camp: CAMPS.RED, row: 9, col: 4 }),
          piece({ id: "line-blocker", type: PIECE_TYPES.SOLDIER, camp: CAMPS.BLACK, row: 5, col: 4 }),
          piece({ id: "black-rook", type: PIECE_TYPES.ROOK, camp: CAMPS.BLACK, row: 4, col: 4 }),
          piece({ id: "red-soldier-bait", type: PIECE_TYPES.SOLDIER, camp: CAMPS.RED, row: 4, col: 5 }),
          piece({ id: "red-rook-trap", type: PIECE_TYPES.ROOK, camp: CAMPS.RED, row: 4, col: 8 }),
          piece({ id: "black-soldier", type: PIECE_TYPES.SOLDIER, camp: CAMPS.BLACK, row: 3, col: 0 })
        ],
        CAMPS.BLACK
      );
      const captureScore = scoreAiMove(state, moveFor(state, "black-rook", 4, 5), CAMPS.BLACK, { random: () => 0 });
      const quietScore = scoreAiMove(state, moveFor(state, "black-soldier", 4, 0), CAMPS.BLACK, { random: () => 0 });
      assert(quietScore > captureScore, "bad rook-for-soldier exchange should be penalized");
    }),

    run("AI obeys delayed-threat restricted turn", () => {
      const state = createDelayedFixture();
      state.pieces.push(piece({ id: "black-rook-safe", type: PIECE_TYPES.ROOK, camp: CAMPS.BLACK, row: 8, col: 0 }));
      const move = chooseAiMove(state, CAMPS.BLACK, { random: () => 0 });
      const result = makeMove(state, move.pieceId, move.row, move.col);
      assert(result.ok, result.reason);
      assert(state.phase === PHASES.ADJUSTMENT, "restricted move should pass into adjustment turn");
    }),

    run("AI adjustment turn resolves delayed threat", () => {
      const state = stateWith(
        [
          piece({ id: "black-general", type: PIECE_TYPES.GENERAL, camp: CAMPS.BLACK, row: 0, col: 4 }),
          piece({ id: "red-general", type: PIECE_TYPES.GENERAL, camp: CAMPS.RED, row: 9, col: 3 }),
          piece({ id: "red-trigger-rook", type: PIECE_TYPES.ROOK, camp: CAMPS.RED, row: 2, col: 4 }),
          piece({ id: "black-advisor", type: PIECE_TYPES.ADVISOR, camp: CAMPS.BLACK, row: 0, col: 3 })
        ],
        CAMPS.BLACK,
        {
          phase: PHASES.ADJUSTMENT,
          delayedThreat: {
            active: true,
            protectedCamp: CAMPS.BLACK,
            restrictedCamp: CAMPS.RED,
            triggerPieceId: "red-trigger-rook",
            phase: "adjustment-turn"
          }
        }
      );
      const move = chooseAiMove(state, CAMPS.BLACK, { random: () => 0 });
      const result = makeMove(state, move.pieceId, move.row, move.col);
      assert(result.ok, result.reason);
      assert(!state.delayedThreat, "delayed threat should be cleared");
      assert(!isGeneralUnderAttack(state.pieces, CAMPS.BLACK), "black general should be safe");
    }),

    run("AI move selection completes quickly", () => {
      const state = stateWith(createInitialPieces(seededRandom(300)), CAMPS.BLACK);
      const start = performance.now();
      const move = chooseAiMove(state, CAMPS.BLACK, { random: () => 0.3 });
      const elapsed = performance.now() - start;
      assert(move, "AI should choose a move");
      assert(elapsed < 650, `AI should not block tests, elapsed ${elapsed}`);
    })
  ];

  const passed = tests.filter((test) => test.ok).length;
  return {
    total: tests.length,
    passed,
    failed: tests.length - passed,
    results: tests
  };
}
