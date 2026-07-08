import { createTRPCReact } from "@trpc/react-query";
import type { AppRouter, RouterOutput } from "@framework/api/router";

export const trpc = createTRPCReact<AppRouter>();

export type { RouterOutput };
