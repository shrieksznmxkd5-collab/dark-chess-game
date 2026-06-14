import { CAMPS, PIECE_TYPES } from "./config.js";

const STRONG_TYPES = new Set([
  PIECE_TYPES.ROOK,
  PIECE_TYPES.HORSE,
  PIECE_TYPES.CANNON
]);

const DEFAULT_ATTEMPTS = 220;

function sideOf(row) {
  return row <= 4 ? CAMPS.BLACK : CAMPS.RED;
}

function zoneOf(slot) {
  const side = sideOf(slot.row);
  const file = slot.col <= 2 ? "left" : slot.col >= 6 ? "right" : "center";
  return `${side}-${file}`;
}

function distance(a, b) {
  return Math.abs(a.row - b.row) + Math.abs(a.col - b.col);
}

function isStrong(piece) {
  return STRONG_TYPES.has(piece.realType);
}

export function countHiddenCamps(deck) {
  return deck.reduce(
    (counts, piece) => {
      counts[piece.realCamp] += 1;
      return counts;
    },
    { [CAMPS.RED]: 0, [CAMPS.BLACK]: 0 }
  );
}

export function countHiddenTypes(deck) {
  return deck.reduce((counts, piece) => {
    const key = `${piece.realCamp}-${piece.realType}`;
    counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  }, {});
}

export function getMaxSameCampRun(layout) {
  let currentCamp = null;
  let currentRun = 0;
  let maxRun = 0;

  layout.forEach((entry) => {
    if (entry.realCamp === currentCamp) {
      currentRun += 1;
    } else {
      currentCamp = entry.realCamp;
      currentRun = 1;
    }
    maxRun = Math.max(maxRun, currentRun);
  });

  return maxRun;
}

export function getHalfCampCounts(layout) {
  return layout.reduce(
    (counts, entry) => {
      const side = sideOf(entry.row);
      counts[side][entry.realCamp] += 1;
      return counts;
    },
    {
      [CAMPS.BLACK]: { [CAMPS.RED]: 0, [CAMPS.BLACK]: 0 },
      [CAMPS.RED]: { [CAMPS.RED]: 0, [CAMPS.BLACK]: 0 }
    }
  );
}

export function buildShuffleLayout(slots, deck) {
  return slots.map((slot, index) => ({
    ...slot,
    realType: deck[index].realType,
    realCamp: deck[index].realCamp
  }));
}

export function scoreShuffleLayout(layout) {
  let score = 1000;
  const maxRun = getMaxSameCampRun(layout);
  const halfCounts = getHalfCampCounts(layout);
  const strongByZone = new Map();

  if (maxRun <= 2) {
    score += 60;
  } else if (maxRun === 3) {
    score += 12;
  } else {
    score -= (maxRun - 3) * 260;
  }

  Object.values(halfCounts).forEach((counts) => {
    const redCount = counts[CAMPS.RED];
    if (redCount >= 5 && redCount <= 8) {
      score += 85;
    } else {
      const distanceFromRange = redCount < 5 ? 5 - redCount : redCount - 8;
      score -= distanceFromRange * 180;
    }
  });

  const rows = new Map();
  layout.forEach((entry) => {
    const row = rows.get(entry.row) ?? { [CAMPS.RED]: 0, [CAMPS.BLACK]: 0 };
    row[entry.realCamp] += 1;
    rows.set(entry.row, row);

    if (isStrong(entry)) {
      const zone = zoneOf(entry);
      strongByZone.set(zone, (strongByZone.get(zone) ?? 0) + 1);
    }
  });

  rows.forEach((counts) => {
    const rowTotal = counts[CAMPS.RED] + counts[CAMPS.BLACK];
    const concentrated = Math.max(counts[CAMPS.RED], counts[CAMPS.BLACK]);
    if (rowTotal >= 5 && concentrated >= 4) {
      score -= (concentrated - 3) * 80;
    }
  });

  strongByZone.forEach((count) => {
    if (count > 2) {
      score -= (count - 2) * 95;
    }
  });

  for (let left = 0; left < layout.length; left += 1) {
    const a = layout[left];
    if (!isStrong(a)) {
      continue;
    }

    for (let right = left + 1; right < layout.length; right += 1) {
      const b = layout[right];
      if (!isStrong(b) || a.realCamp !== b.realCamp) {
        continue;
      }

      const pieceDistance = distance(a, b);
      if (a.realType === b.realType && pieceDistance <= 2) {
        score -= 130;
      } else if (pieceDistance <= 2) {
        score -= 45;
      }
    }
  }

  return {
    score,
    maxRun,
    halfCounts
  };
}

export function validateShuffleLayout(layout) {
  const { maxRun, halfCounts } = scoreShuffleLayout(layout);
  const blackHalfRed = halfCounts[CAMPS.BLACK][CAMPS.RED];
  const redHalfRed = halfCounts[CAMPS.RED][CAMPS.RED];

  return (
    maxRun <= 3 &&
    blackHalfRed >= 5 &&
    blackHalfRed <= 8 &&
    redHalfRed >= 5 &&
    redHalfRed <= 8
  );
}

export function createControlledShuffle({
  deck,
  slots,
  random,
  shuffle,
  attempts = DEFAULT_ATTEMPTS
}) {
  let bestDeck = null;
  let bestScore = Number.NEGATIVE_INFINITY;
  let bestLayout = null;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const candidate = shuffle(deck, random);
    const layout = buildShuffleLayout(slots, candidate);
    const result = scoreShuffleLayout(layout);

    if (result.score > bestScore) {
      bestDeck = candidate;
      bestLayout = layout;
      bestScore = result.score;
    }

    if (validateShuffleLayout(layout) && result.score >= 920) {
      return candidate;
    }
  }

  return validateShuffleLayout(bestLayout) ? bestDeck : bestDeck ?? shuffle(deck, random);
}
