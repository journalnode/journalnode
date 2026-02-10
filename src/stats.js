const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const TIME_SLOTS = ['5-8 AM', '8-11 AM', '11 AM-2 PM', '2-5 PM', '5-8 PM', '8-11 PM'];

function monthLabel(date) {
  return `${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

function dateKey(date) {
  return date.toISOString().split('T')[0];
}

function timeSlot(date) {
  const h = date.getUTCHours();
  if (h >= 5 && h < 8) return '5-8 AM';
  if (h >= 8 && h < 11) return '8-11 AM';
  if (h >= 11 && h < 14) return '11 AM-2 PM';
  if (h >= 14 && h < 17) return '2-5 PM';
  if (h >= 17 && h < 20) return '5-8 PM';
  return '8-11 PM';
}

function jsDay(date) {
  // Convert JS getUTCDay (0=Sun) to Mon-first index
  const d = date.getUTCDay();
  return d === 0 ? 6 : d - 1;
}

// --- Grouping functions ---

function entriesByMonth(entries) {
  const map = {};
  for (const e of entries) {
    const key = monthLabel(e.timestamp);
    map[key] = (map[key] || 0) + 1;
  }
  return sortedMonthMap(map);
}

function entriesByDayOfWeek(entries) {
  const counts = new Array(7).fill(0);
  for (const e of entries) counts[jsDay(e.timestamp)]++;
  const result = {};
  DAYS.forEach((d, i) => { result[d] = counts[i]; });
  return result;
}

function entriesByTimeSlot(entries) {
  const map = {};
  TIME_SLOTS.forEach(s => { map[s] = 0; });
  for (const e of entries) map[timeSlot(e.timestamp)]++;
  return map;
}

function writingTimeHeatmap(entries) {
  // Returns { months: [...], slots: [...], data: [[count]] }
  const monthSet = new Set();
  for (const e of entries) monthSet.add(monthLabel(e.timestamp));
  const months = sortedMonthLabels([...monthSet]);

  const data = TIME_SLOTS.map(() => months.map(() => 0));
  for (const e of entries) {
    const mi = months.indexOf(monthLabel(e.timestamp));
    const si = TIME_SLOTS.indexOf(timeSlot(e.timestamp));
    if (mi >= 0 && si >= 0) data[si][mi]++;
  }
  return { months, slots: TIME_SLOTS, data };
}

// --- Word count stats ---

function wordCountOverTime(entries) {
  return entries.map(e => ({
    date: e.timestamp,
    dateLabel: dateKey(e.timestamp),
    wordCount: e.wordCount,
  }));
}

function wordCountDistribution(entries, binSize = 50) {
  const counts = entries.map(e => e.wordCount);
  if (counts.length === 0) return { bins: [], frequencies: [] };
  const max = Math.max(...counts);
  const numBins = Math.ceil(max / binSize) + 1;
  const frequencies = new Array(numBins).fill(0);
  for (const c of counts) frequencies[Math.floor(c / binSize)]++;
  const bins = Array.from({ length: numBins }, (_, i) => i * binSize);
  return { bins, frequencies, binSize };
}

function wordCountSummary(entries) {
  const counts = entries.map(e => e.wordCount);
  const total = counts.reduce((a, b) => a + b, 0);
  const mean = Math.round(total / counts.length);
  const sorted = [...counts].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  return { total, mean, median, min, max, count: counts.length };
}

function rollingAverage(values, window = 10) {
  const result = [];
  for (let i = 0; i < values.length; i++) {
    const start = Math.max(0, i - window + 1);
    const slice = values.slice(start, i + 1);
    result.push(Math.round(slice.reduce((a, b) => a + b, 0) / slice.length));
  }
  return result;
}

// --- Cadence / streaks ---

function entryGaps(entries) {
  const gaps = [];
  const dates = [...new Set(entries.map(e => dateKey(e.timestamp)))].sort();
  for (let i = 1; i < dates.length; i++) {
    const diff = (new Date(dates[i]) - new Date(dates[i - 1])) / (1000 * 60 * 60 * 24);
    gaps.push(diff);
  }
  return gaps;
}

function computeStreaks(entries) {
  const dates = [...new Set(entries.map(e => dateKey(e.timestamp)))].sort();
  if (dates.length === 0) return { current: 0, longest: 0 };

  let longest = 1, current = 1;
  for (let i = 1; i < dates.length; i++) {
    const diff = (new Date(dates[i]) - new Date(dates[i - 1])) / (1000 * 60 * 60 * 24);
    if (diff <= 1) {
      current++;
      if (current > longest) longest = current;
    } else {
      current = 1;
    }
  }
  const avgGap = dates.length > 1
    ? ((new Date(dates[dates.length - 1]) - new Date(dates[0])) / (1000 * 60 * 60 * 24) / (dates.length - 1)).toFixed(1)
    : 0;
  return { current, longest, avgGap, totalDays: dates.length };
}

function cumulativeEntries(entries) {
  const dateCounts = {};
  for (const e of entries) {
    const key = dateKey(e.timestamp);
    dateCounts[key] = (dateCounts[key] || 0) + 1;
  }
  const dates = Object.keys(dateCounts).sort();
  let sum = 0;
  return dates.map(d => { sum += dateCounts[d]; return { date: d, total: sum }; });
}

function cumulativeWords(entries) {
  let sum = 0;
  const byDate = {};
  for (const e of entries) {
    const key = dateKey(e.timestamp);
    byDate[key] = (byDate[key] || 0) + e.wordCount;
  }
  const dates = Object.keys(byDate).sort();
  return dates.map(d => { sum += byDate[d]; return { date: d, total: sum }; });
}

// --- Questions ---

function questionsPerMonth(entries) {
  const map = {};
  const countMap = {};
  for (const e of entries) {
    const key = monthLabel(e.timestamp);
    const qCount = (e.content.match(/\?/g) || []).length;
    map[key] = (map[key] || 0) + qCount;
    countMap[key] = (countMap[key] || 0) + 1;
  }
  const sorted = sortedMonthMap(map);
  const result = {};
  for (const [k, v] of Object.entries(sorted)) {
    result[k] = parseFloat((v / countMap[k]).toFixed(2));
  }
  return result;
}

function totalQuestions(entries) {
  return entries.reduce((sum, e) => sum + (e.content.match(/\?/g) || []).length, 0);
}

// --- Vocabulary ---

const STOP_WORDS = new Set([
  'the', 'be', 'to', 'of', 'and', 'a', 'in', 'that', 'have', 'i',
  'it', 'for', 'not', 'on', 'with', 'he', 'as', 'you', 'do', 'at',
  'this', 'but', 'his', 'by', 'from', 'they', 'we', 'say', 'her',
  'she', 'or', 'an', 'will', 'my', 'one', 'all', 'would', 'there',
  'their', 'what', 'so', 'up', 'out', 'if', 'about', 'who', 'get',
  'which', 'go', 'me', 'when', 'make', 'can', 'like', 'time', 'no',
  'just', 'him', 'know', 'take', 'people', 'into', 'year', 'your',
  'good', 'some', 'could', 'them', 'see', 'other', 'than', 'then',
  'now', 'look', 'only', 'come', 'its', 'over', 'think', 'also',
  'back', 'after', 'use', 'two', 'how', 'our', 'work', 'first',
  'well', 'way', 'even', 'new', 'want', 'because', 'any', 'these',
  'give', 'day', 'most', 'us', 'is', 'was', 'are', 'been', 'has',
  'had', 'did', 'am', 'were', 'being', 'im', "i'm", "don't", "it's",
  'really', 'very', 'much', 'more', 'been', 'going', 'got', 'still',
]);

function extractWords(text) {
  return text.toLowerCase().replace(/[^a-z'-]/g, ' ').split(/\s+/).filter(w => w.length > 1);
}

function vocabByMonth(entries) {
  const monthEntries = {};
  for (const e of entries) {
    const key = monthLabel(e.timestamp);
    if (!monthEntries[key]) monthEntries[key] = [];
    monthEntries[key].push(e.content);
  }
  const sorted = sortedMonthLabels(Object.keys(monthEntries));
  const result = {};
  for (const key of sorted) {
    const allWords = monthEntries[key].flatMap(extractWords);
    const unique = new Set(allWords.filter(w => !STOP_WORDS.has(w)));
    result[key] = unique.size;
  }
  return result;
}

function avgWordLength(entries) {
  const words = entries.flatMap(e => extractWords(e.content));
  if (words.length === 0) return 0;
  return parseFloat((words.reduce((s, w) => s + w.length, 0) / words.length).toFixed(2));
}

function topWords(entries, n = 15) {
  const freq = {};
  for (const e of entries) {
    for (const w of extractWords(e.content)) {
      if (!STOP_WORDS.has(w)) freq[w] = (freq[w] || 0) + 1;
    }
  }
  return Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, n);
}

// --- Helpers ---

function sortedMonthLabels(labels) {
  return labels.sort((a, b) => {
    const [am, ay] = a.split(' ');
    const [bm, by] = b.split(' ');
    if (ay !== by) return parseInt(ay) - parseInt(by);
    return MONTHS.indexOf(am) - MONTHS.indexOf(bm);
  });
}

function sortedMonthMap(map) {
  const keys = sortedMonthLabels(Object.keys(map));
  const result = {};
  for (const k of keys) result[k] = map[k];
  return result;
}

module.exports = {
  entriesByMonth,
  entriesByDayOfWeek,
  entriesByTimeSlot,
  writingTimeHeatmap,
  wordCountOverTime,
  wordCountDistribution,
  wordCountSummary,
  rollingAverage,
  entryGaps,
  computeStreaks,
  cumulativeEntries,
  cumulativeWords,
  questionsPerMonth,
  totalQuestions,
  vocabByMonth,
  avgWordLength,
  topWords,
};
