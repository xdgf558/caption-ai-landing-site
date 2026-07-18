const signalTriageVersion = 3;
const signalClusterSimilarityThreshold = 0.72;
const signalTitleDuplicateWindowHours = 72;
const signalTitleDuplicateMinimumTokens = 4;

const trustScores = Object.freeze({
  community: 14,
  established: 24,
  primary: 30
});

const siteRelevanceCategoryBase = Object.freeze({
  ai: 9,
  economy: 5,
  general: 1,
  market: 4,
  research: 6,
  tech: 8
});

const siteRelevanceKeywords = Object.freeze([
  ['openai', 4],
  ['anthropic', 4],
  ['chatgpt', 4],
  ['claude', 4],
  ['codex', 4],
  ['cloudflare', 4],
  ['artificial intelligence', 3],
  ['machine learning', 3],
  ['open source', 3],
  ['interest rate', 3],
  ['federal reserve', 3],
  ['ai', 3],
  ['agent', 3],
  ['api', 3],
  ['creator', 3],
  ['developer', 3],
  ['github', 3],
  ['gpt', 3],
  ['llm', 3],
  ['software', 3],
  ['arxiv', 2],
  ['cloud', 2],
  ['cybersecurity', 2],
  ['database', 2],
  ['economy', 2],
  ['employment', 2],
  ['inflation', 2],
  ['ios', 2],
  ['macos', 2],
  ['market', 2],
  ['model', 2],
  ['privacy', 2],
  ['research', 2],
  ['security', 2],
  ['treasury', 2],
  ['windows', 2]
]);

const titleStopWords = new Set([
  'a', 'about', 'after', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'has', 'have',
  'how', 'in', 'into', 'is', 'it', 'its', 'new', 'of', 'on', 'or', 'that', 'the', 'their', 'this',
  'to', 'update', 'with'
]);

