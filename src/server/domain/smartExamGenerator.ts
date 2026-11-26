import type { QuestionType } from '../../types/exams.ts';
import type { QuestionDifficulty } from '../../types/questionBank.ts';
import type {
  DistributionMode,
  SmartExamAdjustmentSuggestion,
  SmartExamBlueprint,
  SmartExamShortage,
} from '../../types/smartExamGenerator.ts';

export interface SmartBankQuestionRecord {
  id: number;
  bankCode: string | null;
  isBankItem: boolean;
  approvalStatus: string;
  isArchived: boolean;
  trackId: number | null;
  gradeId: number | null;
  unitId: number | null;
  lessonId: number | null;
  questionType: QuestionType;
  difficulty: QuestionDifficulty;
  points: number;
}

export interface BlueprintValidationResult {
  valid: boolean;
  errors: string[];
  difficultyQuotas: Record<QuestionDifficulty, number> | null;
  unitQuotas: Map<number, number> | null;
}

export interface SmartExamGenerationOutput {
  ok: boolean;
  seed: number;
  selected: Array<{ question: SmartBankQuestionRecord; points: number }>;
  shortages: SmartExamShortage[];
  suggestions: SmartExamAdjustmentSuggestion[];
  errorAr?: string;
  availability: {
    totalEligible: number;
    totalIncludingUsed: number;
    excludedUsedCount: number;
    byDifficulty: Record<QuestionDifficulty, number>;
    byUnit: Array<{ unitId: number | null; count: number }>;
    byQuestionType: Record<string, number>;
  };
}

export interface ReplacementCandidateScore {
  question: SmartBankQuestionRecord;
  matchScore: number;
  matchReasonsAr: string[];
}

const DIFFICULTIES: QuestionDifficulty[] = ['EASY', 'MEDIUM', 'HARD'];

const DIFFICULTY_AR_PLURAL: Record<QuestionDifficulty, string> = {
  EASY: 'سهلة',
  MEDIUM: 'متوسطة',
  HARD: 'صعبة',
};

export function createSeededRng(seed: number): () => number {
  let state = (Math.floor(seed) >>> 0) || 1;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffleWithRng<T>(items: readonly T[], rng: () => number): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr;
}

/**
 * Converts percentage weights (summing to 100) into integer counts summing EXACTLY to `total`
 * using Hamilton's largest-remainder method.
 */
export function percentagesToExactCounts<K extends string | number>(
  entries: Array<{ key: K; percent: number }>,
  total: number,
): Map<K, number> {
  const exact = entries.map((e, idx) => {
    const raw = (e.percent / 100) * total;
    const floored = Math.floor(raw);
    return {
      key: e.key,
      idx,
      floored,
      remainder: raw - floored,
    };
  });

  let remaining = total - exact.reduce((acc, item) => acc + item.floored, 0);
  const byRemainder = [...exact].sort((a, b) => {
    if (Math.abs(b.remainder - a.remainder) > 1e-9) return b.remainder - a.remainder;
    return a.idx - b.idx;
  });

  for (let i = 0; i < remaining && i < byRemainder.length; i += 1) {
    byRemainder[i].floored += 1;
  }

  const out = new Map<K, number>();
  for (const item of exact) {
    out.set(item.key, item.floored);
  }
  return out;
}

