import { z } from "zod";

export const runExecutionMessageSchema = z.object({
  runId: z.string().min(1),
});

export type RunExecutionMessage = z.infer<typeof runExecutionMessageSchema>;