const clickbaitPatterns = [
  /\bbreaking\b/i,
  /\bmust(?:-|\s)?see\b/i,
  /\bshocking\b/i,
  /\bwhat happens next\b/i,
  /\byou won['’]?t believe\b/i
];

const clamp = (value, minimum, maximum) => Math.min(Math.max(value, minimum), maximum);

const normalizeText = (value) =>
  String(value || '')
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim();

const parseDate = (value) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const escapeRegExp = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const topicKeywordMatches = (haystack, keyword) => {
  if (keyword.includes(' ') || keyword.length > 3) return haystack.includes(keyword);
  return new RegExp(`\\b${escapeRegExp(keyword)}\\b`, 'i').test(haystack);
};

const scoreRecency = (publishedAt, now) => {
  const published = parseDate(publishedAt);
  if (!published) return { points: 6, reason: '缺少可靠发布时间' };
  const ageHours = (now.getTime() - published.getTime()) / 3_600_000;
  if (ageHours < 0) return { points: 6, reason: '发布时间晚于当前时间' };
  if (ageHours <= 6) return { points: 25, reason: '6 小时内发布' };
  if (ageHours <= 24) return { points: 22, reason: '24 小时内发布' };
  if (ageHours <= 72) return { points: 16, reason: '3 天内发布' };
  if (ageHours <= 168) return { points: 8, reason: '7 天内发布' };
  return { points: 2, reason: '发布时间超过 7 天' };
};

const scoreCompleteness = (candidate) => {
  const titleLength = normalizeText(candidate.title).length;
  const summaryLength = normalizeText(candidate.summary).length;
  const titlePoints = titleLength >= 25 ? 6 : titleLength >= 12 ? 4 : 2;
  const summaryPoints = summaryLength >= 300 ? 10 : summaryLength >= 120 ? 8 : summaryLength >= 40 ? 5 : 0;
  const authorPoints = normalizeText(candidate.author) ? 2 : 0;
  const publishedPoints = parseDate(candidate.publishedAt) ? 2 : 0;
  return {
    points: titlePoints + summaryPoints + authorPoints + publishedPoints,
    reason: summaryLength ? `摘要 ${summaryLength} 字符` : '缺少摘要'
  };
};

const scoreSiteRelevance = (candidate, source) => {
  const category = normalizeText(candidate.category || source?.category || 'general').toLowerCase();
  const haystack = `${normalizeText(candidate.title)} ${normalizeText(candidate.summary)}`.toLowerCase();
  const matches = siteRelevanceKeywords
    .filter(([keyword]) => topicKeywordMatches(haystack, keyword))
    .slice(0, 8);
  const base = siteRelevanceCategoryBase[category] ?? siteRelevanceCategoryBase.general;
  const points = Math.min(25, base + matches.reduce((total, [, weight]) => total + weight, 0));
  return {
    matches: matches.map(([keyword]) => keyword),
    points,
    reason: matches.length
      ? `站点相关性 ${points}/25：${matches.map(([keyword]) => keyword).join('、')}`
      : `站点相关性 ${points}/25：仅命中${category}分类基础分`
  };
};

const scorePenalty = (title) => {
  const normalized = normalizeText(title);
  let points = 0;
  const reasons = [];
  if (clickbaitPatterns.some((pattern) => pattern.test(normalized))) {
    points -= 12;
    reasons.push('标题含夸张或诱导表达');
  }
  const letters = normalized.replace(/[^A-Za-z]/g, '');
  if (letters.length >= 12) {
    const uppercaseRatio = letters.replace(/[^A-Z]/g, '').length / letters.length;
    if (uppercaseRatio >= 0.75) {
      points -= 8;
      reasons.push('标题大写比例过高');
    }
  }
  return { points, reasons };
};

export const signalScorePriority = (score) => (score >= 75 ? 'high' : score >= 55 ? 'medium' : 'low');

export const scoreSignalCandidate = (candidate, source = {}, options = {}) => {
  const now = parseDate(options.now) || new Date();
  const trustTier = normalizeText(source.trust_tier || source.trustTier || 'community').toLowerCase();
  const trust = trustScores[trustTier] ?? trustScores.community;
  const recency = scoreRecency(candidate.publishedAt || candidate.published_at, now);
  const completeness = scoreCompleteness({
    ...candidate,
    publishedAt: candidate.publishedAt || candidate.published_at
  });
  const siteRelevance = scoreSiteRelevance(candidate, source);
  const penalty = scorePenalty(candidate.title);
  const score = clamp(trust + recency.points + completeness.points + siteRelevance.points + penalty.points, 0, 100);
  const priority = signalScorePriority(score);

  return {
    breakdown: {
      completeness: completeness.points,
      penalty: penalty.points,
      priority,
      recency: recency.points,
      siteMatches: siteRelevance.matches,
      siteRelevance: siteRelevance.points,
      trust,
      trustTier,
      version: signalTriageVersion
    },
    reasons: [
      `${trustTier} 来源 ${trust} 分`,
      recency.reason,
      completeness.reason,
      siteRelevance.reason,
      ...penalty.reasons
    ],
    score
  };
};

export const signalTitleTokens = (value) => {
  const normalized = normalizeText(value).toLowerCase();
  const tokens = new Set();
  for (const part of normalized.match(/[\p{L}\p{N}]+/gu) || []) {
    const cjk = part.match(/[\u3400-\u9fff]+/g);
    if (cjk) {
      for (const sequence of cjk) {
        if (sequence.length === 1) tokens.add(sequence);
        for (let index = 0; index < sequence.length - 1 && index < 80; index += 1) {
          tokens.add(sequence.slice(index, index + 2));
        }
      }
      const nonCjk = part.replace(/[\u3400-\u9fff]/g, '');
      if (nonCjk.length >= 2 && !titleStopWords.has(nonCjk)) tokens.add(nonCjk);
      continue;
    }
    if ((part.length >= 3 || /^\d+$/.test(part)) && !titleStopWords.has(part)) tokens.add(part);
  }
  return [...tokens].slice(0, 100);
};

export const signalTitleSimilarity = (leftTitle, rightTitle) => {
  const left = new Set(signalTitleTokens(leftTitle));
  const right = new Set(signalTitleTokens(rightTitle));
  if (!left.size || !right.size) return 0;
  const intersection = [...left].filter((token) => right.has(token)).length;
  const union = new Set([...left, ...right]).size;
  const jaccard = intersection / union;
  const containment = intersection / Math.min(left.size, right.size);
  return Number(Math.max(jaccard, containment * 0.92).toFixed(4));
};

export const signalTitleFingerprint = (value) =>
  normalizeText(value)
    .toLowerCase()
    .replace(/[\p{P}\p{S}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300);

const candidateTimestamp = (candidate) =>
  parseDate(
    candidate?.publishedAt ||
      candidate?.published_at ||
      candidate?.createdAt ||
      candidate?.created_at
  );

const isWithinTitleDuplicateWindow = (candidate, existing, now, windowHours) => {
  const candidateTime = candidateTimestamp(candidate) || now;
  const existingTime = candidateTimestamp(existing);
  if (!existingTime) return false;
  return Math.abs(candidateTime.getTime() - existingTime.getTime()) <= windowHours * 3_600_000;
};

export const findSignalCandidateMergeMatch = (candidate, existingCandidates = [], options = {}) => {
  const now = parseDate(options.now) || new Date();
  const windowHours = clamp(
    Number(options.titleDuplicateWindowHours) || signalTitleDuplicateWindowHours,
    1,
    168
  );
  const canonicalUrl = normalizeText(candidate?.canonicalUrl || candidate?.canonical_url);
  const contentHash = normalizeText(candidate?.contentHash || candidate?.content_hash);
  const titleFingerprint =
    normalizeText(candidate?.titleFingerprint || candidate?.title_fingerprint) ||
    signalTitleFingerprint(candidate?.title);
  const category = normalizeText(candidate?.category).toLowerCase();

  const urlMatch = canonicalUrl
    ? existingCandidates.find(
        (existing) => normalizeText(existing?.canonicalUrl || existing?.canonical_url) === canonicalUrl
      )
    : null;
  if (urlMatch) return { candidateId: urlMatch.id, reason: 'canonical_url' };

  const contentMatch = contentHash
    ? existingCandidates.find(
        (existing) => normalizeText(existing?.contentHash || existing?.content_hash) === contentHash
      )
    : null;
  if (contentMatch) return { candidateId: contentMatch.id, reason: 'content_hash' };

  if (
    !titleFingerprint ||
    !category ||
    signalTitleTokens(candidate?.title).length < signalTitleDuplicateMinimumTokens
  ) {
    return null;
  }
  const titleMatch = existingCandidates.find((existing) => {
    const existingFingerprint =
      normalizeText(existing?.titleFingerprint || existing?.title_fingerprint) ||
      signalTitleFingerprint(existing?.title);
    return (
      normalizeText(existing?.category).toLowerCase() === category &&
      signalTitleTokens(existing?.title).length >= signalTitleDuplicateMinimumTokens &&
      existingFingerprint === titleFingerprint &&
      isWithinTitleDuplicateWindow(candidate, existing, now, windowHours)
    );
  });
  return titleMatch ? { candidateId: titleMatch.id, reason: 'title_fingerprint' } : null;
};

export const buildSignalClusterKey = async (title) => {
  const tokens = signalTitleTokens(title).sort();
  const source = tokens.length ? tokens.join('|') : normalizeText(title).toLowerCase();
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(source));
  const hash = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `signal-cluster-${hash.slice(0, 24)}`;
};

const parseMetadata = (value) => {
  if (!value) return {};
  if (typeof value === 'object') return { ...value };
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
};

export const enrichSignalCandidateRows = async (rows, options = {}) => {
  const now = parseDate(options.now) || new Date();
  const pool = (options.existingCandidates || []).map((candidate) => ({
    clusterKey: candidate.clusterKey || candidate.cluster_key || '',
    id: candidate.id || '',
    title: candidate.title || ''
  }));
  const enriched = [];

  for (const row of rows) {
    const scoring = scoreSignalCandidate(row, row.source || options.source || {}, { now });
    let bestMatch = null;
    for (const candidate of pool) {
      const similarity = signalTitleSimilarity(row.title, candidate.title);
      if (similarity >= signalClusterSimilarityThreshold && (!bestMatch || similarity > bestMatch.similarity)) {
        bestMatch = { ...candidate, similarity };
      }
    }
    const clusterKey = bestMatch?.clusterKey || await buildSignalClusterKey(bestMatch?.title || row.title);
    const metadata = parseMetadata(row.metadataJson || row.metadata_json || row.metadata);
    metadata.triage = {
      clusterMatchedId: bestMatch?.id || '',
      clusterSimilarity: bestMatch?.similarity || 0,
      scoredAt: now.toISOString(),
      version: signalTriageVersion
    };
    const nextRow = {
      ...row,
      clusterKey,
      metadataJson: JSON.stringify(metadata),
      relevanceScore: scoring.score,
      scoreBreakdownJson: JSON.stringify({ ...scoring.breakdown, reasons: scoring.reasons }),
      scoredAt: now.toISOString(),
      titleFingerprint:
        normalizeText(row.titleFingerprint || row.title_fingerprint) || signalTitleFingerprint(row.title)
    };
    enriched.push(nextRow);
    pool.push({ clusterKey, id: row.id || '', title: row.title });
  }

  return enriched;
};

export const signalTriageConstants = Object.freeze({
  clusterSimilarityThreshold: signalClusterSimilarityThreshold,
  titleDuplicateMinimumTokens: signalTitleDuplicateMinimumTokens,
  titleDuplicateWindowHours: signalTitleDuplicateWindowHours,
  version: signalTriageVersion
});