export function validateSmartExamBlueprint(blueprint: SmartExamBlueprint): BlueprintValidationResult {
  const errors: string[] = [];

  if (!Number.isInteger(blueprint.trackId) || blueprint.trackId <= 0) {
    errors.push('يرجى اختيار المسار الدراسي.');
  }
  if (!Number.isInteger(blueprint.gradeId) || blueprint.gradeId <= 0) {
    errors.push('يرجى اختيار الصف الدراسي.');
  }
  if (!Number.isInteger(blueprint.totalQuestions) || blueprint.totalQuestions < 1 || blueprint.totalQuestions > 100) {
    errors.push('إجمالي عدد الأسئلة يجب أن يكون رقمًا صحيحًا بين 1 و 100.');
  }
  if (!Number.isInteger(blueprint.durationMin) || blueprint.durationMin < 1 || blueprint.durationMin > 360) {
    errors.push('مدة الامتحان يجب أن تكون بين 1 و 360 دقيقة.');
  }
  if (blueprint.scoreMode === 'TARGET_TOTAL') {
    const target = Number(blueprint.targetTotalScore);
    if (!Number.isFinite(target) || !Number.isInteger(target) || target < blueprint.totalQuestions) {
      errors.push('الدرجة الكلية المستهدفة يجب أن تكون عددًا صحيحًا لا يقل عن عدد الأسئلة (درجة واحدة على الأقل لكل سؤال).');
    } else if (target > 5000) {
      errors.push('الدرجة الكلية المستهدفة تتجاوز الحد المسموح (5000).');
    }
  }

  let difficultyQuotas: Record<QuestionDifficulty, number> | null = null;
  const diff = blueprint.difficultyDistribution;
  if (diff && diff.mode !== 'AUTO') {
    const vals = [diff.easy, diff.medium, diff.hard];
    if (vals.some((v) => !Number.isFinite(v) || v < 0)) {
      errors.push('قيم توزيع مستويات الصعوبة يجب أن تكون أرقامًا غير سالبة.');
    } else if (diff.mode === 'COUNT') {
      if (vals.some((v) => !Number.isInteger(v))) {
        errors.push('أعداد الأسئلة حسب الصعوبة يجب أن تكون أرقامًا صحيحة.');
      } else {
        const sum = diff.easy + diff.medium + diff.hard;
        if (sum !== blueprint.totalQuestions) {
          errors.push(
            `مجموع توزيع الصعوبة (${sum}) لا يساوي إجمالي عدد الأسئلة المطلوب (${blueprint.totalQuestions}).`,
          );
        } else {
          difficultyQuotas = { EASY: diff.easy, MEDIUM: diff.medium, HARD: diff.hard };
        }
      }
    } else if (diff.mode === 'PERCENT') {
      const sum = diff.easy + diff.medium + diff.hard;
      if (Math.abs(sum - 100) > 0.01) {
        errors.push(`مجموع نسب الصعوبة (${sum}%) يجب أن يساوي 100%.`);
      } else if (blueprint.totalQuestions >= 1) {
        const counts = percentagesToExactCounts<QuestionDifficulty>(
          [
            { key: 'EASY', percent: diff.easy },
            { key: 'MEDIUM', percent: diff.medium },
            { key: 'HARD', percent: diff.hard },
          ],
          blueprint.totalQuestions,
        );
        difficultyQuotas = {
          EASY: counts.get('EASY') || 0,
          MEDIUM: counts.get('MEDIUM') || 0,
          HARD: counts.get('HARD') || 0,
        };
      }
    }
  }

  let unitQuotas: Map<number, number> | null = null;
  const uMode: DistributionMode = blueprint.unitDistributionMode || 'AUTO';
  if (uMode !== 'AUTO') {
    const entries = (blueprint.unitDistribution || []).filter((u) => Number.isInteger(u.unitId) && u.unitId > 0);
    if (entries.length === 0) {
      errors.push('يرجى تحديد الوحدات وتوزيع الأسئلة عليها عند تفعيل التوزيع المخصص للوحدات.');
    } else {
      const seenUnitIds = new Set<number>();
      let duplicateUnit = false;
      for (const e of entries) {
        if (seenUnitIds.has(e.unitId)) duplicateUnit = true;
        seenUnitIds.add(e.unitId);
      }
      if (duplicateUnit) {
        errors.push('يوجد تكرار في قائمة توزيع الوحدات.');
      } else if (entries.some((e) => !Number.isFinite(e.value) || e.value < 0)) {
        errors.push('قيم توزيع الوحدات يجب أن تكون أرقامًا غير سالبة.');
      } else if (
        blueprint.unitIds.length > 0 &&
        entries.some((e) => e.value > 0 && !blueprint.unitIds.includes(e.unitId))
      ) {
        errors.push('توزيع الوحدات يحتوي على وحدة غير محددة ضمن الوحدات المختارة.');
      } else if (uMode === 'COUNT') {
        if (entries.some((e) => !Number.isInteger(e.value))) {
          errors.push('أعداد الأسئلة لكل وحدة يجب أن تكون أرقامًا صحيحة.');
        } else {
          const sum = entries.reduce((acc, e) => acc + e.value, 0);
          if (sum !== blueprint.totalQuestions) {
            errors.push(
              `مجموع توزيع الوحدات (${sum}) لا يساوي إجمالي عدد الأسئلة المطلوب (${blueprint.totalQuestions}).`,
            );
          } else {
            unitQuotas = new Map(entries.filter((e) => e.value > 0).map((e) => [e.unitId, e.value]));
          }
        }
      } else if (uMode === 'PERCENT') {
        const sum = entries.reduce((acc, e) => acc + e.value, 0);
        if (Math.abs(sum - 100) > 0.01) {
          errors.push(`مجموع نسب الوحدات (${sum}%) يجب أن يساوي 100%.`);
        } else if (blueprint.totalQuestions >= 1) {
          const counts = percentagesToExactCounts(
            entries.map((e) => ({ key: e.unitId, percent: e.value })),
            blueprint.totalQuestions,
          );
          unitQuotas = new Map(
            Array.from(counts.entries()).filter(([, count]) => count > 0),
          );
        }
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    difficultyQuotas,
    unitQuotas,
  };
}

export function isApprovedActiveBankQuestion(q: SmartBankQuestionRecord): boolean {
  return q.isBankItem === true && q.approvalStatus === 'APPROVED' && q.isArchived === false;
}

export function filterEligibleBankQuestions<T extends SmartBankQuestionRecord>(
  pool: readonly T[],
  blueprint: Pick<
    SmartExamBlueprint,
    'trackId' | 'gradeId' | 'unitIds' | 'lessonIds' | 'questionTypes' | 'excludePreviouslyUsed'
  >,
  usedBankIds: ReadonlySet<number>,
  options?: { ignoreExcludeUsed?: boolean; ignoreUnitAndLessonFilter?: boolean; ignoreQuestionTypeFilter?: boolean },
): T[] {
  const unitSet = blueprint.unitIds.length > 0 ? new Set(blueprint.unitIds) : null;
  const lessonSet = blueprint.lessonIds.length > 0 ? new Set(blueprint.lessonIds) : null;
  const typeSet = blueprint.questionTypes.length > 0 ? new Set(blueprint.questionTypes) : null;
  const applyExcludeUsed = blueprint.excludePreviouslyUsed && !options?.ignoreExcludeUsed;

  return pool.filter((q) => {
    if (!isApprovedActiveBankQuestion(q)) return false;
    if (q.trackId !== blueprint.trackId) return false;
    if (q.gradeId !== blueprint.gradeId) return false;
    if (!options?.ignoreUnitAndLessonFilter) {
      if (unitSet && (q.unitId === null || !unitSet.has(q.unitId))) return false;
      if (lessonSet && (q.lessonId === null || !lessonSet.has(q.lessonId))) return false;
    }
    if (!options?.ignoreQuestionTypeFilter) {
      if (typeSet && !typeSet.has(q.questionType)) return false;
    }
    if (applyExcludeUsed && usedBankIds.has(q.id)) return false;
    return true;
  });
}

export function summarizeAvailability<T extends SmartBankQuestionRecord>(
  pool: readonly T[],
  blueprint: Pick<
    SmartExamBlueprint,
    'trackId' | 'gradeId' | 'unitIds' | 'lessonIds' | 'questionTypes' | 'excludePreviouslyUsed'
  >,
  usedBankIds: ReadonlySet<number>,
) {
  const eligible = filterEligibleBankQuestions(pool, blueprint, usedBankIds);
  const includingUsed = filterEligibleBankQuestions(pool, blueprint, usedBankIds, {
    ignoreExcludeUsed: true,
  });

  const byDifficulty: Record<QuestionDifficulty, number> = { EASY: 0, MEDIUM: 0, HARD: 0 };
  const unitCounts = new Map<number | null, number>();
  const byQuestionType: Record<string, number> = {};

  for (const q of eligible) {
    byDifficulty[q.difficulty] = (byDifficulty[q.difficulty] || 0) + 1;
    unitCounts.set(q.unitId ?? null, (unitCounts.get(q.unitId ?? null) || 0) + 1);
    byQuestionType[q.questionType] = (byQuestionType[q.questionType] || 0) + 1;
  }

  return {
    eligible,
    availability: {
      totalEligible: eligible.length,
      totalIncludingUsed: includingUsed.length,
      excludedUsedCount: Math.max(0, includingUsed.length - eligible.length),
      byDifficulty,
      byUnit: Array.from(unitCounts.entries()).map(([unitId, count]) => ({ unitId, count })),
      byQuestionType,
    },
  };
}

/**
 * Exact Edmonds-Karp max-flow solver for joint (Unit x Difficulty) quota allocation.
 * Guarantees finding a valid allocation whenever one exists.
 */
function solveUnitDifficultyAllocation(
  unitQuotas: Map<number, number>,
  diffQuotas: Record<QuestionDifficulty, number>,
  cellSupply: Map<string, number>,
): { totalFlow: number; allocation: Map<string, number> } {
  const unitIds = Array.from(unitQuotas.keys());
  const SOURCE = 0;
  const unitOffset = 1;
  const diffOffset = unitOffset + unitIds.length;
  const SINK = diffOffset + DIFFICULTIES.length;
  const nodeCount = SINK + 1;

  interface Edge {
    to: number;
    rev: number;
    cap: number;
    key?: string;
  }
  const graph: Edge[][] = Array.from({ length: nodeCount }, () => []);

  const addEdge = (from: number, to: number, cap: number, key?: string) => {
    const fwd: Edge = { to, rev: graph[to].length, cap, key };
    const bwd: Edge = { to: from, rev: graph[from].length, cap: 0 };
    graph[from].push(fwd);
    graph[to].push(bwd);
  };

  unitIds.forEach((uid, uIdx) => {
    const cap = unitQuotas.get(uid) || 0;
    if (cap > 0) addEdge(SOURCE, unitOffset + uIdx, cap);
  });

  DIFFICULTIES.forEach((diff, dIdx) => {
    const cap = diffQuotas[diff] || 0;
    if (cap > 0) addEdge(diffOffset + dIdx, SINK, cap);
  });

  unitIds.forEach((uid, uIdx) => {
    DIFFICULTIES.forEach((diff, dIdx) => {
      const key = `${uid}:${diff}`;
      const supply = cellSupply.get(key) || 0;
      if (supply > 0) {
        addEdge(unitOffset + uIdx, diffOffset + dIdx, supply, key);
      }
    });
  });

  let totalFlow = 0;
  while (true) {
    const parentNode = new Int32Array(nodeCount).fill(-1);
    const parentEdge = new Int32Array(nodeCount).fill(-1);
    const queue: number[] = [SOURCE];
    parentNode[SOURCE] = SOURCE;

    let head = 0;
    while (head < queue.length && parentNode[SINK] === -1) {
      const cur = queue[head++];
      for (let ei = 0; ei < graph[cur].length; ei += 1) {
        const edge = graph[cur][ei];
        if (edge.cap > 0 && parentNode[edge.to] === -1) {
          parentNode[edge.to] = cur;
          parentEdge[edge.to] = ei;
          queue.push(edge.to);
        }
      }
    }

    if (parentNode[SINK] === -1) break;

    let bottleneck = Number.POSITIVE_INFINITY;
    for (let v = SINK; v !== SOURCE; v = parentNode[v]) {
      const u = parentNode[v];
      const ei = parentEdge[v];
      bottleneck = Math.min(bottleneck, graph[u][ei].cap);
    }

    for (let v = SINK; v !== SOURCE; v = parentNode[v]) {
      const u = parentNode[v];
      const ei = parentEdge[v];
      const edge = graph[u][ei];
      edge.cap -= bottleneck;
      graph[v][edge.rev].cap += bottleneck;
    }

    totalFlow += bottleneck;
  }

  const allocation = new Map<string, number>();
  unitIds.forEach((uid, uIdx) => {
    const uNode = unitOffset + uIdx;
    for (const edge of graph[uNode]) {
      if (edge.key) {
        const initialSupply = cellSupply.get(edge.key) || 0;
        const used = initialSupply - edge.cap;
        if (used > 0) allocation.set(edge.key, used);
      }
    }
  });

  return { totalFlow, allocation };
}

export function assignQuestionPoints<T extends SmartBankQuestionRecord>(
  selected: readonly T[],
  scoreMode: 'BANK_DEFAULT' | 'TARGET_TOTAL',
  targetTotalScore?: number | null,
): Array<{ question: T; points: number }> {
  if (selected.length === 0) return [];
  if (scoreMode !== 'TARGET_TOTAL' || !targetTotalScore || !Number.isInteger(targetTotalScore)) {
    return selected.map((q) => ({ question: q, points: Math.max(1, Math.round(q.points || 1)) }));
  }

  const totalTarget = Math.max(selected.length, targetTotalScore);
  const weights = selected.map((q) => Math.max(1, Number(q.points || 1)));
  const weightSum = weights.reduce((a, b) => a + b, 0);

  // Give every question at least 1 point, then distribute remaining points proportionally via largest-remainder.
  const distributable = totalTarget - selected.length;
  const parts = selected.map((q, idx) => {
    const raw = (weights[idx] / weightSum) * distributable;
    const extraFloor = Math.floor(raw);
    return {
      idx,
      question: q,
      points: 1 + extraFloor,
      remainder: raw - extraFloor,
    };
  });

  let leftover = totalTarget - parts.reduce((acc, p) => acc + p.points, 0);
  const byRem = [...parts].sort((a, b) => {
    if (Math.abs(b.remainder - a.remainder) > 1e-9) return b.remainder - a.remainder;
    return a.idx - b.idx;
  });

  for (let i = 0; i < leftover && i < byRem.length; i += 1) {
    byRem[i].points += 1;
  }

  return parts.map((p) => ({ question: p.question, points: p.points }));
}

function buildFeasibleDifficultyPatch(
  availableByDiff: Record<QuestionDifficulty, number>,
  requested: Record<QuestionDifficulty, number>,
  totalQuestions: number,
): Record<QuestionDifficulty, number> | null {
  const totalAvail = availableByDiff.EASY + availableByDiff.MEDIUM + availableByDiff.HARD;
  if (totalAvail < totalQuestions) return null;

  const adjusted: Record<QuestionDifficulty, number> = {
    EASY: Math.min(requested.EASY, availableByDiff.EASY),
    MEDIUM: Math.min(requested.MEDIUM, availableByDiff.MEDIUM),
    HARD: Math.min(requested.HARD, availableByDiff.HARD),
  };

  let deficit = totalQuestions - (adjusted.EASY + adjusted.MEDIUM + adjusted.HARD);
  const order: QuestionDifficulty[] = ['MEDIUM', 'EASY', 'HARD'];
  for (const d of order) {
    if (deficit <= 0) break;
    const spare = availableByDiff[d] - adjusted[d];
    if (spare > 0) {
      const add = Math.min(spare, deficit);
      adjusted[d] += add;
      deficit -= add;
    }
  }

  if (deficit !== 0) return null;
  return adjusted;
}

export function generateSmartExamDraft<T extends SmartBankQuestionRecord>(
  pool: readonly T[],
  blueprint: SmartExamBlueprint,
  usedBankIds: ReadonlySet<number>,
  options?: { unitNamesById?: ReadonlyMap<number, string> },
): SmartExamGenerationOutput {
  const seed = Number.isFinite(blueprint.seed) ? Number(blueprint.seed) : Date.now() % 2147483647;
  const rng = createSeededRng(seed);
  const validation = validateSmartExamBlueprint(blueprint);
  const { eligible, availability } = summarizeAvailability(pool, blueprint, usedBankIds);

  if (!validation.valid) {
    return {
      ok: false,
      seed,
      selected: [],
      shortages: [],
      suggestions: [],
      errorAr: validation.errors[0],
      availability,
    };
  }

  const unitNames = options?.unitNamesById || new Map<number, string>();
  const shortages: SmartExamShortage[] = [];
  const suggestions: SmartExamAdjustmentSuggestion[] = [];

  // Check total shortage
  if (eligible.length < blueprint.totalQuestions) {
    shortages.push({
      code: 'TOTAL',
      available: eligible.length,
      requested: blueprint.totalQuestions,
      messageAr: `المتاح ${eligible.length} سؤال معتمد فقط وفق الشروط المحددة، بينما المطلوب ${blueprint.totalQuestions}.`,
    });
  }

  // Check per-difficulty shortage
  const diffQuotas = validation.difficultyQuotas;
  if (diffQuotas) {
    for (const d of DIFFICULTIES) {
      const reqCount = diffQuotas[d];
      const availCount = availability.byDifficulty[d] || 0;
      if (reqCount > availCount) {
        shortages.push({
          code: 'DIFFICULTY',
          difficulty: d,
          available: availCount,
          requested: reqCount,
          messageAr: `المتاح ${availCount} أسئلة ${DIFFICULTY_AR_PLURAL[d]} فقط، بينما المطلوب ${reqCount}.`,
        });
      }
    }
  }

  // Check per-unit shortage
  const unitQuotas = validation.unitQuotas;
  const availByUnitMap = new Map<number, number>();
  for (const row of availability.byUnit) {
    if (row.unitId !== null) availByUnitMap.set(row.unitId, row.count);
  }
  if (unitQuotas) {
    for (const [uid, reqCount] of unitQuotas.entries()) {
      const availCount = availByUnitMap.get(uid) || 0;
      if (reqCount > availCount) {
        const uName = unitNames.get(uid) || `الوحدة رقم ${uid}`;
        shortages.push({
          code: 'UNIT',
          unitId: uid,
          available: availCount,
          requested: reqCount,
          messageAr: `المتاح في "${uName}" ${availCount} سؤال فقط، بينما المطلوب ${reqCount}.`,
        });
      }
    }
  }

  // Build suggestions helper
  const buildSuggestions = (hasCombinedConflict: boolean) => {
    if (blueprint.excludePreviouslyUsed && availability.excludedUsedCount > 0) {
      suggestions.push({
        code: 'RELAX_EXCLUDE_USED',
        labelAr: `السماح بالأسئلة المستخدمة سابقًا (+${availability.excludedUsedCount} سؤال)`,
        descriptionAr: `يوجد ${availability.excludedUsedCount} سؤال معتمد إضافي مستبعد بسبب استخدامه في امتحانات سابقة.`,
        patch: { excludePreviouslyUsed: false },
      });
    }

    if (eligible.length > 0 && eligible.length < blueprint.totalQuestions) {
      suggestions.push({
        code: 'REDUCE_TOTAL',
        labelAr: `تقليل عدد الأسئلة إلى ${eligible.length}`,
        descriptionAr: `إنشاء الامتحان بالعدد المتاح حاليًا (${eligible.length} سؤال) دون تغيير نطاق المنهج.`,
        patch: {
          totalQuestions: eligible.length,
          difficultyDistribution: { mode: 'AUTO', easy: 0, medium: 0, hard: 0 },
          unitDistributionMode: 'AUTO',
          unitDistribution: [],
        },
      });
    }

    if (diffQuotas && eligible.length >= blueprint.totalQuestions) {
      const feasibleDiff = buildFeasibleDifficultyPatch(
        availability.byDifficulty,
        diffQuotas,
        blueprint.totalQuestions,
      );
      if (
        feasibleDiff &&
        (feasibleDiff.EASY !== diffQuotas.EASY ||
          feasibleDiff.MEDIUM !== diffQuotas.MEDIUM ||
          feasibleDiff.HARD !== diffQuotas.HARD)
      ) {
        suggestions.push({
          code: 'ADJUST_DIFFICULTY',
          labelAr: `تعديل توزيع الصعوبة (سهل ${feasibleDiff.EASY} / متوسط ${feasibleDiff.MEDIUM} / صعب ${feasibleDiff.HARD})`,
          descriptionAr: 'إعادة توزيع مستويات الصعوبة بما يطابق المتاح فعليًا في بنك الأسئلة.',
          patch: {
            difficultyDistribution: {
              mode: 'COUNT',
              easy: feasibleDiff.EASY,
              medium: feasibleDiff.MEDIUM,
              hard: feasibleDiff.HARD,
            },
          },
        });
      }
    }

    if (hasCombinedConflict) {
      suggestions.push({
        code: 'AUTO_UNIT_DISTRIBUTION',
        labelAr: 'تفعيل التوزيع التلقائي للوحدات',
        descriptionAr: 'الاحتفاظ بتوزيع الصعوبة المطلوب مع ترك اختيار الوحدات تلقائيًا من الوحدات المختارة.',
        patch: {
          unitDistributionMode: 'AUTO',
          unitDistribution: [],
        },
      });
    }

    if (blueprint.questionTypes.length > 0) {
      const expandedByType = filterEligibleBankQuestions(pool, blueprint, usedBankIds, {
        ignoreQuestionTypeFilter: true,
      });
      if (expandedByType.length > eligible.length) {
        suggestions.push({
          code: 'EXPAND_QUESTION_TYPES',
          labelAr: `توسيع أنواع الأسئلة (كل الأنواع: ${expandedByType.length} سؤال)`,
          descriptionAr: 'إزالة تقييد نوع السؤال للاستفادة من جميع أنواع الأسئلة المعتمدة في نفس الوحدات.',
          patch: { questionTypes: [] },
        });
      }
    }

    if (blueprint.unitIds.length > 0 || blueprint.lessonIds.length > 0) {
      const expandedByUnits = filterEligibleBankQuestions(pool, blueprint, usedBankIds, {
        ignoreUnitAndLessonFilter: true,
      });
      if (expandedByUnits.length > eligible.length) {
        suggestions.push({
          code: 'EXPAND_UNITS',
          labelAr: `توسيع النطاق لكل وحدات الصف (${expandedByUnits.length} سؤال)`,
          descriptionAr: 'تضمين جميع وحدات ودروس الصف الدراسي لزيادة رصيد الأسئلة المعتمدة.',
          patch: {
            unitIds: [],
            lessonIds: [],
            unitDistributionMode: 'AUTO',
            unitDistribution: [],
          },
        });
      }
    }
  };

  if (shortages.length > 0) {
    buildSuggestions(false);
    return {
      ok: false,
      seed,
      selected: [],
      shortages,
      suggestions,
      errorAr: shortages.map((s) => s.messageAr).join(' '),
      availability,
    };
  }

  // Selection phase — guaranteed zero duplicates
  const selectedRaw: T[] = [];
  const usedIds = new Set<number>();

  if (unitQuotas && diffQuotas) {
    // Joint Unit x Difficulty exact allocation via Max-Flow
    const cellBuckets = new Map<string, T[]>();
    const cellSupply = new Map<string, number>();

    for (const q of eligible) {
      if (q.unitId === null || !unitQuotas.has(q.unitId)) continue;
      const key = `${q.unitId}:${q.difficulty}`;
      const list = cellBuckets.get(key) || [];
      list.push(q);
      cellBuckets.set(key, list);
    }

    for (const [key, list] of cellBuckets.entries()) {
      cellBuckets.set(key, shuffleWithRng(list, rng));
      cellSupply.set(key, list.length);
    }

    const { totalFlow, allocation } = solveUnitDifficultyAllocation(unitQuotas, diffQuotas, cellSupply);
    if (totalFlow < blueprint.totalQuestions) {
      shortages.push({
        code: 'COMBINED',
        available: totalFlow,
        requested: blueprint.totalQuestions,
        messageAr: `توزيع الصعوبة مع توزيع الوحدات المطلوب لا يمكن تحقيقه معًا بالأسئلة المتاحة حاليًا (الحد الأقصى المتوافق ${totalFlow} من أصل ${blueprint.totalQuestions}).`,
      });
      buildSuggestions(true);
      return {
        ok: false,
        seed,
        selected: [],
        shortages,
        suggestions,
        errorAr: shortages[0].messageAr,
        availability,
      };
    }

    for (const [key, count] of allocation.entries()) {
      const bucket = cellBuckets.get(key) || [];
      for (let i = 0; i < count; i += 1) {
        const q = bucket[i];
        if (q && !usedIds.has(q.id)) {
          usedIds.add(q.id);
          selectedRaw.push(q);
        }
      }
    }
  } else if (diffQuotas) {
    for (const d of DIFFICULTIES) {
      const reqCount = diffQuotas[d];
      if (reqCount <= 0) continue;
      const bucket = shuffleWithRng(
        eligible.filter((q) => q.difficulty === d && !usedIds.has(q.id)),
        rng,
      );
      for (let i = 0; i < reqCount; i += 1) {
        const q = bucket[i];
        usedIds.add(q.id);
        selectedRaw.push(q);
      }
    }
  } else if (unitQuotas) {
    for (const [uid, reqCount] of unitQuotas.entries()) {
      const bucket = shuffleWithRng(
        eligible.filter((q) => q.unitId === uid && !usedIds.has(q.id)),
        rng,
      );
      for (let i = 0; i < reqCount; i += 1) {
        const q = bucket[i];
        usedIds.add(q.id);
        selectedRaw.push(q);
      }
    }
  } else {
    const shuffled = shuffleWithRng(eligible, rng);
    for (let i = 0; i < blueprint.totalQuestions; i += 1) {
      const q = shuffled[i];
      usedIds.add(q.id);
      selectedRaw.push(q);
    }
  }

  // Order nicely: Easy -> Medium -> Hard (within each difficulty keep shuffled order for natural exam flow)
  const diffOrder: Record<QuestionDifficulty, number> = { EASY: 1, MEDIUM: 2, HARD: 3 };
  const ordered = shuffleWithRng(selectedRaw, rng).sort(
    (a, b) => diffOrder[a.difficulty] - diffOrder[b.difficulty],
  );

  const selectedWithPoints = assignQuestionPoints(
    ordered,
    blueprint.scoreMode,
    blueprint.targetTotalScore,
  );

  return {
    ok: true,
    seed,
    selected: selectedWithPoints,
    shortages: [],
    suggestions: [],
    availability,
  };
}

/**
 * Ranks approved non-duplicate replacement candidates for a single question inside a generated draft.
 * Strictly requires APPROVED, non-archived, isBankItem=true, same track & grade, and NOT in excludedBankIds.
 */
export function findReplacementCandidates<T extends SmartBankQuestionRecord>(
  pool: readonly T[],
  target: Pick<
    SmartBankQuestionRecord,
    'id' | 'trackId' | 'gradeId' | 'unitId' | 'lessonId' | 'questionType' | 'difficulty' | 'points'
  >,
  options: {
    excludedBankIds: ReadonlySet<number>;
    usedBankIds?: ReadonlySet<number>;
    preferUnused?: boolean;
    allowedUnitIds?: readonly number[];
    allowedQuestionTypes?: readonly QuestionType[];
    limit?: number;
  },
): Array<{ question: T; matchScore: number; matchReasonsAr: string[] }> {
  const usedSet = options.usedBankIds || new Set<number>();
  const unitFilter = options.allowedUnitIds && options.allowedUnitIds.length > 0 ? new Set(options.allowedUnitIds) : null;
  const typeFilter =
    options.allowedQuestionTypes && options.allowedQuestionTypes.length > 0
      ? new Set(options.allowedQuestionTypes)
      : null;

  const scored: Array<{ question: T; matchScore: number; matchReasonsAr: string[] }> = [];

  for (const q of pool) {
    if (!isApprovedActiveBankQuestion(q)) continue;
    if (q.id === target.id || options.excludedBankIds.has(q.id)) continue;
    if (target.trackId !== null && q.trackId !== target.trackId) continue;
    if (target.gradeId !== null && q.gradeId !== target.gradeId) continue;

    let score = 0;
    const reasons: string[] = [];

    if (target.lessonId !== null && q.lessonId === target.lessonId) {
      score += 35;
      reasons.push('نفس الدرس');
    } else if (target.unitId !== null && q.unitId === target.unitId) {
      score += 25;
      reasons.push('نفس الوحدة');
    } else if (unitFilter && q.unitId !== null && unitFilter.has(q.unitId)) {
      score += 10;
      reasons.push('ضمن الوحدات المختارة');
    }

    if (q.difficulty === target.difficulty) {
      score += 25;
      reasons.push(`نفس الصعوبة (${DIFFICULTY_AR_PLURAL[q.difficulty]})`);
    }

    if (q.questionType === target.questionType) {
      score += 20;
      reasons.push('نفس نوع السؤال');
    } else if (typeFilter && typeFilter.has(q.questionType)) {
      score += 8;
    }

    if (q.points === target.points) {
      score += 10;
      reasons.push('نفس الدرجة');
    }

    if (options.preferUnused && !usedSet.has(q.id)) {
      score += 10;
      reasons.push('غير مستخدم سابقًا');
    } else if (usedSet.has(q.id)) {
      score -= 5;
    }

    scored.push({
      question: q,
      matchScore: score,
      matchReasonsAr: reasons.length > 0 ? reasons : ['نفس الصف والمسار'],
    });
  }

  scored.sort((a, b) => {
    if (b.matchScore !== a.matchScore) return b.matchScore - a.matchScore;
    return a.question.id - b.question.id;
  });

  const limit = options.limit ?? 15;
  return scored.slice(0, limit);
}
