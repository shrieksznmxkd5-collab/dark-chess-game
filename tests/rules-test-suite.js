import { CAMPS, PHASES, PIECE_TYPES } from "../js/config.js";
import { createCustomState } from "../js/game-state.js";
import { createFixturePiece, createInitialPieces } from "../js/pieces.js";
import { validateBasicMove, getActiveCamp } from "../js/rules.js";
import { isGeneralFaceToFace } from "../js/attacks.js";
import { advancePastNoLegalMoves, makeMove } from "../js/move-transaction.js";
import { applyMove as applyEngineMove, createPublicSnapshot } from "../shared/engine/index.js";

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
  assert(state.delayedThreat?.active, "应触发延迟威胁");
  return state;
}

export function runRulesTests() {
  const tests = [
    run("26枚暗棋随机且数量正确", () => {
      const pieces = createInitialPieces(() => 0.42);
      assert(pieces.filter((item) => !item.faceUp).length === 26, "暗棋数量应为26");
      assert(pieces.length === 32, "总棋子数量应为32");
    }),

    run("将、帅和士不参与随机", () => {
      const pieces = createInitialPieces(() => 0.7);
      const fixed = pieces.filter((item) => item.faceUp);
      assert(fixed.length === 6, "明棋应为6枚");
      assert(fixed.every((item) => item.realType === PIECE_TYPES.GENERAL || item.realType === PIECE_TYPES.ADVISOR), "明棋只能是将帅和士");
    }),

    run("暗棋第一次按 initialRole 行动", () => {
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
      assert(state.pieces.find((item) => item.id === "dark-soldier").row === 5, "应按红兵向前移动");
    }),

    run("暗棋第一次可以吃子", () => {
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
      const target = piece({ id: "black-target", type: PIECE_TYPES.SOLDIER, camp: CAMPS.BLACK, row: 5, col: 3 });
      const state = stateWith([...generals(), dark, target]);
      const result = makeMove(state, "dark-rook", 5, 3);
      assert(result.ok, result.reason);
      assert(!state.pieces.find((item) => item.id === "black-target").alive, "目标应被吃掉");
    }),

    run("首次行动后正确翻面", () => {
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
      assert(moved.faceUp && moved.hasActed, "首次行动后应翻面并记录已行动");
    }),

    run("翻面后控制权按 realCamp 转移", () => {
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
      assert(getActiveCamp(moved) === CAMPS.BLACK, "翻面后应归黑方控制");
    }),

    run("未翻面的暗棋被吃后不公开身份", () => {
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
      assert(state.captured[0].faceUp === false, "被吃暗棋不应公开身份");
      assert(state.captured[0].displayType === null, "被吃暗棋不记录真实类型");
    }),

    run("马腿阻挡", () => {
      const horse = piece({ id: "horse", type: PIECE_TYPES.HORSE, camp: CAMPS.RED, row: 5, col: 4 });
      const block = piece({ id: "block", type: PIECE_TYPES.SOLDIER, camp: CAMPS.RED, row: 4, col: 4 });
      const state = stateWith([...generals(), horse, block]);
      const result = validateBasicMove(state, horse, 3, 5);
      assert(!result.ok && result.reason.includes("马腿"), "马腿被占应非法");
    }),

    run("象眼阻挡", () => {
      const elephant = piece({ id: "elephant", type: PIECE_TYPES.ELEPHANT, camp: CAMPS.RED, row: 9, col: 2, lockedRiverSide: CAMPS.RED });
      const block = piece({ id: "eye", type: PIECE_TYPES.SOLDIER, camp: CAMPS.RED, row: 8, col: 3 });
      const state = stateWith([...generals(), elephant, block]);
      const result = validateBasicMove(state, elephant, 7, 4);
      assert(!result.ok && result.reason.includes("象眼"), "象眼被占应非法");
    }),

    run("炮架数量判断", () => {
      const cannon = piece({ id: "cannon", type: PIECE_TYPES.CANNON, camp: CAMPS.RED, row: 5, col: 0 });
      const target = piece({ id: "target", type: PIECE_TYPES.SOLDIER, camp: CAMPS.BLACK, row: 5, col: 4 });
      const mount = piece({ id: "mount", type: PIECE_TYPES.SOLDIER, camp: CAMPS.RED, row: 5, col: 2 });
      const stateOne = stateWith([...generals(), cannon, target, mount]);
      assert(validateBasicMove(stateOne, cannon, 5, 4).ok, "一个炮架应可吃子");
      const stateZero = stateWith([...generals(), cannon, target]);
      assert(!validateBasicMove(stateZero, cannon, 5, 4).ok, "零个炮架不可吃子");
      const extra = piece({ id: "extra", type: PIECE_TYPES.SOLDIER, camp: CAMPS.RED, row: 5, col: 3 });
      const stateTwo = stateWith([...generals(), cannon, target, mount, extra]);
      assert(!validateBasicMove(stateTwo, cannon, 5, 4).ok, "两个炮架不可吃子");
    }),

    run("士不能离开九宫", () => {
      const advisor = piece({ id: "advisor", type: PIECE_TYPES.ADVISOR, camp: CAMPS.RED, row: 7, col: 4 });
      const state = stateWith([...generals(), advisor]);
      assert(!validateBasicMove(state, advisor, 6, 3).ok, "红士不能离开九宫");
    }),

    run("将帅不能离开九宫", () => {
      const redGeneral = piece({ id: "red-general", type: PIECE_TYPES.GENERAL, camp: CAMPS.RED, row: 7, col: 4 });
      const state = stateWith([redGeneral, piece({ id: "black-general", type: PIECE_TYPES.GENERAL, camp: CAMPS.BLACK, row: 0, col: 3 })]);
      assert(!validateBasicMove(state, redGeneral, 6, 4).ok, "帅不能离开九宫");
    }),

    run("将帅照面判定", () => {
      const state = stateWith([
        piece({ id: "red-general", type: PIECE_TYPES.GENERAL, camp: CAMPS.RED, row: 9, col: 4 }),
        piece({ id: "black-general", type: PIECE_TYPES.GENERAL, camp: CAMPS.BLACK, row: 0, col: 4 })
      ]);
      assert(isGeneralFaceToFace(state.pieces), "无遮挡同列应照面");
    }),

    run("普通行动不能让己方将帅受攻击", () => {
      const redGeneral = piece({ id: "red-general", type: PIECE_TYPES.GENERAL, camp: CAMPS.RED, row: 9, col: 4 });
      const blackGeneral = piece({ id: "black-general", type: PIECE_TYPES.GENERAL, camp: CAMPS.BLACK, row: 0, col: 3 });
      const blackRook = piece({ id: "black-rook", type: PIECE_TYPES.ROOK, camp: CAMPS.BLACK, row: 0, col: 4 });
      const blocker = piece({ id: "blocker", type: PIECE_TYPES.ROOK, camp: CAMPS.RED, row: 5, col: 4 });
      const state = stateWith([redGeneral, blackGeneral, blackRook, blocker]);
      const result = makeMove(state, "blocker", 5, 5);
      assert(!result.ok, "移开遮挡导致被车攻击应非法");
    }),

    run("暗棋翻出敌棋并攻击己方将帅时触发延迟威胁", () => {
      const state = createDelayedFixture();
      assert(state.phase === PHASES.RESTRICTED, "应进入限制方回合");
      assert(state.currentCamp === CAMPS.BLACK, "限制方应为黑方");
    }),

    run("限制方不能创造新的将军", () => {
      const state = createDelayedFixture();
      state.pieces.push(piece({ id: "black-rook-2", type: PIECE_TYPES.ROOK, camp: CAMPS.BLACK, row: 8, col: 0 }));
      const result = makeMove(state, "black-rook-2", 8, 4);
      assert(!result.ok && result.reason.includes("延迟保护"), "限制方不能形成新的将军");
    }),

    run("受保护方获得调整回合", () => {
      const state = createDelayedFixture();
      state.pieces.push(piece({ id: "black-rook-3", type: PIECE_TYPES.ROOK, camp: CAMPS.BLACK, row: 8, col: 0 }));
      const result = makeMove(state, "black-rook-3", 8, 1);
      assert(result.ok, result.reason);
      assert(state.phase === PHASES.ADJUSTMENT && state.currentCamp === CAMPS.RED, "应轮到红方调整");
    }),

    run("调整回合结束时必须解除威胁", () => {
      const state = createDelayedFixture();
      state.delayedThreat.phase = "adjustment-turn";
      state.phase = PHASES.ADJUSTMENT;
      state.currentCamp = CAMPS.RED;
      state.pieces.push(piece({ id: "red-rook-side", type: PIECE_TYPES.ROOK, camp: CAMPS.RED, row: 9, col: 0 }));
      const result = makeMove(state, "red-rook-side", 9, 1);
      assert(!result.ok && result.reason.includes("调整回合"), "未解除威胁的调整行动应非法");
    }),

    run("象翻面后不能跨越翻面时所在的河界", () => {
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
      assert(!validateBasicMove(state, elephant, 6, 4).ok, "锁定黑方半场后不能跨河");
    }),

    run("将或帅被吃后游戏结束", () => {
      const redGeneral = piece({ id: "red-general", type: PIECE_TYPES.GENERAL, camp: CAMPS.RED, row: 9, col: 3 });
      const blackGeneral = piece({ id: "black-general", type: PIECE_TYPES.GENERAL, camp: CAMPS.BLACK, row: 0, col: 4 });
      const redRook = piece({ id: "red-rook-win", type: PIECE_TYPES.ROOK, camp: CAMPS.RED, row: 1, col: 4 });
      const state = stateWith([redGeneral, blackGeneral, redRook]);
      const result = makeMove(state, "red-rook-win", 0, 4);
      assert(result.ok, result.reason);
      assert(state.gameOver && state.winner === CAMPS.RED, "吃掉将后红方应获胜");
    }),

    run("无合法着法时跳过回合而不是直接判负", () => {
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
      assert(!state.gameOver, "无合法着法不应直接结束");
      assert(state.currentCamp === CAMPS.RED, "应跳过黑方回合");
    }),

    run("共享规则引擎 applyMove 不修改原始状态", () => {
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
      assert(state.pieces.find((item) => item.id === "engine-dark").row === 6, "原始状态不应被修改");
      assert(result.state.pieces.find((item) => item.id === "engine-dark").row === 5, "新状态应包含移动结果");
    }),

    run("公开快照不泄露未翻暗棋真实身份", () => {
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
      assert(publicHidden.realType === null && publicHidden.realCamp === null, "未翻暗棋真实身份应被隐藏");
      assert(publicVisible.realType === PIECE_TYPES.HORSE && publicVisible.realCamp === CAMPS.RED, "明棋真实身份应保留");
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
