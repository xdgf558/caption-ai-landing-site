const clamp01 = value => Math.max(0, Math.min(1, value));
const smooth = value => { const t = clamp01(value); return t * t * (3 - 2 * t); };
export const BITE_START = 3.95;
export const BITE_LENGTH = 1.3;
export const BITE_COUNT = 3;

// One deterministic timeline owns the jaw, food transport and swallowing.
// This is visual state only: seeking never consumes actual game inventory.
export function sampleBite(time) {
  const elapsed = time - BITE_START;
  if (!Number.isFinite(time) || elapsed < 0) return { jaw: 0, phase: 'waiting', index: -1, foodProgress: 0, foodVisible: false, consumed: 0 };
  if (elapsed >= BITE_LENGTH * BITE_COUNT) return { jaw: 0, phase: 'finished', index: BITE_COUNT, foodProgress: 1, foodVisible: false, consumed: BITE_COUNT };
  const index = Math.floor(elapsed / BITE_LENGTH), t = elapsed - index * BITE_LENGTH;
  const opening = smooth(t / .23) * (1 - smooth((t - .57) / .21));
  const chewing = t > .82 && t < 1.13 ? .23 * Math.sin((t - .82) / .31 * Math.PI * 2) ** 2 : 0;
  const foodProgress = smooth((t - .26) / .31);
  return {
    jaw: Math.max(opening, chewing),
    phase: t < .26 ? 'opening' : t < .57 ? 'taking' : t < .82 ? 'closing' : t < 1.13 ? 'chewing' : 'swallowing',
    index, foodProgress,
    foodVisible: t >= .26 && t < .62,
    consumed: index + (t >= .62 ? 1 : 0)
  };
}
