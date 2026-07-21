import { join } from "node:path";
import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import { getClauthDir } from "./profiles.js";

const QUESTIONS_PATH = join(getClauthDir(), "hive-questions.json");

/**
 * Longest text kept from a single field. The analyzer writes into this queue, so
 * everything it sends is treated as untrusted length — a runaway question would
 * otherwise be unreadable in a terminal loop.
 */
const MAX_TEXT = 400;

/** How many questions one run may add. The prompt says the same; this enforces it. */
export const MAX_PER_RUN = 3;

/**
 * open      — waiting for the owner
 * answered  — the owner answered; the answer is not in the wiki yet
 * applied   — the answer has been folded into the wiki
 * dismissed — the owner does not intend to answer
 */
export type QuestionStatus = "open" | "answered" | "applied" | "dismissed";

export interface Question {
  id: string;
  question: string;
  /** Wiki-relative page carrying the gap this question would close. */
  page: string | null;
  /** What the analyzer would write differently once it knows. */
  why: string | null;
  /** Which operation asked: synthesis, session, manual, file. */
  source: string;
  askedAt: string;
  answer?: string;
  answeredAt?: string;
  appliedAt?: string;
  status: QuestionStatus;
}

/** What an analyzer run writes into the inbox, before clauth gives it an identity. */
export interface QuestionDraft {
  question: string;
  page?: string | null;
  why?: string | null;
}

export interface QuestionState {
  questions: Question[];
}

export async function readQuestions(): Promise<QuestionState> {
  try {
    const parsed = JSON.parse(await readFile(QUESTIONS_PATH, "utf8")) as Partial<QuestionState>;
    return { questions: parsed.questions ?? [] };
  } catch {
    return { questions: [] };
  }
}

/** Write via temp + rename, so a crash mid-write cannot truncate the queue. */
async function writeQuestions(state: QuestionState): Promise<void> {
  await mkdir(getClauthDir(), { recursive: true });
  const tmp = `${QUESTIONS_PATH}.tmp`;
  await writeFile(tmp, JSON.stringify(state, null, 2));
  await rename(tmp, QUESTIONS_PATH);
}

function clean(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.replace(/\s+/g, " ").trim();
  return text ? text.slice(0, MAX_TEXT) : null;
}

/** Compare questions on wording alone, so punctuation drift doesn't smuggle a repeat through. */
function normalize(question: string): string {
  return question.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function nextId(existing: Question[]): number {
  const used = existing.map((q) => parseInt(q.id.replace(/^q/, ""), 10)).filter((n) => !isNaN(n));
  return (used.length > 0 ? Math.max(...used) : 0) + 1;
}

/**
 * Record questions an analyzer run asked.
 *
 * Deduped against every question ever asked — including dismissed and answered
 * ones. A question the owner declined to answer must not come back on the next
 * run, or the queue becomes something to ignore rather than something to clear.
 */
export async function addQuestions(drafts: QuestionDraft[], source: string): Promise<Question[]> {
  const state = await readQuestions();
  const seen = new Set(state.questions.map((q) => normalize(q.question)));
  const added: Question[] = [];
  let id = nextId(state.questions);

  for (const draft of drafts) {
    if (added.length >= MAX_PER_RUN) break;
    const question = clean(draft.question);
    if (!question) continue;
    const key = normalize(question);
    if (seen.has(key)) continue;
    seen.add(key);

    added.push({
      id: `q${id++}`,
      question,
      page: clean(draft.page),
      why: clean(draft.why),
      source,
      askedAt: new Date().toISOString(),
      status: "open",
    });
  }

  if (added.length === 0) return [];
  state.questions.push(...added);
  await writeQuestions(state);
  return added;
}

export function openQuestions(state: QuestionState): Question[] {
  return state.questions.filter((q) => q.status === "open");
}

/** Answered but not yet written into the wiki. */
export function unappliedAnswers(state: QuestionState): Question[] {
  return state.questions.filter((q) => q.status === "answered");
}

/**
 * Every question already put to the owner, newest last — injected into analyzer
 * prompts so a run does not re-ask what is already on file. Applied ones are
 * included: their answer is in the wiki, so asking again would be a regression.
 */
export async function askedQuestionTexts(limit = 20): Promise<string[]> {
  const { questions } = await readQuestions();
  return questions.slice(-limit).map((q) => q.question);
}

async function update(id: string, patch: Partial<Question>): Promise<void> {
  const state = await readQuestions();
  const question = state.questions.find((q) => q.id === id);
  if (!question) return;
  Object.assign(question, patch);
  await writeQuestions(state);
}

export async function answerQuestion(id: string, answer: string): Promise<void> {
  await update(id, {
    answer: answer.replace(/\s+/g, " ").trim(),
    answeredAt: new Date().toISOString(),
    status: "answered",
  });
}

export async function dismissQuestion(id: string): Promise<void> {
  await update(id, { status: "dismissed" });
}

/** Dismiss everything open in one go — for when the queue has gone stale. */
export async function dismissAllOpen(): Promise<number> {
  const state = await readQuestions();
  const open = openQuestions(state);
  for (const question of open) question.status = "dismissed";
  if (open.length > 0) await writeQuestions(state);
  return open.length;
}

export async function markApplied(ids: string[]): Promise<void> {
  const state = await readQuestions();
  const at = new Date().toISOString();
  for (const question of state.questions) {
    if (ids.includes(question.id)) {
      question.status = "applied";
      question.appliedAt = at;
    }
  }
  await writeQuestions(state);
}
