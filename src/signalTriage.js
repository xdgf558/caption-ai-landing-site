const signalTriageVersion = 1;
const signalClusterSimilarityThreshold = 0.72;

const trustScores = Object.freeze({
  community: 14,
  established: 24,
  primary: 30
});

const categoryKeywords = Object.freeze({
  ai: [
    'ai', 'agent', 'anthropic', 'artificial intelligence', 'chatgpt', 'claude', 'copilot', 'deepseek',
    'gemini', 'generative', 'gpt', 'inference', 'llm', 'machine learning', 'model', 'openai', 'training'
  ],
  economy: [
    'central bank', 'cpi', 'economy', 'employment', 'fed', 'federal reserve', 'gdp', 'inflation',
    'interest rate', 'jobs', 'monetary', 'nonfarm', 'payroll', 'recession', 'unemployment'
  ],
  market: [
    'bitcoin', 'bond', 'crypto', 'earnings', 'equity', 'etf', 'fund', 'market', 'nasdaq', 'price',
    'shares', 'stock', 'treasury', 'yield'
  ],
  research: [
    'arxiv', 'benchmark', 'dataset', 'evaluation', 'experiment', 'paper', 'preprint', 'research',
    'scientist', 'study'
  ],
  tech: [
    'api', 'apple', 'cloud', 'cybersecurity', 'database', 'developer', 'github', 'google', 'hardware',
    'microsoft', 'open source', 'privacy', 'release', 'security', 'software', 'startup', 'technology'
  ]
});

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

const scoreRecency = (publishedAt, now) => {
  const published = parseDate(publishedAt);
  if (!published) return { points: 6, reason: '缺少可靠发布时间' };
  const ageHours = Math.max(0, (now.getTime() - published.getTime()) / 3_600_000);
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

const scoreTopic = (candidate, source) => {
  const category = normalizeText(candidate.category || source?.category || 'general').toLowerCase();
  if (category === 'general') return { matches: [], points: 10, reason: '综合来源基础分' };
  const haystack = `${normalizeText(candidate.title)} ${normalizeText(candidate.summary)}`.toLowerCase();
  const matches = (categoryKeywords[category] || []).filter((keyword) => haystack.includes(keyword));
  const points = matches.length ? Math.min(25, 8 + matches.length * 4) : 5;
  return {
    matches: matches.slice(0, 6),
    points,
    reason: matches.length ? `命中 ${matches.length} 个${category}主题词` : `未命中明确的${category}主题词`
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
  const topic = scoreTopic(candidate, source);
  const penalty = scorePenalty(candidate.title);
  const score = clamp(trust + recency.points + completeness.points + topic.points + penalty.points, 0, 100);
  const priority = signalScorePriority(score);

  return {
    breakdown: {
      completeness: completeness.points,
      penalty: penalty.points,
      priority,
      recency: recency.points,
      topic: topic.points,
      topicMatches: topic.matches,
      trust,
      trustTier,
      version: signalTriageVersion
    },
    reasons: [
      `${trustTier} 来源 ${trust} 分`,
      recency.reason,
      completeness.reason,
      topic.reason,
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
      scoredAt: now.toISOString()
    };
    enriched.push(nextRow);
    pool.push({ clusterKey, id: row.id || '', title: row.title });
  }

  return enriched;
};

export const signalTriageConstants = Object.freeze({
  clusterSimilarityThreshold: signalClusterSimilarityThreshold,
  version: signalTriageVersion
});
