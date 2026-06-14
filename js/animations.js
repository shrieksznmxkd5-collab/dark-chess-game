import { ANIMATION } from "./config.js";

function getBoardInner() {
  return document.querySelector(".board-inner");
}

function getPieceElement(pieceId) {
  return document.querySelector(`[data-piece-id="${pieceId}"]`);
}

export function clearAnimationArtifacts() {
  document.querySelectorAll(".trail-dot").forEach((element) => element.remove());
}

function pointToPercent(point) {
  return {
    x: (point.col / 8) * 100,
    y: (point.row / 9) * 100
  };
}

function createTrail(result) {
  const boardInner = getBoardInner();
  if (!boardInner) {
    return [];
  }

  const dots = [];
  const from = pointToPercent(result.from);
  const to = pointToPercent(result.to);
  const count = 4;

  for (let index = 1; index <= count; index += 1) {
    const ratio = index / (count + 1);
    const dot = document.createElement("span");
    dot.className = "trail-dot";
    dot.style.left = `${from.x + (to.x - from.x) * ratio}%`;
    dot.style.top = `${from.y + (to.y - from.y) * ratio}%`;
    dot.style.opacity = String(0.12 + ratio * 0.2);
    boardInner.append(dot);
    dots.push(dot);
  }

  return dots;
}

export async function playMoveFeedback(result, settings) {
  if (!result?.ok) {
    return;
  }

  const boardInner = getBoardInner();
  const piece = getPieceElement(result.pieceId);
  if (!boardInner || !piece) {
    return;
  }

  const boardRect = boardInner.getBoundingClientRect();
  const dx = ((result.from.col - result.to.col) / 8) * boardRect.width;
  const dy = ((result.from.row - result.to.row) / 9) * boardRect.height;
  const duration = result.capturedPiece ? ANIMATION.moveMs + 80 : ANIMATION.moveMs;
  const trails = createTrail(result);

  const animations = [
    piece.animate(
      [
        {
          transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(1.045)`
        },
        { transform: "translate(-50%, -50%) scale(1)" }
      ],
      {
        duration,
        easing: "cubic-bezier(.2,.72,.18,1)",
        fill: "both"
      }
    ).finished
  ];

  if (result.revealed) {
    animations.push(
      piece.animate(
        [
          { filter: "brightness(0.9)", transform: "translate(-50%, -50%) rotateY(82deg)" },
          { filter: "brightness(1.08)", transform: "translate(-50%, -50%) rotateY(0deg)" }
        ],
        {
          delay: duration,
          duration: ANIMATION.revealMs,
          easing: "ease-out"
        }
      ).finished
    );
  }

  trails.forEach((trail, index) => {
    trail
      .animate(
        [
          { opacity: trail.style.opacity, transform: "translate(-50%, -50%) scale(1)" },
          { opacity: 0, transform: "translate(-50%, -50%) scale(1.8)" }
        ],
        {
          duration: ANIMATION.trailMs,
          delay: index * 55,
          easing: "ease-out",
          fill: "forwards"
        }
      )
      .finished.finally(() => trail.remove());
  });

  await Promise.allSettled(animations);
}
