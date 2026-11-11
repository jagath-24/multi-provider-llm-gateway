import { NOT_ADMIN_ERR_MSG, UNAUTHED_ERR_MSG } from '@shared/const';
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { TrpcContext } from "./context";
import { logger } from "./logger";

const t = initTRPC.context<TrpcContext>().create({
  transformer: superjson,
  // Surface a consistent error shape to clients while preserving the typed
  // `TRPCError` code/message. Zod validation issues are forwarded under
  // `data.zodError` so the client can map field-level problems.
  errorFormatter({ shape, error }) {
    // Log unexpected server-side errors; client errors (4xx) are not logged
    // loudly to avoid noise from bad input.
    if (error.code === "INTERNAL_SERVER_ERROR") {
      logger.error({ err: error, path: shape?.data?.path }, "tRPC internal error");
    }
    return {
      ...shape,
      data: {
        ...shape.data,
        zodError:
          error.cause instanceof Error && "issues" in error.cause
            ? (error.cause as unknown as { issues: unknown }).issues
            : null,
      },
    };
  },
});

export const router = t.router;
export const publicProcedure = t.procedure;

const requireUser = t.middleware(async opts => {
  const { ctx, next } = opts;

  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
  }

  return next({
    ctx: {
      ...ctx,
      user: ctx.user,
    },
  });
});

export const protectedProcedure = t.procedure.use(requireUser);

export const adminProcedure = t.procedure.use(
  t.middleware(async opts => {
    const { ctx, next } = opts;

    if (!ctx.user || ctx.user.role !== 'admin') {
      throw new TRPCError({ code: "FORBIDDEN", message: NOT_ADMIN_ERR_MSG });
    }

    return next({
      ctx: {
        ...ctx,
        user: ctx.user,
      },
    });
  }),
);
