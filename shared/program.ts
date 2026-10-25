// Programs (v2.4): limits shared by the Worker and the device.
/** Live programs at most (create and restore from Trash both check it; the list reads at most this many). */
export const MAX_PROGRAMS = 50;
export const PROGRAM_LIMITS = { name: 120, rag_reason: 500, notes: 4000 } as const;
