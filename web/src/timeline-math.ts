import type { Task } from '../../shared/types.ts';
// UTC day numbers: calendar arithmetic that DST cannot shift.
export const dayIndex = (ymd: string, from: string) => Math.round((Date.parse(ymd + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / 86_400_000);
const add = (ymd: string, n: number) => new Date(Date.parse(ymd + 'T00:00:00Z') + n * 86_400_000).toISOString().slice(0, 10);
export interface Row { id: string; title: string; x: number; w: number; y: number; due: boolean }
export function layout(tasks: Pick<Task, 'id' | 'title' | 'start_at' | 'due_at'>[], from: string, pxPerDay: number, rowH = 34): Row[] {
  return tasks.filter((t) => t.due_at).map((t, i) => {
    const s = dayIndex(t.start_at ?? t.due_at!, from), e = dayIndex(t.due_at!, from);
    return { id: t.id, title: t.title, x: s * pxPerDay, w: Math.max(1, e - s + 1) * pxPerDay, y: i * rowH, due: !t.start_at };
  });
}
export const shiftDates = (t: { start_at: string | null; due_at: string }, days: number) => ({ start_at: t.start_at ? add(t.start_at, days) : null, due_at: add(t.due_at, days) });
